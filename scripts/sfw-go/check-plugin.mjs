#!/usr/bin/env node
/**
 * sfw-dev 插件契约检查。
 *
 * 用官方 createMockHost() 加载插件本体（不是副本），验证：
 *   1. 注册面：agent 工具的名字 / promptGuidelines / JSON Schema
 *   2. 只读操作对真实 SFW 工作区跑得通（open / inspect / capture）
 *   3. 面板 → 服务端消息协议能应答
 *   4. 客户端视图的 import 面合法（宿主只暴露 client/*，越界相对 import 会让插件页空白）
 *
 * 只跑只读操作：不调用 act（那会往工作区写 artifacts/ 产物）。
 *
 * 用法：node scripts/sfw-go/check-plugin.mjs [--workspace <路径>] [--json]
 * 退出码：0 全过，1 有失败。
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createMockHost } from "../../plugins/sfw-dev/sdk/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pluginDir = resolve(here, "..", "..", "plugins", "sfw-dev");

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const wsIndex = argv.indexOf("--workspace");
const workspace = wsIndex >= 0 ? argv[wsIndex + 1] : (process.env.SFW_WORKSPACE ?? "D:\\work-sfw-1");

const checks = [];
function check(name, ok, detail) {
	checks.push({ name, ok: Boolean(ok), detail: detail === undefined ? null : String(detail) });
}

async function main() {
	const plugin = (await import(pathToFileURL(join(pluginDir, "index.mjs")).href)).default;
	check("plugin-exports-activate", typeof plugin?.activate === "function");

	const host = createMockHost({ cwd: workspace, dir: pluginDir });
	await plugin.activate(host);

	// --- 1. 注册面 --------------------------------------------------------
	const tools = host.mock.agentTools ?? [];
	check("registers-one-agent-tool", tools.length === 1, "got " + tools.length);
	const tool = tools[0] ?? {};
	check("tool-name", tool.name === "sfw_use", tool.name);
	check("tool-has-description", typeof tool.description === "string" && tool.description.length > 20);
	check(
		"tool-has-prompt-guidelines",
		Array.isArray(tool.promptGuidelines) && tool.promptGuidelines.length >= 5,
		(tool.promptGuidelines ?? []).length + " guidelines",
	);
	const props = tool.parameters?.properties ?? {};
	const ops = props.operation?.enum ?? [];
	check("schema-operation-enum", ["open", "inspect", "act", "capture"].every((x) => ops.includes(x)) && ops.length === 4, ops.join(","));
	const actions = props.action?.enum ?? [];
	check("schema-action-enum", ["compile", "editmode-tests", "checks", "sync-skills"].every((x) => actions.includes(x)), actions.join(","));
	check("schema-closed", tool.parameters?.additionalProperties === false);

	// --- 2. 只读操作对真实工作区 ------------------------------------------
	const run = (params) => tool.execute("t", params);

	const open = await run({ operation: "open" });
	check("open-ok", open.ok === true, JSON.stringify(open).slice(0, 100));
	check("open-detects-repos", Object.values(open.repos ?? {}).some((r) => r?.present), JSON.stringify(Object.keys(open.repos ?? {})));
	check("open-reports-capabilities", Array.isArray(open.capabilities) && open.capabilities.length > 0, (open.capabilities ?? []).join(","));
	check("open-reports-platform", typeof open.platform === "string" && open.platform.length > 0, open.platform);

	const tests = await run({ operation: "inspect", target: "tests" });
	check("inspect-tests-finds-assemblies", Array.isArray(tests.assemblies) && tests.assemblies.length > 0, (tests.assemblies ?? []).length + " assemblies");
	check(
		"inspect-tests-counts-methods",
		(tests.assemblies ?? []).some((a) => a.testMethods > 0),
		(tests.assemblies ?? []).map((a) => a.testMethods).join(","),
	);

	const docs = await run({ operation: "inspect", target: "docs", query: "zzz-no-such-entry" });
	check("inspect-docs-ok", docs.ok === true, docs.ok);

	const badTarget = await run({ operation: "inspect", target: "nope" });
	check("inspect-rejects-unknown-target", badTarget.ok === false && badTarget.code === "unknown-target", badTarget.code);
	const badOp = await run({ operation: "nope" });
	check("rejects-unknown-operation", badOp.ok === false && badOp.code === "unknown-operation", badOp.code);

	// capture 读工作区里已有的真实测试产物（只读，不产生新文件）
	const capture = await run({
		operation: "capture",
		resultsPath: "artifacts/all-logic-editmode-final-results.xml",
		logPath: "artifacts/all-logic-editmode-final.log",
	});
	check("capture-reads-real-results", capture.operation === "capture" && typeof capture.verdict === "string", capture.verdict);
	check("capture-reports-totals", capture.totals && capture.totals.total > 0, JSON.stringify(capture.totals ?? null));
	const badRun = await run({ operation: "capture", runId: "nope" });
	check("capture-rejects-unknown-run", badRun.ok === false && badRun.code === "unknown-run", badRun.code);

	// --- 3. 面板 → 服务端协议 ---------------------------------------------
	host.mock.emit("onMessage", { reqId: "r1", action: "state" }, "client-1");
	await host.mock.emitAsync("onMessage", { reqId: "r2", action: "state" }, "client-1");
	const sent = host.mock.calls("sendTo");
	check("panel-state-replies-via-sendTo", sent.length > 0, sent.length + " sendTo calls");
	const stateReply = sent.map((c) => c.args?.[1]).find((p) => p?.kind === "state");
	check("panel-state-payload", Boolean(stateReply?.state?.repos), JSON.stringify(stateReply?.state?.workspace ?? null));

	await host.mock.emitAsync("onMessage", { reqId: "r3", action: "nope" }, "client-1");
	const errReply = host.mock.calls("sendTo").map((c) => c.args?.[1]).find((p) => p?.kind === "error");
	check("panel-unknown-action-errors", Boolean(errReply), errReply?.error);

	// --- 4. 客户端 import 面 ----------------------------------------------
	const clientSrc = readFileSync(join(pluginDir, "client", "entry.mjs"), "utf8");
	const relImports = [...clientSrc.matchAll(/from\s+"(\.[^"]+)"/g)].map((m) => m[1]);
	check("client-imports-stay-inside-client", relImports.every((p) => p.startsWith("./sdk/")), relImports.join(",") || "(none)");
	const view = (await import(pathToFileURL(join(pluginDir, "client", "entry.mjs")).href)).default;
	check("client-exports-mount", typeof view?.mount === "function");

	// 清理
	if (typeof plugin.deactivate === "function") plugin.deactivate();
}

await main();

const failed = checks.filter((c) => !c.ok);
if (asJson) {
	console.log(JSON.stringify({ ok: failed.length === 0, passed: checks.length - failed.length, failed: failed.length, workspace, checks }, null, 2));
} else {
	for (const c of checks) console.log((c.ok ? "  ok   " : "  FAIL ") + c.name + (c.detail === null ? "" : "  [" + c.detail + "]"));
	console.log("");
	console.log("sfw-dev plugin: " + (checks.length - failed.length) + "/" + checks.length + " passed  (workspace=" + workspace + ")");
}
process.exit(failed.length === 0 ? 0 : 1);
