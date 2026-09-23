// E2E: the Sci-fi & Modern Kit in the real app, read the way production reads it
// (PACKS_BASE → index.json → scifi-kit/default.json → <Item>/glTF-Binary/<file>).
//
//   0. BEFORE: origin/main's index.json has no sci-fi kit in the Packs list
//   1. the pack lists in the Explorer's Packs section and opens with every item + thumbnail
//   2. CATALOGUE: every item places, is textured, within its tris budget, at its kit dims;
//      the light pieces really emit (an emissive map or colour on the placed object)
//   3. GRID SNAP: a real gizmo drag with 1 m snapping lands a wall on the grid
//   4. STATION: two 4 × 4 m rooms side by side, an open doorway between them, floors
//      (plate / grating), walls, corner posts, a lit ceiling — every piece's world bbox is
//      exactly where kit.md says
//   5. SEAMS: from inside, against a MAGENTA background, not one background pixel shows
//      through any joint (4 eyes × 26 views); the control slides one wall 5 cm and the gap
//      shows. Then the sliding door closes the doorway, and the door still seals.
//   6. FURNISH: console, desk + chair, racks, crates, pipes, vent, screen, lamps, plant,
//      teleport pad, drone, a window
//   7. REPLICATION: peer B receives every piece with the same bbox
//   8. screenshots → $SHOTS (default ~/.code/lanes-30/after-30c/30c-pack-scifi/)
//
// Run against a core dev server built with VITE_PACKS_BASE pointing at a snapshot of this
// checkout (see tools/scifi-kit/README in kit.md "How the pieces were made"):
//   e2e-slot -- env APP_URL=https://theprototype.app:5257/ CORE=<core worktree> node tests/scifi-kit.e2e.cjs
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const CORE = process.env.CORE || '/home/deck/.code/theprototype-app/theprototype-lane-30c-scifi-engine';
const h = require(path.join(CORE, 'tests/e2e/helpers.cjs'));
const REPO = path.resolve(__dirname, '..');
const PACK = 'scifi-kit';
const TITLE = /Sci-fi & Modern Kit/;
const SHOTS = process.env.SHOTS || path.join(os.homedir(), '.code/lanes-30/after-30c/30c-pack-scifi');
const list = JSON.parse(fs.readFileSync(path.join(REPO, PACK, 'default.json'), 'utf8'));
const report = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/scifi-kit/report.json'), 'utf8'));
const ROOM_ONLY = !!process.env.ROOM_ONLY; // debug: build + measure the station only
// art direction: architecture pieces 1-6k, props 1-8k
const ARCH = new Set(['Wall', 'WallDoorway', 'SlidingDoor', 'WallDoor', 'WallWindow', 'CornerPost', 'Pillar', 'FloorPlate', 'FloorGrate', 'CeilingLight', 'Stairs', 'Ramp', 'Railing']);
const budget = (n) => (ARCH.has(n) ? 6000 : 8000);
const GLOWING = ['CeilingLight', 'Lamp', 'WallScreen', 'WallDoorway', 'SlidingDoor', 'TeleportPad'];
fs.mkdirSync(SHOTS, { recursive: true });
const T0 = Date.now();
const phase = (name) => console.log(`--- ${name} (+${((Date.now() - T0) / 1000).toFixed(0)} s)`);

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

