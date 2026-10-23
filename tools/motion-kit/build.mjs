// tools/motion-kit/build.mjs — the motion-kit clip pack (core roadmap 57 M5): Quaternius' Universal
// Animation Library 1 + 2, free STANDARD tiers (CC0 1.0), one humanoid `.tpanim` per clip.
//
//   node tools/motion-kit/build.mjs [--src <cache dir>] [--core <core checkout>]
//
// A `.tpanim` (core 57 M1) is a glTF holding ONLY a skeleton and ONE animation. A humanoid clip is
// valid VRM Animation inside (`VRMC_vrm_animation` names the human bones), so the same bytes renamed
// `.vrma` play in VRM tools, and both carry `extras.theprototype = {format: 1, kind: 'clip', skeleton:
// {sig, humanoid}, fps, frames, loop, rootMotion, provenance}`. Core retargets a humanoid clip onto any
// mapped humanoid (VRM avatars, the KayKit avatars, Mixamo / Meshy / UniRig rigs).
// The humanoid maps of the two rigs come from core's detector (`--core`, written to rigs.json); without
// `--core` the committed rigs.json is used. `_Loop` clips loop; `_RM` clips keep their root motion.
// Outputs: motion-kit/<lib>/<Clip>.tpanim, motion-kit/clips.json, motion-kit/licences.json.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { load, makeIO, REPO } from '../kit-build/lib/deps.mjs';
import { readGlb, writeGlb } from './glbjson.mjs';

const { prune } = await load('@gltf-transform/functions');

const args = process.argv.slice(2);
const opt = (/** @type {string} */ name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};
const SRC = opt('--src') || path.join(os.homedir(), '.cache/tp-characters-kit');
const CORE = opt('--core');
const OUT = path.join(REPO, 'motion-kit');
const RIGS = path.join(REPO, 'tools/motion-kit/rigs.json');

const LIBS = [
	{
		id: 'ual1',
		title: 'Universal Animation Library 1 (Standard)',
		zip: 'https://opengameart.org/sites/default/files/universal_animation_librarystandard.zip',
		sha256: '18ff1a7215f4852b320203e8aaf02a1578b5c8eef9027fbaedfcedc7b85a3ac2',
		entry: 'Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb'
	},
	{
		id: 'ual2',
		title: 'Universal Animation Library 2 (Standard)',
		zip: 'https://opengameart.org/sites/default/files/universal_animation_library_2standard.zip',
		sha256: 'ec0e40d6d78fe9aaad59e322f40865a8675c22f0745e291622e54520391a9217',
		entry: 'Universal Animation Library 2 [Standard]/Unreal-Godot/UAL2_Standard.glb'
	}
];
/** a reference pose, not a motion */
const SKIP = /^A_TPose$/;

const sha = (/** @type {Buffer | Uint8Array} */ b) => crypto.createHash('sha256').update(b).digest('hex');

async function fetchPinned(/** @type {string} */ url, /** @type {string} */ want) {
	fs.mkdirSync(SRC, { recursive: true });
	const file = path.join(SRC, path.basename(new URL(url).pathname));
	if (!fs.existsSync(file) || sha(fs.readFileSync(file)) !== want) {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
		fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
	}
	if (sha(fs.readFileSync(file)) !== want) throw new Error(`${file}: not the pinned sha256`);
	const unpacked = file.replace(/\.zip$/, '');
	if (!fs.existsSync(unpacked)) execFileSync('unzip', ['-o', '-q', file, '-d', unpacked]);
	return unpacked;
}

/** the skin joints + their ancestors, by name, with parent links (core's detector input) @param {any} json */
function boneList(json) {
	const joints = new Set((json.skins ?? []).flatMap((/** @type {any} */ s) => s.joints));
	const parent = new Map();
	json.nodes.forEach((/** @type {any} */ n, /** @type {number} */ i) => (n.children ?? []).forEach((/** @type {number} */ c) => parent.set(c, i)));
	const idx = [...joints];
	const at = new Map(idx.map((n, k) => [n, k]));
	return idx.map((n) => {
		let p = parent.get(n);
		while (p !== undefined && !at.has(p)) p = parent.get(p);
		return { name: json.nodes[n].name, parent: p === undefined ? -1 : at.get(p) };
	});
}

/** core's skeletonSignature over node rows in depth-first order @param {any} json */
function skeletonSig(json) {
	const parent = new Map();
	json.nodes.forEach((/** @type {any} */ n, /** @type {number} */ i) => (n.children ?? []).forEach((/** @type {number} */ c) => parent.set(c, i)));
	/** @type {number[]} */
	const order = [];
	const walk = (/** @type {number} */ i) => {
		order.push(i);
		for (const c of json.nodes[i].children ?? []) walk(c);
	};
	for (const r of json.scenes?.[json.scene ?? 0]?.nodes ?? []) walk(r);
	const text = order.map((i) => json.nodes[i].name + '>' + (parent.has(i) ? json.nodes[parent.get(i)].name : '')).join('|');
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, '0');
}

/** @type {Record<string, Record<string, string>>} */
let rigs = fs.existsSync(RIGS) ? JSON.parse(fs.readFileSync(RIGS, 'utf8')).rigs ?? {} : {};
const detect = CORE ? (await import(pathToFileURL(path.resolve(CORE, 'src/lib/humanoid/humanoidMap.js')).href)).detectHumanoidMap : null;

