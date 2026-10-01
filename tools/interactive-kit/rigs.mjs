// The interactive-kit recipes: one async function per item → a rigged GLB (tools/anim).
// Every door ships WITH its frame (frame = static `Frame`, leaf = animated node whose origin is
// the hinge). Front = +Z; a door opens AWAY from the front (into the room behind it).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { part, proc, assemble, swing, slide, reverse, clip, quat, ease, THREE, TOOLS } from '../anim/anim.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (/** @type {string} */ p) => path.join(REPO, p);
const STAGING = process.env.MESHY_STAGING || path.join(process.env.HOME ?? '', '.code/lanes-30/meshy/staging/33-anim-kit');
/** a kept Meshy output (meshy-post'ed model.glb of a job's newest refine) — vendored into
 * tools/interactive-kit/meshy/ by build.mjs so the kit rebuilds after Meshy's 3-day retention */
export function meshy(/** @type {string} */ job) {
	const vendored = path.join(path.dirname(fileURLToPath(import.meta.url)), 'meshy', job + '.glb');
	if (fs.existsSync(vendored)) return vendored;
	const dir = path.join(STAGING, job);
	// the newest textured stage: a retexture job has only retexture-<n>, a refine job refine-<n>
	const best = fs
		.readdirSync(dir)
		.filter((d) => /^(refine|retexture)-\d+$/.test(d) && fs.existsSync(path.join(dir, d, 'model.glb')))
		.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs)[0];
	if (!best) throw new Error(`no textured Meshy output for ${job} in ${dir}`);
	return path.join(dir, best, 'model.glb');
}
/** warm, darker oak for Meshy's pale refines */
const OAK = [0.72, 0.56, 0.42];
const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), '.build');

/** a wall cut with an opening by the architecture kit's own kit-cut (capped, textured jambs) */
async function cutWall(/** @type {string} */ wall, /** @type {string} */ name, /** @type {any} */ opening) {
	const { kitCut, DERIVE } = await import('../architecture-kit/kit-cut.mjs');
	fs.mkdirSync(BUILD, { recursive: true });
	const out = path.join(BUILD, name + '.glb');
	await kitCut(src(wall), out, DERIVE.door(opening));
	return out;
}
/** open/close clips from the OPEN tracks (close = each track reversed) */
const pair = (/** @type {any[]} */ tracks) => [
	{ name: 'open', tracks },
	{ name: 'close', tracks: tracks.map((t) => ({ ...t, keys: reverse(t.keys) })) }
];
/** a hinged lid / toggle behavior */
const TOGGLE = (/** @type {string} */ sound, clip = 'open', closeClip = 'close') => ({ type: 'toggle', clip, closeClip, trigger: 'click', autoplay: false, sound, collider: 'follow' });

/** a hinged-door behavior (contract P2) */
export const DOOR = (sound = 'door') => ({ type: 'door', clip: 'open', closeClip: 'close', trigger: 'click', autoplay: false, sound, collider: 'follow' });

