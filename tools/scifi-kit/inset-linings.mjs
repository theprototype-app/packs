// inset-linings: the procedural door lining / window frame are kitbashed FLUSH with the cut
// opening of a Meshy wall (inner faces exactly on x = ±w/2, the lintel / sill on y = h / sill),
// where the wall's relief crosses the same planes at shallow angles: thousands of tiny
// z-fights that shimmer while the camera moves (roadmap 33 K1 — scifi WallDoorway, WallWindow).
// Moves the lining's inner faces INSET metres into the opening, so the lining always draws in
// front of the wall it covers ("offset the decal"). procedural.mjs builds them inset already;
// this applies the same offset to the shipped GLBs without a rebuild.
//   node tools/scifi-kit/inset-linings.mjs <glb> <door|window> [inset=0.004]
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { OPENINGS, LINER_INSET } from './procedural.mjs';

const req = createRequire(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../meshy/package.json'));
const { NodeIO } = await import(pathToFileURL(req.resolve('@gltf-transform/core')).href);
const { ALL_EXTENSIONS } = await import(pathToFileURL(req.resolve('@gltf-transform/extensions')).href);

/** @param {any} doc @param {'door'|'window'} kind @param {number} inset @returns {number} vertices moved */
export function insetLining(doc, kind, inset = LINER_INSET) {
	const o = OPENINGS[kind];
	const half = o.w / 2;
	const bottom = kind === 'window' ? o.sill : null; // a door's sill is the floor: no face there
	const top = kind === 'window' ? o.sill + o.h : o.h;
	const eps = 1e-4;
	let moved = 0;
	for (const node of doc.getRoot().listNodes()) {
		const mesh = node.getMesh();
		// only the procedural lining/frame: its nodes are named <Piece>_<material>
		if (!mesh || !/^(DoorLining|WindowGlass)_gunmetal$/.test(node.getName())) continue;
		for (const prim of mesh.listPrimitives()) {
			const pos = prim.getAttribute('POSITION');
			const v = [0, 0, 0];
			for (let i = 0; i < pos.getCount(); i++) {
				pos.getElement(i, v);
				let hit = false;
				// every lining vertex ON an opening plane moves with it: the whole opening shrinks
				// by `inset` on each side (frame boxes, mullion and lintel stay joined)
				if (Math.abs(Math.abs(v[0]) - half) < eps) {
					v[0] -= Math.sign(v[0]) * inset;
					hit = true;
				}
				if (Math.abs(v[1] - top) < eps) {
					v[1] -= inset;
					hit = true;
				}
				if (bottom !== null && Math.abs(v[1] - bottom) < eps) {
					v[1] += inset;
					hit = true;
				}
				if (hit) {
					pos.setElement(i, v);
					moved++;
				}
			}
		}
	}
	return moved;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [file, kind, inset] = process.argv.slice(2);
	const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
	const doc = await io.read(file);
	const moved = insetLining(doc, /** @type {any} */ (kind), inset ? Number(inset) : LINER_INSET);
	await io.write(file, doc);
	console.log(JSON.stringify({ file, kind, moved }));
}
