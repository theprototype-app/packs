// kit-build check: the fixture pack passes, and every check goes RED when its one thing is broken
// (the counterfactual per guard). No browser, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runChecks } from '../lib/check.mjs';
import { passPack } from '../lib/pass.mjs';
import { fixture, boxGlb, errorsOf } from './fixture.mjs';

/** run the checks on a fixture and return its unallowed errors @param {(f: any) => any} [edit] */
async function errors(edit) {
	const dir = await fixture(edit);
	try {
		return errorsOf(await runChecks(dir));
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}
const has = (/** @type {string[]} */ errs, /** @type {string} */ check, /** @type {RegExp} */ re) =>
	assert.ok(errs.some((e) => e.startsWith(`${check}:`) && re.test(e)), `expected a ${check} error matching ${re}, got:\n${errs.join('\n') || '(none)'}`);

test('the fixture pack passes every check', async () => {
	assert.deepEqual(await errors(), []);
});

test('index: a row without a source URL, and a value file that does not exist', async () => {
	const e = await errors((f) => {
		delete f.index[0].source;
		f.index.push({ ...f.index[0], name: 'ghost', value: 'ghost/default.json', source: 'https://x.y' });
	});
	has(e, 'index', /source must be an https URL/);
	has(e, 'index', /ghost\/default.json does not exist/);
});

test('manifest: an unknown row key (a typo) and a duplicate item', async () => {
	const e = await errors((f) => {
		f.rows[0].lable = 'typo';
		f.rows.push({ ...f.rows[0] });
	});
	has(e, 'manifest', /unknown key "lable"/);
	has(e, 'manifest', /duplicate item name/);
});

test('size: a GLB over the share cap', async () => {
	has(await errors((f) => (f.limits.glbFailBytes = 1000)), 'size', /over the 5 MiB share cap/);
});

test('tris: LOD0 over its category budget', async () => {
	has(await errors((f) => (f.categories.prop.tris = 10)), 'tris', /12 triangles is over the prop budget of 10/);
});

test('textures: a texture over the pack cap', async () => {
	has(await errors(async (f) => (f.files['kit/Box/glTF-Binary/box.glb'] = await boxGlb({ texture: 2048 }))), 'textures', /2048² texture is over the pack's 1024 cap/);
});

test('emissive: a glowing material in a "nothing glows" pack', async () => {
	const e = await errors(async (f) => {
		f.policy.emissive = 'none';
		f.files['kit/Box/glTF-Binary/box.glb'] = await boxGlb({ emissive: true });
	});
	has(e, 'emissive', /policy is "nothing glows"/);
});

test('scale: a box exported in centimetres', async () => {
	has(await errors(async (f) => (f.files['kit/Box/glTF-Binary/box.glb'] = await boxGlb({ scale: 100 }))), 'scale', /exported in cm/);
});

test('pivot: a box whose origin is off to the side (and the declared exception lets a wall piece through)', async () => {
	has(await errors(async (f) => (f.files['kit/Box/glTF-Binary/box.glb'] = await boxGlb({ offset: [2, 0, 0] }))), 'pivot', /not bottom-centre/);
	assert.deepEqual(
		await errors(async (f) => {
			f.files['kit/Box/glTF-Binary/box.glb'] = await boxGlb({ offset: [0, 1, 0] });
			f.policy.items = { Box: { pivot: 'wall-pivot' } };
		}),
		[]
	);
});

test('lods: required over the floor; a missing file; a wrong ratio; a level with foreign node names; a level without the clips', async () => {
	has(await errors((f) => (f.limits.lodRequiredOver = 5)), 'lods', /no LOD files/);
	has(await errors((f) => (f.rows[0].lods = [{ file: 'box.lod1.glb', ratio: 0.67 }])), 'lods', /box.lod1.glb does not exist/);
	has(
		await errors(async (f) => {
			f.rows[0].lods = [{ file: 'box.lod1.glb', ratio: 0.3 }];
			f.files['kit/Box/glTF-Binary/box.lod1.glb'] = await boxGlb({ faces: 4 });
		}),
		'lods',
		/ratio 0.3 but the file has 67 %/
	);
	assert.deepEqual(
		await errors(async (f) => {
			f.rows[0].lods = [{ file: 'box.lod1.glb', ratio: 0.67 }];
			f.files['kit/Box/glTF-Binary/box.lod1.glb'] = await boxGlb({ faces: 4 });
		}),
		[],
		'a right level passes'
	);
	has(
		await errors(async (f) => {
			// LOD0 draws two nodes; the level one, under a name LOD0 does not have (core cannot match it)
			f.rows[0].lods = [{ file: 'box.lod1.glb', ratio: 0.33 }];
			f.files['kit/Box/glTF-Binary/box.glb'] = await boxGlb({ twin: 'Lid' });
			f.files['kit/Box/glTF-Binary/box.lod1.glb'] = await boxGlb({ faces: 4, nodeName: 'Other' });
		}),
		'lods',
		/BY NODE NAME|has mesh nodes LOD0 does not/
	);
	has(
		await errors(async (f) => {
			f.rows[0].lods = [{ file: 'box.lod1.glb', ratio: 0.67 }];
			f.files['kit/Box/glTF-Binary/box.glb'] = await boxGlb({ clips: ['open'] });
			f.files['kit/Box/glTF-Binary/box.lod1.glb'] = await boxGlb({ faces: 4 });
		}),
		'lods',
		/lacks LOD0's clips open/
	);
});

test('behavior: a clip the GLB does not have; a door that autoplays', async () => {
	const door = { type: 'door', clip: 'open', trigger: 'click' };
	assert.deepEqual(
		await errors(async (f) => {
			f.rows[0].behavior = door;
			f.files['kit/Box/glTF-Binary/box.glb'] = await boxGlb({ clips: ['open'] });
		}),
		[]
	);
	has(await errors((f) => (f.rows[0].behavior = door)), 'behavior', /"open" is not a clip of the GLB/);
	has(await errors((f) => (f.rows[0].behavior = { ...door, autoplay: true })), 'manifest', /autoplay is only for type "loop"/);
});

test('flicker: a decal lying ON a face fails; its recorded baseline lets it through; worse than the baseline fails', async () => {
	const decal = async (/** @type {any} */ f) => (f.files['kit/Box/glTF-Binary/box.glb'] = await boxGlb({ coplanar: true }));
	has(await errors(decal), 'flicker', /coplanar pairs, 3600\.0 cm² of overlap/);
	const file = 'kit/Box/glTF-Binary/box.glb';
	assert.deepEqual(await errors(async (f) => (await decal(f), (f.baseline[file] = { cm2: 3600, pairs: 2, px: 10, why: 'test' }))), []);
	has(await errors(async (f) => (await decal(f), (f.baseline[file] = { cm2: 100, pairs: 2, px: 10, why: 'test' }))), 'flicker', /WORSE than its baseline/);
});

test('thumb: a row whose screenshot is missing, or too small', async () => {
	has(await errors((f) => delete f.files['kit/Box/thumb.webp']), 'thumb', /no thumbnail/);
	has(await errors((f) => (f.limits.thumbMinPx = 256)), 'thumb', /\(< 256 px\)/);
});

test('allow-list: a listed failure is accepted with its reason; an entry that matches nothing warns', async () => {
	const dir = await fixture((f) => {
		f.categories.prop.tris = 10;
		f.allow = [
			{ pack: 'kit', item: 'Box', check: 'tris', reason: 'test' },
			{ pack: 'kit', item: 'Gone', check: 'lods', reason: 'stale' }
		];
	});
	try {
		const r = await runChecks(dir);
		assert.deepEqual(errorsOf(r), []);
		assert.equal(r.findings.find((x) => x.check === 'tris')?.allowed, 'test');
		assert.ok(r.findings.some((x) => x.level === 'warn' && x.check === 'allow' && x.item === 'Gone'));
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('pass: fixes texture cap and emissive policy — and leaves a compliant file byte-identical', async () => {
	const dir = await fixture(async (f) => {
		f.policy.emissive = 'none';
		f.files['kit/Box/glTF-Binary/box.glb'] = await boxGlb({ texture: 2048, emissive: true });
	});
	const glb = path.join(dir, 'kit/Box/glTF-Binary/box.glb');
	try {
		assert.ok(errorsOf(await runChecks(dir)).length >= 2, 'red before the pass');
		const before = fs.readFileSync(glb);
		assert.equal(await passPack(dir, 'kit', {}), 1, 'a dry run reports it');
		assert.deepEqual(fs.readFileSync(glb), before, 'a dry run writes nothing');
		assert.equal(await passPack(dir, 'kit', { write: true }), 1);
		assert.deepEqual(errorsOf(await runChecks(dir)), [], 'green after the pass');
		const fixed = fs.readFileSync(glb);
		assert.equal(await passPack(dir, 'kit', { write: true }), 0, 'nothing left to do');
		assert.deepEqual(fs.readFileSync(glb), fixed, 'and the file is not rewritten');
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('pass: an opaque PNG over the share cap becomes JPEG', async () => {
	const dir = await fixture(async (f) => {
		f.files['kit/Box/glTF-Binary/box.glb'] = await boxGlb({ png: 512 });
		f.limits.glbFailBytes = 400_000;
	});
	try {
		has(errorsOf(await runChecks(dir)), 'size', /share cap/);
		await passPack(dir, 'kit', { write: true });
		assert.deepEqual(errorsOf(await runChecks(dir)), []);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('pass: LOD0 over its triangle budget is decimated to it (node names kept)', async () => {
	const { load, makeIO } = await import('../lib/deps.mjs');
	const { Document } = await load('@gltf-transform/core');
	// a 2 × 2 m floor tile of 40 × 40 quads = 3 200 triangles, flat: meshopt can take nearly all of them
	const doc = new Document();
	const buf = doc.createBuffer();
	const n = 40;
	const P = [];
	const I = [];
	for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) P.push((2 * x) / n - 1, 0, (2 * z) / n - 1);
	for (let z = 0; z < n; z++)
		for (let x = 0; x < n; x++) {
			const a = z * (n + 1) + x;
			I.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
		}
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(P)).setBuffer(buf))
		.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(I)).setBuffer(buf))
		.setMaterial(doc.createMaterial('M'));
	doc.createScene('Scene').addChild(doc.createNode('Tile').setMesh(doc.createMesh('Tile').addPrimitive(prim)));
	const tile = Buffer.from(await makeIO().writeBinary(doc));
	const dir = await fixture((f) => {
		f.files['kit/Box/glTF-Binary/box.glb'] = tile;
		f.categories.prop.tris = 500;
	});
	try {
		has(errorsOf(await runChecks(dir)), 'tris', /3200 triangles is over the prop budget of 500/);
		await passPack(dir, 'kit', { write: true });
		const r = await runChecks(dir);
		assert.deepEqual(errorsOf(r), []);
		assert.ok(r.items[0].tris <= 500 && r.items[0].tris > 0, `decimated to ${r.items[0].tris}`);
		assert.deepEqual(r.items[0].meshNodes, ['Tile']);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