export const RIGS = {
	/** architecture-kit Door split into its frame and its leaf; the leaf slimmed to 13 cm */
	async DoorWood(/** @type {string} */ out) {
		const door = src('architecture-kit/Door/glTF-Binary/door.glb');
		const W = 0.5; // half the 1.0 m doorway
		const H = 2.2;
		const T = 0.065; // half the slimmed leaf
		const leaf = (await part(door)).keep([[-1, 0, 0, W], [1, 0, 0, W], [0, 1, 0, H]]).scale([1, 1, T / 0.163]);
		await leaf.box([-W + 5e-4, 5e-4, -T * 0.8], [W - 5e-4, H - 5e-4, T * 0.8], { skip: '+z,-z' });
		leaf.at('Leaf', [-W, 0, -T]);
		const frame = (await part(door)).cut([[-1, 0, 0, W], [1, 0, 0, W], [0, 1, 0, H]]);
		// seal the cut: the two jambs' inner faces and the lintel's underside
		const near = { lo: [-0.65, 0, -0.2], hi: [-0.5, 2.35, 0.2] };
		await frame.box([-0.64, 0, -0.155], [-W - 5e-4, H, 0.155], { skip: '-x,+y,-y,+z,-z', face: [0, 0, 1], near });
		await frame.box([W + 5e-4, 0, -0.155], [0.64, H, 0.155], { skip: '+x,+y,-y,+z,-z', face: [0, 0, 1], near: { lo: [0.5, 0, -0.2], hi: [0.65, 2.35, 0.2] } });
		await frame.box([-W, H + 5e-4, -0.14], [W, 2.33, 0.14], { skip: '+y,+x,-x,+z,-z', face: [0, 0, 1], near: { lo: [-0.5, 2.2, -0.2], hi: [0.5, 2.35, 0.2] } });
		frame.at('Frame');
		return assemble([frame, leaf], out, { clips: pair([{ node: 'Leaf', path: 'rotation', keys: swing('y', 0, 95, 1.1) }]), behavior: DOOR('door') });
	},

	/** a sandstone wall with a 1.6 × 2.4 m doorway (kit-cut) + the kit Gate's two oak leaves scaled into it */
	async DoorDouble(/** @type {string} */ out) {
		const frame = (await part(await cutWall('architecture-kit/WallStone/glTF-Binary/wall-stone.glb', 'wall-stone-double', { w: 1.6, h: 2.4 }))).at('Frame');
		const gate = src('architecture-kit/Gate/glTF-Binary/gate.glb');
		const T = 0.07;
		const half = async (/** @type {number} */ sx) => {
			const p = (await part(gate)).scale([0.8, 0.8, T / 0.1]).keep([[sx, 0, 0, 0]]);
			await p.box(sx < 0 ? [-2e-3, 1e-3, -T * 0.8] : [-0.8, 1e-3, -T * 0.8], sx < 0 ? [0.8, 2.399, T * 0.8] : [2e-3, 2.399, T * 0.8], { skip: sx < 0 ? '+z,-z,+x,+y,-y' : '+z,-z,-x,+y,-y' });
			return p;
		};
		const L = (await half(1)).at('LeafL', [-0.8, 0, -T]);
		const R = (await half(-1)).at('LeafR', [0.8, 0, -T]);
		return assemble([frame, L, R], out, {
			clips: pair([
				{ node: 'LeafL', path: 'rotation', keys: swing('y', 0, 92, 1.3) },
				{ node: 'LeafR', path: 'rotation', keys: swing('y', 0, -92, 1.3) }
			]),
			behavior: DOOR('door')
		});
	},

	/** scifi-kit Sliding door: the frame stays, the two panels part into the wall (fits Wall — open doorway) */
	async SlidingDoor(/** @type {string} */ out) {
		return slidingPair(src('scifi-kit/SlidingDoor/glTF-Binary/sliding-door.glb'), out, null);
	},

	/** scifi-kit Wall + sliding door in one piece, the panels parting into the wall */
	async WallSlidingDoor(/** @type {string} */ out) {
		return slidingPair(src('scifi-kit/WallDoor/glTF-Binary/wall-door.glb'), out, 1);
	},

	/** props-kit Hatch with an oak floor frame and a dark shaft under it */
	async Trapdoor(/** @type {string} */ out) {
		const hatchFile = src('props-kit/Hatch/glTF-Binary/hatch.glb');
		const hatch = (await part(hatchFile)).move([0, 0, -0.5]).at('Leaf', [0, 0.087, -0.5]);
		const beams = [
			[[-0.62, 0, -0.62], [0.62, 0.1, -0.5]],
			[[-0.62, 0, 0.5], [0.62, 0.1, 0.62]],
			[[-0.62, 0, -0.5], [-0.5, 0.1, 0.5]],
			[[0.5, 0, -0.5], [0.62, 0.1, 0.5]]
		].map(([lo, hi]) => new THREE.BoxGeometry(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]).translate((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2));
		const { mergeGeometries } = await import(`${TOOLS}/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js`);
		const frame = await proc(mergeGeometries(beams.map((g) => g.toNonIndexed())), hatchFile, { material: 'oakPlanks', tile: 0.5 });
		// one Frame node: the beams and a dark shaft (reads as the hole under the hatch)
		frame.add(await proc(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0.002, 0), hatchFile, { into: frame, material: 'oakPlanks', color: [0.03, 0.025, 0.02, 1], name: 'shaft' }));
		return assemble([frame.at('Frame'), hatch], out, { clips: pair([{ node: 'Leaf', path: 'rotation', keys: swing('x', 0, -105, 1.2) }]), behavior: TOGGLE('door') });
	},

	/** a Meshy studded oak leaf in a heavy oak timber frame (fits the kit doorway, like Door) */
	async DoorStudded(/** @type {string} */ out) {
		const W = 0.5;
		const H = 2.2;
		const T = 0.05;
		const leafFile = meshy('door-studded-a');
		const leaf = (await part(leafFile)).tint([0.62, 0.48, 0.36]).scale([1.0 / 0.98, H / 2.18, 1]);
		leaf.at('Leaf', [-W, 0, -T]);
		const frame = await timberFrame(W, H, 0.15, 0.33);
		return assemble([frame, leaf], out, { clips: pair([{ node: 'Leaf', path: 'rotation', keys: swing('y', 0, 95, 1.3) }]), behavior: DOOR('door') });
	},

	/** a Meshy wrought-iron double gate hung between two kit sandstone pillars (pillar centres 2 m apart) */
	async IronGate(/** @type {string} */ out) {
		const pillarFile = src('architecture-kit/Pillar/glTF-Binary/pillar.glb');
		// the frame is two static nodes (core treats every node no clip animates as frame)
		const PL = (await part(pillarFile)).move([-1, 0, 0]).at('Frame');
		const PR = (await part(pillarFile)).move([1, 0, 0]).at('FrameR');
		const g = meshy('iron-gate-a');
		const half = async (/** @type {number} */ sx) => (await part(g)).scale([0.75 / 0.85, 1, 1]).keep([[sx, 0, 0, 0]]);
		const L = (await half(1)).at('LeafL', [-0.75, 0, 0]);
		const R = (await half(-1)).at('LeafR', [0.75, 0, 0]);
		return assemble([PL, PR, L, R], out, {
			clips: pair([
				{ node: 'LeafL', path: 'rotation', keys: swing('y', 0, 95, 1.6) },
				{ node: 'LeafR', path: 'rotation', keys: swing('y', 0, -95, 1.6) }
			]),
			behavior: DOOR('gate')
		});
	},

	/** a Meshy iron portcullis in a 2 × 4.5 m sandstone gate wall: it winds up into the wall above */
	async Portcullis(/** @type {string} */ out) {
		const wall = await part(await cutWall('architecture-kit/WallStone/glTF-Binary/wall-stone.glb', 'wall-stone-portcullis', { w: 1.7, h: 2.2 }));
		wall.at('Frame');
		const upper = (await part(src('architecture-kit/WallStoneHalf/glTF-Binary/wall-stone-half.glb'))).move([0, 3, 0]).at('FrameTop');
		// Meshy drew the spikes on top: turn it over, 1.8 × 2.3 m, 8 cm thick
		const grid = (await part(meshy('portcullis-b'))).rotZ(180).move([0, 2.7, 0]).scale([1, 2.3 / 2.7, 0.08 / 0.12]).at('Grid');
		return assemble([wall, upper, grid], out, {
			clips: [
				{ name: 'open', tracks: [{ node: 'Grid', path: 'translation', keys: slide([0, 0, 0], [0, 0, 0], [0, 2.12, 0], 2.4) }] },
				{ name: 'close', tracks: [{ node: 'Grid', path: 'translation', keys: ease((u) => [0, 2.12 * (1 - u), 0], 1.1, 10, (u) => u * u) }] }
			],
			behavior: { type: 'door', clip: 'open', closeClip: 'close', trigger: 'click', autoplay: false, sound: 'gate', collider: 'follow' }
		});
	},

	/** a Meshy oak wardrobe: the two doors swing out, an oak-lined inside with a shelf */
	async Cabinet(/** @type {string} */ out) {
		const f = meshy('cabinet-a');
		const X = 0.425;
		const Y0 = 0.2;
		const Y1 = 1.37;
		const Z = 0.14; // the doors' back face
		const body = (await part(f)).tint(OAK).cut([[-1, 0, 0, X], [1, 0, 0, X], [0, -1, 0, -Y0], [0, 1, 0, Y1], [0, 0, -1, -Z]]);
		await body.box([-X, Y0, -0.2], [X, Y1, Z], { skip: '+z', inward: true, pct: 0.25 });
		await body.box([-X + 0.01, 0.78, -0.2], [X - 0.01, 0.8, Z - 0.02], { pct: 0.5 });
		const door = async (/** @type {number} */ sx) => {
			const p = (await part(f)).tint(OAK).keep([[-1, 0, 0, X], [1, 0, 0, X], [0, -1, 0, -Y0], [0, 1, 0, Y1], [0, 0, -1, -Z]]).keep([[sx, 0, 0, 0]]);
			const lo = sx > 0 ? [-X, Y0, Z] : [0, Y0, Z];
			const hi = sx > 0 ? [0, Y1, Z + 0.03] : [X, Y1, Z + 0.03];
			await p.box(lo, hi, { skip: '+z,+x,-x,+y,-y', pct: 0.35 });
			return p;
		};
		const L = (await door(1)).at('DoorL', [-X, 0, 0.2]);
		const R = (await door(-1)).at('DoorR', [X, 0, 0.2]);
		return assemble([body.at('Frame'), L, R], out, {
			clips: pair([
				{ node: 'DoorL', path: 'rotation', keys: swing('y', 0, -105, 0.9) },
				{ node: 'DoorR', path: 'rotation', keys: swing('y', 0, 105, 0.9) }
			]),
			behavior: TOGGLE('door')
		});
	},

	/** a Meshy oak chest of drawers: the three drawers slide out, staggered, each a real box */
	async Drawers(/** @type {string} */ out) {
		const f = meshy('cabinet-b-oak');
		const X = 0.425;
		const Z = 0.15;
		const rows = [[0.2, 0.415], [0.46, 0.653], [0.697, 0.905]];
		let body = reskinSides((await part(f)).tint(OAK), 0.44, 0.95);
		for (const [y0, y1] of rows) body = body.cut([[-1, 0, 0, X], [1, 0, 0, X], [0, -1, 0, -y0], [0, 1, 0, y1], [0, 0, -1, -Z]]);
		for (const [y0, y1] of rows) await body.box([-X, y0, -0.22], [X, y1, Z], { skip: '+z', inward: true, pct: 0.15 });
		const parts = [body.at('Frame')];
		const tracks = [];
		for (const [i, [y0, y1]] of rows.entries()) {
			const d = (await part(f)).tint(OAK).keep([[-1, 0, 0, X], [1, 0, 0, X], [0, -1, 0, -y0], [0, 1, 0, y1], [0, 0, -1, -Z]]);
			// the drawer box behind its front: sides + bottom, seen from in and out
			const lo = [-X + 0.02, y0 + 0.02, -0.2];
			const hi = [X - 0.02, y1 - 0.05, Z];
			await d.box(lo, hi, { skip: '+y,+z', inward: true, pct: 0.3 });
			await d.box(lo, hi, { skip: '+y,+z', pct: 0.45 });
			const name = `Drawer${i + 1}`;
			parts.push(d.at(name));
			const reach = 0.32 - i * 0.04;
			const delay = (2 - i) * 0.12;
			tracks.push({ node: name, path: /** @type {const} */ ('translation'), keys: [[0, [0, 0, 0]], ...slide([0, 0, 0], [0, 0, 0], [0, 0, reach], 0.6).map(([t, v]) => /** @type {[number, number[]]} */ ([+(t + delay).toFixed(4), v]))] });
		}
		return assemble(parts, out, { clips: pair(tracks.map((t) => ({ ...t, keys: t.keys.filter((k, j) => j > 0 || t.keys[1][0] > 0) }))), behavior: TOGGLE('lid') });
	},

	/** a Meshy ceiling fan, origin at its ceiling mount (place it at the ceiling's height); the
	 * rotor turns for ever — an ambient loop, the only kind that autoplays */
	async CeilingFan(/** @type {string} */ out) {
		const f = meshy('ceiling-fan-a');
		const top = 0.993;
		const cutY = 0.75;
		const mount = (await part(f)).keep([[0, -1, 0, -cutY]]).move([0, -top, 0]).at('Frame');
		const rotor = (await part(f)).keep([[0, 1, 0, cutY]]).move([0, -top, 0]).at('Rotor');
		const keys = [0, 1, 2, 3].map((i) => /** @type {[number, number[]]} */ ([i * 0.6, quat('y', -120 * i)]));
		return assemble([mount, rotor], out, { clips: [{ name: 'loop', tracks: [{ node: 'Rotor', path: 'rotation', keys }] }], behavior: LOOP() });
	},

	/** architecture-kit Window: its splayed shutters are cut off, laid shut over the 0.8 m opening
	 * (stretched to 0.4 m each) and hung on hinges; placed OPEN (160°), the first click closes them */
	async Shutters(/** @type {string} */ out) {
		const f = src('architecture-kit/Window/glTF-Binary/window.glb');
		const HX = 0.4; // the hinge lines: the opening's sides
		const HZ = 0.105;
		const frame = (await part(f)).cut([[-1, 0, 0, -HX], [0, 0, -1, -0.08]]).cut([[1, 0, 0, -HX], [0, 0, -1, -0.08]]).at('Frame');
		const shutter = async (/** @type {number} */ side) => {
			const p = (await part(f)).keep([[-side, 0, 0, -HX], [0, 0, -1, -0.08]]);
			// lay it shut: rotate about its hinge until it points at the window's centre, then stretch it to 0.4 m
			const { lo, hi } = p.bounds();
			const tip = side > 0 ? [hi[0], hi[2]] : [lo[0], hi[2]];
			const ang = Math.atan2(tip[1] - HZ, Math.abs(tip[0] - side * HX)); // its splay from the wall plane
			const len = Math.hypot(tip[1] - HZ, tip[0] - side * HX);
			p.move([-side * HX, 0, -HZ]).rotY((-side * (Math.PI - ang) * 180) / Math.PI);
			p.scale([HX / len, 1, 1]).move([side * HX, 0, HZ + 0.012]);
			return p.at(side > 0 ? 'ShutterR' : 'ShutterL', [side * HX, 0, HZ], null, quat('y', side * 160));
		};
		const R = await shutter(1);
		const L = await shutter(-1);
		const close = [
			{ node: 'ShutterR', path: /** @type {const} */ ('rotation'), keys: swing('y', 160, 0, 0.9) },
			{ node: 'ShutterL', path: /** @type {const} */ ('rotation'), keys: swing('y', -160, 0, 0.9) }
		];
		return assemble([frame, L, R], out, {
			clips: [
				{ name: 'close', tracks: close },
				{ name: 'open', tracks: close.map((t) => ({ ...t, keys: reverse(t.keys) })) }
			],
			behavior: { type: 'toggle', clip: 'close', closeClip: 'open', trigger: 'click', autoplay: false, sound: 'door', collider: 'follow' }
		});
	},

	/** props-kit LeverBase + LeverHandle: one pull throws the handle forward and it springs back */
	async Lever(/** @type {string} */ out) {
		const base = (await part(src('props-kit/LeverBase/glTF-Binary/lever-base.glb'))).at('Frame');
		const handle = (await part(src('props-kit/LeverHandle/glTF-Binary/lever-handle.glb'))).move([0, 0.16, 0]).at('Handle', [0, 0.16, 0], null, quat('x', -35));
		const q = (/** @type {number} */ d) => quat('x', d);
		return assemble([base, handle], out, {
			clips: [{ name: 'pull', tracks: [{ node: 'Handle', path: 'rotation', keys: legs([[0, q(-35)], [0.35, q(35)], [0.7, q(35)], [1.2, q(-35)]]) }] }],
			behavior: ONESHOT('pull', 'lever')
		});
	},

	/** props-kit PressurePlate: the slate plate sinks 2.5 cm when someone steps near, and rises */
	async PressurePlate(/** @type {string} */ out) {
		const f = src('props-kit/PressurePlate/glTF-Binary/pressure-plate.glb');
		const frame = (await part(f)).only('sandstone').at('Frame');
		const plate = (await part(f)).only((m) => m?.getName() !== 'sandstone').at('Plate');
		return assemble([frame, plate], out, {
			clips: [{ name: 'press', tracks: [{ node: 'Plate', path: 'translation', keys: legs([[0, [0, 0, 0]], [0.12, [0, -0.025, 0]], [0.6, [0, -0.025, 0]], [0.9, [0, 0, 0]]]) }] }],
			behavior: ONESHOT('press', 'click', 'proximity')
		});
	},

	/** props-kit WallButton: the teal cap pushes in 1.5 cm and springs back */
	async WallButton(/** @type {string} */ out) {
		const f = src('props-kit/WallButton/glTF-Binary/wall-button.glb');
		const frame = (await part(f)).only((m) => m?.getName() !== 'teal').at('Frame');
		const cap = (await part(f)).only('teal').at('Cap');
		return assemble([frame, cap], out, {
			clips: [{ name: 'press', tracks: [{ node: 'Cap', path: 'translation', keys: legs([[0, [0, 0, 0]], [0.08, [0, 0, -0.015]], [0.3, [0, 0, -0.015]], [0.5, [0, 0, 0]]]) }] }],
			behavior: ONESHOT('press', 'click')
		});
	},

	/** props-kit WallTorch with a flickering flame (ambient: loop + autoplay) */
	async Torch(/** @type {string} */ out) {
		const f = src('props-kit/WallTorch/glTF-Binary/wall-torch.glb');
		const torch = (await part(f)).only((m) => m?.getName() !== 'Flame').at('Frame');
		const flame = (await part(f)).only('Flame');
		const { lo, hi } = flame.bounds();
		flame.at('Flame', [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2]);
		// an irregular 1.6 s cycle: height, width and a lean that never repeat inside the loop
		const S = [[1, 1, 1], [0.92, 1.12, 0.94], [1.06, 0.9, 1.04], [0.96, 1.18, 0.97], [1.04, 0.95, 1.02], [0.9, 1.08, 0.93], [1.02, 0.86, 1.05], [0.95, 1.14, 0.96], [1, 1, 1]];
		const R = [0, 4, -3, 5, -2, 3, -5, 2, 0];
		const t = (/** @type {number} */ i) => +((i * 1.6) / (S.length - 1)).toFixed(4);
		return assemble([torch, flame], out, {
			clips: [{ name: 'loop', tracks: [
				{ node: 'Flame', path: 'scale', keys: S.map((v, i) => [t(i), v]) },
				{ node: 'Flame', path: 'rotation', keys: R.map((d, i) => [t(i), quat('z', d)]) }
			] }],
			behavior: LOOP()
		});
	},

	/** props-kit Tapestry as a banner stirring in a draught (ambient: loop + autoplay; morph targets) */
	async Banner(/** @type {string} */ out) {
		const f = src('props-kit/Tapestry/glTF-Binary/tapestry.glb');
		const rod = (await part(f)).only((m) => m?.getName() !== 'tapestry').at('Frame');
		const cloth = (await part(f)).only('tapestry').at('Banner');
		const top = 1.6;
		const drop = (/** @type {number[]} */ v) => Math.max(0, (top - v[1]) / top); // 0 at the rod, 1 at the hem
		const target = (/** @type {(v: number[], d: number) => number[]} */ fn) => cloth.pieces.map((p) => p.tris.map((t) => t.map((v) => {
			const d = drop(v);
			const [dx, dz] = fn(v, d);
			return [v[0] + dx, v[1], v[2] + dz];
		})));
		// A: the hem lifts away from the wall; B: a ripple runs down and the hem swings sideways
		const A = target((v, d) => [0, 0.11 * d * d]);
		const B = target((v, d) => [0.035 * d * d * Math.sign(v[0] || 1) * 0.5 + 0.03 * d * d, 0.025 * d * Math.sin(Math.PI * 2 * (1.3 * d + v[0] * 0.4))]);
		const n = 12;
		const T = 3.2;
		const keys = [...Array(n + 1).keys()].map((i) => {
			const ph = (i / n) * Math.PI * 2;
			return /** @type {[number, number[]]} */ ([+((i / n) * T).toFixed(4), [0.5 + 0.5 * Math.sin(ph), Math.sin(ph + 1.1)]]);
		});
		return assemble([rod, cloth], out, { clips: [{ name: 'loop', tracks: [{ node: 'Banner', path: 'weights', keys }] }], morph: { Banner: { targets: [A, B] } }, behavior: LOOP() });
	},

	/** props-kit Chest: the lid lifts off the body on a hinge along its back edge */
	async Chest(/** @type {string} */ out) {
		return lidded(src('props-kit/Chest/glTF-Binary/chest.glb'), out, { seam: 0.36, angle: -105, sound: 'lid', inset: 0.075, near: { lo: [-0.3, 0.08, 0], hi: [-0.12, 0.3, 0.4] } });
	},

	/** props-kit Crate: the top boards are a hinged lid */
	async Crate(/** @type {string} */ out) {
		return lidded(src('props-kit/Crate/glTF-Binary/crate.glb'), out, { seam: 0.48, angle: -110, sound: 'lid', inset: 0.03 });
	}
};

