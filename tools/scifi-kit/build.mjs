// build: kit.json → scifi-kit/ (the pack), reproducibly, from the staged Meshy outputs.
// (Forked from architecture-kit's build, tools/architecture-kit on feat/30c-pack-architecture;
// added: `proc` pieces, procedural kitbash parts, part scale, the flat-for-sync check.)
//
//   node tools/scifi-kit/build.mjs [--only Name,Name] [--no-thumbs]
//
// Every item is ONE of:
//   src      {job, stage}  a Meshy output in staging/30c-pack-scifi/<job>/<stage>-<n>/raw.glb (newest n)
//   from     "OtherItem"   another item's BUILT glb (a derived piece)
//   kitbash  [{from | proc, pos:[x,y,z], rotY, scale}]  built items / procedural pieces merged into one glb (0 credits)
// followed, in this order, by the optional steps:
//   post     kit-post job (pre-rotate, meshy-post: simplify / stretch to dims / pivot / 1024² JPEG, seam clamp)
//   cut      a kit-cut DERIVE name ("door" | "window" | "half" | "gable" | "post") or a raw ops list
// Output: scifi-kit/<Name>/glTF-Binary/<file> + <Name>/screenshot/screenshot.webp,
// scifi-kit/default.json (the model-list the app reads), tools/scifi-kit/report.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TOOLS, kitPost } from './kit-post.mjs';
import { kitCut, DERIVE } from './kit-cut.mjs';
import { writePiece, OPENINGS } from './procedural.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const STAGING = process.env.MESHY_STAGING || path.join(os.homedir(), '.code/lanes-30/meshy/staging/30c-pack-scifi');
const req = createRequire(path.join(TOOLS, 'package.json'));
const load = async (/** @type {string} */ id) => import(pathToFileURL(req.resolve(id)).href);
const { NodeIO } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS } = await load('@gltf-transform/extensions');
const { mergeDocuments, transformMesh, getBounds, unpartition, dedup, prune } = await load('@gltf-transform/functions');
const { countTris } = await import(pathToFileURL(path.join(TOOLS, 'lib/post.js')).href);
const { renderThumbs } = await import(pathToFileURL(path.join(TOOLS, 'lib/thumb.js')).href);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const kit = JSON.parse(fs.readFileSync(path.join(HERE, 'kit.json'), 'utf8'));
const PACK = path.join(REPO, kit.pack);
const args = process.argv.slice(2);
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const byName = new Map(kit.items.map((/** @type {any} */ it) => [it.name, it]));
// an `internal` item (a source other pieces derive from) is built into .build/, never shipped
const glbOf = (/** @type {any} */ it) =>
	it.internal ? path.join(HERE, '.build', it.file) : path.join(PACK, it.name, 'glTF-Binary', it.file);

/** newest staged raw for a job/stage @param {{job: string, stage: string}} src */
function stagedRaw(src) {
	const dir = path.join(STAGING, src.job);
	const n = fs
		.readdirSync(dir)
		.filter((d) => d.startsWith(src.stage + '-') && fs.existsSync(path.join(dir, d, 'raw.glb')))
		.map((d) => Number(d.slice(src.stage.length + 1)))
		.sort((a, b) => b - a)[0];
	if (!n) {
		// while a refine is still cooking, build from its preview so the pipeline and the
		// e2e can run; the report records the stage actually used (a release build has none)
		if (src.stage !== 'preview' && !process.env.KIT_STRICT) return stagedRaw({ ...src, stage: 'preview' });
		throw new Error(`no staged ${src.stage} for ${src.job}`);
	}
	return path.join(dir, `${src.stage}-${n}`, 'raw.glb');
}

/** column-major uniform scale, then Y rotation, then translation */
function trs(/** @type {number[]} */ pos = [0, 0, 0], /** @type {number} */ rotY = 0, /** @type {number} */ k = 1) {
	const a = (rotY * Math.PI) / 180;
	const c = Math.cos(a) * k;
	const s = Math.sin(a) * k;
	return [c, 0, -s, 0, 0, k, 0, 0, s, 0, c, 0, pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0, 1];
}

