// kit-build rules: the pure checks, each shown red on the input it exists to catch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { behaviorProblems, behaviorClipProblems, lodsProblems, itemRowProblems, indexRowProblems, pivotProblem, scaleProblem } from '../lib/rules.mjs';

test('behavior: the shipped door passes; typos and rule breaks do not', () => {
	const door = { type: 'door', clip: 'open', closeClip: 'close', trigger: 'click', autoplay: false, sound: 'door', collider: 'follow' };
	assert.deepEqual(behaviorProblems(door), []);
	assert.deepEqual(behaviorProblems({ type: 'loop', clip: 'spin', trigger: 'click', autoplay: true }), [], 'an ambient loop may autoplay');
	assert.match(behaviorProblems({ ...door, type: 'dor' }).join(), /type must be one of/);
	assert.match(behaviorProblems({ ...door, trigger: 'clik' }).join(), /trigger must be one of/, 'core would silently make it "click"');
	assert.match(behaviorProblems({ ...door, autoplay: true }).join(), /only for type "loop"/);
	assert.match(behaviorProblems({ ...door, closeClip: 'open' }).join(), /equals clip/);
	assert.match(behaviorProblems({ type: 'oneshot', clip: 'x', closeClip: 'y' }).join(), /only for door \/ toggle/);
	assert.match(behaviorProblems({ ...door, colider: 'follow' }).join(), /unknown key "colider"/);
	assert.match(behaviorProblems({ ...door, clip: '' }).join(), /clip must be a clip name/);
	assert.deepEqual(behaviorClipProblems(door, ['idle', 'open', 'close']), []);
	assert.match(behaviorClipProblems(door, ['idle', 'open']).join(), /closeClip "close" is not a clip/);
});

test('lods: finest first, files beside LOD0, ratios in (0, 1]', () => {
	assert.deepEqual(lodsProblems([{ file: 'a.lod1.glb', ratio: 0.5 }, { file: 'a.lod2.glb', ratio: 0.2 }]), []);
	assert.match(lodsProblems([{ file: 'a.lod2.glb', ratio: 0.2 }, { file: 'a.lod1.glb', ratio: 0.5 }]).join(), /finest first/);
	assert.match(lodsProblems([{ file: '../b/a.lod1.glb', ratio: 0.5 }]).join(), /beside LOD0/);
	assert.match(lodsProblems([{ file: 'sub/a.lod1.glb', ratio: 0.5 }]).join(), /beside LOD0/);
	assert.match(lodsProblems([{ file: 'a.lod1.glb', ratio: 0 }]).join(), /ratio must be a number in \(0, 1\]/);
	assert.match(lodsProblems([{ file: 'a.lod1.glb', ratio: '0.5' }]).join(), /ratio must be a number/);
	assert.match(lodsProblems([]).join(), /non-empty/);
});

test('rows: the shape core reads', () => {
	const row = { name: 'WallStone', label: 'Wall', screenshot: 'screenshot/screenshot.webp', variants: { 'glTF-Binary': 'wall-stone.glb' } };
	assert.deepEqual(itemRowProblems(row), []);
	assert.deepEqual(itemRowProblems({ ...row, variants: { 'glTF-Binary': 'https://raw.githubusercontent.com/x/y.glb' }, screenshot: 'https://x/y.jpg' }), [], 'upstream-fetch rows');
	assert.match(itemRowProblems({ ...row, variants: {} }).join(), /glTF-Binary/);
	assert.match(itemRowProblems({ ...row, variants: { 'glTF-Binary': 'wall.gltf' } }).join(), /must be a .glb/);
	assert.match(itemRowProblems({ ...row, name: 'Wall Stone' }).join(), /folder-safe/);
	assert.match(itemRowProblems({ ...row, lod: [] }).join(), /unknown key "lod"/);
	const idx = { name: 'kit', title: 'Kit', value: 'kit/default.json', attribution: 'kit/a.html', copyright: '', license: 'CC0-1.0', source: 'https://github.com/x' };
	assert.deepEqual(indexRowProblems(idx), []);
	assert.match(indexRowProblems({ ...idx, zip: 'kit/k.zip' }).join(), /exactly one of value \| zip/);
	assert.match(indexRowProblems({ ...idx, license: undefined }).join(), /license must be a string/);
});

test('pivot rules: each preset accepts its shape and refuses an off-origin piece', () => {
	const wall = [[-1, 0, -0.125], [1, 3, 0.125]];
	assert.equal(pivotProblem(wall[0], wall[1], 'bottom-center'), null);
	assert.match(String(pivotProblem([0, 0, -0.125], [2, 3, 0.125], 'bottom-center')), /not bottom-centre/, 'origin at a corner');
	assert.match(String(pivotProblem([-1, -1.5, -0.125], [1, 1.5, 0.125], 'bottom-center')), /not bottom-centre/, 'origin in the middle of the height');
	assert.equal(pivotProblem([-0.55, 0.97, -0.25], [0.55, 2.23, 0.25], 'wall-pivot'), null, 'a window on the wall origin');
	assert.match(String(pivotProblem([-0.55, -0.5, -0.25], [0.55, 2.23, 0.25], 'wall-pivot')), /wall's bottom-centre/);
	assert.equal(pivotProblem([-0.67, 0, 0], [0.67, 1.66, 0.09], 'bottom-center-back'), null, 'a tapestry');
	assert.equal(pivotProblem([-0.46, -0.92, -0.44], [0.46, 0, 0.44], 'top-center'), null, 'a chandelier');
	assert.match(String(pivotProblem([-0.46, 0, -0.44], [0.46, 0.92, 0.44], 'top-center')), /top-centre/);
	assert.equal(pivotProblem([-1, 0, 0.125], [1, 0.25, 0.15], 'wall-face'), null, 'a skirting on the wall face');
	assert.match(String(pivotProblem([-1, 0, 1.2], [1, 0.25, 1.3], 'wall-face')), /wall line/);
	assert.equal(pivotProblem([-0.75, 0, -0.45], [0.86, 2.46, 0.79], 'foot'), null, 'a signpost on its post');
	assert.match(String(pivotProblem([0.2, 0, 0.2], [1, 2, 1], 'foot')), /not under the piece/);
	assert.equal(pivotProblem([-0.07, -0.03, -0.04], [0.07, 0.51, 0.04], 'hinge'), null);
	assert.match(String(pivotProblem([1, 1, 1], [2, 2, 2], 'hinge')), /outside the piece/);
	assert.equal(pivotProblem([-0.1, -0.08, -0.21], [0.1, 0.08, 0.21], 'center'), null, 'a fish about its middle');
	assert.match(String(pivotProblem([-0.1, 0, -0.21], [0.1, 0.16, 0.21], 'center')), /not the bbox centre/, 'a fish standing on its belly');
	assert.equal(pivotProblem([5, 5, 5], [6, 6, 6], 'any'), null);
	assert.match(String(pivotProblem(wall[0], wall[1], 'middle')), /unknown pivot rule/);
});

test('scale: metres, not centimetres or kilometres', () => {
	assert.equal(scaleProblem([2, 3, 0.25], 10, 0.05), null);
	assert.match(String(scaleProblem([200, 300, 25], 10, 0.05)), /exported in cm/);
	assert.match(String(scaleProblem([0.002, 0.003, 0.0002], 10, 0.05)), /in km, or empty/);
	assert.match(String(scaleProblem([NaN, 1, 1], 10, 0.05)), /not finite/);
});
