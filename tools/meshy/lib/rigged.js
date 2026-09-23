// meshy-rigged: a rigged character + its clips → ONE game-ready skinned GLB.
//
// meshy-post cannot touch a rig: it bakes node transforms and joins meshes, which would
// tear the skin off its skeleton. A rig's scale and pivot are already set by the rigging
// task (`heightMeters`, feet on the origin), so this pass only:
//   - copies every clip file's animation(s) onto the base's skeleton, BY NODE NAME (Meshy's
//     walking/running/animation GLBs each carry their own copy of the same armature), and
//     names them (`walk`, `run`, `hit`, `death`, …) so a game can ask for them;
//   - welds and simplifies the skinned mesh to targetTris (vertex attributes — JOINTS_0 /
//     WEIGHTS_0 — ride along; only the index buffer changes);
//   - puts back the PBR maps rigging drops: the rigged mesh keeps the refine's UV atlas (same
//     base colour image, vertices reordered), so the refine's normal + metal-rough maps fit it
//     as they are (`pbrFrom`, refused when the base colours differ);
//   - drops the black emissive map, resizes textures to 1024² JPEG, prunes.
// Meshy's generator/extras are carried through (ToS §2.4); asset.extras.meshyRigged records ours.
import fs from 'node:fs';
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, dedup, prune, textureCompress, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { countTris } from './post.js';

/**
 * Copy `src`'s animation `anim` into `doc` as `name`, re-targeting by node name. Channels
 * whose node has no namesake in `doc` are dropped (and counted).
 * @param {import('@gltf-transform/core').Document} doc @param {any} anim @param {string} name
 */
export function copyAnimation(doc, anim, name) {
	const byName = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]));
	const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
	const out = doc.createAnimation(name);
	let kept = 0;
	let dropped = 0;
	/** @type {Map<any, any>} */
	const samplers = new Map();
	for (const ch of anim.listChannels()) {
		const node = byName.get(ch.getTargetNode()?.getName());
		const s = ch.getSampler();
		if (!node || !s) {
			dropped++;
			continue;
		}
		let copy = samplers.get(s);
		if (!copy) {
			const acc = (/** @type {any} */ a) =>
				doc.createAccessor().setType(a.getType()).setArray(a.getArray().slice()).setBuffer(buffer).setNormalized(a.getNormalized());
			copy = doc.createAnimationSampler().setInput(acc(s.getInput())).setOutput(acc(s.getOutput())).setInterpolation(s.getInterpolation());
			samplers.set(s, copy);
			out.addSampler(copy);
		}
		out.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(ch.getTargetPath()).setSampler(copy));
		kept++;
	}
	return { name, kept, dropped };
}

/** a tiny grey thumbnail of an image, to tell whether two textures are the same picture @param {Uint8Array} img */
async function fingerprint(img) {
	return sharp(Buffer.from(img)).resize(16, 16, { fit: 'fill' }).greyscale().raw().toBuffer();
}

/**
 * Copy `from`'s normal + metallic-roughness maps (and their factors) onto `doc`'s material of
 * the same base colour picture. Returns what was copied.
 * @param {import('@gltf-transform/core').Document} doc @param {import('@gltf-transform/core').Document} from
 */
export async function copyPbr(doc, from) {
	const src = from.getRoot().listMaterials().find((m) => m.getBaseColorTexture());
	const dst = doc.getRoot().listMaterials().find((m) => m.getBaseColorTexture());
	if (!src || !dst) throw new Error('pbrFrom: both files need a base colour texture');
	const a = await fingerprint(/** @type {Uint8Array} */ (src.getBaseColorTexture()?.getImage()));
	const b = await fingerprint(/** @type {Uint8Array} */ (dst.getBaseColorTexture()?.getImage()));
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
	if (diff / a.length > 6) throw new Error(`pbrFrom: the base colours differ (mean ${(diff / a.length).toFixed(1)}/255) — not the same UV atlas`);
	const copied = [];
	const tex = (/** @type {any} */ t) => doc.createTexture(t.getName()).setImage(t.getImage().slice()).setMimeType(t.getMimeType());
	const n = src.getNormalTexture();
	if (n) {
		dst.setNormalTexture(tex(n)).setNormalScale(src.getNormalScale());
		copied.push('normal');
	}
	const mr = src.getMetallicRoughnessTexture();
	if (mr) {
		dst.setMetallicRoughnessTexture(tex(mr)).setMetallicFactor(src.getMetallicFactor()).setRoughnessFactor(src.getRoughnessFactor());
		copied.push('metallicRoughness');
	}
	return copied;
}