/** a kitbash part's GLB: a built item, or a procedural piece written into `tmp` */
async function partGlb(/** @type {any} */ p, /** @type {string} */ tmp) {
	if (p.proc) return writePiece(p.proc, path.join(tmp, `proc-${p.proc}.glb`));
	return glbOf(byName.get(p.from));
}

/** merge built parts into one glb @param {any[]} parts @param {string} out @param {string} tmp */
async function kitbash(parts, out, tmp) {
	const target = await io.read(await partGlb(parts[0], tmp));
	for (const m of target.getRoot().listMeshes()) transformMesh(m, /** @type {any} */ (trs(parts[0].pos, parts[0].rotY, parts[0].scale)));
	const scene = target.getRoot().listScenes()[0];
	for (const p of parts.slice(1)) {
		const doc = await io.read(await partGlb(p, tmp));
		for (const m of doc.getRoot().listMeshes()) transformMesh(m, /** @type {any} */ (trs(p.pos, p.rotY, p.scale)));
		mergeDocuments(target, doc);
	}
	for (const extra of target.getRoot().listScenes().slice(1)) {
		for (const node of extra.listChildren()) scene.addChild(node);
		extra.dispose();
	}
	// one buffer (GLB), and the repeated parts share their textures and materials
	await target.transform(unpartition(), dedup(), prune());
	await io.write(out, target);
}

