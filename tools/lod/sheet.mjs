// sheet: the per-pack LOD LOOK — one row per item with levels: LOD0 near (256 px), then LOD0
// and each level at the size core first shows that level (180 px / 72 px, = 25 % / 10 % of a
// 720 p view), each level drawn the way core draws it (its geometry, LOD0's materials).
// Far cells are upscaled ×2 (nearest) so a reader can compare them; equal cells = no pop.
//   node tools/lod/sheet.mjs <out-dir> <pack> [<pack> …]   → <out-dir>/lod-<pack>.png
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Judge } from './judge.mjs';
import { LEVELS } from './lod.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const req = createRequire(path.join(ROOT, 'tools/meshy/package.json'));
const sharp = (await import(pathToFileURL(req.resolve('sharp')).href)).default;

const CELL = 256;
const LABEL = 20;
const png = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64');
const up = async (buf) => sharp(buf).resize(CELL, CELL, { kernel: 'nearest', fit: 'contain', background: '#d8d4cc' }).png().toBuffer();
const label = (text, w = CELL) =>
	Buffer.from(`<svg width="${w}" height="${LABEL}"><rect width="100%" height="100%" fill="#222"/><text x="5" y="14" font-family="sans-serif" font-size="12" fill="#eee">${text.replace(/[<&>]/g, '')}</text></svg>`);

export async function packSheet(judge, pack, out) {
	const list = JSON.parse(fs.readFileSync(path.join(ROOT, pack, 'default.json'), 'utf8')).filter((r) => r.lods?.length);
	const cols = 1 + 2 * LEVELS.length; // near, then (LOD0 @ size, level @ size) per level
	const comps = [];
	let y = 0;
	for (const row of list) {
		const dir = path.join(ROOT, pack, row.name, 'glTF-Binary');
		const b0 = fs.readFileSync(path.join(dir, row.variants['glTF-Binary']));
		const near = await judge.shotAs(b0, b0, CELL);
		comps.push({ input: png(near.png), left: 0, top: y }, { input: label(`${row.name} LOD0 ${near.tris}t`), left: 0, top: y + CELL });
		for (let i = 0; i < row.lods.length; i++) {
			const size = LEVELS[Math.min(i, LEVELS.length - 1)].seenAt;
			const bl = fs.readFileSync(path.join(dir, row.lods[i].file));
			const ref = await judge.shotAs(b0, b0, size);
			const lv = await judge.shotAs(b0, bl, size);
			const x = CELL * (1 + 2 * i);
			comps.push({ input: await up(png(ref.png)), left: x, top: y }, { input: label(`LOD0 @ ${size}px`), left: x, top: y + CELL });
			comps.push({ input: await up(png(lv.png)), left: x + CELL, top: y }, { input: label(`LOD${i + 1} @ ${size}px ${lv.tris}t (${row.lods[i].ratio})`), left: x + CELL, top: y + CELL });
		}
		y += CELL + LABEL;
	}
	if (!list.length) return null;
	await sharp({ create: { width: cols * CELL, height: y, channels: 3, background: '#d8d4cc' } }).composite(comps).png().toFile(out);
	return { out, items: list.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [outDir, ...packs] = process.argv.slice(2);
	fs.mkdirSync(outDir, { recursive: true });
	const judge = await new Judge().open();
	try {
		for (const pack of packs) console.log(JSON.stringify(await packSheet(judge, pack, path.join(outDir, `lod-${pack}.png`))));
	} finally {
		await judge.close();
	}
}
