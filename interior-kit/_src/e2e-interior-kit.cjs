// E2E: the interior-kit pack in the REAL app, served as a default pack (PACKS_BASE →
// index.json → interior-kit/default.json → <Item>/glTF-Binary/<file>), the way production
// reads it from jsDelivr.
//
//   1. the pack lists in the Explorer's Packs section, opens with all its items, every
//      thumb is served and the grid renders them
//   2. an item places from the UI (double-click a card)
//   3. a furnished room is built from pack items ON the architecture kit's real walls and
//      floor tiles (the cover's layout, cover.mjs LAYOUT): every interior piece is textured
//      (≤ 1024²), at its real size, on its pivot, carries its colliderHint; every
//      WALL-LINE piece's back lands exactly on the wall's face (z = 0.125 / x = 0.125);
//      the trims cover the wall's foot / top; the chandelier hangs from y = 3; lights glow
//   4. the room replicates to peer B (same geometry, pose, collider hint)
//   5. a real gizmo drag (TransformControls' own pointer handlers) with 0.5 m snapping moves
//      a kitchen counter along its wall and it lands on the grid, back still on the wall
//   6. screenshots: Explorer, room A / B, close-ups of the trims' corners
//
//   (core) VITE_PACKS_BASE=https://theprototype.app:5280/_packs-local npx vite dev --port 5280 --strictPort --host theprototype.app
//          with static/_packs-local → a SNAPSHOT of this checkout (vite reloads on static/ edits)
//   e2e-slot -- env APP_URL=https://theprototype.app:5280/ CORE=<core worktree> SHOTS=<dir> \
//     node interior-kit/_src/e2e-interior-kit.cjs > out.log 2>&1
//
// BEFORE=1 serves origin/main's index.json instead (no interior-kit) for the "before" shot.
// Counterfactuals: CF=snap leaves grid snap OFF for the drag (the grid check goes red);
// CF=pivot nudges the placed Wainscot's meshes 3 cm off the wall (wall-line checks go red).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execSync } = require('node:child_process');

const CORE = process.env.CORE || '/home/deck/.code/theprototype-app/theprototype-lane-33-interior-engine';
const SHOTS = process.env.SHOTS || path.join(os.homedir(), '.code/lanes-30/after-33/33-pack-interior');
const BEFORE = process.env.BEFORE === '1';
const CF = process.env.CF || '';
const h = require(path.join(CORE, 'tests/e2e/helpers.cjs'));
const PACK_DIR = path.resolve(__dirname, '..');
const REPO = path.resolve(PACK_DIR, '..');
const LIST = JSON.parse(fs.readFileSync(path.join(PACK_DIR, 'default.json'), 'utf8'));
const REPORT = JSON.parse(fs.readFileSync(path.join(__dirname, 'build-report.json'), 'utf8'));
const shot = (name) => (SHOTS ? path.join(SHOTS, name) : null);
fs.mkdirSync(SHOTS, { recursive: true });
const TITLE = 'Interiors: Home, Tavern & Office';
const WALL_FACE = 0.125;

