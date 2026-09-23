// Ledger / cap / idempotency logic — no network, no credits. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readLedger, spentByRequester, keyState, jobKey, appendUnlocked } from '../lib/ledger.js';
import { checkCap, reserve } from '../lib/budget.js';
import { runJob, buildPayload, validateJob } from '../lib/gen.js';
import { priceOf } from '../lib/prices.js';
import * as api from '../lib/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function home(caps = { lane: 100 }, extra = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshy-test-'));
	fs.writeFileSync(path.join(dir, 'budget.json'), JSON.stringify({ totalCredits: 1500, caps, ...extra }));
	return dir;
}
const spent = (dir, who = 'lane') => spentByRequester(readLedger(path.join(dir, 'ledger.jsonl')))[who] ?? 0;
const GLB = Buffer.from('glTF-fake');

/** A fake Meshy: tasks succeed after one poll; hooks to inject failures. */
function fakeApi({ createImpl, status = 'SUCCEEDED', consumed } = {}) {
	const tasks = new Map();
	let n = 0;
	const calls = { create: 0, get: 0, list: 0 };
	return {
		calls,
		tasks,
		async create(p, payload) {
			calls.create++;
			if (createImpl) {
				const r = await createImpl(calls.create, payload, tasks);
				if (r) return r;
			}
			const id = `task-${++n}`;
			tasks.set(id, { id, payload, created_at: Date.now(), prompt: payload.prompt, type: `text-to-3d-${payload.mode ?? 'retexture'}` });
			return id;
		},
		async get(p) {
			if (p.includes('?')) {
				calls.list++;
				return [...tasks.values()].map((t) => ({ id: t.id, created_at: t.created_at, prompt: t.prompt, type: t.type }));
			}
			calls.get++;
			const id = p.split('/').pop();
			const t = tasks.get(id);
			if (!t) throw Object.assign(new Error('404'), { definite: true });
			const price = priceOf({ stage: t.payload.mode ?? 'retexture', model: t.payload.ai_model === 'meshy-t2' ? 't2' : t.payload.ai_model });
			return {
				id,
				status,
				progress: 100,
				consumed_credits: consumed ?? (status === 'SUCCEEDED' ? price : 0),
				model_urls: { glb: 'https://assets.example/x.glb' },
				thumbnail_url: 'https://assets.example/x.png',
				task_error: status === 'FAILED' ? { message: 'boom' } : undefined
			};
		},
		async download() {
			return GLB;
		}
	};
}
const quiet = () => {};
const preview = { id: 'crate', pack: 'p', prompt: 'a wooden crate', stage: 'preview', model: 't2', targetTris: 3000 };

test('checkCap: unknown requester, over cap, exact fit, project total', () => {
	const b = { caps: { a: 20, b: 10 }, totalCredits: 25 };
	assert.equal(checkCap(b, {}, 'nobody', 5).ok, false);
	assert.equal(checkCap(b, { a: 15 }, 'a', 10).ok, false);
	assert.equal(checkCap(b, { a: 15 }, 'a', 5).ok, true);
	assert.match(checkCap(b, { a: 15, b: 8 }, 'a', 5).reason, /project total/);
});

test('keyState: a released key can be reserved again and is live again', () => {
	const dir = home();
	const f = path.join(dir, 'ledger.jsonl');
	const key = jobKey('lane', 'x', 'preview');
	appendUnlocked(f, { type: 'reserve', requester: 'lane', key, credits: 5 });
	appendUnlocked(f, { type: 'release', requester: 'lane', key, credits: -5 });
	assert.equal(keyState(readLedger(f), key).released, true);
	appendUnlocked(f, { type: 'reserve', requester: 'lane', key, credits: 5 });
	const st = keyState(readLedger(f), key);
	assert.equal(st.released, false);
	assert.equal(st.inDoubt, true);
	assert.equal(spent(dir), 5);
});

test('a torn last line never breaks the ledger', () => {
	const dir = home();
	const f = path.join(dir, 'ledger.jsonl');
	appendUnlocked(f, { type: 'reserve', requester: 'lane', key: 'k', credits: 5 });
	fs.appendFileSync(f, '{"type":"reser');
	assert.equal(readLedger(f).length, 1);
});

