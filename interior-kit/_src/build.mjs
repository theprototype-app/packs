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
import { createRequire } from 'node:module';
import { ITEMS, pivotOf } from './items.mjs';
import { PIECES, WALL_FACE } from './procedural.mjs';

const TOOLS = process.env.MESHY_TOOLS ?? new URL('../../tools/meshy', import.meta.url).pathname;
const STAGING = process.env.MESHY_STAGING ?? path.join(os.homedir(), '.code/lanes-30/meshy/staging');
const REQUESTER = '33-pack-interior';
const { postProcess } = await import(`${TOOLS}/lib/post.js`);
const sharp = createRequire(`${TOOLS}/package.json`)('sharp');
const { renderThumbs } = await import(`${TOOLS}/lib/thumb.js`);
const { NodeIO } = await import(`${TOOLS}/node_modules/@gltf-transform/core/dist/index.js`);
const { ALL_EXTENSIONS } = await import(`${TOOLS}/node_modules/@gltf-transform/extensions/dist/index.js`);
const { mergeDocuments, dedup, prune, getBounds, unpartition, flatten, transformMesh, join, simplify, weld } = await import(`${TOOLS}/node_modules/@gltf-transform/functions/dist/index.js`);
const { MeshoptSimplifier } = await import(`${TOOLS}/node_modules/meshoptimizer/index.js`);

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

/** Colour-grade every base-colour texture: per-channel multiply (+ offset) */
async function grade(doc, { mul, add = [0, 0, 0], only }) {
	for (const mat of doc.getRoot().listMaterials()) {
		const tex = mat.getBaseColorTexture();
		const img = tex?.getImage();
		if (!img) continue;
		if (only === 'teal') {
			// SELECTIVE: only teal-ish texels (green and blue well above red) — a painted cupboard
			// darkens to the pack's deep teal while its marble top and brass stay as they are
			const { data, info } = await sharp(Buffer.from(img)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
			for (let i = 0; i < data.length; i += 3) {
				const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
				const k = Math.min(1, Math.max(0, (Math.min(g, b) - r - 12) / 30)); // soft mask
				if (k <= 0) continue;
				for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * (1 - k + k * mul[c]));
			}
			tex.setImage(await sharp(data, { raw: info }).jpeg({ quality: 86 }).toBuffer()).setMimeType('image/jpeg');
			continue;
		}
		tex.setImage(await sharp(Buffer.from(img)).linear(mul, add).jpeg({ quality: 86 }).toBuffer()).setMimeType('image/jpeg');
	}
}

/** Repair texels Meshy left unpainted (pure black holes in the atlas — the bed's headboard
 * showed one): diffuse the surrounding colour into every near-black texel. 0 credits. */
async function inpaintBlack(doc, { max = 30 } = {}) {
	let fixed = 0;
	for (const mat of doc.getRoot().listMaterials()) {
		const tex = mat.getBaseColorTexture();
		const img = tex?.getImage();
		if (!img) continue;
		const { data, info } = await sharp(Buffer.from(img)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
		const { width: w, height: h } = info;
		const hole = new Uint8Array(w * h);
		let n = 0;
		for (let i = 0; i < w * h; i++) if (Math.max(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]) < max) (hole[i] = 1), n++;
		if (!n) continue;
		// onion-peel: fill hole texels that touch known texels with their neighbours' mean, repeat
		for (let pass = 0; pass < 2048 && n; pass++) {
			const next = [];
			for (let y = 0; y < h; y++)
				for (let x = 0; x < w; x++) {
					const i = y * w + x;
					if (!hole[i]) continue;
					const acc = [0, 0, 0];
					let k = 0;
					for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
						const xx = x + dx;
						const yy = y + dy;
						if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
						const j = yy * w + xx;
						if (hole[j]) continue;
						for (let c = 0; c < 3; c++) acc[c] += data[j * 3 + c];
						k++;
					}
					if (k >= 2) next.push([i, acc.map((v) => Math.round(v / k))]);
				}
			if (!next.length) break;
			for (const [i, col] of next) {
				for (let c = 0; c < 3; c++) data[i * 3 + c] = col[c];
				hole[i] = 0;
				n--;
				fixed++;
			}
		}
		tex.setImage(await sharp(data, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 86 }).toBuffer()).setMimeType('image/jpeg');
	}
	return fixed;
}