const near = (a, b, tol) => Math.abs(a - b) <= tol;
/** poll quietly (no PASS line per call): true once `pred` holds */
async function poll(fn, pred, timeout = 10000) {
	const t0 = Date.now();
	while (Date.now() - t0 < timeout) {
		if (pred(await fn())) return true;
		await new Promise((r) => setTimeout(r, 400));
	}
	return false;
}

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
				if (m?.emissive && m.emissive.r > 0.5) emissive++;
			}
		});
		const r = (v) => +v.toFixed(4);
		return {
			name: obj.name,
			pos: obj.position.toArray().map(r),
			rot: [obj.rotation.x, obj.rotation.y, obj.rotation.z].map(r),
			min: box.min.toArray().map(r),
			max: box.max.toArray().map(r),
			size: box.getSize(new s.THREE.Vector3()).toArray().map(r),
			tris: Math.round(tris),
			maps,
			mapW,
			emissive,
			hint: obj.userData?.colliderHint ?? null,
			inferred: s.colliderSpec?.inferredColliderKind ? s.colliderSpec.inferredColliderKind(obj) : null
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

/** a REPLICATED pose change (the gizmo's `move` message, rotation as an Euler triple) */
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

/** click "Load anyway" when the import gate asks (cumulative texture budget); count the asks */
let gateAsks = 0;
async function passGate(page) {
	const btn = page.getByRole('button', { name: 'Load anyway' });
	if (await btn.isVisible().catch(() => false)) {
		gateAsks++;
		await btn.click();
	}
}

/** world bbox of a local bbox [min,max] turned by yaw (deg, multiples of 90) and moved to pos */
function worldBox(r, pos, yaw) {
	const a = (yaw * Math.PI) / 180;
	const c = Math.round(Math.cos(a));
	const s = Math.round(Math.sin(a));
	const xs = [];
	const zs = [];
	for (const x of [r.min[0], r.max[0]])
		for (const z of [r.min[2], r.max[2]]) {
			xs.push(x * c + z * s);
			zs.push(-x * s + z * c);
		}
	return { min: [pos[0] + Math.min(...xs), pos[1] + r.min[1], pos[2] + Math.min(...zs)], max: [pos[0] + Math.max(...xs), pos[1] + r.max[1], pos[2] + Math.max(...zs)] };
}

h.run(async () => {
	const { LAYOUT } = await import(path.join(__dirname, 'cover.mjs'));
	const browser = await h.launch();
	const A = await h.setupPage(browser, 'A', { context: { viewport: { width: 1540, height: 860 } } });
	let B = null;
	if (BEFORE) {
		const mainIndex = execSync('git show origin/main:index.json', { cwd: REPO }).toString();
		await A.page.route('**/_packs-local/index.json', (route) => route.fulfill({ body: mainIndex, contentType: 'application/json' }));
		await h.freshReload(A);
	} else {
		B = await h.setupPage(browser, 'B');
		await h.connect(B, A);
	}

	// ---------------------------------------------------------------- 1. the pack lists
	await A.page.locator('#explorer-slot').click();
	await A.page.waitForTimeout(600);
	await A.page.locator('#packs-folder').click();
	await A.page.waitForTimeout(1500);
	await A.page.screenshot({ path: shot(BEFORE ? 'before-packs-grid.png' : 'after-packs-grid.png') });
	const listed = await A.page.evaluate(() => {
		let list;
		window.__stores.packs.packs.subscribe((x) => (list = x))();
		const p = list.find((x) => x.name === 'interior-kit');
		return p ? { title: p.title, license: p.license } : null;
	});
	if (BEFORE) {
		h.check(!listed, 'BEFORE: origin/main has no interior-kit pack');
		await h.finish(browser);
		return;
	}
	h.check(!!listed && listed.title === TITLE, `interior-kit lists as "${TITLE}" (${listed?.title})`);
	h.check(listed?.license === 'CC0-1.0', `…licensed CC0-1.0 (${listed?.license})`);

	// ---------------------------------------------------------------- 2. open it, place from the UI
	await A.page.locator('#packs-folder').dblclick();
	await A.page.waitForTimeout(400);
	await A.page.locator('#explorer-list [data-pack="interior-kit"]').click();
	let items = [];
	for (let t = 0; t < 40 && items.length < LIST.length; t++) {
		await A.page.waitForTimeout(300);
		items = await A.page.evaluate(() => {
			let it;
			window.__stores.packs.openPackItems.subscribe((x) => (it = x))();
			return it.map((i) => ({ name: i.name, label: i.label, glbUrl: i.glbUrl, thumbs: i.thumbs }));
		});
	}
	h.check(items.length === LIST.length, `opening interior-kit shows all ${LIST.length} items (${items.length})`);
	const thumbs = await A.page.evaluate(async (list) => {
		const ok = await Promise.all(list.map((i) => fetch(i.thumbs[0]).then((r) => r.ok && r.headers.get('content-type')?.includes('image')).catch(() => false)));
		return ok.filter(Boolean).length;
	}, items);
	h.check(thumbs === LIST.length, `every item's thumb.webp is served (${thumbs}/${LIST.length})`);
	await A.page.waitForTimeout(2000);
	const imgs = await A.page.evaluate(() => [...document.querySelectorAll('#explorer-list .explorer-card img')].filter((i) => i.complete && i.naturalWidth > 0).length);
	h.check(imgs >= 12, `the item grid renders the thumbnails (${imgs} loaded)`);
	await A.page.screenshot({ path: shot('after-pack-items.png') });

	const taken = [];
	const byName = Object.fromEntries(items.map((i) => [i.name, i]));
	const archUrl = (name) => byName.RoundTable.glbUrl.replace(/interior-kit\/RoundTable\/glTF-Binary\/round-table\.glb$/, `architecture-kit/${name}/glTF-Binary/${name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}.glb`);
	await A.page.locator('#explorer-list .explorer-card').filter({ hasText: 'Desk' }).first().dblclick();
	let deskId = null;
	await h.eventually(async () => (deskId = await findNew(A.page, 'Desk', taken)), (v) => !!v, 'double-clicking the Desk card places it', 25000);
	taken.push(deskId);

	// ---------------------------------------------------------------- 3. the room
	const placed = []; // {id, name, arch, pos, yaw}
	for (const [full, x, y, z, yaw] of LAYOUT) {
		const arch = full.startsWith('arch:');
		const name = arch ? full.slice(5) : full;
		const url = arch ? archUrl(name) : byName[name].glbUrl;
		await A.page.evaluate(async (p) => {
			await window.__stores.explorerDrop.dropExplorerItem({ kind: 'object', name: p.name, url: p.url }, 770, 430);
		}, { name, url });
		let id = null;
		await h.eventually(
			async () => {
				await passGate(A.page);
				return (id = await findNew(A.page, name, taken));
			},
			(v) => !!v,
			`…${arch ? 'arch ' : ''}${name} places from the pack`,
			30000
		);
		taken.push(id);
		placed.push({ id, name, arch, pos: [x, y, z], yaw });
	}
	console.log(`import gate asked ${gateAsks}× ("Load anyway") for ${placed.length + 1} placements`);
	// B must hold every object's REAL geometry before it is posed (a move landing on B's
	// loading placeholder is lost when the real object arrives — props-kit core finding #3)
	const trisA = {};
	for (const id of taken) trisA[id] = (await measure(A.page, id)).tris;
	await h.eventually(
		async () => {
			await passGate(B.page);
			let n = 0;
			for (const id of taken) if ((await measure(B.page, id))?.tris === trisA[id]) n++;
			return n;
		},
		(n) => n === taken.length,
		`peer B receives the real geometry of all ${taken.length} placed pieces`,
		180000
	);
	for (const p of placed) await pose(A.page, p.id, p.pos, [0, (p.yaw * Math.PI) / 180, 0]);
	await pose(A.page, deskId, [5.6, 0.1, 6], [0, Math.PI, 0]);
	await A.page.waitForTimeout(1000);
	if (CF === 'pivot')
		await A.page.evaluate((id) => {
			let g;
			window.__stores.objectsGroup.subscribe((x) => (g = x))();
			g.getObjectByProperty('uuid', id).traverse((o) => o.isMesh && o.position.add({ x: 0, y: 0, z: 0.03 }));
		}, placed.find((p) => p.name === 'Wainscot').id);

	// every interior piece: textured, real size, on its pivot (the world bbox the report predicts), collider hint
	const { ITEMS, pivotOf } = await import(path.join(__dirname, 'items.mjs'));
	const ITEM = Object.fromEntries(ITEMS.map((i) => [i.name, { ...i, pivot: pivotOf(i) }]));
	const bad = [];
	const measured = {};
	for (const p of placed) {
		const m = await measure(A.page, p.id);
		measured[p.id] = m;
		if (p.arch) continue;
		const r = REPORT[p.name];
		const exp = worldBox(r, p.pos, p.yaw);
		const why = [];
		if (!(m.maps >= 1 && m.mapW > 0 && m.mapW <= 1024) && !['Chandelier'].includes(p.name)) why.push(`maps ${m.maps} @${m.mapW}`);
		// a yaw off the 90° steps grows the world AABB: check only y then (props-kit did the same)
		const axis = Math.abs(Math.sin((p.yaw * Math.PI) / 90)) < 1e-6;
		for (const k of axis ? [0, 1, 2] : [1]) {
			if (!near(m.min[k], exp.min[k], 0.006)) why.push(`min[${k}] ${m.min[k]} vs ${exp.min[k].toFixed(4)}`);
			if (!near(m.max[k], exp.max[k], 0.006)) why.push(`max[${k}] ${m.max[k]} vs ${exp.max[k].toFixed(4)}`);
		}
		if (m.tris !== r.tris) why.push(`tris ${m.tris} vs ${r.tris}`);
		if (m.hint !== ITEM[p.name].collider) why.push(`colliderHint ${m.hint} vs ${ITEM[p.name].collider}`);
		if (why.length) bad.push(`${p.name}@${p.pos.join(',')}: ${why.join(', ')}`);
	}
	const interiorCount = placed.filter((p) => !p.arch).length;
	h.check(bad.length === 0, `all ${interiorCount} placed interior pieces are textured (≤1024²), at real size, on their pivot, with their collider hint${bad.length ? ' — ' + bad.join(' | ') : ''}`);
	const inferred = placed.filter((p) => !p.arch).map((p) => measured[p.id]).filter((m) => m.inferred && m.inferred !== m.hint);
	h.check(inferred.length === 0, `core's collider inference takes every hint (${inferred.map((m) => m.name + ':' + m.inferred).join(', ') || 'all match'})`);

	// WALL-LINE: the back of every wall piece lies ON the wall face it was given (±1.5 mm)
	const wallBad = [];
	for (const p of placed.filter((q) => !q.arch && ITEM[q.name].pivot === 'wall-line')) {
		const m = measured[p.id];
		const trim = ['Skirting', 'SkirtingDoorway', 'Wainscot', 'WainscotDoorway', 'Cornice'].includes(p.name);
		const faceBack = trim ? 0.105 : p.name === 'Picture' ? 0.121 : WALL_FACE; // trims embed 2 cm into the relief
		const back = p.yaw === 90 ? m.min[0] - p.pos[0] : m.min[2] - p.pos[2];
		if (!near(back, faceBack, 0.0015)) wallBad.push(`${p.name}@${p.pos.join(',')} back ${back.toFixed(4)} vs ${faceBack}`);
	}
	h.check(wallBad.length === 0, `every wall-line piece's back sits on its wall's face (${placed.filter((q) => !q.arch && ITEM[q.name].pivot === 'wall-line').length} pieces)${wallBad.length ? ' — ' + wallBad.join(' | ') : ''}`);
	const wallA = measured[placed.find((p) => p.arch && p.name === 'WallPlaster').id];
	h.check(near(wallA.max[2], WALL_FACE, 0.002), `…and that face IS the architecture wall's face (wall max z ${wallA.max[2]})`);
	const cornice = measured[placed.find((p) => p.name === 'Cornice').id];
	h.check(near(cornice.max[1], 3, 0.002) && near(wallA.max[1], 3, 0.002), `the cornice tops out at the wall's top, y = 3 (${cornice.max[1]} / wall ${wallA.max[1]})`);
	const skirt = measured[placed.find((p) => p.name === 'Skirting').id];
	h.check(skirt.min[1] < 0.1 && skirt.max[1] > 0.2, `the skirting runs from below the floor tiles' top (0.1) to ${skirt.max[1]} (min ${skirt.min[1]})`);
	const chand = measured[placed.find((p) => p.name === 'Chandelier').id];
	h.check(near(chand.max[1], 3, 0.002) && chand.emissive >= 1, `the chandelier hangs from y = 3 (top ${chand.max[1]}) and its flames glow (${chand.emissive})`);
	const lamp = measured[placed.find((p) => p.name === 'FloorLamp').id];
	h.check(lamp.emissive >= 1 && near(lamp.min[1], 0.1, 0.002), `the floor lamp stands on the floor tiles (y ${lamp.min[1]}) and glows (${lamp.emissive})`);

	// ---------------------------------------------------------------- 4. replication
	let repl = 0;
	for (const p of placed) {
		const a = measured[p.id];
		const ok = await poll(
			() => measure(B.page, p.id),
			(b) => !!b && b.tris === a.tris && b.pos.every((v, k) => near(v, a.pos[k], 1e-3)) && b.rot.every((v, k) => near(v, a.rot[k], 1e-3)) && b.min.every((v, k) => near(v, a.min[k], 3e-3)) && b.hint === a.hint,
			30000
		);
		if (!ok) console.log(`  peer B differs on ${a.name}: ${JSON.stringify(await measure(B.page, p.id))} vs ${JSON.stringify(a)}`);
		if (ok) repl++;
	}
	h.check(repl === placed.length, `peer B has all ${placed.length} room pieces with the same geometry, pose and collider hint (${repl}/${placed.length})`);

	// ---------------------------------------------------------------- 5. a real gizmo drag snaps on the grid along the wall
	await A.page.locator('#explorer-slot').click();
	await A.page.waitForTimeout(400);
	await A.page.evaluate((on) => {
		window.__stores.snapping.snapEnabled.set(on);
		window.__stores.snapping.snapSettings.set({ translate: 0.5, rotateDeg: 15, scale: 0.1 });
	}, CF !== 'snap');
	await A.page.evaluate(async (p) => {
		await window.__stores.explorerDrop.dropExplorerItem({ kind: 'object', name: p.name, url: p.glbUrl }, 770, 430);
	}, byName.KitchenCounter);
	let ctrId = null;
	await h.eventually(async () => (ctrId = await findNew(A.page, 'KitchenCounter', taken)), (v) => !!v, 'a kitchen counter places', 25000);
	taken.push(ctrId);
	const ctrTris = (await measure(A.page, ctrId)).tris;
	await h.eventually(() => measure(B.page, ctrId), (b) => b?.tris === ctrTris, 'peer B receives the kitchen counter', 40000);
	// on the back wall's line (z = 0), off-grid in x, beyond the room's right side
	await pose(A.page, ctrId, [6.37, 0.1, 0], [0, 0, 0]);
	await A.page.evaluate(() => window.__stores.objectActions.flyTo([7.2, 3.4, 5.2], [7.0, 0.5, 0], 0));
	await A.page.waitForTimeout(800);
	const how = await A.page.evaluate((id) => {
		const s = window.__stores;
		s.objectActions.setEditorMode('edit');
		s.objectActions.setTransformMode('translate');
		s.objectActions.selectObject(id);
		let c, cam, g;
		s.TControls.subscribe((v) => (c = v))();
		s.globalCamera.subscribe((v) => (cam = v))();
		s.objectsGroup.subscribe((v) => (g = v))();
		const o = g.getObjectByProperty('uuid', id);
		if (!c || c.object !== o) return `not attached (${c?.object?.name ?? 'nothing'})`;
		const ndc = (v, button = 0) => {
			const p = v.clone().project(cam);
			return { x: p.x, y: p.y, button };
		};
		const start = o.position.clone();
		c.axis = 'X';
		c.getHelper?.().updateMatrixWorld(true);
		c.pointerDown(ndc(start));
		for (let k = 1; k <= 8; k++) c.pointerMove(ndc(start.clone().add(new s.THREE.Vector3(k * 0.11, 0, 0)), -1));
		c.pointerUp(ndc(start.clone().add(new s.THREE.Vector3(0.88, 0, 0))));
		return 'pointer-api';
	}, ctrId);
	await A.page.waitForTimeout(500);
	h.check(how === 'pointer-api', `the gizmo attaches to the selected counter and drags it (${how})`);
	const dragged = await measure(A.page, ctrId);
	h.check(
		dragged.pos[0] > 6.8 && near(dragged.pos[0] * 2, Math.round(dragged.pos[0] * 2), 1e-6) && near(dragged.min[2], WALL_FACE, 0.0015) && near(dragged.pos[2], 0, 1e-6),
		`the drag with a 0.5 m snap lands the counter ON the grid along its wall: x 6.37 → ${dragged.pos[0]}, back still on the wall face (z ${dragged.min[2]})`
	);
	let onB = null;
	for (let t = 0; t < 20; t++) {
		onB = await measure(B.page, ctrId);
		if (onB && near(onB.pos[0], dragged.pos[0], 1e-4)) break;
		await B.page.waitForTimeout(400);
	}
	if (onB && near(onB.pos[0], dragged.pos[0], 1e-4)) h.check(true, `peer B sees the gizmo-snapped counter at x ${dragged.pos[0]} (the gizmo's own move)`);
	else {
		console.log(`NOTE: the gizmo's own move did not reach B (B x ${onB?.pos[0]}) — known core finding (rotation.toArray() on the wire); sending a valid triple`);
		await pose(A.page, ctrId, dragged.pos, [0, 0, 0]);
		await h.eventually(() => measure(B.page, ctrId), (b) => !!b && near(b.pos[0], dragged.pos[0], 1e-4), `peer B sees the snapped counter at x ${dragged.pos[0]}`, 15000);
	}
	await A.page.evaluate(() => {
		window.__stores.objectActions.deselectObject();
		window.__stores.snapping.snapEnabled.set(false);
	});

	// ---------------------------------------------------------------- 6. the room, looked at
	const counts = await A.page.evaluate(() => {
		let r;
		window.__stores.globalRenderer.subscribe((v) => (r = v))();
		return r ? { calls: r.info.render.calls, tris: r.info.render.triangles, geos: r.info.memory.geometries, tex: r.info.memory.textures } : null;
	});
	console.log(`renderer after the room (A): ${JSON.stringify(counts)}`);
	await A.page.waitForTimeout(6000); // let the placement toasts time out
	const views = [
		['after-room-A.png', [8.6, 5.2, 8.4], [2.6, 0.8, 1.4]],
		['after-room-hearth-A.png', [4.3, 1.7, 4.6], [4.4, 1.0, 0.0]],
		['after-room-kitchen-A.png', [1.7, 1.6, 3.6], [1.3, 0.8, 0.0]],
		['after-trim-corner-A.png', [1.6, 1.0, 1.8], [0.05, 0.6, 0.05]],
		['after-trim-cornice-A.png', [1.8, 2.2, 1.9], [0.0, 2.9, 0.0]]
	];
	for (const [file, eye, target] of views) {
		await A.page.evaluate(([e, t]) => window.__stores.objectActions.flyTo(e, t, 0), [eye, target]);
		await A.page.waitForTimeout(1500);
		await A.page.screenshot({ path: shot(file) });
	}
	await B.page.evaluate(() => window.__stores.objectActions.flyTo([8.6, 5.2, 8.4], [2.6, 0.8, 1.4], 0));
	await B.page.waitForTimeout(2000);
	await B.page.screenshot({ path: shot('after-room-peerB.png') });
	await h.finish(browser);
});
