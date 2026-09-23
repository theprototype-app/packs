// The hand-built half of scifi-kit: pieces whose value is an EXACT shape — a grating that
// tiles the 2 × 2 cell, pipes whose flanges meet on whole metres, a ramp that lands level
// with a floor, the glass and linings that fit the cut openings — or that a text-to-3D
// model draws badly (thin rails, louvres, a lit screen). 0 credits. Geometry is three.js
// primitives written with glTF-Transform, UV'd by a box projection at one texel density;
// textures are textures.mjs swatches.
//
// Every document is FLAT for sync (see props-kit finding 2: a nested node doubles its
// offset on peers): one node per material directly under the scene, identity transform,
// so the origin IS the piece's pivot.
//
//   node procedural.mjs <outDir> [Name,…]   → <outDir>/<Name>.glb
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SWATCHES, jpeg } from './textures.mjs';
import { TOOLS } from './kit-post.mjs';

const THREE = await import(`${TOOLS}/node_modules/three/build/three.module.js`);
const { mergeGeometries } = await import(`${TOOLS}/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js`);
const { Document, NodeIO } = await import(`${TOOLS}/node_modules/@gltf-transform/core/dist/index.js`);
const { KHRMaterialsEmissiveStrength } = await import(`${TOOLS}/node_modules/@gltf-transform/extensions/dist/index.js`);

/** one swatch tile covers this many metres */
const TILE_M = 1;

