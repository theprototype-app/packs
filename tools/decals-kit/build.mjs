// tools/decals-kit/build.mjs — the Decals Starter pack (core roadmap 102 M3): 12 decals drawn here
// as SVG (original work of this project, dedicated CC0-1.0), rendered to transparent 512 px PNGs
// with rsvg-convert, and zipped with a manifest for the app's ".zip pack" path.
//
//   node tools/decals-kit/build.mjs        (needs rsvg-convert and zip on PATH)
//
// Deterministic: every random shape comes from a seeded generator, so a rebuild is byte-stable
// (rsvg-convert and zip -X permitting).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACK = path.join(ROOT, 'decals-starter');
const SVG_DIR = path.join(ROOT, 'tools/decals-kit/svg');
const S = 512;

/** mulberry32 @param {number} seed */
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const f = (/** @type {number} */ v) => +v.toFixed(1);
/** @param {string} body */
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${body}</svg>\n`;

/** a closed organic blob: radius wobbles with a few sine terms plus noise @param {number} cx @param {number} cy @param {number} r @param {() => number} rand @param {number} rough */
function blob(cx, cy, r, rand, rough = 0.25, n = 48) {
	const k = [1 + Math.floor(rand() * 3), 3 + Math.floor(rand() * 3), 6 + Math.floor(rand() * 4)];
	const ph = k.map(() => rand() * Math.PI * 2);
	const amp = [rough * 0.5, rough * 0.3, rough * 0.2];
	const pts = [];
	for (let i = 0; i < n; i++) {
		const t = (i / n) * Math.PI * 2;
		let m = 1;
		for (let j = 0; j < 3; j++) m += amp[j] * Math.sin(k[j] * t + ph[j]);
		m += (rand() - 0.5) * rough * 0.25;
		pts.push([cx + Math.cos(t) * r * m, cy + Math.sin(t) * r * m]);
	}
	// a smooth closed path through the points (Catmull-Rom as cubic Béziers)
	let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
	for (let i = 0; i < n; i++) {
		const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
		const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
		const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
		d += `C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
	}
	return d + 'Z';
}

/** a jagged crack: a main line with branches @param {() => number} rand */
function crack(rand, x0, y0, angle, len, width, depth = 0) {
	let out = '';
	let x = x0, y = y0, a = angle;
	const steps = 10 + Math.floor(rand() * 6);
	const pts = [[x, y]];
	for (let i = 0; i < steps; i++) {
		a += (rand() - 0.5) * 0.55;
		const step = len / steps;
		x += Math.cos(a) * step;
		y += Math.sin(a) * step;
		pts.push([x, y]);
		if (depth < 1 && rand() < 0.16) out += crack(rand, x, y, a + (rand() < 0.5 ? -1 : 1) * (0.35 + rand() * 0.5), len * 0.4, width * 0.55, depth + 1);
	}
	const d = 'M' + pts.map((p) => `${f(p[0])},${f(p[1])}`).join(' L');
	return `<path d="${d}" fill="none" stroke="#1a1714" stroke-width="${f(width)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>` + out;
}

