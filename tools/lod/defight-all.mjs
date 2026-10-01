// Run defight over every GLB of the given packs (in place) and print what changed; the
// world bbox of every file must come out identical (a modular piece's joints depend on it).
//   node tools/lod/defight-all.mjs architecture-kit scifi-kit …
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { defightFile } from './defight.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const req = createRequire(path.join(ROOT, 'tools/meshy/package.json'));
const { NodeIO } = await import(pathToFileURL(req.resolve('@gltf-transform/core')).href);
const { ALL_EXTENSIONS } = await import(pathToFileURL(req.resolve('@gltf-transform/extensions')).href);
const { getBounds } = await import(pathToFileURL(req.resolve('@gltf-transform/functions')).href);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const bounds = async (f) => {
	const d = await io.read(f);
	return getBounds(d.getRoot().getDefaultScene() ?? d.getRoot().listScenes()[0]);
};

/** the GLBs a pack ships: its model list's LOD0 files (never a .lodN.glb) */
export function packGlbs(pack) {
	const list = JSON.parse(fs.readFileSync(path.join(ROOT, pack, 'default.json'), 'utf8'));
	return list.filter((r) => r?.variants?.['glTF-Binary'] && !/^https?:/.test(r.variants['glTF-Binary'])).map((r) => ({ name: r.name, file: path.join(ROOT, pack, r.name, 'glTF-Binary', r.variants['glTF-Binary']) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	let bad = 0;
	for (const pack of process.argv.slice(2)) {
		for (const { name, file } of packGlbs(pack)) {
			if (!fs.existsSync(file)) continue;
			const b0 = await bounds(file);
			const r = await defightFile(file, file);
			const b1 = await bounds(file);
			const same = [0, 1, 2].every((i) => Math.abs(b0.min[i] - b1.min[i]) < 1e-6 && Math.abs(b0.max[i] - b1.max[i]) < 1e-6);
			if (!same) bad++;
			console.log(`${pack}/${name}: ${r.before} → ${r.after} pairs (${r.beforeArea.toFixed(4)} → ${r.afterArea.toFixed(4)} m²), dropped ${r.dropped}, pushed ${r.pushed}${r.left ? `, LEFT AS IS (${r.left})` : ''}${same ? '' : '  BBOX CHANGED'}`);
		}
	}
	if (bad) process.exit(1);
}
