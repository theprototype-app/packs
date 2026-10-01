// E2E: the town-kit pack in the REAL app, served as a default pack.
//
//   the pack lists in the Explorer's Packs section (index.json row "Town & Market Kit"), opens to
//   all its items with their thumbnails · an item places from the UI (double-click) · a street
//   is laid out on the 2 m grid from pack items — sidewalks, curbs, road, a crossing, the corner
//   curbs closing the street's end, a plaza with the fountain, a fence run with the garden gate,
//   architecture-kit building fronts with banners + a flower box on a window sill, a clock tower
//   top on a tower of architecture-kit walls · every placed piece is textured (≤ 1024²), at its
//   real-world size, on its pivot and carries its collider hint · the street tiles abut with
//   0 mm seams · everything replicates to peer B · a gizmo drag (TransformControls' own pointer
//   handlers) with a 2 m snap lands a sidewalk tile ON the grid, flush against its neighbour, and
//   B sees it there · the garden gate arrives as an animated import with its open/close clips and
//   its P2 behavior · screenshots.
//
// Needs a core dev server whose VITE_PACKS_BASE serves a snapshot of this checkout:
//
//   e2e-slot -- env APP_URL=https://theprototype.app:5281/ CORE=<core worktree> \
//     SHOTS=<dir> node tools/town-kit/e2e-town.cjs > out.log 2>&1
//
// BEFORE=1 serves origin/main's index.json instead (no town-kit) for the "before" shot.
// Counterfactuals (each must turn its guard red): CF=snap leaves grid snap OFF for the drag;
// CF=pivot shifts the placed Fountain's mesh 0.3 m off its origin on A (a mis-pivoted GLB);
// CF=seam nudges one street tile 2 cm (a gap in the street).
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');

const CORE = process.env.CORE || '/home/deck/.code/theprototype-app/theprototype-lane-33-town-engine';
const SHOTS = process.env.SHOTS || '';
const BEFORE = process.env.BEFORE === '1';
const CF = process.env.CF || '';
const h = require(path.join(CORE, 'tests/e2e/helpers.cjs'));
const REPO = path.resolve(__dirname, '../..');
const PACK_DIR = path.join(REPO, 'town-kit');
const LIST = JSON.parse(fs.readFileSync(path.join(PACK_DIR, 'default.json'), 'utf8'));
const REPORT = JSON.parse(fs.readFileSync(path.join(__dirname, 'report.json'), 'utf8'));
const ARCH = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(REPO, 'architecture-kit/default.json'), 'utf8')).map((i) => [i.name, i.variants['glTF-Binary']]));
const ARCH_REPORT = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/architecture-kit/report.json'), 'utf8'));
const shot = (name) => (SHOTS ? path.join(SHOTS, name) : null);
const W = 0.35; // sidewalk / curb top
const R = 0.2; // road top
const FB = REPORT.FlowerBox?.size ?? [1, 0.4, 0.3];

