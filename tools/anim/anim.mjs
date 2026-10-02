// tools/anim — make a static pack GLB into an ANIMATED, FUNCTIONAL item (contract P2), with
// embedded tools only (glTF-Transform + three.js maths, 0 credits).
//
// A rig is a list of PARTS assembled into one GLB:
//
//   part(file)              every mesh of a GLB, node transforms baked, one piece per material
//   proc(geometry, from)    a hand-built three.js BufferGeometry wearing a material taken from a GLB
//   .keep(planes)           keep only the convex region {p : n·p <= d for every plane}; triangles
//   .cut(planes)            crossing a plane are SPLIT (Sutherland–Hodgman, every attribute
//                           interpolated), so a door leaf comes out of a one-mesh Meshy door with a
//                           straight edge, not a ragged row of whole triangles
//   .box(lo, hi, {sample})  a closed box (a cap that seals what a cut opened: the leaf's edge, the
//                           jamb behind it), textured with ONE texel sampled from the part itself
//   .move / .scale / .rotY  affine edits (normals follow)
//   .at(pivot)              the NODE's origin: the hinge line of a leaf, the axle of a lever. The
//                           geometry is offset by −pivot and the node is translated to +pivot, so
//                           rotating the node swings the leaf about its hinge, not its centre
//
// then assemble(parts, {clips, behavior}) writes ONE glTF: one named node per part, its clips, a
// static `idle` clip FIRST (a 1.18 build autoplays animations[0] in a loop — idle holds the rest
// pose, so a released build shows a still door; see QUESTIONS-33-anim-kit Q2) and the behavior in
// scene.extras (33-anim-core reads it when the GLB arrives without its pack row).
//
// Clips are LINEAR keyframes (three.js has no glTF ease); ease() samples a smoothstep curve into
// keys so a door decelerates into its stop.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
/** tools/meshy's node_modules: this checkout's when installed, else MESHY_TOOLS / the 30c tools worktree */
export const TOOLS = [process.env.MESHY_TOOLS, path.join(REPO, 'tools/meshy'), '/home/deck/.code/theprototype-app/packs-lane-30c-tools/tools/meshy'].find(
	(d) => d && fs.existsSync(path.join(d, 'node_modules/@gltf-transform/core'))
);
if (!TOOLS) throw new Error('tools/anim needs tools/meshy installed: (cd tools/meshy && npm ci)');
const req = createRequire(path.join(TOOLS, 'package.json'));
const load = async (/** @type {string} */ id) => import(pathToFileURL(req.resolve(id)).href);
const { NodeIO, Document, Logger } = await load('@gltf-transform/core');
const QUIET = new Logger(Logger.Verbosity.WARN);
const { ALL_EXTENSIONS } = await load('@gltf-transform/extensions');
const { weld, prune, dedup, mergeDocuments, getBounds, cloneDocument } = await load('@gltf-transform/functions');
export const THREE = await import(pathToFileURL(path.join(TOOLS, 'node_modules/three/build/three.module.js')).href);
const sharp = (await load('sharp')).default;
export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
export { getBounds };

const EPS = 1e-6;
const LAYOUT = ['POSITION', 'NORMAL', 'TEXCOORD_0'];

// ---------------------------------------------------------------- vertex records + clipping

/** a primitive as flat per-vertex records [px,py,pz, nx,ny,nz, u,v] (missing NORMAL/UV → 0) */
function readTris(/** @type {any} */ prim, /** @type {number[]} */ m) {
	const pos = prim.getAttribute('POSITION');
	const nor = prim.getAttribute('NORMAL');
	const uv = prim.getAttribute('TEXCOORD_0');
	const M = new THREE.Matrix4().fromArray(m);
	const N = new THREE.Matrix3().getNormalMatrix(M);
	const p = new THREE.Vector3();
	const n = new THREE.Vector3();
	const t = [0, 0, 0];
	const verts = [];
	for (let i = 0; i < pos.getCount(); i++) {
		pos.getElement(i, t);
		p.set(t[0], t[1], t[2]).applyMatrix4(M);
		if (nor) {
			nor.getElement(i, t);
			n.set(t[0], t[1], t[2]).applyMatrix3(N).normalize();
		} else n.set(0, 0, 0);
		const w = uv ? uv.getElement(i, [0, 0]) : [0, 0];
		verts.push([p.x, p.y, p.z, n.x, n.y, n.z, w[0], w[1]]);
	}
	const idx = prim.getIndices();
	const tris = [];
	if (idx) for (let i = 0; i < idx.getCount(); i += 3) tris.push([verts[idx.getScalar(i)], verts[idx.getScalar(i + 1)], verts[idx.getScalar(i + 2)]]);
	else for (let i = 0; i < verts.length; i += 3) tris.push([verts[i], verts[i + 1], verts[i + 2]]);
	return tris;
}