/** in-page: bbox + texture/tris/emissive facts per uuid */
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
			let glow = 0;
			obj.traverse((o) => {
				if (!o.isMesh) return;
				tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
				for (const m of [].concat(o.material)) {
					if (m?.map?.image) {
						maps++;
						mapW = Math.max(mapW, m.map.image.width ?? 0);
					}
					if (m?.emissive && (m.emissiveMap || m.emissive.getHex() !== 0) && m.emissive.getHex() !== 0) glow++;
				}
			});
			out[id] = { min: box.min.toArray(), max: box.max.toArray(), tris: Math.round(tris), maps, mapW, glow, name: obj.name };
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
	for (let t = 0; t < 240 && !uuid; t++) {
		await page.waitForTimeout(250);
		uuid = (await uuidsNow(page)).find((u) => !before.has(u)) ?? null;
	}
	if (!uuid) throw new Error(`${name} never appeared`);
	await page.waitForTimeout(150);
	await page.evaluate(
		({ uuid, pos, rot }) => {
			// = moduleSDK.moveObject: set it, then the SAME `move` the editor sends (a 3-number
			// rotation — core's wire validator refuses Euler.toArray()'s trailing order string)
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

/** in-page: render from `eye` towards each target into a render target against a magenta
 * background with ONLY the placed objects visible; count background pixels per view */
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
			for (const n of hidden) n.visible = true;
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

const setVisible = (page, uuids, v) =>
	page.evaluate(
		({ uuids, v }) => {
			let g;
			window.__stores.objectsGroup.subscribe((x) => (g = x))();
			for (const u of uuids) {
				const o = g.getObjectByProperty('uuid', u);
				if (o) o.visible = v;
			}
		},
		{ uuids, v }
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

// ---------- the station: two 4 × 4 m rooms, A on x 0..4 and B on x 4..8 ----------
// walls centred on the grid lines (pivot bottom-centre), posts on the grid points, floor
// and ceiling tiles in the 2 m cells, an open doorway in the shared wall at x = 4
const SHELL = [
	...[1, 3].flatMap((x) => [1, 3].map((z) => ['FloorPlate', [x, 0, z], 0])),
	...[5, 7].flatMap((x) => [1, 3].map((z) => ['FloorGrate', [x, 0, z], 0])),
	...[1, 3, 5, 7].flatMap((x) => [
		['Wall', [x, 0, 0], 0],
		['Wall', [x, 0, 4], 0]
	]),
	['Wall', [0, 0, 1], 90],
	['Wall', [0, 0, 3], 90],
	['Wall', [8, 0, 1], 90],
	['Wall', [8, 0, 3], 90],
	['WallDoorway', [4, 0, 1], 90],
	['Wall', [4, 0, 3], 90],
	...[0, 4, 8].flatMap((x) => [0, 4].map((z) => ['CornerPost', [x, 0, z], 0])),
	...[1, 3, 5, 7].flatMap((x) => [1, 3].map((z) => ['CeilingLight', [x, 3, z], 0]))
];
// furnishing (free pieces: only their placement is checked, not a grid)
const FURNISH = [
	['Console', [2, 0.1, 0.55], 0],
	['Desk', [1.3, 0.1, 3.35], 180],
	['Chair', [1.3, 0.1, 2.35], 0],
	['ServerRack', [3.45, 0.1, 0.62], 0],
	['ServerRack', [3.45, 0.1, 3.38], 180],
	['WallScreen', [0, 0, 1], 90],
	['Vent', [3, 0, 4], 180],
	['Lamp', [0.5, 0.1, 0.5], 0],
	['PlantPod', [0.6, 0.1, 3.4], 0],
	['TeleportPad', [6, 0.1, 2], 0],
	['Crate', [7.4, 0.1, 0.6], 0],
	['Crate', [7.45, 0.8, 0.62], 25],
	['CrateLarge', [7.2, 0.1, 3.2], 10],
	['Canister', [5, 0.1, 3.5], 0],
	['Canister', [5.6, 0.1, 3.6], 0],
	['PipeStraight', [5, 0.1, 0.35], 0],
	['PipeElbow', [7, 0.1, 0.35], 0],
	['Drone', [6, 1.6, 2], 0],
	['Lamp', [7.5, 0.1, 2], 0]
];

let shotCat = async () => {};

/** open the kit in the Explorer's Packs section and wait until its items are listed */
async function openPack(page) {
	await page.locator('#explorer-slot').click({ timeout: 60000 });
	await page.waitForTimeout(600);
	await page.locator('#packs-folder').dblclick();
	await page.waitForTimeout(600);
	await page.locator(`#explorer-list [data-pack="${PACK}"]`).first().click();
	for (let t = 0; t < 80; t++) {
		await page.waitForTimeout(250);
		const n = await page.evaluate(() => {
			let items;
			window.__stores.packs.openPackItems.subscribe((x) => (items = x))();
			return items.length;
		});
		if (n === list.length) return;
	}
	throw new Error('the pack never opened on the station page');
}

h.run(async () => {
	const browser = await h.launch();
	let A = await h.setupPage(browser, 'A');
	let B = ROOM_ONLY ? null : await h.setupPage(browser, 'B');
	if (B) await h.connect(B, A);

	// ---------- 0. BEFORE: the same Packs list as origin/main serves it (no kit) ----------
	if (!ROOM_ONLY) {
		const mainIndex = require('node:child_process').execFileSync('git', ['-C', REPO, 'show', 'origin/main:index.json']);
		const C = await h.setupPage(browser, 'C');
		await C.ctx.route('**/index.json', (route) => route.fulfill({ body: mainIndex, contentType: 'application/json' }));
		await h.freshReload(C);
		await C.page.waitForTimeout(3000);
		// a fresh third page on a loaded machine can be busy for a while: be patient, retry once
		await C.page.locator('#explorer-slot').click({ timeout: 60000 }).catch(async () => {
			await C.page.waitForTimeout(5000);
			await C.page.locator('#explorer-slot').click({ timeout: 60000 });
		});
		await C.page.waitForTimeout(600);
		await C.page.locator('#packs-folder').dblclick();
		await C.page.waitForTimeout(800);
		h.check((await C.page.locator(`#explorer-list [data-pack="${PACK}"]`).count()) === 0, 'BEFORE (origin/main index): no sci-fi kit in the Packs list');
		await C.page.screenshot({ path: path.join(SHOTS, 'before-explorer-packs.png') });
		await C.ctx.close();
	}

	phase('1 list');
// ---------- 1. the pack lists and opens ----------
	await A.page.locator('#explorer-slot').click();
	await A.page.waitForTimeout(600);
	await A.page.locator('#packs-folder').dblclick();
	await A.page.waitForTimeout(600);
	const row = A.page.locator(`#explorer-list [data-pack="${PACK}"]`);
	h.check((await row.count()) === 1, 'the Sci-fi & Modern Kit lists in the Explorer Packs section');
	const title = await row.first().textContent();
	h.check(TITLE.test(title ?? ''), `it shows its title (${title?.trim()})`);
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
	shotCat = async () => {
		if (await A.page.locator('#explorer-list').isVisible().catch(() => false)) await A.page.locator('#explorer-slot').click();
		await flyTo(A.page, [2, 9, -3], [2, 0, -14]);
		await A.page.waitForTimeout(1500);
		await A.page.screenshot({ path: path.join(SHOTS, 'after-catalogue-A.png') });
	};
	let m;
	let snapWall = null;
	if (!ROOM_ONLY) {
		phase('2 catalogue');
		// ---------- 2. CATALOGUE: every item, in a row far from the station ----------
		let x = -14;
		for (const it of list) {
			const w = report[it.name].size[0];
			const pos = [x - report[it.name].min[0], 0, -14];
			x += w + 1;
			placed.push({ name: it.name, uuid: await place(A.page, it.name, pos), pos, rotY: 0 });
		}
		await A.page.waitForTimeout(1500);
		m = await measure(A.page, placed.map((p) => p.uuid));
		for (const p of placed) {
			const r = m[p.uuid];
			const exp = worldBox(p.name, p.pos, 0);
			h.check(
				!!r && r.maps >= 1 && r.mapW > 0 && r.mapW <= 1024 && r.tris <= budget(p.name) && near(r.min, exp.min) && near(r.max, exp.max),
				`${p.name}: textured (${r?.mapW}px), ${r?.tris} tris ≤ ${budget(p.name)}, size ${report[p.name].size.join('×')} m at its pivot`
			);
		}
		const dark = GLOWING.filter((nm) => !(m[placed.find((p) => p.name === nm).uuid]?.glow > 0));
		h.check(dark.length === 0, `the light pieces emit (${GLOWING.length - dark.length} / ${GLOWING.length}${dark.length ? ', dark: ' + dark.join(',') : ''})`);

		phase('3 snap');
		// ---------- 3. GRID SNAP: a real gizmo drag with 1 m snapping ----------
		snapWall = await place(A.page, 'Wall', [12.37, 0, 3.41], 0);
		await A.page.evaluate(() => {
			const s = window.__stores;
			s.snapping.snapEnabled.set(true);
			s.snapping.snapSettings.set({ translate: 1, rotateDeg: 90, scale: 0.1 });
			s.objectActions.setTransformMode?.('translate');
		});
		await A.page.locator('#explorer-slot').click();
		await A.page.waitForTimeout(500);
		await flyTo(A.page, [12.4, 4, 9], [12.4, 0, 3.4]);
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
			Math.abs(snapped[0] - Math.round(snapped[0])) < 1e-6 && Math.round(snapped[0]) !== 12,
			`REAL drag with 1 m snap: the wall's pivot moved onto the grid (x ${snapped[0]})`
		);
		await A.page.screenshot({ path: path.join(SHOTS, 'snap-drag-after.png') });
		await A.page.evaluate(() => {
			window.__stores.objectActions.deselectObject();
			window.__stores.snapping.snapEnabled.set(false);
		});

		phase('3b catalogue on peer B');
		// the catalogue replicates, then it is cleared: every placed piece carries its own
		// textures, and a catalogue + a furnished station in ONE scene would pass core's
		// 512 MB texture gate ("This model is heavy") — the station below is the real scene
		const cat = [...placed, { name: 'Wall', uuid: snapWall }];
		let mbc = null;
		await h.eventually(
			async () => (mbc = await measure(B.page, cat.map((p) => p.uuid))),
			(r) => cat.every((p) => r[p.uuid] && r[p.uuid].maps >= 1),
			`peer B receives the whole catalogue (${cat.length} pieces), textured`,
			120000
		);
		const mac = await measure(A.page, cat.map((p) => p.uuid));
		const sameCat = placed.filter((p) => mbc?.[p.uuid] && near(mbc[p.uuid].min, mac[p.uuid].min) && near(mbc[p.uuid].max, mac[p.uuid].max));
		for (const p of placed) if (!sameCat.includes(p)) console.log('B differs', p.name, JSON.stringify(mbc?.[p.uuid]), JSON.stringify(mac[p.uuid]));
		h.check(sameCat.length === placed.length, `…at the same positions, sizes and pivots (${sameCat.length} / ${placed.length})`);
		// KNOWN core bug (30c-pack-nature QUESTIONS #9, props-kit finding 1): the gizmo sends
		// `move` with rotation.toArray() = [x, y, z, 'XYZ'] and core's wire validator refuses it
		// as invalid:move, so a gizmo drag does not reach peers. Logged, not a pack check.
		const sw = [mac[snapWall]?.min[0], mbc?.[snapWall]?.min[0]];
		console.log(`KNOWN (core invalid:move): the gizmo-snapped wall is at x ${sw[0]} on A and x ${sw[1]} on B${Math.abs(sw[0] - sw[1]) < 1e-3 ? ' — the core bug is fixed, drop this line' : ' (its drop-time pose)'}`);
		await shotCat();
		await A.page.evaluate((ids) => window.__stores.objectActions.deleteObjectsByUuid(ids), cat.map((p) => p.uuid));
		await h.eventually(
			async () => (await measure(B.page, cat.map((p) => p.uuid))),
			(r) => Object.keys(r).length === 0,
			'…and the catalogue is cleared on both peers',
			30000
		);
		// the catalogue pair is done: close it, so the station's pair starts on a GPU that
		// does not still hold 29 deleted pieces' textures (A's WebGL context was lost at the
		// screenshots when both lived in one page — every later A shot came back blank)
		await A.ctx.close();
		await B.ctx.close();
		A = await h.setupPage(browser, 'D');
		B = await h.setupPage(browser, 'E');
		await h.connect(B, A);
		await openPack(A.page);
	}

	phase('4 station');
	// ---------- 4. STATION ----------
	const built = [];
	for (const [name, pos, rotY] of SHELL) built.push({ name, pos, rotY, uuid: await place(A.page, name, pos, rotY) });
	await A.page.waitForTimeout(1000);
	m = await measure(A.page, built.map((p) => p.uuid));
	let exact = 0;
	for (const p of built) {
		const exp = worldBox(p.name, p.pos, p.rotY);
		if (m[p.uuid] && near(m[p.uuid].min, exp.min) && near(m[p.uuid].max, exp.max)) exact++;
		else console.log('off-grid', p.name, JSON.stringify(m[p.uuid]), JSON.stringify(exp));
	}
	h.check(exact === built.length, `every station piece sits exactly where kit.md says (${exact} / ${built.length})`);
	const north = built.filter((p) => p.name === 'Wall' && p.pos[2] === 0).map((p) => m[p.uuid]);
	h.check(Math.abs(north[0].max[0] - north[1].min[0]) < 1e-4, `two walls in a row meet at x = 2 with no gap (${(north[1].min[0] - north[0].max[0]).toExponential(1)} m)`);

	phase('5 seams');
	// ---------- 5. SEAMS ----------
	const dirs = [];
	for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) if (dx || dy || dz) dirs.push([dx, dy, dz]);
	const eyes = [
		[2, 1.6, 2],
		[0.6, 0.5, 0.6],
		[6, 1.6, 2],
		[7.4, 2.6, 3.4]
	];
	const sum = (a) => a.reduce((x, y) => x + y, 0);
	const sealAll = async () => {
		const out = [];
		for (const e of eyes) {
			const c = await magenta(A.page, e, dirs.map((d) => [e[0] + d[0] * 9, e[1] + d[1] * 9, e[2] + d[2] * 9]));
			if (c.some(Boolean)) {
				// where each leak ray goes: every surface it passes (both sides), in order
				const probe = await A.page.evaluate((eye) => {
					const s = window.__stores;
					const THREE = s.THREE;
					let g;
					s.objectsGroup.subscribe((x) => (g = x))();
					const rc = new THREE.Raycaster();
					return window.__leaks.slice(0, 4).map((l) => {
						rc.set(new THREE.Vector3(...eye), new THREE.Vector3(...l.dir));
						const hits = [];
						g.traverse((o) => {
							if (!o.isMesh) return;
							const side = o.material.side;
							o.material.side = THREE.DoubleSide;
							const h = rc.intersectObject(o, false);
							o.material.side = side;
							for (const x of h.slice(0, 2)) hits.push({ d: +x.distance.toFixed(3), p: x.point.toArray().map((v) => +v.toFixed(3)), obj: (o.parent?.name || '') + '/' + o.name, front: x.face.normal.clone().transformDirection(o.matrixWorld).dot(rc.ray.direction) < 0 });
						});
						return { dir: l.dir, hits: hits.sort((a, b) => a.d - b.d).slice(0, 4) };
					});
				}, e);
				console.log('leaks from eye', JSON.stringify(e), JSON.stringify(probe));
			}
			out.push(...c);
		}
		return out;
	};
	const sealed = await sealAll();
	console.log('magenta per view', JSON.stringify(sealed), 'leak rays', JSON.stringify(await A.page.evaluate(() => window.__leaks)));
	h.check(sum(sealed) === 0, `SEALED: no background pixel shows through any joint, ${sealed.length} views from ${eyes.length} eyes, both rooms + the doorway (${sum(sealed)} px)`);
	const views0 = dirs.map((d) => [eyes[0][0] + d[0] * 9, eyes[0][1] + d[1] * 9, eyes[0][2] + d[2] * 9]);
	const nw = built.find((p) => p.name === 'Wall' && p.pos[0] === 1 && p.pos[2] === 0);
	await moveBy(A.page, nw.uuid, -0.05, 0);
	const leaky = await magenta(A.page, eyes[0], views0);
	await moveBy(A.page, nw.uuid, 0.05, 0);
	h.check(sum(leaky) > 0, `CONTROL: a 5 cm gap is seen by the same metric (${sum(leaky)} px)`);
	// the door between the rooms: the sliding door at the doorway's own spot closes it —
	// room A alone is then sealed, looking at the doorway
	const door = { name: 'SlidingDoor', pos: [4, 0, 1], rotY: 90 };
	door.uuid = await place(A.page, door.name, door.pos, door.rotY);
	built.push(door);
	await A.page.waitForTimeout(800);
	const md = (await measure(A.page, [door.uuid]))[door.uuid];
	const expD = worldBox(door.name, door.pos, door.rotY);
	h.check(!!md && near(md.min, expD.min) && near(md.max, expD.max), 'the sliding door lands in the doorway at the doorway\'s own position + rotation');
	const doorViews = await magenta(A.page, [2.5, 1.3, 1], dirs.map((d) => [2.5 + d[0] * 9, 1.3 + d[1] * 9, 1 + d[2] * 9]));
	h.check(sum(doorViews) === 0, `…and the closed door seals too (${sum(doorViews)} px from inside room A)`);

	phase('6 furnish');
	// ---------- 6. FURNISH ----------
	const furn = [];
	for (const [name, pos, rotY] of FURNISH) furn.push({ name, pos, rotY, uuid: await place(A.page, name, pos, rotY) });
	furn.push({ name: 'WallWindow', pos: [7, 0, 4], rotY: 0 });
	// swap the south-east wall for the window version (the kit's documented one-for-one swap)
	const se = built.find((p) => p.name === 'Wall' && p.pos[0] === 7 && p.pos[2] === 4);
	await setVisible(A.page, [se.uuid], false);
	await A.page.evaluate((u) => window.__stores.objectActions.deleteObjectsByUuid([u]), se.uuid);
	built.splice(built.indexOf(se), 1);
	furn[furn.length - 1].uuid = await place(A.page, 'WallWindow', [7, 0, 4], 0);
	await A.page.waitForTimeout(1500);
	const mf = await measure(A.page, furn.map((p) => p.uuid));
	const onFloor = furn.filter((p) => mf[p.uuid] && mf[p.uuid].maps >= 1).length;
	h.check(onFloor === furn.length, `the station is furnished: ${onFloor} / ${furn.length} pieces placed, textured`);
	// core's import gate asks at 512 MB of scene texture memory (RGBA8 + mips, sceneBudget
	// IMPORT_BUDGETS): a furnished two-room station must stay well inside it
	const texMB = await A.page.evaluate(() => {
		let g;
		window.__stores.objectsGroup.subscribe((x) => (g = x))();
		const seen = new Set();
		let bytes = 0;
		g.traverse((o) => {
			if (!o.isMesh) return;
			for (const m of [].concat(o.material))
				for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
					const t = m?.[k];
					if (!t?.image || seen.has(t)) continue;
					seen.add(t);
					bytes += (t.image.width * t.image.height * 4 * 4) / 3;
				}
		});
		return Math.round(bytes / 2 ** 20);
	});
	h.check(texMB < 512, `the furnished station (${built.length + furn.length} pieces) holds ${texMB} MB of textures, under core's 512 MB import gate`);

	phase('8a shots');
	// ---------- 8a. screenshots (A) ----------
	// a clean viewport: the Explorer closed, the "too large for undo" toasts dismissed
	const clean = async (page) => {
		if (await page.locator('#explorer-list').isVisible().catch(() => false)) await page.locator('#explorer-slot').click();
		await page.evaluate(() => {
			for (const el of document.querySelectorAll('div, li, section')) if (el.children.length < 6 && /too large for undo/.test(el.textContent ?? '') && el.getBoundingClientRect().height < 120) el.style.display = 'none';
		});
		await page.waitForTimeout(400);
	};
	await A.page.evaluate(() => window.__stores.objectActions.deselectObject());
	console.log('A webgl context lost before the shots:', await A.page.evaluate(() => {
		let r;
		window.__stores.globalRenderer.subscribe((x) => (r = x))();
		return r?.getContext?.()?.isContextLost?.() ?? null;
	}));
	await clean(A.page);
	const ceilings = built.filter((p) => p.name === 'CeilingLight').map((p) => p.uuid);
	const shot = async (page, name, eye, target) => {
		await flyTo(page, eye, target);
		await page.waitForTimeout(1500);
		await clean(page);
		await page.screenshot({ path: path.join(SHOTS, name) });
	};
	await shot(A.page, 'after-station-A.png', [13, 8, 12], [4, 1.2, 2]);
	await shot(A.page, 'after-station-back-A.png', [-6, 6, -7], [4, 1.2, 2]);
	// cutaways: the ceiling lifted off so daylight reaches inside (the light strips glow,
	// they do not light the room), looking for gaps at every joint from above and within
	await setVisible(A.page, ceilings, false);
	await shot(A.page, 'after-station-cutaway-A.png', [4, 11, 9], [4, 0, 2]);
	await shot(A.page, 'after-room-A-inside.png', [3.6, 2.6, 3.6], [0.6, 0.9, 0.4]);
	await shot(A.page, 'after-room-B-inside.png', [4.6, 2.6, 3.6], [7.6, 0.9, 0.5]);
	await setVisible(A.page, [door.uuid], false);
	await shot(A.page, 'after-doorway-A-inside.png', [1.2, 1.7, 1.1], [8, 1.1, 1.1]);
	await setVisible(A.page, [door.uuid], true);
	await shot(A.page, 'after-door-closed-A.png', [1.6, 1.7, 1.0], [4, 1.3, 1.0]);
	await setVisible(A.page, ceilings, true);
	await shot(A.page, 'after-room-A-lit.png', [3.5, 1.7, 3.5], [0.5, 1.8, 0.5]);

	if (ROOM_ONLY) return h.finish(browser);
	phase('7 replication');
	// ---------- 7. REPLICATION ----------
	const all = [...built, ...furn];
	let mb = null;
	await h.eventually(
		async () => (mb = await measure(B.page, all.map((p) => p.uuid))),
		(r) => all.every((p) => r[p.uuid] && r[p.uuid].maps >= 1),
		`peer B receives all ${all.length} pieces, textured`,
		90000
	);
	const ma = await measure(A.page, all.map((p) => p.uuid));
	// B assembles a big multi-node import over several frames: wait for the settled pose
	let same = [];
	await h.eventually(
		async () => {
			mb = await measure(B.page, all.map((p) => p.uuid));
			same = all.filter((p) => mb?.[p.uuid] && near(mb[p.uuid].min, ma[p.uuid].min) && near(mb[p.uuid].max, ma[p.uuid].max) && mb[p.uuid].tris === ma[p.uuid].tris);
			return same.length;
		},
		(n) => n === all.length,
		`…at the same positions, rotations and triangle counts (${all.length} pieces)`,
		120000
	);
	for (const p of all) if (!same.includes(p)) console.log('B differs', p.name, JSON.stringify(mb?.[p.uuid]), JSON.stringify(ma[p.uuid]));
	await shot(B.page, 'after-station-B.png', [13, 8, 12], [4, 1.2, 2]);
	await setVisible(B.page, ceilings, false);
	await shot(B.page, 'after-station-cutaway-B.png', [4, 11, 9], [4, 0, 2]);
	await h.finish(browser);
});