/** a oneshot: plays once per trigger */
const ONESHOT = (/** @type {string} */ clip, /** @type {string} */ sound, trigger = 'click') => ({ type: 'oneshot', clip, trigger, autoplay: false, sound });
/** an ambient loop: the ONLY kind that autoplays (contract P2) */
const LOOP = (clip = 'loop') => ({ type: 'loop', clip, trigger: 'click', autoplay: true });
/** keys through a list of [time, value] stops, each leg eased */
function legs(/** @type {[number, number[]][]} */ stops, steps = 6) {
	/** @type {[number, number[]][]} */
	const keys = [[stops[0][0], stops[0][1]]];
	for (let i = 1; i < stops.length; i++) {
		const [t0, a] = stops[i - 1];
		const [t1, b] = stops[i];
		for (const [t, v] of ease((u) => a.map((x, k) => x + (b[k] - x) * u), t1 - t0, steps).slice(1)) keys.push([+(t0 + t).toFixed(4), v]);
	}
	return keys;
}

/**
 * Re-skin a part's flat side panels (|normal·x| > 0.9 beyond |x| > xMin) with its clean TOP:
 * fit the top's (x, z) → uv affine map by least squares, then sample it at the side's (z, y)
 * stretched over the top's extent. Meshy's chest of drawers ships a smeared side-panel island.
 * @param {import('../anim/anim.mjs').Part} p @param {number} xMin @param {number} yTop
 */
