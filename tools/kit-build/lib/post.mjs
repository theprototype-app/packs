// post: THE pack post step (roadmap 34 E2). Every kit used to carry its own fork of it —
// tools/architecture-kit, tools/scifi-kit and tools/town-kit had kit-post.mjs, nature-kit/build/finalize.mjs,
// props-kit/_src/build.mjs and interior-kit/_src/build.mjs their own grade / emissive / flat-for-sync
// helpers. They now all import from here; each function below is the fork's code unchanged (same
// sharp calls, same JPEG quality, same order), so a rebuild writes the same bytes.
//
//   raw Meshy GLB → pre-rotate (Meshy often lays a floor tile or roof slab upright, and meshy-post
//   only turns about Y) → meshy-post (weld, decimate to targetTris, stretch to the exact dims, pivot,
//   textures to the cap as JPEG) → SEAM CLAMP → offset → EMISSIVE POLICY + albedo grade → recolor →
//   glow mask → prune → defight → pack GLB.
//
// kitPost(input, output, job): job = meshy-post's job + {
//   preRotate?: {x?, y?, z?} degrees, clamp?: "x" | "xz" | "xyz" | "x-y" …, eps?: metres (default 0.04),
//   offset?: [x, y, z] metres applied last, albedo?: {saturation, brightness, hue} grade of the base colour,
//   dropEmissive?: false to keep it (THE EMISSIVE POLICY: by default nothing a post step builds glows unless
//   the job says so — `glow` below, or dropEmissive: false),
//   glow?: {hue: [lo, hi], sat, val, strength} — light the albedo's own light strips (glowMask),
//   recolor?: {hue: [lo, hi], sat, val, shift, minSat} — grade that hue band only (recolor),
//   defight?: false to skip the z-fight pass (town-kit runs it itself, with a judge) }
// `clamp` lists axes; a trailing "-y" etc. means "the MIN face of y only" (a floor's bottom).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load, tool, makeIO, TOOLS } from './deps.mjs';
import { defightFile } from '../../lod/defight.mjs';

export { TOOLS };
const { KHRMaterialsEmissiveStrength } = await load('@gltf-transform/extensions');
const { getBounds, transformMesh, prune, flatten, clearNodeTransform, compactPrimitive } = await load('@gltf-transform/functions');
const { postProcess } = await tool('lib/post.js');
const sharp = (await load('sharp')).default;

const io = makeIO();
const AX = { x: 0, y: 1, z: 2 };

/** column-major 4x4 rotation about one axis @param {'x'|'y'|'z'} axis @param {number} deg */
export function rot(axis, deg) {
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
 * The seam clamp is what makes pieces snap without gaps: Meshy's ends are never quite planar (a
 * stone sticks out 2 cm, the next one is 3 cm short), so after the stretch every vertex within
 * `eps` of a bbox face named in `clamp` is moved ONTO that face. Two walls placed end to end then
 * share one exact plane at their joint. Returns how many vertices moved.
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

/** rgb (0-1) → [h°, s, v] */
export function hsv(/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b) {
	const max = Math.max(r, g, b);
	const d = max - Math.min(r, g, b);
	const h = d === 0 ? 0 : max === r ? (60 * ((g - b) / d) + 360) % 360 : max === g ? 60 * ((b - r) / d) + 120 : 60 * ((r - g) / d) + 240;
	return [h, max ? d / max : 0, max];
}

/**
 * Sci-fi pieces carry their own lights (a door's light stripes, a pad's rings, a screen): Meshy
 * paints them into the albedo as bright teal but ships no usable emissive map. The mask keeps every
 * albedo pixel whose hue is in [lo, hi]° with saturation ≥ sat and value ≥ val (0-1), black
 * elsewhere, and becomes the emissive texture — so exactly the painted lights glow, never the teal
 * PAINT (darker) or the white panels (unsaturated). Returns the fraction of pixels lit (in %), 0
 * when the material has no albedo.
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

/**
 * A hue-selective grade of the albedo: pixels whose hue is in [lo, hi]° (a band with lo > hi wraps
 * through 0°, reds: [340, 15]; saturation ≥ minSat, default 0.12, so greys are left alone) get their
 * saturation × sat, value × val and hue + shift° — e.g. the wall's all-teal frame → warm gunmetal,
 * keeping its painted shading. Returns % of pixels.
 * @param {any} mat @param {{hue: number[], sat?: number, val?: number, shift?: number, minSat?: number}} o
 */
