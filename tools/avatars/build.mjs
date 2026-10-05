// tools/avatars/build.mjs — the avatar characters (roadmap 36, plan 76) from KayKit's CC0 character packs.
//
//   node tools/avatars/build.mjs [--src <dir>] [--core <core checkout>]
//
// Sources: KayKit Adventurers 1.0 + Skeletons 1.0 (Kay Lousberg, CC0), fetched at PINNED commits into
// ~/.cache/tp-avatars (or --src). Every character shares one 41-joint rig, so ONE clip file animates all.
//
// Per character (the 36-avatars budget: ≤ 10k tris, 1 material, ≤ 2 draw calls with the head/hat):
//  - weapons/props on the hand slots are dropped;
//  - rigid headgear and capes (children of `head` / `chest`) are BAKED into the skin, weighted 100% to the
//    bone they hang from, so they bend with it and cost no extra draw;
//  - every part is merged into ONE skinned primitive on ONE material (the skeletons' second "Glow" material
//    only colours the eyes, whose UVs already sit on the atlas's yellow cell — they join the main one);
//  - the 1024² gradient atlas → 256² (8×4 cells of vertical gradients: nothing is lost, 16× less GPU memory);
//  - no animations (clips.glb carries them once).
//
// Outputs:
//  - avatars/<Id>/<id>.glb         the Explorer pack row: the merged mesh WITH the clips (a placeable,
//                                  animated character; behavior loop Idle)
//  - avatars/_runtime/<id>.glb     mesh only — what core ships in static/avatars/
//  - avatars/_runtime/clips.glb    the rig + the locomotion/emote clips, deform-bone channels only
//  - avatars/_runtime/avatars.json the catalog core reads (tris, height, eye height, outfit cells)
//  --core <dir> also copies _runtime/* into <dir>/static/avatars/.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { load, makeIO, REPO } from '../kit-build/lib/deps.mjs';

const { Document } = await load('@gltf-transform/core');
const { prune, dedup } = await load('@gltf-transform/functions');
const THREE = await load('three');
const sharp = (await load('sharp')).default;

const args = process.argv.slice(2);
const opt = (name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};
const SRC = opt('--src') || path.join(os.homedir(), '.cache/tp-avatars');
const CORE = opt('--core');
const OUT = path.join(REPO, 'avatars');
const RUNTIME = path.join(OUT, '_runtime');

const PACKS = {
	adventurers: {
		repo: 'KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0',
		sha: '672074b73ba276876a19e8816ecdc5241817ab47',
		dir: 'addons/kaykit_character_pack_adventures/Characters/gltf'
	},
	skeletons: {
		repo: 'KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0',
		sha: '15b62b9bad122f72926c10fb14d622c73819fa54',
		dir: 'addons/kaykit_character_pack_skeletons/Characters/gltf'
	}
};

// id, display name, source pack + file. ORDER = the picker's order.
export const CHARACTERS = [
	{ id: 'knight', name: 'Knight', pack: 'adventurers', file: 'Knight.glb' },
	{ id: 'mage', name: 'Mage', pack: 'adventurers', file: 'Mage.glb' },
	{ id: 'rogue', name: 'Rogue', pack: 'adventurers', file: 'Rogue.glb' },
	{ id: 'rogue-hooded', name: 'Hooded rogue', pack: 'adventurers', file: 'Rogue_Hooded.glb' },
	{ id: 'barbarian', name: 'Barbarian', pack: 'adventurers', file: 'Barbarian.glb' },
	{ id: 'skeleton-minion', name: 'Skeleton', pack: 'skeletons', file: 'Skeleton_Minion.glb' },
	{ id: 'skeleton-warrior', name: 'Skeleton warrior', pack: 'skeletons', file: 'Skeleton_Warrior.glb' },
	{ id: 'skeleton-mage', name: 'Skeleton mage', pack: 'skeletons', file: 'Skeleton_Mage.glb' },
	{ id: 'skeleton-rogue', name: 'Skeleton rogue', pack: 'skeletons', file: 'Skeleton_Rogue.glb' }
];

// what the avatar runtime plays (locomotion blend + a few emotes); everything else stays in the source packs
export const CLIPS = [
	'Idle',
	'Walking_A',
	'Walking_Backwards',
	'Running_A',
	'Running_Strafe_Left',
	'Running_Strafe_Right',
	'Jump_Idle',
	'Cheer',
	'Interact',
	'Sit_Floor_Idle'
];

