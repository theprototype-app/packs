// The hand-built half of props-kit: pieces whose value is an EXACT shape or an EXACT
// pivot rather than a sculpted look — the game-logic props (a lever whose handle
// swings on its hinge, a trapdoor hinged on its back edge, a 1 × 1 m pressure plate
// on the grid), plus flat/thin pieces a text-to-3D model renders badly (rug,
// tapestry, ladder, signpost). Geometry is three.js primitives written with
// glTF-Transform; textures are textures.mjs swatches, UV'd by a box projection at a
// fixed texel density so every piece shares one scale of grain.
//
//   node procedural.mjs <outDir>        → <outDir>/<Name>.glb for every piece below
import fs from 'node:fs';
import path from 'node:path';
import { SWATCHES, rugSvg, tapestrySvg, jpeg } from './textures.mjs';

const TOOLS = process.env.MESHY_TOOLS ?? '/home/deck/.code/theprototype-app/packs-lane-30c-tools/tools/meshy';
const THREE = await import(`${TOOLS}/node_modules/three/build/three.module.js`);
const { mergeGeometries } = await import(`${TOOLS}/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js`);
const { Document, NodeIO } = await import(`${TOOLS}/node_modules/@gltf-transform/core/dist/index.js`);
const { KHRMaterialsEmissiveStrength } = await import(`${TOOLS}/node_modules/@gltf-transform/extensions/dist/index.js`);

/** texels: one swatch tile covers this many metres */
const TILE_M = 0.8;

/** Box-project UVs: each vertex takes the two axes its normal is NOT along, the grain
 * axis (0 x, 1 y, 2 z) mapped to u, so wood grain runs along a part's length. */
function boxUV(geo, grain = 0, tile = TILE_M) {
	const p = geo.attributes.position;
	const n = geo.attributes.normal;
	const uv = new Float32Array(p.count * 2);
	for (let i = 0; i < p.count; i++) {
		const c = [p.getX(i), p.getY(i), p.getZ(i)];
		const a = [Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))];
		const dom = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
		const axes = [0, 1, 2].filter((k) => k !== dom);
		const u = axes.includes(grain) ? grain : axes[0];
		const v = axes.find((k) => k !== u);
		uv[i * 2] = c[u] / tile;
		uv[i * 2 + 1] = c[v] / tile;
	}
	geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	return geo;
}

