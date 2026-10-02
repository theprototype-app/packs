// Build the interior-kit pack from items.mjs: every Meshy source is post-processed by the
// shared tools/meshy meshy-post (weld, simplify to budget, scale to metres, pivot,
// 1024² JPEG) — raw Meshy output is never shipped — procedural pieces are generated,
// kitbashes are assembled from finished items, then each item gets
// <Name>/glTF-Binary/<file>.glb + <Name>/thumb.webp and the pack's default.json is
// rewritten. Forked from props-kit/_src/build.mjs; what is new here:
//   - WALL-LINE pivot: wall-standing pieces are posted with their back face at z = 0, then
//     shifted +0.125 m so the origin sits on the architecture kit's wall grid line;
//   - a `colliderHint` (core colliderSpec) in each GLB's scene extras, which GLTFLoader
//     copies into the placed object's userData;
//   - kitbash sets are generic ([item, x, z, yaw] lists in items.mjs).
//
//   node build.mjs [--only A,B] [--no-shots]      (MESHY_TOOLS / MESHY_STAGING override paths)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEMS, pivotOf } from './items.mjs';
import { PIECES, WALL_FACE } from './procedural.mjs';

// the shared pack tooling (roadmap 34 E2: tools/kit-build instead of a fork per kit) — gltf-transform
// comes through its loader, so the Documents here and its helpers are ONE module instance
const { TOOLS, load, tool } = await import('../../tools/kit-build/lib/deps.mjs');
const { gradeLinear: grade, inpaintBlack, repairNormals, flatForSync } = await import('../../tools/kit-build/lib/post.mjs');
const STAGING = process.env.MESHY_STAGING ?? path.join(os.homedir(), '.code/lanes-30/meshy/staging');
const REQUESTER = '33-pack-interior';
const { postProcess } = await tool('lib/post.js');
const { renderThumbs } = await tool('lib/thumb.js');
const { NodeIO } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS } = await load('@gltf-transform/extensions');
const { mergeDocuments, dedup, prune, getBounds, unpartition, flatten, transformMesh, join, simplify, weld } = await load('@gltf-transform/functions');
const { MeshoptSimplifier } = await load('meshoptimizer');

// 33-pack-fix-lod's defight (tools/lod): settles coplanar layers in Meshy meshes — their materials
// are double-sided, so even OPPOSITE-facing coplanar layers flicker.
const { defightFile } = await import('../../tools/lod/defight.mjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.resolve(HERE, '..');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const shots = !args.includes('--no-shots');

export const fileOf = (name) => `${name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}.glb`;
export const glbOf = (name) => path.join(PACK, name, 'glTF-Binary', fileOf(name));

/** the newest `<stage>-<n>/raw.glb` of a Meshy job */
function meshyRaw(id, stage) {
	const dir = path.join(STAGING, REQUESTER, id);
	const runs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((d) => d.startsWith(`${stage}-`) && fs.existsSync(path.join(dir, d, 'raw.glb'))) : [];
	runs.sort((a, b) => Number(b.split('-').pop()) - Number(a.split('-').pop()));
	if (!runs.length) throw new Error(`no ${stage} raw.glb for ${REQUESTER}/${id}`);
	return path.join(dir, runs[0], 'raw.glb');
}

const sceneOf = (doc) => doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
function sizeOf(doc) {
	const b = getBounds(sceneOf(doc));
	return { min: b.min, max: b.max, size: [0, 1, 2].map((i) => b.max[i] - b.min[i]) };
}

async function buildMeshy(item, raw, out) {
	const { wallLine, ...post } = item.post;
	const report = await postProcess(raw, out, { ...post, pivot: post.pivot ?? 'bottom-center' });
	let inpainted = 0;
	let normals = { zero: 0, flipped: 0 };
	{
		const doc = await io.read(out);
		if (item.inpaint) inpainted = await inpaintBlack(doc);
		normals = repairNormals(doc);
		if (item.grade) await grade(doc, item.grade);
		// WALL-LINE: the back face (z = 0 after 'bottom-center-back') moves onto the wall's face
		if (wallLine) for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, WALL_FACE, 1]);
		await io.write(out, doc);
	}
	const fight = await defightFile(out);
	return { source: path.relative(STAGING, raw), trisIn: report.trisIn, ...(fight && fight.before ? { defight: { pairs: fight.before, dropped: fight.dropped, pushed: fight.pushed } } : {}), ...(item.grade ? { grade: item.grade.mul } : {}), ...(inpainted ? { inpainted } : {}), ...(normals.zero || normals.flipped ? { normalsRepaired: normals } : {}) };
}