test('reserve under flock: 8 PROCESSES racing for a 20-credit cap → exactly 4 reservations', async () => {
	const dir = home({ lane: 20 });
	const script = `import { reserve } from ${JSON.stringify(path.join(here, '../lib/budget.js'))};
const r = await reserve({ ledgerFile: process.argv[2] + '/ledger.jsonl', budgetFile: process.argv[2] + '/budget.json' },
	{ requester: 'lane', key: 'lane/j' + process.argv[3] + '/preview#1', jobId: 'j' + process.argv[3], stage: 'preview', attempt: 1, credits: 5 });
console.log(r.status);`;
	const file = path.join(dir, 'race.mjs');
	fs.writeFileSync(file, script);
	const outs = await Promise.all(
		Array.from({ length: 8 }, (_, i) =>
			new Promise((res) => {
				const c = spawn(process.execPath, [file, dir, String(i)], { env: { ...process.env, MESHY_TEST_RESERVE_DELAY_MS: '150' } });
				let o = '';
				c.stdout.on('data', (d) => (o += d));
				c.on('exit', () => res(o.trim()));
			})
		)
	);
	assert.equal(outs.filter((s) => s === 'reserved').length, 4, outs.join(','));
	assert.equal(outs.filter((s) => s === 'refused').length, 4);
	assert.equal(spent(dir), 20);
});

test('reserve is idempotent per key: the same key twice reserves once', async () => {
	const dir = home();
	const files = { ledgerFile: path.join(dir, 'ledger.jsonl'), budgetFile: path.join(dir, 'budget.json') };
	const r = { requester: 'lane', key: 'lane/a/preview#1', jobId: 'a', stage: 'preview', attempt: 1, credits: 5 };
	assert.equal((await reserve(files, r)).status, 'reserved');
	assert.equal((await reserve(files, r)).status, 'existing');
	assert.equal(spent(dir), 5);
});

test('runJob: happy path spends the price once; a re-run spends nothing and never POSTs', async () => {
	const dir = home();
	const fake = fakeApi();
	const r1 = await runJob({ requester: 'lane', job: preview, home: dir, api: fake, log: quiet, pollMs: 1 });
	assert.equal(r1.status, 'SUCCEEDED');
	assert.equal(fs.readFileSync(path.join(r1.dir, 'raw.glb')).toString(), 'glTF-fake');
	assert.equal(spent(dir), 5);
	const r2 = await runJob({ requester: 'lane', job: preview, home: dir, api: fake, log: quiet, pollMs: 1 });
	assert.equal(r2.status, 'SUCCEEDED');
	assert.equal(fake.calls.create, 1);
	assert.equal(spent(dir), 5);
	// files gone → re-download from the SAME task, still no POST
	fs.rmSync(path.join(r1.dir, 'raw.glb'));
	const r3 = await runJob({ requester: 'lane', job: preview, home: dir, api: fake, log: quiet, pollMs: 1 });
	assert.equal(r3.status, 'SUCCEEDED');
	assert.equal(r3.taskId, r1.taskId);
	assert.ok(fs.existsSync(path.join(r1.dir, 'raw.glb')), 're-downloaded');
	assert.equal(fake.calls.create, 1);
	assert.equal(spent(dir), 5);
});

test('runJob --again: a deliberate second generation is a new attempt and spends again', async () => {
	const dir = home();
	const fake = fakeApi();
	await runJob({ requester: 'lane', job: preview, home: dir, api: fake, log: quiet, pollMs: 1 });
	const r = await runJob({ requester: 'lane', job: preview, home: dir, api: fake, log: quiet, pollMs: 1, again: true });
	assert.match(r.dir, /preview-2$/);
	assert.equal(fake.calls.create, 2);
	assert.equal(spent(dir), 10);
});