function lerpV(/** @type {number[]} */ a, /** @type {number[]} */ b, /** @type {number} */ t) {
	const v = a.map((x, i) => x + (b[i] - x) * t);
	const l = Math.hypot(v[3], v[4], v[5]) || 1;
	for (let k = 3; k < 6; k++) v[k] /= l;
	return v;
}

/** split a convex polygon by plane n·p − d into [inside (≤ 0), outside (≥ 0)] */
function split(/** @type {number[][]} */ poly, /** @type {number[]} */ pl) {
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
			const v = lerpV(a, b, fa / (fa - fb));
			inn.push(v);
			out.push(v);
		}
	}
	return [inn.length >= 3 ? inn : [], out.length >= 3 ? out : []];
}

const fan = (/** @type {number[][][]} */ polys) => polys.flatMap((p) => p.slice(1, -1).map((_, i) => [p[0], p[i + 1], p[i + 2]]));

/** keep (or cut away) the convex region of `planes` @param {number[][][]} tris @param {number[][]} planes @param {'keep'|'cut'} mode */
export function clip(tris, planes, mode) {
	const result = [];
	for (const tri of tris) {
		let rest = tri;
		const kept = [];
		for (const pl of planes) {
			const [inn, out] = split(rest, pl);
			if (mode === 'cut' && out.length) kept.push(out);
			rest = inn;
			if (!rest.length) break;
		}
		if (mode === 'keep' && rest.length) kept.push(rest);
		result.push(...fan(kept));
	}
	return result;
}

/** the axis-aligned box lo..hi as clip planes */
export const boxPlanes = (/** @type {number[]} */ lo, /** @type {number[]} */ hi) => [
	[-1, 0, 0, -lo[0]], [1, 0, 0, hi[0]],
	[0, -1, 0, -lo[1]], [0, 1, 0, hi[1]],
	[0, 0, -1, -lo[2]], [0, 0, 1, hi[2]]
];

const triN = (/** @type {number[][]} */ [a, b, c]) => {
	const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
	const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
	return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
};

