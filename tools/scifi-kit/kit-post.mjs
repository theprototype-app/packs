// kit-post: the sci-fi kit's post step around tools/meshy's meshy-post.
//
//   raw Meshy GLB → pre-rotate (Meshy often lays a floor tile or roof slab upright, and
//   meshy-post only turns about Y) → meshy-post (weld, simplify, stretch to the exact
//   dims, pivot, 1024² JPEG) → SEAM CLAMP → pack GLB.
//
// The seam clamp is what makes pieces snap without gaps: Meshy's ends are never quite
// planar (a stone sticks out 2 cm, the next one is 3 cm short), so after the stretch
// every vertex within `eps` of a bbox face named in `clamp` is moved ONTO that face.
// Two walls placed end to end then share one exact plane at their joint.
//
//   node kit-post.mjs <raw.glb> <out.glb> '<job json>'
//   job = meshy-post's job + { preRotate?: {x?, y?, z?} degrees, clamp?: "x" | "xz" | "xyz" | "x-y" …,
//         eps?: metres (default 0.04), offset?: [x, y, z] metres applied last,
//         albedo?: {saturation, brightness, hue} grade of the base colour, dropEmissive?: false to keep it,
//         glow?: {hue: [lo, hi], sat, val, strength} — light the albedo's own light strips (see glowMask),
//         recolor?: {hue: [lo, hi], sat, val, shift} — scale saturation/value (and shift the hue) of that band only (see recolor) }
// `clamp` lists axes; a trailing "-y" etc. means "the MIN face of y only" (a floor's bottom).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export const TOOLS = process.env.MESHY_TOOLS || '/home/deck/.code/theprototype-app/packs-lane-30c-tools/tools/meshy';
const req = createRequire(path.join(TOOLS, 'package.json'));
const load = async (/** @type {string} */ id) => import(pathToFileURL(req.resolve(id)).href);

const { NodeIO } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS, KHRMaterialsEmissiveStrength } = await load('@gltf-transform/extensions');
const { getBounds, transformMesh, prune } = await load('@gltf-transform/functions');
const { postProcess } = await import(pathToFileURL(path.join(TOOLS, 'lib/post.js')).href);
const sharp = (await load('sharp')).default;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const AX = { x: 0, y: 1, z: 2 };

