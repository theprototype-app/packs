// build: rigs.mjs → interactive-kit/ (the pack), reproducibly.
//
//   node tools/interactive-kit/build.mjs [--only Name,Name] [--no-thumbs]
//
// For every item: the rig (tools/anim) → interactive-kit/<Name>/glTF-Binary/<file>, a thumbnail
// rendered by three.js with the clip at `shot` (a door ajar says "this opens"),
// interactive-kit/default.json (the model-list: each row carries its contract-P2 `behavior`,
// read back from the GLB's scene.extras so the row and the file can never disagree, and keeps
// any `lods` a LOD pass already wrote), tools/interactive-kit/report.json and the items table in
// interactive-kit/kit.md. The Meshy sources are the staged refines of requester 33-anim-kit
// (jobs/*.json; MESHY_STAGING overrides where they live).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RIGS } from './rigs.mjs';
import { io } from '../anim/anim.mjs';
import { look } from '../anim/look.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const PACK = path.join(REPO, 'interactive-kit');

/**
 * name, label, file, where it goes, the source, and the thumbnail pose [clip, t]
 * @type {{name: string, label: string, file: string, place: string, source: string, shot?: [string, number]}[]}
 */
export const ITEMS = [
	{ name: 'DoorWood', label: 'Door + frame, opens (fits the kit doorway)', file: 'door-wood.glb', place: 'at the SAME position and rotation as a Wall — doorway (architecture kit)', source: 'architecture-kit Door, split', shot: ['open', 0.45] },
	{ name: 'DoorStudded', label: 'Studded oak door + frame, opens', file: 'door-studded.glb', place: 'at the SAME position and rotation as a Wall — doorway', source: 'Meshy leaf + procedural oak frame', shot: ['open', 0.5] },
	{ name: 'DoorDouble', label: 'Double door in a sandstone wall (2 × 3 m)', file: 'door-double.glb', place: 'in place of a Wall: on a grid line, x or z on an odd metre', source: 'architecture-kit Wall (cut 1.6 × 2.4 m) + Gate leaves', shot: ['open', 0.5] },
	{ name: 'IronGate', label: 'Iron gate between two pillars', file: 'iron-gate.glb', place: 'on a grid line, the pillars on the grid points 2 m apart (x = ±1)', source: 'Meshy gate + architecture-kit Pillars', shot: ['open', 0.6] },
	{ name: 'Portcullis', label: 'Portcullis in a gate wall (2 × 4.5 m)', file: 'portcullis.glb', place: 'in place of a Wall; the half-storey above holds the raised grid', source: 'Meshy grid + architecture-kit Wall (cut 1.7 × 2.2 m) + half wall', shot: ['open', 1.0] },
	{ name: 'SlidingDoor', label: 'Sci-fi sliding door + frame, opens (fits the doorway)', file: 'sliding-door.glb', place: 'at the SAME position and rotation as a scifi-kit Wall — open doorway (the panels slide into the wall)', source: 'scifi-kit Sliding door, split', shot: ['open', 0.3] },
	{ name: 'WallSlidingDoor', label: 'Sci-fi wall + sliding door, opens', file: 'wall-sliding-door.glb', place: 'like a scifi-kit Wall', source: 'scifi-kit Wall + sliding door, split', shot: ['open', 0.35] },
	{ name: 'Trapdoor', label: 'Trapdoor + floor frame (1.2 m)', file: 'trapdoor.glb', place: 'on a floor; the shaft under the hatch is dark', source: 'props-kit Hatch + procedural oak frame', shot: ['open', 0.6] },
	{ name: 'Shutters', label: 'Window + shutters that close (fits the window wall)', file: 'shutters.glb', place: 'at the SAME position and rotation as a Wall — window (architecture kit)', source: 'architecture-kit Window, shutters re-hung' },
	{ name: 'Chest', label: 'Treasure chest, lid opens', file: 'chest.glb', place: 'on a floor', source: 'props-kit Chest, split', shot: ['open', 0.5] },
	{ name: 'Crate', label: 'Crate, lid opens', file: 'crate.glb', place: 'on a floor', source: 'props-kit Crate, split', shot: ['open', 0.5] },
	{ name: 'Cabinet', label: 'Oak wardrobe, doors open', file: 'cabinet.glb', place: 'on a floor, back to a wall', source: 'Meshy', shot: ['open', 0.4] },
	{ name: 'Drawers', label: 'Chest of drawers, drawers slide out', file: 'drawers.glb', place: 'on a floor, back to a wall', source: 'Meshy', shot: ['open', 0.5] },
	{ name: 'Lever', label: 'Lever (pull: one-shot)', file: 'lever.glb', place: 'on a floor or a ledge', source: 'props-kit Lever base + handle' },
	{ name: 'PressurePlate', label: 'Pressure plate 1 × 1 m (steps sink it)', file: 'pressure-plate.glb', place: 'on a floor, filling one grid cell', source: 'props-kit Pressure plate, split' },
	{ name: 'WallButton', label: 'Wall button (press: one-shot)', file: 'wall-button.glb', place: 'origin on a wall face, facing out', source: 'props-kit Wall button, split' },
	{ name: 'Torch', label: 'Wall torch, flickering flame (ambient)', file: 'torch.glb', place: 'origin on a wall face, facing out', source: 'props-kit Wall torch' },
	{ name: 'Banner', label: 'Banner stirring in a draught (ambient)', file: 'banner.glb', place: 'origin on a wall face, facing out', source: 'props-kit Tapestry + morph targets' },
	{ name: 'CeilingFan', label: 'Ceiling fan, turning (ambient)', file: 'ceiling-fan.glb', place: 'origin at the mount: put it at the ceiling height (y = 3)', source: 'Meshy' }
];

