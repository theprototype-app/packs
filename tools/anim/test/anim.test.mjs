// node --test tools/anim/test/*.test.mjs — the rigging maths, on a synthetic door (no credits, no browser)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clip, reverse, swing, quat, part, proc, assemble, io, THREE } from '../anim.mjs';

const area = (/** @type {number[][][]} */ tris) =>
	tris.reduce((s, [a, b, c]) => {
		const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
		const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
		return s + Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
	}, 0);
const V = (/** @type {number} */ x, /** @type {number} */ y) => [x, y, 0, 0, 0, 1, x, y];

test('keep + cut split a triangle that crosses the plane, and the halves add up', () => {
	const tri = [[V(-1, 0), V(1, 0), V(0, 1)]];
	const left = clip(tri, [[1, 0, 0, 0]], 'keep'); // x <= 0
	const right = clip(tri, [[1, 0, 0, 0]], 'cut');
	assert.ok(Math.abs(area(left) - 0.5) < 1e-9);
	assert.ok(Math.abs(area(right) - 0.5) < 1e-9);
	assert.ok(left.flat().every((v) => v[0] <= 1e-9), 'nothing of the kept half crosses the plane');
	// the UV is interpolated with the position, not copied
	for (const v of left.flat()) assert.ok(Math.abs(v[6] - v[0]) < 1e-9);
});

test('reverse plays a key list backwards on the same timeline', () => {
	const k = swing('y', 0, 90, 1, 4);
	const r = reverse(k);
	assert.equal(r[0][0], 0);
	assert.equal(r.at(-1)?.[0], 1);
	assert.deepEqual(r[0][1], k.at(-1)?.[1]);
	assert.deepEqual(r.at(-1)?.[1], quat('y', 0));
});

test('assemble: named nodes on their pivots, idle clip FIRST, behavior in scene.extras', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anim-test-'));
	// a source GLB: one 1 × 2 m slab with a material
	const { Document } = await import('../anim.mjs');
	const doc = new Document();
	const geo = new THREE.BoxGeometry(1.2, 2.2, 0.2).translate(0, 1.1, 0).toNonIndexed();
	const buf = doc.createBuffer();
	const prim = doc.createPrimitive().setMaterial(doc.createMaterial('oak'));
	prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(geo.attributes.position.array)).setBuffer(buf));
	prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(geo.attributes.normal.array)).setBuffer(buf));
	prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(geo.attributes.uv.array)).setBuffer(buf));
	doc.createScene().addChild(doc.createNode('slab').setMesh(doc.createMesh().addPrimitive(prim)));
	const src = path.join(dir, 'slab.glb');
	await io.write(src, doc);

	const frame = (await part(src)).cut([[-1, 0, 0, 0.5], [1, 0, 0, 0.5], [0, 1, 0, 2]]).at('Frame');
	const leaf = (await part(src)).keep([[-1, 0, 0, 0.5], [1, 0, 0, 0.5], [0, 1, 0, 2]]).at('Leaf', [-0.5, 0, -0.1]);
	const out = path.join(dir, 'door.glb');
	const behavior = { type: 'door', clip: 'open', closeClip: 'close', trigger: 'click', autoplay: false };
	const open = swing('y', 0, 90, 1);
	await assemble([frame, leaf], out, { clips: [{ name: 'open', tracks: [{ node: 'Leaf', path: 'rotation', keys: open }] }, { name: 'close', tracks: [{ node: 'Leaf', path: 'rotation', keys: reverse(open) }] }], behavior });

	const back = await io.read(out);
	const root = back.getRoot();
	assert.deepEqual(root.listAnimations().map((a) => a.getName()), ['idle', 'open', 'close']);
	// idle holds the REST pose (it is what a build that autoplays animations[0] shows)
	const idle = root.listAnimations()[0];
	const out0 = Array.from(idle.listSamplers()[0].getOutput().getArray());
	assert.deepEqual(out0, [0, 0, 0, 1, 0, 0, 0, 1]);
	assert.deepEqual(root.listScenes()[0].getExtras().behavior, behavior);
	const leafNode = root.listNodes().find((n) => n.getName() === 'Leaf');
	assert.deepEqual(Array.from(leafNode.getTranslation()).map((v) => +v.toFixed(4)), [-0.5, 0, -0.1]);
	// the leaf's geometry is relative to its hinge: x from 0 to 1
	const pos = leafNode.getMesh().listPrimitives()[0].getAttribute('POSITION');
	const xs = [];
	for (let i = 0; i < pos.getCount(); i++) xs.push(pos.getElement(i, [0, 0, 0])[0]);
	assert.ok(Math.abs(Math.min(...xs)) < 1e-5 && Math.abs(Math.max(...xs) - 1) < 1e-5);
	fs.rmSync(dir, { recursive: true, force: true });
});

test('proc wears a material from a GLB and joins another part in the same document', async () => {
	const torch = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../props-kit/WallTorch/glTF-Binary/wall-torch.glb');
	const a = await proc(new THREE.BoxGeometry(1, 1, 1), torch, { material: 'oak' });
	const b = await proc(new THREE.BoxGeometry(1, 1, 1), torch, { into: a, material: 'iron' });
	a.add(b);
	assert.equal(a.pieces.length, 2);
	assert.throws(() => a.add(/** @type {any} */ ({ doc: {}, label: 'x', pieces: [] })));
});
