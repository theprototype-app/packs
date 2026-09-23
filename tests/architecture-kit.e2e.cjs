// E2E: the Modular Architecture Kit in the real app, read the way production reads it
// (PACKS_BASE → index.json → architecture-kit/default.json → <Item>/glTF-Binary/<file>).
//
//   1. the pack lists in the Explorer's Packs section and opens with every item + thumbnail
//   2. CATALOGUE: every item places, is textured, within the tris budget, at its kit dims
//   3. GRID SNAP: a real gizmo drag with 1 m snapping lands a wall on the grid
//   4. ROOM: 4 walls (one with the doorway + door), corner posts, a 2 × 2 floor, a gable
//      roof — every piece's world bbox is exactly where the kit doc says
//   5. SEAMS: from inside the sealed room, against a MAGENTA background, not one background
//      pixel shows through any joint; the control nudges one wall 5 cm and the gap appears
//   6. REPLICATION: peer B receives every piece with the same bbox
//   7. screenshots → $SHOTS (default ~/.code/lanes-30/after-30c/30c-pack-arch/)
//
// Run against a core dev server built with VITE_PACKS_BASE pointing at this checkout:
//   node tools/architecture-kit/serve-pack.mjs 5257 &
//   (core) VITE_PACKS_BASE=https://theprototype.app:5257 npm run dev -- --port 5252 --strictPort --host theprototype.app
//   e2e-slot -- env APP_URL=https://theprototype.app:5252/ CORE=<core worktree> node tests/architecture-kit.e2e.cjs > out.log 2>&1
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const CORE = process.env.CORE || '/home/deck/.code/theprototype-app/theprototype-lane-30c-arch-engine';
const h = require(path.join(CORE, 'tests/e2e/helpers.cjs'));
const REPO = path.resolve(__dirname, '..');
const PACK = 'architecture-kit';
const SHOTS = process.env.SHOTS || path.join(os.homedir(), '.code/lanes-30/after-30c/30c-pack-arch');
const list = JSON.parse(fs.readFileSync(path.join(REPO, PACK, 'default.json'), 'utf8'));
const report = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/architecture-kit/report.json'), 'utf8'));
const ROOM_ONLY = !!process.env.ROOM_ONLY; // debug: build + measure the room only (no catalogue, snap, peer B)
const TRI_BUDGET = { Tower: 6000 }; // architecture pieces 1-6k (the round's art direction)
fs.mkdirSync(SHOTS, { recursive: true });

/** world bbox of a local bbox turned by rotY (degrees, multiples of 90) and moved to pos */
function worldBox(name, pos, rotY) {
	const r = report[name];
	const a = (rotY * Math.PI) / 180;
	const c = Math.round(Math.cos(a));
	const s = Math.round(Math.sin(a));
	const xs = [];
	const zs = [];
	for (const x of [r.min[0], r.max[0]])
		for (const z of [r.min[2], r.max[2]]) {
			// three.js Y rotation: x' = x c + z s, z' = -x s + z c
			xs.push(x * c + z * s);
			zs.push(-x * s + z * c);
		}
	return {
		min: [pos[0] + Math.min(...xs), pos[1] + r.min[1], pos[2] + Math.min(...zs)],
		max: [pos[0] + Math.max(...xs), pos[1] + r.max[1], pos[2] + Math.max(...zs)]
	};
}
const near = (a, b, eps = 2e-3) => a.every((v, i) => Math.abs(v - b[i]) < eps);

/** in-page: bbox + texture/tris facts per uuid */
const measure = (page, uuids) =>
	page.evaluate((ids) => {
		const s = window.__stores;
		let g;
		s.objectsGroup.subscribe((x) => (g = x))();
		const out = {};
		for (const id of ids) {
			const obj = g.getObjectByProperty('uuid', id);
			if (!obj) continue;
			obj.updateMatrixWorld(true);
			const box = new s.THREE.Box3().setFromObject(obj);
			let tris = 0;
			let maps = 0;
			let mapW = 0;
			obj.traverse((o) => {
				if (!o.isMesh) return;
				tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
				for (const m of [].concat(o.material)) {
					if (m?.map?.image) {
						maps++;
						mapW = Math.max(mapW, m.map.image.width ?? 0);
					}
				}
			});
			out[id] = { min: box.min.toArray(), max: box.max.toArray(), tris: Math.round(tris), maps, mapW, name: obj.name };
		}
		return out;
	}, uuids);

