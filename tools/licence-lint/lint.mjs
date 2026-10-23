// tools/licence-lint/lint.mjs — the PER-FILE licence lint (core roadmap 57 M5): a pack that ships a
// `licences.json` must account for EVERY file it ships, and each file must say the same thing itself.
//
//   node tools/licence-lint/lint.mjs [pack…] [--json out.json]
//
// Rules (CC0 only — the 57 packs take nothing else):
//  - every file under the pack (but the pack's own manifests / attribution) has a record
//    {licence, author, source} in licences.json, licence 'CC0-1.0', and its sha256 when recorded;
//  - a .vrm states CC0 in its OWN meta: VRM 0.x licenseName 'CC0' (commercial use allowed, no extra
//    licence URL); VRM 1.0 has no CC0 field, so it must grant everything CC0 does (redistribution,
//    commercial use by a corporation, modification + redistribution, no credit required);
//  - a .tpanim (57 M1 clip file) carries extras.theprototype {kind: 'clip'} and its provenance names
//    the same CC0 licence; a humanoid clip names its hips in VRMC_vrm_animation;
//  - the pack's index row (index.json or clips-index.json) says CC0-1.0.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readGlb } from '../motion-kit/glbjson.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OWN = new Set(['licences.json', 'default.json', 'clips.json', 'attribution.html', 'kit.md']);
const ALLOWED = ['CC0-1.0'];

/** @param {string} dir @returns {string[]} */
function walk(dir) {
	/** @type {string[]} */
	const out = [];
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) out.push(...walk(p));
		else out.push(p);
	}
	return out;
}

/**
 * A VRM's own licence statement -> problems ([] = CC0).
 * @param {any} json @returns {string[]}
 */
export function vrmLicenceProblems(json) {
	const v1 = json.extensions?.VRMC_vrm;
	const v0 = json.extensions?.VRM;
	if (!v1 && !v0) return ['a .vrm without the VRM extension'];
	if (v0) {
		const m = v0.meta ?? {};
		const out = [];
		if (m.licenseName !== 'CC0') out.push(`VRM 0.x licenseName is "${m.licenseName ?? ''}", not CC0`);
		if (m.commercialUssageName && m.commercialUssageName !== 'Allow') out.push('VRM 0.x disallows commercial use');
		if (m.otherLicenseUrl) out.push(`VRM 0.x names another licence (${m.otherLicenseUrl})`);
		return out;
	}
	const m = v1.meta ?? {};
	const out = [];
	if (m.allowRedistribution !== true) out.push('VRM 1.0 does not allow redistribution');
	if (m.commercialUsage !== 'corporation') out.push(`VRM 1.0 commercialUsage is "${m.commercialUsage}"`);
	if (m.modification !== 'allowModificationRedistribution') out.push(`VRM 1.0 modification is "${m.modification}"`);
	if (m.creditNotation && m.creditNotation !== 'unnecessary') out.push('VRM 1.0 requires credit');
	if (m.otherLicenseUrl) out.push(`VRM 1.0 names another licence (${m.otherLicenseUrl})`);
	return out;
}

/** a .tpanim's own statement -> problems @param {any} json @param {string} licence */
export function clipLicenceProblems(json, licence) {
	const meta = json.extras?.theprototype;
	const out = [];
	if (meta?.kind !== 'clip' || meta?.format !== 1) out.push('not a .tpanim (extras.theprototype {format: 1, kind: "clip"})');
	const lic = (meta?.provenance ?? []).map((/** @type {any} */ p) => p?.licence?.id).filter(Boolean);
	if (!lic.length) out.push('its provenance names no licence');
	else if (lic.some((/** @type {string} */ l) => l !== licence)) out.push(`its provenance says ${lic.join(', ')}, the record ${licence}`);
	if (meta?.skeleton?.humanoid && !json.extensions?.VRMC_vrm_animation?.humanoid?.humanBones?.hips) out.push('a humanoid clip without VRMC_vrm_animation hips');
	return out;
}

