// pass: the pack-level steps on SHIPPED GLBs (LOD0 of every row), driven by packs.json —
//   1. emissive policy   a pack whose policy is "none" keeps nothing that glows
//   2. texture cap       any texture over the pack's cap is resized to it (same format)
//   3. share cap         a GLB still over 5 MiB re-encodes its PNG textures as JPEG, largest first,
//                        when every material using one is OPAQUE (the alpha channel is never read)
//   4. decimate          LOD0 over its category's triangle budget is simplified to it (meshoptimizer,
//                        node names and hierarchy kept) — then `kit-build lod <pack>` rebuilds levels
// A file that needs none of it is never rewritten (byte-identical). And thumbnails.
import fs from 'node:fs';
import path from 'node:path';
import { load, tool, makeIO } from './deps.mjs';
import { drawnTris } from './inspect.mjs';
import { loadConfig, itemPolicy } from './check.mjs';

const { simplify, weld } = await load('@gltf-transform/functions');
const { MeshoptSimplifier } = await load('meshoptimizer');
const sharp = (await load('sharp')).default;
const io = makeIO();
const isUrl = (/** @type {any} */ p) => typeof p === 'string' && /^https?:\/\//.test(p);

/** the local rows of a pack: [{row, dir, glb}] @param {string} repo @param {string} pack */
export function packRows(repo, pack) {
	const index = JSON.parse(fs.readFileSync(path.join(repo, 'index.json'), 'utf8'));
	const entry = index.find((/** @type {any} */ r) => r.name === pack);
	if (!entry?.value || isUrl(entry.value)) return [];
	const listFile = path.join(repo, entry.value);
	const base = path.dirname(listFile);
	return JSON.parse(fs.readFileSync(listFile, 'utf8'))
		.filter((/** @type {any} */ r) => typeof r?.variants?.['glTF-Binary'] === 'string' && !isUrl(r.variants['glTF-Binary']))
		.map((/** @type {any} */ row) => ({ row, dir: path.join(base, row.name), glb: path.join(base, row.name, 'glTF-Binary', row.variants['glTF-Binary']) }));
}

/** the materials that use a texture @param {any} tex */
const usersOf = (tex) => tex.listParents().filter((/** @type {any} */ p) => p.propertyType === 'Material');

/** emissive policy "none": drop every emissive map and factor @param {any} doc */
export function dropAllEmissive(doc) {
	let n = 0;
	for (const mat of doc.getRoot().listMaterials()) {
		if (!mat.getEmissiveTexture() && !mat.getEmissiveFactor().some((/** @type {number} */ v) => v > 0)) continue;
		mat.setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
		n++;
	}
	return n;
}

/** resize every texture over `cap` (largest side) to fit it, keeping its format @param {any} doc @param {number} cap */
export async function capTextures(doc, cap) {
	let n = 0;
	for (const tex of doc.getRoot().listTextures()) {
		const size = tex.getSize();
		if (!size || Math.max(...size) <= cap) continue;
		const img = sharp(Buffer.from(tex.getImage())).resize(cap, cap, { fit: 'inside' });
		const png = tex.getMimeType() === 'image/png';
		tex.setImage(new Uint8Array(await (png ? img.png({ compressionLevel: 9 }) : img.jpeg({ quality: 86 })).toBuffer())).setMimeType(png ? 'image/png' : 'image/jpeg');
		n++;
	}
	return n;
}

/** PNG → JPEG (q 86, the pipeline's quality), largest first, while the GLB is over `maxBytes`, for
 * textures only OPAQUE materials use @param {any} doc @param {number} maxBytes */
