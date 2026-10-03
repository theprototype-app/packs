// check: the pack CI (roadmap 34 E2) — every rule a packs PR must pass, over every pack in index.json.
//
//   index     index.json rows: shape, files exist
//   manifest  each pack's model list: row shape (incl. `lods`, `behavior`), names unique, files exist,
//             no orphan GLBs
//   size      every GLB ≤ 5 MiB (the share cap: bigger never reaches a peer), warn > 2 MiB
//   tris      LOD0 triangles ≤ the item's category budget (packs.json)
//   textures  largest texture side ≤ the pack's cap
//   emissive  a pack whose policy is "none" has nothing that glows; an emissive map with a black
//             factor is a wasted texture fetch (warn)
//   scale     the bbox is in metres (category's largest extent, never a speck)
//   pivot     the origin is where the item's pivot rule says (bottom-centre unless packs.json says)
//   lods      items over 2 000 triangles ship LOD files; each file exists, is coarser than LOD0, keeps
//             LOD0's mesh-node names and clips, and its ratio is the measured one (± 0.05)
//   behavior  a behavior's clips exist in the GLB (and in every LOD file)
//   flicker   the static z-fight probe (tools/lod/coplanar.mjs: coplanar triangle pairs, both facings
//             when double-sided) ≤ 1 cm² — or no worse than the file's recorded baseline
//             (flicker-baseline.json, written by `kit-build flicker --record` after a RENDER probe)
//   thumb     the row's screenshot exists and decodes, ≥ 64 px
//
// A failure is an ERROR unless allow.json lists it (pack, item, check) with a reason; an allow-list
// entry that matched nothing is reported so it gets cleaned up.
import fs from 'node:fs';
import path from 'node:path';
import { load } from './deps.mjs';
import { inspectGlb } from './inspect.mjs';
import { indexRowProblems, itemRowProblems, behaviorClipProblems, pivotProblem, scaleProblem, safeRel } from './rules.mjs';
import { probeFile } from '../../lod/coplanar.mjs';

const sharp = (await load('sharp')).default;
const isUrl = (/** @type {any} */ p) => typeof p === 'string' && /^https?:\/\//.test(p);
const KB = (/** @type {number} */ b) => `${(b / 1024 / 1024).toFixed(2)} MiB`;

/** @param {string} repo */
export function loadConfig(repo) {
	const dir = path.join(repo, 'tools/kit-build');
	const read = (/** @type {string} */ f, /** @type {any} */ dflt) => (fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) : dflt);
	return { packs: read('packs.json', null), allow: read('allow.json', { allow: [] }).allow, baseline: read('flicker-baseline.json', { files: {} }).files };
}

/** the item's resolved policy @param {any} cfg @param {string} pack @param {string} item */
export function itemPolicy(cfg, pack, item) {
	const p = cfg.packs.packs[pack];
	if (!p) return null;
	const o = p.items?.[item] ?? {};
	const category = o.category ?? p.category;
	const cat = cfg.packs.categories[category];
	if (!cat) throw new Error(`packs.json: ${pack}/${item} has unknown category "${category}"`);
	return { category, budget: cat.tris, maxExtent: cat.maxExtent, pivot: o.pivot ?? p.pivot ?? 'bottom-center', textureCap: o.textureCap ?? p.textureCap, emissive: p.emissive };
}

/**
 * @param {string} repo the packs checkout
 * @param {{packs?: string[] | null, flicker?: boolean}} [o]
 */
