// The spend ledger: append-only JSONL, one object per line, every write under flock.
//
// Every line carries a SIGNED `credits` delta, so a requester's spend is simply the sum
// of its lines — no line is ever rewritten:
//   reserve  +c   written BEFORE the create POST, after the cap check (same lock hold),
//                 so two concurrent jobs can never both squeeze under one cap
//   commit    0   the POST was accepted: carries the Meshy task id (the idempotency map)
//   release  -c   the POST was definitely NOT accepted (4xx/429/connection refused)
//   refund   -c   Meshy refunded the task (a FAILED task — see prices.js)
//   done      0   the task reached a terminal status; carries status + staged paths
//   adjust   ±n   manual correction by the orchestrator (a note is required)
// A `reserve` with neither `commit` nor `release` is IN DOUBT (the process died or the
// network dropped mid-POST): the next run of that job adopts the orphan task from
// Meshy's task list instead of paying twice (gen.js).
import fs from 'node:fs';
import path from 'node:path';
import { withFlock } from './lock.js';

/** @typedef {{ts: string, type: 'reserve'|'commit'|'release'|'refund'|'done'|'adjust', requester: string, key?: string, jobId?: string, stage?: string, credits: number, taskId?: string, [k: string]: any}} Entry */

/** @param {string} file @returns {Entry[]} */
export function readLedger(file) {
	if (!fs.existsSync(file)) return [];
	const out = [];
	for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
		if (!line.trim()) continue;
		try {
			out.push(JSON.parse(line));
		} catch {
			// a torn last line (crash mid-append) is skipped, never fatal
		}
	}
	return out;
}

/** @param {string} file @param {Omit<Entry, 'ts'> & {ts?: string}} entry — caller must hold the lock */
export function appendUnlocked(file, entry) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
	fs.appendFileSync(file, line);
}

/** @param {string} file @param {Omit<Entry, 'ts'>} entry */
export function append(file, entry) {
	return withFlock(file, () => appendUnlocked(file, entry));
}

/** Credits spent (incl. in-flight reservations) per requester. @param {Entry[]} entries */
export function spentByRequester(entries) {
	/** @type {Record<string, number>} */
	const out = {};
	for (const e of entries) out[e.requester] = (out[e.requester] ?? 0) + (Number(e.credits) || 0);
	return out;
}

/**
 * Everything the ledger knows about one job key.
 * @param {Entry[]} entries @param {string} key
 */
export function keyState(entries, key) {
	const all = entries.filter((e) => e.key === key);
	// a released key may be reserved again (the POST was refused, the job is re-run):
	// only the lines from the LAST reserve on describe the live attempt
	let from = -1;
	all.forEach((e, i) => {
		if (e.type === 'reserve') from = i;
	});
	const mine = from < 0 ? [] : all.slice(from);
	const reserve = mine[0];
	const commit = mine.find((e) => e.type === 'commit');
	const release = mine.find((e) => e.type === 'release');
	const done = [...mine].reverse().find((e) => e.type === 'done');
	return {
		reserved: !!reserve,
		reserve,
		taskId: commit?.taskId,
		released: !!release,
		inDoubt: !!reserve && !commit && !release,
		done
	};
}

/** Highest attempt number used for a requester/job/stage (0 = never). @param {Entry[]} entries */
export function lastAttempt(entries, requester, jobId, stage) {
	let n = 0;
	for (const e of entries) {
		if (e.type === 'reserve' && e.requester === requester && e.jobId === jobId && e.stage === stage) n = Math.max(n, e.attempt ?? 1);
	}
	return n;
}

/** @param {string} requester @param {string} jobId @param {string} stage @param {number} attempt */
export function jobKey(requester, jobId, stage, attempt = 1) {
	return `${requester}/${jobId}/${stage}#${attempt}`;
}

/**
 * The latest successful task id for a job (any stage in `stages`, newest first) — how
 * refine finds its preview and retexture finds its mesh.
 * @param {Entry[]} entries @param {string} requester @param {string} jobId @param {string[]} stages
 */
export function latestSucceededTask(entries, requester, jobId, stages) {
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e.type === 'done' && e.status === 'SUCCEEDED' && e.requester === requester && e.jobId === jobId && stages.includes(e.stage)) return e;
	}
	return undefined;
}
