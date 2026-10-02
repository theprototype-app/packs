// flicker: the z-fight gate's two probes.
//
// STATIC (CI, every PR): tools/lod/coplanar.mjs — triangle pairs in one plane (facing within 1°,
// corners within 1 mm; both facings when the material is double-sided) overlapping by > 1 mm².
// Deterministic, no GPU, ~15 s for every pack. But it OVER-counts: a coplanar pair hidden inside a
// piece, or one whose two layers carry the same texels, never shows. 33-pack-fix-lod therefore
// judged every file by a RENDER: defight rewrites a file only when the render flickers clearly less.
//
// RENDER (local, headless Chromium — tools/lod/judge.mjs `flicker`): 12 orbit poses, each a
// micro-triplet (±0.02°); a pixel flickers when the middle frame disagrees with both neighbours while
// they agree — the in-app probe's metric, offline.
//
// `kit-build flicker <pack…> --record` renders every file over the static limit and records it in
// flicker-baseline.json {file: {cm2, pairs, px, why}} — refused (not recorded, exit 1) when the render
// flickers more than LIMIT_PX. The CI then lets such a file through at its recorded area, never worse.
import fs from 'node:fs';
import path from 'node:path';
import { probeFile } from '../../lod/coplanar.mjs';
import { loadConfig } from './check.mjs';
import { packRows } from './pass.mjs';

/** the render flicker a recorded file may have at most (512², 12 poses — see the header) */
export const LIMIT_PX = 400;

/**
 * @param {string} repo @param {string[]} packs @param {{record?: boolean}} [o]
 */
export async function flickerPacks(repo, packs, o = {}) {
	const cfg = loadConfig(repo);
	const limit = cfg.packs.limits.flickerCm2;
	const basePath = path.join(repo, 'tools/kit-build/flicker-baseline.json');
	const doc = fs.existsSync(basePath) ? JSON.parse(fs.readFileSync(basePath, 'utf8')) : { files: {} };
	const defight = fs.existsSync(path.join(repo, 'tools/lod/defight-report.json')) ? JSON.parse(fs.readFileSync(path.join(repo, 'tools/lod/defight-report.json'), 'utf8')) : {};
	/** @type {any} */
	let judge = null;
	let refused = 0;
	try {
		for (const pack of packs) {
			for (const { row, glb } of packRows(repo, pack)) {
				const files = [glb, ...(Array.isArray(row.lods) ? row.lods.map((/** @type {any} */ l) => path.join(path.dirname(glb), l.file)) : [])];
				for (const f of files) {
					if (!fs.existsSync(f)) continue;
					const rel = path.relative(repo, f);
					const pr = await probeFile(f);
					const cm2 = +(pr.area * 1e4).toFixed(2);
					if (cm2 <= limit) {
						if (o.record && doc.files[rel]) delete doc.files[rel];
						continue;
					}
					if (!o.record) {
						const bl = doc.files[rel];
						console.log(`${bl ? (cm2 <= bl.cm2 * 1.02 + 0.05 ? 'baseline' : 'WORSE   ') : 'OVER    '} ${rel}: ${pr.pairs} pairs, ${cm2} cm²${bl ? ` (recorded ${bl.cm2} cm², ${bl.px} px)` : ''}`);
						continue;
					}
					if (!judge) {
						const { Judge } = await import('../../lod/judge.mjs');
						judge = new Judge();
						await judge.open();
					}
					const px = await judge.flicker(fs.readFileSync(f));
					const isLod0 = f === glb;
					const d = defight[`${pack}/${row.name}`];
					const why = isLod0
						? d?.left
							? `defight left it: ${d.left}${d.flicker ? ` (render ${d.flicker[0]} → ${d.flicker[1]} px)` : ''}`
							: d?.mode
								? `defight (${d.mode}) settled the visible layers; the rest are hidden`
								: 'not in defight-report.json (built before tools/lod or outside it)'
						: `a level of ${row.name}: tools/lod simplifies LOD0 per primitive and only drops hidden duplicates (core draws it far away, with LOD0's material)`;
					if (px > LIMIT_PX) {
						refused++;
						console.log(`REFUSED  ${rel}: ${pr.pairs} pairs, ${cm2} cm², render ${px} px > ${LIMIT_PX} — fix it (tools/lod/defight-all.mjs ${pack})`);
						continue;
					}
					doc.files[rel] = { cm2, pairs: pr.pairs, px, why };
					console.log(`recorded ${rel}: ${pr.pairs} pairs, ${cm2} cm², render ${px} px`);
				}
			}
		}
	} finally {
		await judge?.close();
	}
	if (o.record) {
		const files = Object.fromEntries(Object.entries(doc.files).sort(([a], [b]) => a.localeCompare(b)));
		const out = {
			note: `The static z-fight probe's accepted files (kit-build check: a file over ${limit} cm² of coplanar overlap passes only at or under its recorded area). Each was RENDERED (tools/lod/judge.mjs flicker: 512², 12 orbit poses) and flickers at most ${LIMIT_PX} px; px = that measurement. Written by: node tools/kit-build/kit-build.mjs flicker <pack> --record`,
			limitPx: LIMIT_PX,
			files
		};
		fs.writeFileSync(basePath, JSON.stringify(out, null, 1) + '\n');
		console.log(`${Object.keys(files).length} file(s) in flicker-baseline.json${refused ? `, ${refused} REFUSED` : ''}`);
	}
	if (refused) process.exitCode = 1;
}