/** @type {{ id: string, name: string, group: string, make: () => string }[]} */
const DECALS = [
	{
		id: 'arrow',
		name: 'Arrow',
		group: 'arrows',
		make: () => svg(`<path d="M60,206 H300 V112 L456,256 L300,400 V306 H60 Z" fill="#f4f4f0" stroke="#1d1d1d" stroke-width="18" stroke-linejoin="round"/>`)
	},
	{
		id: 'chevrons',
		name: 'Chevrons',
		group: 'arrows',
		make: () =>
			svg(
				[0, 1, 2]
					.map((i) => `<path d="M${70 + i * 130},96 L${190 + i * 130},256 L${70 + i * 130},416 H${140 + i * 130} L${260 + i * 130},256 L${140 + i * 130},96 Z" fill="#ffc61a" stroke="#1d1d1d" stroke-width="10" stroke-linejoin="round"/>`)
					.join('')
			)
	},
	{
		id: 'turn-arrow',
		name: 'Turn arrow',
		group: 'arrows',
		make: () =>
			svg(
				`<path d="M150,470 V250 Q150,140 260,140 H330 V70 L460,180 L330,290 V220 H262 Q232,220 232,252 V470 Z" fill="#f4f4f0" stroke="#1d1d1d" stroke-width="16" stroke-linejoin="round"/>`
			)
	},
	{
		id: 'warning',
		name: 'Warning sign',
		group: 'signs',
		make: () =>
			svg(
				`<path d="M256,40 L476,440 H36 Z" fill="#ffcc00" stroke="#151515" stroke-width="28" stroke-linejoin="round"/>` +
					`<path d="M232,170 H280 L270,330 H242 Z" fill="#151515"/><circle cx="256" cy="380" r="26" fill="#151515"/>`
			)
	},
	{
		id: 'no-entry',
		name: 'No entry sign',
		group: 'signs',
		make: () => svg(`<circle cx="256" cy="256" r="226" fill="#d42222" stroke="#f4f4f0" stroke-width="16"/><rect x="96" y="216" width="320" height="80" rx="10" fill="#f4f4f0"/>`)
	},
	{
		id: 'hazard-stripes',
		name: 'Hazard stripes',
		group: 'signs',
		make: () => {
			let stripes = '';
			for (let i = -4; i < 8; i++) stripes += `<path d="M${i * 90},512 L${i * 90 + 45},512 L${i * 90 + 557},0 L${i * 90 + 512},0 Z" fill="#151515"/>`;
			return svg(`<defs><clipPath id="c"><rect x="16" y="136" width="480" height="240" rx="18"/></clipPath></defs><g clip-path="url(#c)"><rect width="512" height="512" fill="#ffc61a"/>${stripes}</g>`);
		}
	},
	{
		id: 'dirt-splat',
		name: 'Dirt splat',
		group: 'dirt',
		make: () => {
			const r = rng(102001);
			let body = `<path d="${blob(256, 256, 150, r, 0.45)}" fill="#3f2f22" opacity="0.88"/>`;
			for (let i = 0; i < 26; i++) {
				const a = r() * Math.PI * 2, d = 170 + r() * 70, s = 6 + r() * 20;
				body += `<path d="${blob(256 + Math.cos(a) * d, 256 + Math.sin(a) * d, s, r, 0.3, 16)}" fill="#3f2f22" opacity="${f(0.55 + r() * 0.35)}"/>`;
			}
			return svg(body);
		}
	},
	{
		id: 'mud-smear',
		name: 'Mud smear',
		group: 'dirt',
		make: () => {
			const r = rng(102002);
			let body = '';
			for (let i = 0; i < 9; i++) {
				const x = 90 + i * 40 + (r() - 0.5) * 20, y = 256 + (r() - 0.5) * 60;
				body += `<path d="${blob(x, y, 70 - Math.abs(i - 4) * 8, r, 0.35, 32)}" fill="#4a3826" opacity="${f(0.35 + r() * 0.25)}"/>`;
			}
			return svg(`<g transform="rotate(-18 256 256)">${body}</g>`);
		}
	},
	{
		id: 'footprint',
		name: 'Footprint',
		group: 'dirt',
		make: () =>
			svg(
				`<g fill="#2b2119" opacity="0.85"><path d="M256,40 C330,40 350,120 344,190 C338,250 316,280 312,300 L200,300 C196,280 174,250 168,190 C162,120 182,40 256,40 Z"/>` +
					`<path d="M210,332 H302 C318,380 316,440 290,468 C270,488 242,488 222,468 C196,440 194,380 210,332 Z"/></g>` +
					`<g stroke="#000" stroke-opacity="0.25" stroke-width="10">${[90, 130, 170, 210, 250].map((y) => `<line x1="190" y1="${y}" x2="322" y2="${y}"/>`).join('')}</g>`
			)
	},
	{
		id: 'crack',
		name: 'Crack',
		group: 'cracks',
		make: () => {
			const r = rng(102003);
			return svg(crack(r, 40, 230, 0.15, 440, 9) + crack(r, 260, 250, 1.6, 200, 6));
		}
	},
	{
		id: 'impact-crack',
		name: 'Impact cracks',
		group: 'cracks',
		make: () => {
			const r = rng(102004);
			let body = '';
			for (let i = 0; i < 9; i++) body += crack(r, 256, 256, (i / 9) * Math.PI * 2 + r() * 0.3, 160 + r() * 70, 7);
			for (const rad of [60, 120]) {
				let d = '';
				for (let i = 0; i <= 18; i++) {
					const a = (i / 18) * Math.PI * 2, m = rad * (0.9 + r() * 0.2);
					d += (i ? ' L' : 'M') + `${f(256 + Math.cos(a) * m)},${f(256 + Math.sin(a) * m)}`;
				}
				body += `<path d="${d}" fill="none" stroke="#1a1714" stroke-width="4" opacity="0.7"/>`;
			}
			return svg(body + `<circle cx="256" cy="256" r="26" fill="#1a1714" opacity="0.9"/>`);
		}
	},
	{
		id: 'scorch',
		name: 'Scorch mark',
		group: 'cracks',
		make: () => {
			const r = rng(102005);
			return svg(
				`<defs><radialGradient id="g"><stop offset="0" stop-color="#0d0b0a" stop-opacity="0.95"/><stop offset="0.55" stop-color="#1c1712" stop-opacity="0.75"/><stop offset="1" stop-color="#2a2018" stop-opacity="0"/></radialGradient></defs>` +
					`<path d="${blob(256, 256, 210, r, 0.3)}" fill="url(#g)"/>`
			);
		}
	}
];

