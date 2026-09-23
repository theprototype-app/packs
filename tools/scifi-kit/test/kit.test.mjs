// node --test tools/scifi-kit/test/ — the kit's geometry steps on synthetic walls (no credits,
// no Meshy): the seam clamp, the clipper, the exact door opening + its jambs, and the mortar core
// that seals a wall built from separate bricks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { TOOLS, parseClamp, seamClamp } from '../kit-post.mjs';
import { clip, kitCut, DERIVE } from '../kit-cut.mjs';

const req = createRequire(path.join(TOOLS, 'package.json'));
const load = async (/** @type {string} */ id) => import(pathToFileURL(req.resolve(id)).href);
const { Document, NodeIO } = await load('@gltf-transform/core');
const sharp = (await load('sharp')).default;
const io = new NodeIO();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-test-'));

/** triangles of an axis-aligned box [lo, hi] (12, outward normals, planar uvs) */
function box(lo, hi) {
	const tris = [];
	const quad = (/** @type {number[][]} */ q, /** @type {number[]} */ n) => {
		const v = q.map((p) => ({ p, n, uv: [(p[0] + 1) / 2, 1 - p[1] / 3] }));
		tris.push([v[0], v[1], v[2]], [v[0], v[2], v[3]]);
	};
	const [x0, y0, z0] = lo;
	const [x1, y1, z1] = hi;
	quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
	quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1]);
	quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0]);
	quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
	quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0]);
	quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]);
	return tris;
}

/** a textured GLB from triangles (one primitive, like meshy-post's join) */
async function writeGlb(/** @type {any[]} */ tris, /** @type {string} */ file) {
	const doc = new Document();
	const buf = doc.createBuffer();
	const flat = (/** @type {(v: any) => number[]} */ f) => new Float32Array(tris.flatMap((t) => t.flatMap(f)));
	const acc = (/** @type {Float32Array} */ a, /** @type {string} */ type) => doc.createAccessor().setType(type).setArray(a).setBuffer(buf);
	// a 2-tone texture: light stone on top, dark mortar in the bottom-left corner
	const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#e0c080' } })
		.composite([{ input: { create: { width: 2, height: 2, channels: 3, background: '#403830' } }, left: 0, top: 6 }])
		.jpeg()
		.toBuffer();
	const tex = doc.createTexture().setImage(new Uint8Array(png)).setMimeType('image/jpeg');
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', acc(flat((v) => v.p), 'VEC3'))
		.setAttribute('NORMAL', acc(flat((v) => v.n), 'VEC3'))
		.setAttribute('TEXCOORD_0', acc(flat((v) => v.uv), 'VEC2'))
		.setMaterial(doc.createMaterial().setBaseColorTexture(tex));
	doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
	await io.write(file, doc);
}

async function readTris(/** @type {string} */ file) {
	const doc = await io.read(file);
	const out = [];
	for (const m of doc.getRoot().listMeshes())
		for (const p of m.listPrimitives()) {
			const pos = p.getAttribute('POSITION');
			const nrm = p.getAttribute('NORMAL');
			const idx = p.getIndices();
			const at = (/** @type {number} */ i) => ({ p: pos.getElement(i, [0, 0, 0]), n: nrm.getElement(i, [0, 0, 0]) });
			const n = idx ? idx.getCount() : pos.getCount();
			for (let i = 0; i < n; i += 3) out.push([0, 1, 2].map((k) => at(idx ? idx.getScalar(i + k) : i + k)));
		}
	return out;
}

/** the see-through points of a wall seen along z, on a grid (skips degenerate projections) */
function seeThrough(/** @type {any[]} */ tris, step = 0.05, region = [-0.99, 0.01, 0.99, 2.99]) {
	const t2 = tris
		.map((t) => t.map((v) => [v.p[0], v.p[1]]))
		.filter(([a, b, c]) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) > 1e-9);
	const s = (/** @type {number[]} */ u, /** @type {number[]} */ v, /** @type {number[]} */ w) => (u[0] - w[0]) * (v[1] - w[1]) - (v[0] - w[0]) * (u[1] - w[1]);
	const holes = [];
	for (let x = region[0]; x < region[2]; x += step)
		for (let y = region[1]; y < region[3]; y += step) {
			const p = [x, y];
			const hit = t2.some(([a, b, c]) => {
				const d = [s(p, a, b), s(p, b, c), s(p, c, a)];
				return !(d.some((v) => v < 0) && d.some((v) => v > 0));
			});
			if (!hit) holes.push(p);
		}
	return holes;
}

/** a 2 × 3 × 0.25 wall of two brick courses with a see-through 4 cm mortar joint at y 1.48–1.52 */
const BRICKS = [...box([-1, 0, -0.125], [1, 1.48, 0.125]), ...box([-1, 1.52, -0.125], [1, 3, 0.125])];

test('parseClamp reads axes and single faces', () => {
	assert.deepEqual(parseClamp('xz-y'), [
		{ axis: 0, side: 0 },
		{ axis: 2, side: 0 },
		{ axis: 1, side: -1 }
	]);
});

test('seamClamp puts a joint face exactly on the bbox plane (and eps 0 does not)', async () => {
	const file = path.join(tmp, 'clamp.glb');
	// a stone that stops 3 cm short of the wall end at x = 1
	await writeGlb([...box([-1, 0, -0.125], [1, 1, 0.125]), ...box([-1, 1, -0.125], [0.97, 2, 0.125])], file);
	const doc = await io.read(file);
	assert.equal(seamClamp(doc, 'x', 0), 0, 'counterfactual: eps 0 moves nothing — the 3 cm gap would stay');
	const moved = seamClamp(doc, 'x', 0.04);
	assert.ok(moved > 0);
	const pos = doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION');
	let short = 0;
	for (let i = 0; i < pos.getCount(); i++) if (Math.abs(pos.getElement(i, [0, 0, 0])[0] - 0.97) < 1e-6) short++;
	assert.equal(short, 0, 'no vertex is left at x = 0.97');
});