/** @param {{packs?: string[], repo?: string}} [o] */
export function lint(o = {}) {
	const REPO = o.repo ?? ROOT;
	/** @type {{level: 'error'|'warn', pack: string, file: string, msg: string}[]} */
	const findings = [];
	const add = (/** @type {'error'|'warn'} */ level, /** @type {string} */ pack, /** @type {string} */ file, /** @type {string} */ msg) => findings.push({ level, pack, file, msg });
	const index = [...JSON.parse(fs.readFileSync(path.join(REPO, 'index.json'), 'utf8')), ...(fs.existsSync(path.join(REPO, 'clips-index.json')) ? JSON.parse(fs.readFileSync(path.join(REPO, 'clips-index.json'), 'utf8')) : [])];
	const packs = (o.packs?.length ? o.packs : fs.readdirSync(REPO).filter((d) => fs.existsSync(path.join(REPO, d, 'licences.json'))));
	for (const pack of packs) {
		const base = path.join(REPO, pack);
		const recFile = path.join(base, 'licences.json');
		if (!fs.existsSync(recFile)) {
			add('error', pack, '-', 'no licences.json');
			continue;
		}
		const records = JSON.parse(fs.readFileSync(recFile, 'utf8'));
		const row = index.find((r) => r.name === pack);
		if (!row) add('error', pack, '-', 'not listed in index.json / clips-index.json');
		else if (!ALLOWED.includes(row.license)) add('error', pack, '-', `the index says ${row.license || '(none)'} — these packs are CC0 only`);
		const seen = new Set();
		for (const file of walk(base)) {
			const rel = path.relative(base, file).split(path.sep).join('/');
			if (OWN.has(rel)) continue;
			seen.add(rel);
			const rec = records[rel];
			if (!rec) {
				add('error', pack, rel, 'no licence record in licences.json');
				continue;
			}
			if (!ALLOWED.includes(rec.licence)) add('error', pack, rel, `licence ${rec.licence} is not CC0-1.0`);
			if (!rec.author || !rec.source) add('error', pack, rel, 'the record names no author / source');
			const bytes = fs.readFileSync(file);
			if (rec.sha256 && crypto.createHash('sha256').update(bytes).digest('hex') !== rec.sha256) add('error', pack, rel, 'the file is not the one the record pinned (sha256)');
			if (/\.(vrm|glb|tpanim)$/i.test(rel)) {
				let json;
				try {
					json = readGlb(bytes).json;
				} catch (e) {
					add('error', pack, rel, 'not a GLB: ' + /** @type {Error} */ (e).message);
					continue;
				}
				if (/\.vrm$/i.test(rel)) for (const m of vrmLicenceProblems(json)) add('error', pack, rel, m);
				if (/\.tpanim$/i.test(rel)) for (const m of clipLicenceProblems(json, rec.licence)) add('error', pack, rel, m);
				const copy = json.asset?.copyright;
				if (/\.glb$/i.test(rel) && copy && !/cc0|public domain/i.test(copy)) add('warn', pack, rel, `asset.copyright says "${copy}"`);
			}
		}
		for (const rel of Object.keys(records)) if (!seen.has(rel)) add('warn', pack, rel, 'a licence record for a file the pack does not ship');
	}
	return findings;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const j = args.indexOf('--json');
	const out = j >= 0 ? args[j + 1] : null;
	const packs = args.filter((a, i) => !a.startsWith('--') && (j < 0 || i !== j + 1));
	const findings = lint({ packs });
	for (const f of findings) console.log(`${f.level.toUpperCase().padEnd(5)} ${f.pack}/${f.file}: ${f.msg}`);
	const errors = findings.filter((f) => f.level === 'error').length;
	console.log(`licence lint: ${errors} error(s), ${findings.length - errors} warning(s)`);
	if (out) fs.writeFileSync(out, JSON.stringify(findings, null, 2));
	process.exit(errors ? 1 : 0);
}
