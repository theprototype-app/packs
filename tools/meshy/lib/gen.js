// One generation job, end to end: validate → price → reserve (cap check, under flock)
// → create → commit the task id → poll → download → `done` + credit correction.
//
// IDEMPOTENCY. A job is keyed `<requester>/<job id>/<stage>#<attempt>`. Re-running the
// same job (after a crash, a timeout, a ^C, or just by accident) NEVER pays twice:
//   - key has a task id          → resume polling / re-download, no POST
//   - key reserved, no task id   → the POST's fate is unknown: ADOPT the matching task
//     (in doubt)                   from Meshy's task list; only if Meshy has none is the
//                                  reservation released and the POST retried
//   - key released               → the POST was refused, re-reserve and retry
// A fresh generation of the same job id takes `--again` (attempt n+1) — deliberate.
import fs from 'node:fs';
import path from 'node:path';
import * as realApi from './api.js';
import { priceOf } from './prices.js';
import { reserve } from './budget.js';
import { readLedger, append, keyState, jobKey, lastAttempt, latestSucceededTask } from './ledger.js';

export const STAGES = ['preview', 'refine', 'retexture', 'remesh'];

// The orchestrator's locked art direction (_rules-30c.md), folded into every prompt
// with style "house" so the three packs mix.
export const HOUSE_STYLE =
	'stylized realistic game asset, clean readable shapes, slightly chunky proportions, warm natural materials, no text, no logos';
export const HOUSE_TEXTURE =
	'hand-painted stylized PBR texture, warm natural palette (sandstone, oak, slate, moss, brass), real roughness variation, flat even lighting, no baked shadows or highlights, no text, no logos';

const ENDPOINT = {
	preview: '/openapi/v2/text-to-3d',
	refine: '/openapi/v2/text-to-3d',
	retexture: '/openapi/v1/retexture',
	remesh: '/openapi/v1/remesh'
};

/** @param {any} job */
export function validateJob(job) {
	const errs = [];
	if (!job || typeof job !== 'object') return ['job must be an object'];
	if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(job.id ?? '')) errs.push('id: lowercase slug [a-z0-9_-], ≤64');
	if (!STAGES.includes(job.stage)) errs.push(`stage: one of ${STAGES.join('|')}`);
	if (job.stage === 'preview' && !job.prompt) errs.push('prompt: required for preview');
	if (job.prompt && job.prompt.length > 600) errs.push('prompt: ≤600 chars (the house style suffix needs the rest of Meshy\'s 800)');
	if (job.stage === 'retexture' && !job.texturePrompt) errs.push('texturePrompt: required for retexture');
	if (job.targetTris != null && !(job.targetTris >= 100 && job.targetTris <= 300000)) errs.push('targetTris: 100..300000');
	if (job.style != null && !['house', 'none'].includes(job.style)) errs.push('style: house|none');
	if (job.dims != null && typeof job.dims !== 'object') errs.push('dims: {x?,y?,z?} metres');
	return errs;
}

/** @param {string} p @param {string} suffix */
const withStyle = (p, suffix, style) => (style === 'none' || !p ? p : `${p}. ${suffix}`).slice(0, 800);

/**
 * The create body for a stage. Pure — the mesh source task id is resolved by the caller.
 * @param {any} job @param {{sourceTaskId?: string}} ctx
 */