function reskinSides(p, xMin, yTop) {
	// FACE normals: Meshy's vertex normals are smoothed round every edge
	const fn = (/** @type {number[][]} */ [a, b, c]) => {
		const n = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).cross(new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]));
		return n.normalize();
	};
	for (const piece of p.pieces) {
		const top = piece.tris.filter((t) => fn(t).y > 0.9 && t.every((v) => v[1] > yTop));
		const pts = top.flat();
		if (pts.length < 3) continue;
		// least squares for u = a x + b z + c (and v): 3×3 normal equations
		const fit = (/** @type {number} */ k) => {
			const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
			const B = [0, 0, 0];
			for (const v of pts) {
				const r = [v[0], v[2], 1];
				for (let i = 0; i < 3; i++) {
					B[i] += r[i] * v[k];
					for (let j = 0; j < 3; j++) A[i][j] += r[i] * r[j];
				}
			}
			return new THREE.Matrix3().set(...A.flat()).invert().toArray(); // column-major
		};
		const solve = (/** @type {number} */ k) => {
			const inv = fit(k);
			const B = [0, 0, 0];
			for (const v of pts) [v[0], v[2], 1].forEach((r, i) => (B[i] += r * v[k]));
			return [0, 1, 2].map((i) => inv[i] * B[0] + inv[i + 3] * B[1] + inv[i + 6] * B[2]);
		};
		const cu = solve(6);
		const cv = solve(7);
		const xs = pts.map((v) => v[0]);
		const zs = pts.map((v) => v[2]);
		const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
		const sideTris = piece.tris.filter((t) => Math.abs(fn(t).x) > 0.9 && t.every((v) => Math.abs(v[0]) > xMin));
		// copy the vertices first: a vertex record is shared with its neighbours across the edge
		for (const t of sideTris) for (let i = 0; i < 3; i++) t[i] = t[i].slice();
		const sides = sideTris.flat();
		if (!sides.length) continue;
		const sz = sides.map((v) => v[2]);
		const sy = sides.map((v) => v[1]);
		const [a0, a1, b0, b1] = [Math.min(...sz), Math.max(...sz), Math.min(...sy), Math.max(...sy)];
		for (const v of sides) {
			const x = x0 + ((v[1] - b0) / (b1 - b0 || 1)) * (x1 - x0); // the side's height runs along the top's grain
			const z = z0 + ((v[2] - a0) / (a1 - a0 || 1)) * (z1 - z0);
			v[6] = cu[0] * x + cu[1] * z + cu[2];
			v[7] = cv[0] * x + cv[1] * z + cv[2];
		}
	}
	return p;
}

