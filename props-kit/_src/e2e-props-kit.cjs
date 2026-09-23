// E2E: the props-kit pack in the REAL app, served as a default pack.
//
//   the pack lists in the Explorer's Packs section (from PACKS_BASE/index.json), opens
//   to all its items with their screenshots · an item places from the UI (double-click)
//   · a furnished room is laid out from pack items (on the arch kit's walls when
//   ARCH_ROOM is given, else on a floor pad) · every placed item is textured, at its
//   real-world size and on its pivot · the room replicates to peer B · the hinged
//   pieces swing about their hinge (trapdoor, lever handle) · a real gizmo drag with
//   a 1 m translate snap lands a piece on the grid, and B sees it there · screenshots.
//
// Needs a core dev server whose VITE_PACKS_BASE serves this checkout (see kit.md):
//
//   e2e-slot -- env APP_URL=https://theprototype.app:5254/ CORE=<core worktree> \
//     SHOTS=<dir> node props-kit/_src/e2e-props-kit.cjs > out.log 2>&1
//
// BEFORE=1 serves origin/main's index.json instead (no props-kit) for the "before" shots.
// Counterfactuals (each must turn its guard red): CF=snap leaves grid snap OFF for the
// drag; CF=pivot shifts the placed Hatch's mesh 0.3 m off its origin on A (a mis-pivoted
// GLB) — the pivot, hinge and replication-offset checks go red.
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');

const CORE = process.env.CORE || '/home/deck/.code/theprototype-app/theprototype-lane-30c-props-engine';
const SHOTS = process.env.SHOTS || '';
const BEFORE = process.env.BEFORE === '1';
const FLOOR_GLB = process.env.FLOOR_GLB || '';
const CF = process.env.CF || '';
const h = require(path.join(CORE, 'tests/e2e/helpers.cjs'));
const PACK_DIR = path.resolve(__dirname, '..');
const LIST = JSON.parse(fs.readFileSync(path.join(PACK_DIR, 'default.json'), 'utf8'));
const REPORT = JSON.parse(fs.readFileSync(path.join(__dirname, 'build-report.json'), 'utf8'));
const shot = (name) => (SHOTS ? path.join(SHOTS, name) : null);

/** [item, x, z, yawDeg, y] — a 6 × 5 m room, back wall z = -2.5, left wall x = -3 */
const ROOM = [
	['Rug', -0.4, 0.3, 0],
	['Bench', -0.4, -0.5, 0],
	['Chair', -0.9, 0.95, 180],
	['Chair', 0.1, 0.95, 180],
	['Lantern', -0.1, 0.25, 20, 0.78],
	['Candles', -0.8, 0.35, 0, 0.78],
	['Bookcase', -1.6, -2.22, 0],
	['PottedPlant', -2.55, -2.1, 0],
	['Chest', 0.35, -2.05, 0],
	['Barrel', 1.3, -2.05, 0],
	['BarrelSmall', 2.05, -2.1, 0],
	['CrateStack', 2.2, -0.6, -90],
	['Sacks', 2.2, 0.9, -30],
	['Bed', -2.35, 0.6, 0],
	['WallTorch', -0.4, -2.5, 0, 1.55],
	['Tapestry', 1.6, -2.5, 0, 0.9],
	['Workbench', 1.9, 2.0, 180],
	['Hatch', 0.5, 1.2, 0],
	['LeverBase', 1.2, 0.2, 0],
	['LeverHandle', 1.2, 0.2, 0, 0.16],
	['Ladder', -2.85, -1.1, 90],
	['DoorKey', 0.2, 0.1, 30, 0.7915]
];

const ITEM_BY = Object.fromEntries(LIST.map((i) => [i.name, i]));

