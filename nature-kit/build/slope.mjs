#!/usr/bin/env node
// slope.mjs — how walkable is a terrain piece: the area-weighted distribution of the slope
// of its upward-facing triangles (0° = flat). `node slope.mjs Hill/glTF-Binary/Hill.glb`
import path from 'node:path';
import { createRequire } from 'node:module';
const TOOL = process.env.MESHY_TOOL || '/home/deck/.code/theprototype-app/packs-lane-30c-tools/tools/meshy';
const require = createRequire(path.join(TOOL, 'package.json'));
const { NodeIO } = require('@gltf-transform/core');
const doc = await new NodeIO().read(process.argv[2]);
const bins = [0, 10, 20, 25, 30, 35, 45, 90];
const area = new Array(bins.length - 1).fill(0);
let total = 0, worst = 0;
for (const mesh of doc.getRoot().listMeshes())
	for (const p of mesh.listPrimitives()) {
		const pos = p.getAttribute('POSITION'), idx = p.getIndices();
		const n = idx ? idx.getCount() : pos.getCount();
		const g = (i) => pos.getElement(idx ? idx.getScalar(i) : i, []);
		for (let t = 0; t < n; t += 3) {
			const [a, b, c] = [g(t), g(t + 1), g(t + 2)];
			const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
			const nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
			const len = Math.hypot(nx, ny, nz);
			if (!len || ny / len <= 0.05) continue; // walls / undersides are not walked on
			const s = (Math.acos(ny / len) * 180) / Math.PI;
			const A = len / 2;
			total += A;
			for (let k = 0; k < area.length; k++) if (s >= bins[k] && s < bins[k + 1]) area[k] += A;
			if (A > 0.01) worst = Math.max(worst, s);
		}
	}
const rows = area.map((A, k) => `${bins[k]}-${bins[k + 1]}°: ${((A / total) * 100).toFixed(1)}%`);
console.log(JSON.stringify({ file: process.argv[2], walkableArea_m2: +total.toFixed(2), under30: +((area.slice(0, 4).reduce((x, y) => x + y, 0) / total) * 100).toFixed(1), maxSlopeOfFacesOver0_01m2: +worst.toFixed(1), distribution: rows }));