/** Box-project UVs: each vertex takes the two axes its normal is NOT along. */
function boxUV(geo, tile = TILE_M) {
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

/** an axis-aligned box from lo to hi (metres); `seg` subdivides x and z — a 2 m face as ONE
 * triangle pair cracked along its diagonal where the camera's near plane clipped it (the
 * station e2e saw background pixels through the ceiling), so big slabs are tessellated */
const B = (lo, hi, seg = 1) => new THREE.BoxGeometry(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], seg, 1, seg).translate((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
/** a cylinder along Y, bottom at y */
const C = (r, h, x = 0, y = 0, z = 0, seg = 16, r2 = r) => new THREE.CylinderGeometry(r2, r, h, seg).translate(x, y + h / 2, z);
/** euler (deg) + translation */
const at = (geo, { rx = 0, ry = 0, rz = 0, t = [0, 0, 0] } = {}) =>
	geo.applyMatrix4(
		new THREE.Matrix4().compose(
			new THREE.Vector3(...t),
			new THREE.Quaternion().setFromEuler(new THREE.Euler((rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180)),
			new THREE.Vector3(1, 1, 1)
		)
	);
/** a tube along a curve, its own UVs scaled to metres (u along, v around) */
function tube(curve, r, seg = 24, radial = 16) {
	const g = new THREE.TubeGeometry(curve, seg, r, radial, false);
	const len = curve.getLength();
	const uv = g.attributes.uv;
	for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * len) / TILE_M, (uv.getY(i) * 2 * Math.PI * r) / TILE_M);
	g.userData.ownUV = true;
	return g;
}

// roughness / metalness per material; `glow` materials are emissive (KHR_materials_emissive_strength
// lifts them over 1.0 so the app's bloom, when on, picks them up)
const MATS = {
	white: { rough: 0.55, metal: 0.1 },
	whitePanels: { rough: 0.55, metal: 0.1 },
	gunmetal: { rough: 0.45, metal: 0.7 },
	dark: { rough: 0.8, metal: 0.2 },
	teal: { rough: 0.5, metal: 0.2 },
	stripes: { rough: 0.6, metal: 0.4 },
	screen: { rough: 0.25, metal: 0, emissive: [1, 1, 1], strength: 1.4, emissiveMap: true },
	glow: { rough: 0.3, metal: 0, emissive: [0.55, 1, 0.94], strength: 2.2 },
	glass: { rough: 0.05, metal: 0, color: [0.62, 0.86, 0.9, 0.28], blend: true }
};

class Piece {
	constructor(name) {
		this.name = name;
		/** @type {Map<string, any[]>} */
		this.parts = new Map();
	}
	add(mat, ...geos) {
		if (!this.parts.has(mat)) this.parts.set(mat, []);
		this.parts.get(mat).push(...geos);
		return this;
	}
	/** the flat document: one node per material, at the origin */
	async doc() {
		const doc = new Document();
		const buffer = doc.createBuffer();
		const scene = doc.createScene(this.name);
		const ext = doc.createExtension(KHRMaterialsEmissiveStrength);
		for (const [key, geos] of this.parts) {
			const spec = MATS[key];
			const g = mergeGeometries(geos.map((x) => (x.userData.ownUV ? (x.index ? x.toNonIndexed() : x) : boxUV(x))), false);
			const m = doc.createMaterial(key).setRoughnessFactor(spec.rough).setMetallicFactor(spec.metal);
			if (spec.color) m.setBaseColorFactor(spec.color);
			if (spec.blend) m.setAlphaMode('BLEND').setDoubleSided(true);
			else {
				const tex = doc.createTexture(key).setImage(await jpeg(SWATCHES[key](), 512)).setMimeType('image/jpeg');
				m.setBaseColorTexture(tex);
				if (spec.emissiveMap) m.setEmissiveTexture(tex);
			}
			if (spec.emissive) m.setEmissiveFactor(spec.emissive).setExtension('KHR_materials_emissive_strength', ext.createEmissiveStrength().setEmissiveStrength(spec.strength));
			const acc = (arr, type) => doc.createAccessor().setArray(arr).setType(type).setBuffer(buffer);
			const prim = doc
				.createPrimitive()
				.setMaterial(m)
				.setAttribute('POSITION', acc(new Float32Array(g.attributes.position.array), 'VEC3'))
				.setAttribute('NORMAL', acc(new Float32Array(g.attributes.normal.array), 'VEC3'))
				.setAttribute('TEXCOORD_0', acc(new Float32Array(g.attributes.uv.array), 'VEC2'));
			if (g.index) prim.setIndices(acc(new Uint32Array(g.index.array), 'SCALAR'));
			scene.addChild(doc.createNode(`${this.name}_${key}`).setMesh(doc.createMesh(`${this.name}_${key}`).addPrimitive(prim)));
		}
		doc.getRoot().getAsset().generator = 'theprototype scifi-kit procedural.mjs';
		doc.getRoot().getAsset().extras = { scifiKit: { source: 'procedural', piece: this.name } };
		return doc;
	}
}

// ------------------------------------------------------------------ openings (kit-cut sizes)
// The wall is 2 × 3 × 0.25 with a bottom-centre pivot; these are the holes build.mjs cuts
// and the pieces below line. Keep them in ONE place.
export const OPENINGS = {
	door: { w: 1.2, h: 2.4 },
	window: { w: 1.4, h: 1.0, sill: 1.0 }
};
const WALL_Z = 0.125; // half the wall's depth: its faces are at z = ±0.125
// slab tessellation (x and z segments of the ceiling and grating slabs); SCIFI_SLAB_SEG=1 rebuilds
// the cracked original for the station e2e's counterfactual
const SLAB_SEG = Number(process.env.SCIFI_SLAB_SEG ?? 8);

// ------------------------------------------------------------------ the pieces

/** 2 × 2 m floor grating: bearing bars over a dark sealed sub-plate, top level with a floor tile (0.1) */
function FloorGrate() {
	const p = new Piece('FloorGrate');
	const f = 0.08;
	p.add('gunmetal', B([-1, 0.02, -1], [1, 0.1, -1 + f]), B([-1, 0.02, 1 - f], [1, 0.1, 1]), B([-1, 0.02, -1 + f], [-1 + f, 0.1, 1 - f]), B([1 - f, 0.02, -1 + f], [1, 0.1, 1 - f]));
	// bearing bars along X, cross bars along Z (a hair lower so the tops read as a mesh)
	for (let z = -1 + f + 0.06; z < 1 - f; z += 0.075) p.add('gunmetal', B([-1 + f, 0.035, z - 0.008], [1 - f, 0.1, z + 0.008]));
	for (const x of [-0.6, -0.2, 0.2, 0.6]) p.add('gunmetal', B([x - 0.012, 0.03, -1 + f], [x + 0.012, 0.095, 1 - f]));
	p.add('dark', B([-1, 0, -1], [1, 0.02, 1], SLAB_SEG));
	// a teal light line along the sub-plate's centre, seen through the bars
	p.add('glow', B([-0.9, 0.02, -0.02], [0.9, 0.024, 0.02]));
	return p;
}

/** 2 × 2 m ceiling panel, placed on the wall tops (y = 3): a SOLID slab from its pivot up
 * (a slab that started above the wall tops left a see-through slot at every wall), with the
 * light strip and its housing hanging 1.5 cm below */
function CeilingLight() {
	const p = new Piece('CeilingLight');
	p.add('whitePanels', B([-1, 0, -1], [1, 0.1, 1], SLAB_SEG));
	p.add('gunmetal', B([-0.9, -0.01, -0.16], [0.9, 0, 0.16]));
	p.add('glow', B([-0.85, -0.015, -0.1], [0.85, -0.01, 0.1]));
	return p;
}

/** 2 × 2 m ramp, 1 m rise, low edge at +Z (like architecture-kit's) */
function Ramp() {
	const p = new Piece('Ramp');
	// the wedge as a prism: profile (-z, y) extruded along +x after a +90° turn about Y
	// (a proper rotation — swapping x and z by hand mirrors the mesh inside out)
	const prism = (x0, x1) => {
		const sh = new THREE.Shape([new THREE.Vector2(1, 0), new THREE.Vector2(-1, 0), new THREE.Vector2(1, 1)]);
		return new THREE.ExtrudeGeometry(sh, { depth: x1 - x0, bevelEnabled: false }).rotateY(Math.PI / 2).translate(x0, 0, 0);
	};
	p.add('whitePanels', prism(-1, -0.88), prism(0.88, 1));
	p.add('gunmetal', prism(-0.88, 0.88));
	// anti-slip ribs across the slope and teal-striped edge bands
	const slope = Math.atan2(1, 2);
	for (let i = 1; i < 9; i++) {
		const z = 1 - i * 0.2;
		const y = (1 - z) / 2;
		p.add('dark', at(B([-0.85, 0, -0.02], [0.85, 0.018, 0.02]), { rx: (slope * 180) / Math.PI, t: [0, y, z] }));
	}
	p.add('stripes', at(B([-0.88, -0.004, -1.1], [-0.76, 0.003, 1.1]), { rx: (slope * 180) / Math.PI, t: [0, 0.5, 0] }), at(B([0.76, -0.004, -1.1], [0.88, 0.003, 1.1]), { rx: (slope * 180) / Math.PI, t: [0, 0.5, 0] }));
	return p;
}

/** 2 m railing on a floor edge: end posts, a teal top rail, a mid rail, a kick plate */
function Railing() {
	const p = new Piece('Railing');
	for (const x of [-0.96, 0.96]) p.add('gunmetal', B([x - 0.04, 0, -0.04], [x + 0.04, 1.02, 0.04]));
	p.add('gunmetal', B([-0.03, 0, -0.03], [0.03, 1.0, 0.03]));
	p.add('teal', at(C(0.035, 2, 0, -1, 0, 16), { rz: 90, t: [0, 1.05, 0] }));
	p.add('gunmetal', at(C(0.02, 1.84, 0, -0.92, 0, 12), { rz: 90, t: [0, 0.6, 0] }));
	p.add('whitePanels', B([-0.92, 0.02, -0.02], [0.92, 0.16, 0.02]));
	return p;
}

/** straight pipe, 2 m along X, axis 0.2 m up (it rests on a floor tile), flanged ends, two saddles */
const PIPE = { r: 0.1, y: 0.2, flangeR: 0.13, flangeL: 0.04 };
function pipeBits(p, from, to) {
	// a flange at `from`, pointing towards `to`
	const d = new THREE.Vector3().subVectors(to, from).normalize();
	const g = new THREE.CylinderGeometry(PIPE.flangeR, PIPE.flangeR, PIPE.flangeL, 20).translate(0, PIPE.flangeL / 2, 0);
	g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d)).translate(from.x, from.y, from.z);
	p.add('gunmetal', g);
}
function PipeStraight() {
	const p = new Piece('PipeStraight');
	const a = new THREE.Vector3(-1, PIPE.y, 0);
	const b = new THREE.Vector3(1, PIPE.y, 0);
	p.add('white', tube(new THREE.LineCurve3(a, b), PIPE.r, 1, 20));
	pipeBits(p, a, b);
	pipeBits(p, b, a);
	p.add('teal', at(C(PIPE.r + 0.008, 0.12, 0, -0.06, 0, 20), { rz: 90, t: [0, PIPE.y, 0] }));
	for (const x of [-0.55, 0.55]) p.add('gunmetal', B([x - 0.05, 0, -0.12], [x + 0.05, PIPE.y - 0.04, 0.12]), at(C(PIPE.r + 0.012, 0.06, 0, -0.03, 0, 20), { rz: 90, t: [x, PIPE.y, 0] }));
	return p;
}
/** 90° elbow: its pivot is the CORNER grid point; legs end 1 m out at -X and +Z */
function PipeElbow() {
	const p = new Piece('PipeElbow');
	const R = 0.4;
	const y = PIPE.y;
	const path3 = new THREE.CurvePath();
	path3.add(new THREE.LineCurve3(new THREE.Vector3(-1, y, 0), new THREE.Vector3(-R, y, 0)));
	// quarter circle centred on (-R, y, R): from (-R, y, 0) round to (0, y, R)
	const arc = new THREE.Curve();
	arc.getPoint = (t, v = new THREE.Vector3()) => v.set(-R + R * Math.sin((t * Math.PI) / 2), y, R - R * Math.cos((t * Math.PI) / 2));
	path3.add(arc);
	path3.add(new THREE.LineCurve3(new THREE.Vector3(0, y, R), new THREE.Vector3(0, y, 1)));
	p.add('white', tube(path3, PIPE.r, 40, 20));
	pipeBits(p, new THREE.Vector3(-1, y, 0), new THREE.Vector3(0, y, 0));
	pipeBits(p, new THREE.Vector3(0, y, 1), new THREE.Vector3(0, y, 0));
	p.add('gunmetal', B([-0.75, 0, -0.12], [-0.65, y - 0.04, 0.12]), B([-0.12, 0, 0.65], [0.12, y - 0.04, 0.75]));
	p.add('teal', at(C(PIPE.r + 0.008, 0.1, 0, -0.05, 0, 20), { rz: 90, t: [-0.8, y, 0] }));
	return p;
}