/** everything measurable about one placed object, found by uuid */
const measure = (page, uuid) =>
	page.evaluate((id) => {
		const s = window.__stores;
		let g;
		s.objectsGroup.subscribe((x) => (g = x))();
		const obj = g.getObjectByProperty('uuid', id);
		if (!obj) return null;
		obj.updateMatrixWorld(true);
		const box = new s.THREE.Box3().setFromObject(obj);
		let tris = 0;
		let maps = 0;
		let mapW = 0;
		let emissive = 0;
		obj.traverse((o) => {
			if (!o.isMesh) return;
			tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
			for (const m of [].concat(o.material)) {
				if (m?.map?.image) {
					maps++;
					mapW = Math.max(mapW, m.map.image.width ?? 0);
				}
				if (m?.emissive && m.emissive.r > 0.5 && ((m.emissiveIntensity ?? 1) > 1 || m.emissiveMap)) emissive++;
			}
		});
		const r = (v) => +v.toFixed(4);
		return {
			name: obj.name,
			pos: obj.position.toArray().map(r),
			rot: obj.rotation.toArray().slice(0, 3).map(r),
			min: box.min.toArray().map(r),
			max: box.max.toArray().map(r),
			size: box.getSize(new s.THREE.Vector3()).toArray().map(r),
			tris: Math.round(tris),
			maps,
			mapW,
			emissive
		};
	}, uuid);

/** the uuid of the newest top-level object called `name` that is not in `taken` */
const findNew = (page, name, taken) =>
	page.evaluate(
		([n, t]) => {
			let g;
			window.__stores.objectsGroup.subscribe((x) => (g = x))();
			const hit = [...g.children].reverse().find((o) => o.name === n && !t.includes(o.uuid));
			return hit?.uuid ?? null;
		},
		[name, taken]
	);

/** a REPLICATED pose change: the gizmo's `move` message. `rot` goes as an Euler TRIPLE:
 * three's Euler.toArray() appends the order string ('XYZ'), and the receiver's
 * wireValidate (isQuatOrEuler: 3 or 4 FINITE numbers) refuses that shape outright. */
const pose = (page, uuid, pos, rot) =>
	page.evaluate(
		([id, p, r]) => {
			const s = window.__stores;
			let g, peers;
			s.objectsGroup.subscribe((v) => (g = v))();
			s.peers.subscribe((v) => (peers = v))();
			const o = g.getObjectByProperty('uuid', id);
			if (!o) return false;
			o.position.set(p[0], p[1], p[2]);
			if (r) o.rotation.set(r[0], r[1], r[2]);
			o.updateMatrixWorld(true);
			s.objectsGroup.update((v) => v);
			peers?.send({ type: 'move', uuid: id, pos: o.position.toArray(), rot: [o.rotation.x, o.rotation.y, o.rotation.z], scale: o.scale.toArray() });
			return true;
		},
		[uuid, pos, rot ?? null]
	);

/** snap-advanced's recipe: a screen point the gizmo itself confirms is the +X arrow */
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

const near = (a, b, tol) => Math.abs(a - b) <= tol;

