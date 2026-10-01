// tools/lod — the flicker probe, defight and the LOD step, on synthetic GLBs and on every
// shipped pack. No credits, no browser (the judge is exercised by the build, not here).
//   node --test tools/lod/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { coplanarOverlaps, triangles, probeFile } from '../coplanar.mjs';
import { defightDoc, defightFile } from '../defight.mjs';
import { buildLevels, check, trisOf, skeletonOf, LEVELS } from '../lod.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const req = createRequire(path.join(ROOT, 'tools/meshy/package.json'));
const load = async (id) => import(pathToFileURL(req.resolve(id)).href);
const { Document, NodeIO } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS } = await load('@gltf-transform/extensions');
const { getBounds } = await load('@gltf-transform/functions');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-test-'));

/** a doc with one mesh per entry of `quads`: [{y, flip, size, offset}] — square quads in XZ */
function quadDoc(quads, { doubleSided = false } = {}) {
	const doc = new Document();
	const buf = doc.createBuffer();
	const mat = doc.createMaterial('m').setDoubleSided(doubleSided);
	const scene = doc.createScene();
	const mesh = doc.createMesh('quads');
	const pos = [];
	const uv = [];
	const idx = [];
	for (const q of quads) {
		const s = q.size ?? 1;
		const o = q.offset ?? 0;
		const b = pos.length / 3;
		pos.push(o, q.y, o, o + s, q.y, o, o + s, q.y, o + s, o, q.y, o + s);
		uv.push(0, 0, 1, 0, 1, 1, 0, 1);
		// +Y facing (CCW seen from above) unless flipped
		idx.push(...(q.flip ? [b, b + 1, b + 2, b, b + 2, b + 3] : [b, b + 2, b + 1, b, b + 3, b + 2]));
	}
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
		.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buf))
		.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buf))
		.setMaterial(mat);
	mesh.addPrimitive(prim);
	scene.addChild(doc.createNode('quads').setMesh(mesh));
	return doc;
}

test('the probe sees two coplanar quads fight, and not when 5 mm apart', () => {
	assert.ok(coplanarOverlaps(triangles(quadDoc([{ y: 0 }, { y: 0, size: 0.6, offset: 0.2 }]))).pairs > 0);
	assert.equal(coplanarOverlaps(triangles(quadDoc([{ y: 0 }, { y: 0.005, size: 0.6, offset: 0.2 }]))).pairs, 0);
});

test('opposite faces fight only when the material draws both sides', () => {
	const quads = [{ y: 0 }, { y: 0, flip: true, size: 0.6, offset: 0.2 }];
	assert.equal(coplanarOverlaps(triangles(quadDoc(quads))).pairs, 0);
	assert.ok(coplanarOverlaps(triangles(quadDoc(quads, { doubleSided: true }))).pairs > 0);
});

test('a hemisphere test on x alone would split (2e-9, -1, 0) from (0, 1, 0): the dominant-axis rule does not', () => {
	// the Chimney's cap: a down-facing plate with a hair of +x in its normal, under an
	// up-facing one, double-sided — it must be ONE plane for both tools
	const doc = quadDoc([{ y: 0 }, { y: 0, flip: true, size: 0.6, offset: 0.2 }], { doubleSided: true });
	const t = triangles(doc);
	for (const x of t) if (x.n[1] < 0) x.n = [2e-9, x.n[1], x.n[2]];
	assert.ok(coplanarOverlaps(t).pairs > 0);
});

test('defight: a fully hidden duplicate is dropped, a partial overlap pushed INSIDE, the bbox kept', async () => {
	// a closed box would be better, but a slab shows the rule: the big quad is the surface,
	// the small one under it is hidden (dropped); one sticking out past it is pushed down
	const doc = quadDoc([{ y: 1 }, { y: 1, size: 0.5, offset: 0.25 }, { y: 1, size: 0.6, offset: 0.7 }, { y: 0, flip: true, size: 1.3 }]);
	const b0 = getBounds(doc.getRoot().listScenes()[0]);
	const before = coplanarOverlaps(triangles(doc)).pairs;
	const r = await defightDoc(doc);
	const after = coplanarOverlaps(triangles(doc)).pairs;
	const b1 = getBounds(doc.getRoot().listScenes()[0]);
	assert.ok(before > 0);
	assert.equal(after, 0, 'no coplanar overlap left');
	assert.ok(r.dropped >= 2, `the hidden quad's two triangles dropped (${r.dropped})`);
	assert.ok(r.pushed >= 1, `the partial one pushed (${r.pushed})`);
	assert.deepEqual(b1.min.map((v) => +v.toFixed(6)), b0.min.map((v) => +v.toFixed(6)));
	assert.deepEqual(b1.max.map((v) => +v.toFixed(6)), b0.max.map((v) => +v.toFixed(6)));
	// pushed DOWN (toward the slab's middle), never up past the surface
	let maxY = -Infinity;
	for (const t of triangles(doc)) for (const p of [t.a, t.b, t.c]) maxY = Math.max(maxY, p[1]);
	assert.ok(Math.abs(maxY - 1) < 1e-6);
});