/** a closed box, every vertex a copy of `proto` (its UV = one texel) with its own position + normal */
function boxTris(/** @type {number[]} */ lo, /** @type {number[]} */ hi, /** @type {number[]} */ proto, skip = '', inward = false) {
	const faces = [
		['+z', [0, 0, 1], (/** @type {number} */ u, /** @type {number} */ w) => [u, w, hi[2]], [lo[0], hi[0]], [lo[1], hi[1]]],
		['-z', [0, 0, -1], (u, w) => [u, w, lo[2]], [lo[0], hi[0]], [lo[1], hi[1]]],
		['+y', [0, 1, 0], (u, w) => [u, hi[1], w], [lo[0], hi[0]], [lo[2], hi[2]]],
		['-y', [0, -1, 0], (u, w) => [u, lo[1], w], [lo[0], hi[0]], [lo[2], hi[2]]],
		['+x', [1, 0, 0], (u, w) => [hi[0], u, w], [lo[1], hi[1]], [lo[2], hi[2]]],
		['-x', [-1, 0, 0], (u, w) => [lo[0], u, w], [lo[1], hi[1]], [lo[2], hi[2]]]
	];
	const out = [];
	for (let [id, n, at, [u0, u1], [w0, w1]] of /** @type {any[]} */ (faces)) {
		if (skip.split(',').includes(id)) continue;
		if (inward) n = n.map((/** @type {number} */ x) => -x);
		const q = [at(u0, w0), at(u1, w0), at(u1, w1), at(u0, w1)].map((c) => {
			const v = proto.slice();
			v.splice(0, 6, c[0], c[1], c[2], n[0], n[1], n[2]);
			return v;
		});
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

// ---------------------------------------------------------------- parts

/** the decoded base colour of a material, cached @type {Map<any, Promise<any>>} */
const pixels = new Map();
function basePixels(/** @type {any} */ material, kind = 'base') {
	const img = (kind === 'base' ? material?.getBaseColorTexture() : material?.getMetallicRoughnessTexture())?.getImage();
	if (!img) return Promise.resolve(null);
	const key = material.getName() + '|' + kind + '|' + img.byteLength;
	if (!pixels.has(key)) pixels.set(key, sharp(Buffer.from(img)).removeAlpha().raw().toBuffer({ resolveWithObject: true }));
	return /** @type {Promise<any>} */ (pixels.get(key));
}
const fract = (/** @type {number} */ x) => x - Math.floor(x);

export class Part {
	/** @param {any} doc @param {{material: any, tris: number[][][]}[]} pieces @param {string} label */
	constructor(doc, pieces, label) {
		this.doc = doc;
		this.pieces = pieces;
		this.label = label;
		this.name = '';
		/** @type {number[]} */
		this.pivot = [0, 0, 0];
		/** @type {string | null} */
		this.parent = null;
		this.doubleSided = /** @type {boolean | null} */ (null);
		/** @type {number[] | null} */
		this.rotation = null;
	}
	/** @param {(t: number[][][], m: any) => number[][][]} fn */
	map(fn) {
		this.pieces = this.pieces.map((p) => ({ ...p, tris: fn(p.tris, p.material) })).filter((p) => p.tris.length);
		return this;
	}
	keep(/** @type {number[][]} */ planes) {
		return this.map((t) => clip(t, planes, 'keep'));
	}
	cut(/** @type {number[][]} */ planes) {
		return this.map((t) => clip(t, planes, 'cut'));
	}
	/** keep only the pieces whose material matches (by name, or a predicate) */
	only(/** @type {string | ((m: any) => boolean)} */ which) {
		const f = typeof which === 'string' ? (/** @type {any} */ m) => m?.getName() === which : which;
		this.pieces = this.pieces.filter((p) => f(p.material));
		return this;
	}
	/** an affine matrix applied to positions (normals by its normal matrix) */
	apply(/** @type {any} */ M) {
		const N = new THREE.Matrix3().getNormalMatrix(M);
		const p = new THREE.Vector3();
		const n = new THREE.Vector3();
		const flip = M.determinant() < 0;
		return this.map((tris) =>
			tris.map((t) => {
				const r = t.map((v) => {
					p.set(v[0], v[1], v[2]).applyMatrix4(M);
					n.set(v[3], v[4], v[5]).applyMatrix3(N).normalize();
					const w = v.slice();
					w.splice(0, 6, p.x, p.y, p.z, n.x, n.y, n.z);
					return w;
				});
				return flip ? [r[0], r[2], r[1]] : r;
			})
		);
	}
	move(/** @type {number[]} */ d) {
		return this.apply(new THREE.Matrix4().makeTranslation(d[0], d[1], d[2]));
	}
	scale(/** @type {number[]} */ s, /** @type {number[]} */ about = [0, 0, 0]) {
		const M = new THREE.Matrix4().makeTranslation(about[0], about[1], about[2]);
		M.multiply(new THREE.Matrix4().makeScale(s[0], s[1], s[2]));
		M.multiply(new THREE.Matrix4().makeTranslation(-about[0], -about[1], -about[2]));
		return this.apply(M);
	}
	rotY(/** @type {number} */ deg) {
		return this.apply(new THREE.Matrix4().makeRotationY((deg * Math.PI) / 180));
	}
	rotX(/** @type {number} */ deg) {
		return this.apply(new THREE.Matrix4().makeRotationX((deg * Math.PI) / 180));
	}
	rotZ(/** @type {number} */ deg) {
		return this.apply(new THREE.Matrix4().makeRotationZ((deg * Math.PI) / 180));
	}
	/** bounds of the current geometry */
	bounds() {
		const lo = [Infinity, Infinity, Infinity];
		const hi = [-Infinity, -Infinity, -Infinity];
		for (const p of this.pieces) for (const t of p.tris) for (const v of t) for (let k = 0; k < 3; k++) {
			lo[k] = Math.min(lo[k], v[k]);
			hi[k] = Math.max(hi[k], v[k]);
		}
		return { lo, hi };
	}
	triCount() {
		return this.pieces.reduce((n, p) => n + p.tris.length, 0);
	}
	/**
	 * A closed box lo..hi wearing ONE texel of this part: the vertex whose base colour sits at
	 * the `pct` luminance percentile among the vertices facing `face` inside `near` (default:
	 * the whole part). Seals a cut: the edge of a leaf, the inside of a jamb.
	 * @param {number[]} lo @param {number[]} hi
	 * `inward` turns the faces to look INTO the box (the inside of a chest, a drawer).
	 * @param {{pct?: number, face?: number[], near?: {lo: number[], hi: number[]}, piece?: number, skip?: string, inward?: boolean}} [o]
	 */
	async box(lo, hi, o = {}) {
		const piece = this.pieces[o.piece ?? 0];
		const proto = await this.sample(piece, o);
		piece.tris = piece.tris.concat(boxTris(lo, hi, proto, o.skip, o.inward));
		return this;
	}
	/**
	 * An open-topped TRAY sunk into a cut top at `y`: a floor `depth` down, four inner walls
	 * looking inwards, and a rim (top faces) from the tray's walls out to `outer` — what a chest
	 * shows when its lid lifts, instead of the void inside a Meshy shell.
	 * @param {{lo: number[], hi: number[]}} outer the rim's outer xz extent ([x, z] pairs as lo/hi)
	 * @param {number} y the cut height @param {number} wall rim width @param {number} depth
	 * @param {any} [o] sample options (pct, face, near) for the inside; o.rim for the rim's
	 */
	async tray(outer, y, wall, depth, o = {}) {
		const [x0, z0] = outer.lo;
		const [x1, z1] = outer.hi;
		const ix0 = x0 + wall;
		const ix1 = x1 - wall;
		const iz0 = z0 + wall;
		const iz1 = z1 - wall;
		await this.box([ix0, y - depth, iz0], [ix1, y, iz1], { pct: 0.12, ...o, skip: '+y', inward: true });
		const rim = { pct: 0.5, face: [0, 1, 0], ...(o.rim ?? {}), skip: '-y,+x,-x,+z,-z' };
		await this.box([x0, y - 0.01, z0], [x1, y - 1e-4, iz0], rim);
		await this.box([x0, y - 0.01, iz1], [x1, y - 1e-4, z1], rim);
		await this.box([x0, y - 0.01, iz0], [ix0, y - 1e-4, iz1], rim);
		await this.box([ix1, y - 0.01, iz0], [x1, y - 1e-4, iz1], rim);
		return this;
	}
	/** a vertex record whose UV samples a representative texel (see box) */
	async sample(/** @type {{material: any, tris: number[][][]}} */ piece, /** @type {any} */ o = {}) {
		const face = o.face ?? [0, 0, 1];
		const inside = (/** @type {number[]} */ v) => !o.near || [0, 1, 2].every((k) => v[k] >= o.near.lo[k] - 1e-4 && v[k] <= o.near.hi[k] + 1e-4);
		let verts = piece.tris.filter((t) => {
			const n = triN(t);
			const l = Math.hypot(...n) || 1;
			return (n[0] * face[0] + n[1] * face[1] + n[2] * face[2]) / l > 0.5 && t.every(inside);
		}).flat();
		if (!verts.length) verts = piece.tris.flat();
		const img = await basePixels(piece.material);
		if (!img) return verts[0];
		const { data, info } = img;
		const texel = (/** @type {any} */ im, /** @type {number[]} */ v) => {
			const x = Math.min(im.info.width - 1, Math.floor(fract(v[6]) * im.info.width));
			const y = Math.min(im.info.height - 1, Math.floor(fract(v[7]) * im.info.height));
			return (y * im.info.width + x) * 3;
		};
		const lum = (/** @type {number[]} */ v) => {
			const i = texel({ info }, v);
			return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
		};
		// never a metal texel: a cap of polished iron reads as a mirror (glTF metallic = blue channel)
		const mr = await basePixels(piece.material, 'mr');
		const metalF = piece.material.getMetallicFactor();
		const roughF = piece.material.getRoughnessFactor();
		// …and a ROUGH one (green channel): a glossy texel on a flat cap mirrors the sky
		const dull = (/** @type {number[]} */ v) => {
			if (!mr) return true;
			const i = texel(mr, v);
			return (mr.data[i + 2] / 255) * metalF < 0.25 && (mr.data[i + 1] / 255) * roughF > 0.6;
		};
		const scored = verts.filter(dull).map((v) => /** @type {[number, number[]]} */ ([lum(v), v])).filter(([l]) => l > 20);
		scored.sort((a, b) => a[0] - b[0]);
		return scored[Math.floor((scored.length - 1) * (o.pct ?? 0.5))]?.[1] ?? verts[0];
	}
	/** name this part's node and put its origin at `pivot` (the hinge); `parent` nests it;
	 * `rotation` (a quaternion) is the node's REST pose — the geometry is built upright and
	 * the node tilts it (a lever thrown back), so clips rotate about the same rest */
	at(/** @type {string} */ name, /** @type {number[]} */ pivot = [0, 0, 0], /** @type {string | null} */ parent = null, /** @type {number[] | null} */ rotation = null) {
		this.name = name;
		this.pivot = pivot;
		this.parent = parent;
		this.rotation = rotation;
		return this;
	}
	/** multiply every material's base colour (a pale Meshy oak → warm, darker oak) */
	tint(/** @type {number[]} */ rgb) {
		for (const p of this.pieces) {
			const f = p.material.getBaseColorFactor();
			p.material.setBaseColorFactor([f[0] * rgb[0], f[1] * rgb[1], f[2] * rgb[2], f[3]]);
		}
		return this;
	}
	/** join another part built in the SAME document (proc(..., {into: this})) */
	add(/** @type {Part} */ other) {
		if (other.doc !== this.doc) throw new Error(`${other.label} is not in ${this.label}'s document: build it with {into}`);
		this.pieces.push(...other.pieces);
		return this;
	}
	/** a copy (same source doc, so the same materials) */
	clone() {
		const c = new Part(this.doc, this.pieces.map((p) => ({ material: p.material, tris: p.tris.map((t) => t.map((v) => v.slice())) })), this.label);
		c.doubleSided = this.doubleSided;
		return c;
	}
}

/** every mesh of a GLB with its node transforms baked in, one piece per material @param {string} file */
export async function part(file) {
	const doc = await io.read(file);
	/** @type {Map<any, number[][][]>} */
	const byMat = new Map();
	for (const scene of doc.getRoot().listScenes())
		scene.traverse((/** @type {any} */ node) => {
			const mesh = node.getMesh();
			if (!mesh) return;
			for (const prim of mesh.listPrimitives()) {
				const m = prim.getMaterial();
				byMat.set(m, (byMat.get(m) ?? []).concat(readTris(prim, node.getWorldMatrix())));
			}
		});
	return new Part(doc, [...byMat].map(([material, tris]) => ({ material, tris })), path.basename(file));
}

/**
 * A hand-built three.js geometry wearing a material of a GLB (by name, or its first one), UVs
 * as the geometry has them — or box-projected at `tile` metres per texture repeat.
 * `into` builds it in another part's document (so the two can be joined with .add()).
 * @param {any} geo @param {string} file @param {{into?: Part, material?: string, tile?: number, color?: number[], emissive?: number[], emissiveStrength?: number, name?: string, roughness?: number, metalness?: number}} [o]
 */
export async function proc(geo, file, o = {}) {
	const doc = o.into ? o.into.doc : await io.read(file);
	let material = o.material ? doc.getRoot().listMaterials().find((/** @type {any} */ m) => m.getName() === o.material) : doc.getRoot().listMaterials()[0];
	if (!material) throw new Error(`${file}: no material ${o.material}`);
	if (o.color || o.emissive || o.name) {
		material = material.clone();
		if (o.name) material.setName(o.name);
		if (o.color) material.setBaseColorFactor(o.color);
		if (o.emissive) material.setEmissiveFactor(o.emissive);
		if (o.roughness !== undefined) material.setRoughnessFactor(o.roughness);
		if (o.metalness !== undefined) material.setMetallicFactor(o.metalness);
		if (o.emissiveStrength) {
			const ext = doc.createExtension(ALL_EXTENSIONS.find((/** @type {any} */ e) => e.EXTENSION_NAME === 'KHR_materials_emissive_strength'));
			material.setExtension('KHR_materials_emissive_strength', ext.createEmissiveStrength().setEmissiveStrength(o.emissiveStrength));
		}
	}
	let g = geo.index ? geo.toNonIndexed() : geo;
	if (!g.attributes.normal) g.computeVertexNormals();
	if (o.tile || !g.attributes.uv) g = boxUV(g, o.tile ?? 1);
	const P = g.attributes.position;
	const N = g.attributes.normal;
	const U = g.attributes.uv;
	const tris = [];
	for (let i = 0; i < P.count; i += 3) {
		const t = [];
		for (let k = i; k < i + 3; k++) t.push([P.getX(k), P.getY(k), P.getZ(k), N.getX(k), N.getY(k), N.getZ(k), U.getX(k), U.getY(k)]);
		tris.push(t);
	}
	return new Part(doc, [{ material, tris }], `proc(${path.basename(file)})`);
}

/** box-projected UVs: each vertex takes the two axes its normal is NOT along */
export function boxUV(/** @type {any} */ geo, tile = 1) {
	const g = geo.index ? geo.toNonIndexed() : geo;
	g.computeVertexNormals();
	const p = g.attributes.position;
	const n = g.attributes.normal;
	const uv = new Float32Array(p.count * 2);
	for (let i = 0; i < p.count; i++) {
		const c = [p.getX(i), p.getY(i), p.getZ(i)];
		const a = [Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))];
		const dom = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
		const [u, v] = [0, 1, 2].filter((k) => k !== dom);
		uv[i * 2] = c[u] / tile;
		uv[i * 2 + 1] = 1 - c[v] / tile;
	}
	g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	return g;
}