/** column-major 4x4 rotation about one axis @param {'x'|'y'|'z'} axis @param {number} deg */
function rot(axis, deg) {
	const a = (deg * Math.PI) / 180;
	const c = Math.cos(a);
	const s = Math.sin(a);
	if (axis === 'x') return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
	if (axis === 'y') return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
	return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Parse "xz" / "x-y" / "+y" into [{axis, side}] (side: -1 min, +1 max, 0 both). @param {string} spec */
export function parseClamp(spec) {
	const out = [];
	let sign = 0;
	for (const ch of spec || '') {
		if (ch === '-') sign = -1;
		else if (ch === '+') sign = 1;
		else if (ch in AX) {
			out.push({ axis: AX[/** @type {'x'|'y'|'z'} */ (ch)], side: sign });
			sign = 0;
		}
	}
	return out;
}

/**
 * Move every vertex within eps of a named bbox face onto it. Returns how many moved.
 * @param {any} doc @param {string} spec @param {number} eps
 */
export function seamClamp(doc, spec, eps = 0.04) {
	const faces = parseClamp(spec);
	if (!faces.length) return 0;
	const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
	const b = getBounds(scene);
	let moved = 0;
	const seen = new Set();
	for (const mesh of doc.getRoot().listMeshes()) {
		for (const prim of mesh.listPrimitives()) {
			const pos = prim.getAttribute('POSITION');
			if (!pos || seen.has(pos)) continue;
			seen.add(pos);
			const v = [0, 0, 0];
			for (let i = 0; i < pos.getCount(); i++) {
				pos.getElement(i, v);
				let changed = false;
				for (const { axis, side } of faces) {
					if (side <= 0 && v[axis] - b.min[axis] < eps && v[axis] !== b.min[axis]) {
						v[axis] = b.min[axis];
						changed = true;
					}
					if (side >= 0 && b.max[axis] - v[axis] < eps && v[axis] !== b.max[axis]) {
						v[axis] = b.max[axis];
						changed = true;
					}
				}
				if (changed) {
					pos.setElement(i, v);
					moved++;
				}
			}
		}
	}
	return moved;
}

/**
 * Sci-fi pieces carry their own lights (a door's light stripes, a pad's rings, a screen):
 * Meshy paints them into the albedo as bright teal but ships no usable emissive map. The
 * mask keeps every albedo pixel whose hue is in [lo, hi]° with saturation ≥ sat and value
 * ≥ val (0-1), black elsewhere, and becomes the emissive texture — so exactly the painted
 * lights glow, never the teal PAINT (darker) or the white panels (unsaturated).
 * Returns the fraction of pixels lit (in %), 0 when the material has no albedo.
 * @param {any} doc @param {any} mat @param {{hue: number[], sat?: number, val?: number, strength?: number}} o
 */
export async function glowMask(doc, mat, o) {
	const tex = mat.getBaseColorTexture();
	if (!tex) return 0;
	const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
	const out = Buffer.alloc(data.length);
	let lit = 0;
	for (let i = 0; i < data.length; i += 3) {
		const r = data[i] / 255;
		const g = data[i + 1] / 255;
		const b = data[i + 2] / 255;
		const max = Math.max(r, g, b);
		const d = max - Math.min(r, g, b);
		const h = d === 0 ? 0 : max === r ? (60 * ((g - b) / d) + 360) % 360 : max === g ? 60 * ((b - r) / d) + 120 : 60 * ((r - g) / d) + 240;
		if (max >= (o.val ?? 0.55) && d / (max || 1) >= (o.sat ?? 0.35) && h >= o.hue[0] && h <= o.hue[1]) {
			out[i] = data[i];
			out[i + 1] = data[i + 1];
			out[i + 2] = data[i + 2];
			lit++;
		}
	}
	const img = await sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).jpeg({ quality: 88 }).toBuffer();
	const em = doc.createTexture(`${mat.getName() || 'mat'}_glow`).setImage(new Uint8Array(img)).setMimeType('image/jpeg');
	mat.setEmissiveTexture(em).setEmissiveFactor([1, 1, 1]);
	if (o.strength && o.strength !== 1) {
		const ext = doc.createExtension(KHRMaterialsEmissiveStrength);
		mat.setExtension('KHR_materials_emissive_strength', ext.createEmissiveStrength().setEmissiveStrength(o.strength));
	}
	return +((100 * lit) / (info.width * info.height)).toFixed(2);
}

/** rgb (0-1) → [h°, s, v] */
export function hsv(r, g, b) {
	const max = Math.max(r, g, b);
	const d = max - Math.min(r, g, b);
	const h = d === 0 ? 0 : max === r ? (60 * ((g - b) / d) + 360) % 360 : max === g ? 60 * ((b - r) / d) + 120 : 60 * ((r - g) / d) + 240;
	return [h, max ? d / max : 0, max];
}

/**
 * A hue-selective grade of the albedo: pixels whose hue is in [lo, hi]° (and saturation
 * ≥ 0.12, so greys are left alone) get their saturation × sat, value × val and hue + shift° — e.g. the
 * wall's all-teal frame → warm gunmetal, keeping its painted shading. Returns % of pixels.
 * @param {any} mat @param {{hue: number[], sat?: number, val?: number, shift?: number}} o
 */