/** a heavy oak door frame: two jambs + a lintel round a w×h doorway, `t` thick, `d` deep (procedural, box-UV'd oak) */
async function timberFrame(/** @type {number} */ W, /** @type {number} */ H, /** @type {number} */ t, /** @type {number} */ d) {
	const { mergeGeometries } = await import(`${TOOLS}/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js`);
	const B = (/** @type {number[]} */ lo, /** @type {number[]} */ hi) =>
		new THREE.BoxGeometry(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]).translate((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2).toNonIndexed();
	const geo = mergeGeometries([
		B([-W - t, 0, -d / 2], [-W, H, d / 2]),
		B([W, 0, -d / 2], [W + t, H, d / 2]),
		B([-W - t - 0.03, H, -d / 2 - 0.01], [W + t + 0.03, H + t, d / 2 + 0.01])
	]);
	const frame = await proc(geo, src('props-kit/Hatch/glTF-Binary/hatch.glb'), { material: 'oakPlanks', tile: 0.6, color: [0.62, 0.5, 0.4, 1], name: 'oakFrame' });
	return frame.at('Frame');
}

/** a sliding pair: the panels are |x| < 0.65 under 2.45 m of the piece with material index `door`
 * (null = every piece); they part sideways by 0.62 m, into the wall the doorway is cut in */