const uuidsNow = (page) =>
	page.evaluate(() => {
		let g;
		window.__stores.objectsGroup.subscribe((x) => (g = x))();
		return g.children.map((c) => c.uuid);
	});

/** Place a pack item the way a drop does, then move it with the editor's own `move`. */
async function place(page, name, pos, rotY = 0) {
	const before = new Set(await uuidsNow(page));
	await page.evaluate(async (n) => {
		const s = window.__stores;
		let items;
		s.packs.openPackItems.subscribe((x) => (items = x))();
		const it = items.find((i) => i.name === n);
		await s.explorerDrop.dropExplorerItem({ url: it.glbUrl, name: it.name, kind: 'object' }, 400, 300);
	}, name);
	let uuid = null;
	for (let t = 0; t < 60 && !uuid; t++) {
		await page.waitForTimeout(250);
		uuid = (await uuidsNow(page)).find((u) => !before.has(u)) ?? null;
	}
	if (!uuid) throw new Error(`${name} never appeared`);
	await page.waitForTimeout(150);
	await page.evaluate(
		({ uuid, pos, rot }) => {
			// = moduleSDK.moveObject: set it, then the SAME `move` the editor sends
			const s = window.__stores;
			let g;
			let p;
			s.objectsGroup.subscribe((x) => (g = x))();
			s.peers.subscribe((x) => (p = x))();
			const o = g.getObjectByProperty('uuid', uuid);
			o.position.set(pos[0], pos[1], pos[2]);
			o.rotation.set(0, rot, 0);
			o.updateMatrix();
			p?.send({ type: 'move', uuid, pos: o.position.toArray(), rot: [0, rot, 0], scale: o.scale.toArray() });
		},
		{ uuid, pos, rot: (rotY * Math.PI) / 180 }
	);
	return uuid;
}

/** in-page: render the scene from `eye` towards each target into a render target against a
 * magenta background with ONLY the placed objects visible; count background pixels */
const magenta = (page, eye, targets) =>
	page.evaluate(
		({ eye, targets }) => {
			const s = window.__stores;
			const THREE = s.THREE;
			let scene;
			let renderer;
			let g;
			s.globalScene.subscribe((x) => (scene = x))();
			s.globalRenderer.subscribe((x) => (renderer = x))();
			s.objectsGroup.subscribe((x) => (g = x))();
			// only objectsGroup draws (sky, grid, gizmo, helpers hidden for the measurement)
			const hidden = [];
			const keep = new Set();
			for (let n = g; n; n = n.parent) keep.add(n);
			scene.traverse((n) => {
				if (keep.has(n) || !n.visible) return;
				let inside = false;
				for (let p = n; p; p = p.parent) if (p === g) inside = true;
				if (!inside && (n.isMesh || n.isLine || n.isPoints || n.isSprite)) {
					n.visible = false;
					hidden.push(n);
				}
			});
			const bg = scene.background;
			const fog = scene.fog;
			const env = scene.environment;
			scene.background = new THREE.Color(1, 0, 1);
			scene.fog = null;
			const size = 256;
			const rt = new THREE.WebGLRenderTarget(size, size);
			const cam = new THREE.PerspectiveCamera(100, 1, 0.02, 100);
			const buf = new Uint8Array(size * size * 4);
			const counts = [];
			const leaks = [];
			const prevTarget = renderer.getRenderTarget();
			for (const t of targets) {
				cam.position.set(eye[0], eye[1], eye[2]);
				if (Math.abs(t[0] - eye[0]) < 1e-6 && Math.abs(t[2] - eye[2]) < 1e-6) cam.up.set(0, 0, -1);
				else cam.up.set(0, 1, 0);
				cam.lookAt(t[0], t[1], t[2]);
				cam.updateMatrixWorld(true);
				renderer.setRenderTarget(rt);
				renderer.render(scene, cam);
				renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
				let n = 0;
				for (let i = 0; i < buf.length; i += 4)
					if (buf[i] > 200 && buf[i + 1] < 60 && buf[i + 2] > 200) {
						n++;
						// where the leak is: the pixel's ray through the eye, first 3 per view
						if (leaks.length < 12 && n <= 3) {
							const px = (i / 4) % size;
							const py = Math.floor(i / 4 / size);
							const dir = new THREE.Vector3(((px + 0.5) / size) * 2 - 1, ((py + 0.5) / size) * 2 - 1, 0.5).unproject(cam).sub(cam.position).normalize();
							leaks.push({ view: counts.length, dir: dir.toArray().map((v) => +v.toFixed(3)) });
						}
					}
				counts.push(n);
			}
			renderer.setRenderTarget(prevTarget);
			rt.dispose();
			scene.background = bg;
			scene.fog = fog;
			scene.environment = env;
			for (const n of hidden) n.visible = true;
			if (leaks.length) console.log('magenta leaks ' + JSON.stringify(leaks));
			window.__leaks = leaks;
			return counts;
		},
		{ eye, targets }
	);

