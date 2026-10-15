/**
 * sfw-dev —— 客户端视图：天天农场开发面板。
 *
 * 约定：ESM 默认导出 { mount(container, ctx) → cleanup? }。
 * ctx.send(payload) 上行；ctx.onData(cb) 订阅下行。不依赖 React，纯 DOM。
 * 样式用 CSS 变量（--border / --bg-elev / --accent …）自动跟随宿主主题。
 *
 * 注意：宿主只暴露 /plugins/<id>/client/*，所以 SDK 在 client/sdk/ 有一份副本，
 * 这里只能写 "./sdk/index.mjs" 这样的相对 import。
 */
import { defineView } from "./sdk/index.mjs";

function esc(value) {
	return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const STYLE = `
.sfw { max-width: 900px; margin: 0 auto; font-size: 13px; display: grid; gap: 14px; }
.sfw h2 { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 16px; }
.sfw .bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sfw .grow { flex: 1; }
.sfw .chip {
	display: inline-flex; align-items: center; gap: 4px;
	border: 1px solid var(--border, #333); border-radius: 999px;
	padding: 2px 9px; font-size: 12px; opacity: .85;
}
.sfw .chip.on { border-color: var(--accent, #7c5cff); opacity: 1; }
.sfw .chip.warn { border-color: #d08a2c; color: #d08a2c; opacity: 1; }
.sfw button {
	background: var(--bg-elev, #16161d); color: inherit; font: inherit;
	border: 1px solid var(--border, #333); border-radius: 6px;
	padding: 5px 12px; cursor: pointer;
}
.sfw button.primary { background: var(--accent, #7c5cff); border-color: transparent; color: #fff; }
.sfw button:disabled { opacity: .5; cursor: default; }
.sfw .card { border: 1px solid var(--border, #333); border-radius: 8px; padding: 10px 12px; }
.sfw .meta { opacity: .6; font-size: 12px; }
.sfw table { width: 100%; border-collapse: collapse; }
.sfw td { padding: 3px 0; vertical-align: top; }
.sfw td.repo { width: 130px; }
.sfw td.br { opacity: .8; }
.sfw td.dot { width: 24px; text-align: right; }
.sfw .ok { color: #3fa96a; }
.sfw .bad { color: #d05a5a; }
.sfw pre {
	margin: 6px 0 0; padding: 8px 10px; overflow: auto; max-height: 320px;
	background: var(--bg-elev, #16161d); border: 1px solid var(--border, #333);
	border-radius: 6px; font-size: 12px; white-space: pre-wrap; word-break: break-word;
}
.sfw .hint { opacity: .6; margin: 0; }
@media (max-width: 640px) {
	.sfw td.repo { width: 96px; }
	.sfw button { min-height: 38px; }
}
`;

export default defineView({
	mount(container, ctx) {
		container.innerHTML = `
<div class="sfw">
	<style>${STYLE}</style>
	<h2>🚜 天天农场 <span class="meta">SFW 开发面板</span></h2>
	<div class="bar">
		<span class="chip" id="ws">工作区 ?</span>
		<span class="chip" id="plat">平台 ?</span>
		<span class="chip" id="ed">编辑器 ?</span>
		<span class="grow"></span>
		<button id="refresh">刷新</button>
		<button id="compile" class="primary">编译门</button>
		<button id="test" class="primary">EditMode</button>
	</div>
	<div class="card"><table><tbody id="repos"><tr><td class="meta">读取中…</td></tr></tbody></table></div>
	<div class="card">
		<div class="bar"><b>验证结果</b><span class="grow"></span><span class="chip" id="verdict">未运行</span></div>
		<pre id="out" style="display:none"></pre>
		<p class="hint">「编译门」只证明脚本能编译；「EditMode」才是功能验证。两者都要求编辑器已关闭。</p>
	</div>
</div>`;

		const el = (id) => container.querySelector("#" + id);
		const reposEl = el("repos");
		const outEl = el("out");
		const verdictEl = el("verdict");
		const compileBtn = el("compile");
		const testBtn = el("test");
		let seq = 0;
		const nextId = () => "sfw-" + (++seq) + "-" + Math.random().toString(36).slice(2, 8);

		function chip(node, text, cls) {
			node.textContent = text;
			node.className = "chip" + (cls ? " " + cls : "");
		}

		function showResult(result) {
			const verdict = result?.verdict ?? (result?.ok ? "ok" : "error");
			chip(verdictEl, verdict, result?.ok ? "on" : "warn");
			outEl.style.display = "";
			outEl.textContent = JSON.stringify(result, null, 2);
		}

		function renderState(state) {
			if (!state) return;
			chip(el("ws"), "工作区 " + (state.workspace ?? "未匹配"), state.workspace ? "on" : "warn");
			chip(el("plat"), "平台 " + (state.platform ?? "未找到"), state.platform ? "on" : "warn");
			chip(
				el("ed"),
				"编辑器 " + (state.editor?.version ?? "未找到") + (state.editorLocked ? "（被占用）" : ""),
				state.editorLocked ? "warn" : state.editor?.path ? "on" : "warn",
			);
			const rows = Object.entries(state.repos ?? {})
				.map(([name, repo]) => {
					if (!repo?.present) return `<tr><td class="repo">${esc(name)}</td><td class="br meta" colspan="2">未检出</td></tr>`;
					return `<tr>
	<td class="repo">${esc(name)}</td>
	<td class="br">${esc(repo.branch)}</td>
	<td class="dot ${repo.dirty ? "bad" : "ok"}">${repo.dirty ? "●" : "✓"}</td>
</tr>`;
				})
				.join("");
			const caps = (state.capabilities ?? []).map((c) => `<span class="chip on">${esc(c)}</span>`).join(" ");
			reposEl.innerHTML = rows + `<tr><td colspan="3" style="padding-top:8px">${caps || '<span class="meta">无可用能力</span>'}</td></tr>`;
		}

		function busy(on, which) {
			compileBtn.disabled = on;
			testBtn.disabled = on;
			if (on) chip(verdictEl, which + " 运行中…", "warn");
		}

		function send(action, extra) {
			ctx.send({ reqId: nextId(), action, ...(extra ?? {}) });
		}

		const off = ctx.onData((payload) => {
			if (!payload) return;
			if (payload.kind === "state") return renderState(payload.state);
			// act 之后自动接一次 capture，和 agent 侧的工作流一致：
			// compile 自带 verdict；editmode-tests 返回 runId，需要再判读一次。
			if (payload.kind === "act") {
				const result = payload.result;
				if (result?.runId) return send("capture", { runId: result.runId });
				busy(false);
				return showResult(result);
			}
			if (payload.kind === "capture" || payload.kind === "inspect") {
				busy(false);
				return showResult(payload.result);
			}
			if (payload.kind === "error") {
				busy(false);
				return showResult({ ok: false, error: payload.error });
			}
			if (payload.kind === "settings-changed") send("state");
		});

		const onRefresh = () => send("state");
		const onCompile = () => {
			busy(true, "编译门");
			send("act", { action: "compile", slug: "panel" });
		};
		const onTest = () => {
			busy(true, "EditMode");
			send("act", { action: "editmode-tests", slug: "panel", assemblyNames: "AGame.Logic.EditorTests" });
		};

		el("refresh").addEventListener("click", onRefresh);
		compileBtn.addEventListener("click", onCompile);
		testBtn.addEventListener("click", onTest);

		send("state");

		return () => {
			off();
			container.innerHTML = "";
		};
	},
});