// bones the skin actually deforms with — the clip channels on the IK/control helpers are dropped
const DEFORM = new Set([
	'root', 'hips', 'spine', 'chest', 'head',
	'upperarm.l', 'lowerarm.l', 'wrist.l', 'hand.l', 'upperarm.r', 'lowerarm.r', 'wrist.r', 'hand.r',
	'upperleg.l', 'lowerleg.l', 'foot.l', 'toes.l', 'upperleg.r', 'lowerleg.r', 'foot.r', 'toes.r'
]);
// rigid parts kept (baked into the skin) when they hang from one of these; the rest (hand slots) are props
const KEEP_RIGID_UNDER = new Set(['head', 'chest']);
const ATLAS = 256;
const GRID = { cols: 8, rows: 4 }; // the KayKit gradient atlas layout

function fetchSources() {
	for (const c of CHARACTERS) {
		const p = PACKS[c.pack];
		const dir = path.join(SRC, c.pack);
		fs.mkdirSync(dir, { recursive: true });
		const files = [c.file];
		for (const f of files) {
			const dest = path.join(dir, f);
			if (fs.existsSync(dest)) continue;
			const url = `https://raw.githubusercontent.com/${p.repo}/${p.sha}/${p.dir}/${f}`;
			console.error('fetch ' + url);
			execFileSync('curl', ['-sSfL', '-o', dest, url]);
		}
	}
}

/** world matrix of a gltf-transform node at its rest TRS @param {any} node */
function worldOf(node) {
	const m = new THREE.Matrix4().fromArray(node.getMatrix());
	let p = node.getParentNode();
	while (p) {
		m.premultiply(new THREE.Matrix4().fromArray(p.getMatrix()));
		p = p.getParentNode();
	}
	return m;
}

/** names of a node's ancestors (nearest first) @param {any} node */
function ancestors(node) {
	const out = [];
	for (let p = node.getParentNode(); p; p = p.getParentNode()) out.push(p);
	return out;
}

/** dispose a sampler AND its accessors: a disposed animation's samplers keep their accessors alive, and
 * prune then keeps the bytes (gltf-transform counts the orphan sampler as a parent) @param {any} s */
function disposeSampler(s) {
	if (!s) return;
	for (const a of [s.getInput(), s.getOutput()]) if (a && a.listParents().every((p) => p === s || p.propertyType === 'Root')) a.dispose();
	s.dispose();
}
/** @param {any} anim */
function disposeAnimation(anim) {
	for (const ch of anim.listChannels()) ch.dispose();
	for (const s of anim.listSamplers()) disposeSampler(s);
	anim.dispose();
}

/** read an accessor into a plain array of tuples @param {any} acc */
function tuples(acc) {
	const n = acc.getCount();
	const out = [];
	for (let i = 0; i < n; i++) out.push(acc.getElement(i, []));
	return out;
}

/**
 * Merge every kept part of one character into a single skinned primitive.
 * @returns {{doc: any, tris: number, cellsByPart: Record<string, Record<number, number>>}}
 */
