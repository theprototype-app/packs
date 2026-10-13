// build: kit.json → aquarium-kit/ (the pack), reproducibly, from the staged Meshy outputs (roadmap 40
// F14). Nothing here spends credits: it reads staging/40-aquarium/<job>/<stage>-<n>/raw.glb.
//
//   node tools/aquarium-kit/build.mjs [--only Name,Name]
//   node tools/kit-build/kit-build.mjs lod aquarium-kit && node tools/kit-build/kit-build.mjs thumbs aquarium-kit
//   node tools/kit-build/kit-build.mjs dims aquarium-kit --write && node tools/kit-build/kit-build.mjs check aquarium-kit
//
// Per item: kit-build's post step (meshy-post: weld, decimate to targetTris, real metres, pivot,
// 1024² JPEG; the emissive policy; defight), then two material touches the glTF carries to core:
//   film       — KHR_materials_iridescence on every material: the thin-film flash of a turning fish
//                (core's look tier draws it on desktops and phones and drops it in a headset, 40 F16)
//   doubleSided — thin leaves are seen from both sides (a plant's ribbons have no back faces)
// Output: aquarium-kit/<Name>/glTF-Binary/<file> + aquarium-kit/default.json (the model list; the
// lods / size / box / tris / bytes fields are added by kit-build lod + dims).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kitPost } from '../kit-build/lib/post.mjs';
import { load, makeIO } from '../kit-build/lib/deps.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const kit = JSON.parse(fs.readFileSync(path.join(HERE, 'kit.json'), 'utf8'));
const STAGING = process.env.MESHY_STAGING || path.join(os.homedir(), '.code/lanes-30/meshy/staging', kit.staging);
const PACK = path.join(REPO, kit.pack);
const { KHRMaterialsIridescence } = await load('@gltf-transform/extensions');
const io = makeIO();

const args = process.argv.slice(2);
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;

/** newest staged raw for a job/stage @param {{job: string, stage: string}} src */
function stagedRaw(src) {
	const dir = path.join(STAGING, src.job);
	const n = fs
		.readdirSync(dir)
		.filter((d) => d.startsWith(src.stage + '-') && fs.existsSync(path.join(dir, d, 'raw.glb')))
		.map((d) => Number(d.slice(src.stage.length + 1)))
		.sort((a, b) => b - a)[0];
	if (!n) throw new Error(`no staged ${src.stage} for ${src.job} under ${dir}`);
	return path.join(dir, `${src.stage}-${n}`, 'raw.glb');
}

/** the thin film on every material of a file @param {string} file @param {{factor: number, ior: number, thickness: number[]}} film */
async function addFilm(file, film) {
	const doc = await io.read(file);
	const ext = doc.createExtension(KHRMaterialsIridescence);
	for (const mat of doc.getRoot().listMaterials()) {
		const irid = ext
			.createIridescence()
			.setIridescenceFactor(film.factor)
			.setIridescenceIOR(film.ior)
			.setIridescenceThicknessMinimum(film.thickness[0])
			.setIridescenceThicknessMaximum(film.thickness[1]);
		mat.setExtension('KHR_materials_iridescence', irid);
	}
	await io.write(file, doc);
}

/** @param {string} file */
async function setDoubleSided(file) {
	const doc = await io.read(file);
	for (const mat of doc.getRoot().listMaterials()) mat.setDoubleSided(true);
	await io.write(file, doc);
}

const rows = [];
const report = [];
const existing = fs.existsSync(path.join(PACK, 'default.json')) ? JSON.parse(fs.readFileSync(path.join(PACK, 'default.json'), 'utf8')) : [];
for (const it of kit.items) {
	const prior = existing.find((/** @type {any} */ r) => r.name === it.name);
	if (only && !only.has(it.name)) {
		if (prior) rows.push(prior);
		continue;
	}
	const raw = stagedRaw(it.src);
	const out = path.join(PACK, it.name, 'glTF-Binary', it.file);
	fs.mkdirSync(path.dirname(out), { recursive: true });
	const r = await kitPost(raw, out, { id: it.name, ...it.post });
	if (it.film) await addFilm(out, kit.film);
	if (it.doubleSided) await setDoubleSided(out);
	report.push({ name: it.name, raw: path.relative(STAGING, raw), tris: r.trisOut ?? r.tris, bytes: fs.statSync(out).size, film: !!it.film });
	// keep what kit-build measured last time (lods, dims) until it measures again
	rows.push({ ...(prior ?? {}), name: it.name, screenshot: 'thumb.webp', label: it.label, variants: { 'glTF-Binary': it.file } });
	console.log(`${it.name}: ${path.relative(REPO, out)} (${fs.statSync(out).size} bytes)`);
}
fs.writeFileSync(path.join(PACK, 'default.json'), JSON.stringify(rows, null, 1) + '\n');
fs.writeFileSync(path.join(HERE, 'report.json'), JSON.stringify(report, null, 1) + '\n');