const io = makeIO();
/** @type {any[]} */
const clips = [];
/** @type {Record<string, any>} */
const licences = {};
const date = '2026-10-23T00:00:00Z';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const lib of LIBS) {
	const dir = await fetchPinned(lib.zip, lib.sha256);
	const src = fs.readFileSync(path.join(dir, lib.entry));
	const srcJson = readGlb(src).json;
	if (detect) {
		const m = detect(boneList(srcJson));
		if (!m.ok) throw new Error(`${lib.id}: not a full humanoid (missing ${m.missing.join(', ')})`);
		rigs[lib.id] = m.map;
	}
	const map = rigs[lib.id];
	if (!map) throw new Error(`${lib.id}: no humanoid map — run once with --core <core checkout>`);
	const names = (srcJson.animations ?? []).map((/** @type {any} */ a) => a.name);
	fs.mkdirSync(path.join(OUT, lib.id), { recursive: true });
	for (const name of names) {
		if (SKIP.test(name)) continue;
		const doc = await io.readBinary(new Uint8Array(src));
		const root = doc.getRoot();
		for (const a of root.listAnimations()) {
			if (a.getName() === name) continue;
			// samplers + channels go; their accessors are left to prune (clips SHARE time accessors, so
			// disposing one here would cut the kept clip's input)
			for (const s of a.listSamplers()) s.dispose();
			for (const c of a.listChannels()) c.dispose();
			a.dispose();
		}
		// only the skeleton stays: meshes, skins, materials, textures go
		for (const n of root.listNodes()) {
			if (n.getMesh()) n.setMesh(null);
			if (n.getSkin()) n.setSkin(null);
		}
		for (const s of root.listSkins()) s.dispose();
		for (const m of root.listMeshes()) m.dispose();
		await doc.transform(prune({ keepLeaves: true }));
		const anim = root.listAnimations()[0];
		const input = anim.listSamplers()[0]?.getInput();
		const times = input ? input.getArray() : new Float32Array([0]);
		const duration = Math.max(...anim.listSamplers().map((s) => { const a = s.getInput()?.getArray(); return a ? a[a.length - 1] : 0; }));
		const dt = times.length > 1 ? times[1] - times[0] : 1 / 30;
		const fps = Math.max(1, Math.round(1 / dt));
		const glb = readGlb(await io.writeBinary(doc));
		const json = glb.json;
		// drop mesh-only nodes the prune kept as leaves (the source's mesh holder)
		const at = new Map(json.nodes.map((/** @type {any} */ n, /** @type {number} */ i) => [n.name, i]));
		/** @type {Record<string, {node: number}>} */
		const humanBones = {};
		for (const [bone, node] of Object.entries(map)) if (at.has(node)) humanBones[bone] = { node: at.get(node) };
		const meta = {
			format: 1,
			kind: 'clip',
			skeleton: { sig: skeletonSig(json), humanoid: true },
			fps,
			frames: Math.max(1, Math.round(duration * fps) + 1),
			loop: /_Loop$/.test(name),
			rootMotion: /_RM$/.test(name),
			provenance: [
				{ tool: 'import', model: 'Quaternius ' + lib.title, licence: { id: 'CC0-1.0', author: 'Quaternius', url: 'https://quaternius.com' }, date, source: lib.zip },
				{ tool: 'convert', model: 'tools/motion-kit', date, source: name }
			]
		};
		json.asset = { ...(json.asset ?? {}), version: '2.0', generator: 'theprototype motion-kit' };
		json.extras = { ...(json.extras ?? {}), theprototype: meta };
		json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'VRMC_vrm_animation'])];
		json.extensions = { ...(json.extensions ?? {}), VRMC_vrm_animation: { specVersion: '1.0', humanoid: { humanBones } } };
		if (json.animations?.[0]) json.animations[0].extras = { theprototype: meta };
		const out = writeGlb(json, glb.bin);
		const rel = `${lib.id}/${name}.tpanim`;
		fs.writeFileSync(path.join(OUT, rel), out);
		clips.push({ name, file: rel, lib: lib.id, duration: +duration.toFixed(4), fps, frames: meta.frames, loop: meta.loop, rootMotion: meta.rootMotion, humanoid: true, bytes: out.byteLength });
		licences[rel] = { licence: 'CC0-1.0', author: 'Quaternius', title: `${name} (${lib.title})`, source: lib.zip, url: 'https://quaternius.com', sha256: sha(out) };
	}
}
fs.writeFileSync(path.join(OUT, 'clips.json'), JSON.stringify(clips, null, '\t') + '\n');
fs.writeFileSync(path.join(OUT, 'licences.json'), JSON.stringify(licences, null, '\t') + '\n');
fs.writeFileSync(RIGS, JSON.stringify({ note: "humanoid maps (VRM 1.0 bone -> node name) of the source rigs, from core's detector (humanoid/humanoidMap.js)", rigs }, null, '\t') + '\n');
const total = clips.reduce((n, c) => n + c.bytes, 0);
console.log(`motion-kit: ${clips.length} clips, ${(total / 1048576).toFixed(1)} MiB`);