/** @param {any} it */
async function buildItem(it) {
	const out = glbOf(it);
	fs.mkdirSync(path.dirname(out), { recursive: true });
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-build-'));
	try {
		let cur;
		let stage = null;
		if (it.src) {
			cur = stagedRaw(it.src);
			stage = path.basename(path.dirname(cur));
		}
		else if (it.from) cur = glbOf(byName.get(it.from));
		else if (it.proc) cur = await writePiece(it.proc, path.join(tmp, 'proc.glb'));
		else if (it.kitbash) {
			cur = path.join(tmp, 'bash.glb');
			await kitbash(it.kitbash, cur, tmp);
		} else throw new Error(`${it.name}: needs src, from, proc or kitbash`);
		let report = {};
		if (it.post) {
			const next = path.join(tmp, 'post.glb');
			report = await kitPost(cur, next, it.post);
			cur = next;
		}
		if (it.cut) {
			const next = path.join(tmp, 'cut.glb');
			report = { ...report, cut: await kitCut(cur, next, typeof it.cut === 'string' ? DERIVE[it.cut](it.cutOpts ?? OPENINGS[it.cut]) : it.cut) };
			cur = next;
		}
		fs.copyFileSync(cur, out);
		const doc = await io.read(out);
		// FLAT for sync (props-kit finding 2): core's sendObject sends a nested node with its
		// WORLD pose and the peer parents it under the import root again, so every nested
		// level doubles its offset on peer B; GLTFLoader also turns a multi-primitive mesh
		// into a Group. Every shipped piece is leaf nodes straight under the scene.
		const sceneOf = doc.getRoot().listScenes()[0];
		const nested = doc.getRoot().listNodes().filter((n) => !sceneOf.listChildren().includes(n)).length;
		const multi = doc.getRoot().listMeshes().filter((m) => m.listPrimitives().length > 1).length;
		if (nested || multi) throw new Error(`${it.name}: not flat for sync (${nested} nested nodes, ${multi} multi-primitive meshes)`);
		const b = getBounds(doc.getRoot().listScenes()[0]);
		return {
			name: it.name,
			file: path.relative(REPO, out),
			bytes: fs.statSync(out).size,
			tris: countTris(doc),
			size: [0, 1, 2].map((i) => +(b.max[i] - b.min[i]).toFixed(3)),
			min: b.min.map((v) => +v.toFixed(3)),
			max: b.max.map((v) => +v.toFixed(3)),
			textures: doc.getRoot().listTextures().map((t) => t.getSize()?.join('x')),
			clamped: report.clamped ?? 0,
			...(report.glowing ? { glowing: report.glowing } : {}),
			...(stage ? { stage } : {})
		};
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}

const reportPath = path.join(HERE, 'report.json');
const prev = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : {};
const results = { ...prev };
// build in kit order: a derived item always follows the item it derives from
for (const it of kit.items) {
	if (only && !only.has(it.name)) continue;
	const r = await buildItem(it);
	results[it.name] = r;
	console.log(JSON.stringify(r));
	if (!it.internal && r.bytes > 5 * 1024 * 1024) throw new Error(`${it.name}: ${r.bytes} bytes is over the 5 MB share cap`);
}
if (!args.includes('--no-thumbs')) {
	const todo = kit.items.filter((/** @type {any} */ it) => !it.internal && (!only || only.has(it.name)));
	await renderThumbs(
		todo.map((/** @type {any} */ it) => ({ glb: glbOf(it), out: path.join(PACK, it.name, 'screenshot', 'screenshot.webp') })),
		{ size: 512, bg: null, yaw: kit.thumbYaw ?? 35 }
	);
}
// the pack cover: a diorama kitbashed from the kit's own pieces, rendered like a thumbnail
if (kit.cover && !args.includes('--no-thumbs') && (!only || only.has(kit.cover.item))) {
	const bg = kit.cover.bg ?? '#d8d4cc';
	const raw = path.join(os.tmpdir(), `kit-cover-${process.pid}.png`);
	await renderThumbs([{ glb: glbOf(byName.get(kit.cover.item)), out: raw }], { size: 1024, bg, yaw: kit.cover.yaw ?? 35 });
	// the renderer frames the bounding SPHERE; trim to the diorama and pad it back to a square
	const sharp = (await load('sharp')).default;
	const trimmed = await sharp(raw).trim({ background: bg, threshold: 8 }).toBuffer();
	await sharp(trimmed)
		.resize(700, 700, { fit: 'contain', background: bg })
		.extend({ top: 34, bottom: 34, left: 34, right: 34, background: bg })
		.webp({ quality: 84 })
		.toFile(path.join(PACK, 'cover.webp'));
	fs.rmSync(raw, { force: true });
}
// the app's model-list (core packs.js: {name, label, screenshot, variants: {'glTF-Binary': file}})
const list = kit.items.filter((/** @type {any} */ it) => !it.internal).map((/** @type {any} */ it) => ({
	name: it.name,
	label: it.label,
	screenshot: 'screenshot/screenshot.webp',
	variants: { 'glTF-Binary': it.file }
}));
fs.writeFileSync(path.join(PACK, 'default.json'), JSON.stringify(list, null, 2) + '\n');
// kit.md's piece table, from the MEASURED sizes (the doc cannot drift from the GLBs)
const docPath = path.join(PACK, 'kit.md');
if (fs.existsSync(docPath)) {
	const rows = kit.items
		.filter((/** @type {any} */ it) => !it.internal && results[it.name])
		.map((/** @type {any} */ it) => {
			const r = results[it.name];
			const pivot = it.pivotDoc ?? (r.min[1] > 0.001 ? `the wall's bottom centre (piece starts ${r.min[1]} m up)` : 'bottom centre');
			return `| ${it.label} | ${r.size.map((v) => +v.toFixed(3)).join(' × ')} | ${pivot} | ${it.place ?? ''} |`;
		});
	const table = ['| Piece | Size (x × y × z, m) | Pivot | Place it |', '|---|---|---|---|', ...rows].join('\n');
	const doc = fs.readFileSync(docPath, 'utf8');
	const next = doc.replace(/(<!-- pieces:[^\n]*-->\n)[\s\S]*?(<!-- \/pieces -->)/, `$1${table}\n$2`);
	fs.writeFileSync(docPath, next);
}
const ordered = Object.fromEntries(kit.items.filter((/** @type {any} */ it) => results[it.name]).map((/** @type {any} */ it) => [it.name, results[it.name]]));
fs.writeFileSync(reportPath, JSON.stringify(ordered, null, 2) + '\n');