// ---------------------------------------------------------------- clips

const D2R = Math.PI / 180;
/** quaternion [x,y,z,w] for an axis ('x'|'y'|'z') and degrees */
export function quat(/** @type {'x'|'y'|'z'} */ axis, /** @type {number} */ deg) {
	const h = (deg * D2R) / 2;
	const s = Math.sin(h);
	return [axis === 'x' ? s : 0, axis === 'y' ? s : 0, axis === 'z' ? s : 0, Math.cos(h)];
}

/** smoothstep-eased keys from a to b over `dur` s @param {(u: number) => number[]} at value at u ∈ [0,1] */
export function ease(/** @type {(u: number) => number[]} */ at, dur = 1, steps = 10, curve = (/** @type {number} */ u) => u * u * (3 - 2 * u)) {
	const keys = [];
	for (let i = 0; i <= steps; i++) {
		const u = i / steps;
		keys.push([+(u * dur).toFixed(4), at(curve(u))]);
	}
	return keys;
}

/** keys for a hinge rotating about `axis` from `from` to `to` degrees */
export const swing = (/** @type {'x'|'y'|'z'} */ axis, /** @type {number} */ from, /** @type {number} */ to, dur = 1, steps = 10) =>
	ease((u) => quat(axis, from + (to - from) * u), dur, steps);
