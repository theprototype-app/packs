// kit-cut: derive modular pieces from one post-processed wall (0 credits).
//
// Meshy draws a solid wall slab well and a wall WITH an opening badly (the opening wanders,
// fills half the panel, or vanishes), and an opening of unknown size means the door piece
// cannot fit it. So the kit cuts EXACT openings out of the good plain wall instead:
//
//   cut   — remove the convex region {p : n·p <= d for every plane}; triangles crossing
//           it are split (Sutherland–Hodgman, every vertex attribute interpolated)
//   keep  — the opposite: keep only that region (a half wall, a gable triangle, a post)
//   cap   — close a cut edge: a quad from xy point a to xy point b spanning the slab's
//           depth, facing `normal`; the front face's texture is folded round the corner
//           onto it, so the jamb reads as the stone it was cut through
//   recenter — back to a bottom-centre pivot after a slice moved the bbox off the origin
//   core  — a solid slab |z| <= depth inside the whole piece, textured with the piece's own
//           mortar colour. Meshy builds a masonry wall as separate bricks with OPEN mortar
//           joints (6 % of the refined wall was see-through); the core seals them and reads
//           as recessed mortar. Apply it FIRST so every cut clips it with the bricks.
//
// Operates on the single joined primitive meshy-post produces. Positions are the
// dims-exact ones (metres, pivot at the origin), so openings are specified in metres.
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { TOOLS } from './kit-post.mjs';

const req = createRequire(path.join(TOOLS, 'package.json'));
const load = async (/** @type {string} */ id) => import(pathToFileURL(req.resolve(id)).href);
const { NodeIO } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS } = await load('@gltf-transform/extensions');
const { weld, prune, getBounds } = await load('@gltf-transform/functions');
const sharp = (await load('sharp')).default;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const EPS = 1e-6;

/** Read a primitive into flat per-vertex records. @param {any} prim */
function readPrim(prim) {
	const semantics = prim.listSemantics();
	const attrs = semantics.map((/** @type {string} */ s) => ({ s, acc: prim.getAttribute(s), size: prim.getAttribute(s).getElementSize() }));
	const stride = attrs.reduce((n, a) => n + a.size, 0);
	const count = prim.getAttribute('POSITION').getCount();
	/** @type {number[][]} */
	const verts = [];
	const tmp = [0, 0, 0, 0];
	for (let i = 0; i < count; i++) {
		const v = [];
		for (const a of attrs) {
			a.acc.getElement(i, tmp);
			for (let k = 0; k < a.size; k++) v.push(tmp[k]);
		}
		verts.push(v);
	}
	const idx = prim.getIndices();
	const tris = [];
	if (idx) for (let i = 0; i < idx.getCount(); i += 3) tris.push([verts[idx.getScalar(i)], verts[idx.getScalar(i + 1)], verts[idx.getScalar(i + 2)]]);
	else for (let i = 0; i < count; i += 3) tris.push([verts[i], verts[i + 1], verts[i + 2]]);
	const off = /** @type {Record<string, number>} */ ({});
	let o = 0;
	for (const a of attrs) {
		off[a.s] = o;
		o += a.size;
	}
	return { attrs, stride, tris, off };
}

/** lerp two vertex records; NORMAL renormalized @param {number[]} a @param {number[]} b @param {number} t @param {number} nOff */
function lerpV(a, b, t, nOff) {
	const v = a.map((x, i) => x + (b[i] - x) * t);
	if (nOff >= 0) {
		const l = Math.hypot(v[nOff], v[nOff + 1], v[nOff + 2]) || 1;
		for (let k = 0; k < 3; k++) v[nOff + k] /= l;
	}
	return v;
}

/** Split a convex polygon by plane n·p - d into [inside (<=0), outside (>=0)]. */
function split(/** @type {number[][]} */ poly, /** @type {number[]} */ pl, /** @type {number} */ nOff) {
	const f = (/** @type {number[]} */ v) => {
		const x = pl[0] * v[0] + pl[1] * v[1] + pl[2] * v[2] - pl[3];
		return Math.abs(x) < EPS ? 0 : x;
	};
	const inn = [];
	const out = [];
	for (let i = 0; i < poly.length; i++) {
		const a = poly[i];
		const b = poly[(i + 1) % poly.length];
		const fa = f(a);
		const fb = f(b);
		if (fa <= 0) inn.push(a);
		if (fa >= 0) out.push(a);
		if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
			const v = lerpV(a, b, fa / (fa - fb), nOff);
			inn.push(v);
			out.push(v);
		}
	}
	return [inn.length >= 3 ? inn : [], out.length >= 3 ? out : []];
}

