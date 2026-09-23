// Per-requester caps (budget.json) and the reserve step that enforces them.
import fs from 'node:fs';
import { withFlock } from './lock.js';
import { readLedger, appendUnlocked, spentByRequester, keyState } from './ledger.js';

/** @typedef {{caps: Record<string, number>, totalCredits?: number, [k: string]: any}} Budget */

/** @param {string} file @returns {Budget} */
export function loadBudget(file) {
	if (!fs.existsSync(file)) throw new Error(`no budget file at ${file}`);
	const b = JSON.parse(fs.readFileSync(file, 'utf8'));
	if (!b || typeof b.caps !== 'object') throw new Error(`${file}: missing "caps"`);
	return b;
}

/**
 * Pure cap check. A requester that is not in `caps` has a cap of 0 — refusing an unknown
 * slug is the point (a typo must not spend from nobody's allowance).
 * @param {Budget} budget @param {Record<string, number>} spent @param {string} requester @param {number} cost
 */
export function checkCap(budget, spent, requester, cost) {
	const cap = Number(budget.caps[requester] ?? 0);
	const used = spent[requester] ?? 0;
	const remaining = cap - used;
	if (!(requester in budget.caps)) return { ok: false, cap, spent: used, remaining, reason: `requester "${requester}" has no cap in budget.json` };
	if (cost > remaining) return { ok: false, cap, spent: used, remaining, reason: `job needs ${cost} credits, ${requester} has ${remaining} of ${cap} left` };
	if (budget.totalCredits != null) {
		const all = Object.values(spent).reduce((a, b) => a + b, 0);
		if (all + cost > budget.totalCredits) return { ok: false, cap, spent: used, remaining, reason: `project total ${budget.totalCredits} would be exceeded (${all} spent)` };
	}
	return { ok: true, cap, spent: used, remaining };
}

/**
 * Atomically: if `key` already holds a live reservation, return it (idempotent re-run,
 * NO new spend); otherwise check the cap and append a `reserve` line. One lock hold, so
 * the check and the write can never interleave with another lane's.
 * @param {{ledgerFile: string, budgetFile: string}} files
 * @param {{requester: string, key: string, jobId: string, stage: string, attempt: number, credits: number, [k: string]: any}} r
 */
export async function reserve(files, r) {
	return withFlock(files.ledgerFile, async () => {
		const entries = readLedger(files.ledgerFile);
		const st = keyState(entries, r.key);
		if (st.reserved && !st.released) return { status: /** @type {const} */ ('existing'), state: st };
		const budget = loadBudget(files.budgetFile);
		const cap = checkCap(budget, spentByRequester(entries), r.requester, r.credits);
		if (!cap.ok) return { status: /** @type {const} */ ('refused'), cap };
		// test hook: widen the check→write window so the race suite can prove the lock
		if (process.env.MESHY_TEST_RESERVE_DELAY_MS) await new Promise((r) => setTimeout(r, Number(process.env.MESHY_TEST_RESERVE_DELAY_MS)));
		appendUnlocked(files.ledgerFile, { type: 'reserve', ...r });
		return { status: /** @type {const} */ ('reserved'), cap };
	});
}