export async function runChecks(repo, o = {}) {
	const cfg = loadConfig(repo);
	const L = cfg.packs.limits;
	/** @type {{level: 'error'|'warn', pack: string, item: string, check: string, msg: string, file?: string, allowed?: string}[]} */
	const findings = [];
	/** @type {any[]} */
	const items = [];
	const add = (/** @type {'error'|'warn'} */ level, /** @type {string} */ pack, /** @type {string} */ item, /** @type {string} */ check, /** @type {string} */ msg, /** @type {string} */ file = '') =>
		findings.push({ level, pack, item, check, msg, ...(file ? { file } : {}) });

	const index = JSON.parse(fs.readFileSync(path.join(repo, 'index.json'), 'utf8'));
	if (!Array.isArray(index)) add('error', '-', '-', 'index', 'index.json is not an array');
	const seenPacks = new Set();
	/** baseline entries a file over the limit leaned on */
	const baselineUsed = new Set();
	for (const row of index) {
		const name = row?.name ?? '?';
		for (const m of indexRowProblems(row)) add('error', name, '-', 'index', m);
		if (seenPacks.has(name)) add('error', name, '-', 'index', 'duplicate pack name');
		seenPacks.add(name);
		for (const k of ['value', 'attribution', 'cover']) if (typeof row[k] === 'string' && !isUrl(row[k]) && !fs.existsSync(path.join(repo, row[k]))) add('error', name, '-', 'index', `${k} ${row[k]} does not exist`);
		if (typeof row.zip === 'string' && !fs.existsSync(path.join(repo, row.zip.replace(/^\//, '')))) add('error', name, '-', 'index', `zip ${row.zip} does not exist`);
		if (row.value && !cfg.packs.packs[name]) add('error', name, '-', 'index', 'pack has no policy in tools/kit-build/packs.json (texture cap, emissive, category, pivot)');
	}

	for (const row of index) {
		if (!row?.value || isUrl(row.value)) continue;
		const pack = row.name;
		if (o.packs && !o.packs.includes(pack)) continue;
		const listFile = path.join(repo, row.value);
		if (!fs.existsSync(listFile)) continue;
		/** @type {any[]} */
		let rows;
		try {
			rows = JSON.parse(fs.readFileSync(listFile, 'utf8'));
		} catch (e) {
			add('error', pack, '-', 'manifest', `${row.value} is not JSON: ${/** @type {Error} */ (e).message}`);
			continue;
		}
		if (!Array.isArray(rows)) {
			add('error', pack, '-', 'manifest', `${row.value} is not an array`);
			continue;
		}
		const base = path.dirname(listFile);
		const referenced = new Set();
		const names = new Set();
		for (const r of rows) {
			const item = r?.name ?? '?';
			for (const m of itemRowProblems(r)) add('error', pack, item, 'manifest', m);
			if (names.has(item)) add('error', pack, item, 'manifest', 'duplicate item name');
			names.add(item);
			const glbRef = r?.variants?.['glTF-Binary'];
			if (typeof glbRef !== 'string' || isUrl(glbRef) || !safeRel(glbRef)) continue; // upstream-fetch rows (khronos) carry no bytes here
			const dir = path.join(base, item);
			const glb = path.join(dir, 'glTF-Binary', glbRef);
			referenced.add(path.resolve(glb));
			if (!fs.existsSync(glb)) {
				add('error', pack, item, 'manifest', `glTF-Binary/${glbRef} does not exist`);
				continue;
			}
			const pol = itemPolicy(cfg, pack, item);
			const info = await inspectGlb(glb);
			const rec = { ...info, pack, item, file: path.relative(repo, glb), category: pol?.category, budget: pol?.budget, lods: [] };
			items.push(rec);
			// size
			const sizeCheck = (/** @type {string} */ f, /** @type {number} */ bytes) => {
				if (bytes > L.glbFailBytes) add('error', pack, item, 'size', `${path.basename(f)} is ${KB(bytes)} — over the 5 MiB share cap (it never reaches a peer)`, f);
				else if (bytes > L.glbWarnBytes) add('warn', pack, item, 'size', `${path.basename(f)} is ${KB(bytes)} (> 2 MiB)`, f);
			};
			sizeCheck(rec.file, info.bytes);
			if (pol) {
				if (info.tris > pol.budget) add('error', pack, item, 'tris', `${info.tris} triangles is over the ${pol.category} budget of ${pol.budget} — decimate (kit-build pass --write) or re-categorise`);
				const big = Math.max(0, ...info.textures.map((t) => Math.max(...(t.size ?? [0]))));
				if (big > pol.textureCap) add('error', pack, item, 'textures', `a ${big}² texture is over the pack's ${pol.textureCap} cap (kit-build pass --write)`);
				if (pol.emissive === 'none') {
					const lit = info.materials.filter((m) => m.emissive || m.emissiveTexture).map((m) => m.name || '(unnamed)');
					if (lit.length) add('error', pack, item, 'emissive', `the pack's policy is "nothing glows" but ${lit.join(', ')} ${lit.length > 1 ? 'are' : 'is'} emissive (kit-build pass --write)`);
				}
				const s = scaleProblem(info.size, pol.maxExtent, L.minExtent);
				if (s) add('error', pack, item, 'scale', s);
				const pv = pivotProblem(info.min, info.max, pol.pivot);
				if (pv) add('error', pack, item, 'pivot', `${pv}; rule "${pol.pivot}"`);
			}
			for (const m of info.materials) if (m.emissiveTexture && !m.emissive) add('warn', pack, item, 'emissive', `material ${m.name || '(unnamed)'} has an emissive map with a black factor (a wasted texture)`);
			// lods
			const lods = Array.isArray(r.lods) ? r.lods : [];
			if (!lods.length && info.tris > L.lodRequiredOver) add('error', pack, item, 'lods', `${info.tris} triangles and no LOD files (node tools/kit-build/kit-build.mjs lod ${pack})`);
			for (const l of lods) {
				if (!safeRel(l?.file)) continue;
				const lf = path.join(dir, 'glTF-Binary', l.file);
				referenced.add(path.resolve(lf));
				if (!fs.existsSync(lf)) {
					add('error', pack, item, 'lods', `${l.file} does not exist`);
					continue;
				}
				const li = await inspectGlb(lf);
				rec.lods.push({ file: path.relative(repo, lf), bytes: li.bytes, tris: li.tris, ratio: l.ratio });
				sizeCheck(path.relative(repo, lf), li.bytes);
				if (li.tris >= info.tris) add('error', pack, item, 'lods', `${l.file} has ${li.tris} triangles, not fewer than LOD0's ${info.tris}`);
				const measured = info.tris ? li.tris / info.tris : 0;
				if (typeof l.ratio === 'number' && Math.abs(measured - l.ratio) > 0.05) add('error', pack, item, 'lods', `${l.file}: ratio ${l.ratio} but the file has ${(measured * 100).toFixed(0)} % of LOD0's triangles`);
				const lod0Names = new Set(info.meshNodes);
				const strangers = li.meshNodes.filter((n) => !lod0Names.has(n));
				if (strangers.length && li.meshNodes.length !== info.meshNodes.length) add('error', pack, item, 'lods', `${l.file} has mesh nodes LOD0 does not (${strangers.slice(0, 4).join(', ')}) — core swaps levels BY NODE NAME`);
				const missing = info.animations.filter((a) => !li.animations.includes(a));
				if (missing.length) add('error', pack, item, 'lods', `${l.file} lacks LOD0's clips ${missing.join(', ')} (an animated item keeps animating at every level)`);
				if (r.behavior) for (const m of behaviorClipProblems(r.behavior, li.animations)) add('error', pack, item, 'behavior', `${l.file}: ${m}`);
				if (o.flicker !== false) await flicker(path.relative(repo, lf));
			}
			if (r.behavior) for (const m of behaviorClipProblems(r.behavior, info.animations)) add('error', pack, item, 'behavior', m);
			// thumb
			const shot = r.screenshot;
			if (!isUrl(shot)) {
				const cands = shot ? [shot] : ['thumb.webp', 'thumb.png'];
				const found = cands.map((c) => path.join(dir, c)).find((f) => fs.existsSync(f));
				if (!found) add('error', pack, item, 'thumb', `no thumbnail (${cands.join(' / ')}) — node tools/kit-build/kit-build.mjs thumbs ${pack} --only ${item}`);
				else {
					try {
						const meta = await sharp(found).metadata();
						if (Math.min(meta.width ?? 0, meta.height ?? 0) < L.thumbMinPx) add('error', pack, item, 'thumb', `${path.relative(dir, found)} is ${meta.width}×${meta.height} (< ${L.thumbMinPx} px)`);
					} catch (e) {
						add('error', pack, item, 'thumb', `${path.relative(dir, found)} does not decode: ${/** @type {Error} */ (e).message}`);
					}
				}
			}
			if (o.flicker !== false) await flicker(rec.file);

			/** the static z-fight probe against the 1 cm² limit or the recorded baseline @param {string} f */
			async function flicker(f) {
				const pr = await probeFile(path.join(repo, f));
				const cm2 = pr.area * 1e4;
				const bl = cfg.baseline[f];
				const ref = f === rec.file ? rec : rec.lods.find((/** @type {any} */ x) => x.file === f);
				if (ref) Object.assign(ref, { flickerPairs: pr.pairs, flickerCm2: +cm2.toFixed(2) });
				if (cm2 <= L.flickerCm2) return;
				if (bl) baselineUsed.add(f);
				if (bl && cm2 <= bl.cm2 * 1.02 + 0.05) return;
				add(
					'error',
					pack,
					item,
					'flicker',
					bl
						? `${path.basename(f)}: ${pr.pairs} coplanar pairs, ${cm2.toFixed(1)} cm² — WORSE than its baseline ${bl.cm2} cm²`
						: `${path.basename(f)}: ${pr.pairs} coplanar pairs, ${cm2.toFixed(1)} cm² of overlap (limit ${L.flickerCm2} cm²) — node tools/lod/defight-all.mjs ${pack}, then kit-build flicker ${pack} --record if the render probe passes`,
					f
				);
			}
		}
		// orphans: GLBs under the pack folder that no row references (shipped bytes nobody loads)
		for (const f of walk(base)) if (/\.glb$/i.test(f) && !referenced.has(path.resolve(f))) add('warn', pack, '-', 'manifest', `${path.relative(repo, f)} is not referenced by ${row.value}`, path.relative(repo, f));
	}

	// baseline entries nothing needs any more (the file is gone, or now under the limit)
	if (o.flicker !== false)
		for (const f of Object.keys(cfg.baseline)) {
			const pack = f.split('/')[0];
			if ((!o.packs || o.packs.includes(pack)) && !baselineUsed.has(f)) add('warn', pack, f.split('/')[1] ?? '-', 'flicker', `${f} is in flicker-baseline.json but is gone or now under the limit — re-record: kit-build flicker ${pack} --record`, f);
		}

	// the allow-list
	const used = new Set();
	for (const f of findings) {
		if (f.level !== 'error') continue;
		const hit = cfg.allow.findIndex((/** @type {any} */ a) => a.pack === f.pack && (a.item === f.item || a.item === '*') && a.check === f.check && (!a.file || a.file === f.file));
		if (hit >= 0) {
			f.allowed = cfg.allow[hit].reason;
			used.add(hit);
		}
	}
	cfg.allow.forEach((/** @type {any} */ a, /** @type {number} */ i) => {
		if (!used.has(i) && (!o.packs || o.packs.includes(a.pack))) add('warn', a.pack, a.item, 'allow', `allow-list entry for "${a.check}" matched nothing — remove it from tools/kit-build/allow.json`);
	});
	return { findings, items };
}

/** @param {string} dir @returns {string[]} */
function walk(dir) {
	/** @type {string[]} */
	const out = [];
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '_src' || e.name === 'build') continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) out.push(...walk(p));
		else out.push(p);
	}
	return out;
}