/** fan-triangulate convex polygons @param {number[][][]} polys */
const fan = (polys) => polys.flatMap((p) => p.slice(1, -1).map((_, i) => [p[0], p[i + 1], p[i + 2]]));

/** @param {number[][][]} tris @param {number[][]} planes @param {'cut'|'keep'} mode @param {number} nOff */
export function clip(tris, planes, mode, nOff) {
	const result = [];
	for (const tri of tris) {
		let rest = tri;
		const kept = [];
		for (const pl of planes) {
			const [inn, out] = split(rest, pl, nOff);
			if (mode === 'cut' && out.length) kept.push(out);
			rest = inn;
			if (!rest.length) break;
		}
		if (mode === 'keep' && rest.length) kept.push(rest);
		result.push(...fan(kept));
	}
	return result;
}

/** triangle normal (unnormalized) */
const triN = (/** @type {number[][]} */ [a, b, c]) => {
	const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
	const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
	return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
};

/**
 * A cap from xy point a to xy point b across z ∈ [z0, z1], facing `normal`, in segments
 * of ≤ 10 cm. Each segment is textured from ONE front-facing triangle of the source — the
 * one behind the segment's middle — by extending that triangle's affine xy→uv map, with
 * the cap's depth folded back into the wall (a point d deep sits at xy − n·d on the front).
 * The stone therefore wraps round the corner into the jamb. (Picking the nearest vertex
 * per corner instead mixed UV islands across a 2 m jamb and smeared the atlas's black
 * gutters into it.)
 */