export async function recolor(mat, o) {
	const tex = mat.getBaseColorTexture();
	if (!tex) return 0;
	const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
	let n = 0;
	for (let i = 0; i < data.length; i += 3) {
		const [h, s, v] = hsv(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
		if (s < 0.12 || h < o.hue[0] || h > o.hue[1]) continue;
		const s2 = Math.min(1, s * (o.sat ?? 1));
		const v2 = Math.min(1, v * (o.val ?? 1));
		// back to rgb: keep the pixel's own channel ratios' hue, re-spread for s2/v2
		const h2 = (h + (o.shift ?? 0) + 360) % 360;
		const c = v2 * s2;
		const x = c * (1 - Math.abs(((h2 / 60) % 2) - 1));
		const m = v2 - c;
		const [r, g, b] = h2 < 60 ? [c, x, 0] : h2 < 120 ? [x, c, 0] : h2 < 180 ? [0, c, x] : h2 < 240 ? [0, x, c] : h2 < 300 ? [x, 0, c] : [c, 0, x];
		data[i] = Math.round((r + m) * 255);
		data[i + 1] = Math.round((g + m) * 255);
		data[i + 2] = Math.round((b + m) * 255);
		n++;
	}
	tex.setImage(new Uint8Array(await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).jpeg({ quality: 88 }).toBuffer())).setMimeType('image/jpeg');
	return +((100 * n) / (info.width * info.height)).toFixed(2);
}

/**
 * @param {string} input @param {string} output @param {any} job
 */
export async function kitPost(input, output, job) {
	let src = input;
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-post-'));
	try {
		if (job.preRotate && Object.values(job.preRotate).some(Boolean)) {
			const doc = await io.read(input);
			for (const axis of /** @type {const} */ (['x', 'y', 'z'])) {
				const deg = job.preRotate[axis];
				if (!deg) continue;
				// bake node transforms first would be meshy-post's job; Meshy raws are a
				// single identity node, so rotating the mesh data is exact here
				for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, /** @type {any} */ (rot(axis, deg)));
			}
			src = path.join(tmp, 'rotated.glb');
			await io.write(src, doc);
		}
		const mid = path.join(tmp, 'post.glb');
		const report = await postProcess(src, mid, job);
		const doc = await io.read(mid);
		const moved = seamClamp(doc, job.clamp ?? '', job.eps ?? 0.04);
		if (job.offset) {
			// a piece that shares ANOTHER piece's pivot (a window sits 0.95 m up on the wall's
			// bottom-centre origin, so both place at the same grid point and rotation)
			const t = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, job.offset[0] ?? 0, job.offset[1] ?? 0, job.offset[2] ?? 0, 1];
			for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, /** @type {any} */ (t));
		}
		let graded = 0;
		for (const mat of doc.getRoot().listMaterials()) {
			// a wall or a crate never glows: Meshy's refine sometimes ships a faint emissive map
			// (a glowing floor is baked light in disguise) — drop it outright
			if (job.dropEmissive !== false) mat.setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
			// a colour GRADE of the albedo, so every piece sits in one palette (Meshy read
			// "oxblood" as cherry red and "slate" as lavender): sharp.modulate + JPEG
			const tex = job.albedo && mat.getBaseColorTexture();
			if (tex) {
				const { saturation = 1, brightness = 1, hue = 0 } = job.albedo;
				tex.setImage(new Uint8Array(await sharp(Buffer.from(tex.getImage())).modulate({ saturation, brightness, hue }).jpeg({ quality: 86 }).toBuffer()));
				tex.setMimeType('image/jpeg');
				graded++;
			}
		}
		let recolored = 0;
		if (job.recolor) for (const mat of doc.getRoot().listMaterials()) recolored += await recolor(mat, job.recolor);
		let glowing = 0;
		if (job.glow) for (const mat of doc.getRoot().listMaterials()) glowing += await glowMask(doc, mat, job.glow);
		await doc.transform(prune());
		await io.write(output, doc);
		return { ...report, output, clamped: moved, graded, recolored, glowing, bytesOut: fs.statSync(output).size };
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [input, output, jobJson] = process.argv.slice(2);
	if (!input || !output) {
		console.error("usage: kit-post.mjs <raw.glb> <out.glb> '<job json>'");
		process.exit(2);
	}
	const report = await kitPost(input, output, JSON.parse(jobJson || '{}'));
	console.log(JSON.stringify(report));
}
