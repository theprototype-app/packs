// meshy-post on a synthetic "raw Meshy" GLB: a transformed 8k-tri sphere with a 2048²
// PNG texture and a black emissive map. No network, no credits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
import { postProcess, scaleFor, pivotOffset, countTris } from '../lib/post.js';

async function rawGlb(file) {
	const doc = new Document();
	const buf = doc.createBuffer();
	const W = 64, H = 64;
	const pos = [], uv = [], idx = [];
	for (let y = 0; y <= H; y++)
		for (let x = 0; x <= W; x++) {
			const u = x / W, v = y / H;
			const th = u * Math.PI * 2, ph = v * Math.PI;
			pos.push(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
			uv.push(u, v);
		}
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const a = y * (W + 1) + x, b = a + W + 1;
			idx.push(a, b, a + 1, b, b + 1, a + 1);
		}
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
		.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buf))
		.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buf));
	// a NON-solid texture (prune folds a solid-colour one into a factor, correctly)
	const px = Buffer.alloc(2048 * 2048 * 3);
	for (let i = 0; i < px.length; i++) px[i] = (i * 7919) % 251;
	const png = await sharp(px, { raw: { width: 2048, height: 2048, channels: 3 } }).png().toBuffer();
	// near-black like Meshy's real one (min 0, max 5, mean ≈ 0: sparse specks — which
	// prune's solid-texture check does NOT fold, so meshy-post has to drop it)
	const dark = Buffer.alloc(1024 * 1024 * 3);
	for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) if (x % 128 < 16 && y % 128 < 16) dark.fill(5, (y * 1024 + x) * 3, (y * 1024 + x) * 3 + 3);
	const black = await sharp(dark, { raw: { width: 1024, height: 1024, channels: 3 } }).png().toBuffer();
	const mat = doc
		.createMaterial('m')
		.setBaseColorTexture(doc.createTexture('base').setImage(png).setMimeType('image/png'))
		.setEmissiveTexture(doc.createTexture('emi').setImage(black).setMimeType('image/png'))
		.setEmissiveFactor([1, 1, 1]);
	prim.setMaterial(mat);
	// a parent transform + a child transform, like Meshy's scene graphs: meshy-post must bake both
	const child = doc.createNode('mesh').setMesh(doc.createMesh().addPrimitive(prim)).setTranslation([5, 3, -2]).setScale([2, 1, 3]);
	const parent = doc.createNode('root').setTranslation([1, 1, 1]).setScale([0.5, 0.5, 0.5]).addChild(child);
	doc.createScene().addChild(parent);
	doc.getRoot().getAsset().generator = 'Meshy-like generator';
	await new NodeIO().write(file, doc);
}

test('scaleFor: contain is uniform & fits, stretch hits every given axis', () => {
	assert.deepEqual(scaleFor([2, 4, 1], { y: 2 }), [0.5, 0.5, 0.5]);
	assert.deepEqual(scaleFor([2, 4, 1], { x: 1, y: 4 }), [0.5, 0.5, 0.5]);
	assert.deepEqual(scaleFor([2, 3, 0.5], { x: 2, y: 3, z: 0.25 }, 'stretch'), [1, 1, 0.5]);
	assert.deepEqual(scaleFor([1, 1, 1], undefined), [1, 1, 1]);
});

test('pivotOffset: bottom-center / bottom-back-left / center', () => {
	const b = { min: [1, 2, 3], max: [3, 6, 5] };
	assert.deepEqual(pivotOffset(b, 'bottom-center'), [-2, -2, -4]);
	assert.deepEqual(pivotOffset(b, 'bottom-back-left'), [-1, -2, -3]);
	assert.deepEqual(pivotOffset(b, 'center'), [-2, -4, -4]);
	assert.throws(() => pivotOffset(b, 'nope'));
});

test('postProcess: bakes transforms, simplifies to budget, scales to dims, pivots, 1024² JPEG, drops black emissive, keeps provenance', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshy-post-'));
	const raw = path.join(dir, 'raw.glb');
	const out = path.join(dir, 'model.glb');
	await rawGlb(raw);
	const r = await postProcess(raw, out, { targetTris: 1000, dims: { y: 2 } });
	assert.ok(r.trisIn >= 8000, `raw ${r.trisIn}`);
	assert.ok(r.trisOut <= 1050 && r.trisOut > 300, `simplified to ${r.trisOut}`);
	assert.ok(Math.abs(r.size[1] - 2) < 1e-3, `height ${r.size[1]}`);
	assert.ok(Math.abs(r.bounds.min[1]) < 1e-3, 'sits on y=0');
	assert.ok(Math.abs(r.bounds.min[0] + r.bounds.max[0]) < 1e-3 && Math.abs(r.bounds.min[2] + r.bounds.max[2]) < 1e-3, 'centred on x/z');
	// non-uniform node scale [2,1,3] was baked: the footprint keeps the 2:3 x/z ratio of the scaled sphere
	assert.ok(Math.abs(r.size[2] / r.size[0] - 1.5) < 0.05, `x:z ratio ${r.size[0]}:${r.size[2]}`);
	assert.equal(r.droppedEmissive, 1);
	assert.deepEqual(r.textures.map((t) => [t.mime, ...t.size]), [['image/jpeg', 1024, 1024]]);
	const doc = await new NodeIO().read(out);
	for (const n of doc.getRoot().listNodes()) {
		assert.deepEqual(n.getTranslation(), [0, 0, 0]);
		assert.deepEqual(n.getScale(), [1, 1, 1]);
	}
	assert.equal(countTris(doc), r.trisOut);
	assert.equal(doc.getRoot().getAsset().extras.meshyPost.trisIn, r.trisIn);

	const w = await postProcess(raw, out, { dims: { x: 2, y: 3, z: 0.25 }, fit: 'stretch', pivot: 'bottom-back-left' });
	assert.deepEqual(w.size, [2, 3, 0.25], 'a wall panel lands on exactly 2 × 3 × 0.25 m');
	assert.deepEqual(w.bounds.min, [0, 0, 0], 'bottom-back-left pivot at the origin');
});
