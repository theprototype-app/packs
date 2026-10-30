// tools/characters-kit/build.mjs — the characters-kit pack (core roadmap 57 M5): CC0 humanoids for the
// Characters & motion work — every one maps onto VRM 1.0's humanoid, so any motion-kit clip plays on it.
//
//   node tools/characters-kit/build.mjs [--src <cache dir>]
//   node tools/kit-build/kit-build.mjs thumbs characters-kit --only MannequinFemale,MannequinMale
//   node tools/kit-build/kit-build.mjs dims characters-kit --write
//
// Sources (tools/characters-kit/sources.json, every file pinned by sha256):
//  - 100Avatars R1 / R2 by Polygonal Mind (CC0 1.0), the VRM files as listed by the Open Source
//    Avatars registry (github.com/ToxSam/open-source-avatars, itself CC0). Shipped AS THEY ARE: a VRM's
//    own meta is its licence statement, and the licence lint (tools/licence-lint) reads it per file.
//    R3 is left out on purpose: its files point at an extra licence URL beside "CC0".
//  - Quaternius' Universal Animation Library mannequins (CC0 1.0, OpenGameArt): the female one from
//    UAL 2 Standard as it ships; the male one from UAL 1 Standard with its 46 clips taken OUT (they ship
//    in motion-kit, once).
// Outputs: characters-kit/<Item>/glTF-Binary/<file>, <Item>/thumb.webp, default.json, licences.json
// (one record per shipped file — what the lint checks), attribution.html.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { load, makeIO, REPO } from '../kit-build/lib/deps.mjs';

const { prune } = await load('@gltf-transform/functions');
const sharp = (await load('sharp')).default;

const args = process.argv.slice(2);
const opt = (/** @type {string} */ name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};
const SRC = opt('--src') || path.join(os.homedir(), '.cache/tp-characters-kit');
const OUT = path.join(REPO, 'characters-kit');
const sources = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/characters-kit/sources.json'), 'utf8'));

const sha = (/** @type {Buffer} */ b) => crypto.createHash('sha256').update(b).digest('hex');

/** a pinned download (cached) @param {string} url @param {string} want @param {string} name */
async function fetchPinned(url, want, name) {
	fs.mkdirSync(SRC, { recursive: true });
	const file = path.join(SRC, name);
	if (!fs.existsSync(file) || sha(fs.readFileSync(file)) !== want) {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
		fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
	}
	const got = sha(fs.readFileSync(file));
	if (got !== want) throw new Error(`${name}: sha256 ${got} is not the pinned ${want}`);
	return file;
}

/** a 512² transparent webp from any image @param {Buffer | string} input @param {string} out */
async function thumb(input, out) {
	await sharp(input, { animated: false })
		.resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.webp({ quality: 82 })
		.toFile(out);
}

/** @type {any[]} */
const rows = [];
/** @type {Record<string, any>} */
const licences = {};
fs.mkdirSync(OUT, { recursive: true });

for (const v of sources.vrm) {
	const vrm = await fetchPinned(v.url, v.sha256, `100avatars-${v.series}-${v.number}-${v.name}.vrm`);
	const png = await fetchPinned(v.thumbnail, v.thumbnailSha256, `100avatars-${v.series}-${v.number}-${v.name}-thumb.png`);
	const dir = path.join(OUT, v.name, 'glTF-Binary');
	fs.mkdirSync(dir, { recursive: true });
	fs.copyFileSync(vrm, path.join(dir, v.file));
	await thumb(png, path.join(OUT, v.name, 'thumb.webp'));
	const credit = { licence: 'CC0-1.0', author: 'Polygonal Mind', title: `100Avatars ${v.series} #${v.number} ${v.name}`, source: `https://github.com/ToxSam/open-source-avatars (id ${v.registryId})`, url: v.url };
	licences[`${v.name}/glTF-Binary/${v.file}`] = { ...credit, sha256: v.sha256 };
	licences[`${v.name}/thumb.webp`] = { ...credit, note: 'the registry thumbnail, resized' };
	rows.push({ name: v.name, screenshot: 'thumb.webp', label: `${v.name} (VRM avatar, 100Avatars ${v.series} #${v.number})`, variants: { 'glTF-Binary': v.file } });
}

const io = makeIO();
for (const q of sources.quaternius) {
	const zip = await fetchPinned(q.zip, q.sha256, path.basename(new URL(q.zip).pathname));
	// unpack once beside the cached zip (unzip treats an entry name with [ ] as a wildcard pattern)
	const unpacked = zip.replace(/\.zip$/, '');
	if (!fs.existsSync(path.join(unpacked, q.entry))) execFileSync('unzip', ['-o', '-q', zip, '-d', unpacked]);
	const bytes = fs.readFileSync(path.join(unpacked, q.entry));
	const dir = path.join(OUT, q.name, 'glTF-Binary');
	fs.mkdirSync(dir, { recursive: true });
	const out = path.join(dir, q.file);
	if (q.stripAnimations) {
		const doc = await io.readBinary(new Uint8Array(bytes));
		// dispose the samplers' accessors too: an orphan animation sampler still references them
		for (const a of doc.getRoot().listAnimations()) {
			for (const smp of a.listSamplers()) {
				smp.getInput()?.dispose();
				smp.getOutput()?.dispose();
				smp.dispose();
			}
			for (const ch of a.listChannels()) ch.dispose();
			a.dispose();
		}
		await doc.transform(prune());
		fs.writeFileSync(out, await io.writeBinary(doc));
	} else fs.writeFileSync(out, bytes);
	const credit = { licence: 'CC0-1.0', author: 'Quaternius', title: q.stripAnimations ? 'Universal Animation Library mannequin (male)' : 'Universal Animation Library 2 mannequin (female)', source: q.zip, url: 'https://quaternius.com' };
	licences[`${q.name}/glTF-Binary/${q.file}`] = { ...credit, sha256: sha(fs.readFileSync(out)) };
	licences[`${q.name}/thumb.webp`] = { ...credit, note: 'rendered by kit-build thumbs' };
	rows.push({ name: q.name, screenshot: 'thumb.webp', label: `${q.stripAnimations ? 'Male' : 'Female'} mannequin (Quaternius, rigged — motion-kit clips play on it)`, variants: { 'glTF-Binary': q.file } });
}

// keep measured dims from an earlier `dims --write`
const listFile = path.join(OUT, 'default.json');
const old = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, 'utf8')) : [];
for (const r of rows) Object.assign(r, Object.fromEntries(Object.entries(old.find((/** @type {any} */ o) => o.name === r.name) ?? {}).filter(([k]) => ['size', 'box', 'tris', 'bytes', 'animated'].includes(k))));
fs.writeFileSync(listFile, JSON.stringify(rows, null, '\t') + '\n');
fs.writeFileSync(path.join(OUT, 'licences.json'), JSON.stringify(licences, null, '\t') + '\n');
console.log(`characters-kit: ${rows.length} items, ${Object.keys(licences).length} licence records`);
