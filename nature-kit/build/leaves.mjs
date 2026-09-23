#!/usr/bin/env node
// leaves.mjs — the fallen-leaves decal plane (0 credits: procedural, no Meshy).
// A 2 × 2 m quad lying 1 cm above the ground, one alpha-MASKED base-colour PNG of scattered
// hand-painted leaves (oak / maple / birch shapes in the pack palette + the amber accent).
// Deterministic (seeded), so a re-run reproduces the shipped file byte-for-byte.
//
//   node leaves.mjs out.glb [--seed 7] [--size 1024] [--count 70]
import path from 'node:path';
import { createRequire } from 'node:module';

const TOOL = process.env.MESHY_TOOL || '/home/deck/.code/theprototype-app/packs-lane-30c-tools/tools/meshy';
const require = createRequire(path.join(TOOL, 'package.json'));
const sharp = require('sharp');
const { Document, NodeIO } = require('@gltf-transform/core');

const args = process.argv.slice(2);
const opt = (k, d) => {
	const i = args.indexOf(k);
	return i >= 0 ? args.splice(i, 2)[1] : d;
};
const SEED = Number(opt('--seed', 7));
const SIZE = Number(opt('--size', 1024));
const COUNT = Number(opt('--count', 70));
const out = args[0];
if (!out) throw new Error('usage: leaves.mjs out.glb');

let s = SEED >>> 0 || 1;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];

// warm autumn palette: amber accent, ochre, rust, dry oak brown, a few late greens
const COLORS = [
	['#d9822b', '#a85a1c'],
	['#e0a53a', '#b07a22'],
	['#b8522a', '#7e3517'],
	['#8f6a3e', '#624626'],
	['#c9a45a', '#8f7236'],
	['#9a9a45', '#6b6c2c']
];
// leaf outlines in a unit box (x −0.5..0.5, y 0..1), stem at y = 0
const SHAPES = {
	oval: 'M0,0 C0.45,0.18 0.42,0.72 0,1 C-0.42,0.72 -0.45,0.18 0,0 Z',
	oak: 'M0,0 C0.18,0.08 0.34,0.12 0.26,0.24 C0.42,0.28 0.44,0.40 0.30,0.46 C0.46,0.52 0.44,0.66 0.28,0.68 C0.38,0.80 0.26,0.92 0,1 C-0.26,0.92 -0.38,0.80 -0.28,0.68 C-0.44,0.66 -0.46,0.52 -0.30,0.46 C-0.44,0.40 -0.42,0.28 -0.26,0.24 C-0.34,0.12 -0.18,0.08 0,0 Z',
	maple: 'M0,0 L0.08,0.28 L0.42,0.22 L0.30,0.42 L0.50,0.56 L0.24,0.60 L0.28,0.86 L0.10,0.72 L0,1 L-0.10,0.72 L-0.28,0.86 L-0.24,0.60 L-0.50,0.56 L-0.30,0.42 L-0.42,0.22 L-0.08,0.28 Z',
	birch: 'M0,0 C0.36,0.14 0.40,0.52 0,1 C-0.40,0.52 -0.36,0.14 0,0 Z'
};

const shade = (hex, k) =>
	'#' + [1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k))).toString(16).padStart(2, '0')).join('');
const leaves = [];
for (let i = 0; i < COUNT; i++) {
	const [fill, vein] = pick(COLORS);
	const shape = pick(Object.keys(SHAPES));
	const len = SIZE * (0.05 + rnd() * 0.05);
	// clustered toward the middle, thinning at the edges so tiles overlap softly
	const r = Math.sqrt(rnd()) * SIZE * 0.44;
	const a = rnd() * Math.PI * 2;
	const x = SIZE / 2 + Math.cos(a) * r;
	const y = SIZE / 2 + Math.sin(a) * r;
	const rot = rnd() * 360;
	const light = 0.85 + rnd() * 0.3;
	leaves.push(
		`<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${rot.toFixed(1)}) scale(${(len * 0.8).toFixed(2)},${len.toFixed(2)})">` +
			`<path d="${SHAPES[shape]}" fill="${shade(fill, light)}"/>` +
			`<path d="M0,-0.12 L0,0.9" stroke="${vein}" stroke-width="0.035" fill="none"/>` +
			`</g>`
	);
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${leaves.join('')}</svg>`;
const png = await sharp(Buffer.from(svg)).png({ palette: true, colours: 64, effort: 10 }).toBuffer();

const doc = new Document();
const buf = doc.createBuffer();
const W = 2, H = 0.01;
const pos = new Float32Array([-W / 2, H, -W / 2, W / 2, H, -W / 2, W / 2, H, W / 2, -W / 2, H, W / 2]);
const nrm = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const idx = new Uint16Array([0, 2, 1, 0, 3, 2]);
const tex = doc.createTexture('leaves').setImage(new Uint8Array(png)).setMimeType('image/png');
const mat = doc
	.createMaterial('FallenLeaves')
	.setBaseColorTexture(tex)
	.setAlphaMode('MASK')
	.setAlphaCutoff(0.5)
	.setRoughnessFactor(0.9)
	.setMetallicFactor(0);
const prim = doc
	.createPrimitive()
	.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf))
	.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buf))
	.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buf))
	.setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buf))
	.setMaterial(mat);
const mesh = doc.createMesh('FallenLeaves').addPrimitive(prim);
doc.createScene('Scene').addChild(doc.createNode('FallenLeaves').setMesh(mesh));
doc.getRoot().getAsset().generator = 'theprototype nature-kit build/leaves.mjs';
await new NodeIO().write(out, doc);
console.log(JSON.stringify({ out, png: png.length, leaves: COUNT }));