async function buildCharacter(file) {
	const io = makeIO();
	const doc = await io.read(file);
	const root = doc.getRoot();
	const skin = root.listSkins()[0];
	const joints = skin.listJoints();
	const jointIndex = new Map(joints.map((j, i) => [j, i]));
	const ibm = tuples(skin.getInverseBindMatrices()).map((a) => new THREE.Matrix4().fromArray(a));
	const material = root.listMaterials().find((m) => m.getBaseColorTexture()) ?? root.listMaterials()[0];

	const pos = [], nrm = [], uv = [], jnt = [], wgt = [], idx = [];
	/** @type {Record<string, Record<number, number>>} */
	const cellsByPart = {};
	const dropped = [];
	const meshNodes = root.listNodes().filter((n) => n.getMesh());
	for (const node of meshNodes) {
		const skinned = !!node.getSkin();
		const anc = ancestors(node);
		const bone = skinned ? null : anc.find((a) => jointIndex.has(a));
		if (!skinned && (!bone || !KEEP_RIGID_UNDER.has(bone.getName()))) {
			dropped.push(node.getName());
			continue;
		}
		// rigid: mesh space -> model (bind) space = inverse(IBM[bone]) * inverse(boneWorld) * meshWorld
		let toModel = null;
		if (!skinned) {
			const bi = jointIndex.get(bone);
			const bindWorld = ibm[bi].clone().invert();
			const rel = worldOf(bone).invert().multiply(worldOf(node));
			toModel = bindWorld.multiply(rel);
		}
		const normalMat = toModel ? new THREE.Matrix3().getNormalMatrix(toModel) : null;
		const part = node.getName();
		const cells = (cellsByPart[part] = {});
		for (const prim of node.getMesh().listPrimitives()) {
			const base = pos.length;
			const P = tuples(prim.getAttribute('POSITION'));
			const N = prim.getAttribute('NORMAL') ? tuples(prim.getAttribute('NORMAL')) : P.map(() => [0, 1, 0]);
			const T = prim.getAttribute('TEXCOORD_0') ? tuples(prim.getAttribute('TEXCOORD_0')) : P.map(() => [0.5, 0.5]);
			const J = skinned ? tuples(prim.getAttribute('JOINTS_0')) : null;
			const W = skinned ? tuples(prim.getAttribute('WEIGHTS_0')) : null;
			// a skinned part's JOINTS_0 indexes ITS skin; all parts share the one skin (asserted)
			if (skinned && node.getSkin() !== skin) throw new Error(`${part}: a second skin`);
			const v = new THREE.Vector3();
			for (let i = 0; i < P.length; i++) {
				v.fromArray(P[i]);
				if (toModel) v.applyMatrix4(toModel);
				pos.push([v.x, v.y, v.z]);
				v.fromArray(N[i]);
				if (normalMat) v.applyMatrix3(normalMat).normalize();
				nrm.push([v.x, v.y, v.z]);
				uv.push(T[i]);
				if (skinned) {
					const w = W[i];
					const s = w[0] + w[1] + w[2] + w[3] || 1;
					jnt.push(J[i]);
					wgt.push(w.map((x) => x / s));
				} else {
					jnt.push([jointIndex.get(bone), 0, 0, 0]);
					wgt.push([1, 0, 0, 0]);
				}
				const cu = Math.min(GRID.cols - 1, Math.max(0, Math.floor(T[i][0] * GRID.cols)));
				const cv = Math.min(GRID.rows - 1, Math.max(0, Math.floor(T[i][1] * GRID.rows)));
				const cell = cv * GRID.cols + cu;
				cells[cell] = (cells[cell] ?? 0) + 1;
			}
			const I = prim.getIndices() ? Array.from(prim.getIndices().getArray()) : P.map((_, i) => i);
			for (const i of I) idx.push(base + i);
		}
	}

	// the new single mesh
	const buffer = root.listBuffers()[0];
	const flat = (rows, Type) => Type.from(rows.flat());
	const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', acc('VEC3', flat(pos, Float32Array)))
		.setAttribute('NORMAL', acc('VEC3', flat(nrm, Float32Array)))
		.setAttribute('TEXCOORD_0', acc('VEC2', flat(uv, Float32Array)))
		.setAttribute('JOINTS_0', acc('VEC4', flat(jnt, Uint16Array)))
		.setAttribute('WEIGHTS_0', acc('VEC4', flat(wgt, Float32Array)))
		.setIndices(acc('SCALAR', pos.length > 65535 ? Uint32Array.from(idx) : Uint16Array.from(idx)))
		.setMaterial(material);
	const mesh = doc.createMesh('Avatar').addPrimitive(prim);
	const rig = root.listScenes()[0].listChildren()[0];
	const avatarNode = doc.createNode('Avatar').setMesh(mesh).setSkin(skin);
	rig.addChild(avatarNode);
	for (const node of meshNodes) {
		const m = node.getMesh();
		node.dispose();
		if (m && !m.listParents().some((p) => p.propertyType === "Node")) for (const p of m.listPrimitives()) { for (const a of [...p.listAttributes(), p.getIndices()]) a?.dispose(); p.dispose(); }
	}
	for (const m of root.listMaterials()) if (m !== material) m.dispose();
	material.setName('avatar');
	for (const a of root.listAnimations()) disposeAnimation(a);

	// atlas → 256² PNG
	const tex = material.getBaseColorTexture();
	if (tex) {
		const small = await sharp(Buffer.from(tex.getImage())).resize(ATLAS, ATLAS, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
		tex.setImage(new Uint8Array(small)).setMimeType('image/png');
	}
	await doc.transform(prune(), dedup());
	return { doc, tris: idx.length / 3, cellsByPart, dropped, bounds: boundsOf(pos), headY: worldOf(joints.find((j) => j.getName() === 'head')).elements[13] };
}

function boundsOf(pos) {
	const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
	for (const p of pos) for (let k = 0; k < 3; k++) {
		min[k] = Math.min(min[k], p[k]);
		max[k] = Math.max(max[k], p[k]);
	}
	return { min, max };
}

/** the clip file: the first character's rig + the chosen clips, deform channels only */
async function buildClips(file) {
	const io = makeIO();
	const doc = await io.read(file);
	const root = doc.getRoot();
	for (const n of root.listNodes()) if (n.getMesh()) n.dispose();
	for (const s of root.listSkins()) s.dispose();
	const kept = [];
	for (const a of root.listAnimations()) {
		if (!CLIPS.includes(a.getName())) {
			disposeAnimation(a);
			continue;
		}
		for (const ch of a.listChannels()) {
			const t = ch.getTargetNode();
			if (!t || !DEFORM.has(t.getName()) || ch.getTargetPath() === 'scale') {
				const s = ch.getSampler();
				ch.dispose();
				if (s && !s.listParents().some((p) => p.propertyType === 'AnimationChannel')) disposeSampler(s);
			}
		}
		kept.push(a.getName());
	}
	const missing = CLIPS.filter((c) => !kept.includes(c));
	if (missing.length) throw new Error('clips missing: ' + missing.join(', '));
	await doc.transform(prune({ keepLeaves: true }), dedup());
	return doc;
}

/** the character with the clips merged in (the Explorer pack's animated model) */
async function withClips(charDoc, clipFile) {
	const io = makeIO();
	// round-trip through bytes so the two documents never share property instances
	const doc = await io.readBinary(await io.writeBinary(charDoc));
	const clips = await buildClips(clipFile);
	const byName = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]));
	const buffer = doc.getRoot().listBuffers()[0];
	for (const a of clips.getRoot().listAnimations()) {
		const anim = doc.createAnimation(a.getName());
		for (const ch of a.listChannels()) {
			const target = byName.get(ch.getTargetNode().getName());
			if (!target) continue;
			const s = ch.getSampler();
			const copy = (accessor) => doc.createAccessor().setType(accessor.getType()).setArray(accessor.getArray().slice()).setBuffer(buffer);
			const sampler = doc.createAnimationSampler().setInput(copy(s.getInput())).setOutput(copy(s.getOutput())).setInterpolation(s.getInterpolation());
			anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(ch.getTargetPath()).setSampler(sampler));
		}
	}
	await doc.transform(dedup());
	return doc;
}

