// node --test tools/scifi-kit/test/*.test.mjs — the sci-fi kit's own steps, no credits:
// the glow mask (only the painted LIGHTS emit), the procedural pieces' exact sizes and seals,
// and that every procedural document is flat for sync.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { TOOLS, glowMask } from '../kit-post.mjs';
import { PIECES, OPENINGS } from '../procedural.mjs';

const req = createRequire(path.join(TOOLS, 'package.json'));
const load = async (/** @type {string} */ id) => import(pathToFileURL(req.resolve(id)).href);
const { Document } = await load('@gltf-transform/core');
const { getBounds } = await load('@gltf-transform/functions');
const sharp = (await load('sharp')).default;

/** a 4-pixel albedo: bright teal light, dark teal paint, off-white panel, gunmetal */
async function swatchDoc() {
	const px = Buffer.from([82, 214, 204, 47, 127, 122, 217, 214, 207, 87, 88, 90]);
	const img = await sharp(px, { raw: { width: 4, height: 1, channels: 3 } }).png().toBuffer();
	const doc = new Document();
	const mat = doc.createMaterial('m').setBaseColorTexture(doc.createTexture('t').setImage(new Uint8Array(img)).setMimeType('image/png'));
	return { doc, mat };
}

test('glow mask lights the bright teal light and nothing else (not the teal paint, the white, the gunmetal)', async () => {
	const { doc, mat } = await swatchDoc();
	const pct = await glowMask(doc, mat, { hue: [160, 195], sat: 0.35, val: 0.55 });
	assert.equal(pct, 25);
	const { data } = await sharp(Buffer.from(mat.getEmissiveTexture().getImage())).raw().toBuffer({ resolveWithObject: true });
	const lum = [0, 1, 2, 3].map((i) => data[i * 3] + data[i * 3 + 1] + data[i * 3 + 2]);
	assert.ok(lum[0] > 300, `the light pixel is lit (${lum[0]})`);
	for (const i of [1, 2, 3]) assert.ok(lum[i] < 40, `pixel ${i} stays dark (${lum[i]})`);
	assert.deepEqual(mat.getEmissiveFactor(), [1, 1, 1]);
	// counterfactual: with the value floor dropped, the dark teal PAINT would glow too
	const cf = await swatchDoc();
	assert.equal(await glowMask(cf.doc, cf.mat, { hue: [160, 195], sat: 0.35, val: 0 }), 50);
});

const bounds = async (name) => {
	const doc = await PIECES[name]().doc();
	const b = getBounds(doc.getRoot().listScenes()[0]);
	return { doc, min: b.min.map((v) => +v.toFixed(4)), max: b.max.map((v) => +v.toFixed(4)) };
};

test('floor pieces tile the 2 × 2 cell exactly; the ramp is 2 × 1 × 2 (lands on a Block)', async () => {
	for (const n of ['FloorGrate']) {
		const b = await bounds(n);
		assert.deepEqual([b.min, b.max], [[-1, 0, -1], [1, 0.1, 1]], n);
	}
	const r = await bounds('Ramp');
	assert.deepEqual([r.min, r.max], [[-1, 0, -1], [1, 1, 1]]);
});

test('the ceiling slab is solid from its pivot (a slab starting above the wall tops leaks at every wall)', async () => {
	const { doc } = await bounds('CeilingLight');
	const slab = doc.getRoot().listNodes().find((n) => n.getName().endsWith('_whitePanels'));
	const pos = slab.getMesh().listPrimitives()[0].getAttribute('POSITION');
	let lo = Infinity;
	let xs = [Infinity, -Infinity];
	const v = [0, 0, 0];
	for (let i = 0; i < pos.getCount(); i++) {
		pos.getElement(i, v);
		lo = Math.min(lo, v[1]);
		xs = [Math.min(xs[0], v[0]), Math.max(xs[1], v[0])];
	}
	assert.ok(Math.abs(lo) < 1e-6, `the slab reaches down to y = 0, the wall tops (${lo})`);
	assert.deepEqual(xs.map((x) => +x.toFixed(6)), [-1, 1], 'and spans the whole cell');
});

test('pipes: a straight run spans −1..1 on its line, the elbow ends 1 m out on −X and +Z', async () => {
	const s = await bounds('PipeStraight');
	assert.deepEqual([s.min[0], s.max[0]], [-1, 1]);
	const e = await bounds('PipeElbow');
	assert.equal(e.min[0], -1);
	assert.equal(e.max[2], 1);
});

test('the doorway lining and window glass frame the kit-cut openings', async () => {
	const d = await bounds('DoorLining');
	assert.ok(d.min[0] < -OPENINGS.door.w / 2 && d.max[0] > OPENINGS.door.w / 2 && d.max[1] > OPENINGS.door.h, 'the lining overlaps the doorway edges');
	const w = await bounds('WindowGlass');
	const { w: ww, h, sill } = OPENINGS.window;
	assert.ok(w.min[0] < -ww / 2 && w.max[0] > ww / 2 && w.min[1] < sill && w.max[1] > sill + h, 'the frame overlaps the window edges');
});

test('every procedural piece is FLAT for sync: leaf nodes under the scene, one primitive each', async () => {
	for (const name of Object.keys(PIECES)) {
		const doc = await PIECES[name]().doc();
		const scene = doc.getRoot().listScenes()[0];
		assert.equal(doc.getRoot().listNodes().filter((n) => !scene.listChildren().includes(n)).length, 0, `${name}: nested nodes`);
		assert.equal(doc.getRoot().listMeshes().filter((m) => m.listPrimitives().length > 1).length, 0, `${name}: multi-primitive meshes`);
		for (const n of scene.listChildren()) assert.deepEqual(n.getTranslation(), [0, 0, 0], `${name}: node at the pivot`);
	}
});