export async function recolor(mat, o) {
	const tex = mat.getBaseColorTexture();
	if (!tex) return 0;
	const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
	let n = 0;
	for (let i = 0; i < data.length; i += 3) {
		const [h, s, v] = hsv(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
		const inBand = o.hue[0] <= o.hue[1] ? h >= o.hue[0] && h <= o.hue[1] : h >= o.hue[0] || h <= o.hue[1];
		if (s < (o.minSat ?? 0.12) || !inBand) continue;
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
 * The kit post step (architecture / sci-fi / town): see the header.
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
		if (job.defight === false) return { ...report, output, clamped: moved, graded, recolored, glowing, bytesOut: fs.statSync(output).size };
		// the seam clamp folds relief within eps of a face INTO it: coplanar layers that
		// z-fight while the camera moves (roadmap 33 K1, the Block). Settle them last.
		const fight = await defightFile(output, output);
		return { ...report, output, clamped: moved, defight: { pairs: fight.before, dropped: fight.dropped, pushed: fight.pushed }, graded, recolored, glowing, bytesOut: fs.statSync(output).size };
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}

// ---- the EMISSIVE POLICY on a whole file (nature-kit: nothing in nature emits light) ----

/** Meshy-6 refines sometimes paint a NON-black emissive map (the oak's canopy: mean 33-47 of 255),
 * which makes foliage glow at night and wash out by day (meshy-post only drops a fully black one).
 * Drops every material's emissive map and factor; returns how many had one.
 * @param {string} file */
export async function dropEmissive(file) {
	const doc = await io.read(file);
	let n = 0;
	for (const mat of doc.getRoot().listMaterials()) {
		if (mat.getEmissiveTexture() || mat.getEmissiveFactor().some((/** @type {number} */ v) => v > 0)) n++;
		mat.setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
	}
	await doc.transform(prune());
	await io.write(file, doc);
	return n;
}

/** props-kit: the albedo doubles as the emissive map, so bright panes (a lantern's amber glass) light
 * up while dark metal stays dark — a lit look with no extra texture. @param {any} doc @param {number} k */
export function albedoGlow(doc, k) {
	for (const mat of doc.getRoot().listMaterials()) mat.setEmissiveTexture(mat.getBaseColorTexture()).setEmissiveFactor([k, k * 0.8, k * 0.55]);
}

// ---- colour grades (0-credit palette fixes and variants) ----

const rgb2hsv = (/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b) => {
	const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
	let h = 0;
	if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
};
const hsv2rgb = (/** @type {number} */ h, /** @type {number} */ s, /** @type {number} */ v) => {
	const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
	const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
	return [r + m, g + m, b + m];
};
const inRange = (/** @type {number} */ h, /** @type {number[]} */ [a, b]) => (a <= b ? h >= a && h <= b : h >= a || h <= b);

/** nature-kit: colour grade the base-colour textures of a FILE: each rule moves pixels whose hue is
 * in `hue` (degrees, wraps) by `shift` degrees / scales saturation `sat` and value `val`, feathered at
 * the range edges so there is no hard seam (optional tint). The 0-credit alternative to a retexture.
 * @param {string} file @param {any[]} rules */
export async function gradeHue(file, rules) {
	const doc = await io.read(file);
	for (const mat of doc.getRoot().listMaterials()) {
		const tex = mat.getBaseColorTexture();
		if (!tex) continue;
		const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
		for (let i = 0; i < data.length; i += 3) {
			let [h, s, v] = rgb2hsv(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
			/** @type {any} */
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

/** props-kit / interior-kit: per-channel multiply (+ offset) of every base-colour texture, so a piece
 * Meshy painted off-palette (a pale pine table) matches the kit's oak without a paid retexture.
 * `only: 'teal'` (interior-kit) grades only teal-ish texels (green and blue well above red, a soft
 * mask) — a painted cupboard darkens to the pack's deep teal while its marble top and brass stay.
 * @param {any} doc @param {{mul: number[], add?: number[], only?: string}} o */
export async function gradeLinear(doc, { mul, add = [0, 0, 0], only }) {
	for (const mat of doc.getRoot().listMaterials()) {
		const tex = mat.getBaseColorTexture();
		const img = tex?.getImage();
		if (!img) continue;
		if (only === 'teal') {
			const { data, info } = await sharp(Buffer.from(img)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
			for (let i = 0; i < data.length; i += 3) {
				const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
				const k = Math.min(1, Math.max(0, (Math.min(g, b) - r - 12) / 30)); // soft mask
				if (k <= 0) continue;
				for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * (1 - k + k * mul[c]));
			}
			tex.setImage(await sharp(data, { raw: info }).jpeg({ quality: 86 }).toBuffer()).setMimeType('image/jpeg');
			continue;
		}
		tex.setImage(await sharp(Buffer.from(img)).linear(mul, add).jpeg({ quality: 86 }).toBuffer()).setMimeType('image/jpeg');
	}
}

// ---- repairs ----

/** nature-kit: bake node transforms, then drop every triangle lying entirely below `frac` of the
 * height (Meshy likes to stand plants on a flat round "base" disc — on real terrain that reads as a
 * coaster). Writes a cut copy into `tmpDir` and returns its path.
 * @param {string} input @param {number} frac @param {string} tmpDir */
export async function cutBase(input, frac, tmpDir) {
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
			const get = (/** @type {number} */ i) => (idx ? idx.getScalar(i) : i);
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
	const out = path.join(tmpDir, `cut-${path.basename(path.dirname(path.dirname(input)))}-${Math.random().toString(36).slice(2, 7)}.glb`);
	await io.write(out, doc);
	return { out, dropped };
}

/** interior-kit: repair texels Meshy left unpainted (pure black holes in the atlas — the bed's
 * headboard showed one): diffuse the surrounding colour into every near-black texel. 0 credits.
 * @param {any} doc @param {{max?: number}} [o] */
export async function inpaintBlack(doc, { max = 30 } = {}) {
	let fixed = 0;
	for (const mat of doc.getRoot().listMaterials()) {
		const tex = mat.getBaseColorTexture();
		const img = tex?.getImage();
		if (!img) continue;
		const { data, info } = await sharp(Buffer.from(img)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
		const { width: w, height: h } = info;
		const hole = new Uint8Array(w * h);
		let n = 0;
		for (let i = 0; i < w * h; i++) if (Math.max(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]) < max) (hole[i] = 1), n++;
		if (!n) continue;
		// onion-peel: fill hole texels that touch known texels with their neighbours' mean, repeat
		for (let pass = 0; pass < 2048 && n; pass++) {
			/** @type {[number, number[]][]} */
			const next = [];
			for (let y = 0; y < h; y++)
				for (let x = 0; x < w; x++) {
					const i = y * w + x;
					if (!hole[i]) continue;
					const acc = [0, 0, 0];
					let k = 0;
					for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
						const xx = x + dx;
						const yy = y + dy;
						if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
						const j = yy * w + xx;
						if (hole[j]) continue;
						for (let c = 0; c < 3; c++) acc[c] += data[j * 3 + c];
						k++;
					}
					if (k >= 2) next.push([i, acc.map((v) => Math.round(v / k))]);
				}
			if (!next.length) break;
			for (const [i, col] of next) {
				for (let c = 0; c < 3; c++) data[i * 3 + c] = col[c];
				hole[i] = 0;
				n--;
				fixed++;
			}
		}
		tex.setImage(await sharp(data, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 86 }).toBuffer()).setMimeType('image/jpeg');
	}
	return fixed;
}

/** interior-kit: repair Meshy's broken vertex normals (the bed's headboard rendered a black triangle):
 * (1) a ZERO / NaN normal shades black — it takes the area-weighted mean of its triangles' face
 * normals; (2) a triangle whose vertex normals point AGAINST its winding renders dark under the
 * double-sided material — it gets its own vertices carrying its face normal. Returns { zero, flipped }.
 * @param {any} doc */
export function repairNormals(doc) {
	let fixed = 0;
	let zero = 0;
	for (const mesh of doc.getRoot().listMeshes())
		for (const prim of mesh.listPrimitives()) {
			const names = prim.listSemantics();
			const attrs = names.map((/** @type {string} */ s) => prim.getAttribute(s));
			const P = prim.getAttribute('POSITION');
			const N = prim.getAttribute('NORMAL');
			const I = prim.getIndices();
			if (!N || !I) continue;
			{
				const acc = new Float64Array(N.getCount() * 3);
				const ix = I.getArray();
				for (let t = 0; t < ix.length; t += 3) {
					const [a, b, c] = [ix[t], ix[t + 1], ix[t + 2]].map((i) => P.getElement(i, []));
					const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
					const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
					const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
					for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) acc[ix[t + k] * 3 + j] += n[j];
				}
				for (let i = 0; i < N.getCount(); i++) {
					const n = N.getElement(i, []);
					if (Math.hypot(...n) > 0.5) continue;
					const m = [acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]];
					const l = Math.hypot(...m) || 1;
					N.setElement(i, l > 1e-12 ? m.map((x) => x / l) : [0, 1, 0]);
					zero++;
				}
			}
			const arrays = attrs.map((/** @type {any} */ a) => Array.from(a.getArray()));
			const idx = Array.from(I.getArray());
			for (let t = 0; t < idx.length; t += 3) {
				const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map((i) => P.getElement(i, []));
				const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
				const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
				const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
				const len = Math.hypot(...n);
				if (len < 1e-12) continue;
				let neg = 0;
				for (let k = 0; k < 3; k++) {
					const vn = N.getElement(idx[t + k], []);
					if (vn[0] * n[0] + vn[1] * n[1] + vn[2] * n[2] < 0) neg++;
				}
				if (neg < 2) continue;
				for (let k = 0; k < 3; k++) {
					const src = idx[t + k];
					attrs.forEach((/** @type {any} */ attr, /** @type {number} */ j) => {
						const size = attr.getElementSize();
						const el = names[j] === 'NORMAL' ? n.map((x) => x / len) : attr.getElement(src, []);
						arrays[j].push(...el.slice(0, size));
					});
					idx[t + k] = arrays[names.indexOf('POSITION')].length / 3 - 1;
				}
				fixed++;
			}
			if (!fixed) continue;
			attrs.forEach((/** @type {any} */ attr, /** @type {number} */ j) => attr.setArray(new (attr.getArray().constructor)(arrays[j])));
			I.setArray(new Uint32Array(idx));
		}
	return { zero, flipped: fixed };
}

/**
 * FLAT FOR SYNC (props-kit, interior-kit): every mesh node a direct child of the scene, one primitive
 * per mesh. Core's scene sync (commandsHandler sendObject) sends a leaf mesh with its LOCAL pose but a
 * nested Group / Object3D-with-children with its WORLD pose, which the receiver then parents under the
 * import root — so on a peer every nested level adds the object's position again (measured: a placed
 * Rug sat 2× its drop offset away on peer B). GLTFLoader turns a multi-primitive mesh into a Group, so
 * primitives are split to one mesh each; flatten() lifts nested nodes to the scene with baked transforms.
 * @param {any} doc
 */
export async function flatForSync(doc) {
	await doc.transform(flatten());
	const root = doc.getRoot();
	const scene = root.getDefaultScene() ?? root.listScenes()[0];
	for (const node of [...scene.listChildren()]) {
		const mesh = node.getMesh();
		if (!mesh || mesh.listPrimitives().length < 2) continue;
		mesh.listPrimitives().forEach((/** @type {any} */ prim, /** @type {number} */ i) => {
			const name = `${node.getName()}_${prim.getMaterial()?.getName() || i}`;
			const part = doc.createNode(name).setTranslation(node.getTranslation()).setRotation(node.getRotation()).setScale(node.getScale());
			part.setMesh(doc.createMesh(name).addPrimitive(prim));
			scene.addChild(part);
		});
		node.dispose();
		mesh.dispose();
	}
	await doc.transform(prune());
}
