#!/usr/bin/env node
/**
 * 把 plugins/sfw-dev 安装进一个 pi-web-ui 数据目录。
 *
 * 走官方 CLI（`pi-web-ui install <本地目录>`），它负责校验 manifest、快照旧版本、保留 config.json。
 *
 * 三个目标：
 *   默认                → 本仓 .pi-web（已在 .gitignore 里）
 *   --portable <根目录> → 便携版的 <根>/data/web，并用便携版自带的 CLI 装（版本天然一致）
 *   --data-dir <路径>   → 任意数据目录
 *
 * 用法：node scripts/sfw-go/install-plugin.mjs [--portable <便携版根目录>] [--data-dir <路径>] [--force]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const repoCli = join(root, "bin", "pi-web-ui.mjs");
const pluginDir = join(root, "plugins", "sfw-dev");

const argv = process.argv.slice(2);
function takeValue(flag) {
	const i = argv.indexOf(flag);
	if (i < 0) return null;
	const value = argv[i + 1] ?? null;
	argv.splice(i, 2);
	return value;
}

const portableArg = takeValue("--portable");
const dataArg = takeValue("--data-dir");
const portableRoot = portableArg ? resolve(portableArg) : null;
const dataDir = dataArg
	? resolve(dataArg)
	: portableRoot
		? join(portableRoot, "data", "web")
		: join(root, ".pi-web");

let cli = repoCli;
if (portableRoot) {
	cli = join(portableRoot, "app", "resources", "app", "bin", "pi-web-ui.mjs");
	if (!existsSync(cli)) {
		console.error("便携版里找不到自带 CLI：" + cli + "\n--portable 要指向含 app/ 与 data/ 的便携版根目录。");
		process.exit(2);
	}
}
if (!existsSync(cli)) {
	console.error("找不到 pi-web-ui CLI：" + cli + "\n先 npm install，或改用 --portable <便携版根目录>。");
	process.exit(2);
}

console.log("plugin  : " + pluginDir);
console.log("dataDir : " + dataDir);
console.log("cli     : " + cli);

const result = spawnSync(process.execPath, [cli, "install", pluginDir, ...argv], {
	stdio: "inherit",
	env: { ...process.env, PI_WEB_DATA_DIR: dataDir },
});
process.exit(result.status ?? 1);