function capQuad(/** @type {number[][][]} */ source, /** @type {any} */ info, a, b, normal, z0, z1, from = 'front') {
	const uvOff = info.off.TEXCOORD_0;
	// where a cap point samples the texture: 'front' folds it back onto the front face;
	// 'end' reads the wall's own left END face at the same (z, y) — a slice's cut side then
	// looks exactly like the original end, whichever way the slice is turned
	const xmin = Math.min(...source.flatMap((t) => t.map((v) => v[0])));
	const flat = from === 'end' ? (/** @type {number[]} */ v) => [v[2], v[1]] : (/** @type {number[]} */ v) => [v[0], v[1]];
	const at = (/** @type {number[]} */ e, /** @type {number} */ z) =>
		from === 'end' ? [z, e[1]] : [e[0] - normal[0] * (z1 - z), e[1] - normal[1] * (z1 - z)];
	// sample real surface only: never the mortar core (its faces are metres long, and its
	// front sits 5 cm behind the brick faces, outside the 4.5 cm front band)
	const small = (/** @type {number[][]} */ t) => t.every((v, i) => Math.hypot(...[0, 1, 2].map((k) => v[k] - t[(i + 1) % 3][k])) < 0.5);
	const front = source.filter((t) => {
		const n = triN(t);
		const l = Math.hypot(...n) || 1;
		if (!small(t)) return false;
		return from === 'end'
			? n[0] / l < -0.5 && t.every((v) => v[0] < xmin + 0.08)
			: n[2] / l > 0.5 && t.every((v) => v[2] > z1 - 0.045);
	});
	const bary = (/** @type {number[][]} */ t, /** @type {number} */ x, /** @type {number} */ y) => {
		const [p, q, r] = t.map(flat);
		const d = (q[1] - r[1]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[1] - r[1]);
		const l1 = ((q[1] - r[1]) * (x - r[0]) + (r[0] - q[0]) * (y - r[1])) / d;
		const l2 = ((r[1] - p[1]) * (x - r[0]) + (p[0] - r[0]) * (y - r[1])) / d;
		return [l1, l2, 1 - l1 - l2];
	};
	/** the sampled-face triangle under (x, y), else the one with the nearest centroid */
	const under = (/** @type {number} */ x, /** @type {number} */ y) => {
		let best = null;
		let bd = Infinity;
		for (const t of front) {
			const l = bary(t, x, y);
			if (Number.isFinite(l[0]) && l.every((v) => v >= -1e-4)) return t;
			const f = t.map(flat);
			const cx = (f[0][0] + f[1][0] + f[2][0]) / 3 - x;
			const cy = (f[0][1] + f[1][1] + f[2][1]) / 3 - y;
			if (cx * cx + cy * cy < bd) {
				bd = cx * cx + cy * cy;
				best = t;
			}
		}
		return best ?? source[0];
	};
	const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
	const segs = Math.max(1, Math.ceil(len / 0.1));
	const depth = z1 - z0;
	const out = [];
	for (let i = 0; i < segs; i++) {
		const e0 = [a[0] + ((b[0] - a[0]) * i) / segs, a[1] + ((b[1] - a[1]) * i) / segs];
		const e1 = [a[0] + ((b[0] - a[0]) * (i + 1)) / segs, a[1] + ((b[1] - a[1]) * (i + 1)) / segs];
		const mid = at([(e0[0] + e1[0]) / 2, (e0[1] + e1[1]) / 2], z1 - depth / 2);
		const tri = under(mid[0], mid[1]);
		const corner = (/** @type {number[]} */ e, /** @type {number} */ z) => {
			const v = tri[0].slice();
			v[0] = e[0];
			v[1] = e[1];
			v[2] = z;
			if (info.off.NORMAL !== undefined) for (let k = 0; k < 3; k++) v[info.off.NORMAL + k] = normal[k];
			if (uvOff !== undefined) {
				const [sx, sy] = at(e, z);
				const l = bary(tri, sx, sy);
				for (let k = 0; k < 2; k++) v[uvOff + k] = l[0] * tri[0][uvOff + k] + l[1] * tri[1][uvOff + k] + l[2] * tri[2][uvOff + k];
			}
			return v;
		};
		const q = [corner(e0, z0), corner(e1, z0), corner(e1, z1), corner(e0, z1)];
		let t1 = [q[0], q[1], q[2]];
		let t2 = [q[0], q[2], q[3]];
		const n = triN(t1);
		if (n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] < 0) {
			t1 = [q[0], q[2], q[1]];
			t2 = [q[0], q[3], q[2]];
		}
		out.push(t1, t2);
	}
	return out;
}

/**
 * The vertex record whose UV samples the mortar: among front-facing vertices, the one at
 * the 10th luminance percentile of the base colour (near-black atlas gutters excluded).
 */
