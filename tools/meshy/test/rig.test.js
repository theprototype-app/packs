// The rig / animate stages and the rigged merge — no network, no credits. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { readLedger, spentByRequester } from '../lib/ledger.js';
import { runJob, buildPayload, validateJob, resultUrls } from '../lib/gen.js';
import { priceOf } from '../lib/prices.js';
import { postRigged } from '../lib/rigged.js';

function home(caps = { lane: 100 }) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshy-rig-'));
	fs.writeFileSync(path.join(dir, 'budget.json'), JSON.stringify({ totalCredits: 1500, caps }));
	return dir;
}
const spent = (dir) => spentByRequester(readLedger(path.join(dir, 'ledger.jsonl'))).lane ?? 0;
const quiet = () => {};

/** a fake Meshy that knows every endpoint the pipeline creates on */
function fakeApi() {
	const tasks = new Map();
	let n = 0;
	const calls = { create: [], downloads: [] };
	return {
		calls,
		async create(p, payload) {
			const id = `task-${++n}`;
			calls.create.push({ path: p, payload });
			tasks.set(id, { id, path: p, payload, created_at: Date.now(), prompt: payload.prompt, type: payload.mode ? `text-to-3d-${payload.mode}` : '' });
			return id;
		},
		async get(p) {
			if (p.includes('?')) return [...tasks.values()];
			const t = tasks.get(p.split('/').pop());
			const stage = t.path.includes('rigging') ? 'rig' : t.path.includes('animations') ? 'animate' : t.payload.mode;
			const consumed = priceOf({ stage, model: 't2', actions: t.payload.action_ids?.length ?? 1 });
			if (stage === 'rig')
				return { id: t.id, status: 'SUCCEEDED', consumed_credits: consumed, result: { rigged_character_glb_url: 'u:rig', basic_animations: { walking_glb_url: 'u:walk', running_glb_url: 'u:run' } } };
			if (stage === 'animate') return { id: t.id, status: 'SUCCEEDED', consumed_credits: consumed, result: { animation_glb_url: 'u:anim' } };
			return { id: t.id, status: 'SUCCEEDED', consumed_credits: consumed, model_urls: { glb: 'u:model' } };
		},
		async download(url) {
			calls.downloads.push(url);
			return Buffer.from(url);
		}
	};
}

test('prices: rig 5, animate 3 per action (1..10)', () => {
	assert.equal(priceOf({ stage: 'rig' }), 5);
	assert.equal(priceOf({ stage: 'animate' }), 3);
	assert.equal(priceOf({ stage: 'animate', actions: 2 }), 6);
	assert.equal(priceOf({ stage: 'animate', actions: 40 }), 30);
});

test('validate + payload: rig takes a height, animate 1-10 integer actions', () => {
	assert.deepEqual(validateJob({ id: 'g', stage: 'rig', heightMeters: 1.2 }), []);
	assert.match(validateJob({ id: 'g', stage: 'rig', heightMeters: 40 }).join(), /heightMeters/);
	assert.match(validateJob({ id: 'g', stage: 'animate' }).join(), /actionIds/);
	assert.match(validateJob({ id: 'g', stage: 'animate', actionIds: [1.5] }).join(), /actionIds/);
	assert.deepEqual(buildPayload({ id: 'g', stage: 'rig', heightMeters: 1.2 }, { sourceTaskId: 'r1' }), { input_task_id: 'r1', height_meters: 1.2 });
	assert.deepEqual(buildPayload({ id: 'g', stage: 'animate', actionId: 8 }, { sourceTaskId: 'rig1' }), { rig_task_id: 'rig1', action_id: 8 });
	assert.deepEqual(buildPayload({ id: 'g', stage: 'animate', actionIds: [178, 8], fps: 30 }, { sourceTaskId: 'rig1' }), {
		rig_task_id: 'rig1',
		action_ids: [178, 8],
		post_process: { operation_type: 'change_fps', fps: 30 }
	});
});

test('resultUrls: text-to-3d, rig (+ walking/running), animate', () => {
	assert.deepEqual(resultUrls('refine', { model_urls: { glb: 'a' } }), { raw: 'a', extra: {} });
	assert.deepEqual(resultUrls('rig', { result: { rigged_character_glb_url: 'r', basic_animations: { walking_glb_url: 'w', running_glb_url: 'x' } } }), {
		raw: 'r',
		extra: { 'walking.glb': 'w', 'running.glb': 'x' }
	});
	assert.deepEqual(resultUrls('animate', { result: { animation_glb_url: 'm' } }), { raw: 'm', extra: {} });
});

