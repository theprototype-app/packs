// Run defight over every GLB of the given packs (in place) and print what changed; the
// world bbox of every file must come out identical (a modular piece's joints depend on it).
//   node tools/lod/defight-all.mjs architecture-kit scifi-kit …
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { defightFile } from './defight.mjs';
import { Judge } from './judge.mjs';

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
	// every rewritten file is also LOOKED at: rendered against its own bytes from before, 256 px,
	// four sides (judge.mjs). A shading break — 33-anim-kit's IronGate read 72.8 — shows up here
	// as a number, not in a teammate's screenshot.
	const judge = process.env.DEFIGHT_NO_JUDGE ? null : await new Judge().open();
	let bad = 0;
	// what each file got: the SHIPPED test reads it (a residual >= 1 cm² must be a recorded,
	// look-gated exception, never an accident)
	const reportFile = path.join(ROOT, 'tools/lod/defight-report.json');
	const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : {};
	try {
		for (const pack of process.argv.slice(2)) {
			for (const { name, file } of packGlbs(pack)) {
				if (!fs.existsSync(file)) continue;
				const b0 = await bounds(file);
				const r = await defightFile(file, file, { judge });
				const b1 = await bounds(file);
				const same = [0, 1, 2].every((i) => Math.abs(b0.min[i] - b1.min[i]) < 1e-6 && Math.abs(b0.max[i] - b1.max[i]) < 1e-6);
				if (!same) bad++;
				const look = r.look !== undefined ? `, ${r.mode}, look Δ ${r.look}` : '';
				report[`${pack}/${name}`] = { before: +r.beforeArea.toFixed(4), after: +r.afterArea.toFixed(4), ...(r.mode ? { mode: r.mode, look: r.look } : {}), ...(r.left ? { left: r.left } : {}) };
				console.log(`${pack}/${name}: ${r.before} → ${r.after} pairs (${r.beforeArea.toFixed(4)} → ${r.afterArea.toFixed(4)} m²), dropped ${r.dropped}, pushed ${r.pushed}${look}${r.left ? `, LEFT AS IS (${r.left})` : ''}${same ? '' : '  BBOX CHANGED'}`);
			}
		}
	} finally {
		await judge?.close();
	}
	fs.writeFileSync(reportFile, JSON.stringify(report, null, 1) + '\n');
	if (bad) process.exit(1);
}
