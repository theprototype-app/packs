// defight: remove z-fighting from a GLB without touching how it looks.
//
// Z-fighting = two triangles in the SAME plane covering the SAME area. The depth buffer
// cannot order them, so which one wins changes with every sub-pixel camera move — the
// surface shimmers "only when moving around". Meshy meshes get there two ways: the
// architecture kit's seam clamp flattens every vertex within 4 cm of a bbox face ONTO it,
// folding bevels and relief into a pile of coplanar layers (the Block's sides were ~2
// layers deep); and Meshy itself sometimes ships doubled shells / folded slivers.
//
// For every cluster of coplanar triangles (same plane within `tol`; facing either way when
// the material is double-sided, since then both faces draw):
//   - triangles are taken largest first; the first layer is the surface you see;
//   - a triangle (almost) fully covered by that surface layer is a hidden duplicate: DROPPED;
//   - one that overlaps it only in part goes to the first deeper LAYER where it overlaps
//     nothing, and is pushed `depth` × layer behind the surface (2.5 mm by default — below
//     anything visible on a stone face, above the depth buffer's resolution at 60 m with a
//     0.1 m near plane), with its own vertices so the surface layer is untouched.
// Vertex attributes (UVs, normals, colours, skin weights) are kept per vertex; node names,
// hierarchy, materials and animations are untouched (the edit is per primitive, in place).
//
//   node tools/lod/defight.mjs in.glb [out.glb]   (out defaults to in: rewrite in place)
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { area2, clip, coplanarOverlaps, coplanarPair, flipNormal, triangles } from './coplanar.mjs';

const TOOLS = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../meshy');
const req = createRequire(path.join(TOOLS, 'package.json'));
const load = async (/** @type {string} */ id) => import(pathToFileURL(req.resolve(id)).href);
const { NodeIO } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS } = await load('@gltf-transform/extensions');
const { unweld, weld, prune } = await load('@gltf-transform/functions');

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
	const l = Math.hypot(a[0], a[1], a[2]);
	return [a[0] / l, a[1] / l, a[2] / l];
};

