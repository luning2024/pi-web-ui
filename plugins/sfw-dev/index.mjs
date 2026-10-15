/**
 * sfw-dev —— pi-web-ui 插件：天天农场（SFW）开发面板的服务端入口。
 *
 * 移植自 OhMyGame 的三条模式（见 ../OhMyGame-优缺点评估.md）：
 *   A2 一个领域工具让 agent 亲手验证产物 —— sfw_use(open/inspect/act/capture)
 *   A3 使用规则跟着工具走 —— registerAgentTool 的 promptGuidelines
 *   A4 按阶段门控 —— 面板按钮是显式动作，不做隐式自动跑（v1）
 *
 * 服务端入口是同进程 ESM，可访问 Node 全部能力。约定：
 *   - 文件访问一律 node:fs 绝对路径（插件天然要碰工作区外的路径；见下方 helpers 注释）
 *   - 起编辑器进程用 node:child_process（host.bash 默认 60s 超时，跑不了 EditMode）
 */
import { execFile as execFileCallback } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { definePlugin, getSetting } from "./sdk/index.mjs";

const execFile = promisify(execFileCallback);

// 四仓（源：.agents/skills/sfw/config.md）
const REPOS = [
	{ key: "main", rel: "main" },
	{ key: "conf", rel: "main/conf" },
	{ key: "GameScripts", rel: "main/Project/Assets/GameScripts" },
	{ key: "sow-server", rel: "sow-server" },
];

// 平台工程目录，常用的在前。AGENTS.md：开发用平台目录，不要直接开 Project/
const PLATFORM_DIRS = ["project_wx", "project_tuanjie", "project_app", "project_android"];

const WORKSPACE_FILE = ".workspaces.json";
const UIFACADE_SCRIPT = "main/ai/skill/sfv-uifacade-export/scripts/export_uifacade.py";
const HOST_MEMORY = "scripts/host-memory.mjs";

// AGENTS.md 调试铁律：微信工程用 project_wx + -buildTarget WeixinMiniGame；
// -runTests 不要传 -quit（传了测试可能被静默跳过）。
const TEST_BUILD_TARGET = "WeixinMiniGame";

// ---------------------------------------------------------------------------
// 进程
// ---------------------------------------------------------------------------

async function run(command, args, cwd, timeoutMs) {
	try {
		const { stdout, stderr } = await execFile(command, args, {
			cwd,
			timeout: timeoutMs,
			maxBuffer: 16 * 1024 * 1024,
			windowsHide: true,
		});
		return { ok: true, code: 0, stdout: String(stdout), stderr: String(stderr), timedOut: false };
	} catch (error) {
		const err = error ?? {};
		return {
			ok: false,
			code: typeof err.code === "number" ? err.code : 1,
			stdout: String(err.stdout ?? ""),
			stderr: String(err.stderr ?? err.message ?? ""),
			timedOut: err.killed === true || err.signal === "SIGTERM",
		};
	}
}

async function gitOut(repoAbs, args) {
	const r = await run("git", ["-C", repoAbs, ...args], repoAbs, 20000);
	return r.ok ? r.stdout.trim() : null;
}

// ---------------------------------------------------------------------------
// 工作区文件
// ---------------------------------------------------------------------------

// 文件访问一律用 node:fs 绝对路径，不走 host.fs。理由：服务端入口本就是全权 Node，
// 而插件天然要碰工作区外的绝对路径（编辑器 exe、Hub 安装目录）；host.fs 只强制
// 工作区边界，在这里没有额外保护价值，却会让探测逻辑无法用 createMockHost 测试
// （mock 的 fs 是惰性桩：readText 返回空串、list 返回空数组）。
function readFile(abs) {
	try {
		return readFileSync(abs, "utf8");
	} catch {
		return null;
	}
}

function isDir(abs) {
	try {
		return statSync(abs).isDirectory();
	} catch {
		return false;
	}
}

function exists(abs) {
	try {
		statSync(abs);
		return true;
	} catch {
		return false;
	}
}

