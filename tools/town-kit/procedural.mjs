// The hand-built half of town-kit (0 credits): pieces whose value is an EXACT shape or a
// seamless surface — the street tiles (cobble road, curb, corner, crossing, sidewalk) share
// one tileable paving texture per material, so a street of many 2 × 2 m tiles reads as ONE
// pavement; the fence and the garden gate tile edge to edge on the 2 m grid; the gate is a
// FUNCTIONAL door (P2: static frame + a hinged Leaf node + "open"/"close" clips); banners and
// the blank signpost are thin cloth/boards a text-to-3D model draws badly.
//
// Geometry: three.js primitives written with glTF-Transform, UV'd by a box projection at a
// per-material texel density (paving: one texture period per 2 m, so tiles continue).
// Static pieces are FLAT for sync (props-kit finding 2): one node per material directly under
// the scene, identity transform, origin = pivot. An ANIMATED piece (the gate) replicates as
// its original file bytes (core animatedImports `objectfile`), so its Leaf node may carry a
// translation (the hinge).
//
// No two faces of a piece are coplanar and overlapping (the moving-camera flicker of K1):
// parts that meet share an edge or touch back to back, never a visible plane.
//
//   node procedural.mjs <outDir> [Name,…]   → <outDir>/<Name>.glb
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SWATCHES, jpeg } from './textures.mjs';
import { PAVING } from './stones.mjs';
import { TOOLS } from './kit-post.mjs';

const THREE = await import(`${TOOLS}/node_modules/three/build/three.module.js`);
const { mergeGeometries } = await import(`${TOOLS}/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js`);
const { Document, NodeIO } = await import(`${TOOLS}/node_modules/@gltf-transform/core/dist/index.js`);

/** Box-project UVs: each vertex takes the two axes its normal is NOT along; `tile` metres per UV unit. */
function boxUV(geo, tile) {
	if (geo.index) geo = geo.toNonIndexed();
	geo.computeVertexNormals();
	const p = geo.attributes.position;
	const n = geo.attributes.normal;
	const uv = new Float32Array(p.count * 2);
	for (let i = 0; i < p.count; i++) {
		const c = [p.getX(i), p.getY(i), p.getZ(i)];
		const a = [Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))];
		const dom = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
		const [u, v] = [0, 1, 2].filter((k) => k !== dom);
		uv[i * 2] = c[u] / tile;
		uv[i * 2 + 1] = 1 - c[v] / tile;
	}
	geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	return geo;
}

/** an axis-aligned box from lo to hi (metres); `seg` tessellates x and z (big slabs crack on
 * the near plane as one triangle pair — scifi-kit's station e2e) */
const B = (lo, hi, seg = 1) =>
	new THREE.BoxGeometry(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], seg, 1, seg).translate((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
/** a cylinder along Y, bottom at y */
const C = (r, h, x = 0, y = 0, z = 0, seg = 12, r2 = r) => new THREE.CylinderGeometry(r2, r, h, seg).translate(x, y + h / 2, z);
const rad = (d) => (d * Math.PI) / 180;
/** euler (deg) + translation */
const at = (geo, { rx = 0, ry = 0, rz = 0, t = [0, 0, 0] } = {}) =>
	geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...t), new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(rx), rad(ry), rad(rz))), new THREE.Vector3(1, 1, 1)));
/** a 2D outline (x, y pairs) extruded `depth` along +z from z0 */
function prism(points, z0, depth) {
	const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
	return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }).translate(0, 0, z0);
}
/** a tube along a curve with its own UVs in metres (u along, v around) */
function tube(curve, r, seg = 24, radial = 8) {
	const g = new THREE.TubeGeometry(curve, seg, r, radial, false);
	const len = curve.getLength();
	const uv = g.attributes.uv;
	for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len, uv.getY(i) * 2 * Math.PI * r);
	g.userData.ownUV = true;
	return g;
}
/** cloth outline: a swallowtail banner w wide from top down to bottom, notch rising `notch` */
const swallowtail = (w, top, bottom, notch) => [
	[-w / 2, top],
	[w / 2, top],
	[w / 2, bottom],
	[0, bottom + notch],
	[-w / 2, bottom]
];
/** planar UVs over the cloth's own rect (so the emblem is centred) */
function clothUV(geo, x0, x1, y0, y1) {
	if (geo.index) geo = geo.toNonIndexed();
	geo.computeVertexNormals();
	const p = geo.attributes.position;
	const uv = new Float32Array(p.count * 2);
	for (let i = 0; i < p.count; i++) {
		uv[i * 2] = (p.getX(i) - x0) / (x1 - x0);
		uv[i * 2 + 1] = (p.getY(i) - y0) / (y1 - y0);
	}
	geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	geo.userData.ownUV = true;
	return geo;
}