/** a wall vent: SHARES THE WALL'S PIVOT — place it at the wall's x/z/rotation and it sits on the +Z face */
function Vent() {
	const p = new Piece('Vent');
	const w = 0.8;
	const h = 0.5;
	const y0 = 0.35;
	const z0 = WALL_Z;
	const d = 0.06;
	p.add('gunmetal', B([-w / 2, y0, z0], [w / 2, y0 + 0.06, z0 + d]), B([-w / 2, y0 + h - 0.06, z0], [w / 2, y0 + h, z0 + d]), B([-w / 2, y0, z0], [-w / 2 + 0.06, y0 + h, z0 + d]), B([w / 2 - 0.06, y0, z0], [w / 2, y0 + h, z0 + d]));
	p.add('dark', B([-w / 2 + 0.06, y0 + 0.06, z0], [w / 2 - 0.06, y0 + h - 0.06, z0 + 0.01]));
	for (let i = 0; i < 6; i++) p.add('white', at(B([-w / 2 + 0.06, -0.006, -0.028], [w / 2 - 0.06, 0.006, 0.028]), { rx: 35, t: [0, y0 + 0.1 + i * 0.058, z0 + 0.032] }));
	return p;
}

/** a wall screen: SHARES THE WALL'S PIVOT (on the +Z face, centred 1.6 m up) */
function WallScreen() {
	const p = new Piece('WallScreen');
	const w = 1.4;
	const h = 0.8;
	const yc = 1.6;
	const z0 = WALL_Z;
	p.add('gunmetal', B([-w / 2, yc - h / 2, z0], [w / 2, yc + h / 2, z0 + 0.06]));
	// the display: a quad just proud of the bezel, its UV the whole screen texture
	const g = new THREE.PlaneGeometry(w - 0.12, h - 0.12).translate(0, yc, z0 + 0.061);
	g.userData.ownUV = true;
	p.add('screen', g);
	p.add('teal', B([-w / 2 + 0.08, yc - h / 2 - 0.05, z0], [-w / 2 + 0.3, yc - h / 2, z0 + 0.04]));
	return p;
}

