#!/usr/bin/env node
// cover.mjs — the pack cover: the e2e clearing (clearing-layout.json) rendered offline with
// render.mjs's scene mode. Writes nature-kit/cover.webp (640², the Explorer/README card) and
// nature-kit/cover-wide.webp (1280×720, kit.md).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const PACK = path.resolve(HERE, '..');
const { layout } = JSON.parse(fs.readFileSync(path.join(HERE, 'clearing-layout.json'), 'utf8'));
const items = [
	['PathTile', 1, 1, 0], // the 5th path tile (the one the e2e drags by hand and snaps)
	...layout
].map(([name, x, z, rotY, scale]) => ({ glb: path.join(PACK, name, 'glTF-Binary', `${name}.glb`), pos: [x, 0, z], rotY, scale: scale ?? 1 }));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nature-cover-'));
const shots = [
	{ out: 'cover-wide.webp', w: 1280, h: 720, cam: { pos: [3.5, 9.5, 19], target: [0, 0.8, -2.5], fov: 42 } },
	{ out: 'cover.webp', w: 640, h: 640, cam: { pos: [4, 11, 17], target: [0, 0.6, -2.5], fov: 50 } }
];
for (const s of shots) {
	const spec = path.join(tmp, 'scene.json');
	fs.writeFileSync(spec, JSON.stringify({ items, ground: '#6f7d44', bg: '#a8c6de', fog: [30, 90], span: 16, cam: s.cam }));
	console.log(execFileSync(process.execPath, [path.join(HERE, 'render.mjs'), 'scene', spec, path.join(PACK, s.out), '--w', String(s.w), '--h', String(s.h)]).toString().trim());
}
fs.rmSync(tmp, { recursive: true, force: true });