// material: texture source, metres per texture period, PBR factors
const MATS = {
	cobble: { paving: 'cobble', tile: 2, rough: 0.9, metal: 0 },
	flags: { paving: 'flags', tile: 2, rough: 0.85, metal: 0 },
	pale: { paving: 'pale', tile: 2, rough: 0.8, metal: 0 },
	granite: { swatch: 'granite', tile: 1, rough: 0.8, metal: 0 },
	oak: { swatch: 'oak', tile: 1, rough: 0.75, metal: 0 },
	oakPlanks: { swatch: 'oakPlanks', tile: 1, rough: 0.75, metal: 0 },
	pickets: { swatch: 'pickets', tile: 1, rough: 0.7, metal: 0 },
	iron: { swatch: 'iron', tile: 0.5, rough: 0.55, metal: 0.7 },
	cloth: { swatch: 'cloth', tile: 1, rough: 0.9, metal: 0, double: true },
	terracotta: { swatch: 'terracotta', tile: 1, rough: 0.7, metal: 0 },
	gold: { swatch: 'gold', tile: 0.5, rough: 0.35, metal: 0.8 }
};

const pavingCache = new Map();

class Piece {
	constructor(name) {
		this.name = name;
		/** node name ('' = the flat static part) → material → geometries
		 * @type {Map<string, {t: number[], parts: Map<string, any[]>}>} */
		this.nodes = new Map([['', { t: [0, 0, 0], parts: new Map() }]]);
		this.cur = '';
		/** @type {{name: string, node: string, times: number[], angles: number[]}[]} */
		this.clips = [];
		/** scene extras (core: GLTFLoader → root userData; colliderHint → colliderSpec) */
		this.extras = {};
	}
	/** following add()s go into node `name`, whose origin sits at `t` (geometry in node-local coords) */
	node(name, t = [0, 0, 0]) {
		if (!this.nodes.has(name)) this.nodes.set(name, { t, parts: new Map() });
		this.cur = name;
		return this;
	}
	add(mat, ...geos) {
		const parts = this.nodes.get(this.cur).parts;
		if (!parts.has(mat)) parts.set(mat, []);
		parts.get(mat).push(...geos);
		return this;
	}
	/** a Y-rotation clip on node `node`: angles (deg) at times (s) */
	clip(name, node, times, angles) {
		this.clips.push({ name, node, times, angles });
		return this;
	}
	async material(doc, key) {
		const spec = MATS[key];
		const m = doc.createMaterial(key).setRoughnessFactor(spec.rough).setMetallicFactor(spec.metal);
		if (spec.double) m.setDoubleSided(true);
		if (spec.paving) {
			if (!pavingCache.has(spec.paving)) pavingCache.set(spec.paving, await PAVING[spec.paving]());
			const { albedo, normal } = pavingCache.get(spec.paving);
			m.setBaseColorTexture(doc.createTexture(key).setImage(albedo).setMimeType('image/jpeg'));
			m.setNormalTexture(doc.createTexture(`${key}_n`).setImage(normal).setMimeType('image/jpeg'));
		} else m.setBaseColorTexture(doc.createTexture(key).setImage(await jpeg(SWATCHES[spec.swatch](), 512)).setMimeType('image/jpeg'));
		return m;
	}
	async doc() {
		const doc = new Document();
		const buffer = doc.createBuffer();
		const scene = doc.createScene(this.name);
		const mats = new Map();
		const acc = (arr, type) => doc.createAccessor().setArray(arr).setType(type).setBuffer(buffer);
		const prim = async (key, geos) => {
			if (!mats.has(key)) mats.set(key, await this.material(doc, key));
			const g = mergeGeometries(
				geos.map((x) => (x.userData.ownUV ? (x.index ? x.toNonIndexed() : x) : boxUV(x, MATS[key].tile))),
				false
			);
			if (!g.attributes.normal) g.computeVertexNormals();
			const p = doc
				.createPrimitive()
				.setMaterial(mats.get(key))
				.setAttribute('POSITION', acc(new Float32Array(g.attributes.position.array), 'VEC3'))
				.setAttribute('NORMAL', acc(new Float32Array(g.attributes.normal.array), 'VEC3'))
				.setAttribute('TEXCOORD_0', acc(new Float32Array(g.attributes.uv.array), 'VEC2'));
			if (g.index) p.setIndices(acc(new Uint32Array(g.index.array), 'SCALAR'));
			return p;
		};
		const byName = new Map();
		for (const [name, { t, parts }] of this.nodes) {
			if (!parts.size) continue;
			if (name === '') {
				// static: one node per material (flat for sync)
				for (const [key, geos] of parts) {
					const nm = `${this.name}_${key}`;
					scene.addChild(doc.createNode(nm).setMesh(doc.createMesh(nm).addPrimitive(await prim(key, geos))));
				}
			} else {
				// an animated node: one mesh, one primitive per material, origin at the hinge
				const mesh = doc.createMesh(name);
				for (const [key, geos] of parts) mesh.addPrimitive(await prim(key, geos));
				const node = doc.createNode(name).setMesh(mesh).setTranslation(/** @type {any} */ (t));
				scene.addChild(node);
				byName.set(name, node);
			}
		}
		for (const c of this.clips) {
			const input = acc(new Float32Array(c.times), 'SCALAR');
			const q = c.angles.flatMap((a) => [0, Math.sin(rad(a) / 2), 0, Math.cos(rad(a) / 2)]);
			const sampler = doc.createAnimationSampler().setInput(input).setOutput(acc(new Float32Array(q), 'VEC4')).setInterpolation('LINEAR');
			const channel = doc.createAnimationChannel().setTargetNode(byName.get(c.node)).setTargetPath('rotation').setSampler(sampler);
			doc.createAnimation(c.name).addSampler(sampler).addChannel(channel);
		}
		if (Object.keys(this.extras).length) scene.setExtras(this.extras);
		doc.getRoot().getAsset().generator = 'theprototype town-kit procedural.mjs';
		doc.getRoot().getAsset().extras = { townKit: { source: 'procedural', piece: this.name } };
		return doc;
	}
}