/** keys for a slide of `pivot` + offset from `a` to `b` (metres, node space of the parent) */
export const slide = (/** @type {number[]} */ pivot, /** @type {number[]} */ a, /** @type {number[]} */ b, dur = 1, steps = 10) =>
	ease((u) => pivot.map((p, k) => p + a[k] + (b[k] - a[k]) * u), dur, steps);

/** a key list played backwards (close = reversed open) */
export const reverse = (/** @type {[number, number[]][]} */ keys) => {
	const end = keys[keys.length - 1][0];
	return keys.slice().reverse().map(([t, v]) => /** @type {[number, number[]]} */ ([+(end - t).toFixed(4), v]));
};

// ---------------------------------------------------------------- assemble

/**
 * @typedef {{node: string, path: 'rotation'|'translation'|'scale'|'weights', keys: [number, number[]][]}} Track
 * @typedef {{name: string, tracks: Track[]}} Clip
 */

/**
 * One GLB from parts: a named node per part (origin = its pivot), its clips (+ the static
 * `idle` first), the behavior in scene.extras.
 * @param {Part[]} parts @param {string} out
 * @param {{clips?: Clip[], behavior?: any, morph?: Record<string, {targets: number[][][][]}>, extras?: any, doubleSided?: boolean | null}} [o]
 */
