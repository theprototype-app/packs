// lod: the packs' OFFLINE level-of-detail step (contract P1, roadmap 33).
//
// For every item of the given packs it writes, next to the item's LOD0 GLB,
//   <name>.lod1.glb   ~50 % of LOD0's triangles      textures at 1/4 per side
//   <name>.lod2.glb   ~20 % of LOD0's triangles      textures at 1/8 per side
// and puts the P1 field into the pack's model list (default.json):
//   "lods": [{"file": "<name>.lod1.glb", "ratio": 0.5}, {"file": "<name>.lod2.glb", "ratio": 0.2}]
// where `ratio` is the MEASURED triangle fraction of LOD0 (rounded to 0.01).
//
// HOW A LEVEL IS MADE: a copy of LOD0, simplified PER PRIMITIVE IN PLACE with meshoptimizer
// (gltf-transform's weld + simplifyPrimitive). Nothing is joined or flattened: node names,
// hierarchy, node transforms, skins, morph targets and animations stay exactly as in LOD0
// (core's loader swaps geometry per node BY NAME and draws every level with LOD0's material,
// and the animated kit's doors/lids keep their clips). Surviving vertices keep their own
// normals/UVs — nothing is recomputed, so lighting does not pop between levels. meshopt
// keeps UV seams consistent. Every level then goes through `defight` (a collapse can fold
// two triangles into one plane) and is checked for coplanar overlaps.
//
// Items under the size floor are SKIPPED and recorded (no `lods` field: core's auto LOD and
// "nothing to take away" cover them): 500 triangles for the Meshy packs, 2000 for the
// non-Meshy `default` / `cube_diorama` packs. A primitive under 64 triangles inside a big
// item is kept whole (a hinge pin's 12 triangles are not worth a level).
//
//   node tools/lod/lod.mjs <pack> [<pack> …]            build/refresh levels + rows
//   node tools/lod/lod.mjs --check <pack> …             verify only (exit 1 on a problem)
//   options: --min-tris N (override the floor) · --ratios 0.5,0.2 · --dry-run
// Re-runnable: it always rebuilds from LOD0 (never from an older level) and rewrites the rows.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { defightDoc } from './defight.mjs';
import { coplanarOverlaps, triangles } from './coplanar.mjs';
import { Judge } from './judge.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const req = createRequire(path.join(ROOT, 'tools/meshy/package.json'));
const load = async (/** @type {string} */ id) => import(pathToFileURL(req.resolve(id)).href);
const { NodeIO } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS } = await load('@gltf-transform/extensions');
const { weld, compactPrimitive, prune, getBounds } = await load('@gltf-transform/functions');
const { MeshoptSimplifier } = await load('meshoptimizer');
const sharp = (await load('sharp')).default;

export const FLOOR = { default: 2000, cube_diorama: 2000 };
export const MESHY_FLOOR = 500;
export const MIN_PRIM_TRIS = 64;
/** a level is kept only at <= this share of the level before it (= core lodCore's 0.8) */
export const KEEP_BELOW = 0.8;
/** per level: target ratio, the meshopt error caps to try (fraction of the mesh extent,
 * ascending), the size it is judged at (px on a 720 px viewport — where core first shows
 * it) and the texture divisor of the level file. The coarsest cap the visual judge accepts
 * wins: a level must not POP (mean colour change over the object <= MAX_MEAN). */
export const LEVELS = [
	{ ratio: 0.5, caps: [0.01, 0.02, 0.03, 0.04], seenAt: 180, tex: 4, wNormal: 0.25, wUv: 0.5 },
	{ ratio: 0.2, caps: [0.02, 0.04, 0.06, 0.08, 0.1], seenAt: 72, tex: 8, wNormal: 0.25, wUv: 0.5 }
];
/** the judge's limit: mean |ΔRGBA| per object pixel (0..1020). Calibrated by eye on the
 * architecture kit: accepted levels read 1-29, the visibly broken ones 45-112. */
export const MAX_MEAN = 30;
// attribute weights (per level): normals keep the shading (no lighting pop), UVs keep the
// texture — the permissive level weighs UVs heavily so a seam only goes where it costs nothing

const io = () => new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** triangles a document draws (TRIANGLES mode) */
export function trisOf(doc) {
	let n = 0;
	for (const mesh of doc.getRoot().listMeshes())
		for (const prim of mesh.listPrimitives()) {
			if (prim.getMode() !== 4) continue;
			const idx = prim.getIndices();
			n += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
		}
	return Math.round(n);
}