const args = process.argv.slice(2);
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const thumbs = !args.includes('--no-thumbs');
const reportFile = path.join(HERE, 'report.json');
/** @type {Record<string, any>} */
const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : {};
const listFile = path.join(PACK, 'default.json');
/** @type {any[]} */
const oldList = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, 'utf8')) : [];

for (const it of ITEMS) {
	if (only && !only.has(it.name)) continue;
	const out = path.join(PACK, it.name, 'glTF-Binary', it.file);
	const r = await RIGS[/** @type {keyof typeof RIGS} */ (it.name)](out);
	const doc = await io.read(out);
	const behavior = doc.getRoot().listScenes()[0].getExtras().behavior;
	report[it.name] = { file: it.file, bytes: r.bytes, tris: r.tris, nodes: r.nodes, clips: r.clips, min: r.bounds.min, max: r.bounds.max, behavior };
	console.log(`${it.name.padEnd(16)} ${String(r.tris).padStart(5)} tris ${String(Math.round(r.bytes / 1024)).padStart(5)} KB  ${r.nodes.join(',')}  ${r.clips.join(',')}  ${behavior?.type}`);
	if (r.bytes > 2 * 1024 * 1024) console.warn(`  ! ${it.name} is over the 2 MB target`);
}

if (thumbs) {
	fs.mkdirSync(path.join(HERE, '.build'), { recursive: true });
	const todo = ITEMS.filter((it) => !only || only.has(it.name));
	await look(
		todo.map((it) => ({
			glb: path.join(PACK, it.name, 'glTF-Binary', it.file),
			clip: it.shot?.[0],
			times: it.shot ? [it.shot[1]] : undefined,
			label: it.name,
			out: path.join(PACK, it.name, 'screenshot', 'screenshot.webp')
		})),
		{ sheet: path.join(HERE, '.build', 'thumbs.png'), size: 512 }
	);
}

// the model list: rows in ITEMS order; behavior from the GLB; lods kept from a previous LOD pass
const list = ITEMS.map((it) => {
	const old = oldList.find((o) => o.name === it.name) ?? {};
	const row = /** @type {any} */ ({ name: it.name, label: it.label, screenshot: 'screenshot/screenshot.webp', variants: { 'glTF-Binary': it.file } });
	if (report[it.name]?.behavior) row.behavior = report[it.name].behavior;
	if (old.lods) row.lods = old.lods;
	return row;
});
fs.writeFileSync(listFile, JSON.stringify(list, null, 2) + '\n'); // 2 spaces: tools/lod rewrites it that way
fs.writeFileSync(reportFile, JSON.stringify(report, null, 1) + '\n');

// kit.md: the generated items table
const kitMd = path.join(PACK, 'kit.md');
if (fs.existsSync(kitMd)) {
	const b = (/** @type {any} */ x) => x.behavior;
	const rows = ITEMS.map((it) => {
		const r = report[it.name];
		const size = r.max.map((/** @type {number} */ v, /** @type {number} */ i) => +(v - r.min[i]).toFixed(2)).join(' × ');
		const beh = b(r) ? `${b(r).type}${b(r).autoplay ? ' (autoplay)' : ''}: \`${b(r).clip}\`${b(r).closeClip ? ` / \`${b(r).closeClip}\`` : ''}, ${b(r).trigger}${b(r).sound ? `, sound \`${b(r).sound}\`` : ''}` : '';
		return `| ${it.label} | \`${it.name}\` | ${size} | ${r.tris} | ${Math.round(r.bytes / 1024)} KB | ${r.nodes.join(', ')} | ${beh} | ${it.place} | ${it.source} |`;
	});
	const table = ['| Item | Folder | Size x × y × z (m) | Tris | GLB | Nodes | Behavior | Place it | Made from |', '|---|---|---|---|---|---|---|---|---|', ...rows].join('\n');
	const md = fs.readFileSync(kitMd, 'utf8').replace(/<!-- items:start -->[\s\S]*<!-- items:end -->/, `<!-- items:start -->\n${table}\n<!-- items:end -->`);
	fs.writeFileSync(kitMd, md);
}
console.log(`${list.length} items → ${path.relative(REPO, listFile)}`);
