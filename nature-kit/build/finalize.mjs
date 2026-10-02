#!/usr/bin/env node
// finalize.mjs — builds every nature-kit item from items.json into the pack folder.
//
//   node finalize.mjs [--only Oak,Pine] [--no-thumbs]
//
// Three kinds of item (items.json):
//   meshy    staging/<requester>/<job>/<stage>-<n>/raw.glb → [cut the generator's base disc]
//            → meshy-post (weld, simplify, scale, pivot, 1024² JPEG) → [colour grade]
//   kitbash  already-built items merged into one GLB (instanced: a mesh used 3× is stored once)
//   proc     a procedural script (grass.mjs, leaves.mjs, water.mjs) — 0 credits
// Then a 512² thumb.webp per item and the pack's default.json (model-list format, core PACKS.md).
//
// Nothing here spends credits: the Meshy outputs are read from the tool's staging folder.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const TOOL = process.env.MESHY_TOOL || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../tools/meshy');
const STAGING = process.env.MESHY_STAGING || path.join(os.homedir(), '.code/lanes-30/meshy/staging/30c-pack-nature');
const require = createRequire(path.join(TOOL, 'package.json'));
const { NodeIO, Document } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { getBounds, mergeDocuments, unpartition, dedup, prune } = require('@gltf-transform/functions');
const { postProcess } = await import(pathToFileURL(path.join(TOOL, 'lib/post.js')).href);
// the shared post steps (roadmap 34 E2: tools/kit-build instead of a fork per kit)
const { cutBase, gradeHue: grade, dropEmissive } = await import('../../tools/kit-build/lib/post.mjs');

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PACK = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nature-fin-'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const noThumbs = args.includes('--no-thumbs');
const spec = JSON.parse(fs.readFileSync(path.join(HERE, 'items.json'), 'utf8'));

const glbOf = (name) => path.join(PACK, name, 'glTF-Binary', `${name}.glb`);

/** newest attempt dir of a job stage in staging */
function stagingRaw(job, stage) {
	const dir = path.join(STAGING, job);
	const n = fs
		.readdirSync(dir)
		.filter((d) => d.startsWith(stage + '-') && fs.existsSync(path.join(dir, d, 'raw.glb')))
		.map((d) => Number(d.slice(stage.length + 1)))
		.sort((a, b) => b - a)[0];
	if (!n) throw new Error(`no ${stage} raw.glb for ${job} in ${dir}`);
	return path.join(dir, `${stage}-${n}`, 'raw.glb');
}

/** merge built items into one GLB; parts: [{item, pos, rotY, scale}] */
async function kitbash(parts, out, pivot = 'bottom-center') {
	const doc = new Document();
	const scene = doc.createScene('Scene');
	for (const p of parts) {
		const src = await io.read(glbOf(p.item));
		const map = mergeDocuments(doc, src);
		const srcScene = src.getRoot().getDefaultScene() ?? src.getRoot().listScenes()[0];
		for (const n of srcScene.listChildren()) {
			const node = map.get(n);
			const a = ((p.rotY ?? 0) * Math.PI) / 180;
			node.setTranslation(p.pos ?? [0, 0, 0]).setRotation([0, Math.sin(a / 2), 0, Math.cos(a / 2)]).setScale(Array.isArray(p.scale) ? p.scale : [p.scale ?? 1, p.scale ?? 1, p.scale ?? 1]);
			scene.addChild(node);
		}
	}
	for (const s of doc.getRoot().listScenes()) if (s !== scene) s.dispose();
	doc.getRoot().setDefaultScene(scene);
	await doc.transform(unpartition(), dedup(), prune());
	// re-pivot the whole group: a wrapper node offset so the group's pivot is the origin
	const b = getBounds(scene);
	const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
	const off = pivot === 'bottom-center' ? [-cx, -b.min[1], -cz] : [0, -b.min[1], 0];
	for (const n of scene.listChildren()) {
		const t = n.getTranslation();
		n.setTranslation([t[0] + off[0], t[1] + off[1], t[2] + off[2]]);
	}
	doc.getRoot().getAsset().generator = 'theprototype nature-kit build/finalize.mjs (kitbash of Meshy.ai items)';
	await io.write(out, doc);
}

function sizeOf(doc) {
	const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
	const b = getBounds(scene);
	return [0, 1, 2].map((i) => +(b.max[i] - b.min[i]).toFixed(3));
}
function trisOf(doc) {
	// instanced meshes count once per node that draws them
	let n = 0;
	for (const node of doc.getRoot().listNodes()) {
		const m = node.getMesh();
		if (!m) continue;
		n += m.listPrimitives().reduce((s, p) => s + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0);
	}
	return Math.round(n);
}

const report = [];
for (const it of spec.items) {
	if (only && !only.includes(it.name)) continue;
	const out = glbOf(it.name);
	fs.mkdirSync(path.dirname(out), { recursive: true });
	if (it.kind === 'meshy') {
		let src = stagingRaw(it.job, it.stage ?? 'refine');
		let dropped = 0;
		if (it.cutBase) ({ out: src, dropped } = await cutBase(src, it.cutBase, TMP));
		await postProcess(src, out, it.post ?? {});
		if (!it.keepEmissive) await dropEmissive(out);
		if (it.grade) await grade(out, it.grade);
		if (dropped) it._cut = dropped;
	} else if (it.kind === 'kitbash') {
		await kitbash(it.parts, out, it.pivot);
	} else if (it.kind === 'proc') {
		execFileSync(process.execPath, [path.join(HERE, it.script), out, ...(it.args ?? [])], { stdio: 'pipe' });
	}
	const doc = await io.read(out);
	const r = { name: it.name, kind: it.kind, tris: trisOf(doc), size: sizeOf(doc), kb: Math.round(fs.statSync(out).size / 1024), textures: doc.getRoot().listTextures().map((t) => t.getSize()?.join('×')).join(','), cut: it._cut };
	report.push(r);
	console.log(JSON.stringify(r));
	if (!noThumbs) execFileSync(process.execPath, [path.join(HERE, 'render.mjs'), 'thumb', out, path.join(PACK, it.name, 'thumb.webp'), '--size', '512', '--yaw', String(it.yaw ?? 35)], { stdio: 'pipe' });
}

// the model list the app reads (every item, in spec order — not just the rebuilt ones)
const list = spec.items.map((it) => ({ name: it.name, screenshot: 'thumb.webp', label: it.label, variants: { 'glTF-Binary': `${it.name}.glb` } }));
fs.writeFileSync(path.join(PACK, 'default.json'), JSON.stringify(list, null, 2) + '\n');
fs.rmSync(TMP, { recursive: true, force: true });
if (report.length) fs.writeFileSync(path.join(HERE, `last-report${only ? '-partial' : ''}.json`), JSON.stringify(report, null, 1) + '\n');