const ccw = (p) => (area2(p) < 0 ? p.slice().reverse() : p);
function overlap(pa, pb) {
	const o = clip(pa, pb);
	return o.length >= 3 ? Math.abs(area2(o)) : 0;
}
/** 2D bounding boxes for a cheap reject */
const box2 = (p) => [Math.min(p[0][0], p[1][0], p[2][0]), Math.min(p[0][1], p[1][1], p[2][1]), Math.max(p[0][0], p[1][0], p[2][0]), Math.max(p[0][1], p[1][1], p[2][1])];
const boxHit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * Layer every coplanar cluster of `tris` (world-space triangles from coplanar.triangles,
 * each with .prim and .index into that primitive's NON-indexed vertex list).
 * @returns {{drop: Set<any>, push: Map<any, number[]>, clusters: number, dropped: number, pushed: number}}
 *   drop: tris to delete; push: tri → world offset vector
 */
export function planLayers(tris, o = {}) {
	const tol = o.tol ?? 0.001;
	const depth = o.depth ?? 0.0025;
	const covered = o.covered ?? 0.9995;
	const minArea = o.minArea ?? 1e-6; // = the probe's floor: a mm², not micro-slivers
	// canonical plane: normal flipped into one hemisphere so double-sided opposite faces meet
	const canon = (t) => {
		const n = t.n;
		// opposite faces only meet when the material draws both (a single-sided back face
		// is culled from every viewpoint where the front one shows)
		const flip = t.double ? flipNormal(n) : false;
		return flip ? { n: n.map((x) => -x), d: -t.d, s: -1 } : { n, d: t.d, s: 1 };
	};
	// the middle of everything: "inside" for a solid piece
	const lo = [Infinity, Infinity, Infinity];
	const hi = [-Infinity, -Infinity, -Infinity];
	for (const t of tris)
		for (const p of [t.a, t.b, t.c])
			for (let k = 0; k < 3; k++) {
				lo[k] = Math.min(lo[k], p[k]);
				hi[k] = Math.max(hi[k], p[k]);
			}
	const centre = o.centre ?? [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
	const buckets = new Map();
	for (const t of tris) {
		const c = canon(t);
		t._c = c;
		const k = c.n.map((x) => Math.round(x * 20)).join(',');
		if (!buckets.has(k)) buckets.set(k, []);
		buckets.get(k).push(t);
	}
	const drop = new Set();
	const push = new Map();
	let clusters = 0;
	for (const list of buckets.values()) {
		list.sort((a, b) => a._c.d - b._c.d);
		// split the bucket into runs of the same plane (chained within tol)
		let start = 0;
		for (let i = 1; i <= list.length; i++) {
			if (i < list.length && list[i]._c.d - list[i - 1]._c.d < tol) continue;
			const run = list.slice(start, i);
			start = i;
			if (run.length < 2) continue;
			const groups = groupRun(run, tol);
			for (const g of groups) if (g.length > 1 && layerCluster(g, { depth, covered, minArea, drop, push, centre })) clusters++;
		}
	}
	return { drop, push, clusters, dropped: drop.size, pushed: push.size };
}

/** a run of near-equal d may still mix tilted planes: union two triangles when their normals
 * agree within 1° and either one's corners all lie within `tol` of the other's plane (a
 * slightly tilted member must not split one plane in two) */
function groupRun(run, tol) {
	const cos = Math.cos(Math.PI / 180);
	const parent = run.map((_, i) => i);
	const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
	for (let i = 0; i < run.length; i++)
		for (let j = i + 1; j < run.length; j++) {
			const s = run[i];
			const t = run[j];
			if (coplanarPair(s._c.n, s._c.d, s, t._c.n, t._c.d, t, tol, cos)) parent[find(j)] = find(i);
		}
	const groups = new Map();
	run.forEach((t, i) => {
		const r = find(i);
		if (!groups.has(r)) groups.set(r, []);
		groups.get(r).push(t);
	});
	return [...groups.values()];
}

function layerCluster(group, { depth, covered, minArea, drop, push, centre }) {
	const n = group[0]._c.n;
	const ax = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
	const u = norm(cross(n, ax));
	const v = cross(n, u);
	for (const t of group) {
		t._p = ccw([t.a, t.b, t.c].map((p) => [dot(p, u), dot(p, v)]));
		t._b = box2(t._p);
	}
	// does anything in this cluster overlap at all? (most clusters are a tiled flat face)
	let any = false;
	for (let i = 0; i < group.length && !any; i++)
		for (let j = i + 1; j < group.length; j++)
			if (boxHit(group[i]._b, group[j]._b) && overlap(group[i]._p, group[j]._p) > minArea) {
				any = true;
				break;
			}
	if (!any) return false;
	// the surface's outward side is AWAY from the piece's middle: a deeper layer moves
	// toward the inside, so it can never poke past the bbox a modular joint relies on
	const d0 = group[0]._c.d;
	const outward = dot(n, centre) <= d0 ? n : n.map((x) => -x);
	const sorted = group.slice().sort((a, b) => b.area - a.area);
	/** @type {any[][]} */
	const layers = [[]];
	for (const t of sorted) {
		// hidden behind the surface layer entirely? (layer 0 never overlaps itself, so the
		// sum of pairwise overlaps is the exact covered area)
		let cov = 0;
		for (const s of layers[0]) if (boxHit(s._b, t._b)) cov += overlap(t._p, s._p);
		// drop only when what stays uncovered is below a fifth of a mm² — never a pinhole
		if (layers[0].length && (cov >= t.area * covered || t.area - cov < 2e-7)) {
			drop.add(t);
			continue;
		}
		let L = 0;
		for (; L < layers.length; L++) {
			let hit = false;
			for (const s of layers[L])
				if (boxHit(s._b, t._b) && overlap(t._p, s._p) > minArea) {
					hit = true;
					break;
				}
			if (!hit) break;
		}
		if (L === layers.length) layers.push([]);
		layers[L].push(t);
		if (L > 0) push.set(t, outward.map((x) => -x * depth * L));
	}
	return true;
}

/**
 * Defight a document in place. @param {any} doc @param {{tol?: number, depth?: number}} [o]
 */
export const MAX_PASSES = 12;

export async function defightDoc(doc, o = {}) {
	// a pushed layer can land in another plane's band; a second pass settles it
	const total = { clusters: 0, dropped: 0, pushed: 0, passes: 0 };
	let centre = null;
	for (let pass = 0; pass < (o.passes ?? MAX_PASSES); pass++) {
		if (!centre) {
			const t0 = triangles(doc);
			const lo = [Infinity, Infinity, Infinity];
			const hi = [-Infinity, -Infinity, -Infinity];
			for (const t of t0) for (const p of [t.a, t.b, t.c]) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], p[k])), (hi[k] = Math.max(hi[k], p[k]));
			centre = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
		}
		const r = await defightPass(doc, { ...o, centre });
		total.passes++;
		total.clusters += r.clusters;
		total.dropped += r.dropped;
		total.pushed += r.pushed;
		if (!r.dropped && !r.pushed) break;
	}
	return total;
}

