#!/usr/bin/env node
// meshy-gen --requester <slug> --job job.json [--again] [--concurrency 2] [--dry-run] [--post] [--out dir]
//   job.json holds ONE job object or an ARRAY of jobs (run with --concurrency workers).
//   --again     a NEW generation of the same job id (attempt n+1) — spends again
//   --dry-run   print the price + the exact create body, spend nothing
//   --post      run meshy-post + meshy-thumb on every SUCCEEDED job (→ <dir>/model.glb, thumb.webp)
// stdout: one JSON line per job. Exit 0 = all SUCCEEDED, 3 = something refused (cap), 1 = other.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, die, HOME } from '../lib/cli.js';
import { runJob } from '../lib/gen.js';

const args = parseArgs(process.argv.slice(2));
if (!args.requester || !args.job) die('usage: meshy-gen --requester <slug> --job job.json [--again] [--concurrency 2] [--dry-run] [--post]');
if (!process.env.MESHY_API_KEY && !args['dry-run']) die('MESHY_API_KEY is not set — run: set -a; . ~/.config/theprototype/meshy.env; set +a');
if (!fs.existsSync(path.join(HOME, 'READY')) && !args['dry-run'] && !process.env.MESHY_ALLOW_NOT_READY) die(`${HOME}/READY is missing — the pipeline is not released yet`);

const raw = JSON.parse(fs.readFileSync(args.job, 'utf8'));
const jobs = Array.isArray(raw) ? raw : [raw];
const ids = jobs.map((j) => `${j.id}/${j.stage}`);
if (new Set(ids).size !== ids.length) die('the job file repeats an id/stage pair');
const concurrency = Math.max(1, Math.min(4, Number(args.concurrency ?? 2)));

/** @type {any[]} */
const results = [];
let next = 0;
async function worker() {
	while (next < jobs.length) {
		const job = jobs[next++];
		let r;
		try {
			r = await runJob({ requester: args.requester, job, home: HOME, again: !!args.again, dryRun: !!args['dry-run'], out: jobs.length === 1 ? args.out : undefined });
			// a rig/animation is skinned: meshy-post would tear it off its skeleton — merge
			// those with meshy-rigged instead
			if (r.status === 'SUCCEEDED' && args.post && job.stage !== 'rig' && job.stage !== 'animate') {
				const { postProcess } = await import('../lib/post.js');
				const { renderThumbs } = await import('../lib/thumb.js');
				const outGlb = path.join(r.dir, 'model.glb');
				r.post = await postProcess(path.join(r.dir, 'raw.glb'), outGlb, job);
				await renderThumbs([{ glb: outGlb, out: path.join(r.dir, 'thumb.webp') }]);
			}
		} catch (err) {
			r = { status: 'error', reason: err?.message ?? String(err) };
		}
		const line = { requester: args.requester, id: job.id, stage: job.stage, ...r };
		results.push(line);
		console.log(JSON.stringify(line));
	}
}
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));

if (results.some((r) => r.status === 'refused')) process.exit(3);
if (results.every((r) => r.status === 'SUCCEEDED' || r.status === 'dry-run')) process.exit(0);
process.exit(1);