export async function assemble(parts, out, o = {}) {
	const names = new Set();
	const docs = [];
	/** @type {any[]} */
	const sourceExtras = [];
	for (const p of parts) {
		if (!p.name) throw new Error(`a part from ${p.label} has no name: call .at(name, pivot)`);
		if (names.has(p.name)) throw new Error(`two parts named ${p.name}`);
		names.add(p.name);
		const doc = cloneDocument(p.doc).setLogger(QUIET);
		// the clone's materials, matched by index to the part's (same source doc)
		const srcMats = p.doc.getRoot().listMaterials();
		const dstMats = doc.getRoot().listMaterials();
		const ext = p.doc.getRoot().getAsset().extras;
		if (ext && Object.keys(ext).length) sourceExtras.push({ part: p.name, from: p.label, ...ext });
		for (const s of doc.getRoot().listScenes()) for (const n of s.listChildren()) n.dispose();
		for (const n of doc.getRoot().listNodes()) n.dispose();
		for (const m of doc.getRoot().listMeshes()) m.dispose();
		const mesh = doc.createMesh(p.name);
		const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
		const morph = o.morph?.[p.name];
		for (const [pi, piece] of p.pieces.entries()) {
			const matIndex = srcMats.indexOf(piece.material);
			let material = matIndex >= 0 ? dstMats[matIndex] : null;
			if (!material && piece.material) {
				// a material made in proc() (a clone) lives in p.doc too, so the index lookup finds it
				throw new Error(`${p.name}: material not in its source doc`);
			}
			if (material && (p.doubleSided ?? o.doubleSided) !== null && (p.doubleSided ?? o.doubleSided) !== undefined) material.setDoubleSided(/** @type {boolean} */ (p.doubleSided ?? o.doubleSided));
			const n = piece.tris.length * 3;
			const arrs = { POSITION: new Float32Array(n * 3), NORMAL: new Float32Array(n * 3), TEXCOORD_0: new Float32Array(n * 2) };
			let a = 0;
			let b = 0;
			for (const t of piece.tris)
				for (const v of t) {
					arrs.POSITION[a] = v[0] - p.pivot[0];
					arrs.POSITION[a + 1] = v[1] - p.pivot[1];
					arrs.POSITION[a + 2] = v[2] - p.pivot[2];
					arrs.NORMAL[a] = v[3];
					arrs.NORMAL[a + 1] = v[4];
					arrs.NORMAL[a + 2] = v[5];
					arrs.TEXCOORD_0[b] = v[6];
					arrs.TEXCOORD_0[b + 1] = v[7];
					a += 3;
					b += 2;
				}
			const prim = doc.createPrimitive().setMaterial(material);
			for (const s of LAYOUT) prim.setAttribute(s, doc.createAccessor().setType(s === 'TEXCOORD_0' ? 'VEC2' : 'VEC3').setArray(/** @type {any} */ (arrs)[s]).setBuffer(buffer));
			if (morph) {
				// morph targets: per target, per piece, the displaced POSITIONS in the same vertex order
				for (const target of morph.targets) {
					const disp = new Float32Array(n * 3);
					let i = 0;
					for (const t of target[pi]) for (const v of t) for (let k = 0; k < 3; k++) disp[i] = v[k] - p.pivot[k] - arrs.POSITION[i++];
					prim.addTarget(doc.createPrimitiveTarget().setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(disp).setBuffer(buffer)));
				}
			}
			mesh.addPrimitive(prim);
		}
		if (morph) mesh.setWeights(morph.targets.map(() => 0));
		const node = doc.createNode(p.name).setMesh(mesh).setTranslation(/** @type {any} */ (p.pivot));
		if (p.rotation) node.setRotation(/** @type {any} */ (p.rotation));
		doc.getRoot().listScenes()[0].addChild(node);
		// weld everything except morph-targeted meshes (weld would merge the target-less copies wrongly)
		await doc.transform(...(morph ? [] : [weld()]), prune());
		docs.push(doc);
	}
	// merge into the first doc
	const target = docs[0];
	for (const d of docs.slice(1)) mergeDocuments(target, d);
	const scenes = target.getRoot().listScenes();
	const scene = scenes[0];
	for (const s of scenes.slice(1)) {
		for (const n of s.listChildren()) scene.addChild(n);
		s.dispose();
	}
	const buffers = target.getRoot().listBuffers();
	for (const acc of target.getRoot().listAccessors()) acc.setBuffer(buffers[0]);
	for (const b of buffers.slice(1)) b.dispose();
	// nest parented parts (their pivots are in assembled space: make them parent-relative)
	const byName = new Map(target.getRoot().listNodes().map((/** @type {any} */ n) => [n.getName(), n]));
	for (const p of parts)
		if (p.parent) {
			const parent = byName.get(p.parent);
			const node = byName.get(p.name);
			const pp = parts.find((q) => q.name === p.parent)?.pivot ?? [0, 0, 0];
			scene.removeChild(node);
			parent.addChild(node);
			node.setTranslation(p.pivot.map((v, k) => v - pp[k]));
		}
	// clips: idle first (every animated node's rest TRS, held 1 s), then the authored ones
	const clips = o.clips ?? [];
	const buf = buffers[0];
	const rest = (/** @type {any} */ node, /** @type {string} */ p) =>
		p === 'rotation' ? node.getRotation() : p === 'translation' ? node.getTranslation() : p === 'scale' ? node.getScale() : node.getMesh().getWeights();
	if (clips.length) {
		const seen = new Set();
		/** @type {Track[]} */
		const idle = [];
		for (const c of clips)
			for (const t of c.tracks) {
				const k = t.node + '.' + t.path;
				if (seen.has(k)) continue;
				seen.add(k);
				const node = byName.get(t.node);
				if (!node) throw new Error(`clip ${c.name}: no node ${t.node}`);
				const v = [...rest(node, t.path)];
				idle.push({ node: t.node, path: t.path, keys: [[0, v], [1, v]] });
			}
		for (const c of [{ name: 'idle', tracks: idle }, ...clips]) {
			const anim = target.createAnimation(c.name);
			for (const t of c.tracks) {
				const node = byName.get(t.node);
				if (!node) throw new Error(`clip ${c.name}: no node ${t.node}`);
				const times = new Float32Array(t.keys.map(([s]) => s));
				const vals = new Float32Array(t.keys.flatMap(([, v]) => v));
				const sampler = target
					.createAnimationSampler()
					.setInput(target.createAccessor().setType('SCALAR').setArray(times).setBuffer(buf))
					.setOutput(target.createAccessor().setType(t.path === 'rotation' ? 'VEC4' : t.path === 'weights' ? 'SCALAR' : 'VEC3').setArray(vals).setBuffer(buf))
					.setInterpolation('LINEAR');
				anim.addSampler(sampler);
				anim.addChannel(target.createAnimationChannel().setTargetNode(node).setTargetPath(t.path).setSampler(sampler));
			}
		}
	}
	if (o.behavior) scene.setExtras({ ...scene.getExtras(), behavior: o.behavior });
	const asset = target.getRoot().getAsset();
	asset.extras = { ...(o.extras ?? {}), sources: sourceExtras };
	await target.transform(dedup(), prune({ keepLeaves: true }));
	fs.mkdirSync(path.dirname(out), { recursive: true });
	await io.write(out, target);
	const b = getBounds(scene);
	return {
		out,
		bytes: fs.statSync(out).size,
		tris: parts.reduce((n, p) => n + p.triCount(), 0),
		nodes: parts.map((p) => p.name),
		clips: ['idle', ...clips.map((c) => c.name)].filter((_, i) => clips.length || i > 0),
		bounds: { min: b.min.map((v) => +v.toFixed(3)), max: b.max.map((v) => +v.toFixed(3)) }
	};
}

export { Document };
