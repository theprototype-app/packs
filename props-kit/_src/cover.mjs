// The pack cover: a small furnished-room diorama assembled from the FINISHED item GLBs
// (so the cover shows exactly what ships), rendered offline with tools/meshy's
// renderer and cropped square (~512², PACKS.md) → ../cover.webp (+ cover.png fallback).
//
//   node cover.mjs [--glb out.glb]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const TOOLS = process.env.MESHY_TOOLS ?? '/home/deck/.code/theprototype-app/packs-lane-30c-tools/tools/meshy';
const { NodeIO } = await import(`${TOOLS}/node_modules/@gltf-transform/core/dist/index.js`);
const { ALL_EXTENSIONS } = await import(`${TOOLS}/node_modules/@gltf-transform/extensions/dist/index.js`);
const { mergeDocuments, dedup, prune, unpartition } = await import(`${TOOLS}/node_modules/@gltf-transform/functions/dist/index.js`);
const { renderThumbs } = await import(`${TOOLS}/lib/thumb.js`);
const { floorPad } = await import('./procedural.mjs');
const sharp = createRequire(`${TOOLS}/package.json`)('sharp');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.resolve(HERE, '..');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const fileOf = (name) => `${name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}.glb`;
const glbOf = (name) => path.join(PACK, name, 'glTF-Binary', fileOf(name));

/** [item, x, y, z, yawDeg] — a 5 × 4 m room corner, back wall at z = -2, left wall at x = -2.5 */
export const LAYOUT = [
	['Rug', 0.1, 0, 0.1, 0],
	['Table', 0.1, 0.015, 0.0, 0],
	['Chair', -0.45, 0.015, 0.62, 180],
	['Chair', 0.65, 0.015, -0.62, 0],
	['Bench', 0.1, 0.015, -0.75, 0],
	['Lantern', 0.35, 0.8, 0.05, 20],
	['Candles', -0.3, 0.8, -0.1, 0],
	['Bookcase', -1.4, 0, -1.72, 0],
	['PottedPlant', -2.1, 0, -1.6, 0],
	['Chest', 1.35, 0, -1.55, -10],
	['Barrel', 2.1, 0, -1.55, 0],
	['BarrelSmall', 2.15, 0, -0.85, 0],
	['CrateStack', 1.9, 0, 0.9, -80],
	['Sacks', 1.0, 0, 1.45, 20],
	['Bed', -1.85, 0, 0.35, 90],
	['WallTorch', 0.3, 1.5, -2.0, 0],
	['Tapestry', -0.5, 0.95, -2.0, 0]
];

export async function buildDiorama(out, layout = LAYOUT) {
	const pad = await floorPad(5, 4);
	const doc = pad.doc;
	const root = doc.getRoot();
	const scene = root.getDefaultScene() ?? root.listScenes()[0];
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
	await doc.transform(unpartition(), dedup(), prune());
	await io.write(out, doc);
	return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'props-cover-'));
	const glb = process.argv.includes('--glb') ? process.argv[process.argv.indexOf('--glb') + 1] : path.join(tmp, 'diorama.glb');
	await buildDiorama(glb);
	const sq = path.join(tmp, 'sq.png');
	await renderThumbs([{ glb, out: sq }], { size: 1400, bg: '#e9e2d6', yaw: 28 });
	// PACKS.md: a cover is ~512² — the diorama fills the middle 1200² of the render
	const crop = sharp(sq).extract({ left: 100, top: 170, width: 1200, height: 1200 }).resize(512, 512);
	await crop.clone().webp({ quality: 86 }).toFile(path.join(PACK, 'cover.webp'));
	await crop.clone().png({ compressionLevel: 9 }).toFile(path.join(PACK, 'cover.png'));
	fs.rmSync(tmp, { recursive: true, force: true });
	console.log('cover.webp + cover.png written');
}