async function slidingPair(/** @type {string} */ file, /** @type {string} */ out, /** @type {number | null} */ door) {
	const W = 0.65;
	const H = 2.45;
	const region = [[-1, 0, 0, W], [1, 0, 0, W], [0, 1, 0, H]];
	const isDoor = (/** @type {number} */ i) => door === null || i === door;
	const frame = await part(file);
	frame.pieces = frame.pieces.map((p, i) => (isDoor(i) ? { ...p, tris: clip(p.tris, region, 'cut') } : p)).filter((p) => p.tris.length);
	const panel = async (/** @type {number} */ sx) => {
		const p = await part(file);
		p.pieces = p.pieces.filter((_, i) => isDoor(i));
		p.keep(region).keep([[sx, 0, 0, 0]]);
		// the meeting edge, sealed
		const x = -sx * 5e-4;
		await p.box(sx > 0 ? [x - 0.01, 0.001, -0.045] : [x, 0.001, -0.045], sx > 0 ? [x, H - 0.05, 0.045] : [x + 0.01, H - 0.05, 0.045], { skip: (sx > 0 ? '-x' : '+x') + ',+y,-y,+z,-z' });
		return p;
	};
	const L = (await panel(1)).at('PanelL');
	const R = (await panel(-1)).at('PanelR');
	return assemble([frame.at('Frame'), L, R], out, {
		clips: pair([
			{ node: 'PanelL', path: 'translation', keys: slide([0, 0, 0], [0, 0, 0], [-0.62, 0, 0], 0.7) },
			{ node: 'PanelR', path: 'translation', keys: slide([0, 0, 0], [0, 0, 0], [0.62, 0, 0], 0.7) }
		]),
		behavior: { type: 'door', clip: 'open', closeClip: 'close', trigger: 'proximity', autoplay: false, sound: 'slide', collider: 'follow' }
	});
}

