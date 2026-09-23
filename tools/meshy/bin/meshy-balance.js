#!/usr/bin/env node
// meshy-balance [--requester slug] [--json] [--offline]
// Live Meshy balance (unless --offline) + the ledger's spend per requester against its cap.
// "drift" = what Meshy says was spent minus what the ledger says: nonzero means credits
// moved outside this tool (or a correction is pending) — investigate before spending more.
import path from 'node:path';
import { parseArgs, HOME } from '../lib/cli.js';
import { readLedger, spentByRequester } from '../lib/ledger.js';
import { loadBudget } from '../lib/budget.js';

const a = parseArgs(process.argv.slice(2));
const budget = loadBudget(path.join(HOME, 'budget.json'));
const entries = readLedger(path.join(HOME, 'ledger.jsonl'));
const spent = spentByRequester(entries);
let live = null;
if (!a.offline && process.env.MESHY_API_KEY) live = await (await import('../lib/api.js')).balance();
const rows = Object.keys({ ...budget.caps, ...spent })
	.filter((r) => !a.requester || r === a.requester)
	.map((r) => ({ requester: r, cap: budget.caps[r] ?? 0, spent: spent[r] ?? 0, left: (budget.caps[r] ?? 0) - (spent[r] ?? 0) }));
const ledgerTotal = Object.values(spent).reduce((x, y) => x + y, 0);
const start = budget.totalCredits ?? null;
const inFlight = entries.filter((e) => e.type === 'reserve').length - entries.filter((e) => e.type === 'done' || e.type === 'release').length;
const summary = { live, start, ledgerTotal, drift: live != null && start != null ? start - live - ledgerTotal : null, inFlight };
if (a.json) console.log(JSON.stringify({ ...summary, rows }, null, 2));
else {
	console.log(`balance ${live ?? '(offline)'} · started ${start} · ledger spent ${ledgerTotal}${summary.drift ? ` · DRIFT ${summary.drift}` : ''}${inFlight > 0 ? ` · ${inFlight} in flight` : ''}`);
	for (const r of rows) console.log(`${r.requester.padEnd(18)} cap ${String(r.cap).padStart(4)}  spent ${String(r.spent).padStart(4)}  left ${String(r.left).padStart(4)}`);
}