// ------------------------------------------------------------------ street tiles
// A street runs along X. Road top 0.20 m, curb + sidewalk top 0.35 m (a 15 cm kerb).
// The curb is the +Z edge of its tile; rotate the tile to put it on another side.
const ROAD_Y = 0.2;
const WALK_Y = 0.35;
const CURB = 0.25; // curb width
const SEG = 8;

function Road() {
	const p = new Piece('Road').add('cobble', B([-1, 0, -1], [1, ROAD_Y, 1], SEG));
	p.extras.colliderHint = 'box';
	return p;
}
function Sidewalk() {
	const p = new Piece('Sidewalk').add('flags', B([-1, 0, -1], [1, WALK_Y, 1], SEG));
	p.extras.colliderHint = 'box';
	return p;
}
function RoadCurb() {
	const p = new Piece('RoadCurb')
		.add('cobble', B([-1, 0, -1], [1, ROAD_Y, 1 - CURB], SEG))
		.add('granite', B([-1, 0, 1 - CURB], [1, WALK_Y, 1], 4));
	p.extras.colliderHint = 'box';
	return p;
}
/** an outer corner: curbs on +Z and +X (the sidewalk wraps round the corner) */
function RoadCorner() {
	const e = 1 - CURB;
	const p = new Piece('RoadCorner')
		.add('cobble', B([-1, 0, -1], [e, ROAD_Y, e], SEG))
		.add('granite', B([-1, 0, e], [1, WALK_Y, 1], 4), B([e, 0, -1], [1, WALK_Y, e], 4));
	p.extras.colliderHint = 'box';
	return p;
}
/** a pedestrian crossing: a band of pale slabs across the street (|x| < 0.5), flush with the cobbles */
function RoadCrossing() {
	const p = new Piece('RoadCrossing')
		.add('cobble', B([-1, 0, -1], [-0.5, ROAD_Y, 1], 4), B([0.5, 0, -1], [1, ROAD_Y, 1], 4))
		.add('pale', B([-0.5, 0, -1], [0.5, ROAD_Y, 1], SEG));
	p.extras.colliderHint = 'box';
	return p;
}

