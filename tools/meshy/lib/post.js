// meshy-post: Meshy's raw GLB → a pack-ready GLB. Nothing raw is ever shipped.
//
//   bake every node transform into the vertices (the GLB ends up with identity nodes,
//   so its ORIGIN is the pivot the app places on the grid) → optional rotateY →
//   weld → simplify to targetTris (meshoptimizer) → join → normalize scale to `dims`
//   → apply the pivot rule → textures resized to 1024² (2048² with hero) as JPEG →
//   dedup/prune. Geometry is NOT meshopt/draco compressed: core's Explorer thumbnail /
//   preview parse and the scene-sync receiver use a bare GLTFLoader with no decoders
//   (explorer.js parseObjectFile, commandsHandler), so a compressed GLB would load on
//   placement but fail everywhere else. JPEG (core glTF, no extension) survives the
//   GLTFExporter round-trip the scene sync does; webp would need EXT_texture_webp there.
//
// Meshy's ToS §2.4 forbids stripping AI-generation metadata: asset.generator /
// asset.extras are carried through untouched, and asset.extras.meshyPost records ours.
import fs from 'node:fs';
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, join, dedup, prune, flatten, clearNodeTransform, transformMesh, textureCompress, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

export const PIVOTS = ['bottom-center', 'bottom-back-left', 'bottom-center-back', 'center', 'none'];

/** @param {import('@gltf-transform/core').Document} doc */
export function countTris(doc) {
	let n = 0;
	for (const mesh of doc.getRoot().listMeshes()) {
		for (const p of mesh.listPrimitives()) {
			const idx = p.getIndices();
			const pos = p.getAttribute('POSITION');
			if (p.getMode() !== 4) continue; // TRIANGLES only
			n += (idx ? idx.getCount() : (pos?.getCount() ?? 0)) / 3;
		}
	}
	return Math.round(n);
}

/**
 * The uniform/non-uniform scale that takes a bbox `size` to `dims`.
 * contain: one uniform factor, the smallest over the given axes (fits inside the box)
 * stretch: each given axis exactly; missing axes take the mean of the given factors
 * @param {[number, number, number]} size @param {{x?: number, y?: number, z?: number} | undefined} dims @param {'contain'|'stretch'} fit
 * @returns {[number, number, number]}
 */
export function scaleFor(size, dims, fit = 'contain') {
	if (!dims) return [1, 1, 1];
	const axes = /** @type {const} */ (['x', 'y', 'z']);
	/** @type {(number|null)[]} */
	const f = axes.map((a, i) => (dims[a] ? dims[a] / Math.max(size[i], 1e-9) : null));
	const given = /** @type {number[]} */ (f.filter((v) => v != null));
	if (!given.length) return [1, 1, 1];
	if (fit === 'stretch') {
		const mean = given.reduce((a, b) => a + b, 0) / given.length;
		return /** @type {[number, number, number]} */ (f.map((v) => v ?? mean));
	}
	const u = Math.min(...given);
	return [u, u, u];
}

/**
 * Offset that moves the (already scaled) bbox so the pivot lands on the origin.
 * +Y up, +Z front (three.js / glTF): "back" = min Z, "left" = min X.
 * @param {{min: number[], max: number[]}} b @param {string} pivot @returns {[number, number, number]}
 */
export function pivotOffset(b, pivot = 'bottom-center') {
	const cx = (b.min[0] + b.max[0]) / 2;
	const cy = (b.min[1] + b.max[1]) / 2;
	const cz = (b.min[2] + b.max[2]) / 2;
	switch (pivot) {
		case 'bottom-center':
			return [-cx, -b.min[1], -cz];
		case 'bottom-back-left':
			return [-b.min[0], -b.min[1], -b.min[2]];
		case 'bottom-center-back':
			return [-cx, -b.min[1], -b.min[2]];
		case 'center':
			return [-cx, -cy, -cz];
		case 'none':
			return [0, 0, 0];
	}
	throw new Error(`pivot must be one of ${PIVOTS.join('|')}`);
}

/**
 * @param {string} input raw GLB path
 * @param {string} output GLB path
 * @param {{targetTris?: number, dims?: {x?: number, y?: number, z?: number}, fit?: 'contain'|'stretch',
 *   pivot?: string, rotateY?: number, hero?: boolean, textureSize?: number, textureFormat?: 'jpeg'|'webp'|'png', quality?: number}} job
 */