/** a lidded box: lid = above `seam`, hinge on the back top edge, an inside tray under it */
async function lidded(/** @type {string} */ file, /** @type {string} */ out, /** @type {{seam: number, angle: number, sound: string, inset: number, near?: any}} */ o) {
	const body = (await part(file)).keep([[0, 1, 0, o.seam]]);
	const { lo, hi } = body.bounds();
	const lid = (await part(file)).keep([[0, -1, 0, -o.seam]]);
	const lb = lid.bounds();
	// the lid's cut underside, sealed flat
	await lid.box([lb.lo[0] + 0.01, o.seam + 2e-4, lb.lo[2] + 0.01], [lb.hi[0] - 0.01, o.seam + 0.01, lb.hi[2] - 0.01], { skip: '+y,+x,-x,+z,-z', face: [0, 0, 1], pct: 0.2 });
	// the body's open top: a dark inside, a rim
	// `inset`: from the bbox in to the wood (a chest's iron corners stand proud of its planks)
	await body.tray({ lo: [lo[0] + o.inset, lo[2] + o.inset], hi: [hi[0] - o.inset, hi[2] - o.inset] }, o.seam, 0.035, o.seam * 0.7, { face: [0, 0, 1], near: o.near, rim: { near: o.near, face: [0, 0, 1] } });
	body.at('Frame');
	lid.at('Lid', [0, o.seam, lb.lo[2] + 0.02]);
	return assemble([body, lid], out, { clips: pair([{ node: 'Lid', path: 'rotation', keys: swing('x', 0, o.angle, 1.0) }]), behavior: TOGGLE(o.sound) });
}
