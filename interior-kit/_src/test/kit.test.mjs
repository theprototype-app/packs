// interior-kit: the shipped GLBs keep the kit's contract — run after build.mjs.
//   node --test interior-kit/_src/test/
// Per item: flat for sync, in budget, textured, a collider hint, its pivot (bottom-centre /
// wall-line / top-centre) exact, a thumb. Assemblies: NO same-facing coplanar overlap
// (the flicker the user sees "only while moving") — inside a piece, along a straight run,
// at an inner corner, and against the architecture kit's real walls, doorway, Door and floor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEMS, pivotOf } from '../items.mjs';
import { trianglesOf, overlaps, probeScene } from '../zfight.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.resolve(HERE, '../..');
const ARCH = path.resolve(PACK, '../architecture-kit');
const TOOLS = process.env.MESHY_TOOLS ?? path.resolve(PACK, '../tools/meshy');
const { NodeIO } = await import(`${TOOLS}/node_modules/@gltf-transform/core/dist/index.js`);
const { ALL_EXTENSIONS } = await import(`${TOOLS}/node_modules/@gltf-transform/extensions/dist/index.js`);
const { getBounds } = await import(`${TOOLS}/node_modules/@gltf-transform/functions/dist/index.js`);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const fileOf = (name) => `${name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}.glb`;
const glb = (name) => path.join(PACK, name, 'glTF-Binary', fileOf(name));
const arch = (name) => path.join(ARCH, name, 'glTF-Binary', fileOf(name));
/** pairs between two architecture-kit pieces are that kit's own business (reported to 33-pack-fix-lod) */
const mine = (ta, tb) => !(ta.includes(':arch:') && tb.includes(':arch:'));
const LIST = JSON.parse(fs.readFileSync(path.join(PACK, 'default.json'), 'utf8'));
const WALL_FACE = 0.125;
const MM = 0.0015;

test('default.json lists every item with a thumb and a GLB', () => {
	assert.equal(LIST.length, ITEMS.length);
	assert.ok(ITEMS.length >= 22 && ITEMS.length <= 30, `22-30 items, got ${ITEMS.length}`);
	for (const it of LIST) {
		assert.ok(fs.existsSync(path.join(PACK, it.name, it.screenshot)), `${it.name}: thumb`);
		assert.ok(fs.existsSync(path.join(PACK, it.name, 'glTF-Binary', it.variants['glTF-Binary'])), `${it.name}: glb`);
	}
});

for (const item of ITEMS) {
	test(`${item.name}: flat, in budget, textured, collider hint, pivot`, async () => {
		const file = glb(item.name);
		const doc = await io.read(file);
		const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
		// flat for sync: every mesh node a direct scene child with one primitive
		for (const n of doc.getRoot().listNodes()) assert.ok(scene.listChildren().includes(n), `${item.name}: nested node ${n.getName()}`);
		for (const m of doc.getRoot().listMeshes()) assert.equal(m.listPrimitives().length, 1, `${item.name}: multi-primitive mesh`);
		let tris = 0;
		for (const n of doc.getRoot().listNodes()) for (const p of n.getMesh()?.listPrimitives() ?? []) tris += p.getIndices().getCount() / 3;
		assert.ok(tris <= 8000, `${item.name}: ${tris} tris > 8000 (props budget)`);
		assert.ok(fs.statSync(file).size <= 2 * 1024 * 1024, `${item.name}: GLB over the 2 MB target`);
		// draw calls: one per mesh node — keep a piece to a handful
		assert.ok(scene.listChildren().length <= 4, `${item.name}: ${scene.listChildren().length} meshes (draw calls)`);
		for (const t of doc.getRoot().listTextures()) assert.ok(Math.max(...t.getSize()) <= 1024, `${item.name}: texture over 1024²`);
		assert.ok(['box', 'cylinder', 'hull', 'sphere', 'capsule', 'cone'].includes(scene.getExtras().colliderHint), `${item.name}: colliderHint`);
		const b = getBounds(scene);
		const pivot = pivotOf(item);
		if (pivot === 'top-centre') {
			assert.ok(Math.abs(b.max[1]) < MM, `${item.name}: top at y = 0 (${b.max[1]})`);
		} else if (item.name === 'Cornice') {
			// the wall's own pivot (its foot): the cornice's top is the storey line y = 3
			assert.ok(Math.abs(b.max[1] - 3) < MM, `${item.name}: top at y = 3 (${b.max[1]})`);
		} else {
			assert.ok(Math.abs(b.min[1]) < MM, `${item.name}: bottom at y = 0 (${b.min[1]})`);
		}
		assert.ok(Math.abs(b.min[0] + b.max[0]) < 0.01, `${item.name}: centred in x`);
		if (pivot === 'bottom-centre' || pivot === 'top-centre') assert.ok(Math.abs(b.min[2] + b.max[2]) < 0.01, `${item.name}: centred in z (${b.min[2]}, ${b.max[2]})`);
		if (pivot === 'wall-line') {
			// the back sits on the wall face (z = 0.125) — trims embed 2 cm into the relief
			assert.ok(b.min[2] >= 0.1 - MM && b.min[2] <= WALL_FACE + MM, `${item.name}: back at the wall face (min z ${b.min[2]})`);
		}
	});
}