export async function postProcess(input, output, job = {}) {
	await MeshoptSimplifier.ready;
	const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
	const doc = await io.read(input);
	doc.setLogger(new Logger(Logger.Verbosity.WARN)); // stdout carries the JSON report
	const root = doc.getRoot();
	const bytesIn = fs.statSync(input).size;
	const trisIn = countTris(doc);

	// 1. bake node transforms: every mesh node becomes a direct, identity child of its scene
	await doc.transform(flatten());
	for (const node of root.listNodes()) if (node.getMesh()) clearNodeTransform(node);
	for (const node of root.listNodes()) {
		// transform-only nodes left over from flatten (no mesh, no children) are dropped by prune
		if (!node.getMesh() && node.listChildren().length === 0) node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
	}
	if (job.rotateY) {
		const a = (job.rotateY * Math.PI) / 180;
		const c = Math.cos(a), s = Math.sin(a);
		const m = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
		for (const mesh of root.listMeshes()) transformMesh(mesh, /** @type {any} */ (m));
	}

	// 2. weld + simplify to the budget (raise the error bound until the target is met)
	await doc.transform(dedup(), weld());
	const target = job.targetTris;
	if (target && trisIn > target) {
		for (const error of [0.001, 0.005, 0.01, 0.02, 0.05]) {
			const ratio = target / countTris(doc);
			if (ratio >= 1) break;
			await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }));
			if (countTris(doc) <= target * 1.05) break;
		}
	}
	await doc.transform(join({ keepNamed: false }));

	// 3. scale to dims, then the pivot
	const scene = root.getDefaultScene() ?? root.listScenes()[0];
	let b = getBounds(scene);
	const size = /** @type {[number, number, number]} */ ([0, 1, 2].map((i) => b.max[i] - b.min[i]));
	const k = scaleFor(size, job.dims, job.fit ?? 'contain');
	const smin = [0, 1, 2].map((i) => b.min[i] * k[i]);
	const smax = [0, 1, 2].map((i) => b.max[i] * k[i]);
	const off = pivotOffset({ min: smin, max: smax }, job.pivot ?? 'bottom-center');
	const m = [k[0], 0, 0, 0, 0, k[1], 0, 0, 0, 0, k[2], 0, off[0], off[1], off[2], 1];
	for (const mesh of root.listMeshes()) transformMesh(mesh, /** @type {any} */ (m));
	b = getBounds(scene);

	// 4. Meshy-6 refines ship an emissive map that is black for anything that does not
	// glow: a whole texture fetch + shader path for nothing. Drop it unless it has light.
	let droppedEmissive = 0;
	for (const mat of root.listMaterials()) {
		const tex = mat.getEmissiveTexture();
		const img = tex?.getImage();
		if (!img || job.keepEmissive) continue;
		const { channels } = await sharp(Buffer.from(img)).stats();
		if (Math.max(...channels.slice(0, 3).map((c) => c.max)) < 24) {
			mat.setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
			droppedEmissive++;
		}
	}

	// 5. textures: 1024² (2048² for hero pieces), JPEG by default
	const size2 = job.textureSize ?? (job.hero ? 2048 : 1024);
	await doc.transform(
		textureCompress({ encoder: sharp, targetFormat: job.textureFormat ?? 'jpeg', resize: [size2, size2], quality: job.quality ?? 86 }),
		prune(),
		dedup()
	);

	// provenance (never strip Meshy's own generator/extras — ToS §2.4)
	const asset = root.getAsset();
	const extras = /** @type {any} */ ({ ...(asset.extras ?? {}) });
	extras.meshyPost = { tool: 'theprototype tools/meshy', trisIn, targetTris: target ?? null, dims: job.dims ?? null, pivot: job.pivot ?? 'bottom-center' };
	asset.extras = extras;

	await io.write(output, doc);
	const out = await io.read(output);
	const textures = [];
	for (const t of out.getRoot().listTextures()) textures.push({ mime: t.getMimeType(), size: t.getSize(), bytes: t.getImage()?.byteLength ?? 0 });
	const report = {
		output,
		bytesIn,
		bytesOut: fs.statSync(output).size,
		trisIn,
		trisOut: countTris(out),
		bounds: { min: b.min.map((v) => +v.toFixed(4)), max: b.max.map((v) => +v.toFixed(4)) },
		size: [0, 1, 2].map((i) => +(b.max[i] - b.min[i]).toFixed(4)),
		textures,
		materials: out.getRoot().listMaterials().length,
		droppedEmissive,
		meshes: out.getRoot().listMeshes().length
	};
	if (report.bytesOut > 5 * 1024 * 1024) throw Object.assign(new Error(`${output} is ${report.bytesOut} bytes — over the 5 MB share cap`), { report });
	return report;
}
