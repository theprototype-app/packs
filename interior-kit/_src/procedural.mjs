// The hand-built half of interior-kit: pieces whose value is an EXACT fit rather than a
// sculpted look — the wall trims that snap to the architecture kit's walls (skirting,
// cornice, teal wainscot, with doorway cut-outs that meet the kit's Door frame), and thin
// or many-part pieces a text-to-3D model renders badly (lamps, the chandelier, a rug, a
// framed picture, a shelf of books). Geometry is three.js primitives written with
// glTF-Transform; textures are textures.mjs swatches, UV'd by a box projection at a
// fixed texel density so every piece shares one scale of grain. Forked from
// props-kit/_src/procedural.mjs.
//
// WALL-LINE PIVOT (kit.md): the architecture kit's walls are 0.25 m thick and centred on
// their grid line, so a wall face is 0.125 m off the line. Every wall-mounted piece here
// keeps its origin ON THE LINE (the wall's own pivot): give it the wall's position and
// rotation and it sits on the wall's +Z face. Trims embed their back edge 2 cm into the
// wall (z = 0.105; the brick/plaster relief is 0.10–0.125) so no gap shows along a
// rough face.
//
// NO FLICKER BY CONSTRUCTION: no two faces of a piece, or of two pieces snapped together
// (straight runs, inner corners), are coplanar AND facing the same way where they
// overlap. Trim tops are sloped/rounded (never flat), so at an inner corner the two
// runs' tops cross along a line instead of overlapping in a plane; the wainscot's
// panels are raised (bevelled frusta) instead of boxes laid over boxes; picture frames
// are one extruded ring (mitred corners), not four overlapping bars; flames of one
// lamp are ONE mesh (one draw call).
//
//   node procedural.mjs <outDir> [Name…]   → <outDir>/<Name>.glb
import fs from 'node:fs';
import path from 'node:path';
import { SWATCHES, roundRugSvg, landscapeSvg, bookAtlasSvg, BOOK_ATLAS, jpeg } from './textures.mjs';

const TOOLS = process.env.MESHY_TOOLS ?? new URL('../../tools/meshy', import.meta.url).pathname;
const THREE = await import(`${TOOLS}/node_modules/three/build/three.module.js`);
const { mergeGeometries } = await import(`${TOOLS}/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js`);
const { Document, NodeIO } = await import(`${TOOLS}/node_modules/@gltf-transform/core/dist/index.js`);
const { KHRMaterialsEmissiveStrength } = await import(`${TOOLS}/node_modules/@gltf-transform/extensions/dist/index.js`);

/** half the architecture kit's wall thickness: a wall face is this far off its grid line */
export const WALL_FACE = 0.125;
/** trims' back plane: 2 cm INSIDE the wall face (covers the brick/plaster relief) */
const BACK = 0.105;
/** the architecture kit's floor tiles are 0.1 m thick: their top is y = 0.1 */
export const FLOOR_TOP = 0.1;
/** the Door piece's frame: 1.3 m wide, 0.165 m proud of the wall line */
const DOOR_HALF = 0.65;

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

/** ExtrudeGeometry / Lathe are non-indexed or lack uv: give a trivial index */
function indexed(g) {
	if (g.index) return g;
	const n = g.attributes.position.count;
	g.setIndex([...Array(n).keys()]);
	return g;
}

/** a box of size sx,sy,sz whose BOTTOM-centre sits at (x,y,z), tessellated so a big face
 * never is one long triangle pair (a single 2 m quad cracks at the near plane — scifi-kit) */
const box = (sx, sy, sz, x = 0, y = 0, z = 0, grain = 0) => {
	const seg = (s) => Math.max(1, Math.ceil(s / 0.5));
	return boxUV(new THREE.BoxGeometry(sx, sy, sz, seg(sx), seg(sy), seg(sz)).translate(x, y + sy / 2, z), grain);
};
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

/**
 * Extrude a closed profile in the (z, y) plane along X from x0 to x1 — a moulding. The
 * profile is a counter-clockwise polygon seen from +X ([z, y] pairs); each edge becomes a
 * flat-shaded strip (hard edges, crisp mouldings) and both ends get a triangulated cap.
 * UVs: u along X (the grain), v along the profile's running length.
 * @param {[number, number][]} prof @param {number} x0 @param {number} x1
 */
