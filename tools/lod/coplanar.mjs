// coplanar: the static z-fight probe. Finds pairs of triangles in one GLB that lie in the
// same plane (same facing, |Δd| < tol) AND overlap in area — what the depth buffer cannot
// order, so they shimmer as the camera moves.
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const TOOLS = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../meshy');
const req = createRequire(path.join(TOOLS, 'package.json'));
const load = async (id) => import(pathToFileURL(req.resolve(id)).href);
const { NodeIO } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS } = await load('@gltf-transform/extensions');

/** 3x3 inverse of a column-major 4x4's linear part (column-major 3x3 out) */
function invLinear(m) {
	const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
	const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
	const det = a * A + b * B + c * C || 1;
	// rows of the inverse, stored column-major
	const r = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
	return [r[0] / det, r[3] / det, r[6] / det, r[1] / det, r[4] / det, r[7] / det, r[2] / det, r[5] / det, r[8] / det];
}

/** world-space triangles of a doc: [{a,b,c,n,d,mat,double}]; `keepRefs` adds primRef, first
 * (the triangle's first index position) and invLinear (world → local for directions) */
export function triangles(doc, { keepRefs = false } = {}) {
	const out = [];
	const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
	scene.traverse((node) => {
		const mesh = node.getMesh();
		if (!mesh) return;
		const m = node.getWorldMatrix();
		const tf = (v) => [
			m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
			m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
			m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
		];
		const inv = keepRefs ? invLinear(m) : null;
		for (const prim of mesh.listPrimitives()) {
			if (prim.getMode() !== 4) continue;
			const pos = prim.getAttribute('POSITION');
			const idx = prim.getIndices();
			const mat = prim.getMaterial();
			const n = idx ? idx.getCount() : pos.getCount();
			const v = [0, 0, 0];
			const P = [];
			for (let i = 0; i < pos.getCount(); i++) P.push(tf(pos.getElement(i, v)));
			for (let q = 0; q + 2 < n; q += 3) {
				const ia = idx ? idx.getScalar(q) : q, ib = idx ? idx.getScalar(q + 1) : q + 1, ic = idx ? idx.getScalar(q + 2) : q + 2;
				const a = P[ia], b = P[ib], c = P[ic];
				const u = sub(b, a), w = sub(c, a);
				const cr = cross(u, w);
				const len = Math.hypot(...cr);
				if (len < 1e-12) continue;
				const nn = cr.map((x) => x / len);
				const t = { a, b, c, n: nn, d: dot(nn, a), area: len / 2, mat: mat?.getName() ?? '', double: !!mat?.getDoubleSided() };
				if (keepRefs) Object.assign(t, { primRef: prim, first: t0(idx, q), invLinear: inv });
				out.push(t);
			}
		}
	});
	return out;
}
/** the canonical hemisphere: flip so the DOMINANT axis is positive (a sign test on x alone
 * misses (2e-9, -1, 0) and splits one plane into two buckets) */
export function flipNormal(n) {
	const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
	const k = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
	return n[k] < 0;
}
/** THE pair rule both the probe and defight use: facing within `angle` and every corner of
 * one triangle within `tol` of the other's plane (n/d = the canonical ones for the caller) */
export function coplanarPair(nA, dA, A, nB, dB, B, tol, cosMax) {
	if (dot(nA, nB) < cosMax) return false;
	const on = (n, d, t) => Math.abs(dot(n, t.a) - d) < tol && Math.abs(dot(n, t.b) - d) < tol && Math.abs(dot(n, t.c) - d) < tol;
	return on(nA, dA, B) || on(nB, dB, A);
}
const t0 = (idx, t) => (idx ? -1 : t); // refs are only meaningful on unwelded (non-indexed) data
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** a triangle's corners in a 2D basis on the plane with normal n */
function project(t, n) {
	// pick a basis on the plane
	const ax = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
	const e1 = cross(n, ax); const l1 = Math.hypot(...e1); const u = e1.map((x) => x / l1);
	const v = cross(n, u);
	return [t.a, t.b, t.c].map((p) => [dot(p, u), dot(p, v)]);
}
/** Sutherland–Hodgman clip of two CCW convex polygons. The crossing point is a LERP along
 * the subject edge (t = sp / (sp - sq), bounded to the edge): a line-line intersection with
 * a determinant divides by ~1e-20 when a fan's shared edge lies ON the clip edge, and the
 * far-away point it returns reads as square centimetres of overlap that are not there. */
