// E2E: the nature-kit pack builds a 20 × 20 m forest clearing IN THE APP.
//
//   - the pack lists in the Explorer's Packs section (served as a DEFAULT pack from
//     VITE_PACKS_BASE, the same path the jsDelivr ref takes), with every item's card;
//   - one card is dragged onto the viewport with the real mouse (HTML5 drag and drop);
//   - ~50 more placements go through the Explorer's own drop handler
//     (explorerDrop.dropExplorerItem with the card's drag payload) at the projected
//     screen point of each layout spot, then get their exact spot/rotation through the
//     same replicated `move` message a drop sends (placeAt);
//   - the grid: with snapping on (1 m) a real gizmo drag lands a path tile on the 1 m grid,
//     the path tiles and the modular cliff chunks laid on the grid meet without gaps;
//   - peer B receives every object with the same geometry;
//   - frame rate with the whole clearing in view, and screenshots.
//
//   /home/deck/.local/bin/e2e-slot --exclusive -- env APP_URL=https://theprototype.app:5253/ \
//     CORE=/path/to/core-worktree OUT=/path/to/evidence node nature-kit/build/e2e-clearing.cjs
// (the dev server needs VITE_PACKS_BASE pointing at a checkout of this repo over https)
const path = require('node:path');
const fs = require('node:fs');

const CORE = process.env.CORE || '/home/deck/.code/theprototype-app/theprototype-lane-30c-nature-engine';
const OUT = process.env.OUT || path.join(__dirname, 'e2e-out');
const PACK = 'nature-kit';
const LIST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'default.json'), 'utf8'));
const h = require(path.join(CORE, 'tests/e2e/helpers.cjs'));
fs.mkdirSync(OUT, { recursive: true });

// the clearing (clearing-layout.json, shared with the cover render): [item, x, z, rotY°, scale?].
// Path tiles and cliff chunks sit on the 1 m grid (tile centres on odd metres so their
// 2 m edges fall on grid lines; cliff chunks 4 m apart, pivot at the bottom-centre-back).
const LAYOUT = JSON.parse(fs.readFileSync(path.join(__dirname, 'clearing-layout.json'), 'utf8')).layout;

const objectsA = (page) =>
	page.evaluate(() => {
		let g;
		window.__stores.objectsGroup.subscribe((x) => (g = x))();
		return g.children.length;
	});

/** everything a peer needs to agree on, per placed pack object */
const census = (page) =>
	page.evaluate(() => {
		const s = window.__stores;
		let g;
		s.objectsGroup.subscribe((x) => (g = x))();
		const rows = [];
		for (const o of g.children) {
			let tris = 0, maps = 0;
			o.traverse((m) => {
				if (!m.isMesh) return;
				tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
				for (const mat of [].concat(m.material)) if (mat?.map) maps++;
			});
			rows.push({ uuid: o.uuid, name: o.name, tris: Math.round(tris), maps, pos: o.position.toArray().map((v) => +v.toFixed(3)), rotY: +o.rotation.y.toFixed(3) });
		}
		return rows;
	});

/** world bbox of an object */
const bbox = (page, uuid) =>
	page.evaluate((u) => {
		const s = window.__stores;
		let g;
		s.objectsGroup.subscribe((x) => (g = x))();
		const o = g.getObjectByProperty('uuid', u);
		o.updateMatrixWorld(true);
		const b = new s.THREE.Box3().setFromObject(o);
		return { min: b.min.toArray(), max: b.max.toArray() };
	}, uuid);

/** set a placed object's exact transform the way a drop does (placeAt): local + `move`.
 *  `rot` goes on the wire as THREE NUMBERS. The app's own senders (placeAt, the gizmo's
 *  onchange) send `rotation.toArray()`, which is [x, y, z, 'XYZ'] — and core's wire validator
 *  (27-A, wireValidate.isQuatOrEuler) accepts 3 or 4 FINITE numbers only, so the receiving
 *  peer refuses every one of them as `invalid:move` (measured: 162 refused, run 6). That is
 *  a core bug, reported in the lane handover; this test must not depend on it. */