/** Kitbash: finished item GLBs placed at [x, z] with a yaw, merged into one document */
async function kitbash(list, out, maxTris = 7500) {
	const [first, ...rest] = list;
	const doc = await io.read(glbOf(first[0]));
	const root = doc.getRoot();
	const scene = sceneOf(doc);
	const yawQ = (deg) => [0, Math.sin((deg * Math.PI) / 360), 0, Math.cos((deg * Math.PI) / 360)];
	const head = doc.createNode(first[0]).setTranslation([first[1], 0, first[2]]).setRotation(yawQ(first[3]));
	for (const n of scene.listChildren()) {
		scene.removeChild(n);
		head.addChild(n);
	}
	scene.addChild(head);
	for (const [name, x, z, yaw] of rest) {
		const src = await io.read(glbOf(name));
		const map = mergeDocuments(doc, src);
		const holder = doc.createNode(name).setTranslation([x, 0, z]).setRotation(yawQ(yaw));
		for (const n of sceneOf(src).listChildren()) holder.addChild(map.get(n));
		scene.addChild(holder);
		for (const s of root.listScenes()) if (s !== scene) s.dispose();
	}
	// one draw call per material: flatten, then join the pieces that share one (4 stools → 1)
	await doc.transform(flatten(), dedup());
	for (const n of root.listNodes()) if (!n.getMesh() && !n.listChildren().length) n.dispose();
	await doc.transform(join({ keepNamed: false }), prune());
	// …and keep the set inside the props budget (a set is several props in one GLB)
	const tris = () => root.listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + p.getIndices().getCount() / 3, 0), 0);
	const before = tris();
	if (before > maxTris) {
		await MeshoptSimplifier.ready;
		await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: maxTris / before, error: 0.01, lockBorder: false }));
	}
	// join keeps the first member's node transform (a stool turned 80°): bake every mesh
	// node to identity so the GLB's bounds are its real, axis-aligned extent
	for (const n of sceneOf(doc).listChildren()) {
		const mesh = n.getMesh();
		if (!mesh) continue;
		transformMesh(mesh, n.getMatrix());
		n.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
	}
	await doc.transform(unpartition(), prune());
	await io.write(out, doc);
	return { source: `kitbash: ${list.map((l) => l[0]).join(' + ')}`, trisIn: before };
}

const tag = (doc, item) => {
	const scene = sceneOf(doc);
	scene.setName(item.name);
	// GLTFLoader copies scene extras into the placed root's userData (core colliderSpec reads colliderHint)
	scene.setExtras({ ...(scene.getExtras() ?? {}), colliderHint: item.collider, interiorKit: { pivot: pivotOf(item), tags: item.tags } });
};

const report = {};
const reportFile = path.join(HERE, 'build-report.json');
const prev = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : {};
// kitbashes read other items' GLBs: build them last
const order = [...ITEMS.filter((i) => !i.src.kitbash), ...ITEMS.filter((i) => i.src.kitbash)];
for (const item of order) {
	if (only && !only.includes(item.name)) {
		if (prev[item.name]) report[item.name] = prev[item.name];
		continue;
	}
	const out = glbOf(item.name);
	fs.mkdirSync(path.dirname(out), { recursive: true });
	let meta;
	if (item.src.meshy) meta = await buildMeshy(item, meshyRaw(item.src.meshy, item.src.stage), out);
	else if (item.src.proc) {
		await (await PIECES[item.src.proc]()).write(out);
		meta = { source: 'procedural.mjs' };
	} else meta = await kitbash(item.src.kitbash, out);
	{
		const flat = await io.read(out);
		await flatForSync(flat);
		tag(flat, item);
		await io.write(out, flat);
	}
	const doc = await io.read(out);
	const b = sizeOf(doc);
	let tris = 0;
	// per NODE, not per mesh: a kitbash instances one mesh several times
	for (const n of doc.getRoot().listNodes()) for (const p of n.getMesh()?.listPrimitives() ?? []) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
	const tex = doc.getRoot().listTextures().map((t) => t.getSize()?.join('×'));
	const nested = doc.getRoot().listNodes().filter((n) => !sceneOf(doc).listChildren().includes(n)).length;
	const multi = doc.getRoot().listMeshes().filter((m) => m.listPrimitives().length > 1).length;
	if (nested || multi) throw new Error(`${item.name}: not flat for sync (${nested} nested nodes, ${multi} multi-primitive meshes)`);
	report[item.name] = {
		label: item.label,
		file: path.relative(PACK, out),
		bytes: fs.statSync(out).size,
		tris: Math.round(tris),
		meshes: sceneOf(doc).listChildren().length,
		size: b.size.map((v) => +v.toFixed(3)),
		min: b.min.map((v) => +v.toFixed(3)),
		max: b.max.map((v) => +v.toFixed(3)),
		textures: tex,
		pivot: pivotOf(item),
		collider: item.collider,
		tags: item.tags,
		...meta
	};
	const r = report[item.name];
	console.log(`${item.name.padEnd(16)} ${String(r.tris).padStart(6)}t ${String(r.meshes).padStart(2)}m ${(r.bytes / 1024).toFixed(0).padStart(5)} KB  ${r.size.join(' × ')} m  min ${r.min.join(',')}`);
	if (r.bytes > 5 * 1024 * 1024) throw new Error(`${item.name} is over the 5 MB share cap`);
}

if (shots) {
	const todo = ITEMS.filter((i) => !only || only.includes(i.name)).map((i) => ({ glb: glbOf(i.name), out: path.join(PACK, i.name, 'thumb.webp') }));
	await renderThumbs(todo, { size: 512, bg: null, yaw: 35 });
}

fs.writeFileSync(reportFile, JSON.stringify(report, null, 1) + '\n');
const list = ITEMS.map((i) => ({ name: i.name, screenshot: 'thumb.webp', label: i.label, variants: { 'glTF-Binary': fileOf(i.name) } }));
fs.writeFileSync(path.join(PACK, 'default.json'), JSON.stringify(list, null, 2) + '\n');
console.log(`default.json: ${list.length} items`);