fs.mkdirSync(SVG_DIR, { recursive: true });
fs.mkdirSync(path.join(PACK, 'assets'), { recursive: true });
const items = [];
/** @type {Record<string, any>} */
const licences = {};
for (const d of DECALS) {
	const svgPath = path.join(SVG_DIR, d.id + '.svg');
	fs.writeFileSync(svgPath, d.make());
	const png = path.join(PACK, 'assets', d.id + '.png');
	execFileSync('rsvg-convert', ['-w', String(S), '-h', String(S), '-b', 'none', '-o', png, svgPath]);
	const sha256 = crypto.createHash('sha256').update(fs.readFileSync(png)).digest('hex');
	items.push({ name: d.name, file: 'assets/' + d.id + '.png', kind: 'texture', tags: ['decal', d.group], license: 'CC0-1.0', author: 'theprototype.app', source: 'https://github.com/theprototype-app/packs/tree/main/tools/decals-kit' });
	licences['assets/' + d.id + '.png'] = { licence: 'CC0-1.0', author: 'theprototype.app', source: 'tools/decals-kit/svg/' + d.id + '.svg', sha256 };
}
const manifest = {
	id: 'decals-starter',
	name: 'Decals Starter',
	author: 'theprototype.app (CC0)',
	license: 'CC0-1.0',
	homepage: 'https://github.com/theprototype-app/packs',
	description: 'Arrows, signs, dirt and cracks to project onto surfaces: right-click a surface, Add decal here, then pick one as the image.',
	items
};
fs.writeFileSync(path.join(PACK, 'manifest.json'), JSON.stringify(manifest, null, '\t') + '\n');
const SRC = 'https://github.com/theprototype-app/packs/tree/main/tools/decals-kit';
fs.writeFileSync(
	path.join(PACK, 'attribution.html'),
	`<h3>Decals Starter</h3>\n<p>12 CC0 decals — arrows, signs, dirt and cracks — to project onto surfaces (right-click a surface, Add decal here).</p>\n` +
		`<p>License: CC0 1.0 (Public Domain). Original work of this project; no attribution required.</p>\n<ul>\n` +
		items.map((it) => `<li>${it.name} — theprototype.app, drawn in <a href="${SRC}" target="_blank" rel="noopener">tools/decals-kit</a></li>`).join('\n') +
		'\n</ul>\n'
);
fs.writeFileSync(
	path.join(PACK, 'CREDITS.md'),
	'# Decals Starter — credits\n\nAll 12 files are original work of theprototype.app, drawn as SVG in `tools/decals-kit/build.mjs`\n' +
		'(sources in `tools/decals-kit/svg/`) and dedicated to the public domain under CC0 1.0.\nRebuild: `node tools/decals-kit/build.mjs` (needs rsvg-convert and zip).\n'
);
const zip = path.join(PACK, 'decals-starter.zip');
fs.rmSync(zip, { force: true });
// fixed file times: zip stores them, and a rebuild must be byte-identical
const EPOCH = new Date('2026-11-21T00:00:00Z');
for (const f of ['manifest.json', ...items.map((it) => it.file)]) fs.utimesSync(path.join(PACK, f), EPOCH, EPOCH);
execFileSync('zip', ['-X', '-q', '-r', zip, 'manifest.json', 'assets'], { cwd: PACK });
const own = (/** @type {string} */ f) => ({ licence: 'CC0-1.0', author: 'theprototype.app', source: 'tools/decals-kit/build.mjs', sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(PACK, f))).digest('hex') });
for (const f of ['manifest.json', 'CREDITS.md', 'decals-starter.zip']) licences[f] = own(f);
fs.writeFileSync(path.join(PACK, 'licences.json'), JSON.stringify(licences, null, '\t') + '\n');
console.log(`decals-starter: ${items.length} decals, zip ${fs.statSync(zip).size} bytes`);