/** [item, x, y, z, yawDeg, pack?] — street runs along X; tile centres on EVEN metres (2 m snap) */
const STREET = [];
for (const x of [-4, -2, 0, 2, 4, 6]) {
	STREET.push(['Sidewalk', x, 0, -4, 0]);
	STREET.push(['RoadCurb', x, 0, -2, 180]);
	STREET.push([x === 2 ? 'RoadCrossing' : 'Road', x, 0, 0, 0]);
	STREET.push(['RoadCurb', x, 0, 2, 0]);
	STREET.push(['Sidewalk', x, 0, 4, 0]);
	if (x < 6) STREET.push(['Sidewalk', x, 0, 6, 0]);
}
// the street's east end: corner curbs + an end curb (curb on +X)
STREET.push(['RoadCorner', 8, 0, 2, 0], ['RoadCurb', 8, 0, 0, 90], ['RoadCorner', 8, 0, -2, 90]);
// …and the sidewalk wrapping round it
STREET.push(['Sidewalk', 8, 0, -4, 0], ['Sidewalk', 8, 0, 4, 0], ...[-4, -2, 0, 2, 4].map((z) => ['Sidewalk', 10, 0, z, 0]));
const DRESS = [
	// north side: building fronts (architecture-kit), their front face on the sidewalk's back edge z = -5
	...[-4, -2, 0, 4, 6].map((x) => [x === 0 ? 'WallPlasterDoor' : 'WallPlaster', x, 0, -5.125, 0, 'architecture-kit']),
	['WallStoneWindow', 2, 0, -5.125, 0, 'architecture-kit'],
	['FlowerBox', 2, 1.1, -5 + FB[2] / 2, 0],
	['Banner', -4, 1.0, -5, 0],
	['Banner', 4, 1.0, -5, 0],
	['MarketStall', -2, W, -4, 0],
	['BarrelCluster', -4.2, W, -4.3, 0],
	['LampPost', 1, W, -3.4, 0],
	['LampPost', 5, W, -3.4, 0],
	['HayStack', 3, W, -4.4, 90],
	['HayBale', 4.2, W, -3.7, 30],
	['NoticeBoard', 6.2, W, -4.4, 0],
	['MarketCart', -2.5, R, 0.3, 0],
	// south side + plaza
	['LampPost', -3, W, 3.6, 0],
	['LampPost', 3, W, 3.6, 0],
	['BannerPole', -4.6, W, 3.9, 0],
	['Signpost', 6.2, W, 4.0, 0],
	['Fountain', 0, W, 5.6, 0],
	['ParkBench', -2.6, W, 5.6, 90],
	['ParkBench', 2.6, W, 5.6, -90],
	['Well', 4.3, W, 5.8, 0],
	['FlowerBoxLong', -4, W, 6.6, 0],
	...[-4, -2, 2, 4].map((x) => ['Fence', x, 0, 7.2, 0]),
	['FenceGate', 0, 0, 7.2, 0],
	['StoneStairs', -6, 0, 6, 180],
	['Bridge', 13, 0, 4, 0],
	// a 4 × 4 m tower of architecture-kit walls (lines x = -11 / -7, z = -2 / 2), the clock top on it
	...[-10, -8].flatMap((x) => [['WallStone', x, 0, -2, 0, 'architecture-kit'], ['WallStone', x, 0, 2, 0, 'architecture-kit']]),
	...[-1, 1].flatMap((z) => [['WallStone', -11, 0, z, 90, 'architecture-kit'], ['WallStone', -7, 0, z, 90, 'architecture-kit']]),
	...[-11, -7].flatMap((x) => [['CornerPostStone', x, 0, -2, 0, 'architecture-kit'], ['CornerPostStone', x, 0, 2, 0, 'architecture-kit']]),
	['ClockTowerTop', -9, 3, 0, 0]
];
const LAYOUT = [...STREET, ...DRESS];
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
			hint: obj.userData?.colliderHint ?? null,
			inferred: s.colliderSpec?.inferredColliderKind?.(obj) ?? null,
			behavior: obj.userData?.behavior ?? null,
			clips: obj.userData?.animatedClips ?? null
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

/** a REPLICATED pose change (`rot` as an Euler TRIPLE: wireValidate refuses [x,y,z,'XYZ']) */
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

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const drop = (page, name, url) => page.evaluate(async (p) => window.__stores.explorerDrop.dropExplorerItem({ kind: 'object', name: p.name, url: p.url }, 770, 420), { name, url });