// ------------------------------------------------------------------ fence + gate
// A 2 m section with HALF posts at both ends: two sections side by side make one whole post
// (back to back, no shared visible face), so runs tile on the 2 m grid without doubled posts.
const PICKET_W = 0.08;
/** pointed pickets from x0 to x1 (centres spaced `step`), front face at z = zf */
function pickets(x0, x1, y0, y1, zf, step = 0.14) {
	const out = [];
	const n = Math.floor((x1 - x0) / step) + 1;
	const start = (x0 + x1) / 2 - ((n - 1) * step) / 2;
	for (let i = 0; i < n; i++) {
		const c = start + i * step;
		const h = PICKET_W / 2;
		out.push(prism([[c - h, y0], [c + h, y0], [c + h, y1 - 0.06], [c, y1], [c - h, y1 - 0.06]], zf - 0.022, 0.022));
	}
	return out;
}
function Fence() {
	const p = new Piece('Fence');
	p.add('oak', B([-1, 0, -0.06], [-0.94, 1.05, 0.06]), B([0.94, 0, -0.06], [1, 1.05, 0.06]));
	p.add('oak', B([-0.94, 0.28, -0.05], [0.94, 0.36, -0.005]), B([-0.94, 0.7, -0.05], [0.94, 0.78, -0.005]));
	p.add('pickets', ...pickets(-0.86, 0.86, 0.06, 0.95, 0.017));
	p.extras.colliderHint = 'box';
	return p;
}
/** the garden gate: FRAME (two posts + a lintel, static) and LEAF (hinged on the left post) */
const GATE = { hinge: -0.87, leaf: 1.74, open: -95, seconds: 0.9 };
function FenceGate() {
	const p = new Piece('FenceGate');
	// frame: full posts inside the cell (x 0.88..1.0) — a neighbouring fence's half post
	// touches them back to back; the lintel sits BELOW the post tops (no shared top plane)
	p.add('oak', B([-1, 0, -0.06], [-0.88, 1.96, 0.06]), B([0.88, 0, -0.06], [1, 1.96, 0.06]), B([-0.88, 1.78, -0.05], [0.88, 1.9, 0.05]));
	p.add('terracotta', at(new THREE.ConeGeometry(0.1, 0.14, 4), { ry: 45, t: [-0.94, 2.03, 0] }), at(new THREE.ConeGeometry(0.1, 0.14, 4), { ry: 45, t: [0.94, 2.03, 0] }));
	p.add('iron', B([-0.885, 0.26, 0.02], [-0.86, 0.36, 0.045]), B([-0.885, 0.76, 0.02], [-0.86, 0.86, 0.045]), B([0.86, 0.5, 0.02], [0.885, 0.6, 0.05]));
	// leaf, in hinge-local coords (x from the hinge line along the leaf, z as the world's)
	p.node('Leaf', [GATE.hinge, 0, 0]);
	const L = GATE.leaf;
	p.add('pickets', ...pickets(0.06, L - 0.06, 0.08, 1.05, 0.017, 0.13));
	p.add('oak', B([0.02, 0.24, -0.05], [L - 0.02, 0.32, -0.005]), B([0.02, 0.74, -0.05], [L - 0.02, 0.82, -0.005]));
	// the diagonal brace, from the bottom hinge side up to the latch side
	const dx = L - 0.12;
	const dy = 0.42;
	p.add('oak', at(B([-Math.hypot(dx, dy) / 2, -0.035, -0.05], [Math.hypot(dx, dy) / 2, 0.035, -0.006]), { rz: (Math.atan2(dy, dx) * 180) / Math.PI, t: [L / 2, 0.53, 0] }));
	p.add('iron', B([0, 0.27, 0.017], [0.38, 0.33, 0.03]), B([0, 0.77, 0.017], [0.38, 0.83, 0.03]), B([L - 0.12, 0.52, 0.017], [L - 0.04, 0.58, 0.04]));
	// clips: eased 0 → open (swings toward +Z, the front), and back
	const ease = [0, 0.15, 0.5, 0.85, 1];
	const times = ease.map((_, i) => +((GATE.seconds * i) / (ease.length - 1)).toFixed(3));
	p.clip('open', 'Leaf', times, ease.map((e) => GATE.open * e));
	p.clip('close', 'Leaf', times, ease.map((e) => GATE.open * (1 - e)));
	return p;
}