export function clip(subject, poly) {
	let out = subject;
	for (let i = 0; i < poly.length && out.length; i++) {
		const A = poly[i];
		const B = poly[(i + 1) % poly.length];
		const side = (p) => (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]);
		const inp = out;
		out = [];
		for (let j = 0; j < inp.length; j++) {
			const P = inp[j];
			const Q = inp[(j + 1) % inp.length];
			const sp = side(P);
			const sq = side(Q);
			if (sq >= 0) {
				if (sp < 0) out.push(lerp2(P, Q, sp / (sp - sq)));
				out.push(Q);
			} else if (sp >= 0) out.push(lerp2(P, Q, sp / (sp - sq)));
		}
	}
	return out;
}
const lerp2 = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
export const area2 = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
const ccw = (p) => (area2(p) < 0 ? p.slice().reverse() : p);

/**
 * @param {Array} tris from triangles()
 * @param {{tol?: number, minArea?: number, angle?: number}} o tol = plane distance (m)
 * @returns {{pairs: number, area: number, worst: Array}}
 */
export function coplanarOverlaps(tris, o = {}) {
	const tol = o.tol ?? 0.001, minArea = o.minArea ?? 1e-6, cosMax = Math.cos(((o.angle ?? 1) * Math.PI) / 180);
	// A double-sided material draws both faces, so an OPPOSITE-facing coplanar triangle
	// fights too: bucket on a canonical (hemisphere-flipped) normal and plane distance.
	const opp = o.doubleSidedOpposite !== false;
	const flipOf = flipNormal;
	for (const t of tris) {
		const f = opp && t.double && flipOf(t.n);
		t._n = f ? t.n.map((x) => -x) : t.n;
		t._d = f ? -t.d : t.d;
	}
	const key = (t) => t._n.map((x) => Math.round(x * 20)).join(',');
	const buckets = new Map();
	for (const t of tris) {
		const k = key(t);
		if (!buckets.has(k)) buckets.set(k, []);
		buckets.get(k).push(t);
	}
	let pairs = 0, area = 0;
	const worst = [];
	for (const list of buckets.values()) {
		list.sort((x, y) => x._d - y._d);
		for (let i = 0; i < list.length; i++) {
			const A = list[i];
			for (let j = i + 1; j < list.length && list[j]._d - A._d < tol; j++) {
				const B = list[j];
				if (!coplanarPair(A._n, A._d, A, B._n, B._d, B, tol, cosMax)) continue;
				const pa = ccw(project(A, A._n)), pb = ccw(project(B, A._n));
				const ov = clip(pa, pb);
				const ar = ov.length >= 3 ? Math.abs(area2(ov)) : 0;
				if (ar > minArea) { pairs++; area += ar; if (worst.length < 8) worst.push({ ar, n: A._n.map((x) => +x.toFixed(2)), d: +A._d.toFixed(4), dd: +(B._d - A._d).toFixed(5) }); }
			}
		}
	}
	return { pairs, area, worst };
}

export async function probeFile(file, o) {
	const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
	const doc = await io.read(file);
	const tris = triangles(doc);
	return { file, tris: tris.length, ...coplanarOverlaps(tris, o) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	for (const f of process.argv.slice(2)) {
		const r = await probeFile(f);
		console.log(`${r.pairs ? 'FIGHT' : 'ok   '} ${String(r.pairs).padStart(5)} pairs ${r.area.toFixed(4).padStart(9)} m²  ${String(r.tris).padStart(6)} tris  ${path.relative(process.cwd(), f)}`);
	}
}