async function defightPass(doc, o = {}) {
	await doc.transform(unweld());
	const tris = triangles(doc, { keepRefs: true });
	const plan = planLayers(tris, o);
	if (!plan.dropped && !plan.pushed) {
		await doc.transform(weld());
		return { ...plan, drop: undefined, push: undefined };
	}
	// per primitive: move pushed triangles' (now unshared) vertices, delete dropped ones
	/** @type {Map<any, {drop: Set<number>, push: Map<number, number[]>, inv: number[]}>} */
	const per = new Map();
	for (const t of tris) {
		if (!plan.drop.has(t) && !plan.push.has(t)) continue;
		if (!per.has(t.primRef)) per.set(t.primRef, { drop: new Set(), push: new Map(), inv: t.invLinear });
		const e = per.get(t.primRef);
		if (plan.drop.has(t)) e.drop.add(t.first);
		else e.push.set(t.first, plan.push.get(t));
	}
	for (const [prim, e] of per) {
		const pos = prim.getAttribute('POSITION');
		const p = [0, 0, 0];
		// a push along a tilted plane's normal may move a corner past ANOTHER axis's
		// extent: clamp into the primitive's own bounds so the piece's size never changes
		const lo = [Infinity, Infinity, Infinity];
		const hi = [-Infinity, -Infinity, -Infinity];
		for (let i = 0; i < pos.getCount(); i++) {
			pos.getElement(i, p);
			for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], p[k])), (hi[k] = Math.max(hi[k], p[k]));
		}
		for (const [first, w] of e.push) {
			// the world offset back into the primitive's local frame
			const m = e.inv;
			const l = [m[0] * w[0] + m[3] * w[1] + m[6] * w[2], m[1] * w[0] + m[4] * w[1] + m[7] * w[2], m[2] * w[0] + m[5] * w[1] + m[8] * w[2]];
			for (let k = 0; k < 3; k++) {
				pos.getElement(first + k, p);
				pos.setElement(first + k, [0, 1, 2].map((j) => Math.min(hi[j], Math.max(lo[j], p[j] + l[j]))));
			}
		}
		if (e.drop.size) {
			const count = pos.getCount();
			const keep = [];
			for (let i = 0; i < count; i += 3) if (!e.drop.has(i)) keep.push(i, i + 1, i + 2);
			for (const sem of prim.listSemantics()) compact(prim.getAttribute(sem), keep);
			for (const target of prim.listTargets()) for (const sem of target.listSemantics()) compact(target.getAttribute(sem), keep);
		}
	}
	await doc.transform(weld(), prune());
	return { clusters: plan.clusters, dropped: plan.dropped, pushed: plan.pushed };
}

/** keep only the listed vertices of a (non-indexed) accessor */
function compact(acc, keep) {
	const size = acc.getElementSize();
	const src = acc.getArray();
	const dst = new src.constructor(keep.length * size);
	for (let i = 0; i < keep.length; i++) for (let k = 0; k < size; k++) dst[i * size + k] = src[keep[i] * size + k];
	acc.setArray(dst);
}

/** below this much coplanar overlap (m²) a file is left alone: a few pixels at arm's length,
 * and on fine, thin meshes (a cat's ears) a 2.5 mm push lands on the next surface */
export const MIN_FIX_AREA = 1e-4;

export async function defightFile(input, output = input, o = {}) {
	const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
	const doc = await io.read(input);
	const before = coplanarOverlaps(triangles(doc), { doubleSidedOpposite: true });
	const base = { file: input, before: before.pairs, beforeArea: before.area };
	if (before.area < (o.minFixArea ?? MIN_FIX_AREA)) return { ...base, after: before.pairs, afterArea: before.area, dropped: 0, pushed: 0, left: 'under 1 cm² of overlap' };
	const r = await defightDoc(doc, o);
	const after = coplanarOverlaps(triangles(doc), { doubleSidedOpposite: true });
	// a file that did not settle is not written: the edit would be churn, not a fix
	if (r.passes >= (o.passes ?? MAX_PASSES) && (r.dropped || r.pushed) && after.pairs) return { ...base, after: before.pairs, afterArea: before.area, dropped: 0, pushed: 0, left: 'did not converge' };
	if (r.dropped || r.pushed) await io.write(output, doc);
	return { ...base, ...r, after: after.pairs, afterArea: after.area };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [input, output] = process.argv.slice(2);
	if (!input) {
		console.error('usage: defight.mjs in.glb [out.glb]');
		process.exit(2);
	}
	console.log(JSON.stringify(await defightFile(input, output ?? input)));
}