/** Repair Meshy's broken vertex normals (every Meshy piece; the bed's headboard rendered a
 * black triangle): (1) a ZERO / NaN normal (Meshy ships a few) shades black — it takes the
 * area-weighted mean of its triangles' face normals; (2) a triangle whose vertex normals
 * point AGAINST its winding renders dark under the double-sided material — it gets its own
 * vertices carrying its face normal. Returns { zero, flipped }. */
function repairNormals(doc) {
	let fixed = 0;
	let zero = 0;
	for (const mesh of doc.getRoot().listMeshes())
		for (const prim of mesh.listPrimitives()) {
			const names = prim.listSemantics();
			const attrs = names.map((s) => prim.getAttribute(s));
			const P = prim.getAttribute('POSITION');
			const N = prim.getAttribute('NORMAL');
			const I = prim.getIndices();
			if (!N || !I) continue;
			{
				const acc = new Float64Array(N.getCount() * 3);
				const ix = I.getArray();
				for (let t = 0; t < ix.length; t += 3) {
					const [a, b, c] = [ix[t], ix[t + 1], ix[t + 2]].map((i) => P.getElement(i, []));
					const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
					const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
					const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
					for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) acc[ix[t + k] * 3 + j] += n[j];
				}
				for (let i = 0; i < N.getCount(); i++) {
					const n = N.getElement(i, []);
					if (Math.hypot(...n) > 0.5) continue;
					const m = [acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]];
					const l = Math.hypot(...m) || 1;
					N.setElement(i, l > 1e-12 ? m.map((x) => x / l) : [0, 1, 0]);
					zero++;
				}
			}
			const arrays = attrs.map((a) => Array.from(a.getArray()));
			const idx = Array.from(I.getArray());
			for (let t = 0; t < idx.length; t += 3) {
				const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map((i) => P.getElement(i, []));
				const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
				const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
				const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
				const len = Math.hypot(...n);
				if (len < 1e-12) continue;
				let neg = 0;
				for (let k = 0; k < 3; k++) {
					const vn = N.getElement(idx[t + k], []);
					if (vn[0] * n[0] + vn[1] * n[1] + vn[2] * n[2] < 0) neg++;
				}
				if (neg < 2) continue;
				for (let k = 0; k < 3; k++) {
					const src = idx[t + k];
					attrs.forEach((attr, j) => {
						const size = attr.getElementSize();
						const el = names[j] === 'NORMAL' ? n.map((x) => x / len) : attr.getElement(src, []);
						arrays[j].push(...el.slice(0, size));
					});
					idx[t + k] = arrays[names.indexOf('POSITION')].length / 3 - 1;
				}
				fixed++;
			}
			if (!fixed) continue;
			attrs.forEach((attr, j) => attr.setArray(new (attr.getArray().constructor)(arrays[j])));
			I.setArray(new Uint32Array(idx));
		}
	return { zero, flipped: fixed };
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
	return { source: path.relative(STAGING, raw), trisIn: report.trisIn, ...(item.grade ? { grade: item.grade.mul } : {}), ...(inpainted ? { inpainted } : {}), ...(normals.zero || normals.flipped ? { normalsRepaired: normals } : {}) };
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

/**
 * FLAT FOR SYNC (props-kit): every mesh node a direct child of the scene, one primitive per
 * mesh. Core's scene sync sends a nested Group with its WORLD pose and the receiver parents
 * it under the import root, so a nested import lands off by its own offset on peers.
 */
async function flatForSync(doc) {
	await doc.transform(flatten());
	const scene = sceneOf(doc);
	for (const node of [...scene.listChildren()]) {
		const mesh = node.getMesh();
		if (!mesh || mesh.listPrimitives().length < 2) continue;
		mesh.listPrimitives().forEach((prim, i) => {
			const name = `${node.getName()}_${prim.getMaterial()?.getName() || i}`;
			const part = doc.createNode(name).setTranslation(node.getTranslation()).setRotation(node.getRotation()).setScale(node.getScale());
			part.setMesh(doc.createMesh(name).addPrimitive(prim));
			scene.addChild(part);
		});
		node.dispose();
		mesh.dispose();
	}
	await doc.transform(prune());
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