// ------------------------------------------------------------------ banners + signpost
/** a wall banner: back plane z = 0 (the wall), bottom-centre-back pivot, hangs from an iron rod */
function Banner() {
	const p = new Piece('Banner');
	p.add('iron', B([-0.36, 1.86, 0], [-0.32, 1.9, 0.14]), B([0.32, 1.86, 0], [0.36, 1.9, 0.14]));
	p.add('iron', at(new THREE.CylinderGeometry(0.016, 0.016, 0.98, 8), { rz: 90, t: [0, 1.84, 0.12] }));
	p.add('gold', new THREE.SphereGeometry(0.035, 10, 8).translate(-0.5, 1.84, 0.12), new THREE.SphereGeometry(0.035, 10, 8).translate(0.5, 1.84, 0.12));
	p.add('cloth', clothUV(prism(swallowtail(0.8, 1.83, 0.4, 0.22), 0.1, 0.01), -0.4, 0.4, 0.4, 1.83));
	return p;
}
/** a free-standing banner pole on a granite footing */
function BannerPole() {
	const p = new Piece('BannerPole');
	p.add('granite', B([-0.25, 0, -0.25], [0.25, 0.3, 0.25]));
	p.add('oak', C(0.05, 3.3, 0, 0.3, 0, 10), at(new THREE.CylinderGeometry(0.03, 0.03, 1.04, 8), { rz: 90, t: [0, 3.3, 0.085] }));
	p.add('gold', new THREE.SphereGeometry(0.075, 12, 10).translate(0, 3.66, 0));
	p.add('cloth', clothUV(prism(swallowtail(0.9, 3.27, 1.55, 0.25), 0.06, 0.012), -0.45, 0.45, 1.55, 3.27));
	p.extras.colliderHint = 'cylinder';
	return p;
}
/** a blank finger signpost: oak post, three arrow boards pointing three ways (one terracotta) */
function Signpost() {
	const p = new Piece('Signpost');
	p.add('oak', B([-0.06, 0, -0.06], [0.06, 2.3, 0.06]));
	p.add('terracotta', at(new THREE.ConeGeometry(0.11, 0.16, 4), { ry: 45, t: [0, 2.38, 0] }));
	const board = (y, ry, mat) =>
		p.add(mat, at(prism([[0.06, -0.085], [0.74, -0.085], [0.86, 0], [0.74, 0.085], [0.06, 0.085]], -0.02, 0.04), { ry, t: [0, y, 0] }));
	board(2.02, 0, 'oakPlanks');
	board(1.76, 150, 'terracotta');
	board(1.5, -65, 'oakPlanks');
	p.extras.colliderHint = 'box';
	return p;
}

// ------------------------------------------------------------------ wooden footbridge
/** a 4.4 m humpback plank footbridge along Z, 1.8 m wide, deck rising 0.42 m at mid-span */
function Bridge() {
	const p = new Piece('Bridge');
	const Lh = 2.2;
	const deck = (z) => 0.24 + 0.42 * (1 - (z / Lh) ** 2);
	const slope = (z) => (-2 * 0.42 * z) / (Lh * Lh);
	const n = 22;
	const step = (2 * Lh) / n;
	for (let i = 0; i < n; i++) {
		const z = -Lh + step * (i + 0.5);
		const ang = (Math.atan(slope(z)) * 180) / Math.PI;
		p.add('oakPlanks', at(B([-0.8, -0.06, -step / 2 + 0.012], [0.8, 0, step / 2 - 0.012]), { rx: -ang, t: [0, deck(z), z] }));
	}
	const curve = (x, dy, k = 1) => new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => -Lh * k + (2 * Lh * k * i) / 8).map((z) => new THREE.Vector3(x, deck(z) + dy, z)));
	// stringers under the planks, handrails and mid rails on both sides
	for (const x of [-0.62, 0.62]) p.add('oak', tube(curve(x, -0.14), 0.08, 24, 6));
	for (const x of [-0.84, 0.84]) p.add('oak', tube(curve(x, 0.92, 0.97), 0.04, 24, 8), tube(curve(x, 0.5, 0.97), 0.025, 24, 6));
	for (const x of [-0.84, 0.84]) for (const z of [-2.13, -1.06, 0, 1.06, 2.13]) p.add('oak', B([x - 0.045, deck(z) - 0.12, z - 0.045], [x + 0.045, deck(z) + 0.98, z + 0.045]));
	// ground sills at both ends (the bridge rests on them)
	for (const z of [-2.05, 2.05]) p.add('oak', B([-0.95, 0, z - 0.12], [0.95, deck(z) - 0.2, z + 0.12]));
	p.extras.colliderHint = 'hull';
	return p;
}

export const PIECES = { Road, Sidewalk, RoadCurb, RoadCorner, RoadCrossing, Fence, FenceGate, Banner, BannerPole, Signpost, Bridge };
export { GATE };

/** write one piece's GLB */
export async function writePiece(name, file) {
	const doc = await PIECES[name]().doc();
	await new NodeIO().write(file, doc);
	return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [out, only] = process.argv.slice(2);
	fs.mkdirSync(out, { recursive: true });
	for (const n of only ? only.split(',') : Object.keys(PIECES)) console.log(await writePiece(n, path.join(out, `${n}.glb`)));
}