function moulding(prof, x0, x1, { hide = hiddenEdge, capFrom = WALL_FACE + 0.0005, tile = TILE_M } = {}) {
	const pos = [];
	const nor = [];
	const uv = [];
	const idx = [];
	let run = 0;
	const segs = Math.max(1, Math.ceil((x1 - x0) / 0.5));
	for (let i = 0; i < prof.length; i++) {
		const [za, ya] = prof[i];
		const [zb, yb] = prof[(i + 1) % prof.length];
		const len = Math.hypot(zb - za, yb - ya);
		if (len < 1e-6) continue;
		// (v keeps running over hidden edges too, so the texture does not jump)
		if (hide([za, ya], [zb, yb])) {
			run += len;
			continue;
		}
		// outward normal of a CCW (z,y) polygon edge: rotate the edge direction by -90°
		const nz = (yb - ya) / len;
		const ny = -(zb - za) / len;
		const base = pos.length / 3;
		for (let s = 0; s <= segs; s++) {
			const x = x0 + ((x1 - x0) * s) / segs;
			pos.push(x, ya, za, x, yb, zb);
			nor.push(0, ny, nz, 0, ny, nz);
			uv.push(x / tile, run / tile, x / tile, (run + len) / tile);
		}
		for (let s = 0; s < segs; s++) {
			const a = base + s * 2;
			// winding so the face points along (0, ny, nz)
			idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
		}
		run += len;
	}
	// end caps: only the part IN FRONT of the wall face — the embedded 2 cm would sit in the
	// same plane as an exposed wall end (a run that stops at a wall's end or a doorway)
	// …and the part BELOW the floor tiles' top (y < 0.1, buried in a tiled floor) is set back
	// 2 mm, so it never shares a plane with an exposed floor tile's edge at the run's end
	const front = clipZ(prof, capFrom);
	const parts = [
		[clipY(front, FLOOR_TOP, true), 0],
		[clipY(front, FLOOR_TOP, false), 0.002]
	];
	for (const [capPoly, inset] of parts) {
		if (capPoly.length < 3) continue;
		const tris = THREE.ShapeUtils.triangulateShape(capPoly.map(([z, y]) => new THREE.Vector2(z, y)), []);
		for (const [x, nx] of [[x0 + inset, -1], [x1 - inset, 1]]) {
			const base = pos.length / 3;
			for (const [z, y] of capPoly) {
				pos.push(x, y, z);
				nor.push(nx, 0, 0);
				uv.push(z / tile, y / tile);
			}
			for (const [a, b, c] of tris) idx.push(base + a, base + b, base + c);
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	g.setIndex(idx);
	return fixWinding(g);
}

/** a trim's never-visible edges: its back (inside the wall), its foot on the floor line and
 * its top on the ceiling line. Not emitting them is what keeps two trims (or a trim and the
 * wall) from sharing a plane at a corner or along the wall's foot. */
function hiddenEdge([za, ya], [zb, yb]) {
	const eps = 1e-6;
	if (za <= WALL_FACE + eps && zb <= WALL_FACE + eps) return true;
	if (Math.abs(ya - yb) < eps && (ya <= eps || ya >= 3 - eps)) return true;
	return false;
}

/** clip a (z, y) polygon to z ≥ zc (Sutherland–Hodgman, one edge) */
function clipZ(poly, zc) {
	const out = [];
	for (let i = 0; i < poly.length; i++) {
		const P = poly[i];
		const Q = poly[(i + 1) % poly.length];
		const pin = P[0] >= zc;
		const qin = Q[0] >= zc;
		if (pin) out.push(P);
		if (pin !== qin) {
			const t = (zc - P[0]) / (Q[0] - P[0]);
			out.push([zc, P[1] + t * (Q[1] - P[1])]);
		}
	}
	return out;
}

/** clip a (z, y) polygon to y ≥ yc (`above`) or y ≤ yc */
function clipY(poly, yc, above) {
	const out = [];
	const inside = (p) => (above ? p[1] >= yc : p[1] <= yc);
	for (let i = 0; i < poly.length; i++) {
		const P = poly[i];
		const Q = poly[(i + 1) % poly.length];
		if (inside(P)) out.push(P);
		if (inside(P) !== inside(Q)) {
			const t = (yc - P[1]) / (Q[1] - P[1]);
			out.push([P[0] + t * (Q[0] - P[0]), yc]);
		}
	}
	return out;
}

/** make every triangle's winding agree with its vertex normals (robust to profile direction) */
function fixWinding(g) {
	const p = g.attributes.position;
	const n = g.attributes.normal;
	const ix = g.index.array;
	const A = new THREE.Vector3();
	const B = new THREE.Vector3();
	const C = new THREE.Vector3();
	const N = new THREE.Vector3();
	for (let t = 0; t < ix.length; t += 3) {
		A.fromBufferAttribute(p, ix[t]);
		B.fromBufferAttribute(p, ix[t + 1]);
		C.fromBufferAttribute(p, ix[t + 2]);
		const face = B.clone().sub(A).cross(C.clone().sub(A));
		N.fromBufferAttribute(n, ix[t]);
		if (face.dot(N) < 0) [ix[t + 1], ix[t + 2]] = [ix[t + 2], ix[t + 1]];
	}
	g.index.needsUpdate = true;
	return g;
}

/** points on a quarter/partial arc (z, y) around a centre, angles in degrees */
const arc = (cz, cy, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => {
	const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
	return [cz + r * Math.cos(a), cy + r * Math.sin(a)];
});

/** a raised panel: a bevelled frustum, back rectangle (no back face) at z0, front inset `bev` at z1 */
function raisedPanel(x0, x1, y0, y1, z0, z1, bev) {
	const P = [
		[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
		[x0 + bev, y0 + bev, z1], [x1 - bev, y0 + bev, z1], [x1 - bev, y1 - bev, z1], [x0 + bev, y1 - bev, z1]
	];
	const quads = [[4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
	const pos = [];
	const idx = [];
	for (const q of quads) {
		const b = pos.length / 3;
		for (const k of q) pos.push(...P[k]);
		idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setIndex(idx);
	const ng = g.toNonIndexed();
	ng.computeVertexNormals();
	return boxUV(indexed(ng), 0);
}

// ------------------------------------------------------------------ flames / glow
// A flame is its OWN node ("Flame") with an emissive, untextured material, so a lamp or
// candle reads as lit in any scene, and a game can hide/show it (lit/unlit) without
// touching the piece. All flames of a piece are ONE mesh (one draw call).
// KHR_materials_emissive_strength lifts it over 1.0 so the app's bloom picks it up.

/** a low-poly teardrop, base at y = 0, ~0.17 m tall at scale 1 */
export function flameGeometry(scale = 1) {
	const prof = [[0, 0], [0.03, 0.012], [0.042, 0.04], [0.036, 0.08], [0.02, 0.125], [0.006, 0.16], [0, 0.175]].map(([r, y]) => new THREE.Vector2(r * scale, y * scale));
	const g = new THREE.LatheGeometry(prof, 8);
	g.computeVertexNormals();
	g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
	return g;
}

/** the glow materials (one per document): flame orange, or a warm bulb / lit shade */
function glowMaterial(doc, kind = 'Flame') {
	const found = doc.getRoot().listMaterials().find((m) => m.getName() === kind);
	if (found) return found;
	const ext = doc.createExtension(KHRMaterialsEmissiveStrength);
	const spec = {
		Flame: { base: [0.25, 0.07, 0.01, 1], emissive: [1, 0.34, 0.03], strength: 1.15 },
		Glow: { base: [0.9, 0.78, 0.55, 1], emissive: [1, 0.72, 0.38], strength: 1.0 }
	}[kind];
	return doc
		.createMaterial(kind)
		.setBaseColorFactor(spec.base)
		.setEmissiveFactor(spec.emissive)
		.setRoughnessFactor(1)
		.setMetallicFactor(0)
		.setExtension('KHR_materials_emissive_strength', ext.createEmissiveStrength().setEmissiveStrength(spec.strength));
}

const MATS = {
	oak: { swatch: 'oak', rough: 0.78, metal: 0 },
	oakDark: { swatch: 'oakDark', rough: 0.7, metal: 0 },
	oakPlanks: { swatch: 'oakPlanks', rough: 0.8, metal: 0 },
	iron: { swatch: 'iron', rough: 0.55, metal: 0.75 },
	brass: { swatch: 'brass', rough: 0.35, metal: 0.9 },
	tealPaint: { swatch: 'tealPaint', rough: 0.55, metal: 0 },
	tealCloth: { swatch: 'tealCloth', rough: 0.95, metal: 0 },
	linen: { swatch: 'linen', rough: 0.95, metal: 0 },
	wax: { swatch: 'wax', rough: 0.6, metal: 0 },
	ceramic: { swatch: 'ceramic', rough: 0.3, metal: 0 },
	plaster: { swatch: 'plaster', rough: 0.95, metal: 0 },
	flame: { glow: 'Flame' },
	glow: { glow: 'Glow' }
};

class Piece {
	constructor(name) {
		this.name = name;
		this.doc = new Document();
		this.doc.createBuffer();
		this.scene = this.doc.createScene(name);
		this.mats = new Map();
		this.extras = {};
	}
	async material(key, custom) {
		if (this.mats.has(key)) return this.mats.get(key);
		const spec = custom ?? MATS[key];
		if (spec.glow) {
			const m = glowMaterial(this.doc, spec.glow);
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
	/** one mesh node PER MATERIAL (flat for sync: core sends nested nodes with a world pose) */
	async part(name, byMat) {
		const nodes = [];
		for (const [key, geos] of Object.entries(byMat)) {
			if (!geos.length) continue;
			const g = mergeGeometries(geos.map((x) => (x.index ? x : indexed(x))), false);
			if (!g) throw new Error(`${this.name}/${name}: geometries of "${key}" do not merge (attribute mismatch)`);
			const prim = this.doc.createPrimitive().setMaterial(await this.material(key));
			const acc = (arr, type) => this.doc.createAccessor().setArray(arr).setType(type).setBuffer(this.doc.getRoot().listBuffers()[0]);
			prim.setAttribute('POSITION', acc(new Float32Array(g.attributes.position.array), 'VEC3'));
			prim.setAttribute('NORMAL', acc(new Float32Array(g.attributes.normal.array), 'VEC3'));
			prim.setAttribute('TEXCOORD_0', acc(new Float32Array(g.attributes.uv.array), 'VEC2'));
			prim.setIndices(acc(new Uint32Array(g.index.array), 'SCALAR'));
			const nodeName = key === 'flame' ? 'Flame' : Object.keys(byMat).length > 1 ? `${name}_${key}` : name;
			const node = this.doc.createNode(nodeName).setMesh(this.doc.createMesh(nodeName).addPrimitive(prim));
			this.scene.addChild(node);
			nodes.push(node);
		}
		return nodes;
	}
	async write(file) {
		const asset = this.doc.getRoot().getAsset();
		asset.generator = 'theprototype interior-kit procedural.mjs';
		asset.extras = { interiorKit: { source: 'procedural', piece: this.name, ...this.extras } };
		await new NodeIO().registerExtensions([KHRMaterialsEmissiveStrength]).write(file, this.doc);
		return file;
	}
}

// ------------------------------------------------------------------ wall trims

/** skirting profile (z, y), CCW seen from +X: a 2.2 cm board, bullnose, a 45° top that
 * runs INTO the wall — no flat top, so two runs meeting at an inner corner never share a plane */
const SKIRT_FRONT = WALL_FACE + 0.022;
const SKIRT_PROFILE = [
	[BACK, 0],
	[SKIRT_FRONT, 0],
	[SKIRT_FRONT, 0.205],
	...arc(SKIRT_FRONT - 0.012, 0.205, 0.012, 0, 70, 4).slice(1),
	[BACK, 0.252]
];

/** the run of x-intervals a trim covers: a full 2 m wall, or the two pieces either side of a doorway */
const RUNS = { wall: [[-1, 1]], doorway: [[-1, -DOOR_HALF], [DOOR_HALF, 1]] };

/** Skirting: 2 m, origin on the wall's grid line; 0.25 m tall from the line's foot, so
 * 0.15 m shows above the kit's floor tiles (their top is y = 0.1) */
async function skirting(kind = 'wall') {
	const p = new Piece(kind === 'wall' ? 'Skirting' : 'SkirtingDoorway');
	await p.part(p.name, { oakDark: RUNS[kind].map(([a, b]) => moulding(SKIRT_PROFILE, a, b)) });
	p.extras = { pivot: 'wall-line', fits: kind === 'wall' ? 'Wall*' : 'Wall*Door + Door' };
	return p;
}

/** Cornice: a 2 m cove moulding at the ceiling (its top is y = 3, a storey); the cove's
 * concave face reads well from below; origin on the wall's grid line at the wall's foot */
const CORNICE_PROFILE = [
	[BACK, 2.79],
	[WALL_FACE + 0.012, 2.806],
	[WALL_FACE + 0.02, 2.82],
	...arc(WALL_FACE + 0.14, 2.82, 0.12, 180, 90, 6).slice(1).map(([z, y]) => [z, y]),
	[WALL_FACE + 0.16, 2.95],
	[WALL_FACE + 0.16, 3.0],
	[BACK, 3.0]
];
async function cornice() {
	const p = new Piece('Cornice');
	await p.part('Cornice', { plaster: [moulding(CORNICE_PROFILE, -1, 1)] });
	p.extras = { pivot: 'wall-line', fits: 'Wall* (3 m storey)' };
	return p;
}

/** Wainscot: 2 m of deep-teal panelling, 0.93 m tall (clears the kit's window sill at
 * 0.975), three raised panels, an oak cap rail with a rounded top and its own skirting.
 * Panels and rails sit on DIFFERENT planes (backboard 0.137, panel faces 0.149, skirting
 * 0.152, rail 0.162): nothing coplanar where it overlaps. */
const PANEL_BACK = WALL_FACE + 0.012;
const CAP_PROFILE = [
	[BACK, 0.857],
	// the underside TILTS (0.857 → 0.862): at an inner corner the two runs' undersides cross
	// on the diagonal instead of overlapping in one horizontal plane
	[WALL_FACE + 0.037, 0.862],
	[WALL_FACE + 0.037, 0.895],
	...arc(WALL_FACE + 0.022, 0.895, 0.015, 0, 90, 4).slice(1),
	[BACK, 0.93]
];
/** the wainscot's own skirting: its top meets the backboard's bottom at y = 0.24 — the
 * cross-section is PARTITIONED (skirting 0–0.24, backboard 0.24–0.86, rail above), so the
 * parts' end caps at x = ±1 never overlap in one plane */
const WAIN_SKIRT_TOP = 0.24;
const WAIN_SKIRT = [
	[BACK, 0],
	[WALL_FACE + 0.027, 0],
	[WALL_FACE + 0.027, 0.215],
	...arc(WALL_FACE + 0.017, 0.215, 0.01, 0, 80, 3).slice(1),
	[PANEL_BACK, WAIN_SKIRT_TOP],
	[BACK, WAIN_SKIRT_TOP]
];
async function wainscot(kind = 'wall') {
	const p = new Piece(kind === 'wall' ? 'Wainscot' : 'WainscotDoorway');
	const teal = [];
	const oak = [];
	for (const [a, b] of RUNS[kind]) {
		// backboard (front plane = the stiles and rails): a slab from the line's foot to under the cap
		// only its FRONT shows (the stiles and rails): top and bottom are covered by the rail
		// and the skirting, the back is in the wall — not emitted, so they never share a plane
		const BB = [[BACK, WAIN_SKIRT_TOP], [PANEL_BACK, WAIN_SKIRT_TOP], [PANEL_BACK, 0.857], [BACK, 0.857]];
		teal.push(moulding(BB, a, b, { hide: (p, q) => hiddenEdge(p, q) || p[1] === q[1] }));
		// raised panels: 5 cm stiles at the ends (a neighbouring piece adds its own: a 10 cm stile), 10 cm between
		const n = Math.max(1, Math.round((b - a) / 0.65));
		const w = (b - a - 0.1 - (n - 1) * 0.1) / n;
		for (let i = 0; i < n; i++) {
			const x0 = a + 0.05 + i * (w + 0.1);
			teal.push(raisedPanel(x0, x0 + w, 0.33, 0.78, PANEL_BACK, PANEL_BACK + 0.016, 0.045));
		}
		teal.push(moulding(WAIN_SKIRT, a, b, { hide: (p, q) => hiddenEdge(p, q) || (p[1] === WAIN_SKIRT_TOP && q[1] === WAIN_SKIRT_TOP) }));
		oak.push(moulding(CAP_PROFILE, a, b));
	}
	await p.part(p.name, { tealPaint: teal, oakDark: oak });
	p.extras = { pivot: 'wall-line', fits: kind === 'wall' ? 'Wall* (also under a window)' : 'Wall*Door + Door' };
	return p;
}

// ------------------------------------------------------------------ lights

/** WallSconce: a brass back plate and arm holding a frosted glass chimney with a warm
 * bulb; origin on the wall's grid line at the plate's foot (lift it to ~1.6 m) */
async function wallSconce() {
	const p = new Piece('WallSconce');
	const z0 = WALL_FACE;
	const brass = [
		place(cyl(0.06, 0.018, 0, 0, 0, 20), { rx: 90, t: [0, 0.06, z0] }),
		place(cyl(0.012, 0.13, 0, 0, 0, 8), { rx: 90, t: [0, 0.07, z0 + 0.012] }),
		place(cyl(0.012, 0.14, 0, 0, 0, 8), { t: [0, 0.07, z0 + 0.142] }),
		cyl(0.045, 0.02, 0, 0.2, z0 + 0.142, 16, 0.035),
		cyl(0.036, 0.02, 0, 0.42, z0 + 0.142, 16, 0.042)
	];
	// the chimney: a tapered lathe, glowing warm (a lit glass shade)
	const prof = [[0.04, 0], [0.06, 0.05], [0.062, 0.12], [0.05, 0.18], [0.04, 0.2]].map(([r, y]) => new THREE.Vector2(r, y));
	const glass = new THREE.LatheGeometry(prof, 16).translate(0, 0.22, z0 + 0.142);
	glass.computeVertexNormals();
	await p.part('WallSconce', { brass, glow: [boxUV(indexed(glass), 1)] });
	p.extras = { pivot: 'wall-line', mountHeight: 1.6 };
	return p;
}

/** FloorLamp: 1.65 m — an iron foot, a brass pole, a deep-teal drum shade lit from inside */
async function floorLamp() {
	const p = new Piece('FloorLamp');
	const brass = [cyl(0.17, 0.025, 0, 0, 0, 24, 0.15), cyl(0.06, 0.04, 0, 0.025, 0, 16, 0.03), cyl(0.014, 1.33, 0, 0.06, 0, 10), cyl(0.03, 0.04, 0, 1.36, 0, 12)];
	// shade: an open truncated cone, outer surface teal cloth; the inner surface glows
	const r0 = 0.23;
	const r1 = 0.17;
	const outer = new THREE.CylinderGeometry(r1, r0, 0.3, 28, 1, true).translate(0, 1.5, 0);
	const inner = new THREE.CylinderGeometry(r1 - 0.004, r0 - 0.004, 0.296, 28, 1, true).translate(0, 1.5, 0);
	inner.scale(-1, 1, 1); // flip winding → its faces point INTO the shade
	inner.computeVertexNormals();
	const bulb = boxUV(new THREE.SphereGeometry(0.045, 12, 8).translate(0, 1.43, 0), 1);
	// brass rims top and bottom of the shade
	const rimB = boxUV(new THREE.TorusGeometry(r0, 0.007, 6, 28).rotateX(Math.PI / 2).translate(0, 1.35, 0), 0);
	const rimT = boxUV(new THREE.TorusGeometry(r1, 0.006, 6, 28).rotateX(Math.PI / 2).translate(0, 1.65, 0), 0);
	await p.part('FloorLamp', { brass: [...brass, rimB, rimT], tealCloth: [boxUV(outer, 1)], glow: [boxUV(inner, 1), bulb] });
	p.extras = { pivot: 'bottom-centre' };
	return p;
}

/** Chandelier: a wrought-iron ring of six candles on three chains; origin = the TOP centre
 * (the ceiling rose), so it hangs from the ceiling: place it at y = 3 under a storey */
async function chandelier() {
	const p = new Piece('Chandelier');
	const R = 0.42;
	const ringY = -0.82;
	const iron = [
		boxUV(new THREE.TorusGeometry(R, 0.018, 8, 40).rotateX(Math.PI / 2).translate(0, ringY, 0), 0),
		boxUV(new THREE.TorusGeometry(R * 0.55, 0.012, 6, 28).rotateX(Math.PI / 2).translate(0, ringY - 0.06, 0), 0),
		cyl(0.09, 0.03, 0, -0.03, 0, 20, 0.06), // ceiling rose (top at y = 0)
		cyl(0.035, 0.12, 0, ringY - 0.1, 0, 12, 0.02) // the boss under the ring
	];
	const wax = [];
	const flames = [];
	for (let i = 0; i < 6; i++) {
		const a = (i * Math.PI) / 3;
		const [x, z] = [R * Math.cos(a), R * Math.sin(a)];
		iron.push(cyl(0.04, 0.025, x, ringY + 0.01, z, 12, 0.03)); // drip cup
		wax.push(cyl(0.017, 0.12, x, ringY + 0.035, z, 10));
		flames.push(flameGeometry(0.75).translate(x, ringY + 0.157, z));
		// spoke from the boss to the ring
		// spoke from the boss to the ring — it starts OUTSIDE the boss (r = 0.03), so the six
		// spokes never overlap at the centre (their flat 6-sided faces would be coplanar)
		const spoke = cyl(0.008, R - 0.03, 0, 0.03, 0, 6);
		iron.push(place(spoke, { rz: -90, ry: (-a * 180) / Math.PI, t: [0, ringY - 0.05, 0] }));
	}
	// three chains (links as thin tori, alternating planes) from the ring to a hook under the rose
	for (let c = 0; c < 3; c++) {
		const a = (c * 2 * Math.PI) / 3 + Math.PI / 6;
		const from = new THREE.Vector3(R * Math.cos(a), ringY, R * Math.sin(a));
		const to = new THREE.Vector3(0, -0.36, 0);
		const n = 9;
		for (let k = 0; k < n; k++) {
			const t = (k + 0.5) / n;
			const pnt = from.clone().lerp(to, t);
			const dir = to.clone().sub(from).normalize();
			const link = new THREE.TorusGeometry(0.018, 0.004, 4, 8).scale(1, 1.6, 1);
			const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
			const spin = new THREE.Quaternion().setFromAxisAngle(dir, k % 2 ? Math.PI / 2 : 0);
			link.applyQuaternion(q.premultiply(spin)).translate(pnt.x, pnt.y, pnt.z);
			iron.push(boxUV(link, 0));
		}
	}
	// one chain from the hook up to the rose
	for (let k = 0; k < 6; k++) {
		const link = new THREE.TorusGeometry(0.02, 0.005, 4, 8).scale(1, 1.6, 1);
		if (k % 2) link.rotateY(Math.PI / 2);
		iron.push(boxUV(link.translate(0, -0.36 + k * 0.055, 0), 0));
	}
	await p.part('Chandelier', { iron, wax, flame: flames });
	p.extras = { pivot: 'top-centre', hangFrom: 'ceiling (y = 3 per storey)' };
	return p;
}

// ------------------------------------------------------------------ decor

/** RugRound: Ø 2 m, 1.2 cm thick — fills one 2 × 2 m floor cell */
async function rugRound() {
	const p = new Piece('RugRound');
	const g = new THREE.CylinderGeometry(1, 1, 0.012, 64, 1, false).translate(0, 0.006, 0);
	const pos = g.attributes.position;
	const nrm = g.attributes.normal;
	const uv = g.attributes.uv;
	for (let i = 0; i < uv.count; i++) {
		// the top takes the woven layout; the rim and underside sample the cream border
		if (nrm.getY(i) > 0.5) uv.setXY(i, pos.getX(i) / 2 + 0.5, 0.5 - pos.getZ(i) / 2);
		else uv.setXY(i, 0.5, 0.03);
	}
	await p.material('rug', { svg: roundRugSvg(), size: 1024, rough: 0.95, metal: 0 });
	await p.part('RugRound', { rug: [g] });
	p.extras = { pivot: 'bottom-centre' };
	return p;
}

/** Picture: a 0.9 × 0.66 m landscape in a gilt frame (one extruded ring — mitred corners);
 * origin on the wall's grid line at the frame's foot (hang it at ~1.3 m) */
async function picture() {
	const p = new Piece('Picture');
	const W = 0.9;
	const H = 0.66;
	const F = 0.075;
	const depth = 0.035;
	const outer = new THREE.Shape();
	outer.moveTo(-W / 2, 0);
	outer.lineTo(W / 2, 0);
	outer.lineTo(W / 2, H);
	outer.lineTo(-W / 2, H);
	outer.lineTo(-W / 2, 0);
	const hole = new THREE.Path();
	hole.moveTo(-W / 2 + F, F);
	hole.lineTo(-W / 2 + F, H - F);
	hole.lineTo(W / 2 - F, H - F);
	hole.lineTo(W / 2 - F, F);
	hole.lineTo(-W / 2 + F, F);
	outer.holes.push(hole);
	const frame = new THREE.ExtrudeGeometry(outer, { depth: depth - 0.01, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.012, bevelSegments: 2, curveSegments: 1 });
	frame.translate(0, 0.012, WALL_FACE + 0.006);
	frame.computeVertexNormals();
	// the canvas sits 1.2 cm behind the frame's front, on its own plane
	const canvas = new THREE.PlaneGeometry(W - 2 * F + 0.02, H - 2 * F + 0.02).translate(0, H / 2 + 0.012, WALL_FACE + 0.022);
	const back = box(W - 0.04, H - 0.04, 0.012, 0, 0.032, WALL_FACE + 0.011);
	await p.material('painting', { svg: landscapeSvg(), size: [1024, 768], rough: 0.85, metal: 0 });
	await p.part('Picture', { brass: [boxUV(indexed(frame), 0)], painting: [canvas], oakDark: [back] });
	p.extras = { pivot: 'wall-line', mountHeight: 1.3 };
	return p;
}

/** WallShelfBooks: two 1.2 m oak shelves on iron brackets, filled with books (one atlas
 * material for every book) and a ceramic jar; origin on the wall's grid line at the
 * lowest bracket's foot (hang it at ~1.1 m) */
async function wallShelfBooks() {
	const p = new Piece('WallShelfBooks');
	const z0 = WALL_FACE;
	const D = 0.24;
	const shelves = [0.14, 0.53];
	const oak = [];
	const iron = [];
	for (const y of shelves) {
		oak.push(box(1.2, 0.03, D, 0, y, z0 + D / 2, 0));
		for (const x of [-0.42, 0.42]) {
			iron.push(box(0.025, 0.134, 0.012, x, y - 0.14, z0 + 0.006)); // top tucked into the arm
			// the arm and strut are NARROWER than the upright: no shared side planes
			iron.push(box(0.02, 0.012, D - 0.03, x, y - 0.012, z0 + 0.012 + (D - 0.042) / 2));
			iron.push(place(box(0.015, 0.17, 0.01, 0, 0, 0), { rx: 45, t: [x, y - 0.13, z0 + 0.012] }));
		}
	}
	// books: a seeded row on each shelf — leaning end books, a lying stack, gaps
	let seed = 7;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
	const books = [];
	const { cols, rows, pages } = BOOK_ATLAS;
	// glTF UVs run top-down (v = 0 is the image's top row)
	const cell = (k) => [(k % cols) / cols, Math.floor(k / cols) / rows, 1 / cols, 1 / rows];
	const book = (w, h, d, x, y, z, k, rz = 0, ry = 0) => {
		const g = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
		const n = g.attributes.normal;
		const uv = g.attributes.uv;
		const [u0, v0, du, dv] = cell(k);
		const [pu0, pv0, pdu, pdv] = cell(pages);
		for (let i = 0; i < uv.count; i++) {
			const [u, v] = [uv.getX(i), uv.getY(i)];
			// spine (+z) and covers (±x) take the colour cell; top/bottom/fore-edge the page block
			if (n.getZ(i) > 0.5 || Math.abs(n.getX(i)) > 0.5) uv.setXY(i, u0 + du * (0.08 + 0.84 * u), v0 + dv * (0.04 + 0.92 * v));
			else uv.setXY(i, pu0 + pdu * (0.1 + 0.8 * u), pv0 + pdv * (0.1 + 0.8 * v));
		}
		return place(g, { rz, ry, t: [x, y, z] });
	};
	for (const [si, y0] of shelves.entries()) {
		const y = y0 + 0.03;
		let x = -0.56;
		const end = 0.56;
		let stackDone = false;
		while (x < end - 0.04) {
			if (!stackDone && x > (si ? 0.05 : -0.2) ) {
				// a lying stack of three
				let sy = y;
				for (let s = 0; s < 3; s++) {
					const h = 0.035 + rnd() * 0.01;
					books.push(book(0.16 + rnd() * 0.03, h, 0.2 - s * 0.01, x + 0.1, sy, z0 + 0.12, Math.floor(rnd() * 8), 0, (rnd() - 0.5) * 12));
					sy += h + 0.001;
				}
				x += 0.24;
				stackDone = true;
				if (si === 0) {
					// the jar beside the stack
					const jar = new THREE.LatheGeometry([[0, 0], [0.05, 0], [0.055, 0.03], [0.05, 0.11], [0.035, 0.13], [0.038, 0.15], [0, 0.15]].map(([r, yy]) => new THREE.Vector2(r, yy)), 14);
					jar.computeVertexNormals();
					p._jar = boxUV(indexed(jar.translate(x + 0.02, y, z0 + 0.12)), 1);
					x += 0.13;
				}
				continue;
			}
			const w = 0.025 + rnd() * 0.03;
			const h = 0.19 + rnd() * 0.09;
			const d = 0.15 + rnd() * 0.05;
			books.push(book(w, h, d, x + w / 2, y, z0 + 0.02 + d / 2, Math.floor(rnd() * 8)));
			x += w + 0.002;
			if (rnd() < 0.07) x += 0.04;
		}
		// the last book leans on its neighbour
		const lh = 0.24;
		books.push(book(0.03, lh, 0.17, end - 0.005, y, z0 + 0.105, Math.floor(rnd() * 8), 0.22));
	}
	await p.material('books', { svg: bookAtlasSvg(512, 768), size: [512, 768], rough: 0.8, metal: 0 });
	await p.part('WallShelfBooks', { oak, iron, books, ceramic: p._jar ? [p._jar] : [] });
	p.extras = { pivot: 'wall-line', mountHeight: 1.1 };
	return p;
}

/** NOT a pack item: a floor pad (top at y = 0) + two stand-in walls on grid lines (back
 * x/z lines) for the cover diorama, when the architecture kit's GLBs are not used */
export async function floorPad(w = 5, d = 4, walls = true) {
	const p = new Piece('FloorPad');
	const planks = [box(w, 0.06, d, 0, -0.06, 0, 0)];
	const wall = walls ? [box(w + 0.25, 2.6, 0.25, 0, 0, -d / 2, 0), box(0.25, 2.6, d, -w / 2, 0, 0, 2)] : [];
	await p.part('FloorPad', walls ? { oakPlanks: planks, plaster: wall } : { oakPlanks: planks });
	return p;
}

export const PIECES = {
	Skirting: () => skirting('wall'),
	SkirtingDoorway: () => skirting('doorway'),
	Cornice: cornice,
	Wainscot: () => wainscot('wall'),
	WainscotDoorway: () => wainscot('doorway'),
	WallSconce: wallSconce,
	FloorLamp: floorLamp,
	Chandelier: chandelier,
	RugRound: rugRound,
	Picture: picture,
	WallShelfBooks: wallShelfBooks
};

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
