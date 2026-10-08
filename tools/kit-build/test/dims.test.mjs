// kit-build dims (core 39 P4): the size/box/tris/bytes a row carries, each rule shown red on the
// input it exists to catch, and the CI's staleness check against a measured file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dimsOf, withDims, dimsProblem, stringifyRows } from '../lib/dims.mjs';
import { dimsShapeProblems, itemRowProblems } from '../lib/rules.mjs';

const info = { bytes: 603416, tris: 320, min: [-1, 0, -1], max: [1, 0.2, 1], animations: [] };

test('dimsOf: size is the box extents, animated only when the file has clips', () => {
	assert.deepEqual(dimsOf(info), { size: [2, 0.2, 2], box: [-1, 0, -1, 1, 0.2, 1], tris: 320, bytes: 603416 });
	assert.equal(dimsOf({ ...info, animations: ['open'] }).animated, true);
	assert.equal('animated' in dimsOf(info), false, 'a static item writes no animated key');
});

test('withDims: replaces old dims, keeps every other key in order, dims last', () => {
	const row = { name: 'Road', size: 123, label: 'Road', variants: { 'glTF-Binary': 'road.glb' }, tris: 1 };
	const out = withDims(row, dimsOf(info));
	assert.deepEqual(Object.keys(out), ['name', 'label', 'variants', 'size', 'box', 'tris', 'bytes']);
	assert.deepEqual(out.size, [2, 0.2, 2], 'an old numeric size (bytes) is replaced by the dims array');
});

test('dimsProblem: current passes; missing, moved, decimated, resized and re-rigged files fail', () => {
	const row = withDims({ name: 'Road' }, dimsOf(info));
	assert.equal(dimsProblem(row, info), null);
	assert.match(String(dimsProblem({ name: 'Road' }, info)), /no dims/);
	assert.match(String(dimsProblem(row, { ...info, max: [1, 0.3, 1] })), /stale: box/);
	assert.match(String(dimsProblem(row, { ...info, tris: 300 })), /stale: tris/, 'a pass --write decimation changes tris');
	assert.match(String(dimsProblem(row, { ...info, bytes: 1 })), /stale: bytes/);
	assert.match(String(dimsProblem(row, { ...info, animations: ['x'] })), /stale: animated/);
	assert.equal(dimsProblem(row, { ...info, max: [1.0004, 0.2, 1] }), null, 'a float round trip is not stale');
});

test('dims shape: core reads these before any download, so malformed ones are refused', () => {
	const ok = { name: 'A', variants: { 'glTF-Binary': 'a.glb' }, ...dimsOf(info) };
	assert.deepEqual(itemRowProblems(ok), []);
	assert.match(dimsShapeProblems({ size: [1, 2] }).join(), /size must be/);
	assert.match(dimsShapeProblems({ size: [1, -2, 3] }).join(), /size must be/);
	assert.match(dimsShapeProblems({ box: [1, 0, 0, 0, 1, 1] }).join(), /box must be/, 'max below min');
	assert.match(dimsShapeProblems({ tris: 1.5 }).join(), /tris must be/);
	assert.match(dimsShapeProblems({ bytes: 0 }).join(), /bytes must be/);
	assert.match(dimsShapeProblems({ animated: false }).join(), /animated is true or absent/);
});

test('stringifyRows: number arrays stay on one line, nothing else changes', () => {
	const text = stringifyRows([{ name: 'A', box: [-1, 0, -1.5, 1, 2e-3, 1.5], lods: [{ file: 'a.glb', ratio: 0.5 }] }], '  ');
	assert.match(text, /"box": \[-1, 0, -1\.5, 1, 0\.002, 1\.5\]/);
	assert.match(text, /"lods": \[\n {6}\{/, 'an array of objects keeps its layout');
	assert.deepEqual(JSON.parse(text), [{ name: 'A', box: [-1, 0, -1.5, 1, 0.002, 1.5], lods: [{ file: 'a.glb', ratio: 0.5 }] }]);
});