/** what a level must keep from LOD0: the node tree by name + the animation channels */
export function skeletonOf(doc) {
	const root = doc.getRoot();
	// 5 significant digits: a matrix written by another exporter comes back as TRS with float noise
	const f = (/** @type {number[]} */ v) => v.map((x) => +x.toPrecision(5)).join(',');
	return {
		nodes: root.listNodes().map((n) => `${n.getName()}|${n.listChildren().map((c) => c.getName()).join(',')}|${f(n.getTranslation())}|${f(n.getRotation())}|${f(n.getScale())}|${n.getMesh() ? 'm' : ''}|${n.getSkin() ? 's' : ''}`),
		animations: root.listAnimations().map((a) => `${a.getName()}:${a.listChannels().map((c) => `${c.getTargetNode()?.getName()}.${c.getTargetPath()}`).join(',')}`)
	};
}

/**
 * Simplify every primitive of `doc` in place toward `level.ratio` of its triangles, with
 * meshopt's attribute-aware simplifier (positions + normals + UV0). Indices change, the
 * vertex set is compacted (every attribute, skin and morph target follows), nothing else.
 * @param {any} doc @param {{ratio: number, error: number, permissive?: boolean, wNormal?: number, wUv?: number}} level
 */
export async function simplifyDoc(doc, level) {
	await MeshoptSimplifier.ready;
	await doc.transform(weld());
	for (const mesh of doc.getRoot().listMeshes()) {
		for (const prim of mesh.listPrimitives()) {
			if (prim.getMode() !== 4 || !prim.getIndices()) continue;
			const src = prim.getIndices();
			if (src.getCount() / 3 < MIN_PRIM_TRIS) continue;
			const pos = prim.getAttribute('POSITION');
			const nrm = prim.getAttribute('NORMAL');
			const uv = prim.getAttribute('TEXCOORD_0');
			const n = pos.getCount();
			const P = new Float32Array(n * 3);
			const A = new Float32Array(n * 5);
			const v = [0, 0, 0];
			for (let i = 0; i < n; i++) {
				pos.getElement(i, v);
				P.set(v, i * 3);
				if (nrm) {
					nrm.getElement(i, v);
					A.set(v, i * 5);
				}
				if (uv) {
					uv.getElement(i, v);
					A[i * 5 + 3] = v[0];
					A[i * 5 + 4] = v[1];
				}
			}
			const wn = nrm ? level.wNormal ?? 0.25 : 0;
			const wu = uv ? level.wUv ?? 0.5 : 0;
			const weights = [wn, wn, wn, wu, wu];
			const target = Math.floor((level.ratio * src.getCount()) / 3) * 3;
			const [dst] = MeshoptSimplifier.simplifyWithAttributes(
				new Uint32Array(src.getArray()),
				P,
				3,
				A,
				5,
				weights,
				null,
				target,
				level.error,
				[...(level.permissive ? ['Permissive'] : []), ...(level.prune ? ['Prune'] : [])]
			);
			prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(n <= 65535 ? new Uint16Array(dst) : dst).setBuffer(src.getBuffer()));
			if (src.listParents().length === 1) src.dispose();
			compactPrimitive(prim);
		}
	}
}

/** shrink every texture by `div` per side (≥ 32 px), same format */
export async function shrinkTextures(doc, div) {
	for (const tex of doc.getRoot().listTextures()) {
		const img = tex.getImage();
		if (!img) continue;
		const s = sharp(Buffer.from(img));
		const meta = await s.metadata();
		if (!meta.width) continue;
		const w = Math.max(32, Math.round(meta.width / div));
		const h = Math.max(32, Math.round((meta.height ?? meta.width) / div));
		const mime = tex.getMimeType();
		let out = s.resize(w, h, { fit: 'fill' });
		out = mime === 'image/png' ? out.png({ compressionLevel: 9 }) : mime === 'image/webp' ? out.webp({ quality: 80 }) : out.jpeg({ quality: 80 });
		tex.setImage(new Uint8Array(await out.toBuffer()));
	}
}

/**
 * Build the levels of one LOD0 file. Returns per level {file, tris, ratio, bytes, pairs}.
 * @param {string} lod0 absolute path @param {{dryRun?: boolean}} [o]
 */
