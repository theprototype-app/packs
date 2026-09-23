#!/usr/bin/env node
// meshy-thumb <model.glb> [--out thumb.webp] [--size 512] [--bg '#d8d4cc'] [--yaw 35]
// meshy-thumb <a.glb> <b.glb> … --sheet sheet.png      one labelled contact sheet to LOOK at a batch
//   (each model's thumb goes next to it as <name>.thumb.webp unless --no-thumbs)
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { parseArgs, die } from '../lib/cli.js';
import { renderThumbs, contactSheet } from '../lib/thumb.js';

const a = parseArgs(process.argv.slice(2));
if (!a._.length) die('usage: meshy-thumb <model.glb> [--out thumb.webp] | <a.glb> <b.glb> … --sheet sheet.png');
const size = Number(a.size ?? 512);
const bg = a.bg && a.bg !== true ? a.bg : null;
const yaw = Number(a.yaw ?? 35);
if (a.sheet) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meshy-sheet-'));
	const items = a._.map((glb, i) => ({ glb, out: path.join(tmp, `${i}.png`) }));
	const res = await renderThumbs(items, { size: 256, bg: bg ?? '#d8d4cc', yaw });
	if (!a['no-thumbs']) await renderThumbs(a._.map((glb) => ({ glb, out: glb.replace(/\.glb$/i, '') + '.thumb.webp' })), { size, bg, yaw });
	await contactSheet(
		res.map((r, i) => ({ png: r.out, label: `${path.basename(path.dirname(path.dirname(a._[i])))}/${path.basename(path.dirname(a._[i]))} ${r.tris}t` })),
		a.sheet
	);
	fs.rmSync(tmp, { recursive: true, force: true });
	console.log(JSON.stringify({ sheet: a.sheet, items: res.map((r, i) => ({ glb: a._[i], tris: r.tris, size: r.size })) }, null, 2));
} else {
	const out = a.out ?? path.join(path.dirname(a._[0]), 'thumb.webp');
	console.log(JSON.stringify(await renderThumbs([{ glb: a._[0], out }], { size, bg, yaw }), null, 2));
}