test('clip: cut removes exactly the region, keep keeps exactly it', () => {
	const quad = box([-1, 0, 0], [1, 3, 0]).slice(0, 2).map((t) => t.map((v) => [...v.p, ...v.n]));
	const area = (/** @type {number[][][]} */ ts) => ts.reduce((a, [p, q, r]) => a + Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2, 0);
	const door = [[-1, 0, 0, 0.5], [1, 0, 0, 0.5], [0, 1, 0, 2.2]];
	assert.ok(Math.abs(area(clip(quad, door, 'cut', 3)) - (6 - 1 * 2.2)) < 1e-9, 'a 1 × 2.2 doorway leaves 3.8 m²');
	assert.ok(Math.abs(area(clip(quad, [[0, 1, 0, 1.5]], 'keep', 3)) - 3) < 1e-9, 'the lower half keeps 3 m²');
});

test('the mortar core seals a wall of separate bricks (without it the joint is see-through)', async () => {
	const raw = path.join(tmp, 'bricks.glb');
	await writeGlb(BRICKS, raw);
	const open = seeThrough(await readTris(raw));
	assert.ok(open.length > 0, `counterfactual: the bare bricks leak through the joint (${open.length} points)`);
	assert.ok(open.every(([, y]) => y > 1.45 && y < 1.55), 'and only through the joint');
	const cored = path.join(tmp, 'cored.glb');
	await kitCut(raw, cored, [{ op: 'core', depth: 0.075 }]);
	const tris = await readTris(cored);
	assert.equal(seeThrough(tris).length, 0, 'with the core nothing shows through');
	const zs = tris.filter((t) => t.every((v) => Math.abs(v.p[2]) < 0.1)).flatMap((t) => t.map((v) => v.p[2]));
	assert.ok(zs.length && zs.every((z) => Math.abs(z) <= 0.075 + 1e-6), 'the core stays 5 cm behind the brick faces');
});

test('door: an exact 1.0 × 2.2 m opening whose jambs face into it', async () => {
	const raw = path.join(tmp, 'bricks2.glb');
	await writeGlb(BRICKS, raw);
	const cored = path.join(tmp, 'cored2.glb');
	await kitCut(raw, cored, [{ op: 'core', depth: 0.075 }]);
	const out = path.join(tmp, 'door.glb');
	await kitCut(cored, out, DERIVE.door());
	const tris = await readTris(out);
	const holes = seeThrough(tris, 0.05);
	assert.ok(holes.length > 0 && holes.every(([x, y]) => x > -0.5 && x < 0.5 && y < 2.2), 'see-through only inside the doorway');
	const inside = seeThrough(tris, 0.05, [-0.47, 0.03, 0.47, 2.17]);
	assert.equal(inside.length, Math.ceil(0.94 / 0.05) * Math.ceil(2.14 / 0.05), 'and ALL of the doorway is open');
	// every cut face must face INTO the opening, or it is back-face culled and the doorway
	// shows the wall's hollow inside: left jamb +x, right jamb -x, lintel soffit -y
	const normalOf = (/** @type {any[]} */ t) => {
		const [a, b, c] = t.map((v) => v.p);
		const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
		const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
		return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
	};
	for (const [label, on, axis, sign] of /** @type {const} */ ([
		['left jamb', (/** @type {number[]} */ p) => Math.abs(p[0] + 0.5) < 1e-6 && p[1] <= 2.2 + 1e-6, 0, 1],
		['right jamb', (/** @type {number[]} */ p) => Math.abs(p[0] - 0.5) < 1e-6 && p[1] <= 2.2 + 1e-6, 0, -1],
		['lintel', (/** @type {number[]} */ p) => Math.abs(p[1] - 2.2) < 1e-6 && Math.abs(p[0]) <= 0.5 + 1e-6, 1, -1]
	])) {
		const faces = tris.filter((t) => t.every((v) => on(v.p))).filter((t) => Math.hypot(...normalOf(t)) > 1e-9);
		assert.ok(faces.length > 0, `the ${label} exists`);
		assert.ok(faces.every((t) => normalOf(t)[axis] * sign > 0), `every ${label} triangle winds to face into the doorway`);
	}
});

test('an OPEN core seals right up to the joint plane (an inset one leaves a slit at the wall end)', async () => {
	const raw = path.join(tmp, 'bricks3.glb');
	await writeGlb(BRICKS, raw);
	// the last half millimetre before the end, along the whole height
	const endStrip = [0.9993, 0.01, 0.9997, 2.99];
	const inset = path.join(tmp, 'inset.glb');
	await kitCut(raw, inset, [{ op: 'core', depth: 0.075 }]);
	assert.ok(seeThrough(await readTris(inset), 0.0002, endStrip).length > 0, 'counterfactual: the 1 mm inset core leaves the joint open at the end');
	const open = path.join(tmp, 'open.glb');
	await kitCut(raw, open, [{ op: 'core', depth: 0.075, open: 'x' }]);
	const tris = await readTris(open);
	assert.equal(seeThrough(tris, 0.0002, endStrip).length, 0, 'the open core reaches the end: nothing shows through');
	const endFaces = tris.filter((t) => [-1, 1].some((x) => t.every((v) => Math.abs(v.p[0] - x) < 1e-6 && Math.abs(v.p[2]) <= 0.075 + 1e-6)));
	assert.equal(endFaces.length, 0, 'and it has no end face of its own to z-fight the bricks');
});