const moveBy = (page, uuid, dx, dz) =>
	page.evaluate(
		({ uuid, dx, dz }) => {
			let g;
			window.__stores.objectsGroup.subscribe((x) => (g = x))();
			const o = g.getObjectByProperty('uuid', uuid);
			o.position.x += dx;
			o.position.z += dz;
			o.updateMatrixWorld(true);
		},
		{ uuid, dx, dz }
	);

/** a screen point that really hovers the gizmo's +X arrow (core snap-advanced's probe) */
async function findXArrowGrip(page) {
	const candidates = await page.evaluate(() => {
		let controls = null;
		let cam = null;
		window.__stores.TControls.subscribe((v) => (controls = v))();
		window.__stores.globalCamera.subscribe((v) => (cam = v))();
		const helper = controls?.getHelper?.() ?? controls;
		if (!helper || !cam) return null;
		let pick = null;
		helper.traverse((n) => {
			if (!pick && n.isMesh && n.name === 'X') pick = n;
		});
		if (!pick) return null;
		const THREE = window.__stores.THREE;
		const box = new THREE.Box3().setFromObject(pick);
		const c = box.getCenter(new THREE.Vector3());
		return [0.75, 0.6, 0.85, 0.5, 0.95].map((t) => {
			const v = new THREE.Vector3(box.min.x + t * (box.max.x - box.min.x), c.y, c.z).project(cam);
			return [((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight];
		});
	});
	if (!candidates) return null;
	for (const px of candidates) {
		await page.mouse.move(px[0], px[1]);
		await page.waitForTimeout(80);
		const axis = await page.evaluate(() => new Promise((r) => window.__stores.TControls.subscribe((c) => r(c?.axis))()));
		if (axis === 'X') return px;
	}
	return null;
}

const flyTo = (page, eye, target) =>
	page.evaluate(
		({ eye, target }) => {
			let oc;
			let cam;
			window.__stores.orbitControls.subscribe((x) => (oc = x))();
			window.__stores.globalCamera.subscribe((x) => (cam = x))();
			cam.position.set(eye[0], eye[1], eye[2]);
			oc.target.set(target[0], target[1], target[2]);
			oc.update();
		},
		{ eye, target }
	);

h.run(async () => {
	const browser = await h.launch();
	const A = await h.setupPage(browser, 'A');
	const B = ROOM_ONLY ? null : await h.setupPage(browser, 'B');
	if (B) await h.connect(B, A);

	// ---------- 0. BEFORE: the same Packs list as origin/main serves it (no kit) ----------
	if (!ROOM_ONLY) {
		const mainIndex = require('node:child_process').execFileSync('git', ['-C', REPO, 'show', 'origin/main:index.json']);
		const C = await h.setupPage(browser, 'C');
		await C.ctx.route('**/index.json', (route) => route.fulfill({ body: mainIndex, contentType: 'application/json' }));
		await h.freshReload(C);
		await C.page.waitForTimeout(1500);
		await C.page.locator('#explorer-slot').click();
		await C.page.waitForTimeout(600);
		await C.page.locator('#packs-folder').dblclick();
		await C.page.waitForTimeout(800);
		h.check((await C.page.locator(`#explorer-list [data-pack="${PACK}"]`).count()) === 0, 'BEFORE (origin/main index): no architecture kit in the Packs list');
		await C.page.screenshot({ path: path.join(SHOTS, 'before-explorer-packs.png') });
		await C.ctx.close();
	}

	// ---------- 1. the pack lists and opens ----------
	await A.page.locator('#explorer-slot').click();
	await A.page.waitForTimeout(600);
	await A.page.locator('#packs-folder').dblclick();
	await A.page.waitForTimeout(600);
	const row = A.page.locator(`#explorer-list [data-pack="${PACK}"]`);
	h.check((await row.count()) === 1, 'the Modular Architecture Kit lists in the Explorer Packs section');
	const title = await row.first().textContent();
	h.check(/Modular Architecture Kit/.test(title ?? ''), `it shows its title (${title?.trim()})`);
	await A.page.screenshot({ path: path.join(SHOTS, 'after-explorer-packs.png') });
	await row.first().click();
	let n = 0;
	for (let t = 0; t < 40 && n !== list.length; t++) {
		await A.page.waitForTimeout(250);
		n = await A.page.evaluate(() => {
			let items;
			window.__stores.packs.openPackItems.subscribe((x) => (items = x))();
			return items.length;
		});
	}
	h.check(n === list.length, `opening it lists every item (${n} / ${list.length})`);
	await A.page.waitForTimeout(1500);
	const thumbs = await A.page.evaluate(async () => {
		let items;
		window.__stores.packs.openPackItems.subscribe((x) => (items = x))();
		const res = await Promise.all(items.map((i) => fetch(i.thumbs[0]).then((r) => r.ok && r.headers.get('content-type')?.startsWith('image/'))));
		return res.filter(Boolean).length;
	});
	h.check(thumbs === list.length, `every item's committed screenshot loads (${thumbs} / ${list.length})`);
	await A.page.screenshot({ path: path.join(SHOTS, 'after-explorer-items.png') });

	const placed = []; // {name, uuid, pos, rotY}
	let snapWall = null;
	if (!ROOM_ONLY) {
	// ---------- 2. CATALOGUE: every item, in a row far from the room ----------
	let x = -12;
	for (const it of list) {
		const w = report[it.name].size[0];
		const pos = [x + w / 2, 0, -12];
		x += w + 1;
		placed.push({ name: it.name, uuid: await place(A.page, it.name, pos), pos, rotY: 0 });
	}
	await A.page.waitForTimeout(1000);
	let m = await measure(A.page, placed.map((p) => p.uuid));
	for (const p of placed) {
		const r = m[p.uuid];
		const exp = worldBox(p.name, p.pos, 0);
		const budget = TRI_BUDGET[p.name] ?? 6000;
		h.check(
			!!r && r.maps >= 1 && r.mapW > 0 && r.mapW <= 1024 && r.tris <= budget && near(r.min, exp.min) && near(r.max, exp.max),
			`${p.name}: textured (${r?.mapW}px), ${r?.tris} tris ≤ ${budget}, size ${report[p.name].size.join('×')} m at its pivot`
		);
	}

	// ---------- 3. GRID SNAP: a real gizmo drag with 1 m snapping ----------
	snapWall = await place(A.page, 'WallStone', [8.37, 0, 3.41], 0);
	await A.page.evaluate(() => {
		const s = window.__stores;
		s.snapping.snapEnabled.set(true);
		s.snapping.snapSettings.set({ translate: 1, rotateDeg: 90, scale: 0.1 });
		s.objectActions.setTransformMode?.('translate');
	});
	// the Explorer window would sit over the gizmo: close it, and aim at the wall's pivot
	// (bottom-centre, so the gizmo is at floor level)
	await A.page.locator('#explorer-slot').click();
	await A.page.waitForTimeout(500);
	await flyTo(A.page, [8.4, 4, 9], [8.4, 0, 3.4]);
	await A.page.evaluate((u) => window.__stores.objectActions.selectObject(u), snapWall);
	await A.page.waitForTimeout(700);
	await A.page.screenshot({ path: path.join(SHOTS, 'snap-drag-before.png') });
	const grip = await findXArrowGrip(A.page);
	h.check(!!grip, 'found the gizmo +X arrow');
	if (grip) {
		await A.page.mouse.move(grip[0], grip[1]);
		await A.page.mouse.down();
		await A.page.mouse.move(grip[0] + 90, grip[1], { steps: 12 });
		await A.page.mouse.move(grip[0] + 91, grip[1]);
		await A.page.mouse.up();
		await A.page.waitForTimeout(500);
	}
	const snapped = await A.page.evaluate((u) => {
		let g;
		window.__stores.objectsGroup.subscribe((x) => (g = x))();
		return g.getObjectByProperty('uuid', u).position.toArray();
	}, snapWall);
	h.check(
		Math.abs(snapped[0] - Math.round(snapped[0])) < 1e-6 && Math.round(snapped[0]) !== 8,
		`REAL drag with 1 m snap: the wall's pivot moved onto the grid (x ${snapped[0]})`
	);
	await A.page.evaluate(() => {
		window.__stores.objectActions.deselectObject();
		window.__stores.snapping.snapEnabled.set(false);
	});

	}
	// ---------- 4. ROOM: 4 × 4 m on the grid lines x∈{0,4}, z∈{0,4} ----------
	// walls centred on the lines (pivot bottom-centre), posts on the corners, floor
	// tiles on the 2 m cells, a gable roof: slopes eave-down to z=0 / z=4, ridge on z=2
	const room = [
		['FloorStone', [1, 0, 1], 0],
		['FloorStone', [3, 0, 1], 0],
		['FloorStone', [1, 0, 3], 0],
		['FloorStone', [3, 0, 3], 0],
		['WallStone', [1, 0, 0], 0],
		['WallStone', [3, 0, 0], 0],
		['WallStoneDoor', [1, 0, 4], 0],
		['Door', [1, 0, 4], 0],
		['WallStone', [3, 0, 4], 0],
		['WallStone', [0, 0, 1], 90],
		['WallStone', [0, 0, 3], 90],
		['WallStone', [4, 0, 1], 90],
		['WallStone', [4, 0, 3], 90],
		['CornerPostStone', [0, 0, 0], 0],
		['CornerPostStone', [4, 0, 0], 0],
		['CornerPostStone', [0, 0, 4], 0],
		['CornerPostStone', [4, 0, 4], 0],
		['RoofSlope', [1, 3, 3], 0],
		['RoofSlope', [3, 3, 3], 0],
		['RoofSlope', [1, 3, 1], 180],
		['RoofSlope', [3, 3, 1], 180],
		['WallStoneGable', [0, 3, 3], 90],
		['WallStoneGable', [0, 3, 1], -90],
		['WallStoneGable', [4, 3, 3], 90],
		['WallStoneGable', [4, 3, 1], -90]
	];
	const built = [];
	for (const [name, pos, rotY] of room) built.push({ name, pos, rotY, uuid: await place(A.page, name, pos, rotY) });
	await A.page.waitForTimeout(800);
	m = await measure(A.page, built.map((p) => p.uuid));
	let exact = 0;
	for (const p of built) {
		const exp = worldBox(p.name, p.pos, p.rotY);
		if (m[p.uuid] && near(m[p.uuid].min, exp.min) && near(m[p.uuid].max, exp.max)) exact++;
		else console.log('off-grid', p.name, JSON.stringify(m[p.uuid]), JSON.stringify(exp));
	}
	h.check(exact === built.length, `every room piece sits exactly where the kit doc says (${exact} / ${built.length})`);
	// the joints themselves: neighbouring walls share one plane
	const wallsNorth = built.filter((p) => p.name === 'WallStone' && p.pos[2] === 0).map((p) => m[p.uuid]);
	h.check(Math.abs(wallsNorth[0].max[0] - wallsNorth[1].min[0]) < 1e-4, `two walls in a row meet at x=2 with no gap (${(wallsNorth[1].min[0] - wallsNorth[0].max[0]).toExponential(1)} m)`);

	// ---------- 5. SEAMS: nothing of the magenta background shows from inside ----------
	// 26 directions (the cube's faces, edges and corners) from two eyes: the room's middle,
	// and low near a corner, where joints are seen at grazing angles
	const dirs = [];
	for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) if (dx || dy || dz) dirs.push([dx, dy, dz]);
	const eyes = [
		[2, 1.6, 2],
		[0.6, 0.5, 0.6]
	];
	const sealAll = async () => {
		const out = [];
		for (const e of eyes) out.push(...(await magenta(A.page, e, dirs.map((d) => [e[0] + d[0] * 9, e[1] + d[1] * 9, e[2] + d[2] * 9]))));
		return out;
	};
	const eye = eyes[0];
	const views = dirs.map((d) => [eye[0] + d[0] * 9, eye[1] + d[1] * 9, eye[2] + d[2] * 9]);
	const sealed = await sealAll();
	const sum = (/** @type {number[]} */ a) => a.reduce((x, y) => x + y, 0);
	console.log('magenta per view', JSON.stringify(sealed), 'leak rays', JSON.stringify(await A.page.evaluate(() => window.__leaks)));
	h.check(sum(sealed) === 0, `SEALED: no background pixel shows through any joint, ${sealed.length} views from 2 eyes (${sum(sealed)} px)`);
	// control: the metric must see a real gap — slide the north-west wall 5 cm and look again
	const nw = built.find((p) => p.name === 'WallStone' && p.pos[0] === 1 && p.pos[2] === 0);
	await moveBy(A.page, nw.uuid, -0.05, 0);
	const leaky = await magenta(A.page, eye, views);
	await moveBy(A.page, nw.uuid, 0.05, 0);
	h.check(sum(leaky) > 0, `CONTROL: a 5 cm gap is seen by the same metric (${sum(leaky)} px)`);
	const again = await sealAll();
	h.check(sum(again) === 0, `restored, the room is sealed again (${sum(again)} px)`);

	if (ROOM_ONLY) return h.finish(browser);
	// ---------- 6. REPLICATION ----------
	const all = [...placed, ...built];
	let mb = null;
	await h.eventually(
		async () => (mb = await measure(B.page, all.map((p) => p.uuid))),
		(r) => all.every((p) => r[p.uuid] && r[p.uuid].maps >= 1),
		`peer B receives all ${all.length} pieces, textured`,
		60000
	);
	const ma = await measure(A.page, all.map((p) => p.uuid));
	const same = all.filter((p) => mb?.[p.uuid] && near(mb[p.uuid].min, ma[p.uuid].min) && near(mb[p.uuid].max, ma[p.uuid].max)).length;
	h.check(same === all.length, `…at the same grid positions and rotations (${same} / ${all.length})`);
	const snappedB = mb?.[snapWall] ?? (await measure(B.page, [snapWall]))[snapWall];
	h.check(!!snappedB, 'the snapped wall replicates too');

	// ---------- 7. screenshots ----------
	await A.page.evaluate(() => window.__stores.objectActions.deselectObject());
	await flyTo(A.page, [11, 7, 12], [2, 1.8, 2]);
	await A.page.waitForTimeout(1200);
	await A.page.screenshot({ path: path.join(SHOTS, 'after-room-A.png') });
	await flyTo(A.page, [-6, 5, -9], [2, 1.8, 2]);
	await A.page.waitForTimeout(1200);
	await A.page.screenshot({ path: path.join(SHOTS, 'after-room-back-A.png') });
	await flyTo(A.page, [2, 9, 8], [2, 0, -12]);
	await A.page.waitForTimeout(1200);
	await A.page.screenshot({ path: path.join(SHOTS, 'after-catalogue-A.png') });
	await flyTo(B.page, [11, 7, 12], [2, 1.8, 2]);
	await B.page.waitForTimeout(1200);
	await B.page.screenshot({ path: path.join(SHOTS, 'after-room-B.png') });
	await h.finish(browser);
});