export function buildPayload(job, { sourceTaskId } = {}) {
	const style = job.style ?? 'house';
	const model = job.model ?? 't2';
	const texturePrompt = withStyle(job.texturePrompt ?? '', HOUSE_TEXTURE, style) || (style === 'house' ? HOUSE_TEXTURE : undefined);
	switch (job.stage) {
		case 'preview': {
			const t2 = model === 't2' || model === 'meshy-t2';
			/** @type {any} */
			const p = {
				mode: 'preview',
				prompt: withStyle(job.prompt, HOUSE_STYLE, style),
				target_formats: ['glb']
			};
			if (t2) {
				p.model_type = 'smart-topology';
				p.ai_model = 'meshy-t2';
				p.target_polycount = Math.max(100, Math.min(15000, job.targetTris ?? 4000));
			} else {
				p.ai_model = model;
				if (job.targetTris) {
					p.should_remesh = true;
					p.topology = 'triangle';
					p.target_polycount = Math.max(100, Math.min(300000, job.targetTris));
				}
				if (job.geometryResolution) p.geometry_resolution = job.geometryResolution;
			}
			return p;
		}
		case 'refine':
			return {
				mode: 'refine',
				preview_task_id: sourceTaskId,
				ai_model: job.refineModel ?? 'meshy-6',
				enable_pbr: job.pbr ?? true,
				texture_resolution: job.textureResolution ?? '2k',
				...(texturePrompt ? { texture_prompt: texturePrompt } : {}),
				target_formats: ['glb']
			};
		case 'retexture':
			return {
				input_task_id: sourceTaskId,
				text_style_prompt: texturePrompt,
				ai_model: job.refineModel ?? 'meshy-6',
				enable_original_uv: job.keepUv ?? true,
				enable_pbr: job.pbr ?? true,
				texture_resolution: job.textureResolution ?? '2k',
				target_formats: ['glb']
			};
		case 'remesh':
			return {
				input_task_id: sourceTaskId,
				topology: 'triangle',
				target_polycount: Math.max(100, Math.min(300000, job.targetTris ?? 4000)),
				target_formats: ['glb']
			};
	}
	throw new Error(`unknown stage ${job.stage}`);
}

/** which earlier stages of the `from` job a stage takes its mesh from */
const SOURCE_STAGES = { refine: ['preview'], retexture: ['refine', 'retexture', 'preview'], remesh: ['refine', 'retexture', 'preview'] };

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED']);

/**
 * Find a task Meshy created for an in-doubt reservation.
 * @param {any} api @param {string} stage @param {any} payload @param {string} sinceIso @param {Set<string>} known
 */
export async function findOrphan(api, stage, payload, sinceIso, known) {
	const since = Date.parse(sinceIso) - 120_000; // clock skew slack
	const list = await api.get(`${ENDPOINT[stage]}?page_num=1&page_size=50&sort_by=-created_at`);
	const rows = Array.isArray(list) ? list : (list?.result ?? list?.data ?? []);
	const match = rows
		.filter((t) => !known.has(t.id) && Number(t.created_at) >= since)
		.filter((t) => {
			if (stage === 'preview') return t.prompt === payload.prompt && (!t.type || t.type.endsWith('preview'));
			if (stage === 'refine') return (!t.type || t.type.endsWith('refine')) && (t.preview_task_id == null || t.preview_task_id === payload.preview_task_id);
			if (stage === 'retexture') return t.text_style_prompt == null || t.text_style_prompt === payload.text_style_prompt;
			return true;
		})
		.sort((a, b) => Number(a.created_at) - Number(b.created_at));
	return match[0]?.id;
}

/**
 * @param {{requester: string, job: any, home: string, again?: boolean, out?: string, api?: any,
 *   log?: (s: string) => void, pollMs?: number, dryRun?: boolean}} o
 * @returns {Promise<{status: string, taskId?: string, dir?: string, credits?: number, reason?: string}>}
 */