async function mortarVertex(/** @type {any} */ prim, /** @type {number[][][]} */ tris, /** @type {any} */ info) {
	const uvOff = info.off.TEXCOORD_0;
	const img = prim.getMaterial()?.getBaseColorTexture()?.getImage();
	const front = tris.filter((t) => {
		const n = triN(t);
		return n[2] / (Math.hypot(...n) || 1) > 0.5;
	});
	if (!img || uvOff === undefined) return front[0][0];
	const { data, info: im } = await sharp(Buffer.from(img)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
	const lum = (/** @type {number[]} */ v) => {
		const x = Math.min(im.width - 1, Math.max(0, Math.floor((v[uvOff] - Math.floor(v[uvOff])) * im.width)));
		const y = Math.min(im.height - 1, Math.max(0, Math.floor((v[uvOff + 1] - Math.floor(v[uvOff + 1])) * im.height)));
		const i = (y * im.width + x) * 3;
		return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
	};
	const scored = front.flat().map((v) => [lum(v), v]).filter(([l]) => /** @type {number} */ (l) > 25);
	scored.sort((a, b) => /** @type {number} */ (a[0]) - /** @type {number} */ (b[0]));
	return /** @type {number[]} */ (scored[Math.floor(scored.length * 0.1)]?.[1] ?? front[0][0]);
}

/** a closed box, every vertex a copy of `proto` with its own position + normal */
function coreBox(/** @type {number[]} */ lo, /** @type {number[]} */ hi, /** @type {number[]} */ proto, /** @type {any} */ info) {
	const nOff = info.off.NORMAL;
	const P = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z, /** @type {number[]} */ n) => {
		const v = proto.slice();
		v[0] = x;
		v[1] = y;
		v[2] = z;
		if (nOff !== undefined) for (let k = 0; k < 3; k++) v[nOff + k] = n[k];
		return v;
	};
	const faces = [
		[[0, 0, 1], (/** @type {number} */ u, /** @type {number} */ w) => [u, w, hi[2]], [lo[0], hi[0]], [lo[1], hi[1]]],
		[[0, 0, -1], (u, w) => [u, w, lo[2]], [lo[0], hi[0]], [lo[1], hi[1]]],
		[[0, 1, 0], (u, w) => [u, hi[1], w], [lo[0], hi[0]], [lo[2], hi[2]]],
		[[0, -1, 0], (u, w) => [u, lo[1], w], [lo[0], hi[0]], [lo[2], hi[2]]],
		[[1, 0, 0], (u, w) => [hi[0], u, w], [lo[1], hi[1]], [lo[2], hi[2]]],
		[[-1, 0, 0], (u, w) => [lo[0], u, w], [lo[1], hi[1]], [lo[2], hi[2]]]
	];
	const out = [];
	for (const [n, at, [u0, u1], [w0, w1]] of /** @type {any[]} */ (faces)) {
		const q = [at(u0, w0), at(u1, w0), at(u1, w1), at(u0, w1)].map((c) => P(c[0], c[1], c[2], n));
		let t1 = [q[0], q[1], q[2]];
		let t2 = [q[0], q[2], q[3]];
		const tn = triN(t1);
		if (tn[0] * n[0] + tn[1] * n[1] + tn[2] * n[2] < 0) {
			t1 = [q[0], q[2], q[1]];
			t2 = [q[0], q[3], q[2]];
		}
		out.push(t1, t2);
	}
	return out;
}

/**
 * Apply ops to a dims-exact GLB and write the derived piece.
 * @param {string} input @param {string} output @param {any[]} ops
 */
export async function kitCut(input, output, ops) {
	const doc = await io.read(input);
	const prims = doc.getRoot().listMeshes().flatMap((/** @type {any} */ m) => m.listPrimitives());
	if (prims.length !== 1) throw new Error(`${input}: kit-cut expects ONE primitive, found ${prims.length}`);
	const prim = prims[0];
	const info = readPrim(prim);
	const nOff = info.off.NORMAL ?? -1;
	const original = info.tris;
	const b0 = getBounds(doc.getRoot().listScenes()[0]);
	const [z0, z1] = [b0.min[2], b0.max[2]];
	let tris = original;
	for (const op of ops) {
		if (op.op === 'cut' || op.op === 'keep') tris = clip(tris, op.planes, op.op, nOff);
		else if (op.op === 'core') {
			const inset = op.inset ?? 0.001; // off the clamped end/top planes: no z-fight there
			const proto = await mortarVertex(prim, original, info);
			tris = tris.concat(
				coreBox([b0.min[0] + inset, b0.min[1] + inset, -op.depth], [b0.max[0] - inset, b0.max[1] - inset, op.depth], proto, info)
			);
		}
		else if (op.op === 'cap') tris = tris.concat(capQuad(original, info, op.a, op.b, op.normal, z0, z1, op.from));
		else if (op.op === 'recenter') {
			// back to a bottom-centre pivot after a slice moved the bbox off the origin
			const lo = [Infinity, Infinity, Infinity];
			const hi = [-Infinity, -Infinity, -Infinity];
			for (const t of tris) for (const v of t) for (let k = 0; k < 3; k++) {
				lo[k] = Math.min(lo[k], v[k]);
				hi[k] = Math.max(hi[k], v[k]);
			}
			const d = [-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2];
			tris = tris.map((t) => t.map((v) => {
				const w = v.slice();
				for (let k = 0; k < 3; k++) w[k] += d[k];
				return w;
			}));
		} else throw new Error(`unknown op ${op.op}`);
	}
	// write back: non-indexed from the records, then weld re-indexes
	const n = tris.length * 3;
	for (const a of info.attrs) {
		const arr = new Float32Array(n * a.size);
		let i = 0;
		for (const t of tris) for (const v of t) for (let k = 0; k < a.size; k++) arr[i++] = v[info.off[a.s] + k];
		a.acc.setArray(arr);
	}
	prim.setIndices(null);
	await doc.transform(weld(), prune());
	await io.write(output, doc);
	const b = getBounds(doc.getRoot().listScenes()[0]);
	return { output, trisIn: original.length, trisOut: tris.length, bounds: { min: b.min.map((v) => +v.toFixed(4)), max: b.max.map((v) => +v.toFixed(4)) } };
}