/** a floor-standing light column: base, pole, a glowing tube */
function Lamp() {
	const p = new Piece('Lamp');
	p.add('gunmetal', C(0.22, 0.06, 0, 0, 0, 24, 0.19), C(0.03, 0.7, 0, 0.06), C(0.06, 0.05, 0, 0.72, 0, 16), C(0.06, 0.06, 0, 1.72, 0, 16, 0.04));
	p.add('teal', C(0.2, 0.025, 0, 0.06, 0, 24, 0.19));
	p.add('glow', C(0.045, 0.95, 0, 0.77, 0, 16));
	for (let i = 0; i < 3; i++) {
		const a = (i * 2 * Math.PI) / 3;
		p.add('white', B([-0.012, 0.77, 0.05], [0.012, 1.72, 0.07]).rotateY(a));
	}
	return p;
}

/** the glass + frame of the window opening; shares the wall's pivot (kitbashed into WallWindow) */
function WindowGlass() {
	const p = new Piece('WindowGlass');
	const { w, h, sill } = OPENINGS.window;
	const d = WALL_Z + 0.02;
	const f = 0.07;
	p.add('gunmetal', B([-w / 2 - f, sill - f, -d], [w / 2 + f, sill, d]), B([-w / 2 - f, sill + h, -d], [w / 2 + f, sill + h + f, d]), B([-w / 2 - f, sill, -d], [-w / 2, sill + h, d]), B([w / 2, sill, -d], [w / 2 + f, sill + h, d]));
	p.add('teal', B([-w / 2 - f, sill - f - 0.03, -d - 0.01], [w / 2 + f, sill - f, d + 0.01]));
	p.add('gunmetal', B([-0.02, sill, -0.03], [0.02, sill + h, 0.03]));
	p.add('glass', B([-w / 2, sill, -0.008], [w / 2, sill + h, 0.008]));
	return p;
}