export async function buildLevels(lod0, o = {}) {
	const reader = io();
	const src = await reader.read(lod0);
	const base = path.basename(lod0).replace(/\.glb$/i, '');
	const t0 = trisOf(src);
	const skel = JSON.stringify(skeletonOf(src));
	const box0 = getBounds(src.getRoot().getDefaultScene() ?? src.getRoot().listScenes()[0]);
	const out = [];
	const dropped = [];
	let prev = t0;
	const bytes0 = fs.readFileSync(lod0);
	for (let i = 0; i < LEVELS.length; i++) {
		const L = LEVELS[i];
		// always from LOD0 (never from the level before); the coarsest cap the judge accepts
		let doc = null;
		let tris = Infinity;
		let judged = null;
		for (const cap of L.caps) {
			const d = await reader.read(lod0);
			await simplifyDoc(d, { ...L, error: cap });
			const t = trisOf(d);
			if (t >= tris) continue; // this cap took nothing more away
			const verdict = o.judge ? await o.judge.compare(bytes0, await reader.writeBinary(d), L.seenAt) : { mean: 0 };
			if (verdict.mean > MAX_MEAN) break;
			doc = d;
			tris = t;
			judged = { cap, mean: +verdict.mean.toFixed(1) };
			if (t <= t0 * L.ratio) break; // reached the target
		}
		if (!doc || tris > prev * KEEP_BELOW) {
			dropped.push({ level: i + 1, tris: Number.isFinite(tris) ? tris : t0, ratio: Number.isFinite(tris) ? Math.round((tris / t0) * 100) / 100 : 1, ...(judged ?? {}) });
			continue;
		}
		prev = tris;
		const fight = await defightDoc(doc);
		if (!process.env.LOD_FULL_TEXTURES) await shrinkTextures(doc, L.tex);
		await doc.transform(prune({ keepLeaves: true, keepAttributes: true }));
		const kept = JSON.stringify(skeletonOf(doc));
		if (kept !== skel) throw new Error(`${base} level ${i + 1}: node tree / animations changed`);
		const file = `${base}.lod${out.length + 1}.glb`;
		const dst = path.join(path.dirname(lod0), file);
		const bytes = await reader.writeBinary(doc);
		if (!o.dryRun) fs.writeFileSync(dst, bytes);
		const box = getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]);
		const grow = Math.max(...[0, 1, 2].map((k) => Math.max(box.max[k] - box0.max[k], box0.min[k] - box.min[k])));
		const pairs = coplanarOverlaps(triangles(doc)).pairs;
		out.push({ file, tris: trisOf(doc), ratio: Math.round((trisOf(doc) / t0) * 100) / 100, bytes: bytes.byteLength, pairs, defight: fight.dropped + fight.pushed, grow: +grow.toFixed(4), ...judged });
	}
	if (!o.dryRun)
		for (const f of fs.readdirSync(path.dirname(lod0)))
			if (f.startsWith(base + '.lod') && /\.lod\d+\.glb$/.test(f) && !out.some((l) => l.file === f)) fs.rmSync(path.join(path.dirname(lod0), f));
	return { tris: t0, levels: out, dropped };
}

const listPath = (pack) => path.join(ROOT, pack, 'default.json');
const readList = (pack) => JSON.parse(fs.readFileSync(listPath(pack), 'utf8'));
const lod0Of = (pack, row) => path.join(ROOT, pack, row.name, 'glTF-Binary', row.variants['glTF-Binary']);
const isLocal = (row) => row?.variants?.['glTF-Binary'] && !/^https?:/.test(row.variants['glTF-Binary']);
export const floorFor = (pack, override) => (Number.isFinite(override) ? override : FLOOR[pack] ?? MESHY_FLOOR);

/** build every pack; returns the report and rewrites each pack's default.json */
export async function run(packs, o = {}) {
	const judge = o.noJudge ? null : await new Judge().open();
	try {
		return await runWith(packs, { ...o, judge });
	} finally {
		await judge?.close();
	}
}