test('defight: two primitives SHARING normals/UVs (a piece copied twice) are fixed independently', async () => {
	// 33-anim-kit's IronGate: two kit Pillars with their OWN positions but ONE shared
	// NORMAL / TEXCOORD_0 / index accessor. The copies drop different triangles, so the
	// shared data was compacted twice — the other copy's normals/UVs no longer matched its
	// vertices (glossy triangular patches; judge mean 72.8 vs 0.8 with the fix)
	const doc = quadDoc([{ y: 0, size: 0.4, offset: 0.3 }, { y: 0 }]);
	const prim0 = doc.getRoot().listMeshes()[0].listPrimitives()[0];
	const pos0 = prim0.getAttribute('POSITION');
	// copy B: the small quad lifted 1 cm, so B has nothing to drop while A drops it
	const lifted = pos0.clone();
	for (let i = 0; i < 4; i++) {
		const v = lifted.getElement(i, [0, 0, 0]);
		lifted.setElement(i, [v[0], v[1] + 0.01, v[2]]);
	}
	const b = prim0.clone().setAttribute('POSITION', lifted); // NORMAL-less fixture: UV + indices shared
	const copy = doc.createMesh('copy').addPrimitive(b);
	doc.getRoot().listScenes()[0].addChild(doc.createNode('copy').setMesh(copy).setTranslation([5, 0, 0]));
	assert.equal(b.getAttribute('TEXCOORD_0'), prim0.getAttribute('TEXCOORD_0'));
	await defightDoc(doc);
	assert.equal(coplanarOverlaps(triangles(doc)).pairs, 0);
	for (const mesh of doc.getRoot().listMeshes()) {
		const prim = mesh.listPrimitives()[0];
		const pos = prim.getAttribute('POSITION');
		const uv = prim.getAttribute('TEXCOORD_0');
		assert.equal(uv.getCount(), pos.getCount(), `${mesh.getName()}: one UV per vertex`);
		// every vertex keeps ITS UV: in this fixture UV = (x - offset, z - offset) / size
		const p = [0, 0, 0];
		const t = [0, 0];
		for (let i = 0; i < pos.getCount(); i++) {
			pos.getElement(i, p);
			uv.getElement(i, t);
			const big = p[1] === 0;
			const want = big ? [p[0], p[2]] : [(p[0] - 0.3) / 0.4, (p[2] - 0.3) / 0.4];
			assert.ok(Math.abs(t[0] - want[0]) < 1e-5 && Math.abs(t[1] - want[1]) < 1e-5, `${mesh.getName()}: vertex ${p} kept its UV (${t} ≠ ${want})`);
		}
	}
});

/** every LOD0 GLB the packs ship */
function shipped() {
	const out = [];
	for (const pack of ['architecture-kit', 'nature-kit', 'props-kit', 'scifi-kit', 'default', 'cube_diorama']) {
		for (const row of JSON.parse(fs.readFileSync(path.join(ROOT, pack, 'default.json'), 'utf8'))) {
			const f = row?.variants?.['glTF-Binary'];
			if (f && !/^https?:/.test(f)) out.push({ pack, name: row.name, row, file: path.join(ROOT, pack, row.name, 'glTF-Binary', f) });
		}
	}
	return out;
}

test('SHIPPED: no pack GLB carries a cm² of coplanar overlap (the Block had 8.5 m²)', async () => {
	const bad = [];
	for (const it of shipped()) {
		const r = await probeFile(it.file);
		if (r.area >= 1e-4) bad.push(`${it.pack}/${it.name} ${r.area.toFixed(4)} m²`);
	}
	assert.deepEqual(bad, []);
});