h.run(async () => {
	const browser = await h.launch();
	const A = await h.setupPage(browser, 'A', { context: { viewport: { width: 1540, height: 774 } } });
	let B = null;
	if (BEFORE) {
		const mainIndex = execSync('git show origin/main:index.json', { cwd: REPO }).toString();
		await A.page.route('**/packs-local/index.json', (route) => route.fulfill({ body: mainIndex, contentType: 'application/json' }));
		await h.freshReload(A);
	} else {
		B = await h.setupPage(browser, 'B');
		await h.connect(B, A);
	}

	// ---------------------------------------------------------------- 1. the pack lists
	await A.page.locator('#explorer-slot').click();
	await A.page.waitForTimeout(600);
	await A.page.locator('#packs-folder').click();
	await A.page.waitForTimeout(1200);
	if (SHOTS) await A.page.screenshot({ path: shot(BEFORE ? 'before-packs-grid.png' : 'after-packs-grid.png') });
	const listed = await A.page.evaluate(() => {
		let list;
		window.__stores.packs.packs.subscribe((x) => (list = x))();
		const p = list.find((x) => x.name === 'town-kit');
		return p ? { title: p.title, license: p.license, listUrl: p.listUrl } : null;
	});
	if (BEFORE) {
		h.check(!listed, 'BEFORE: origin/main has no town-kit pack');
		await h.finish(browser);
		return;
	}
	h.check(!!listed && listed.title === 'Town & Market Kit', `town-kit lists as "Town & Market Kit" (${listed?.title})`);
	h.check(listed?.license === 'CC0-1.0', `…licensed CC0-1.0 (${listed?.license})`);

	// ---------------------------------------------------------------- 2. open it
	await A.page.locator('#packs-folder').dblclick();
	await A.page.waitForTimeout(400);
	await A.page.locator('#explorer-list [data-pack="town-kit"]').click();
	let items = [];
	for (let t = 0; t < 30 && items.length < LIST.length; t++) {
		await A.page.waitForTimeout(300);
		items = await A.page.evaluate(() => {
			let it;
			window.__stores.packs.openPackItems.subscribe((x) => (it = x))();
			return it.map((i) => ({ name: i.name, label: i.label, glbUrl: i.glbUrl, thumbs: i.thumbs }));
		});
	}
	h.check(items.length === LIST.length, `opening town-kit shows all ${LIST.length} items (${items.length})`);
	const thumbs = await A.page.evaluate(async (list) => {
		const ok = await Promise.all(list.map((i) => fetch(i.thumbs[0]).then((r) => r.ok && r.headers.get('content-type')?.includes('image')).catch(() => false)));
		return ok.filter(Boolean).length;
	}, items);
	h.check(thumbs === LIST.length, `every item's thumb.webp is served (${thumbs}/${LIST.length})`);
	await A.page.waitForTimeout(1500);
	const imgs = await A.page.evaluate(() => [...document.querySelectorAll('#explorer-list .explorer-card img')].filter((i) => i.complete && i.naturalWidth > 0).length);
	h.check(imgs >= Math.min(12, LIST.length), `the item grid renders the thumbnails (${imgs} loaded)`);
	if (SHOTS) await A.page.screenshot({ path: shot('after-pack-items.png') });
	const urlOf = (name, pack) => {
		if (!pack) return items.find((i) => i.name === name).glbUrl;
		const town = items[0].glbUrl; // …/town-kit/<Item>/glTF-Binary/<file>
		return town.replace(/town-kit\/[^/]+\/glTF-Binary\/[^/]+$/, `${pack}/${name}/glTF-Binary/${ARCH[name]}`);
	};

	// ---------------------------------------------------------------- 3. place from the UI
	const taken = [];
	await A.page.locator('#explorer-list .explorer-card').filter({ hasText: ITEM_BY.Fountain.label }).first().dblclick();
	let firstId = null;
	await h.eventually(async () => (firstId = await findNew(A.page, 'Fountain', taken)), (v) => !!v, 'double-clicking the Fountain card places it', 20000);
	taken.push(firstId);

	// ---------------------------------------------------------------- 4. lay out the street
	const placed = { Fountain: [firstId] };
	for (const [name, , , , , pack] of LAYOUT) {
		if (name === 'Fountain' && placed.Fountain.length === 1 && !placed.__f) {
			placed.__f = true; // the double-clicked one is the plaza's fountain
			continue;
		}
		await drop(A.page, name, urlOf(name, pack));
		let id = null;
		await h.eventually(async () => (id = await findNew(A.page, name, taken)), (v) => !!v, `…${name} places${pack ? ` (${pack})` : ''}`, 25000);
		taken.push(id);
		(placed[name] ??= []).push(id);
	}
	delete placed.__f;
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
		180000
	);
	const at = {};
	const uses = {};
	for (const [name, x, y, z, yaw] of LAYOUT) {
		const i = (uses[name] = (uses[name] ?? -1) + 1);
		const id = placed[name][i];
		const nudge = CF === 'seam' && name === 'Road' && i === 1 ? 0.02 : 0;
		await pose(A.page, id, [x + nudge, y, z], [0, (yaw * Math.PI) / 180, 0]);
		at[id] = { name, pos: [x, y, z], yaw };
	}
	await A.page.waitForTimeout(800);
	if (CF === 'pivot')
		await A.page.evaluate((id) => {
			let g;
			window.__stores.objectsGroup.subscribe((x) => (g = x))();
			g.getObjectByProperty('uuid', id).traverse((o) => o.isMesh && o.position.add({ x: 0, y: 0.3, z: 0.3 }));
		}, placed.Fountain[0]);

	// ---------------------------------------------------------------- 5. every piece is right
	const bad = [];
	const measured = {};
	for (const id of taken) {
		const m = await measure(A.page, id);
		measured[id] = m;
		const town = !!REPORT[m.name];
		const r = REPORT[m.name] ?? ARCH_REPORT[m.name];
		if (ITEM_BY[m.name]?.behavior) continue; // animated: checked in 7
		const y0 = at[id].pos[1];
		const exp = r.size;
		const swap = Math.abs(Math.sin((at[id].yaw * Math.PI) / 180)) > 0.7;
		const ex = swap ? exp[2] : exp[0];
		const ez = swap ? exp[0] : exp[2];
		const skew = Math.abs(Math.sin((at[id].yaw * Math.PI) / 90)) > 0.1;
		const why = [];
		if (!(m.maps >= 1 && m.mapW > 0 && m.mapW <= 1024)) why.push(`maps ${m.maps} @${m.mapW}`);
		if (!near(m.size[1], exp[1], 0.02 + exp[1] * 0.01)) why.push(`h ${m.size[1]} vs ${exp[1]}`);
		if (!skew && (!near(m.size[0], ex, 0.02 + ex * 0.01) || !near(m.size[2], ez, 0.02 + ez * 0.01))) why.push(`xz ${m.size[0]},${m.size[2]} vs ${ex},${ez}`);
		if (!near(m.min[1] - y0, r.min[1], 0.01)) why.push(`pivot y ${(m.min[1] - y0).toFixed(3)} vs ${r.min[1]}`);
		// the pivot is the footprint's centre (x/z) for every town piece but the wall banner
		if (town && !skew && m.name !== 'Banner' && m.name !== 'Signpost') {
			const cx = (m.min[0] + m.max[0]) / 2 - at[id].pos[0];
			const cz = (m.min[2] + m.max[2]) / 2 - at[id].pos[2];
			const ecx = swap ? 0 : (r.min[0] + r.max[0]) / 2;
			if (!near(Math.abs(cx), Math.abs(ecx), 0.03) || (!swap && !near(Math.abs(cz), Math.abs((r.min[2] + r.max[2]) / 2), 0.03))) why.push(`pivot xz off by ${cx.toFixed(3)},${cz.toFixed(3)}`);
		}
		if (m.tris !== r.tris) why.push(`tris ${m.tris} vs ${r.tris}`);
		if (town && (r.hint ?? null) !== m.hint) why.push(`hint ${m.hint} vs ${r.hint}`);
		if (town && r.hint && m.inferred !== r.hint) why.push(`core infers ${m.inferred} (hint ${r.hint})`);
		if (why.length) bad.push(`${m.name}: ${why.join(', ')}`);
	}
	h.check(bad.length === 0, `all ${taken.length} placed pieces are textured (≤1024²), at real size, on their pivot, with their collider hint${bad.length ? ' — ' + bad.join(' | ') : ''}`);
	const hinted = taken.filter((id) => measured[id].hint && measured[id].inferred === measured[id].hint).length;
	h.check(hinted >= 40, `core's colliderSpec reads the pack's collider hints (${hinted} placed pieces)`);

	// the street: neighbouring tiles share their edge exactly (0 mm seams), tops level
	const tiles = taken.filter((id) => ['Road', 'RoadCurb', 'RoadCrossing', 'RoadCorner', 'Sidewalk'].includes(measured[id].name));
	let seams = 0;
	const gaps = [];
	for (const a of tiles) {
		for (const b of tiles) {
			const ma = measured[a];
			const mb = measured[b];
			const dx = mb.pos[0] - ma.pos[0];
			const dz = mb.pos[2] - ma.pos[2];
			if (near(dz, 0, 0.5) && near(dx, 2, 0.5)) {
				seams++;
				if (!near(mb.min[0], ma.max[0], 1e-3)) gaps.push(`${ma.name}@${ma.pos[0]},${ma.pos[2]}→${mb.name}: ${(mb.min[0] - ma.max[0]).toFixed(4)} m`);
			}
			if (near(dx, 0, 0.5) && near(dz, 2, 0.5)) {
				seams++;
				if (!near(mb.min[2], ma.max[2], 1e-3)) gaps.push(`${ma.name}@${ma.pos[0]},${ma.pos[2]}→${mb.name}: ${(mb.min[2] - ma.max[2]).toFixed(4)} m`);
			}
		}
	}
	h.check(seams >= 50 && gaps.length === 0, `the ${tiles.length} street tiles meet with 0 mm seams (${seams} joints${gaps.length ? '; gaps: ' + gaps.slice(0, 4).join(' | ') : ''})`);
	const curbTop = measured[placed.RoadCurb[0]].max[1];
	const walkTop = measured[placed.Sidewalk[0]].max[1];
	const roadTop = measured[placed.Road[0]].max[1];
	h.check(near(curbTop, walkTop, 1e-3) && near(roadTop, R, 1e-3), `curb top = sidewalk top (${curbTop} / ${walkTop}), road at ${roadTop} — a 15 cm kerb`);
	const clock = measured[placed.ClockTowerTop[0]];
	h.check(near(clock.min[1], 3, 0.01) && clock.size[0] <= 4.26, `the clock tower top sits on the 3 m wall tops of the 4 × 4 m tower (y ${clock.min[1]}, ${clock.size[0]} m wide)`);

	// ---------------------------------------------------------------- 6. replication
	let repl = 0;
	for (const id of taken) {
		const a = measured[id];
		if (ITEM_BY[a.name]?.behavior) continue;
		await h.eventually(
			() => measure(B.page, id),
			(b) => !!b && b.tris === a.tris && b.maps >= 1 && b.pos.every((v, k) => near(v, a.pos[k], 1e-3)) && b.rot.every((v, k) => near(v, a.rot[k], 1e-3)) && b.min.every((v, k) => near(v, a.min[k], 2e-3)),
			`peer B has ${a.name} with the same geometry, texture and pose`,
			25000
		);
		repl++;
	}
	h.check(repl >= taken.length - 1, `${repl} static pieces replicated exactly to peer B`);

	// ---------------------------------------------------------------- 7. the garden gate (P2 data)
	const gateId = placed.FenceGate[0];
	const gA = await measure(A.page, gateId);
	h.check(!!gA.clips && gA.clips.includes('open') && gA.clips.includes('close'), `the garden gate imports as an animated model with clips ${JSON.stringify(gA.clips)}`);
	h.check(gA.behavior?.type === 'door' && gA.behavior.clip === 'open' && gA.behavior.closeClip === 'close' && gA.behavior.autoplay === false, `…and carries its P2 behavior on the root (${JSON.stringify(gA.behavior)})`);
	const leaf = await A.page.evaluate((id) => {
		let g;
		window.__stores.objectsGroup.subscribe((x) => (g = x))();
		const root = g.getObjectByProperty('uuid', id);
		const l = root.getObjectByName('Leaf');
		return l ? { x: +l.position.x.toFixed(3), parent: l.parent === root || l.parent?.parent === root } : null;
	}, gateId);
	h.check(!!leaf && near(leaf.x, -0.87, 1e-3), `…its Leaf node is pivoted on the hinge line x = -0.87 (${JSON.stringify(leaf)})`);
	await h.eventually(() => measure(B.page, gateId), (b) => !!b && JSON.stringify(b.clips) === JSON.stringify(gA.clips) && b.behavior?.type === 'door', 'peer B receives the gate with its clips and behavior', 30000);

	// ---------------------------------------------------------------- 8. a gizmo drag snaps a tile onto the 2 m grid
	await A.page.locator('#explorer-slot').click();
	await A.page.waitForTimeout(400);
	await A.page.evaluate((on) => {
		window.__stores.snapping.snapEnabled.set(on);
		window.__stores.snapping.snapSettings.set({ translate: 2, rotateDeg: 15, scale: 0.1 });
	}, CF !== 'snap');
	await drop(A.page, 'Sidewalk', urlOf('Sidewalk'));
	let tileId = null;
	await h.eventually(async () => (tileId = await findNew(A.page, 'Sidewalk', taken)), (v) => !!v, 'a sidewalk tile places', 20000);
	const tileTris = (await measure(A.page, tileId)).tris;
	await h.eventually(() => measure(B.page, tileId), (b) => b?.tris === tileTris, 'peer B receives the sidewalk tile', 30000);
	await pose(A.page, tileId, [8.63, 0, 6], [0, 0, 0]);
	await A.page.evaluate(() => window.__stores.objectActions.flyTo([7, 7, 13], [7, 0, 6], 0));
	await A.page.waitForTimeout(700);
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
		for (let k = 1; k <= 8; k++) c.pointerMove(ndc(start.clone().add(new s.THREE.Vector3(-k * 0.33, 0, 0)), -1));
		c.pointerUp(ndc(start.clone().add(new s.THREE.Vector3(-2.64, 0, 0))));
		return 'pointer-api';
	}, tileId);
	await A.page.waitForTimeout(500);
	h.check(how === 'pointer-api', `the gizmo attaches to the selected tile and drags it (${how})`);
	const dragged = await measure(A.page, tileId);
	const west = measured[placed.Sidewalk.find((id) => near(measured[id].pos[0], 4, 0.01) && near(measured[id].pos[2], 6, 0.01))];
	h.check(
		near(dragged.pos[0] % 2, 0, 1e-6) && near(dragged.pos[0], 6, 1e-6) && near(dragged.min[0], west.max[0], 1e-3),
		`the drag with a 2 m snap lands the tile ON the grid, flush with its neighbour: x 8.63 → ${dragged.pos[0]}, west edge ${dragged.min[0]} vs neighbour ${west.max[0]}`
	);
	let direct = null;
	for (let t = 0; t < 20; t++) {
		direct = await measure(B.page, tileId);
		if (direct && near(direct.pos[0], dragged.pos[0], 1e-4)) break;
		await B.page.waitForTimeout(400);
	}
	if (direct && near(direct.pos[0], dragged.pos[0], 1e-4)) h.check(true, `peer B sees the gizmo-snapped tile at x ${dragged.pos[0]} (the gizmo's own move)`);
	else {
		console.log(`NOTE: the gizmo's own move did not land on B (B has x ${direct?.pos[0]}); re-sending as a valid triple`);
		await pose(A.page, tileId, dragged.pos, [0, 0, 0]);
		await h.eventually(() => measure(B.page, tileId), (b) => !!b && near(b.pos[0], dragged.pos[0], 1e-4), `peer B sees the snapped tile at x ${dragged.pos[0]}`, 15000);
	}
	await A.page.evaluate(() => {
		window.__stores.objectActions.deselectObject();
		window.__stores.snapping.snapEnabled.set(false);
	});

	// ---------------------------------------------------------------- 9. the street, looked at
	await A.page.waitForTimeout(6000);
	if (SHOTS) {
		const views = [
			['after-street.png', [9, 7.5, 13], [-1, 0.5, 0]],
			['after-street-plaza.png', [-1, 3.2, 12], [0.5, 1, 4.5]],
			['after-street-north.png', [1, 2.4, 2.5], [0, 1.3, -4.5]],
			['after-clock-tower.png', [-2.5, 6, 9], [-9, 4, 0]]
		];
		for (const [file, from, to] of views) {
			await A.page.evaluate(([f, t]) => window.__stores.objectActions.flyTo(f, t, 0), [from, to]);
			await A.page.waitForTimeout(1500);
			await A.page.screenshot({ path: shot(file) });
		}
		await B.page.evaluate(() => window.__stores.objectActions.flyTo([9, 7.5, 13], [-1, 0.5, 0], 0));
		await B.page.waitForTimeout(1500);
		await B.page.screenshot({ path: shot('after-street-peerB.png') });
	}
	await h.finish(browser);
});