async function runWith(packs, o) {
	const report = {};
	for (const pack of packs) {
		const list = readList(pack);
		const floor = floorFor(pack, o.minTris);
		const items = [];
		for (const row of list) {
			if (!isLocal(row)) continue;
			const lod0 = lod0Of(pack, row);
			const doc = await io().read(lod0);
			const tris = trisOf(doc);
			if (tris < floor) {
				delete row.lods;
				for (const f of fs.readdirSync(path.dirname(lod0))) if (/\.lod\d+\.glb$/.test(f) && !o.dryRun) fs.rmSync(path.join(path.dirname(lod0), f));
				items.push({ name: row.name, tris, skipped: `under ${floor} triangles` });
				continue;
			}
			const r = await buildLevels(lod0, o);
			if (r.levels.length) row.lods = r.levels.map((l) => ({ file: l.file, ratio: l.ratio }));
			else delete row.lods;
			const why = r.levels.length ? undefined : `no level reaches <= ${KEEP_BELOW * 100} % within the error caps (best ${r.dropped.map((d) => d.ratio).join(' / ')})`;
			items.push({ name: row.name, tris, levels: r.levels, ...(r.dropped.length ? { droppedLevels: r.dropped } : {}), ...(why ? { skipped: why } : {}) });
			console.log(`${pack}/${row.name}: ${tris} → ${r.levels.map((l) => `${l.tris} (${l.ratio}, ${(l.bytes / 1024).toFixed(0)} KB${l.pairs ? `, ${l.pairs} coplanar!` : ''})`).join(' → ') || 'no level: ' + why}`);
		}
		if (!o.dryRun) fs.writeFileSync(listPath(pack), JSON.stringify(list, null, 2) + '\n');
		report[pack] = { floor, items };
	}
	return report;
}

/** --check: every row over the floor has its levels on disk, sane ratios, same node tree */
export async function check(packs, o = {}) {
	const problems = [];
	for (const pack of packs) {
		const floor = floorFor(pack, o.minTris);
		for (const row of readList(pack)) {
			if (!isLocal(row)) continue;
			const lod0 = lod0Of(pack, row);
			const src = await io().read(lod0);
			const t0 = trisOf(src);
			if (t0 < floor) {
				if (row.lods) problems.push(`${pack}/${row.name}: under the floor but has lods`);
				continue;
			}
			if (!row.lods) continue; // the report says why (no level worth keeping)
			if (!Array.isArray(row.lods) || !row.lods.length || row.lods.length > LEVELS.length) {
				problems.push(`${pack}/${row.name}: malformed lods field`);
				continue;
			}
			const skel = JSON.stringify(skeletonOf(src));
			let prev = 1;
			for (const l of row.lods) {
				const f = path.join(path.dirname(lod0), l.file);
				if (!fs.existsSync(f)) {
					problems.push(`${pack}/${row.name}: ${l.file} missing`);
					continue;
				}
				const d = await io().read(f);
				const t = trisOf(d);
				const ratio = Math.round((t / t0) * 100) / 100;
				if (Math.abs(ratio - l.ratio) > 0.011) problems.push(`${pack}/${row.name}: ${l.file} ratio ${ratio} ≠ ${l.ratio}`);
				if (!(l.ratio <= prev * KEEP_BELOW + 0.011)) problems.push(`${pack}/${row.name}: ${l.file} not <= ${KEEP_BELOW} of the level before`);
				prev = l.ratio;
				if (JSON.stringify(skeletonOf(d)) !== skel) problems.push(`${pack}/${row.name}: ${l.file} node tree differs from LOD0`);
				if (fs.statSync(f).size > 2 * 1024 * 1024) problems.push(`${pack}/${row.name}: ${l.file} over 2 MB`);
			}
		}
	}
	return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const args = process.argv.slice(2);
	const o = { dryRun: false, minTris: NaN, check: false, noJudge: false };
	const packs = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--dry-run') o.dryRun = true;
		else if (args[i] === '--check') o.check = true;
		else if (args[i] === '--min-tris') o.minTris = Number(args[++i]);
		else if (args[i] === '--no-judge') o.noJudge = true;
		else if (args[i] === '--ratios') args[++i].split(',').map(Number).forEach((r, k) => LEVELS[k] && (LEVELS[k].ratio = r));
		else packs.push(args[i].replace(/\/$/, ''));
	}
	if (!packs.length) {
		console.error('usage: node tools/lod/lod.mjs [--check] [--dry-run] [--min-tris N] [--ratios 0.5,0.2] <pack> [<pack> …]');
		process.exit(2);
	}
	if (o.check) {
		const problems = await check(packs, o);
		for (const p of problems) console.log('FAIL ' + p);
		console.log(problems.length ? `${problems.length} problems` : `lods OK: ${packs.join(', ')}`);
		process.exit(problems.length ? 1 : 0);
	}
	const report = await run(packs, o);
	const file = path.join(ROOT, 'tools/lod/report.json');
	const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
	if (!o.dryRun) fs.writeFileSync(file, JSON.stringify({ ...all, ...report }, null, 1) + '\n');
}
