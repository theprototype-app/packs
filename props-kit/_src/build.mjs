// Build the props-kit pack from items.mjs: every Meshy source is post-processed by the
// shared tools/meshy meshy-post (weld, simplify to budget, scale to metres, pivot,
// 1024² JPEG) — raw Meshy output is never shipped — procedural pieces are generated,
// kitbashes are assembled from finished items, then each item gets
// <Name>/glTF-Binary/<file>.glb + <Name>/screenshot/screenshot.webp and the pack's
// default.json is rewritten.
//
//   MESHY_TOOLS=<packs checkout>/tools/meshy node build.mjs [--only A,B] [--no-shots]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEMS } from './items.mjs';
import { createRequire } from 'node:module';
import { PIECES, appendFlames } from './procedural.mjs';

const TOOLS = process.env.MESHY_TOOLS ?? '/home/deck/.code/theprototype-app/packs-lane-30c-tools/tools/meshy';
const STAGING = process.env.MESHY_STAGING ?? path.join(os.homedir(), '.code/lanes-30/meshy/staging');
const REQUESTER = '30c-pack-props';
const { postProcess } = await import(`${TOOLS}/lib/post.js`);
const sharp = createRequire(`${TOOLS}/package.json`)('sharp');
const { renderThumbs } = await import(`${TOOLS}/lib/thumb.js`);
const { NodeIO } = await import(`${TOOLS}/node_modules/@gltf-transform/core/dist/index.js`);
const { ALL_EXTENSIONS } = await import(`${TOOLS}/node_modules/@gltf-transform/extensions/dist/index.js`);
const { mergeDocuments, dedup, prune, getBounds, unpartition } = await import(`${TOOLS}/node_modules/@gltf-transform/functions/dist/index.js`);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.resolve(HERE, '..');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const shots = !args.includes('--no-shots');

const fileOf = (name) => `${name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}.glb`;
const glbOf = (name) => path.join(PACK, name, 'glTF-Binary', fileOf(name));

/** the newest `<stage>-<n>/raw.glb` of a Meshy job */
function meshyRaw(id, stage, requester = REQUESTER) {
	const dir = path.join(STAGING, requester, id);
	const runs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((d) => d.startsWith(`${stage}-`) && fs.existsSync(path.join(dir, d, 'raw.glb'))) : [];
	runs.sort((a, b) => Number(b.split('-').pop()) - Number(a.split('-').pop()));
	if (!runs.length) throw new Error(`no ${stage} raw.glb for ${requester}/${id}`);
	return path.join(dir, runs[0], 'raw.glb');
}

function sizeOf(doc) {
	const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
	const b = getBounds(scene);
	return { min: b.min, max: b.max, size: [0, 1, 2].map((i) => b.max[i] - b.min[i]) };
}