const PROCEDURAL = ITEMS.filter((i) => i.src.proc).map((i) => i.name);
test('no procedural piece fights itself (same-facing coplanar overlap)', async () => {
	for (const name of PROCEDURAL) {
		const r = overlaps(await trianglesOf(glb(name)));
		assert.equal(r.pairs, 0, `${name}: ${r.pairs} coplanar pairs ${JSON.stringify(r.worst[0])}`);
	}
});

/** an inner corner: a piece on the wall along x (z = 0 line) and its twin on the wall along z (x = 0 line) */
const corner = (name) => [
	{ file: glb(name), t: [1, 0, 0], yaw: 0 },
	{ file: glb(name), t: [0, 0, 1], yaw: 90 }
];
const run = (a, b = a) => [
	{ file: glb(a), t: [1, 0, 0], yaw: 0 },
	{ file: glb(b), t: [3, 0, 0], yaw: 0 }
];

const ASSEMBLIES = {
	'Skirting: straight run': run('Skirting'),
	'Skirting: inner corner': corner('Skirting'),
	'Skirting + doorway skirting: run': run('Skirting', 'SkirtingDoorway'),
	'Wainscot: straight run': run('Wainscot'),
	'Wainscot: inner corner': corner('Wainscot'),
	'Wainscot + doorway wainscot: run': run('Wainscot', 'WainscotDoorway'),
	'Cornice: straight run': run('Cornice'),
	'Cornice: inner corner': corner('Cornice'),
	'Skirting on a sandstone wall': [{ file: arch('WallStone'), t: [1, 0, 0] }, { file: glb('Skirting'), t: [1, 0, 0] }],
	'Wainscot + Skirting + Cornice on a plaster wall, floor and ceiling tiles': [
		{ file: arch('WallPlaster'), t: [1, 0, 0] },
		{ file: glb('Wainscot'), t: [1, 0, 0] },
		{ file: glb('Cornice'), t: [1, 0, 0] },
		{ file: glb('Skirting'), t: [1, 0, 0], yaw: 180 },
		{ file: arch('FloorWood'), t: [1, 0, 1] },
		{ file: arch('FloorWood'), t: [1, 3, 1] }
	],
	'Wainscot under a window': [{ file: arch('WallPlasterWindow'), t: [1, 0, 0] }, { file: arch('Window'), t: [1, 0, 0] }, { file: glb('Wainscot'), t: [1, 0, 0] }],
	'Doorway: wall + Door + doorway skirting + doorway wainscot (other face)': [
		{ file: arch('WallStoneDoor'), t: [1, 0, 0] },
		{ file: arch('Door'), t: [1, 0, 0] },
		{ file: glb('SkirtingDoorway'), t: [1, 0, 0] },
		{ file: glb('WainscotDoorway'), t: [1, 0, 0], yaw: 180 }
	],
	'Wall pieces on a wall: sconce, picture, shelf': [
		{ file: arch('WallPlaster'), t: [1, 0, 0] },
		{ file: glb('WallSconce'), t: [0.3, 1.6, 0] },
		{ file: glb('Picture'), t: [1.2, 1.3, 0] },
		{ file: glb('WallShelfBooks'), t: [1, 1.1, 0], yaw: 180 }
	],
	'Rug on a floor tile, chandelier under a ceiling tile': [
		{ file: arch('FloorStone'), t: [1, 0, 1] },
		{ file: glb('RugRound'), t: [1, 0.1, 1] },
		{ file: arch('FloorStone'), t: [1, 3, 1] },
		{ file: glb('Chandelier'), t: [1, 3, 1] }
	]
};

for (const [label, list] of Object.entries(ASSEMBLIES)) {
	test(`no flicker across the seam — ${label}`, async () => {
		const r = await probeScene(list.map((it, i) => ({ ...it, tag: `${i}:${it.file.startsWith(ARCH) ? 'arch:' : ''}${path.basename(it.file)}` })), { keep: mine });
		assert.equal(r.pairs, 0, `${r.pairs} coplanar pairs across pieces: ${JSON.stringify(r.worst.slice(0, 2))}`);
	});
}