test('defightFile leaves a file under 1 cm² of overlap byte-identical', async () => {
	const f = path.join(tmp, 'tiny.glb');
	await io.write(f, quadDoc([{ y: 0 }, { y: 0, size: 0.005, offset: 0.2 }]));
	const before = fs.readFileSync(f);
	const r = await defightFile(f, f);
	assert.equal(r.left, 'under 1 cm² of overlap');
	assert.ok(before.equals(fs.readFileSync(f)));
});

/** a 2-node "door": Frame (static grid) + Leaf (grid, hinged child) + an "open" clip on Leaf */
function doorDoc() {
	const doc = new Document();
	const buf = doc.createBuffer();
	const mat = doc.createMaterial('wood');
	const grid = (name, n, w, h) => {
		const pos = [];
		const nrm = [];
		const uv = [];
		const idx = [];
		for (let j = 0; j <= n; j++)
			for (let i = 0; i <= n; i++) {
				// a gently bumped sheet: simplifiable, but not flat
				pos.push((i / n) * w, (j / n) * h, 0.002 * Math.sin(i * 0.7) * Math.cos(j * 0.9));
				nrm.push(0, 0, 1);
				uv.push(i / n, j / n);
			}
		for (let j = 0; j < n; j++)
			for (let i = 0; i < n; i++) {
				const a = j * (n + 1) + i;
				idx.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
			}
		return doc
			.createMesh(name)
			.addPrimitive(
				doc
					.createPrimitive()
					.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
					.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nrm)).setBuffer(buf))
					.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buf))
					.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buf))
					.setMaterial(mat)
			);
	};
	const frame = doc.createNode('Frame').setMesh(grid('FrameMesh', 30, 1.2, 2.2));
	const leaf = doc.createNode('Leaf').setMesh(grid('LeafMesh', 30, 1, 2)).setTranslation([0.1, 0, 0.05]);
	frame.addChild(leaf);
	doc.createScene().addChild(frame);
	const times = doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 1])).setBuffer(buf);
	const rots = doc.createAccessor().setType('VEC4').setArray(new Float32Array([0, 0, 0, 1, 0, 0.7071, 0, 0.7071])).setBuffer(buf);
	const sampler = doc.createAnimationSampler().setInput(times).setOutput(rots).setInterpolation('LINEAR');
	doc.createAnimation('open').addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(leaf).setTargetPath('rotation').setSampler(sampler));
	return doc;
}

test('LOD: levels keep node names, hierarchy, transforms and the clip; triangles go down', async () => {
	const dir = path.join(tmp, 'Door/glTF-Binary');
	fs.mkdirSync(dir, { recursive: true });
	const lod0 = path.join(dir, 'door.glb');
	await io.write(lod0, doorDoc());
	const t0 = trisOf(await io.read(lod0));
	const r = await buildLevels(lod0); // no judge: geometry rules only
	assert.ok(r.levels.length >= 1, 'at least one level kept');
	const skel = JSON.stringify(skeletonOf(await io.read(lod0)));
	let prev = t0;
	for (const l of r.levels) {
		const d = await io.read(path.join(dir, l.file));
		assert.equal(JSON.stringify(skeletonOf(d)), skel, `${l.file}: same node tree + clip`);
		assert.equal(d.getRoot().listAnimations()[0].getName(), 'open');
		assert.ok(l.tris <= prev * 0.8, `${l.file}: ${l.tris} <= 80 % of ${prev}`);
		assert.equal(l.grow, 0, `${l.file}: never larger than LOD0`);
		prev = l.tris;
	}
	assert.match(r.levels[0].file, /^door\.lod1\.glb$/);
	assert.equal(LEVELS[0].ratio, 0.5);
});

test('SHIPPED: every pack row with lods points at real levels that keep LOD0’s node tree', async () => {
	const problems = await check(['architecture-kit', 'nature-kit', 'props-kit', 'scifi-kit', 'default', 'cube_diorama']);
	assert.deepEqual(problems, []);
	const withLods = shipped().filter((it) => it.row.lods);
	assert.ok(withLods.length >= 95, `${withLods.length} items carry lods`);
});