/** seconds a clip lasts @param {any} anim */
const durationOf = (anim) => Math.max(0, ...anim.listSamplers().map((/** @type {any} */ s) => s.getInput()?.getMax([])[0] ?? 0));

/**
 * @param {{base: string, out: string, clips?: {file: string, name: string | string[]}[], keepBaseAnimations?: boolean, pbrFrom?: string,
 *   targetTris?: number, textureSize?: number, quality?: number, keepEmissive?: boolean}} o
 *   `clips[].name`: one name for the file's first animation, or one per animation in order
 */
export async function postRigged(o) {
	await MeshoptSimplifier.ready;
	const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
	const doc = await io.read(o.base);
	doc.setLogger(new Logger(Logger.Verbosity.WARN));
	const root = doc.getRoot();
	const bytesIn = fs.statSync(o.base).size;
	const trisIn = countTris(doc);
	if (!root.listSkins().length) throw new Error(`${o.base} has no skin — not a rigged character`);

	if (!o.keepBaseAnimations) for (const a of root.listAnimations()) a.dispose();
	const report = [];
	for (const clip of o.clips ?? []) {
		const src = await io.read(clip.file);
		const names = Array.isArray(clip.name) ? clip.name : [clip.name];
		const anims = src.getRoot().listAnimations();
		if (!anims.length) throw new Error(`${clip.file} has no animation`);
		names.forEach((name, i) => {
			if (!anims[i]) throw new Error(`${clip.file} has ${anims.length} animation(s), no #${i} for "${name}"`);
			report.push({ ...copyAnimation(doc, anims[i], name), from: clip.file, source: anims[i].getName(), seconds: +durationOf(anims[i]).toFixed(3) });
		});
	}

	const pbr = o.pbrFrom ? await copyPbr(doc, await io.read(o.pbrFrom)) : [];

	await doc.transform(dedup(), weld());
	if (o.targetTris && countTris(doc) > o.targetTris) {
		for (const error of [0.001, 0.005, 0.01, 0.02]) {
			const ratio = o.targetTris / countTris(doc);
			if (ratio >= 1) break;
			await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }));
			if (countTris(doc) <= o.targetTris * 1.05) break;
		}
	}

	let droppedEmissive = 0;
	for (const mat of root.listMaterials()) {
		const img = mat.getEmissiveTexture()?.getImage();
		if (!img || o.keepEmissive) continue;
		const { channels } = await sharp(Buffer.from(img)).stats();
		if (Math.max(...channels.slice(0, 3).map((c) => c.max)) < 24) {
			mat.setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
			droppedEmissive++;
		}
	}
	const size = o.textureSize ?? 1024;
	await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [size, size], quality: o.quality ?? 86 }), prune({ keepLeaves: true }), dedup());

	const asset = root.getAsset();
	asset.extras = { ...(/** @type {any} */ (asset.extras) ?? {}), meshyRigged: { tool: 'theprototype tools/meshy', trisIn, targetTris: o.targetTris ?? null, clips: report.map((r) => r.name) } };
	await io.write(o.out, doc);

	const out = await io.read(o.out);
	const scene = out.getRoot().getDefaultScene() ?? out.getRoot().listScenes()[0];
	const b = getBounds(scene);
	const result = {
		output: o.out,
		bytesIn,
		bytesOut: fs.statSync(o.out).size,
		trisIn,
		trisOut: countTris(out),
		joints: out.getRoot().listSkins()[0]?.listJoints().length ?? 0,
		size: [0, 1, 2].map((i) => +(b.max[i] - b.min[i]).toFixed(4)),
		animations: out.getRoot().listAnimations().map((a) => ({ name: a.getName(), channels: a.listChannels().length, seconds: +durationOf(a).toFixed(3) })),
		clips: report,
		pbr,
		textures: out.getRoot().listTextures().map((t) => ({ mime: t.getMimeType(), size: t.getSize() })),
		droppedEmissive
	};
	if (result.bytesOut > 5 * 1024 * 1024) throw Object.assign(new Error(`${o.out} is ${result.bytesOut} bytes — over the 5 MB share cap`), { report: result });
	return result;
}
