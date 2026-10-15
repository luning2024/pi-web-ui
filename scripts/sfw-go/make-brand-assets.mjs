#!/usr/bin/env node
/**
 * 生成 pi-web-ui 桌面版的品牌图标集（零依赖，手写 PNG / ICO 编码）。
 *
 * 输出 8 个文件到 --out-dir（通常是 pi-web-ui 检出的 web/public/）：
 *   icons/icon-{192,512,1024}.png        圆角方块底 + 拖拉机剪影
 *   icons/maskable-{192,512,1024}.png    满幅底 + 安全区内的剪影（PWA maskable）
 *   favicon.svg                          同一设计的矢量版
 *   icon.ico                             256×256 PNG 装进 ICO 容器（老浏览器回退）
 *
 * 用法：node scripts/make-brand-assets.mjs --out-dir <pi-web-ui>/web/public
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const outIdx = argv.indexOf("--out-dir");
if (outIdx < 0 || !argv[outIdx + 1]) {
	console.error("用法：node scripts/make-brand-assets.mjs --out-dir <pi-web-ui>/web/public");
	process.exit(2);
}
const OUT = resolve(argv[outIdx + 1]);

const BG = [124, 92, 255]; // --accent，与 themes 的紫一致
const FG = [255, 255, 255];
const HEX = "#7c5cff";

// --- 画布 ----------------------------------------------------------------
function render(size, maskable) {
	const px = new Uint8Array(size * size * 4);

	function blend(x, y, rgb, alpha) {
		if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return;
		const i = (y * size + x) * 4;
		const a = Math.min(1, alpha);
		const dstA = px[i + 3] / 255;
		const outA = a + dstA * (1 - a);
		if (outA <= 0) return;
		for (let c = 0; c < 3; c += 1) px[i + c] = Math.round((rgb[c] * a + px[i + c] * dstA * (1 - a)) / outA);
		px[i + 3] = Math.round(outA * 255);
	}

	/** 4x4 超采样，边缘不锯齿。 */
	function fill(inside, rgb) {
		const S = 4;
		for (let y = 0; y < size; y += 1) {
			for (let x = 0; x < size; x += 1) {
				let hits = 0;
				for (let sy = 0; sy < S; sy += 1) {
					for (let sx = 0; sx < S; sx += 1) if (inside(x + (sx + 0.5) / S, y + (sy + 0.5) / S)) hits += 1;
				}
				if (hits > 0) blend(x, y, rgb, hits / (S * S));
			}
		}
	}

	const U = size / 32; // 设计网格 32x32
	// maskable：内容缩到安全区（内切 80% 圆）内。拖拉机包围盒离画布中心最远 0.406×size，
	// 乘 0.9 后 0.365×size < 0.4×size，够用。
	const k = maskable ? 0.9 : 1;
	const off = (size - size * k) / 2;
	const X = (g) => off + g * U * k;
	const Y = (g) => off + g * U * k;
	const R = (g) => g * U * k;

	const circle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
	const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

	// 底：maskable 满幅，其余圆角方块
	if (maskable) {
		fill(() => true, BG);
	} else {
		const m = 2 * U;
		const r = 7 * U;
		fill((x, y) => {
			if (x < m || y < m || x > size - m || y > size - m) return false;
			const cx = Math.min(Math.max(x, m + r), size - m - r);
			const cy = Math.min(Math.max(y, m + r), size - m - r);
			return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
		}, BG);
	}

	// 拖拉机剪影
	fill(rect(X(7), Y(15), X(21), Y(21)), FG); // 车身
	fill(rect(X(13), Y(9), X(20), Y(15)), FG); // 驾驶室
	fill(rect(X(9), Y(11), X(11), Y(15)), FG); // 排气管
	fill(circle(X(11), Y(22), R(3.4)), FG); // 后轮
	fill(circle(X(20), Y(22), R(2.6)), FG); // 前轮
	fill(circle(X(11), Y(22), R(1.3)), BG); // 后轮毂
	fill(circle(X(20), Y(22), R(1.0)), BG); // 前轮毂
	return px;
}

// --- PNG 编码 -------------------------------------------------------------
const CRC_TABLE = (() => {
	const t = new Int32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c;
	}
	return t;
})();
function crc32(buf) {
	let c = -1;
	for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ -1) >>> 0;
}
function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}
function toPng(px, size) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // RGBA
	const raw = Buffer.alloc(size * (size * 4 + 1));
	for (let y = 0; y < size; y += 1) {
		raw[y * (size * 4 + 1)] = 0; // filter: none
		Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

// --- ICO 容器（单帧，PNG 载荷）--------------------------------------------
function toIco(png, size) {
	const header = Buffer.alloc(22);
	header.writeUInt16LE(0, 0); // reserved
	header.writeUInt16LE(1, 2); // type: icon
	header.writeUInt16LE(1, 4); // count
	header[6] = size >= 256 ? 0 : size; // 0 = 256
	header[7] = size >= 256 ? 0 : size;
	header[8] = 0; // palette
	header[9] = 0; // reserved
	header.writeUInt16LE(1, 10); // planes
	header.writeUInt16LE(32, 12); // bpp
	header.writeUInt32LE(png.length, 14);
	header.writeUInt32LE(22, 18); // offset
	return Buffer.concat([header, png]);
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect x="2" y="2" width="28" height="28" rx="7" fill="${HEX}"/>
  <g fill="#fff">
    <rect x="7" y="15" width="14" height="6"/>
    <rect x="13" y="9" width="7" height="6"/>
    <rect x="9" y="11" width="2" height="4"/>
    <circle cx="11" cy="22" r="3.4"/>
    <circle cx="20" cy="22" r="2.6"/>
  </g>
  <g fill="${HEX}">
    <circle cx="11" cy="22" r="1.3"/>
    <circle cx="20" cy="22" r="1"/>
  </g>
</svg>
`;

mkdirSync(join(OUT, "icons"), { recursive: true });
const written = [];
for (const size of [192, 512, 1024]) {
	writeFileSync(join(OUT, "icons", `icon-${size}.png`), toPng(render(size, false), size));
	writeFileSync(join(OUT, "icons", `maskable-${size}.png`), toPng(render(size, true), size));
	written.push(`icons/icon-${size}.png`, `icons/maskable-${size}.png`);
}
writeFileSync(join(OUT, "favicon.svg"), FAVICON_SVG);
writeFileSync(join(OUT, "icon.ico"), toIco(toPng(render(256, false), 256), 256));
written.push("favicon.svg", "icon.ico");
console.log("写出 " + written.length + " 个品牌资源 → " + OUT);
for (const f of written) console.log("  " + f);