test('cap refusal: over-cap job is refused before any POST', async () => {
	const dir = home({ lane: 4 });
	const fake = fakeApi();
	const r = await runJob({ requester: 'lane', job: preview, home: dir, api: fake, log: quiet, pollMs: 1 });
	assert.equal(r.status, 'refused');
	assert.equal(fake.calls.create, 0);
	assert.equal(spent(dir), 0);
	const u = await runJob({ requester: 'typo-lane', job: preview, home: home({ lane: 100 }), api: fake, log: quiet, pollMs: 1 });
	assert.equal(u.status, 'refused');
});

test('definite create error (4xx) releases the reservation: nothing spent', async () => {
	const dir = home();
	const fake = fakeApi({ createImpl: () => { throw Object.assign(new Error('400 bad prompt'), { definite: true }); } });
	const r = await runJob({ requester: 'lane', job: preview, home: dir, api: fake, log: quiet, pollMs: 1 });
	assert.equal(r.status, 'error');
	assert.equal(spent(dir), 0);
});

test('ambiguous create (timeout after Meshy created the task): adopted, never paid twice', async () => {
	const dir = home();
	const fake = fakeApi({
		createImpl: (n, payload, tasks) => {
			// Meshy DID create it, but the response was lost
			tasks.set('lost-1', { id: 'lost-1', payload, created_at: Date.now(), prompt: payload.prompt, type: 'text-to-3d-preview' });
			throw new api.AmbiguousError('socket hang up');
		}
	});
	const r = await runJob({ requester: 'lane', job: preview, home: dir, api: fake, log: quiet, pollMs: 1 });
	assert.equal(r.status, 'SUCCEEDED');
	assert.equal(r.taskId, 'lost-1');
	assert.equal(fake.calls.create, 1);
	assert.equal(spent(dir), 5);
});

test('crash mid-POST (reserve in doubt) → the re-run adopts the orphan instead of re-POSTing', async () => {
	const dir = home();
	const f = path.join(dir, 'ledger.jsonl');
	const fake = fakeApi();
	const payload = buildPayload(preview);
	// simulate: reserve written, POST landed at Meshy, process died before `commit`
	appendUnlocked(f, { type: 'reserve', requester: 'lane', key: jobKey('lane', 'crate', 'preview'), jobId: 'crate', stage: 'preview', attempt: 1, credits: 5 });
	fake.tasks.set('orphan-9', { id: 'orphan-9', payload, created_at: Date.now(), prompt: payload.prompt, type: 'text-to-3d-preview' });
	const r = await runJob({ requester: 'lane', job: preview, home: dir, api: fake, log: quiet, pollMs: 1 });
	assert.equal(r.taskId, 'orphan-9');
	assert.equal(fake.calls.create, 0);
	assert.equal(spent(dir), 5);
});

test('crash BEFORE the POST landed → release + one fresh POST, still spent once', async () => {
	const dir = home();
	const f = path.join(dir, 'ledger.jsonl');
	const fake = fakeApi();
	appendUnlocked(f, { type: 'reserve', requester: 'lane', key: jobKey('lane', 'crate', 'preview'), jobId: 'crate', stage: 'preview', attempt: 1, credits: 5 });
	const r = await runJob({ requester: 'lane', job: preview, home: dir, api: fake, log: quiet, pollMs: 1 });
	assert.equal(r.status, 'SUCCEEDED');
	assert.equal(fake.calls.create, 1);
	assert.equal(spent(dir), 5);
});

test('FAILED task: Meshy refunds → the ledger refunds (consumed_credits 0)', async () => {
	const dir = home();
	const r = await runJob({ requester: 'lane', job: preview, home: dir, api: fakeApi({ status: 'FAILED' }), log: quiet, pollMs: 1 });
	assert.equal(r.status, 'FAILED');
	assert.equal(spent(dir), 0);
});