/** The standard derived pieces, in metres on a 2 × 3 × 0.25 wall with a bottom-centre pivot. */
export const DERIVE = {
	/** door opening 1.0 × 2.2, centred */
	door: (/** @type {any} */ o = { w: 1.0, h: 2.2 }) => [
		{ op: 'cut', planes: [[-1, 0, 0, o.w / 2], [1, 0, 0, o.w / 2], [0, 1, 0, o.h]] },
		{ op: 'cap', a: [-o.w / 2, 0], b: [-o.w / 2, o.h], normal: [1, 0, 0] },
		{ op: 'cap', a: [o.w / 2, 0], b: [o.w / 2, o.h], normal: [-1, 0, 0] },
		{ op: 'cap', a: [-o.w / 2, o.h], b: [o.w / 2, o.h], normal: [0, -1, 0] }
	],
	/** window opening 0.8 × 1.0, sill at 1.1 m, centred */
	window: (/** @type {any} */ o = { w: 0.8, h: 1.0, sill: 1.1 }) => [
		{ op: 'cut', planes: [[-1, 0, 0, o.w / 2], [1, 0, 0, o.w / 2], [0, -1, 0, -o.sill], [0, 1, 0, o.sill + o.h]] },
		{ op: 'cap', a: [-o.w / 2, o.sill], b: [-o.w / 2, o.sill + o.h], normal: [1, 0, 0] },
		{ op: 'cap', a: [o.w / 2, o.sill], b: [o.w / 2, o.sill + o.h], normal: [-1, 0, 0] },
		{ op: 'cap', a: [-o.w / 2, o.sill + o.h], b: [o.w / 2, o.sill + o.h], normal: [0, -1, 0] },
		{ op: 'cap', a: [-o.w / 2, o.sill], b: [o.w / 2, o.sill], normal: [0, 1, 0] }
	],
	/** the UPPER half moved down to the floor: it keeps the wall's real finished top edge
	 *  (the lower half would expose whatever the cut line runs through), and its cut
	 *  underside gets a lid facing down */
	half: (/** @type {any} */ o = { h: 1.5 }) => [
		{ op: 'keep', planes: [[0, -1, 0, -o.h]] },
		{ op: 'cap', a: [-1, o.h], b: [1, o.h], normal: [0, -1, 0] },
		{ op: 'recenter' }
	],
	/** a right-triangle half gable, 2 wide × 1.5 tall, high end at +x (rotate 180° for the other side) */
	gable: (/** @type {any} */ o = { rise: 1.5, w: 2 }) => {
		const k = o.rise / o.w; // y <= k (x + w/2)  →  -k x + y - k w/2 <= 0
		return [
			{ op: 'keep', planes: [[-k, 1, 0, (k * o.w) / 2]] },
			{ op: 'cap', a: [-o.w / 2, 0], b: [o.w / 2, o.rise], normal: [-k / Math.hypot(k, 1), 1 / Math.hypot(k, 1), 0] }
		];
	},
	/** a 0.25 m square corner post sliced off the wall's end (fills the outer-corner notch) */
	post: (/** @type {any} */ o = { w: 0.25, x0: -1 }) => [
		{ op: 'keep', planes: [[1, 0, 0, o.x0 + o.w]] },
		{ op: 'cap', a: [o.x0 + o.w, 0], b: [o.x0 + o.w, 3], normal: [1, 0, 0], from: 'end' },
		{ op: 'recenter' }
	]
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [input, output, kind] = process.argv.slice(2);
	const ops = kind in DERIVE ? DERIVE[/** @type {keyof typeof DERIVE} */ (kind)]() : JSON.parse(kind);
	console.log(JSON.stringify(await kitCut(input, output, ops)));
}