h.run(async () => {
	const browser = await h.launch();
	const A = await h.setupPage(browser, 'A', { context: { viewport: { width: 1540, height: 774 } } });
	const B = await h.setupPage(browser, 'B');
	if (BEFORE) {
		const mainIndex = execSync('git show origin/main:index.json', { cwd: PACK_DIR }).toString();
		for (const p of [A, B]) await p.page.route('**/packs-local/index.json', (route) => route.fulfill({ body: mainIndex, contentType: 'application/json' }));
		for (const p of [A, B]) await h.freshReload(p);
	}
	await h.connect(B, A);

	// ---------------------------------------------------------------- 1. the pack lists
	await A.page.locator('#explorer-slot').click();
	await A.page.waitForTimeout(600);
	await A.page.locator('#packs-folder').click(); // single click → the pack cards grid
	await A.page.waitForTimeout(1200);
	if (shot('packs-grid.png')) await A.page.screenshot({ path: shot(BEFORE ? 'before-packs-grid.png' : 'after-packs-grid.png') });
	const listed = await A.page.evaluate(() => {
		let list;
		window.__stores.packs.packs.subscribe((x) => (list = x))();
		const p = list.find((x) => x.name === 'props-kit');
		return p ? { title: p.title, license: p.license, listUrl: p.listUrl } : null;
	});
	if (BEFORE) {
		h.check(!listed, 'BEFORE: origin/main has no props-kit pack');
	} else {
		h.check(!!listed && listed.title === 'Props & Interiors', `props-kit lists as "Props & Interiors" (${listed?.title})`);
		h.check(listed?.license === 'CC0-1.0', `…licensed CC0-1.0 (${listed?.license})`);
	}

	// ---------------------------------------------------------------- floor (+ walls)
	const floorBytes = FLOOR_GLB && fs.existsSync(FLOOR_GLB) ? Array.from(fs.readFileSync(FLOOR_GLB)) : null;
	h.check(!!floorBytes, `the floor pad GLB is given (${FLOOR_GLB})`);
	await A.page.evaluate(async (arr) => {
		await window.__stores.fileHandler.importFile(new File([new Uint8Array(arr)], 'FloorPad.glb'), 'FloorPad', 'glb', [0, 0, 0]);
	}, floorBytes);
	await A.page.waitForTimeout(1500);

	if (BEFORE) {
		await A.page.evaluate(() => window.__stores.objectActions.flyTo([4.2, 4.3, 5.6], [-0.2, 0.4, -0.6], 0));
		await A.page.waitForTimeout(1200);
		if (SHOTS) await A.page.screenshot({ path: shot('before-room.png') });
		await h.finish(browser);
		return;
	}

	// ---------------------------------------------------------------- 2. open it
	await A.page.locator('#packs-folder').dblclick();
	await A.page.waitForTimeout(400);
	await A.page.locator('#explorer-list [data-pack="props-kit"]').click();
	let items = [];
	for (let t = 0; t < 30 && items.length < LIST.length; t++) {
		await A.page.waitForTimeout(300);
		items = await A.page.evaluate(() => {
			let it;
			window.__stores.packs.openPackItems.subscribe((x) => (it = x))();
			return it.map((i) => ({ name: i.name, label: i.label, glbUrl: i.glbUrl, thumbs: i.thumbs }));
		});
	}
	h.check(items.length === LIST.length, `opening props-kit shows all ${LIST.length} items (${items.length})`);
	// every screenshot the list names is really served (the grid's first thumb candidate)
	const thumbs = await A.page.evaluate(async (list) => {
		const ok = await Promise.all(list.map((i) => fetch(i.thumbs[0]).then((r) => r.ok && r.headers.get('content-type')?.includes('image')).catch(() => false)));
		return ok.filter(Boolean).length;
	}, items);
	h.check(thumbs === LIST.length, `every item's screenshot is served (${thumbs}/${LIST.length})`);
	await A.page.waitForTimeout(1500);
	const imgs = await A.page.evaluate(() => [...document.querySelectorAll('#explorer-list .explorer-card img')].filter((i) => i.complete && i.naturalWidth > 0).length);
	h.check(imgs >= Math.min(12, LIST.length), `the item grid renders the screenshots (${imgs} loaded)`);
	if (SHOTS) await A.page.screenshot({ path: shot('after-pack-items.png') });

	// ---------------------------------------------------------------- 3. place from the UI
	const taken = [];
	const card = A.page.locator('#explorer-list .explorer-card').filter({ hasText: ITEM_BY.Table.label }).first();
	await card.dblclick();
	let tableId = null;
	await h.eventually(async () => (tableId = await findNew(A.page, 'Table', taken)), (v) => !!v, 'double-clicking the Table card places it', 20000);
	taken.push(tableId);

	// ---------------------------------------------------------------- 4. lay out the room
	const placed = { Table: [tableId] };
	for (const [name] of ROOM) {
		const it = items.find((i) => i.name === name);
		await A.page.evaluate(async (p) => {
			await window.__stores.explorerDrop.dropExplorerItem({ kind: 'object', name: p.name, url: p.glbUrl }, 770, 420);
		}, it);
		let id = null;
		await h.eventually(async () => (id = await findNew(A.page, name, taken)), (v) => !!v, `…${name} places from the pack`, 20000);
		taken.push(id);
		(placed[name] ??= []).push(id);
	}
	// B must hold every object's REAL geometry before it is posed. While an import's bytes
	// are in flight B shows a loading placeholder under the SAME uuid; a `move` lands on the
	// placeholder, and the real object, arriving with the pose it was SENT with, resets it
	// (measured: the Table posed right after its drop stayed at the drop point on B).
	const trisA = {};
	for (const id of taken) trisA[id] = (await measure(A.page, id)).tris;
	await h.eventually(
		async () => {
			let n = 0;
			for (const id of taken) if ((await measure(B.page, id))?.tris === trisA[id]) n++;
			return n;
		},
		(n) => n === taken.length,
		`peer B receives the real geometry of all ${taken.length} placed pieces`,
		90000
	);
	const at = {};
	const uses = {};
	await pose(A.page, tableId, [-0.4, 0, 0.3], [0, 0, 0]);
	for (const [name, x, z, yaw, y = 0] of ROOM) {
		const i = (uses[name] = (uses[name] ?? -1) + 1);
		const id = placed[name][i];
		await pose(A.page, id, [x, y, z], [0, (yaw * Math.PI) / 180, 0]);
		at[id] = { name, pos: [x, y, z], yaw };
	}
	at[tableId] = { name: 'Table', pos: [-0.4, 0, 0.3], yaw: 0 };
	await A.page.waitForTimeout(800);

	if (CF === 'pivot')
		await A.page.evaluate((id) => {
			let g;
			window.__stores.objectsGroup.subscribe((x) => (g = x))();
			g.getObjectByProperty('uuid', id).traverse((o) => o.isMesh && o.position.add({ x: 0, y: 0.3, z: 0.3 }));
		}, placed.Hatch[0]);

	// ---------------------------------------------------------------- 5. every piece is right
	const bad = [];
	const measured = {};
	for (const id of taken) {
		const m = await measure(A.page, id);
		measured[id] = m;
		const r = REPORT[m.name];
		const y0 = at[id].pos[1];
		const exp = r.size;
		// a 0/180° yaw keeps x/z, a 90° yaw swaps them
		const swap = Math.abs(Math.sin((at[id].yaw * Math.PI) / 180)) > 0.7;
		const ex = swap ? exp[2] : exp[0];
		const ez = swap ? exp[0] : exp[2];
		const skew = Math.abs(Math.sin((at[id].yaw * Math.PI) / 90)) > 0.1; // not axis-aligned: skip x/z
		const why = [];
		if (!(m.maps >= 1 && m.mapW > 0 && m.mapW <= 1024)) why.push(`maps ${m.maps} @${m.mapW}`);
		if (!near(m.size[1], exp[1], 0.02 + exp[1] * 0.01)) why.push(`h ${m.size[1]} vs ${exp[1]}`);
		if (!skew && (!near(m.size[0], ex, 0.02 + ex * 0.01) || !near(m.size[2], ez, 0.02 + ez * 0.01))) why.push(`xz ${m.size[0]},${m.size[2]} vs ${ex},${ez}`);
		if (!near(m.min[1] - y0, r.min[1], 0.01)) why.push(`pivot y ${(m.min[1] - y0).toFixed(3)} vs ${r.min[1]}`);
		if (m.tris !== r.tris) why.push(`tris ${m.tris} vs ${r.tris}`);
		if (why.length) bad.push(`${m.name}: ${why.join(', ')}`);
	}
	h.check(bad.length === 0, `all ${taken.length} placed pieces are textured (≤1024²), at real size and on their pivot${bad.length ? ' — ' + bad.join(' | ') : ''}`);
	const torch = measured[placed.WallTorch[0]];
	h.check(torch.emissive >= 1, `the wall torch carries an emissive Flame (${torch.emissive})`);
	h.check(near(torch.min[2], -2.5, 0.01), `the wall torch's back face sits ON the wall plane z = -2.5 (${torch.min[2]})`);
	const lantern = measured[placed.Lantern[0]];
	h.check(lantern.emissive >= 1 && near(lantern.min[1], 0.78, 0.01), `the lantern stands on the table top (y ${lantern.min[1]}) that glows (${lantern.emissive} emissive)`);

	// ---------------------------------------------------------------- 6. replication
	for (const id of taken) {
		const a = measured[id];
		await h.eventually(
			() => measure(B.page, id),
			(b) =>
				!!b &&
				b.tris === a.tris &&
				b.maps >= 1 &&
				b.pos.every((v, k) => near(v, a.pos[k], 1e-3)) &&
				b.rot.every((v, k) => near(v, a.rot[k], 1e-3)) &&
				b.min.every((v, k) => near(v, a.min[k], 2e-3)),
			`peer B has ${a.name} with the same geometry, texture and pose`,
			25000
		);
	}

	// ---------------------------------------------------------------- 7. hinges
	const hatchId = placed.Hatch[0];
	const closed = measured[hatchId];
	await pose(A.page, hatchId, [0.5, 0, 1.2], [-Math.PI / 2, 0, 0]);
	const open = await measure(A.page, hatchId);
	h.check(
		near(open.min[2], 1.2 - 0.087, 0.01) && near(open.max[2], 1.2, 0.01) && near(open.max[1], 1.0, 0.01) && near(open.min[1], 0, 0.01),
		`the trapdoor opens about its hinge line: stands 1 m up at z ${open.min[2]}…${open.max[2]} (closed z ${closed.min[2]}…${closed.max[2]})`
	);
	const leverId = placed.LeverHandle[0];
	const up = measured[leverId];
	await pose(A.page, leverId, [1.2, 0.16, 0.2], [Math.PI / 5, 0, 0]);
	const thrown = await measure(A.page, leverId);
	h.check(
		near(thrown.pos[1], 0.16, 1e-4) && thrown.max[2] - up.max[2] > 0.2 && thrown.max[1] < up.max[1] - 0.05 && thrown.min[1] > 0.1,
		`the lever handle swings about its axle on the base (knob z +${(thrown.max[2] - up.max[2]).toFixed(3)} m, top ${up.max[1]} → ${thrown.max[1]})`
	);
	await h.eventually(() => measure(B.page, hatchId), (b) => !!b && near(b.max[1], 1.0, 0.01), 'peer B sees the trapdoor open', 15000);

	// ---------------------------------------------------------------- 8. a real gizmo drag snaps to the 1 m grid
	// the Explorer docks over the viewport: close it so the gizmo arrow is hoverable
	await A.page.locator('#explorer-slot').click();
	await A.page.waitForTimeout(400);
	await A.page.evaluate((on) => {
		window.__stores.snapping.snapEnabled.set(on);
		window.__stores.snapping.snapSettings.set({ translate: 1, rotateDeg: 15, scale: 0.1 });
	}, CF !== 'snap');
	const plate = await A.page.evaluate(async (p) => {
		await window.__stores.explorerDrop.dropExplorerItem({ kind: 'object', name: p.name, url: p.glbUrl }, 770, 420);
	}, items.find((i) => i.name === 'PressurePlate'));
	void plate;
	let plateId = null;
	await h.eventually(async () => (plateId = await findNew(A.page, 'PressurePlate', taken)), (v) => !!v, 'the pressure plate places', 20000);
	const plateTris = (await measure(A.page, plateId)).tris;
	await h.eventually(() => measure(B.page, plateId), (b) => b?.tris === plateTris, 'peer B receives the pressure plate', 30000);
	await pose(A.page, plateId, [1.37, 0, 3], [0, 0, 0]);
	await A.page.evaluate(() => window.__stores.objectActions.flyTo([1.4, 5.5, 7.5], [1.4, 0, 3], 0));
	await A.page.waitForTimeout(700);
	await A.page.evaluate((u) => {
		window.__stores.objectActions.selectObject(u);
		window.__stores.objectActions.setTransformMode('translate');
	}, plateId);
	await A.page.waitForTimeout(700);
	const grip = await findXArrowGrip(A.page);
	let how = 'mouse';
	if (grip) {
		await A.page.mouse.down();
		for (let k = 1; k <= 8; k++) {
			await A.page.mouse.move(grip[0] + k * 18, grip[1]);
			await A.page.waitForTimeout(40);
		}
		await A.page.mouse.up();
	} else {
		// the arrow could not be hovered headless (the docked panels / camera framing):
		// drive the SAME TransformControls through its pointer API on the X axis — its
		// translationSnap rounding and the Scene's change → `move` path are the real ones
		how = await A.page.evaluate((id) => {
			const s = window.__stores;
			let c, cam, g;
			s.TControls.subscribe((v) => (c = v))();
			s.globalCamera.subscribe((v) => (cam = v))();
			s.objectsGroup.subscribe((v) => (g = v))();
			const o = g.getObjectByProperty('uuid', id);
			if (!c || c.object !== o) return `not attached (${c?.object?.name ?? 'nothing'})`;
			const ndc = (v) => {
				const p = v.clone().project(cam);
				return { x: p.x, y: p.y, button: 0 };
			};
			const start = o.position.clone();
			c.axis = 'X';
			c.pointerDown(ndc(start));
			for (let k = 1; k <= 8; k++) c.pointerMove(ndc(start.clone().add(new s.THREE.Vector3(k * 0.17, 0, 0))));
			c.pointerUp(ndc(start.clone().add(new s.THREE.Vector3(1.36, 0, 0))));
			return 'pointer-api';
		}, plateId);
	}
	await A.page.waitForTimeout(500);
	h.check(how === 'mouse' || how === 'pointer-api', `the gizmo drags the plate (${how})`);
	const dragged = await measure(A.page, plateId);
	h.check(
		dragged.pos[0] > 1.5 && near(dragged.pos[0], Math.round(dragged.pos[0]), 1e-6) && near(dragged.min[0], dragged.pos[0] - 0.5, 1e-3),
		`the drag with a 1 m snap lands the 1 × 1 plate ON the grid: x ${1.37} → ${dragged.pos[0]}, edges ${dragged.min[0]}…${dragged.max[0]}`
	);
	await h.eventually(() => measure(B.page, plateId), (b) => !!b && near(b.pos[0], dragged.pos[0], 1e-4), `peer B sees the snapped plate at x ${dragged.pos[0]}`, 15000);
	await A.page.evaluate(() => {
		window.__stores.objectActions.deselectObject();
		window.__stores.snapping.snapEnabled.set(false);
	});

	// ---------------------------------------------------------------- 9. the room, looked at
	await pose(A.page, hatchId, [0.5, 0, 1.2], [-Math.PI / 3, 0, 0]);
	await A.page.waitForTimeout(6000); // let the placement toasts time out before the shots
	await A.page.evaluate(() => window.__stores.objectActions.flyTo([4.2, 4.3, 5.6], [-0.2, 0.4, -0.6], 0));
	await A.page.waitForTimeout(1500);
	if (SHOTS) {
		await A.page.screenshot({ path: shot('after-room.png') });
		await A.page.evaluate(() => window.__stores.objectActions.flyTo([-0.2, 2.2, 3.4], [-0.5, 0.6, -1.2], 0));
		await A.page.waitForTimeout(1200);
		await A.page.screenshot({ path: shot('after-room-close.png') });
		await B.page.evaluate(() => window.__stores.objectActions.flyTo([4.2, 4.3, 5.6], [-0.2, 0.4, -0.6], 0));
		await B.page.waitForTimeout(1500);
		await B.page.screenshot({ path: shot('after-room-peerB.png') });
	}
	await h.finish(browser);
});