export async function runJob(o) {
	const { requester, job, home } = o;
	const api = o.api ?? realApi;
	const log = o.log ?? ((s) => console.error(`[${requester}/${job.id}] ${s}`));
	const ledgerFile = path.join(home, 'ledger.jsonl');
	const budgetFile = path.join(home, 'budget.json');
	const errs = validateJob(job);
	if (errs.length) return { status: 'invalid', reason: errs.join('; ') };
	if (!/^[a-z0-9][a-z0-9_-]*$/.test(requester)) return { status: 'invalid', reason: 'requester must be a lane slug' };

	let entries = readLedger(ledgerFile);
	const prev = lastAttempt(entries, requester, job.id, job.stage);
	const attempt = o.again ? prev + 1 : Math.max(1, prev);
	const key = jobKey(requester, job.id, job.stage, attempt);
	const dir = o.out ?? path.join(home, 'staging', requester, job.id, `${job.stage}-${attempt}`);
	let st = keyState(entries, key);

	// already finished: never re-spend; re-download only if the files are gone
	if (st.done?.status === 'SUCCEEDED' && fs.existsSync(path.join(dir, 'raw.glb'))) {
		log(`already done (task ${st.taskId}) → ${dir}`);
		return { status: 'SUCCEEDED', taskId: st.taskId, dir, credits: 0 };
	}

	// resolve the mesh source for refine/retexture/remesh
	let sourceTaskId;
	if (job.stage !== 'preview') {
		const fromJob = job.from ?? job.id;
		sourceTaskId = job.sourceTaskId ?? latestSucceededTask(entries, requester, fromJob, SOURCE_STAGES[job.stage])?.taskId;
		if (!sourceTaskId) return { status: 'invalid', reason: `${job.stage} needs a SUCCEEDED ${SOURCE_STAGES[job.stage].join('/')} of job "${fromJob}" (by ${requester}) — run that first, or pass sourceTaskId` };
	}
	const payload = buildPayload(job, { sourceTaskId });
	const credits = priceOf({ stage: job.stage, model: job.model, geometryResolution: job.geometryResolution, textureResolution: job.textureResolution });
	if (o.dryRun) return { status: 'dry-run', credits, reason: JSON.stringify(payload) };

	let taskId = st.taskId;
	const known = new Set(entries.filter((e) => e.type === 'commit').map((e) => e.taskId));

	if (!taskId && st.inDoubt) {
		log(`reservation in doubt (a POST may have landed at ${st.reserve.ts}) — looking for the orphan task`);
		taskId = await findOrphan(api, job.stage, payload, st.reserve.ts, known);
		if (taskId) {
			log(`adopted orphan task ${taskId} — no second spend`);
			await append(ledgerFile, { type: 'commit', requester, key, jobId: job.id, stage: job.stage, credits: 0, taskId, adopted: true });
		} else {
			log('Meshy has no such task: the POST never landed — releasing the reservation');
			await append(ledgerFile, { type: 'release', requester, key, jobId: job.id, stage: job.stage, credits: -st.reserve.credits, reason: 'orphan-not-found' });
		}
		entries = readLedger(ledgerFile);
		st = keyState(entries, key);
	}

	if (!taskId) {
		const r = await reserve({ ledgerFile, budgetFile }, { requester, key, jobId: job.id, stage: job.stage, attempt, credits, pack: job.pack, category: job.category });
		if (r.status === 'refused') {
			log(`REFUSED: ${r.cap.reason}`);
			return { status: 'refused', reason: r.cap.reason, credits };
		}
		if (r.status === 'existing') {
			// another process reserved this very key between our read and our lock
			return { status: 'busy', reason: `${key} is already being run by another process — re-run later to pick it up` };
		}
		log(`reserved ${credits} credits (${r.cap.remaining - credits} left of ${r.cap.cap})`);
		try {
			taskId = await api.create(ENDPOINT[job.stage], payload, { log });
		} catch (err) {
			if (err instanceof realApi.DefiniteError || err?.name === 'DefiniteError' || err?.definite) {
				await append(ledgerFile, { type: 'release', requester, key, jobId: job.id, stage: job.stage, credits: -credits, reason: String(err.message).slice(0, 300) });
				log(`create refused (not charged): ${err.message}`);
				return { status: 'error', reason: err.message, credits: 0 };
			}
			// ambiguous: look for it a few times before leaving it in doubt
			log(`create ambiguous: ${err.message} — looking for the task`);
			for (let i = 0; i < 4 && !taskId; i++) {
				await new Promise((r2) => setTimeout(r2, (o.pollMs ?? 5000) * (i + 1)));
				try {
					taskId = await findOrphan(api, job.stage, payload, new Date(Date.now() - 300_000).toISOString(), known);
				} catch {
					/* list failed too — stay in doubt */
				}
			}
			if (!taskId) return { status: 'in-doubt', reason: `${err.message} — re-run the same job later: it adopts the task or releases the credits` };
			await append(ledgerFile, { type: 'commit', requester, key, jobId: job.id, stage: job.stage, credits: 0, taskId, adopted: true });
		}
		if (!st.taskId && taskId && !(await isCommitted(ledgerFile, key))) {
			await append(ledgerFile, { type: 'commit', requester, key, jobId: job.id, stage: job.stage, credits: 0, taskId });
		}
		log(`task ${taskId} created`);
	}

	// poll
	const t0 = Date.now();
	let task;
	let lastProgress = -1;
	for (;;) {
		task = await api.get(`${ENDPOINT[job.stage]}/${taskId}`);
		if (TERMINAL.has(task.status)) break;
		if (task.progress !== lastProgress) {
			log(`${task.status} ${task.progress ?? 0}%${task.preceding_tasks ? ` (queue ${task.preceding_tasks})` : ''}`);
			lastProgress = task.progress;
		}
		const elapsed = Date.now() - t0;
		if (elapsed > 45 * 60_000) return { status: 'timeout', taskId, reason: 'still running after 45 min — re-run the same job to resume polling' };
		await new Promise((r) => setTimeout(r, o.pollMs ?? (elapsed < 60_000 ? 5000 : 10_000)));
	}
	const seconds = Math.round((Date.now() - t0) / 1000);

	// the credit correction: the task's own consumed_credits is the truth
	const consumed = task.consumed_credits;
	const reserved = keyState(readLedger(ledgerFile), key).reserve?.credits ?? credits;
	if (typeof consumed === 'number' && consumed !== reserved && !(await hasCorrection(ledgerFile, key))) {
		await append(ledgerFile, { type: 'refund', requester, key, jobId: job.id, stage: job.stage, taskId, credits: consumed - reserved, reason: `consumed_credits=${consumed}` });
	} else if (typeof consumed !== 'number' && task.status !== 'SUCCEEDED' && !(await hasCorrection(ledgerFile, key))) {
		// docs: failed tasks are refunded even when the field is absent
		await append(ledgerFile, { type: 'refund', requester, key, jobId: job.id, stage: job.stage, taskId, credits: -reserved, reason: `${task.status} (refunded per Meshy docs)` });
	}

	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ requester, attempt, ...job }, null, '\t'));
	fs.writeFileSync(path.join(dir, 'task.json'), realApi.scrub(JSON.stringify(task, null, '\t')));
	if (task.status !== 'SUCCEEDED') {
		await append(ledgerFile, { type: 'done', requester, key, jobId: job.id, stage: job.stage, credits: 0, taskId, status: task.status, error: task.task_error?.message });
		log(`${task.status}: ${task.task_error?.message ?? ''}`);
		return { status: task.status, taskId, dir, reason: task.task_error?.message, credits: consumed ?? 0 };
	}
	const glbUrl = task.model_urls?.glb;
	if (!glbUrl) throw new Error(`task ${taskId} SUCCEEDED without a glb url`);
	fs.writeFileSync(path.join(dir, 'raw.glb'), await api.download(glbUrl));
	if (task.thumbnail_url) {
		try {
			fs.writeFileSync(path.join(dir, 'meshy-thumb.png'), await api.download(task.thumbnail_url));
		} catch (err) {
			log(`thumbnail download failed (non-fatal): ${err.message}`);
		}
	}
	await append(ledgerFile, {
		type: 'done',
		requester,
		key,
		jobId: job.id,
		stage: job.stage,
		credits: 0,
		taskId,
		status: 'SUCCEEDED',
		seconds,
		dir,
		pack: job.pack,
		consumed
	});
	log(`SUCCEEDED in ${seconds}s → ${dir}/raw.glb`);
	return { status: 'SUCCEEDED', taskId, dir, credits: consumed ?? credits };
}

async function isCommitted(ledgerFile, key) {
	return !!keyState(readLedger(ledgerFile), key).taskId;
}
async function hasCorrection(ledgerFile, key) {
	return readLedger(ledgerFile).some((e) => e.key === key && e.type === 'refund');
}
