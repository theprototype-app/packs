#!/usr/bin/env node
// water.mjs — the pond water surface (0 credits: procedural, no Meshy).
// An irregular, organic pond outline (a noisy-radius fan, 48 rim vertices) lying 2 cm above
// the ground, with a painted radial gradient (sunlit shallow rim → deep teal centre),
// low roughness so it catches the sky, alpha BLEND 0.85 so the ground reads through the edge.
//
//   node water.mjs out.glb [--rx 1.6] [--rz 1.2] [--seed 5]
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
const RX = Number(opt('--rx', 1.6));
const RZ = Number(opt('--rz', 1.2));
const SEED = Number(opt('--seed', 5));
const out = args[0];
if (!out) throw new Error('usage: water.mjs out.glb');

let s = SEED >>> 0 || 1;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

const TS = 256;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TS}" height="${TS}">
<defs><radialGradient id="g" cx="0.5" cy="0.5" r="0.5">
<stop offset="0" stop-color="#1f4f5c"/><stop offset="0.55" stop-color="#2f6b72"/><stop offset="0.85" stop-color="#4f8a80"/><stop offset="1" stop-color="#7fa78a"/>
</radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
const jpg = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();

// noisy outline: two low-frequency sines + jitter, so it reads as a natural pond, not an oval
const RIM = 48;
const ph1 = rnd() * 6.28, ph2 = rnd() * 6.28;
const P = [0, 0.02, 0], UV = [0.5, 0.5], N = [0, 1, 0], I = [];
for (let i = 0; i < RIM; i++) {
	const a = (i / RIM) * Math.PI * 2;
	const k = 1 + 0.12 * Math.sin(2 * a + ph1) + 0.07 * Math.sin(3 * a + ph2) + (rnd() - 0.5) * 0.04;
	const x = Math.cos(a) * RX * k, z = Math.sin(a) * RZ * k;
	P.push(x, 0.02, z);
	N.push(0, 1, 0);
	UV.push(0.5 + (Math.cos(a) * k) / 2, 0.5 + (Math.sin(a) * k) / 2);
	I.push(0, 1 + ((i + 1) % RIM), 1 + i);
}
const doc = new Document();
const buf = doc.createBuffer();
const tex = doc.createTexture('water').setImage(new Uint8Array(jpg)).setMimeType('image/jpeg');
const mat = doc
	.createMaterial('PondWater')
	.setBaseColorTexture(tex)
	.setBaseColorFactor([1, 1, 1, 0.85])
	.setAlphaMode('BLEND')
	.setRoughnessFactor(0.08)
	.setMetallicFactor(0.15);
const prim = doc
	.createPrimitive()
	.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(P)).setBuffer(buf))
	.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(N)).setBuffer(buf))
	.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(UV)).setBuffer(buf))
	.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(I)).setBuffer(buf))
	.setMaterial(mat);
doc.createScene('Scene').addChild(doc.createNode('PondWater').setMesh(doc.createMesh('PondWater').addPrimitive(prim)));
doc.getRoot().getAsset().generator = 'theprototype nature-kit build/water.mjs';
await new NodeIO().write(out, doc);
console.log(JSON.stringify({ out, tris: I.length / 3 }));
