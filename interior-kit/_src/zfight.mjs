// zfight: the static flicker probe for interior-kit. Finds pairs of triangles that lie in
// the same plane, FACE THE SAME WAY and overlap in area — what the depth buffer cannot
// order, so they shimmer as the camera moves (the user's "flickers only while moving").
// Opposite-facing coplanar faces are not counted: with single-sided materials one of the
// two is always back-face culled. It probes a piece on its own AND assemblies of placed
// pieces (a straight run, an inner corner, a trim against the architecture kit's wall).
//
//   node zfight.mjs a.glb b.glb …           → one line per file
//   import { probeScene } from './zfight.mjs'; probeScene([{file, t:[x,y,z], yaw}])
const TOOLS = process.env.MESHY_TOOLS ?? new URL('../../tools/meshy', import.meta.url).pathname;
const { NodeIO } = await import(`${TOOLS}/node_modules/@gltf-transform/core/dist/index.js`);
const { ALL_EXTENSIONS } = await import(`${TOOLS}/node_modules/@gltf-transform/extensions/dist/index.js`);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const cache = new Map();

/** world triangles of one GLB placed at t with a yaw (deg) about Y; `tag` names the source */
export async function trianglesOf(file, t = [0, 0, 0], yaw = 0, tag = file) {
	if (!cache.has(file)) cache.set(file, await io.read(file));
	const doc = cache.get(file);
	const c = Math.cos((yaw * Math.PI) / 180);
	const s = Math.sin((yaw * Math.PI) / 180);
	const place = (p) => [c * p[0] + s * p[2] + t[0], p[1] + t[1], -s * p[0] + c * p[2] + t[2]];
	const out = [];
	const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
	scene.traverse((node) => {
		const mesh = node.getMesh();
		if (!mesh) return;
		const m = node.getWorldMatrix();
		const tf = (v) => place([m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]);
		for (const prim of mesh.listPrimitives()) {
			const pos = prim.getAttribute('POSITION');
			const idx = prim.getIndices();
			const P = [];
			for (let i = 0; i < pos.getCount(); i++) P.push(tf(pos.getElement(i, [])));
			const n = idx ? idx.getCount() : pos.getCount();
			for (let k = 0; k + 2 < n; k += 3) {
				const [a, b, cc] = [0, 1, 2].map((j) => P[idx ? idx.getScalar(k + j) : k + j]);
				const cr = cross(sub(b, a), sub(cc, a));
				const len = Math.hypot(...cr);
				if (len < 1e-10) continue;
				const nn = cr.map((x) => x / len);
				out.push({ a, b, c: cc, n: nn, d: dot(nn, a), tag, double: !!prim.getMaterial()?.getDoubleSided() });
			}
		}
	});
	return out;
}

function project(t, n) {
	const ax = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
	const e1 = cross(n, ax);
	const l1 = Math.hypot(...e1);
	const u = e1.map((x) => x / l1);
	const v = cross(n, u);
	return [t.a, t.b, t.c].map((p) => [dot(p, u), dot(p, v)]);
}
const area2 = (p) => p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0) / 2;
const ccw = (p) => (area2(p) < 0 ? p.slice().reverse() : p);
function clip(subject, poly) {
	let out = subject;
	for (let i = 0; i < poly.length && out.length; i++) {
		const A = poly[i];
		const B = poly[(i + 1) % poly.length];
		const inside = (p) => (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]) >= 0;
		const inter = (p, q) => {
			const a1 = B[1] - A[1], b1 = A[0] - B[0], c1 = a1 * A[0] + b1 * A[1];
			const a2 = q[1] - p[1], b2 = p[0] - q[0], c2 = a2 * p[0] + b2 * p[1];
			const det = a1 * b2 - a2 * b1;
			return det === 0 ? p : [(b2 * c1 - b1 * c2) / det, (a1 * c2 - a2 * c1) / det];
		};
		const inp = out;
		out = [];
		for (let j = 0; j < inp.length; j++) {
			const P = inp[j];
			const Q = inp[(j + 1) % inp.length];
			if (inside(Q)) {
				if (!inside(P)) out.push(inter(P, Q));
				out.push(Q);
			} else if (inside(P)) out.push(inter(P, Q));
		}
	}
	return out;
}

/**
 * Same-facing coplanar overlaps. `across` = only count pairs from DIFFERENT tags (an
 * assembly's seams) — a piece's own faces are probed on their own.
 * @returns {{pairs: number, area: number, worst: any[]}}
 */
export function overlaps(tris, { tol = 0.0008, minArea = 2e-6, across = false, keep = () => true } = {}) {
	const buckets = new Map();
	for (const t of tris) {
		const k = t.n.map((x) => Math.round(x * 20)).join(',');
		if (!buckets.has(k)) buckets.set(k, []);
		buckets.get(k).push(t);
	}
	let pairs = 0;
	let area = 0;
	const worst = [];
	for (const list of buckets.values()) {
		list.sort((x, y) => x.d - y.d);
		for (let i = 0; i < list.length; i++) {
			const A = list[i];
			for (let j = i + 1; j < list.length && list[j].d - A.d < tol; j++) {
				const B = list[j];
				if (across && A.tag === B.tag) continue;
				if (!keep(A.tag, B.tag)) continue;
				if (dot(A.n, B.n) < Math.cos(Math.PI / 180)) continue;
				if (Math.abs(dot(A.n, B.a) - A.d) > tol) continue;
				const ov = clip(ccw(project(A, A.n)), ccw(project(B, A.n)));
				const ar = ov.length >= 3 ? Math.abs(area2(ov)) : 0;
				if (ar > minArea) {
					pairs++;
					area += ar;
					if (worst.length < 6) worst.push({ ar: +ar.toFixed(6), n: A.n.map((x) => +x.toFixed(2)), d: +A.d.toFixed(4), tags: [A.tag, B.tag] });
				}
			}
		}
	}
	return { pairs, area, worst };
}

/** probe an assembly: [{file, t, yaw, tag}] → overlaps across different placements */
export async function probeScene(list, o = {}) {
	const tris = [];
	for (const [i, it] of list.entries()) tris.push(...(await trianglesOf(it.file, it.t, it.yaw, it.tag ?? `${i}:${it.file.split('/').pop()}`)));
	return overlaps(tris, { across: true, ...o });
}

if (import.meta.url === `file://${process.argv[1]}`) {
	for (const f of process.argv.slice(2)) {
		const r = overlaps(await trianglesOf(f));
		console.log(`${r.pairs ? 'FIGHT' : 'ok   '} ${String(r.pairs).padStart(5)} pairs ${r.area.toFixed(5).padStart(9)} m²  ${f.split('/').slice(-3, -2)[0] ?? f}`);
	}
}
