// inspect: what a shipped GLB IS, measured — the numbers the budget report and the CI checks read.
import fs from 'node:fs';
import { load, makeIO } from './deps.mjs';

const { getBounds } = await load('@gltf-transform/functions');
const io = makeIO();

/** triangles DRAWN: per node that references a mesh (a kitbash instances one mesh several times) @param {any} doc */
export function drawnTris(doc) {
	let n = 0;
	for (const node of doc.getRoot().listNodes()) {
		const mesh = node.getMesh();
		if (!mesh) continue;
		for (const p of mesh.listPrimitives()) {
			if (p.getMode() !== 4) continue;
			const idx = p.getIndices();
			n += (idx ? idx.getCount() : (p.getAttribute('POSITION')?.getCount() ?? 0)) / 3;
		}
	}
	return Math.round(n);
}

/** @param {any} doc */
export function sceneOf(doc) {
	return doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
}

/**
 * @param {string} file
 * @returns {Promise<{file: string, bytes: number, tris: number, min: number[], max: number[], size: number[],
 *   nodes: number, meshNodes: string[], meshes: number, prims: number, materials: {name: string, doubleSided: boolean,
 *   emissive: boolean, emissiveTexture: boolean}[], textures: {size: number[] | null, mime: string, bytes: number}[],
 *   animations: string[], extras: any}>}
 */
export async function inspectGlb(file) {
	const doc = await io.read(file);
	return { file, bytes: fs.statSync(file).size, ...inspectDoc(doc) };
}

/** @param {any} doc */
export function inspectDoc(doc) {
	const root = doc.getRoot();
	const scene = sceneOf(doc);
	const b = scene ? getBounds(scene) : { min: [0, 0, 0], max: [0, 0, 0] };
	const finite = b.min.every(Number.isFinite) && b.max.every(Number.isFinite);
	const min = finite ? b.min.map((v) => +v.toFixed(4)) : [0, 0, 0];
	const max = finite ? b.max.map((v) => +v.toFixed(4)) : [0, 0, 0];
	return {
		tris: drawnTris(doc),
		min,
		max,
		size: [0, 1, 2].map((i) => +(max[i] - min[i]).toFixed(4)),
		nodes: root.listNodes().length,
		meshNodes: root.listNodes().filter((n) => n.getMesh()).map((n) => n.getName()),
		meshes: root.listMeshes().length,
		prims: root.listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0),
		materials: root.listMaterials().map((m) => ({
			name: m.getName(),
			doubleSided: m.getDoubleSided(),
			emissive: m.getEmissiveFactor().some((v) => v > 0),
			emissiveTexture: !!m.getEmissiveTexture()
		})),
		textures: root.listTextures().map((t) => ({ size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage()?.byteLength ?? 0 })),
		animations: root.listAnimations().map((a) => a.getName()),
		extras: scene?.getExtras() ?? {}
	};
}