test('preview → refine → rig → animate: each takes the right source, spends its price once, saves its files', async () => {
	const dir = home();
	const api = fakeApi();
	const o = { requester: 'lane', home: dir, api, log: quiet, pollMs: 1 };
	const base = { id: 'grunt', prompt: 'a robot', model: 't2' };
	assert.equal((await runJob({ ...o, job: { ...base, stage: 'preview' } })).status, 'SUCCEEDED');
	// rig before a refine: refused, nothing spent (a rig needs the textured mesh)
	const early = await runJob({ ...o, job: { id: 'grunt', stage: 'rig' } });
	assert.equal(early.status, 'invalid');
	assert.equal(spent(dir), 5);
	assert.equal((await runJob({ ...o, job: { ...base, stage: 'refine' } })).status, 'SUCCEEDED');
	const rig = await runJob({ ...o, job: { id: 'grunt', stage: 'rig', heightMeters: 1.1 } });
	assert.equal(rig.status, 'SUCCEEDED');
	const refineTask = api.calls.create[1];
	assert.equal(api.calls.create[2].path, '/openapi/v1/rigging');
	assert.equal(api.calls.create[2].payload.input_task_id, 'task-2', 'the rig takes the REFINE, not the preview');
	assert.ok(refineTask);
	for (const f of ['raw.glb', 'walking.glb', 'running.glb']) assert.ok(fs.existsSync(path.join(rig.dir, f)), f);
	const anim = await runJob({ ...o, job: { id: 'grunt-anims', from: 'grunt', stage: 'animate', actionIds: [178, 8] } });
	assert.equal(anim.status, 'SUCCEEDED');
	assert.equal(api.calls.create[3].path, '/openapi/v1/animations');
	assert.equal(api.calls.create[3].payload.rig_task_id, 'task-3');
	assert.equal(spent(dir), 5 + 10 + 5 + 6);
	// re-runs never re-POST
	await runJob({ ...o, job: { id: 'grunt', stage: 'rig', heightMeters: 1.1 } });
	await runJob({ ...o, job: { id: 'grunt-anims', from: 'grunt', stage: 'animate', actionIds: [178, 8] } });
	assert.equal(api.calls.create.length, 4);
	assert.equal(spent(dir), 26);
});

test('an animate job over the cap is refused before any POST', async () => {
	const dir = home({ lane: 20 });
	const api = fakeApi();
	const o = { requester: 'lane', home: dir, api, log: quiet, pollMs: 1 };
	await runJob({ ...o, job: { id: 'g', prompt: 'x', stage: 'preview' } });
	await runJob({ ...o, job: { id: 'g', stage: 'refine' } });
	await runJob({ ...o, job: { id: 'g', stage: 'rig' } });
	const r = await runJob({ ...o, job: { id: 'g-a', from: 'g', stage: 'animate', actionIds: [1, 2] } });
	assert.equal(r.status, 'refused');
	assert.equal(api.calls.create.length, 3);
	assert.equal(spent(dir), 20);
});

/** a tiny skinned GLB: two joints, one quad skinned to them; `anim` adds a rotation clip */
async function skinned(file, { anim = null, extraJoint = false } = {}) {
	const doc = new Document();
	const buf = doc.createBuffer();
	const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', acc('VEC3', new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0])))
		.setAttribute('JOINTS_0', acc('VEC4', new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0])))
		.setAttribute('WEIGHTS_0', acc('VEC4', new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])))
		.setIndices(acc('SCALAR', new Uint16Array([0, 1, 2, 2, 1, 3, 4, 1, 2])));
	const mesh = doc.createMesh('body').addPrimitive(prim);
	const hips = doc.createNode('Hips');
	const spine = doc.createNode('Spine').setTranslation([0, 0.5, 0]);
	hips.addChild(spine);
	const joints = [hips, spine];
	if (extraJoint) joints.push(doc.createNode('Tail'));
	const skin = doc.createSkin().addJoint(hips).addJoint(spine).setInverseBindMatrices(acc('MAT4', new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -0.5, 0, 1])));
	const body = doc.createNode('Body').setMesh(mesh).setSkin(skin);
	const armature = doc.createNode('Armature').addChild(hips);
	doc.createScene().addChild(armature).addChild(body);
	if (anim) {
		const s = doc.createAnimationSampler().setInput(acc('SCALAR', new Float32Array([0, anim]))).setOutput(acc('VEC4', new Float32Array([0, 0, 0, 1, 0, 0.7071, 0, 0.7071]))).setInterpolation('LINEAR');
		const a = doc.createAnimation('Armature|clip|baselayer').addSampler(s);
		a.addChannel(doc.createAnimationChannel().setTargetNode(spine).setTargetPath('rotation').setSampler(s));
		if (extraJoint) {
			const s2 = doc.createAnimationSampler().setInput(acc('SCALAR', new Float32Array([0, anim]))).setOutput(acc('VEC3', new Float32Array([0, 0, 0, 0, 1, 0]))).setInterpolation('LINEAR');
			a.addSampler(s2).addChannel(doc.createAnimationChannel().setTargetNode(joints[2]).setTargetPath('translation').setSampler(s2));
		}
	}
	await new NodeIO().write(file, doc);
}