async function main() {
	fetchSources();
	fs.mkdirSync(RUNTIME, { recursive: true });
	const io = makeIO();
	const catalog = [];
	const clipSrc = path.join(SRC, 'adventurers', 'Knight.glb');
	for (const c of CHARACTERS) {
		const file = path.join(SRC, c.pack, c.file);
		const built = await buildCharacter(file);
		const { doc, tris, cellsByPart, dropped, bounds, headY } = built;
		const runtimeFile = path.join(RUNTIME, c.id + '.glb');
		await io.write(runtimeFile, doc);
		const folder = c.name.replace(/[^A-Za-z0-9]+/g, '');
		fs.mkdirSync(path.join(OUT, folder), { recursive: true });
		await io.write(path.join(OUT, folder, c.id + '.glb'), await withClips(doc, clipSrc));
		// the outfit = the atlas cells the body/arms/legs/cape use most that the HEAD part does not
		// (the head carries skin + face, which an outfit colour must never repaint)
		const sum = (re) => {
			/** @type {Record<number, number>} */
			const t = {};
			for (const [part, cells] of Object.entries(cellsByPart)) if (re.test(part)) for (const [k, n] of Object.entries(cells)) t[+k] = (t[+k] ?? 0) + n;
			return t;
		};
		const head = sum(/Head|Eyes|Jaw/);
		const outfit = sum(/Body|Arm|Leg|Cape|Cloak/);
		const outfitCells = Object.entries(outfit)
			.filter(([k]) => !head[+k])
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3)
			.map(([k]) => +k);
		const height = bounds.max[1];
		catalog.push({
			id: c.id,
			name: c.name,
			file: c.id + '.glb',
			source: PACKS[c.pack].repo,
			tris,
			height: +height.toFixed(3),
			headBoneY: +headY.toFixed(3),
			outfitCells
		});
		console.error(`${c.id}: ${tris} tris, ${(fs.statSync(runtimeFile).size / 1024).toFixed(0)} KiB, height ${height.toFixed(2)}, dropped ${dropped.join(',') || '-'}, outfit cells ${outfitCells}`);
	}
	const clips = await buildClips(clipSrc);
	await io.write(path.join(RUNTIME, 'clips.glb'), clips);
	fs.writeFileSync(path.join(RUNTIME, 'avatars.json'), JSON.stringify({ version: 1, atlasGrid: GRID, clips: CLIPS, characters: catalog }, null, '\t') + '\n');
	console.error(`clips.glb: ${(fs.statSync(path.join(RUNTIME, 'clips.glb')).size / 1024).toFixed(0)} KiB`);
	if (CORE) {
		const dest = path.join(CORE, 'static/avatars');
		fs.mkdirSync(dest, { recursive: true });
		for (const f of fs.readdirSync(RUNTIME)) fs.copyFileSync(path.join(RUNTIME, f), path.join(dest, f));
		console.error('copied to ' + dest);
	}
}

await main();