/** a box of size sx,sy,sz whose BOTTOM-centre sits at (x,y,z) */
const box = (sx, sy, sz, x = 0, y = 0, z = 0, grain = 0) => boxUV(new THREE.BoxGeometry(sx, sy, sz).translate(x, y + sy / 2, z), grain);
/** a cylinder along Y, bottom at y */
const cyl = (r, h, x = 0, y = 0, z = 0, seg = 12, r2 = r) => boxUV(new THREE.CylinderGeometry(r2, r, h, seg).translate(x, y + h / 2, z), 1);
/** apply a matrix built from euler (deg) + translation */
const place = (geo, { rx = 0, ry = 0, rz = 0, t = [0, 0, 0] } = {}) =>
	geo.applyMatrix4(
		new THREE.Matrix4().compose(
			new THREE.Vector3(...t),
			new THREE.Quaternion().setFromEuler(new THREE.Euler((rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180)),
			new THREE.Vector3(1, 1, 1)
		)
	);

// ------------------------------------------------------------------ flames
// A flame is its OWN node ("Flame…") with an emissive, untextured material, so a torch,
// lantern or candle reads as lit in any scene, and a game can hide/show the flame
// (lit/unlit) without touching the prop. KHR_materials_emissive_strength lifts it
// over 1.0 so the app's bloom picks it up.

/** a low-poly teardrop, base at y = 0, ~0.17 m tall at scale 1 */
export function flameGeometry(scale = 1) {
	const prof = [[0, 0], [0.03, 0.012], [0.042, 0.04], [0.036, 0.08], [0.02, 0.125], [0.006, 0.16], [0, 0.175]].map(([r, y]) => new THREE.Vector2(r * scale, y * scale));
	const g = new THREE.LatheGeometry(prof, 8);
	g.computeVertexNormals();
	const uv = new Float32Array(g.attributes.position.count * 2);
	g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	return g;
}

/** the shared flame material (one per document) */
export function flameMaterial(doc) {
	const found = doc.getRoot().listMaterials().find((m) => m.getName() === 'Flame');
	if (found) return found;
	const ext = doc.createExtension(KHRMaterialsEmissiveStrength);
	return doc
		.createMaterial('Flame')
		.setBaseColorFactor([0.25, 0.07, 0.01, 1])
		.setEmissiveFactor([1, 0.34, 0.03])
		.setRoughnessFactor(1)
		.setMetallicFactor(0)
		.setExtension('KHR_materials_emissive_strength', ext.createEmissiveStrength().setEmissiveStrength(1.15));
}

/** append flame nodes to an existing (post-processed) document: `list` = [{t:[x,y,z], s}] */
export function appendFlames(doc, list) {
	const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
	const buffer = doc.getRoot().listBuffers()[0];
	const mat = flameMaterial(doc);
	list.forEach(({ t, s = 1 }, i) => {
		const g = flameGeometry(s);
		const acc = (arr, type) => doc.createAccessor().setArray(arr).setType(type).setBuffer(buffer);
		const prim = doc
			.createPrimitive()
			.setMaterial(mat)
			.setAttribute('POSITION', acc(new Float32Array(g.attributes.position.array), 'VEC3'))
			.setAttribute('NORMAL', acc(new Float32Array(g.attributes.normal.array), 'VEC3'))
			.setIndices(acc(new Uint32Array(g.index.array), 'SCALAR'));
		const node = doc.createNode(list.length > 1 ? `Flame${i + 1}` : 'Flame').setMesh(doc.createMesh('Flame').addPrimitive(prim)).setTranslation(t);
		scene.addChild(node);
	});
}

const MATS = {
	oak: { swatch: 'oak', rough: 0.78, metal: 0 },
	oakPlanks: { swatch: 'oakPlanks', rough: 0.8, metal: 0 },
	iron: { swatch: 'iron', rough: 0.55, metal: 0.75 },
	brass: { swatch: 'brass', rough: 0.35, metal: 0.9 },
	sandstone: { swatch: 'sandstone', rough: 0.92, metal: 0 },
	slate: { swatch: 'slate', rough: 0.85, metal: 0 },
	teal: { swatch: 'teal', rough: 0.6, metal: 0 },
	cloth: { swatch: 'cloth', rough: 0.95, metal: 0 },
	wallStone: { swatch: 'wallStone', rough: 0.9, metal: 0 },
	flame: { flame: true }
};

class Piece {
	constructor(name) {
		this.name = name;
		this.doc = new Document();
		this.doc.createBuffer();
		this.scene = this.doc.createScene(name);
		this.root = this.doc.createNode(name);
		this.scene.addChild(this.root);
		this.mats = new Map();
	}
	async material(key, custom) {
		if (this.mats.has(key)) return this.mats.get(key);
		const spec = custom ?? MATS[key];
		if (spec.flame) {
			const m = flameMaterial(this.doc);
			this.mats.set(key, m);
			return m;
		}
		const m = this.doc.createMaterial(key).setRoughnessFactor(spec.rough).setMetallicFactor(spec.metal);
		const svg = spec.svg ?? SWATCHES[spec.swatch]();
		const tex = this.doc.createTexture(key).setImage(await jpeg(svg, spec.size ?? 512)).setMimeType('image/jpeg');
		m.setBaseColorTexture(tex);
		if (spec.doubleSided) m.setDoubleSided(true);
		this.mats.set(key, m);
		return m;
	}
	/** one mesh node from {matKey: geometry[]}; returns the node (parented to `parent`) */
	async part(name, byMat, { t = [0, 0, 0], r = [0, 0, 0, 1], parent = this.root } = {}) {
		const mesh = this.doc.createMesh(name);
		for (const [key, geos] of Object.entries(byMat)) {
			const g = mergeGeometries(geos.map((x) => (x.index ? x : x)), false);
			const prim = this.doc.createPrimitive().setMaterial(await this.material(key));
			const acc = (arr, type) => this.doc.createAccessor().setArray(arr).setType(type).setBuffer(this.doc.getRoot().listBuffers()[0]);
			prim.setAttribute('POSITION', acc(new Float32Array(g.attributes.position.array), 'VEC3'));
			prim.setAttribute('NORMAL', acc(new Float32Array(g.attributes.normal.array), 'VEC3'));
			prim.setAttribute('TEXCOORD_0', acc(new Float32Array(g.attributes.uv.array), 'VEC2'));
			prim.setIndices(acc(new Uint32Array(g.index.array), 'SCALAR'));
			mesh.addPrimitive(prim);
		}
		const node = this.doc.createNode(name).setMesh(mesh).setTranslation(t).setRotation(r);
		parent.addChild(node);
		return node;
	}
	async flame(name, t, scale = 1) {
		return this.part(name, { flame: [flameGeometry(scale)] }, { t });
	}
	async write(file) {
		const asset = this.doc.getRoot().getAsset();
		asset.generator = 'theprototype props-kit procedural.mjs';
		asset.extras = { propsKit: { source: 'procedural', piece: this.name } };
		await new NodeIO().registerExtensions([KHRMaterialsEmissiveStrength]).write(file, this.doc);
		return file;
	}
}

// ------------------------------------------------------------------ the pieces

/** LeverBase: a sandstone block with iron cheek plates; the hinge axle sits at y = 0.16 */
export const LEVER_HINGE_Y = 0.16;
async function leverBase() {
	const p = new Piece('LeverBase');
	const stone = [box(0.34, 0.1, 0.24), box(0.3, 0.03, 0.2, 0, 0.1)];
	const iron = [
		box(0.03, 0.1, 0.12, -0.09, 0.1),
		box(0.03, 0.1, 0.12, 0.09, 0.1),
		place(cyl(0.022, 0.21, 0, 0, 0, 12), { rz: 90, t: [0.105, LEVER_HINGE_Y, 0] }),
		box(0.2, 0.012, 0.03, 0, 0.13, 0.075),
		box(0.2, 0.012, 0.03, 0, 0.13, -0.075)
	];
	await p.part('LeverBase', { sandstone: stone, iron });
	return p;
}

/** LeverHandle: its ORIGIN is the hinge — rotate it about X (±35°) to throw the lever */
async function leverHandle() {
	const p = new Piece('LeverHandle');
	const iron = [place(cyl(0.028, 0.14, 0, 0, 0, 12), { rz: 90, t: [0.07, 0, 0] }), cyl(0.014, 0.36, 0, 0)];
	const oak = [cyl(0.026, 0.12, 0, 0.34, 0, 10, 0.03)];
	const teal = [boxUV(new THREE.SphereGeometry(0.038, 12, 8).translate(0, 0.47, 0), 1)];
	await p.part('LeverHandle', { iron, oak, teal });
	return p;
}

/** WallButton: back plate on the wall (origin = bottom-centre-BACK), a teal push cap */
async function wallButton() {
	const p = new Piece('WallButton');
	const iron = [box(0.2, 0.2, 0.025, 0, 0, 0.0125)];
	for (const [x, y] of [[-0.075, 0.025], [0.075, 0.025], [-0.075, 0.175], [0.075, 0.175]]) iron.push(place(cyl(0.01, 0.012, 0, 0, 0, 8), { rx: 90, t: [x, y, 0.031] }));
	const brass = [place(cyl(0.062, 0.02, 0, 0, 0, 20), { rx: 90, t: [0, 0.1, 0.035] })];
	const teal = [place(cyl(0.045, 0.035, 0, 0, 0, 20, 0.042), { rx: 90, t: [0, 0.1, 0.06] })];
	await p.part('WallButton', { iron, brass, teal });
	return p;
}

/** PressurePlate: exactly 1 × 1 m on the grid; a slate plate inset in a sandstone frame */
async function pressurePlate() {
	const p = new Piece('PressurePlate');
	const w = 1;
	const f = 0.12;
	const sandstone = [box(w, 0.05, f, 0, 0, -(w - f) / 2), box(w, 0.05, f, 0, 0, (w - f) / 2), box(f, 0.05, w - 2 * f, -(w - f) / 2, 0, 0, 2), box(f, 0.05, w - 2 * f, (w - f) / 2, 0, 0, 2)];
	const slate = [box(w - 2 * f - 0.02, 0.04, w - 2 * f - 0.02, 0, 0)];
	const teal = [box(0.3, 0.012, 0.3, 0, 0.04)];
	await p.part('PressurePlate', { sandstone, slate, teal });
	return p;
}

/** Hatch: a 1 × 1 m plank trapdoor; ORIGIN = its hinge line (bottom-centre-BACK), rotate about X to open */
async function hatch() {
	const p = new Piece('Hatch');
	const planks = [];
	for (let i = 0; i < 5; i++) planks.push(box(0.195, 0.06, 1, -0.4 + i * 0.2, 0, -0.5, 2));
	const iron = [box(1, 0.012, 0.08, 0, 0.06, -0.17), box(1, 0.012, 0.08, 0, 0.06, -0.83)];
	for (const x of [-0.3, 0.3]) iron.push(place(cyl(0.02, 0.14, 0, 0, 0, 10), { rz: 90, t: [x + 0.07, 0.02, -0.02] }));
	const ring = boxUV(new THREE.TorusGeometry(0.06, 0.012, 8, 20), 0);
	iron.push(place(ring, { rx: 90, t: [0, 0.075, -0.88] }), box(0.05, 0.02, 0.04, 0, 0.06, -0.92));
	// geometry is modelled hinge-at-origin, spanning z ∈ [-1, 0]: shift so the hinge line is the back edge
	for (const g of [...planks, ...iron]) g.translate(0, 0, 1);
	await p.part('Hatch', { oakPlanks: planks, iron });
	return p;
}

/** DoorKey: a grabbable 16 cm brass key lying flat, origin at its centre */
async function doorKey() {
	const p = new Piece('DoorKey');
	const brass = [
		place(boxUV(new THREE.TorusGeometry(0.028, 0.008, 8, 20), 0), { t: [-0.05, 0, 0] }),
		place(cyl(0.006, 0.11, 0, 0, 0, 8), { rz: 90, t: [0.075, 0, 0] }),
		box(0.012, 0.028, 0.008, 0.062, -0.028, 0),
		box(0.012, 0.02, 0.008, 0.044, -0.02, 0),
		place(cyl(0.011, 0.012, 0, 0, 0, 10), { rz: 90, t: [-0.016, 0, 0] })
	];
	const teal = [place(boxUV(new THREE.SphereGeometry(0.012, 10, 8), 0), { t: [-0.05, 0, 0] })];
	// modelled standing in XY; laid FLAT so it rests on a table or floor as dropped
	for (const g of [...brass, ...teal]) g.rotateX(-Math.PI / 2);
	await p.part('DoorKey', { brass, teal });
	return p;
}

/** Ladder: one storey (3 m), rails 0.45 m apart, rungs every 0.3 m */
async function ladder() {
	const p = new Piece('Ladder');
	const oak = [box(0.07, 3, 0.05, -0.225, 0, 0, 1), box(0.07, 3, 0.05, 0.225, 0, 0, 1)];
	for (let i = 0; i < 9; i++) oak.push(place(cyl(0.021, 0.46, 0, 0, 0, 8), { rz: 90, t: [0.23, 0.3 + i * 0.3, 0] }));
	const iron = [box(0.08, 0.04, 0.06, -0.225, 0), box(0.08, 0.04, 0.06, 0.225, 0)];
	await p.part('Ladder', { oak, iron });
	return p;
}

/** Rug: 2 × 1.3 m, 1.5 cm thick, cream fringe on the short ends */
async function rug() {
	const p = new Piece('Rug');
	const top = new THREE.BoxGeometry(2, 0.015, 1.3).translate(0, 0.0075, 0);
	// the woven layout covers the TOP face 0..1; the sides sample the border colour
	const uv = top.attributes.uv;
	const pos = top.attributes.position;
	const nrm = top.attributes.normal;
	for (let i = 0; i < uv.count; i++) {
		if (nrm.getY(i) > 0.5) uv.setXY(i, pos.getX(i) / 2 + 0.5, 0.5 - pos.getZ(i) / 1.3);
		else uv.setXY(i, 0.01, 0.01);
	}
	const fringe = [];
	for (const s of [-1, 1]) for (let i = 0; i < 16; i++) fringe.push(box(0.05, 0.004, 0.035, s * 1.035, 0, -0.56 + i * 0.075));
	await p.material('rug', { svg: rugSvg(), size: 1024, rough: 0.95, metal: 0 });
	await p.material('fringe', { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#e2cfa3"/></svg>`, size: 64, rough: 0.95, metal: 0 });
	await p.part('Rug', { rug: [top], fringe });
	return p;
}

/** Tapestry: a 1 × 1.6 m teal hanging on an oak rod; origin bottom-centre-BACK (flush to a wall) */
async function tapestry() {
	const p = new Piece('Tapestry');
	const W = 1;
	const H = 1.6;
	const cols = 10;
	const rows = 12;
	const pos = [];
	const uv = [];
	const idx = [];
	for (let r = 0; r <= rows; r++) {
		for (let c = 0; c <= cols; c++) {
			const u = c / cols;
			const v = r / rows;
			const x = (u - 0.5) * W;
			// the bottom edge is cut into a point: row 0 dips toward the middle
			const dip = r === 0 ? 0 : 0;
			const yBottom = 0.18 * (1 - Math.abs(u - 0.5) * 2);
			const y = yBottom * (1 - v) + v * H - dip;
			const z = 0.04 + 0.018 * Math.sin(u * Math.PI * 4) * (0.4 + 0.6 * (1 - v));
			pos.push(x, y, z);
			uv.push(u, 1 - (y / H));
		}
	}
	for (let r = 0; r < rows; r++)
		for (let c = 0; c < cols; c++) {
			const a = r * (cols + 1) + c;
			const b = a + 1;
			const d = a + cols + 1;
			const e = d + 1;
			idx.push(a, b, e, a, e, d);
		}
	const cloth = new THREE.BufferGeometry();
	cloth.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	cloth.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	cloth.setIndex(idx);
	cloth.computeVertexNormals();
	await p.material('tapestry', { svg: tapestrySvg(), size: 1024, rough: 0.9, metal: 0, doubleSided: true });
	const oak = [place(cyl(0.022, 1.2, 0, 0, 0, 10), { rz: 90, t: [0.6, H + 0.02, 0.05] })];
	const brass = [];
	for (const s of [-1, 1]) brass.push(boxUV(new THREE.SphereGeometry(0.04, 12, 8).translate(s * 0.63, H + 0.02, 0.05), 0));
	const iron = [];
	for (const s of [-1, 1]) iron.push(box(0.03, 0.08, 0.05, s * 0.45, H - 0.02, 0.025));
	await p.part('Tapestry', { tapestry: [cloth], oak, brass, iron });
	return p;
}

/** Signpost: a 2.2 m oak post, two blank arrow boards, a peaked cap */
async function signpost() {
	const p = new Piece('Signpost');
	const oak = [box(0.11, 2.2, 0.11, 0, 0, 0, 1), boxUV(new THREE.ConeGeometry(0.1, 0.12, 4).rotateY(Math.PI / 4).translate(0, 2.26, 0), 1)];
	const arrow = (len, y, yaw) => {
		const s = new THREE.Shape();
		s.moveTo(0, -0.1);
		s.lineTo(len - 0.15, -0.1);
		s.lineTo(len, 0);
		s.lineTo(len - 0.15, 0.1);
		s.lineTo(0, 0.1);
		s.lineTo(0, -0.1);
		const g = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: false }).translate(-0.15, 0, 0.056);
		return place(boxUV(indexed(g), 0), { ry: yaw, t: [0, y, 0] });
	};
	const boards = [arrow(0.85, 1.85, 0), arrow(0.8, 1.55, 180), arrow(0.7, 1.28, 90)];
	const iron = [box(0.13, 0.03, 0.13, 0, 1.98), box(0.13, 0.03, 0.13, 0, 1.42), box(0.13, 0.03, 0.13, 0, 1.16)];
	await p.part('Signpost', { oak, oakPlanks: boards, iron });
	return p;
}

/** ExtrudeGeometry is non-indexed: give it a trivial index so mergeGeometries accepts it */
function indexed(g) {
	const n = g.attributes.position.count;
	g.setIndex([...Array(n).keys()]);
	return g;
}

/** WallTorch: an iron wall bracket holding a cloth-wrapped oak torch, a separate Flame
 * node; origin = bottom-centre-BACK, so it mounts flush on a wall face */
async function wallTorch() {
	const p = new Piece('WallTorch');
	const tilt = 18;
	const iron = [
		box(0.1, 0.22, 0.02, 0, 0, 0.01),
		place(cyl(0.012, 0.13, 0, 0, 0, 8), { rx: 90, t: [0, 0.07, 0.0] }),
		place(boxUV(new THREE.TorusGeometry(0.036, 0.009, 6, 16), 0), { rx: 90, t: [0, 0.07, 0.14] }),
		place(boxUV(new THREE.TorusGeometry(0.03, 0.008, 6, 16), 0), { rx: 90 - tilt, t: [0, 0.2, 0.18] })
	];
	for (const y of [0.03, 0.19]) iron.push(place(cyl(0.008, 0.01, 0, 0, 0, 6), { rx: 90, t: [0, y, 0.02] }));
	// the stick: from low/back to high/front, tilted `tilt`° off vertical toward +z
	const along = (h) => [0, 0.02 + h * Math.cos((tilt * Math.PI) / 180), 0.123 + h * Math.sin((tilt * Math.PI) / 180)];
	const oak = [place(cyl(0.022, 0.46, 0, 0, 0, 10, 0.028), { rx: tilt, t: along(0) })];
	const cloth = [place(cyl(0.036, 0.11, 0, 0, 0, 10, 0.04), { rx: tilt, t: along(0.37) })];
	await p.part('WallTorch', { iron, oak, cloth });
	const top = along(0.48);
	await p.flame('Flame', [top[0], top[1] - 0.01, top[2]], 1.25);
	return p;
}

/** NOT a pack item: the floor pad (top at y = 0) + two low stand-in walls (back at
 * z = -d/2, left at x = -w/2) the cover diorama and the e2e room are furnished on */
export async function floorPad(w = 5, d = 4, walls = true) {
	const p = new Piece('FloorPad');
	const planks = [box(w, 0.06, d, 0, -0.06, 0, 0)];
	const stone = walls ? [box(w + 0.25, 2.4, 0.25, 0.125 - 0.125, 0, -d / 2 - 0.125, 0), box(0.25, 2.4, d, -w / 2 - 0.125, 0, 0, 2)] : [];
	await p.part('FloorPad', walls ? { oakPlanks: planks, wallStone: stone } : { oakPlanks: planks });
	return p;
}

export const PIECES = {
	WallTorch: wallTorch, LeverBase: leverBase, LeverHandle: leverHandle, WallButton: wallButton, PressurePlate: pressurePlate, Hatch: hatch, DoorKey: doorKey, Ladder: ladder, Rug: rug, Tapestry: tapestry, Signpost: signpost };

if (import.meta.url === `file://${process.argv[1]}`) {
	const out = process.argv[2];
	if (!out) throw new Error('usage: node procedural.mjs <outDir> [Name…]');
	fs.mkdirSync(out, { recursive: true });
	const only = process.argv.slice(3);
	for (const [name, fn] of Object.entries(PIECES)) {
		if (only.length && !only.includes(name)) continue;
		const piece = await fn();
		const file = await piece.write(path.join(out, `${name}.glb`));
		console.log(`${name} → ${file} (${fs.statSync(file).size} bytes)`);
	}
}