test('postRigged: clips land on the base skeleton BY NAME, named, a stray joint dropped; the skin survives', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshy-rigged-'));
	const f = (n) => path.join(dir, n);
	await skinned(f('rig.glb'));
	await skinned(f('walk.glb'), { anim: 1.2 });
	await skinned(f('extra.glb'), { anim: 0.8, extraJoint: true });
	const r = await postRigged({ base: f('rig.glb'), out: f('out.glb'), clips: [{ file: f('walk.glb'), name: 'walk' }, { file: f('extra.glb'), name: ['death'] }] });
	assert.deepEqual(r.animations.map((a) => a.name), ['walk', 'death']);
	assert.equal(r.animations[0].seconds, 1.2);
	assert.equal(r.clips[1].dropped, 1, 'the Tail channel has no namesake in the base');
	assert.equal(r.joints, 2);
	const out = await new NodeIO().read(f('out.glb'));
	const spine = out.getRoot().listNodes().find((n) => n.getName() === 'Spine');
	assert.equal(out.getRoot().listAnimations()[0].listChannels()[0].getTargetNode(), spine);
	assert.ok(out.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('JOINTS_0'), 'skin weights ride along');
	await assert.rejects(postRigged({ base: f('rig.glb'), out: f('x.glb'), clips: [{ file: f('rig.glb'), name: 'walk' }] }), /no animation/);
});

test('postRigged pbrFrom: the refine\'s normal + metal-rough maps land on the rig of the same atlas; another atlas is refused', async () => {
	const sharp = (await import('sharp')).default;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshy-pbr-'));
	const f = (n) => path.join(dir, n);
	// a gradient, not a solid colour: prune() folds a solid-colour texture into a factor
	const png = (r, g, b) => {
		const px = Buffer.alloc(16 * 16 * 3);
		for (let i = 0; i < 256; i++) px.set([(r + i) % 256, (g + i * 3) % 256, b], i * 3);
		return sharp(px, { raw: { width: 16, height: 16, channels: 3 } }).png().toBuffer();
	};
	const io = new NodeIO();
	const textured = async (file, base, extra) => {
		await skinned(file);
		const doc = await io.read(file);
		const mat = doc.createMaterial('m').setBaseColorTexture(doc.createTexture('bc').setImage(base).setMimeType('image/png'));
		if (extra) mat.setNormalTexture(doc.createTexture('n').setImage(extra).setMimeType('image/png')).setMetallicRoughnessTexture(doc.createTexture('mr').setImage(extra).setMimeType('image/png')).setRoughnessFactor(0.8);
		doc.getRoot().listMeshes()[0].listPrimitives()[0].setMaterial(mat);
		await io.write(file, doc);
	};
	const orange = await png(230, 120, 30);
	await textured(f('rig.glb'), orange, null);
	await textured(f('refine.glb'), orange, await png(128, 128, 255));
	await textured(f('other.glb'), await png(20, 200, 240), await png(128, 128, 255));
	const r = await postRigged({ base: f('rig.glb'), out: f('out.glb'), pbrFrom: f('refine.glb') });
	assert.deepEqual(r.pbr, ['normal', 'metallicRoughness']);
	const m = (await io.read(f('out.glb'))).getRoot().listMaterials()[0];
	assert.ok(m.getNormalTexture() && m.getMetallicRoughnessTexture());
	assert.equal(m.getRoughnessFactor(), 0.8);
	await assert.rejects(postRigged({ base: f('rig.glb'), out: f('x.glb'), pbrFrom: f('other.glb') }), /base colours differ/);
});
