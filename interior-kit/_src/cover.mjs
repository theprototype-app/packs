// The pack cover: a furnished room corner assembled from the FINISHED item GLBs on the
// architecture kit's real walls and floor tiles (so the cover shows exactly what ships and
// how the kits snap together), rendered offline with tools/meshy's renderer and cropped
// square (~512², PACKS.md) → ../cover.webp (+ cover.png fallback).
//
//   node cover.mjs [--glb out.glb]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const TOOLS = process.env.MESHY_TOOLS ?? new URL('../../tools/meshy', import.meta.url).pathname;
const { NodeIO, Document } = await import(`${TOOLS}/node_modules/@gltf-transform/core/dist/index.js`);
const { ALL_EXTENSIONS } = await import(`${TOOLS}/node_modules/@gltf-transform/extensions/dist/index.js`);
const { mergeDocuments, dedup, prune, unpartition } = await import(`${TOOLS}/node_modules/@gltf-transform/functions/dist/index.js`);
const { renderThumbs } = await import(`${TOOLS}/lib/thumb.js`);
const sharp = createRequire(`${TOOLS}/package.json`)('sharp');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.resolve(HERE, '..');
const ARCH = path.resolve(PACK, '../architecture-kit');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const fileOf = (name) => `${name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}.glb`;
const glbOf = (name) => (name.startsWith('arch:') ? path.join(ARCH, name.slice(5), 'glTF-Binary', fileOf(name.slice(5))) : path.join(PACK, name, 'glTF-Binary', fileOf(name)));

const F = 0.1; // the architecture kit's floor-tile top
/** [item, x, y, z, yawDeg] — a 6 × 4 m room corner: back wall on the z = 0 line, left wall on x = 0 */
export const LAYOUT = [
	...[1, 3, 5].flatMap((x) => [1, 3].map((z) => ['arch:FloorWood', x, 0, z, 0])),
	...[1, 3, 5].map((x) => ['arch:WallPlaster', x, 0, 0, 0]),
	...[1, 3].map((z) => ['arch:WallPlaster', 0, 0, z, 90]),
	['arch:CornerPostStone', 0, 0, 0, 0],
	// trims: the back wall panelled, the left wall skirted, a cornice all round
	...[1, 3, 5].map((x) => ['Wainscot', x, 0, 0, 0]),
	...[1, 3, 5].map((x) => ['Cornice', x, 0, 0, 0]),
	...[1, 3].map((z) => ['Skirting', 0, 0, z, 90]),
	...[1, 3].map((z) => ['Cornice', 0, 0, z, 90]),
	// kitchen run on the back wall (wall-line pivots: the wall's line, z = 0)
	['KitchenCounter', 0.5, F, 0, 0],
	['Stove', 1.45, F, 0, 0],
	['KitchenCounter', 2.4, F, 0, 0],
	['CrateGoods', 2.35, F + 0.92, 0.45, 15],
	// the hearth
	['Fireplace', 4.4, F, 0, 0],
	['Picture', 4.4, 1.95, 0, 0],
	['WallSconce', 3.3, 1.6, 0, 0],
	['WallSconce', 5.5, 1.6, 0, 0],
	['RugRound', 4.2, F, 2.0, 0],
	['Armchair', 3.3, F, 1.9, 55],
	['Sofa', 4.5, F, 3.05, 180],
	['FloorLamp', 5.55, F, 1.35, 0],
	// left wall: books and a table set
	['WallShelfBooks', 0, 1.25, 2.2, 90],
	['TavernTableSet', 1.4, F, 2.6, 0],
	['Plant', 0.45, F, 0.95, 0],
	['Chandelier', 2.6, 3, 2.1, 0]
];

export async function buildDiorama(out, layout = LAYOUT) {
	const doc = new Document();
	doc.createBuffer();
	const root = doc.getRoot();
	const scene = doc.createScene('cover');
	for (const [name, x, y, z, yaw] of layout) {
		const src = await io.read(glbOf(name));
		const map = mergeDocuments(doc, src);
		const srcScene = src.getRoot().getDefaultScene() ?? src.getRoot().listScenes()[0];
		const a = (yaw * Math.PI) / 360;
		const holder = doc.createNode(name).setTranslation([x, y, z]).setRotation([0, Math.sin(a), 0, Math.cos(a)]);
		for (const n of srcScene.listChildren()) holder.addChild(map.get(n));
		scene.addChild(holder);
		for (const s of root.listScenes()) if (s !== scene) s.dispose();
	}
	root.setDefaultScene(scene);
	await doc.transform(unpartition(), dedup(), prune());
	await io.write(out, doc);
	return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'interior-cover-'));
	const glb = process.argv.includes('--glb') ? process.argv[process.argv.indexOf('--glb') + 1] : path.join(tmp, 'diorama.glb');
	await buildDiorama(glb);
	const sq = path.join(tmp, 'sq.png');
	await renderThumbs([{ glb, out: sq }], { size: 1400, bg: '#e9e2d6', yaw: 32 });
	const crop = sharp(sq).extract({ left: 100, top: 100, width: 1200, height: 1200 }).resize(512, 512);
	await crop.clone().webp({ quality: 86 }).toFile(path.join(PACK, 'cover.webp'));
	await crop.clone().png({ compressionLevel: 9 }).toFile(path.join(PACK, 'cover.png'));
	if (process.env.COVER_FULL) fs.copyFileSync(sq, process.env.COVER_FULL);
	fs.rmSync(tmp, { recursive: true, force: true });
	console.log('cover.webp + cover.png written');
}
