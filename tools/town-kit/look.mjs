// look: a labelled contact sheet of GLBs on a mid-grey background, each from two yaws —
// untextured Meshy previews are white-on-white on meshy-thumb's default sheet.
//
//   node tools/scifi-kit/look.mjs out.png a.glb b.glb … [--yaws 35,-145] [--size 320]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { TOOLS } from './kit-post.mjs';

const { renderThumbs } = await import(pathToFileURL(path.join(TOOLS, 'lib/thumb.js')).href);
const sharp = createRequire(path.join(TOOLS, 'package.json'))('sharp');

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args.splice(args.indexOf(k), 2)[1] : d);
const yaws = opt('--yaws', '35,-145').split(',').map(Number);
const size = Number(opt('--size', '320'));
const bg = opt('--bg', '#6b7078');
const [out, ...glbs] = args;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'look-'));
const tiles = [];
for (const [yi, yaw] of yaws.entries()) {
	const items = glbs.map((g, i) => ({ glb: g, out: path.join(tmp, `${i}-${yi}.png`) }));
	await renderThumbs(items, { size, bg, yaw });
}
for (const [i, g] of glbs.entries()) {
	const label = g.split('/').slice(-3, -1).join('/') || path.basename(g);
	for (const yi of yaws.keys()) tiles.push({ file: path.join(tmp, `${i}-${yi}.png`), label: yi ? '' : label });
}
const cols = yaws.length * Math.max(1, Math.floor(6 / yaws.length));
const rows = Math.ceil(tiles.length / cols);
const comp = [];
for (const [k, t] of tiles.entries()) {
	const left = (k % cols) * size;
	const top = Math.floor(k / cols) * (size + 22);
	comp.push({ input: t.file, left, top });
	if (t.label) comp.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size * yaws.length}" height="22"><rect width="100%" height="100%" fill="#222"/><text x="6" y="16" font-family="sans-serif" font-size="14" fill="#eee">${t.label}</text></svg>`), left, top: top + size });
}
await sharp({ create: { width: cols * size, height: rows * (size + 22), channels: 3, background: '#222' } }).composite(comp).png().toFile(out);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(out);
