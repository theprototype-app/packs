#!/usr/bin/env node
// grass.mjs — the short grass tuft (0 credits: procedural, no Meshy).
// Meshy's "clump of grass" came back as tall cattail reeds (kept as the Reeds item);
// a thin-bladed tuft is also exactly what a generator is bad at and a script is good at.
// ~48 curved, tapered blades (3 segments each), one double-sided material, one small
// painted gradient texture (dark moss root → sunlit tip), ≈ 250 triangles. Seeded.
//
//   node grass.mjs out.glb [--seed 3] [--blades 40] [--height 0.45] [--radius 0.22] [--tint dry]
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
const SEED = Number(opt('--seed', 3));
const BLADES = Number(opt("--blades", 40));
const HEIGHT = Number(opt('--height', 0.45));
const RADIUS = Number(opt('--radius', 0.22));
const TINT = opt('--tint', 'green');
const out = args[0];
if (!out) throw new Error('usage: grass.mjs out.glb');

let s = SEED >>> 0 || 1;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

// the gradient: u across the blade (a darker midrib), v from root (0) to tip (1)
const PALETTES = {
	green: ['#2f4a1f', '#4f7a2c', '#86a63f', '#c2c46a'],
	dry: ['#5a4a26', '#8a7338', '#b89c52', '#dcc98a']
};
const stops = PALETTES[TINT] ?? PALETTES.green;
const TW = 64, TH = 256;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TW}" height="${TH}">
<defs><linearGradient id="g" x1="0" y1="1" x2="0" y2="0">
${stops.map((c, i) => `<stop offset="${(i / (stops.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join('')}
</linearGradient><linearGradient id="r" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.5" stop-color="#000" stop-opacity="0.18"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
</linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#r)"/></svg>`;
const jpg = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();

const P = [], N = [], UV = [], I = [];
const SEG = 3;
for (let b = 0; b < BLADES; b++) {
	const r = Math.sqrt(rnd()) * RADIUS;
	const a = rnd() * Math.PI * 2;
	const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
	const h = HEIGHT * (0.55 + rnd() * 0.6) * (1 - (r / RADIUS) * 0.35); // taller in the middle
	const w = 0.04 + rnd() * 0.025;
	const facing = rnd() * Math.PI * 2; // blade plane orientation
	const lean = (0.15 + rnd() * 0.35) * h * (0.4 + r / RADIUS); // outer blades lean out more
	const la = a + (rnd() - 0.5) * 0.9; // lean direction ≈ outward
	const fx = Math.cos(facing), fz = Math.sin(facing); // across-blade direction
	const base = P.length / 3;
	for (let i = 0; i <= SEG; i++) {
		const t = i / SEG;
		const off = lean * t * t; // quadratic bend
		const cx = bx + Math.cos(la) * off, cz = bz + Math.sin(la) * off, cy = h * t * (1 - 0.18 * t);
		const hw = (w / 2) * (1 - t) + 0.0015; // taper to a point
		P.push(cx - fx * hw, cy, cz - fz * hw, cx + fx * hw, cy, cz + fz * hw);
		// normal: mostly up/out, so a double-sided blade shades softly like a clump
		const nx = Math.cos(la) * 0.5, nz = Math.sin(la) * 0.5, ny = 0.85;
		const l = Math.hypot(nx, ny, nz);
		N.push(nx / l, ny / l, nz / l, nx / l, ny / l, nz / l);
		UV.push(0, 1 - t, 1, 1 - t);
		if (i < SEG) {
			const k = base + i * 2;
			I.push(k, k + 1, k + 3, k, k + 3, k + 2);
		}
	}
}

const doc = new Document();
const buf = doc.createBuffer();
const tex = doc.createTexture('grass').setImage(new Uint8Array(jpg)).setMimeType('image/jpeg');
const mat = doc.createMaterial('Grass').setBaseColorTexture(tex).setDoubleSided(true).setRoughnessFactor(0.85).setMetallicFactor(0);
const prim = doc
	.createPrimitive()
	.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(P)).setBuffer(buf))
	.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(N)).setBuffer(buf))
	.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(UV)).setBuffer(buf))
	.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(I)).setBuffer(buf))
	.setMaterial(mat);
const mesh = doc.createMesh('GrassTuft').addPrimitive(prim);
doc.createScene('Scene').addChild(doc.createNode('GrassTuft').setMesh(mesh));
doc.getRoot().getAsset().generator = 'theprototype nature-kit build/grass.mjs';
await new NodeIO().write(out, doc);
console.log(JSON.stringify({ out, tris: I.length / 3, blades: BLADES }));