export async function fitShareCap(doc, maxBytes) {
	let n = 0;
	const pngs = doc
		.getRoot()
		.listTextures()
		.filter((/** @type {any} */ t) => t.getMimeType() === 'image/png' && usersOf(t).every((/** @type {any} */ m) => m.getAlphaMode() === 'OPAQUE'))
		.sort((/** @type {any} */ a, /** @type {any} */ b) => b.getImage().byteLength - a.getImage().byteLength);
	for (const tex of pngs) {
		if ((await io.writeBinary(doc)).byteLength <= maxBytes) break;
		tex.setImage(new Uint8Array(await sharp(Buffer.from(tex.getImage())).flatten().jpeg({ quality: 86 }).toBuffer())).setMimeType('image/jpeg');
		if (tex.getURI()) tex.setURI(tex.getURI().replace(/\.png$/i, '.jpg'));
		n++;
	}
	return n;
}

/** simplify to `budget` drawn triangles (meshy-post's error ladder; nodes, names, clips kept)
 * @param {any} doc @param {number} budget */
export async function decimateTo(doc, budget) {
	const before = drawnTris(doc);
	if (before <= budget) return 0;
	await MeshoptSimplifier.ready;
	await doc.transform(weld());
	for (const error of [0.001, 0.005, 0.01, 0.02, 0.05]) {
		const ratio = budget / drawnTris(doc);
		if (ratio >= 1) break;
		await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }));
		if (drawnTris(doc) <= budget) break;
	}
	return before - drawnTris(doc);
}

/**
 * @param {string} repo @param {string} pack @param {{write?: boolean}} [o]
 * @returns {Promise<number>} files that changed (or would)
 */
export async function passPack(repo, pack, o = {}) {
	const cfg = loadConfig(repo);
	let changed = 0;
	let decimated = 0;
	for (const { row, glb } of packRows(repo, pack)) {
		if (!fs.existsSync(glb)) continue;
		const pol = itemPolicy(cfg, pack, row.name);
		if (!pol) continue;
		const doc = await io.read(glb);
		const did = [];
		if (pol.emissive === 'none') {
			const n = dropAllEmissive(doc);
			if (n) did.push(`emissive dropped on ${n} material(s)`);
		}
		const capped = await capTextures(doc, pol.textureCap);
		if (capped) did.push(`${capped} texture(s) resized to ${pol.textureCap}`);
		const tris = await decimateTo(doc, pol.budget);
		if (tris) {
			did.push(`decimated by ${tris} triangles to the ${pol.category} budget ${pol.budget}`);
			decimated++;
		}
		const fitted = await fitShareCap(doc, cfg.packs.limits.glbFailBytes);
		if (fitted) did.push(`${fitted} opaque PNG texture(s) → JPEG to fit the 5 MiB share cap`);
		if (!did.length) continue;
		changed++;
		const rel = path.relative(repo, glb);
		if (o.write) {
			const before = fs.statSync(glb).size;
			await io.write(glb, doc);
			console.log(`${rel}: ${did.join('; ')} (${before} → ${fs.statSync(glb).size} bytes)`);
		} else console.log(`${rel}: would — ${did.join('; ')}`);
	}
	if (decimated) console.log(`${pack}: ${decimated} LOD0(s) decimated — run: node tools/kit-build/kit-build.mjs lod ${pack}`);
	// core 39 P4: a rewritten file has new tris / bytes (maybe a new box) — its row says so too
	if (o.write && changed) {
		const { dimsPacks } = await import('./dims.mjs');
		await dimsPacks(repo, [pack], { write: true, log: () => {} });
	}
	return changed;
}

/**
 * Render each row's screenshot (512², transparent, yaw 35° — tools/meshy's thumbnailer, the one
 * every kit used) to the path the row names (thumb.webp when it names none).
 * @param {string} repo @param {string} pack @param {string[] | null} only
 */
export async function thumbsPack(repo, pack, only) {
	const { renderThumbs } = await tool('lib/thumb.js');
	const todo = packRows(repo, pack)
		.filter(({ row, glb }) => (!only || only.includes(row.name)) && fs.existsSync(glb) && !isUrl(row.screenshot))
		.map(({ row, dir, glb }) => ({ glb, out: path.join(dir, row.screenshot ?? 'thumb.webp') }));
	if (todo.length) await renderThumbs(todo, { size: 512, bg: null, yaw: 35 });
	return todo.length;
}
