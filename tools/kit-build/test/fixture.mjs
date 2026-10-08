// A one-pack repo in a temp folder that passes every check — each test breaks ONE thing in it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load, makeIO, REPO } from '../lib/deps.mjs';
import { inspectGlb } from '../lib/inspect.mjs';
import { dimsOf, withDims } from '../lib/dims.mjs';

const { Document } = await load('@gltf-transform/core');
const sharp = (await load('sharp')).default;

/** the real policy file, so the categories the tests use are the shipped ones */
export const REAL = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/kit-build/packs.json'), 'utf8'));

/**
 * A box GLB: x/z -0.5..0.5, y 0..1 (bottom-centre pivot), 12 triangles, one node "Box".
 * @param {{scale?: number, offset?: number[], faces?: number, texture?: number, emissive?: boolean,
 *   coplanar?: boolean, clips?: string[], nodeName?: string, twin?: string, png?: number}} [o]
 */
export async function boxGlb(o = {}) {
	const doc = new Document();
	const buf = doc.createBuffer();
	const k = o.scale ?? 1;
	const off = o.offset ?? [0, 0, 0];
	const P = [];
	const I = [];
	// six faces as quads [corner, u, v] in the unit box
	const faces = [
		[[0, 0, 1], [1, 0, 0], [0, 1, 0]],
		[[1, 0, 0], [-1, 0, 0], [0, 1, 0]],
		[[0, 0, 0], [0, 0, 1], [0, 1, 0]],
		[[1, 0, 1], [0, 0, -1], [0, 1, 0]],
		[[0, 1, 1], [1, 0, 0], [0, 0, -1]],
		[[0, 0, 0], [1, 0, 0], [0, 0, 1]]
	].slice(0, o.faces ?? 6);
	if (o.coplanar) faces.push([[0.2, 1, 0.8], [0.6, 0, 0], [0, 0, -0.6]]); // a decal lying ON the top face
	for (const [c, u, v] of faces) {
		const b = P.length / 3;
		for (const [a, bb] of [[0, 0], [1, 0], [1, 1], [0, 1]]) for (let i = 0; i < 3; i++) P.push(((c[i] + a * u[i] + bb * v[i] - (i === 1 ? 0 : 0.5)) * k) + off[i]);
		I.push(b, b + 1, b + 2, b, b + 2, b + 3);
	}
	const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(P)).setBuffer(buf);
	const idx = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(I)).setBuffer(buf);
	const mat = doc.createMaterial('M').setDoubleSided(true);
	if (o.emissive) mat.setEmissiveFactor([1, 0.5, 0]);
	let uv = null;
	if (o.texture || o.png) {
		const n = o.texture ?? o.png ?? 64;
		const img = sharp({ create: { width: n, height: n, channels: 3, background: '#a08060' } });
		// a photo-like gradient with fine grain: big as PNG, small as JPEG (the share-cap test)
		const raw = Buffer.alloc(n * n * 3);
		let r = 7;
		for (let i = 0; i < raw.length; i++) {
			r ^= r << 13; r ^= r >>> 17; r ^= r << 5;
			raw[i] = ((((i / 3) % n) * 200) / n + (r & 15)) | 0;
		}
		const bytes = o.png ? await sharp(raw, { raw: { width: n, height: n, channels: 3 } }).png().toBuffer() : await img.jpeg().toBuffer();
		mat.setBaseColorTexture(doc.createTexture('T').setImage(new Uint8Array(bytes)).setMimeType(o.png ? 'image/png' : 'image/jpeg'));
		uv = doc.createAccessor().setType('VEC2').setArray(new Float32Array((P.length / 3) * 2)).setBuffer(buf);
	}
	const prim = doc.createPrimitive().setAttribute('POSITION', pos).setIndices(idx).setMaterial(mat);
	if (uv) prim.setAttribute('TEXCOORD_0', uv);
	const mesh = doc.createMesh('Box').addPrimitive(prim);
	const node = doc.createNode(o.nodeName ?? 'Box').setMesh(mesh);
	const scene = doc.createScene('Scene').addChild(node);
	if (o.twin) scene.addChild(doc.createNode(o.twin).setMesh(mesh).setTranslation([0, 0, 0]));
	for (const name of o.clips ?? []) {
		const t = doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 1])).setBuffer(buf);
		const v = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 0, 0.1, 0])).setBuffer(buf);
		const s = doc.createAnimationSampler().setInput(t).setOutput(v).setInterpolation('LINEAR');
		doc.createAnimation(name).addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('translation').setSampler(s));
	}
	return Buffer.from(await makeIO().writeBinary(doc));
}

/**
 * Write the fixture repo. `edit` may change {index, rows, policy, limits, allow, baseline, files}
 * before it is written; files are {relPath: Buffer | string}.
 * @param {(f: any) => void | Promise<void>} [edit]
 */
export async function fixture(edit) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-check-'));
	const f = {
		index: [{ name: 'kit', title: 'Kit', value: 'kit/default.json', attribution: 'kit/attribution.html', copyright: '', license: 'CC0-1.0', source: 'https://github.com/theprototype-app/packs' }],
		rows: [{ name: 'Box', label: 'Box', screenshot: 'thumb.webp', variants: { 'glTF-Binary': 'box.glb' } }],
		policy: { textureCap: 1024, emissive: 'allowed', category: 'prop', pivot: 'bottom-center' },
		limits: { ...REAL.limits },
		categories: JSON.parse(JSON.stringify(REAL.categories)),
		allow: [],
		baseline: {},
		files: /** @type {Record<string, Buffer | string>} */ ({
			'kit/attribution.html': '<p>CC0</p>',
			'kit/Box/glTF-Binary/box.glb': await boxGlb(),
			'kit/Box/thumb.webp': await sharp({ create: { width: 128, height: 128, channels: 3, background: '#888' } }).webp().toBuffer()
		})
	};
	if (edit) await edit(f);
	const w = (/** @type {string} */ rel, /** @type {Buffer | string} */ data) => {
		fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
		fs.writeFileSync(path.join(dir, rel), data);
	};
	w('index.json', JSON.stringify(f.index));
	for (const [rel, data] of Object.entries(f.files)) w(rel, data);
	// core 39 P4: a shipped row carries its dims, measured from the file as written (so a test that
	// breaks something else is not also red on dims); `f.noDims` leaves them off to test that check
	const rows = [];
	for (const row of f.rows) {
		const glb = path.join(dir, 'kit', String(row?.name), 'glTF-Binary', String(row?.variants?.['glTF-Binary']));
		rows.push(!f.noDims && row && !('size' in row) && fs.existsSync(glb) ? withDims(row, dimsOf(await inspectGlb(glb))) : row);
	}
	w('kit/default.json', JSON.stringify(rows));
	w('tools/kit-build/packs.json', JSON.stringify({ limits: f.limits, categories: f.categories, packs: { kit: f.policy } }));
	w('tools/kit-build/allow.json', JSON.stringify({ allow: f.allow }));
	w('tools/kit-build/flicker-baseline.json', JSON.stringify({ files: f.baseline }));
	return dir;
}

/** the unallowed errors of a run, as "check: message" @param {any} r */
export const errorsOf = (r) => r.findings.filter((/** @type {any} */ x) => x.level === 'error' && !x.allowed).map((/** @type {any} */ x) => `${x.check}: ${x.msg}`);