const moveTo = (page, uuid, pos, rotYDeg, scale = 1) =>
	page.evaluate(
		({ u, pos, r, sc }) => {
			const s = window.__stores;
			let g, peer;
			s.objectsGroup.subscribe((x) => (g = x))();
			s.peers.subscribe((x) => (peer = x))();
			const o = g.getObjectByProperty('uuid', u);
			o.position.set(pos[0], pos[1], pos[2]);
			o.rotation.set(0, (r * Math.PI) / 180, 0);
			o.scale.setScalar(sc);
			o.updateMatrixWorld(true);
			peer?.send({ type: 'move', uuid: u, pos: o.position.toArray(), rot: [o.rotation.x, o.rotation.y, o.rotation.z], scale: o.scale.toArray() });
			s.objectsGroup.update((v) => v);
		},
		{ u: uuid, pos, r: rotYDeg, sc: scale }
	);

const aim = (page, pos, target) =>
	page.evaluate(
		({ pos, target }) => {
			const s = window.__stores;
			let cam, oc;
			s.globalCamera.subscribe((c) => (cam = c))();
			s.orbitControls.subscribe((c) => (oc = c))();
			cam.position.set(...pos);
			if (oc) {
				oc.target.set(...target);
				oc.update();
			} else cam.lookAt(...target);
		},
		{ pos, target }
	);

/** the X / Z translate arrow of the gizmo on screen: [x, y, dirX, dirY]. The arrow MESH sits
 *  at the object's origin (its geometry is offset along the axis), so its world POSITION is
 *  the gizmo centre — grabbing there takes the free-move handle (measured: a "Z" drag moved
 *  the tile 2 m in Y). The world-bbox centre of the visible mesh is on the arrow itself. */
const arrowPoint = (page, axis) =>
	page.evaluate((axis) => {
		const s = window.__stores;
		let controls = null, cam = null, renderer = null;
		s.TControls.subscribe((v) => (controls = v))();
		s.globalCamera.subscribe((v) => (cam = v))();
		s.globalRenderer.subscribe((v) => (renderer = v))();
		const helper = controls?.getHelper?.() ?? controls;
		if (!helper || !cam || !controls.object) return null;
		helper.updateMatrixWorld(true);
		const shown = (n) => {
			for (let p = n; p; p = p.parent) if (!p.visible) return false;
			return true;
		};
		const r = renderer.domElement.getBoundingClientRect();
		const px = (p) => [r.left + ((p.x + 1) / 2) * r.width, r.top + ((1 - p.y) / 2) * r.height];
		const [ox, oy] = px(controls.object.getWorldPosition(new s.THREE.Vector3()).project(cam));
		let best = null;
		helper.traverse((n) => {
			if (!n.isMesh || n.name !== axis || !shown(n)) return;
			const c = new s.THREE.Box3().setFromObject(n).getCenter(new s.THREE.Vector3()).project(cam);
			const [x, y] = px(c);
			const d = Math.hypot(x - ox, y - oy);
			if (!best || d > best.d) best = { x, y, d };
		});
		return best && best.d > 8 ? [best.x, best.y, best.x - ox, best.y - oy] : null;
	}, axis);

/** rAF over 5 s: mean fps and the p95 frame time, at the page's viewport size */
const measureFps = (page) =>
	page.evaluate(
		() =>
			new Promise((resolve) => {
				const d = [];
				let last = performance.now();
				const end = last + 5000;
				const tick = (t) => {
					d.push(t - last);
					last = t;
					if (t < end) requestAnimationFrame(tick);
					else {
						const s = [...d].sort((x, y) => x - y);
						resolve({ fps: +(1000 / (d.reduce((x, y) => x + y, 0) / d.length)).toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), w: innerWidth, h: innerHeight });
					}
				};
				requestAnimationFrame(tick);
			})
	);