/** flames for items whose flame is found from the posted bounds */
function autoFlames(kind, b) {
	const [cx, cz] = [(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2];
	const h = b.size[1];
	if (kind === 'auto-lantern') return [{ t: [cx, b.min[1] + h * 0.3, cz], s: 0.55 }];
	return [];
}

/** Colour-grade every base-colour texture: per-channel multiply (+ offset), so a piece
 * Meshy painted off-palette (a pale pine table) matches the kit's oak without a paid retexture. */
async function grade(doc, { mul, add = [0, 0, 0] }) {
	for (const mat of doc.getRoot().listMaterials()) {
		const tex = mat.getBaseColorTexture();
		const img = tex?.getImage();
		if (!img) continue;
		tex.setImage(await sharp(Buffer.from(img)).linear(mul, add).jpeg({ quality: 86 }).toBuffer()).setMimeType('image/jpeg');
	}
}

async function buildMeshy(item, raw, out) {
	const report = await postProcess(raw, out, { ...item.post, pivot: item.post.pivot ?? 'bottom-center' });
	if (item.flames || item.grade || item.glow) {
		const doc = await io.read(out);
		if (item.grade) await grade(doc, item.grade);
		// glow: the albedo doubles as the emissive map, so bright panes (a lantern's amber
		// glass) light up while dark metal stays dark — a lit look with no extra texture
		if (item.glow) for (const mat of doc.getRoot().listMaterials()) mat.setEmissiveTexture(mat.getBaseColorTexture()).setEmissiveFactor([item.glow, item.glow * 0.8, item.glow * 0.55]);
		if (item.flames) appendFlames(doc, Array.isArray(item.flames) ? item.flames : autoFlames(item.flames, sizeOf(doc)));
		await io.write(out, doc);
	}
	return { source: path.relative(STAGING, raw), trisIn: report.trisIn };
}

/** Kitbash: two crates side by side, a painted one on top — reuses the finished GLBs */
async function crateStack(out) {
	const doc = await io.read(glbOf('Crate'));
	const root = doc.getRoot();
	const scene = root.getDefaultScene() ?? root.listScenes()[0];
	const c = sizeOf(doc);
	const w = c.size[0];
	const first = doc.createNode('CrateA').setTranslation([-(w / 2 + 0.01), 0, 0]);
	for (const n of scene.listChildren()) {
		scene.removeChild(n);
		first.addChild(n);
	}
	scene.addChild(first);
	const addCopy = async (file, name, t, yawDeg) => {
		const src = await io.read(file);
		const map = mergeDocuments(doc, src);
		const srcScene = src.getRoot().getDefaultScene() ?? src.getRoot().listScenes()[0];
		const holder = doc.createNode(name).setTranslation(t).setRotation([0, Math.sin((yawDeg * Math.PI) / 360), 0, Math.cos((yawDeg * Math.PI) / 360)]);
		for (const n of srcScene.listChildren()) holder.addChild(map.get(n));
		scene.addChild(holder);
		for (const s of root.listScenes()) if (s !== scene) s.dispose();
	};
	await addCopy(glbOf('Crate'), 'CrateB', [w / 2 + 0.02, 0, 0.06], 7);
	await addCopy(glbOf('CrateTeal'), 'CrateTop', [-0.18, c.size[1], 0.0], -10);
	await doc.transform(unpartition(), dedup(), prune());
	root.getAsset().extras = { ...(root.getAsset().extras ?? {}), propsKit: { source: 'kitbash', of: ['Crate', 'Crate', 'CrateTeal'] } };
	await io.write(out, doc);
	return { source: 'kitbash: Crate × 2 + CrateTeal' };
}
const KITBASH = { crateStack };

const report = {};
const reportFile = path.join(HERE, 'build-report.json');
const prev = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : {};
// kitbashes read other items' GLBs: build them last
const order = [...ITEMS.filter((i) => !i.src.kitbash), ...ITEMS.filter((i) => i.src.kitbash)];
for (const item of order) {
	if (only && !only.includes(item.name)) {
		if (prev[item.name]) report[item.name] = prev[item.name];
		continue;
	}
	const out = glbOf(item.name);
	fs.mkdirSync(path.dirname(out), { recursive: true });
	let meta;
	if (item.src.meshy) meta = await buildMeshy(item, meshyRaw(item.src.meshy, item.src.stage), out);
	else if (item.src.budget) meta = await buildMeshy(item, path.join(STAGING, '30c-meshy-budget', item.src.budget, 'raw.glb'), out);
	else if (item.src.proc) {
		await (await PIECES[item.src.proc]()).write(out);
		meta = { source: 'procedural.mjs' };
	} else meta = await KITBASH[item.src.kitbash](out);
	const doc = await io.read(out);
	const b = sizeOf(doc);
	let tris = 0;
	// per NODE, not per mesh: a kitbash instances one mesh several times
	for (const n of doc.getRoot().listNodes()) for (const p of n.getMesh()?.listPrimitives() ?? []) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
	const tex = doc.getRoot().listTextures().map((t) => t.getSize()?.join('×'));
	report[item.name] = {
		label: item.label,
		file: path.relative(PACK, out),
		bytes: fs.statSync(out).size,
		tris: Math.round(tris),
		size: b.size.map((v) => +v.toFixed(3)),
		min: b.min.map((v) => +v.toFixed(3)),
		textures: tex,
		tags: item.tags,
		...meta
	};
	console.log(`${item.name.padEnd(14)} ${String(report[item.name].tris).padStart(6)}t ${(report[item.name].bytes / 1024).toFixed(0).padStart(5)} KB  ${report[item.name].size.join(' × ')} m  min ${report[item.name].min.join(',')}`);
	if (report[item.name].bytes > 5 * 1024 * 1024) throw new Error(`${item.name} is over the 5 MB share cap`);
}

if (shots) {
	const todo = ITEMS.filter((i) => !only || only.includes(i.name)).map((i) => ({ glb: glbOf(i.name), out: path.join(PACK, i.name, 'screenshot', 'screenshot.webp') }));
	for (const t of todo) fs.mkdirSync(path.dirname(t.out), { recursive: true });
	await renderThumbs(todo, { size: 512, bg: null, yaw: 35 });
}

fs.writeFileSync(reportFile, JSON.stringify(report, null, 1) + '\n');
const list = ITEMS.map((i) => ({ name: i.name, screenshot: 'screenshot/screenshot.webp', label: i.label, variants: { 'glTF-Binary': fileOf(i.name) } }));
fs.writeFileSync(path.join(PACK, 'default.json'), JSON.stringify(list, null, 2) + '\n');
console.log(`default.json: ${list.length} items`);