test('refine takes the preview task of the same job; without one it refuses to spend', async () => {
	const dir = home();
	const fake = fakeApi();
	const bad = await runJob({ requester: 'lane', job: { ...preview, stage: 'refine' }, home: dir, api: fake, log: quiet, pollMs: 1 });
	assert.equal(bad.status, 'invalid');
	assert.equal(fake.calls.create, 0);
	const p = await runJob({ requester: 'lane', job: preview, home: dir, api: fake, log: quiet, pollMs: 1 });
	await runJob({ requester: 'lane', job: { ...preview, stage: 'refine' }, home: dir, api: fake, log: quiet, pollMs: 1 });
	const refine = [...fake.tasks.values()].find((t) => t.payload.mode === 'refine');
	assert.equal(refine.payload.preview_task_id, p.taskId);
	assert.equal(spent(dir), 15);
	// a retexture variant takes its mesh from another job (`from`)
	await runJob({ requester: 'lane', job: { id: 'crate-mossy', stage: 'retexture', from: 'crate', texturePrompt: 'mossy' }, home: dir, api: fake, log: quiet, pollMs: 1 });
	const re = [...fake.tasks.values()].find((t) => t.payload.text_style_prompt);
	assert.equal(re.payload.input_task_id, [...fake.tasks.values()].find((t) => t.payload.mode === 'refine').id);
	assert.equal(spent(dir), 25);
});

test('requesters are isolated: one lane cannot spend another lane\'s cap', async () => {
	const dir = home({ a: 5, b: 100 });
	const fake = fakeApi();
	assert.equal((await runJob({ requester: 'a', job: preview, home: dir, api: fake, log: quiet, pollMs: 1 })).status, 'SUCCEEDED');
	assert.equal((await runJob({ requester: 'a', job: { ...preview, id: 'two' }, home: dir, api: fake, log: quiet, pollMs: 1 })).status, 'refused');
	assert.equal(spent(dir, 'a'), 5);
	assert.equal(spent(dir, 'b'), 0);
});

test('validateJob + buildPayload: t2 clamps to 15k, house style is appended, 600-char prompt cap', () => {
	assert.deepEqual(validateJob(preview), []);
	assert.ok(validateJob({ ...preview, id: 'Bad Id' }).length);
	assert.ok(validateJob({ ...preview, prompt: 'x'.repeat(601) }).length);
	const p = buildPayload({ ...preview, targetTris: 40000 });
	assert.equal(p.model_type, 'smart-topology');
	assert.equal(p.target_polycount, 15000);
	assert.match(p.prompt, /stylized realistic/);
	assert.equal(buildPayload({ ...preview, style: 'none' }).prompt, 'a wooden crate');
	assert.equal(priceOf({ stage: 'preview', model: 'meshy-6' }), 20);
	assert.equal(priceOf({ stage: 'refine' }), 10);
});

/** @param {number[]} statuses @returns {typeof fetch} */
function fakeFetch(statuses, calls) {
	return /** @type {any} */ (async () => {
		const s = statuses[Math.min(calls.n++, statuses.length - 1)];
		if (s === 'refused') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
		if (s === 'reset') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
		return new Response(JSON.stringify(s === 202 ? { result: 'id-1' } : { message: 'x' }), { status: s, headers: { 'retry-after': '0' } });
	});
}

test('api.create: 429 and connection-refused are retried; 5xx/reset are ambiguous; 4xx definite', async () => {
	process.env.MESHY_API_KEY ??= 'msy_test_key_not_real';
	let calls = { n: 0 };
	assert.equal(await api.create('/x', {}, { fetchImpl: fakeFetch([429, 429, 202], calls) }), 'id-1');
	assert.equal(calls.n, 3);
	calls = { n: 0 };
	assert.equal(await api.create('/x', {}, { fetchImpl: fakeFetch(['refused', 202], calls) }), 'id-1');
	await assert.rejects(api.create('/x', {}, { fetchImpl: fakeFetch([502], { n: 0 }) }), api.AmbiguousError);
	await assert.rejects(api.create('/x', {}, { fetchImpl: fakeFetch(['reset'], { n: 0 }) }), api.AmbiguousError);
	await assert.rejects(api.create('/x', {}, { fetchImpl: fakeFetch([402], { n: 0 }) }), api.DefiniteError);
});

test('scrub never lets the key through', () => {
	process.env.MESHY_API_KEY = 'msy_secret_abcdefgh1234';
	assert.equal(api.scrub('Authorization: Bearer msy_secret_abcdefgh1234 and msy_other_zzzzzzzzzz').includes('secret'), false);
	assert.equal(api.scrub('x msy_other_zzzzzzzzzz').includes('zzzz'), false);
});
