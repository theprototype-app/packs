// dims: what each pack item IS, written onto its row so the app knows an item's size before it
// downloads it (core roadmap 39 P4 — the drag-to-place ghost draws a not-yet-loaded item as its
// box with W × D × H, and the Explorer shows the download size).
//
//   size      [x, y, z] extents in metres = width, height, depth (the GLB as shipped)
//   box       [minX, minY, minZ, maxX, maxY, maxZ] — the exact bounds, so a top-centre or wall
//             pivot draws right (the shape core's packRef.box already uses)
//   tris      LOD0's drawn triangles
//   bytes     LOD0's file size
//   animated  true when the GLB carries clips (it places as bytes, not as a kit reference)
//
// `dims --write` measures and writes; `check` reports a row whose dims are missing or stale (a
// `pass --write` that decimated a file changes its tris and bytes).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { inspectGlb } from './inspect.mjs';

export const DIM_KEYS = ['size', 'box', 'tris', 'bytes', 'animated'];
const isUrl = (/** @type {any} */ p) => typeof p === 'string' && /^https?:\/\//.test(p);
const r3 = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;

/** The dims block for an inspected GLB. @param {{bytes: number, tris: number, min: number[], max: number[], animations: string[]}} info */
export function dimsOf(info) {
	const box = [...info.min, ...info.max].map(r3);
	return {
		size: [0, 1, 2].map((i) => r3(box[i + 3] - box[i])),
		box,
		tris: info.tris,
		bytes: info.bytes,
		...(info.animations.length ? { animated: true } : {})
	};
}

/** A row with its dims replaced (other keys keep their order; dims go last). @param {any} row @param {any} dims */
export function withDims(row, dims) {
	const out = {};
	for (const [k, v] of Object.entries(row)) if (!DIM_KEYS.includes(k)) out[k] = v;
	return Object.assign(out, dims);
}

/**
 * What is wrong with a row's dims against the measured file, or null. A millimetre of slack on
 * the bounds (the file round-trips floats); tris and bytes must match exactly.
 * @param {any} row @param {any} info @returns {string | null}
 */
export function dimsProblem(row, info) {
	const want = dimsOf(info);
	if (!Array.isArray(row.size) || !Array.isArray(row.box) || typeof row.tris !== 'number' || typeof row.bytes !== 'number')
		return 'no dims (size/box/tris/bytes) — run `kit-build dims <pack> --write`';
	const off = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a.length !== b.length || a.some((v, i) => Math.abs(v - b[i]) > 0.0015);
	if (off(row.size, want.size) || off(row.box, want.box)) return `dims are stale: box ${JSON.stringify(row.box)} vs measured ${JSON.stringify(want.box)} — run \`kit-build dims <pack> --write\``;
	if (row.tris !== want.tris) return `dims are stale: tris ${row.tris} vs measured ${want.tris}`;
	if (row.bytes !== want.bytes) return `dims are stale: bytes ${row.bytes} vs measured ${want.bytes}`;
	if (!!row.animated !== !!want.animated) return `dims are stale: animated ${!!row.animated} vs ${!!want.animated}`;
	return null;
}

/** Detect a JSON file's indent (its shallowest one) so a rewrite keeps the house style. @param {string} text */
function indentOf(text) {
	let best = null;
	for (const m of text.matchAll(/\n([ \t]+)\S/g)) if (best === null || m[1].length < best.length) best = m[1];
	return best ?? '  ';
}

/** JSON in the house style, with the dims' number arrays kept on one line. @param {any} v @param {string} indent */
export function stringifyRows(v, indent) {
	return JSON.stringify(v, null, indent).replace(/\[\s+(-?[\d.e+-]+(?:,\s+-?[\d.e+-]+)*)\s+\]/g, (_, body) => '[' + body.split(/,\s+/).join(', ') + ']');
}

/**
 * Measure every row of the given packs and (with `write`) write the dims onto the rows. Remote
 * rows (absolute glb URLs, the Khronos index) are downloaded to a temp folder with `remote`.
 * @param {string} repo @param {string[] | null} packs
 * @param {{write?: boolean, remote?: boolean, log?: (s: string) => void}} [o]
 * @returns {Promise<{pack: string, rows: number, changed: number, skipped: string[]}[]>}
 */
export async function dimsPacks(repo, packs, o = {}) {
	const log = o.log ?? ((s) => console.log(s));
	const index = JSON.parse(fs.readFileSync(path.join(repo, 'index.json'), 'utf8'));
	const out = [];
	const tmp = o.remote ? fs.mkdtempSync(path.join(os.tmpdir(), 'kit-dims-')) : '';
	for (const entry of index) {
		if (!entry?.value || isUrl(entry.value)) continue;
		if (packs && packs.length && !packs.includes(entry.name)) continue;
		const listFile = path.join(repo, entry.value);
		const text = fs.readFileSync(listFile, 'utf8');
		const rows = JSON.parse(text);
		const base = path.dirname(listFile);
		let changed = 0;
		const skipped = [];
		const next = [];
		for (const row of rows) {
			const ref = row?.variants?.['glTF-Binary'];
			let file = '';
			if (typeof ref === 'string' && isUrl(ref)) {
				if (!o.remote) {
					skipped.push(row.name + ' (remote; --remote downloads it)');
					next.push(row);
					continue;
				}
				file = path.join(tmp, `${entry.name}-${row.name}.glb`);
				if (!fs.existsSync(file)) {
					const res = await fetch(ref);
					if (!res.ok) {
						skipped.push(`${row.name} (HTTP ${res.status})`);
						next.push(row);
						continue;
					}
					fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
				}
			} else if (typeof ref === 'string') file = path.join(base, row.name, 'glTF-Binary', ref);
			if (!file || !fs.existsSync(file)) {
				skipped.push(`${row?.name} (no file)`);
				next.push(row);
				continue;
			}
			const info = await inspectGlb(file);
			const fresh = withDims(row, dimsOf(info));
			if (JSON.stringify(fresh) !== JSON.stringify(row)) changed++;
			next.push(fresh);
		}
		if (o.write && changed) {
			const nl = text.includes('\r\n') ? '\r\n' : '\n';
			fs.writeFileSync(listFile, stringifyRows(next, indentOf(text)).replace(/\n/g, nl) + (text.endsWith('\n') ? nl : ''));
		}
		log(`${entry.name}: ${rows.length} rows, ${changed} ${o.write ? 'written' : 'would change'}${skipped.length ? `, skipped ${skipped.join(', ')}` : ''}`);
		out.push({ pack: entry.name, rows: rows.length, changed, skipped });
	}
	if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
	return out;
}