/** the lining of the open doorway (kitbashed into Doorway): jambs, lintel, light strips */
function DoorLining() {
	const p = new Piece('DoorLining');
	const { w, h } = OPENINGS.door;
	const d = WALL_Z + 0.025;
	const f = 0.1;
	p.add('gunmetal', B([-w / 2 - f, 0, -d], [-w / 2, h, d]), B([w / 2, 0, -d], [w / 2 + f, h, d]), B([-w / 2 - f, h, -d], [w / 2 + f, h + f, d]));
	for (const s of [-1, 1]) p.add('glow', B([-w / 2 - 0.06, 0.1, s * d - 0.01], [-w / 2 - 0.035, h - 0.05, s * d + 0.01]), B([w / 2 + 0.035, 0.1, s * d - 0.01], [w / 2 + 0.06, h - 0.05, s * d + 0.01]));
	p.add('stripes', B([-w / 2, 0, -d], [w / 2, 0.012, d]));
	return p;
}

export const PIECES = { FloorGrate, CeilingLight, Ramp, Railing, PipeStraight, PipeElbow, Vent, WallScreen, Lamp, WindowGlass, DoorLining };

/** write one piece's GLB */
export async function writePiece(name, file) {
	const doc = await PIECES[name]().doc();
	await new NodeIO().registerExtensions([KHRMaterialsEmissiveStrength]).write(file, doc);
	return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [out, only] = process.argv.slice(2);
	fs.mkdirSync(out, { recursive: true });
	for (const n of only ? only.split(',') : Object.keys(PIECES)) console.log(await writePiece(n, path.join(out, `${n}.glb`)));
}
