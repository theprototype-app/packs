#!/usr/bin/env node
// meshy-post <raw.glb> <out.glb> [--job job.json] [--targetTris 3000] [--dims x,y,z] [--fit contain|stretch]
//            [--pivot bottom-center|bottom-back-left|bottom-center-back|center|none] [--rotateY deg] [--hero]
//            [--textureSize 1024] [--textureFormat jpeg|webp|png] [--thumb out.webp]
// dims: metres per axis, "-" to leave an axis free (e.g. "-,0.8,-" = 0.8 m tall, uniform).
// Flags override the job file's fields. Prints a JSON report (tris in/out, size, textures).
import fs from 'node:fs';
import { parseArgs, die } from '../lib/cli.js';
import { postProcess, PIVOTS } from '../lib/post.js';

const a = parseArgs(process.argv.slice(2));
const [input, output] = a._;
if (!input || !output) die('usage: meshy-post <raw.glb> <out.glb> [--job job.json] [--targetTris N] [--dims x,y,z] [--pivot …] [--thumb out.webp]');
const job = a.job ? JSON.parse(fs.readFileSync(a.job, 'utf8')) : {};
if (Array.isArray(job)) die('--job takes ONE job object here');
if (a.targetTris) job.targetTris = Number(a.targetTris);
if (a.dims) {
	const [x, y, z] = String(a.dims).split(',').map((v) => (v === '-' || v === '' ? undefined : Number(v)));
	job.dims = { x, y, z };
}
if (a.fit) job.fit = a.fit;
if (a.pivot) {
	if (!PIVOTS.includes(a.pivot)) die(`--pivot: one of ${PIVOTS.join('|')}`);
	job.pivot = a.pivot;
}
if (a.rotateY) job.rotateY = Number(a.rotateY);
if (a.hero) job.hero = true;
if (a.textureSize) job.textureSize = Number(a.textureSize);
if (a.textureFormat) job.textureFormat = a.textureFormat;
const report = await postProcess(input, output, job);
if (a.thumb) {
	const { renderThumbs } = await import('../lib/thumb.js');
	report.thumb = (await renderThumbs([{ glb: output, out: a.thumb }]))[0].out;
}
console.log(JSON.stringify(report, null, 2));
