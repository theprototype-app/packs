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

const TOOL = process.env.MESHY_TOOL || '/home/deck/.code/theprototype-app/packs-lane-30c-tools/tools/meshy';
const STAGING = process.env.MESHY_STAGING || path.join(os.homedir(), '.code/lanes-30/meshy/staging/30c-pack-nature');
const require = createRequire(path.join(TOOL, 'package.json'));
const sharp = require('sharp');
const { NodeIO, Document } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { flatten, clearNodeTransform, compactPrimitive, getBounds, mergeDocuments, unpartition, dedup, prune } = require('@gltf-transform/functions');
const { postProcess } = await import(pathToFileURL(path.join(TOOL, 'lib/post.js')).href);

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

/** Bake node transforms, then drop every triangle lying entirely below `frac` of the height
 * (Meshy likes to stand plants on a flat round "base" disc — on real terrain that reads as a
 * coaster). Returns the path of a cut copy. */
async function cutBase(input, frac) {
	const doc = await io.read(input);
	await doc.transform(flatten());
	for (const node of doc.getRoot().listNodes()) if (node.getMesh()) clearNodeTransform(node);
	const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
	const b = getBounds(scene);
	const cut = b.min[1] + frac * (b.max[1] - b.min[1]);
	let dropped = 0;
	for (const mesh of doc.getRoot().listMeshes()) {
		for (const prim of mesh.listPrimitives()) {
			const pos = prim.getAttribute('POSITION');
			const idx = prim.getIndices();
			const n = idx ? idx.getCount() : pos.getCount();
			const get = (i) => (idx ? idx.getScalar(i) : i);
			const keep = [];
			for (let t = 0; t < n; t += 3) {
				const a = get(t), c = get(t + 1), d = get(t + 2);
				const ymax = Math.max(pos.getElement(a, [])[1], pos.getElement(c, [])[1], pos.getElement(d, [])[1]);
				if (ymax < cut) dropped++;
				else keep.push(a, c, d);
			}
			const arr = pos.getCount() > 65535 ? new Uint32Array(keep) : new Uint16Array(keep);
			const acc = doc.createAccessor().setType('SCALAR').setArray(arr).setBuffer(pos.getBuffer());
			prim.setIndices(acc);
			compactPrimitive(prim);
		}
	}
	await doc.transform(prune());
	const out = path.join(TMP, `cut-${path.basename(path.dirname(path.dirname(input)))}-${Math.random().toString(36).slice(2, 7)}.glb`);
	await io.write(out, doc);
	return { out, dropped };
}

const rgb2hsv = (r, g, b) => {
	const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
	let h = 0;
	if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
};
const hsv2rgb = (h, s, v) => {
	const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
	const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
	return [r + m, g + m, b + m];
};
const inRange = (h, [a, b]) => (a <= b ? h >= a && h <= b : h >= a || h <= b);

/** Colour grade the base-colour textures: each rule moves pixels whose hue is in `hue`
 * (degrees, wraps) by `shift` degrees / scales saturation `sat` and value `val`, feathered
 * at the range edges so there is no hard seam. The 0-credit alternative to a retexture. */
async function grade(file, rules) {
	const doc = await io.read(file);
	for (const mat of doc.getRoot().listMaterials()) {
		const tex = mat.getBaseColorTexture();
		if (!tex) continue;
		const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
		for (let i = 0; i < data.length; i += 3) {
			let [h, s, v] = rgb2hsv(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
			let tint = null;
			for (const r of rules) {
				if (s < (r.minSat ?? 0.12) || !inRange(h, r.hue)) continue;
				if (r.maxSat != null && s > r.maxSat) continue;
				if ((r.minVal != null && v < r.minVal) || (r.maxVal != null && v > r.maxVal)) continue;
				const [a, b] = r.hue;
				const span = (b - a + 360) % 360 || 360;
				const t = ((h - a + 360) % 360) / span; // 0..1 across the range
				const w = r.feather === false ? 1 : Math.min(1, Math.min(t, 1 - t) / 0.15); // feather the outer 15%
				h = (h + (r.shift ?? 0) * w + 360) % 360;
				s = Math.min(1, s * (1 + ((r.sat ?? 1) - 1) * w));
				v = Math.min(1, v * (1 + ((r.val ?? 1) - 1) * w));
				if (r.tint) tint = [r.tint, (r.amount ?? 0.3) * w, v];
				break;
			}
			let [R, G, B] = hsv2rgb(h, s, v);
			if (tint) {
				// multiply-style tint: keep the painted value, pull the colour toward the tint
				const [hex, k, vv] = tint;
				const c = [1, 3, 5].map((j) => parseInt(hex.slice(j, j + 2), 16) / 255);
				const cmax = Math.max(...c);
				[R, G, B] = [R, G, B].map((x, j) => x * (1 - k) + (c[j] / cmax) * vv * k);
			}
			data[i] = R * 255; data[i + 1] = G * 255; data[i + 2] = B * 255;
		}
		const jpg = await sharp(data, { raw: info }).jpeg({ quality: 86 }).toBuffer();
		tex.setImage(new Uint8Array(jpg)).setMimeType('image/jpeg');
	}
	await io.write(file, doc);
}

/** Meshy-6 refines sometimes paint a NON-black emissive map (the oak's canopy: mean 33-47 of
 * 255), which makes foliage glow at night and wash out by day. Nothing in a nature kit emits
 * light, so the map and factor go (meshy-post only drops a fully black one). */
async function dropEmissive(file) {
	const doc = await io.read(file);
	let n = 0;
	for (const mat of doc.getRoot().listMaterials()) {
		if (mat.getEmissiveTexture() || mat.getEmissiveFactor().some((v) => v > 0)) n++;
		mat.setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
	}
	await doc.transform(prune());
	await io.write(file, doc);
	return n;
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
		if (it.cutBase) ({ out: src, dropped } = await cutBase(src, it.cutBase));
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