/** 有界递归找测试程序集：任何路径含 "Tests" 的 *.asmdef。 */
function findTestAssemblies(baseAbs) {
	const found = [];
	const stack = [{ dir: baseAbs, depth: 8 }];
	while (stack.length > 0 && found.length < 100) {
		const current = stack.pop();
		let entries;
		try {
			entries = readdirSync(current.dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const abs = join(current.dir, entry.name);
			if (entry.isDirectory()) {
				if (current.depth > 0 && entry.name !== "Library" && entry.name !== "obj") stack.push({ dir: abs, depth: current.depth - 1 });
			} else if (entry.name.endsWith(".asmdef") && abs.includes("Tests")) {
				found.push(abs);
			}
		}
	}
	return found;
}

// ---------------------------------------------------------------------------
// 编辑器探测
// ---------------------------------------------------------------------------

function projectVersion(text) {
	if (!text) return null;
	const m = text.match(/m_EditorVersion:\s*(\S+)/);
	return m ? m[1] : null;
}

function hubVersions(root) {
	try {
		return readdirSync(root, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name)
			.sort();
	} catch {
		return [];
	}
}

/** 显式覆盖优先：SFW_EDITOR 环境变量 → 插件设置 editorPath。 */
function editorOverride(host) {
	const fromEnv = process.env.SFW_EDITOR;
	if (fromEnv && existsSync(fromEnv)) return fromEnv;
	let value = "";
	try {
		value = host.secrets?.get?.("editorPath") ?? "";
	} catch {
		/* 未配置 */
	}
	if (!value) {
		try {
			value = String(getSetting(host, "editorPath", "") ?? "");
		} catch {
			/* 未配置 */
		}
	}
	return value && existsSync(value) ? value : "";
}

function resolveEditor(host, projectAbs, version) {
	const override = editorOverride(host);
	if (override) return { path: override, version, source: "override", available: [] };

	const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
	const hubs = [
		{ root: join(programFiles, "Tuanjie", "Hub", "Editor"), exe: "Tuanjie.exe" },
		{ root: join(programFiles, "Unity", "Hub", "Editor"), exe: "Unity.exe" },
	];
	const available = hubs.flatMap((h) => hubVersions(h.root));
	if (!version) return { path: null, version: null, source: "no-project", available };
	for (const hub of hubs) {
		const candidate = join(hub.root, version, "Editor", hub.exe);
		if (existsSync(candidate)) return { path: candidate, version, source: "hub", available: [] };
	}
	return { path: null, version, source: "missing", available };
}

// ---------------------------------------------------------------------------
// 工作区探测
// ---------------------------------------------------------------------------

async function detectWorkspace(host) {
	const root = host.cwd;
	const repos = {};
	for (const repo of REPOS) {
		const abs = join(root, repo.rel);
		if (!existsSync(join(abs, ".git"))) {
			repos[repo.key] = { present: false };
			continue;
		}
		const [branch, status] = await Promise.all([
			gitOut(abs, ["branch", "--show-current"]),
			gitOut(abs, ["status", "--porcelain"]),
		]);
		repos[repo.key] = { present: true, branch: branch ?? "", dirty: (status ?? "").length > 0 };
	}

	const platform = PLATFORM_DIRS.find((name) => existsSync(join(root, "main", "Project", name))) ?? null;
	const platformAbs = platform ? join(root, "main", "Project", platform) : join(root, "main", "Project");
	const platformRel = platform ? "main/Project/" + platform : "main/Project";
	const editor = resolveEditor(host, platformAbs, projectVersion(readFile(join(platformAbs, "ProjectSettings", "ProjectVersion.txt"))));

	// .workspaces.json：四仓实时分支与哪个 profile 吻合
	const declared = readFile(join(root, WORKSPACE_FILE));
	let profile = null;
	let mismatch = null;
	if (declared) {
		try {
			const parsed = JSON.parse(declared);
			for (const [name, branches] of Object.entries(parsed.workspaces ?? {})) {
				const diffs = [];
				for (const [repoKey, want] of Object.entries(branches)) {
					const live = repos[repoKey]?.branch;
					if (live !== want) diffs.push(repoKey + ": " + (live ?? "(缺失)") + " != " + want);
				}
				if (diffs.length === 0) {
					profile = name;
					mismatch = null;
					break;
				}
				if (!mismatch || mismatch.diffs.length > diffs.length) mismatch = { profile: name, diffs };
			}
		} catch {
			mismatch = { profile: null, diffs: ["工作区声明文件不是合法 JSON"] };
		}
	}

	const capabilities = [];
	if (editor.path && platform && isDir(join(platformAbs, "Library"))) capabilities.push("tests");
	if (isDir(join(root, "scripts"))) capabilities.push("checks");
	if (exists(join(root, HOST_MEMORY))) capabilities.push("memory");
	if (exists(join(root, UIFACADE_SCRIPT))) capabilities.push("bindings");

	return {
		root,
		profile,
		mismatch,
		repos,
		platform,
		platformAbs,
		platformRel,
		editor,
		capabilities,
		editorLocked: platform ? existsSync(join(platformAbs, "Temp", "UnityLockfile")) : false,
	};
}

function capabilityRemedy(ws, needed) {
	const remedies = {
		tests:
			"需要团结引擎编辑器与已导入的工程。" +
			(ws.editor.path === null
				? " 未找到编辑器（期望 " + String(ws.editor.version ?? "未知") + "，Hub 现有 " + (ws.editor.available.join(", ") || "无") + "）；在插件设置里填「团结引擎路径」，或设 SFW_EDITOR。"
				: " 编辑器已找到但 " + String(ws.platform) + "/Library 缺失，先在编辑器里打开该平台工程导入一次。"),
		checks: "工作区根缺少 scripts/。",
		memory: "缺少 " + HOST_MEMORY + "。",
		bindings: "缺少 " + UIFACADE_SCRIPT + "。",
	};
	return remedies[needed] ?? "缺少能力：" + needed;
}

function fail(code, remedy, extra) {
	return { ok: false, code, remedy, ...(extra ?? {}) };
}

// ---------------------------------------------------------------------------
// 测试产物判读
// ---------------------------------------------------------------------------

function attrsOf(tag) {
	const out = {};
	for (const m of tag.matchAll(/([A-Za-z_][\w-]*)="([^"]*)"/g)) out[m[1]] = m[2];
	return out;
}

function parseTestResults(xml) {
	const runTag = xml.match(/<test-run\b[^>]*>/);
	const head = runTag ? attrsOf(runTag[0]) : {};
	const totals = {
		result: head.result ?? "Unknown",
		total: Number(head.total ?? 0),
		passed: Number(head.passed ?? 0),
		failed: Number(head.failed ?? 0),
		skipped: Number(head.skipped ?? 0),
	};
	const failures = [];
	for (const m of xml.matchAll(/<test-case\b[^>]*result="Failed"[^>]*>([\s\S]*?)<\/test-case>/g)) {
		const attrs = attrsOf(m[0].slice(0, m[0].indexOf(">") + 1));
		const msg = m[1].match(/<message>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/message>/);
		failures.push({
			name: attrs.fullname ?? attrs.name ?? "(unnamed)",
			message: msg ? msg[1].trim().split("\n").slice(0, 3).join("\n") : "",
		});
		if (failures.length >= 5) break;
	}
	return { totals, failures };
}

function compileErrors(log) {
	const seen = new Set();
	const out = [];
	for (const m of log.matchAll(/^.*error CS\d+.*$/gm)) {
		const line = m[0].trim();
		if (seen.has(line)) continue;
		seen.add(line);
		out.push(line);
		if (out.length >= 10) break;
	}
	return out;
}

function tail(text, n) {
	return text.split(/\r?\n/).slice(-n).join("\n");
}

// ---------------------------------------------------------------------------
// 四个操作
// ---------------------------------------------------------------------------

async function opOpen(host) {
	const ws = await detectWorkspace(host);
	return {
		ok: true,
		operation: "open",
		root: ws.root,
		workspace: ws.profile,
		workspaceMismatch: ws.mismatch,
		repos: ws.repos,
		platform: ws.platform,
		editor: { path: ws.editor.path, version: ws.editor.version, source: ws.editor.source, available: ws.editor.available },
		editorLocked: ws.editorLocked,
		capabilities: ws.capabilities,
	};
}

async function opInspect(host, params) {
	const target = String(params.target ?? "");
	const ws = await detectWorkspace(host);

	if (target === "tests") {
		const assemblies = findTestAssemblies(join(ws.root, "main", "Project", "Assets", "GameScripts")).map((abs) => {
			const dir = dirname(abs);
			let fixtures = 0;
			let methods = 0;
			let entries = [];
			try {
				entries = readdirSync(dir, { withFileTypes: true });
			} catch {
				entries = [];
			}
			for (const entry of entries) {
				if (!entry.isFile() || !entry.name.endsWith(".cs")) continue;
				const text = readFile(join(dir, entry.name)) ?? "";
				fixtures += (text.match(/\[TestFixture\]/g) ?? []).length;
				methods += (text.match(/\[Test\]/g) ?? []).length;
			}
			return { asmdef: relative(ws.root, abs).split(sep).join("/"), testFixtures: fixtures, testMethods: methods };
		});
		return {
			ok: true,
			operation: "inspect",
			target: "tests",
			assemblies,
			runnable: ws.capabilities.includes("tests"),
			note: "测试全名形如 client.Tests.<Class>.<Method>，传给 act(action=editmode-tests, testFilter=...)。",
		};
	}

	if (target === "bindings") {
		if (!ws.capabilities.includes("bindings")) return fail("capability-unavailable", capabilityRemedy(ws, "bindings"));
		const prefab = params.prefab ? String(params.prefab) : null;
		if (!prefab) return fail("missing-parameter", "inspect(target=bindings) 需要 prefab，例如 Assets/UI/Xxx/Target.prefab");
		const args = [UIFACADE_SCRIPT, "--prefab", prefab, "--check", "--diff"];
		const r = await run("python", args, ws.root, 120000);
		return { ok: r.ok, operation: "inspect", target: "bindings", prefab, command: "python " + args.join(" "), stdout: r.stdout.trim(), stderr: r.stderr.trim() };
	}

	if (target === "memory") {
		if (!ws.capabilities.includes("memory")) return fail("capability-unavailable", capabilityRemedy(ws, "memory"));
		const query = params.query ? String(params.query) : null;
		const scope = params.scope ? String(params.scope) : "sfw";
		const args = [HOST_MEMORY, query ? "search" : "list", "--scope", scope];
		if (query) args.push("--query", query);
		args.push("--host", "pi", "--cwd", ws.root);
		const r = await run(process.execPath, args, ws.root, 30000);
		return { ok: r.ok, operation: "inspect", target: "memory", scope, query, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
	}

	if (target === "docs") {
		const query = params.query ? String(params.query) : null;
		if (!query) return fail("missing-parameter", "inspect(target=docs) 需要 query");
		const index = readFile(join(ws.root, "docs", "INDEX.md")) ?? "";
		return {
			ok: true,
			operation: "inspect",
			target: "docs",
			query,
			indexHits: index.split(/\r?\n/).filter((l) => l.includes(query)).slice(0, 20),
			note: "索引未命中时让 agent 用 grep 搜 docs/ 正文；INDEX.md 是唯一入口。",
		};
	}

	if (target === "config") {
		const confAbs = join(ws.root, "main", "conf");
		return {
			ok: true,
			operation: "inspect",
			target: "config",
			confPresent: existsSync(confAbs),
			confHead: existsSync(confAbs) ? await gitOut(confAbs, ["log", "-1", "--format=%h %ad %s", "--date=short"]) : null,
			protosPresent: existsSync(join(ws.root, "main", "Protos")),
			note: "配置改动走 PMT：本地只提需求、消费产物、验证客户端行为，不改配置源文件。",
		};
	}

	return fail("unknown-target", "target 取 tests | bindings | memory | docs | config 之一", { target });
}

async function opAct(host, params, runs, nextRunId) {
	const action = String(params.action ?? "");
	const ws = await detectWorkspace(host);
	const needsEditor = action === "editmode-tests" || action === "compile";
	if (needsEditor && !ws.capabilities.includes("tests")) return fail("capability-unavailable", capabilityRemedy(ws, "tests"), { capability: "tests" });

	if (needsEditor && ws.editorLocked) {
		return fail("editor-locked", String(ws.platform) + "/Temp/UnityLockfile 存在——编辑器正开着这个工程，batch 会失败。先关闭编辑器。", { platform: ws.platform });
	}

	const slug = String(params.slug ?? "sfw-dev").replace(/[^\w.-]+/g, "-");
	const timeoutMs = Math.max(1, Number(getSetting(host, "testTimeoutMin", 20)) || 20) * 60 * 1000;

	if (action === "compile") {
		// 静态编译门。成功判据是三条日志同时出现，且无 error CS。
		// 这里 -quit 是对的：不跑测试，静默跳过的坑不适用。
		const logRel = "artifacts/" + slug + "-compile.log";
		const args = ["-batchmode", "-nographics", "-silent-crashes", "-quit", "-projectPath", ws.platformAbs, "-logFile", join(ws.root, logRel)];
		const r = await run(ws.editor.path, args, ws.root, timeoutMs);
		const log = readFile(join(ws.root, logRel));
		const errors = log ? compileErrors(log) : [];
		const buildSuccess = Boolean(log && /Tundra build success/.test(log));
		const exitedClean = Boolean(log && /Exiting batchmode successfully now!/.test(log));
		const verdict = errors.length > 0 ? "compile-failed" : !log ? "no-log" : buildSuccess && exitedClean ? "passed" : "inconclusive";
		return {
			ok: verdict === "passed",
			operation: "act",
			action,
			verdict,
			code: r.code,
			timedOut: r.timedOut,
			compileErrors: errors,
			buildSuccess,
			exitedClean,
			logPath: logRel,
			note: "只证明静态脚本编译，不证明 Play Mode / 设备 / 资源版本 / 后端行为。",
		};
	}

	if (action === "editmode-tests") {
		const resultsRel = "artifacts/" + slug + "-editmode.xml";
		const logRel = "artifacts/" + slug + "-editmode.log";
		const args = ["-batchmode", "-nographics", "-buildTarget", TEST_BUILD_TARGET, "-projectPath", ws.platformAbs];
		if (params.assemblyNames) args.push("-assemblyNames", String(params.assemblyNames));
		if (params.testFilter) args.push("-testFilter", String(params.testFilter));
		args.push("-runTests", "-testPlatform", "EditMode", "-testResults", join(ws.root, resultsRel), "-logFile", join(ws.root, logRel));
		const r = await run(ws.editor.path, args, ws.root, timeoutMs);
		const runId = nextRunId();
		runs.set(runId, { resultsRel, logRel, code: r.code, timedOut: r.timedOut });
		return {
			ok: r.ok,
			operation: "act",
			action,
			runId,
			code: r.code,
			timedOut: r.timedOut,
			testFilter: params.testFilter ?? null,
			assemblyNames: params.assemblyNames ?? null,
			resultsPath: resultsRel,
			logPath: logRel,
			note: "下一步用 capture(runId=...) 读判定，不要直接读 log。",
		};
	}

	if (action === "checks") {
		const checks = [
			{ name: "sync-skills", command: process.execPath, args: ["scripts/sync-skills.mjs", "check"] },
			{ name: "workspace", command: "python", args: ["scripts/check-workspace.py"] },
		];
		const results = [];
		for (const c of checks) {
			const r = await run(c.command, c.args, ws.root, 120000);
			results.push({ name: c.name, ok: r.ok, code: r.code, stdout: tail(r.stdout.trim(), 25), stderr: tail(r.stderr.trim(), 15) });
		}
		return { ok: results.every((x) => x.ok), operation: "act", action, results };
	}

	if (action === "sync-skills") {
		const apply = params.apply === true;
		const args = ["scripts/sync-skills.mjs", "sync"].concat(apply ? ["--apply"] : []);
		const r = await run(process.execPath, args, ws.root, 120000);
		return { ok: r.ok, operation: "act", action, applied: apply, stdout: tail(r.stdout.trim(), 40), stderr: tail(r.stderr.trim(), 15) };
	}

	return fail("unknown-action", "action 取 compile | editmode-tests | checks | sync-skills 之一", { action });
}

async function opCapture(host, params, runs) {
	const runId = params.runId ? String(params.runId) : null;
	if (runId && !runs.has(runId)) return fail("unknown-run", "未知 runId；先调用 act，或直接给 resultsPath/logPath。", { runId });
	const record = runId ? runs.get(runId) : null;
	const resultsRel = record?.resultsRel ?? (params.resultsPath ? String(params.resultsPath) : null);
	const logRel = record?.logRel ?? (params.logPath ? String(params.logPath) : null);
	if (!resultsRel && !logRel) return fail("missing-parameter", "capture 需要 runId，或 resultsPath / logPath。");

	const xml = resultsRel ? readFile(join(host.cwd, resultsRel)) : null;
	const log = logRel ? readFile(join(host.cwd, logRel)) : null;
	const errors = log ? compileErrors(log) : [];
	const parsed = xml ? parseTestResults(xml) : null;

	if (!parsed) {
		return {
			ok: false,
			operation: "capture",
			verdict: errors.length > 0 ? "compile-failed" : "no-results",
			runId,
			compileErrors: errors,
			evidence: { resultsPath: resultsRel, logPath: logRel },
			logTail: log ? tail(log, 30) : null,
			note: errors.length > 0 ? "测试没跑起来：先修编译错误。" : "没有产出测试结果 XML。常见原因：传了 -quit，或编辑器仍开着导致工程被锁。",
		};
	}

	// 有结果文件就说明测试真的跑了，它压过日志里的 error CS
	// （团结引擎会记录不阻塞 EditMode 的其它程序集的编译错误）。
	const verdict = parsed.totals.failed > 0 || parsed.totals.result !== "Passed" ? "failed" : "passed";
	return {
		ok: verdict === "passed",
		operation: "capture",
		verdict,
		runId,
		totals: parsed.totals,
		firstFailure: parsed.failures[0] ?? null,
		failures: parsed.failures,
		compileErrors: errors,
		warnings: errors.length > 0 ? ["日志里出现 error CS，但测试已产出结果：确认这些编译错误是否属于本次改动。"] : [],
		evidence: { resultsPath: resultsRel, logPath: logRel },
	};
}

// ---------------------------------------------------------------------------
// 插件
// ---------------------------------------------------------------------------

export default definePlugin({
	activate(host) {
		const runs = new Map();
		let seq = 0;
		const nextRunId = () => "sfw-" + ++seq + "-" + Date.now().toString(36);

		const offTool = host.registerAgentTool({
			name: "sfw_use",
			label: "SFW Dev",
			description:
				"天天农场(SFW)开发验证工具。open 解析工作区与能力；inspect 只读探查(tests|bindings|memory|docs|config)；" +
				"act 执行(compile|editmode-tests|checks|sync-skills)；capture 把测试产物判成结论。改了 GameScripts 之后必须走 act+capture。",
			promptSnippet: "sfw_use: 解析 SFW 工作区、跑团结引擎编译门与 EditMode、判读验证结论",
			promptGuidelines: [
				"编译通过 ≠ 功能验证：改了 GameScripts 必须 act(editmode-tests) 再 capture 读 verdict。",
				"改完 .cs 先跑 act(compile) 做静态编译门（约 1 分钟），比整轮 EditMode 便宜得多；它只证明脚本能编译。",
				"EditMode 用 project_wx + -buildTarget WeixinMiniGame，且不要传 -quit——传了测试可能被静默跳过。",
				"编辑器开着时 Assets 被锁：act 会拒绝执行，先关闭编辑器。",
				"测试失败先看 capture 的 firstFailure 与 compileErrors，不要直接读原始 log。",
				"TDD：先跑一次期望 FAIL 的 EditMode，改完再跑期望 PASS，两次都要 capture。",
				"改了 claude-config/skills/ 之后跑 act(sync-skills, apply=true)，否则 .agents/skills 漂移。",
				"配置改动走 PMT：本地只提需求、消费产物、验证客户端行为，不改配置源文件。",
				"sow-server 是只读参考、无推送权限，不要在它上面建任务。",
				"生成物红线：Configs/、PBMsgs/、Generate/、GameLogic/Runtime/Managers/Model/MM.cs、**/*.fb.cs 一律不得手改——改上游源再重新生成；任务看起来要编辑生成输出时停下来问。",
			],
			parameters: {
				type: "object",
				required: ["operation"],
				additionalProperties: false,
				properties: {
					operation: { type: "string", enum: ["open", "inspect", "act", "capture"], description: "open 解析工作区；inspect 只读；act 执行；capture 判读。" },
					target: { type: "string", enum: ["tests", "bindings", "memory", "docs", "config"], description: "inspect 的目标。" },
					action: { type: "string", enum: ["compile", "editmode-tests", "checks", "sync-skills"], description: "act 的动作。" },
					testFilter: { type: "string", description: "EditMode 测试类/方法全名，如 client.Tests.Foo.Bar，多个用 | 连接。" },
					assemblyNames: { type: "string", description: "EditMode 测试程序集名，如 AGame.Logic.EditorTests。比 testFilter 粗。" },
					slug: { type: "string", description: "产物文件名前缀，默认 sfw-dev。" },
					prefab: { type: "string", description: "inspect(target=bindings) 的 Prefab 路径，相对 Assets。" },
					query: { type: "string", description: "inspect(target=memory|docs) 的查询词。" },
					scope: { type: "string", enum: ["sfw", "workbench"], description: "inspect(target=memory) 的记忆 scope，默认 sfw。" },
					apply: { type: "boolean", description: "act(sync-skills) 是否真正落盘，默认 false 只干跑。" },
					runId: { type: "string", description: "capture 读取的 runId，由 act 返回。" },
					resultsPath: { type: "string", description: "capture 直接指定的测试结果 XML（工作区相对路径）。" },
					logPath: { type: "string", description: "capture 直接指定的日志（工作区相对路径）。" },
				},
			},
			async execute(_id, params) {
				try {
					const op = String(params.operation ?? "");
					if (op === "open") return await opOpen(host);
					if (op === "inspect") return await opInspect(host, params);
					if (op === "act") return await opAct(host, params, runs, nextRunId);
					if (op === "capture") return await opCapture(host, params, runs);
					return fail("unknown-operation", "operation 取 open | inspect | act | capture 之一", { operation: op });
				} catch (error) {
					return fail("internal-error", "sfw_use 执行异常：" + String(error?.message ?? error));
				}
			},
		});

		// 面板 → 服务端。带 reqId 的上行需要回包，用 sendTo 定向回复。
		const offMessage = host.onMessage(async (payload, from) => {
			const msg = payload ?? {};
			const reply = (data) => {
				const out = { reqId: msg.reqId, ...data };
				if (from) host.sendTo(from, out);
				else host.broadcast(out);
			};
			try {
				switch (msg.action) {
					case "state": {
						const ws = await detectWorkspace(host);
						reply({ kind: "state", state: { root: ws.root, workspace: ws.profile, mismatch: ws.mismatch, repos: ws.repos, platform: ws.platform, editor: ws.editor, editorLocked: ws.editorLocked, capabilities: ws.capabilities } });
						break;
					}
					case "act": {
						const result = await opAct(host, msg, runs, nextRunId);
						reply({ kind: "act", result });
						const label = msg.action === "compile" ? "编译门" : msg.action === "editmode-tests" ? "EditMode" : String(msg.action);
						host.notify(result.ok ? "info" : "warning", "sfw-dev " + label + "：" + String(result.verdict ?? (result.ok ? "完成" : (result.code ?? "失败"))));
						break;
					}
					case "capture": {
						reply({ kind: "capture", result: await opCapture(host, msg, runs) });
						break;
					}
					case "inspect": {
						reply({ kind: "inspect", result: await opInspect(host, msg) });
						break;
					}
					default:
						reply({ kind: "error", error: "unknown action: " + String(msg.action) });
				}
			} catch (error) {
				reply({ kind: "error", error: String(error?.message ?? error) });
			}
		});

		const offSettings = host.onSettingsChanged?.(() => {
			host.broadcast({ kind: "settings-changed" });
		});

		host.log("sfw-dev activated; cwd=" + host.cwd);

		return () => {
			offTool();
			offMessage();
			offSettings?.();
			runs.clear();
			host.log("sfw-dev deactivated");
		};
	},
});