h.run(async () => {
	// the real GPU (ANGLE/Vulkan): the default headless launch is SwiftShader, which drew this
	// clearing at 1.1 fps and made every placement take ~14 s (measured, run 3)
	const browser = await h.launch({ args: h.GPU_ARGS });
	const A = await h.setupPage(browser, 'A');
	const B = await h.setupPage(browser, 'B');
	await h.connect(B, A);

	await A.page.evaluate(() => {
		const s = window.__stores;
		s.environment.setEnvironment('daylight');
		s.commandsHandler.sceneCommand('/create Terrain 24 24');
	});
	await A.page.waitForTimeout(800);
	const ground = (await census(A.page)).at(-1);
	// baseline: the same camera + full viewport on the bare terrain, before any pack item
	await A.page.evaluate(() => window.__stores.bottomDock.dockMinimized.set(true));
	await aim(A.page, [0, 13, 21], [0, 0.5, -1]);
	await A.page.waitForTimeout(1000);
	const baseline = await measureFps(A.page);
	await A.page.evaluate(() => window.__stores.bottomDock.dockMinimized.set(false));
	await A.page.evaluate(() => window.__stores.objectActions.selectObject(null));

	// ---------- the pack in the Explorer ----------
	await A.page.locator('#explorer-slot').click();
	await A.page.waitForTimeout(600);
	await A.page.locator('#packs-folder').dblclick();
	await A.page.waitForTimeout(600);
	const row = A.page.locator(`#explorer-list [data-pack="${PACK}"]`);
	await row.first().waitFor({ timeout: 15000 }).catch(() => {});
	h.check((await row.count()) === 1, `the ${PACK} pack lists in the Explorer's Packs section`);
	const title = await row.first().textContent();
	h.check(/Nature/.test(title ?? ''), `…under its title (${title?.trim()})`);
	await row.first().click();
	let items = [];
	for (let t = 0; t < 40 && items.length < LIST.length; t++) {
		await A.page.waitForTimeout(250);
		items = await A.page.evaluate(() => {
			let it;
			window.__stores.packs.openPackItems.subscribe((x) => (it = x))();
			return it.map((i) => ({ name: i.name, label: i.label, url: i.glbUrl }));
		});
	}
	h.check(items.length === LIST.length, `opening it shows every item (${items.length}/${LIST.length})`);
	const cards = await A.page.locator('#explorer-list .explorer-card').count();
	h.check(cards === LIST.length, `…as ${cards} cards`);
	await A.page.waitForTimeout(2500); // thumbnails
	await A.page.screenshot({ path: path.join(OUT, 'explorer-pack.png') });
	const byName = Object.fromEntries(items.map((i) => [i.name, i]));
	const payload = (name) => ({ id: null, kind: 'object', name: byName[name].name, prefabId: null, url: byName[name].url });

	// overview camera the drop points are projected with
	await aim(A.page, [0, 30, 26], [0, 0, 0]);
	await A.page.waitForTimeout(300);

	/** wait until peer B has the object. A `move` that reaches B BEFORE the object's own
	 *  sync (the textured GLB is exported + sent asynchronously) is dropped there, so B
	 *  keeps the drop position (run 3: 8 of 54 objects) — a user never moves that fast, the
	 *  test must not either. */
	const onB = async (uuid, label) => {
		for (let t = 0; t < 120; t++) {
			if ((await census(B.page)).some((r) => r.uuid === uuid && r.tris > 0)) return true;
			await A.page.waitForTimeout(250);
		}
		console.log(`${label}: not on B after 30 s`);
		return false;
	};

	/** wait for the scene to grow by one; returns the new object's uuid */
	const nextObject = async (before, label) => {
		for (let t = 0; t < 60; t++) {
			const n = await objectsA(A.page);
			if (n > before) return (await census(A.page)).at(-1);
			await A.page.waitForTimeout(250);
		}
		throw new Error(`${label}: no object appeared`);
	};

	// ---------- one card with the REAL mouse: drag it out of the grid onto the viewport ----------
	// the viewport is the RENDERER's canvas (other canvases exist: thumbnails, minimaps)
	await A.page.evaluate(() => {
		let r;
		window.__stores.globalRenderer.subscribe((x) => (r = x))();
		r.domElement.setAttribute('data-e2e-viewport', '1');
	});
	const canvas = A.page.locator('canvas[data-e2e-viewport]');
	const card = A.page.locator('#explorer-list .explorer-card').filter({ hasText: /^\s*PathTile\s*$/ }).first();
	h.check((await card.count()) === 1, 'the PathTile card is in the grid');
	const dropAt = await h.projectPoint(A.page, [-1.4, 0, 1.3]); // deliberately OFF the grid
	let before = await objectsA(A.page);
	const cbox = await canvas.boundingBox();
	await card.dragTo(canvas, { targetPosition: { x: dropAt.x - cbox.x, y: dropAt.y - cbox.y } }).catch((e) => console.log('dragTo', e.message));
	let dragged = null;
	try {
		dragged = await nextObject(before, 'real drag');
	} catch {}
	h.check(!!dragged && dragged.tris > 100 && dragged.maps >= 1, `a card dragged onto the viewport places a textured model (${dragged?.name}, ${dragged?.tris} tris)`);
	if (dragged) h.check(Math.hypot(dragged.pos[0] + 1.4, dragged.pos[2] - 1.3) < 0.3, `…where it was dropped (${dragged.pos})`);

	// ---------- the grid: snapping on, a real gizmo drag lands the tile on the 1 m grid ----------
	if (dragged) {
		await onB(dragged.uuid, 'dragged tile');
		await A.page.evaluate(() => {
			window.__stores.snapping.snapEnabled.set(true);
			window.__stores.snapping.snapSettings.set({ translate: 1, rotateDeg: 15, scale: 0.1 });
		});
		await A.page.evaluate((u) => window.__stores.objectActions.selectObject(u), dragged.uuid);
		await A.page.waitForTimeout(600);
		for (const axis of ['X', 'Z']) {
			const p = await arrowPoint(A.page, axis);
			h.check(!!p, `the gizmo's ${axis} arrow is on screen (${p?.map((v) => v.toFixed(0))})`);
			if (!p) continue;
			// drag ALONG the arrow's projected direction (a straight-down drag grabbed Y once)
			const len = Math.hypot(p[2], p[3]) || 1;
			await A.page.mouse.move(p[0], p[1]);
			await A.page.mouse.down();
			await A.page.mouse.move(p[0] + (p[2] / len) * 200, p[1] + (p[3] / len) * 200, { steps: 20 });
			await A.page.mouse.up();
			await A.page.waitForTimeout(400);
		}
		const snapped = (await census(A.page)).find((r) => r.uuid === dragged.uuid);
		const onGrid = (v) => Math.abs(v - Math.round(v)) < 1e-6;
		h.check(onGrid(snapped.pos[0]) && onGrid(snapped.pos[2]), `a gizmo drag with 1 m snapping lands the tile on the grid (${dragged.pos} → ${snapped.pos})`);
		h.check(Math.hypot(snapped.pos[0] - dragged.pos[0], snapped.pos[2] - dragged.pos[2]) > 0.5, '…and it really moved');
		h.check(Math.abs(snapped.pos[1]) < 1e-6, `…staying on the ground (y ${snapped.pos[1]})`);
		// KNOWN CORE BUG (not this pack): the gizmo's own `move` stream carries
		// rotation.toArray() and peer B refuses it (see moveTo). Recorded, not asserted green:
		await A.page.waitForTimeout(1500);
		const bSnap = (await census(B.page)).find((r) => r.uuid === dragged.uuid);
		const refused = await B.page.evaluate(() => window.__stores.wireErrors.wireErrors().filter((e) => e.type === 'invalid:move').reduce((n, e) => n + e.count, 0));
		console.log(`KNOWN core bug: peer B has the gizmo-dragged tile at ${JSON.stringify(bSnap?.pos)} (A: ${JSON.stringify(snapped.pos)}); B refused ${refused} gizmo 'move' messages as invalid:move`);
		await A.page.evaluate(() => window.__stores.snapping.snapEnabled.set(false));
		// it becomes the 5th tile of the path (the path runs z = 9 … 1 at x = 1) — with a
		// well-formed move, which peer B DOES apply
		await moveTo(A.page, dragged.uuid, [1, 0, 1], 0);
		await h.eventually(
			async () => (await census(B.page)).find((r) => r.uuid === dragged.uuid),
			(r) => !!r && r.pos[0] === 1 && r.pos[2] === 1,
			'peer B follows the tile to its grid point (a well-formed move)',
			15000
		);
		await A.page.evaluate(() => window.__stores.objectActions.selectObject(null));
	}

	// ---------- the clearing: every other placement through the Explorer's drop handler ----------
	const placed = [];
	const t0 = Date.now();
	for (const [name, x, z, rotY, scale] of LAYOUT) {
		if (!byName[name]) {
			h.check(false, `layout item ${name} is in the pack`);
			continue;
		}
		const pt = await h.projectPoint(A.page, [x, 0, z]);
		before = await objectsA(A.page);
		await A.page.evaluate(({ p, sx, sy }) => window.__stores.explorerDrop.dropExplorerItem(p, sx, sy), { p: payload(name), sx: pt.x, sy: pt.y });
		const o = await nextObject(before, name);
		await onB(o.uuid, name);
		await moveTo(A.page, o.uuid, [x, 0, z], rotY, scale ?? 1);
		placed.push({ ...o, item: name });
	}
	await A.page.evaluate(() => window.__stores.objectActions.selectObject(null));
	const secs = ((Date.now() - t0) / 1000).toFixed(1);
	h.check(placed.length === LAYOUT.length, `the clearing is built from the pack: ${placed.length} placements in ${secs} s`);
	const untextured = placed.filter((p) => p.maps < 1).map((p) => p.item);
	h.check(untextured.length === 0, `every placed item is textured (${untextured.join(',') || 'all'})`);

	// ---------- no gaps: the path tiles and the cliff chunks meet exactly ----------
	const tiles = placed.filter((p) => p.item === 'PathTile');
	if (dragged) tiles.push({ uuid: dragged.uuid });
	const tb = [];
	for (const t of tiles) tb.push(await bbox(A.page, t.uuid));
	tb.sort((a, b) => a.min[2] - b.min[2]);
	const tileGaps = tb.slice(1).map((b, i) => +(b.min[2] - tb[i].max[2]).toFixed(4));
	h.check(tileGaps.length >= 4 && tileGaps.every((g) => Math.abs(g) < 0.01), `the 2 × 2 m path tiles laid on the grid meet without gaps (${tileGaps.join(', ')} m)`);
	h.check(tb.every((b) => Math.abs(b.max[0] - b.min[0] - 2) < 0.01 && Math.abs(b.max[2] - b.min[2] - 2) < 0.01), '…each exactly 2 × 2 m');
	const cb = [];
	for (const c of placed.filter((p) => p.item === 'Cliff')) cb.push(await bbox(A.page, c.uuid));
	cb.sort((a, b) => a.min[0] - b.min[0]);
	const cliffGaps = cb.slice(1).map((b, i) => +(b.min[0] - cb[i].max[0]).toFixed(4));
	h.check(cliffGaps.length === 2 && cliffGaps.every((g) => Math.abs(g) < 0.01), `the modular cliff chunks tile horizontally without gaps (${cliffGaps.join(', ')} m)`);
	h.check(cb.every((b) => Math.abs(b.min[2] + 10) < 0.01), '…their backs flush on one line (pivot bottom-centre-back)');

	// ---------- peer B has the same clearing ----------
	const a = await census(A.page);
	let b = [];
	await h.eventually(
		async () => (b = await census(B.page)),
		(rows) => rows.length === a.length && rows.every((r) => r.tris > 0),
		`peer B receives the whole clearing (${a.length} objects)`,
		60000
	);
	const byUuid = Object.fromEntries(b.map((r) => [r.uuid, r]));
	const mism = a.filter((r) => !byUuid[r.uuid] || byUuid[r.uuid].tris !== r.tris || byUuid[r.uuid].pos.some((v, i) => Math.abs(v - r.pos[i]) > 0.01) || Math.abs(byUuid[r.uuid].rotY - r.rotY) > 0.01);
	for (const m of mism) console.log('mismatch A', JSON.stringify(m), 'B', JSON.stringify(byUuid[m.uuid] ?? null));
	if (mism.length) console.log('B wire errors', JSON.stringify(await B.page.evaluate(() => window.__stores.wireErrors.wireErrors())).slice(0, 3000));
	h.check(mism.length === 0, `…every object with the same triangles, position and rotation (${mism.map((m) => m.name).join(',') || 'all match'})`);
	const trisA = a.reduce((s, r) => s + r.tris, 0);
	h.check(a.filter((r) => r.uuid !== ground?.uuid).every((r) => (byUuid[r.uuid]?.maps ?? 0) >= 1), '…textured on B too');

	// ---------- frame rate with the whole clearing in view (dock minimized: the full viewport) ----------
	await A.page.evaluate(() => {
		window.__stores.bottomDock.dockMinimized.set(true);
		window.__stores.sceneBudget.statsOpen.set(true);
	});
	await aim(A.page, [0, 13, 21], [0, 0.5, -1]);
	await A.page.waitForTimeout(1500);
	const perf = await measureFps(A.page);
	const metrics = await A.page.evaluate(() => {
		let m;
		window.__stores.sceneBudget.sceneMetrics.subscribe((x) => (m = x))();
		return m;
	});
	console.log('perf', JSON.stringify(perf), 'baseline', JSON.stringify(baseline), 'scene tris', trisA, 'metrics', JSON.stringify(metrics));
	h.check(perf.fps >= 30, `frame rate is sane with the whole clearing in view: ${perf.fps} fps, p95 ${perf.p95} ms (empty terrain: ${baseline.fps} fps) — ${metrics?.calls ?? '?'} draw calls, ${metrics?.triangles ?? '?'} triangles/frame (${perf.w}×${perf.h})`);

	// clean frames: no stats panel, no gizmo/selection outline
	for (const P of [A.page, B.page])
		await P.evaluate(() => {
			const s = window.__stores;
			s.sceneBudget.statsOpen.set(false);
			s.objectActions.selectObject(null);
			s.selectedObjects.set([]);
			let c;
			s.TControls.subscribe((x) => (c = x))();
			c?.detach?.();
		});
	await A.page.waitForTimeout(300);
	await A.page.screenshot({ path: path.join(OUT, 'clearing-A.png') });
	await aim(A.page, [-4, 3.2, 9.5], [2, 1.4, -3]);
	await A.page.waitForTimeout(800);
	await A.page.screenshot({ path: path.join(OUT, 'clearing-A-eye.png') });
	await aim(A.page, [0, 34, 0.01], [0, 0, 0]);
	await A.page.waitForTimeout(800);
	await A.page.screenshot({ path: path.join(OUT, 'clearing-A-top.png') });
	await aim(B.page, [10, 9, 16], [0, 0.5, -2]);
	await B.page.waitForTimeout(1200);
	await B.page.screenshot({ path: path.join(OUT, 'clearing-B.png') });
	fs.writeFileSync(path.join(OUT, 'clearing-census.json'), JSON.stringify({ perf, trisA, placed: placed.length, objects: a.length, a }, null, 1));
	await h.finish(browser);
});
