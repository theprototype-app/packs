// E2E: a meshy-post GLB loads in the real app — imported as a pack, placed from the
// Explorer, textured, at the size/pivot meshy-post gave it, and replicated to a peer.
// Runs against a core dev server with core's own e2e helpers:
//
//   flock -w 5400 /tmp/tp-e2e.lock env APP_URL=https://theprototype.app:5251/ \
//     CORE=/path/to/core-worktree GLB=/path/to/model.glb EXPECT_H=0.8 \
//     node tools/meshy/test/e2e-app-load.cjs > out.log 2>&1
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');

const CORE = process.env.CORE || '/home/deck/.code/theprototype-app/theprototype-lane-30c-engine';
const GLB = process.env.GLB;
const EXPECT_H = Number(process.env.EXPECT_H || 0);
const SHOT = process.env.SHOT; // optional screenshot path
if (!GLB || !fs.existsSync(GLB)) throw new Error('GLB=<post-processed model.glb> is required');
const h = require(path.join(CORE, 'tests/e2e/helpers.cjs'));
const { zipSync, strToU8 } = createRequire(path.join(CORE, 'package.json'))('fflate');

/** everything about the placed object, measured in the page */
const measure = (page, name) =>
	page.evaluate((n) => {
		const s = window.__stores;
		let g;
		s.objectsGroup.subscribe((x) => (g = x))();
		const obj = [...g.children].reverse().find((o) => (o.name || '').includes(n) || o.userData?.name?.includes?.(n)) ?? g.children[g.children.length - 1];
		if (!obj) return null;
		obj.updateMatrixWorld(true);
		const box = new s.THREE.Box3().setFromObject(obj);
		let tris = 0;
		let maps = 0;
		let mapW = 0;
		let meshes = 0;
		obj.traverse((o) => {
			if (!o.isMesh) return;
			meshes++;
			tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
			for (const m of [].concat(o.material)) {
				if (m?.map?.image) {
					maps++;
					mapW = Math.max(mapW, m.map.image.width ?? 0);
				}
			}
		});
		return { count: g.children.length, meshes, tris: Math.round(tris), maps, mapW, minY: box.min.y - obj.position.y, h: box.max.y - box.min.y };
	}, name);

h.run(async () => {
	const browser = await h.launch();
	const A = await h.setupPage(browser, 'A');
	const B = await h.setupPage(browser, 'B');
	await h.connect(B, A);

	const glb = fs.readFileSync(GLB);
	const zip = zipSync(
		{
			'manifest.json': strToU8(JSON.stringify({ id: 'meshy-e2e', name: 'Meshy E2E', license: 'CC0-1.0', items: [{ id: 'crate', name: 'MeshyCrate', file: 'assets/crate/model.glb' }] })),
			'assets/crate/model.glb': new Uint8Array(glb)
		},
		{ level: 6 }
	);
	await A.page.evaluate(async (arr) => {
		await window.__stores.packs.importPackZip(new File([new Uint8Array(arr)], 'meshy-e2e.zip'));
	}, Array.from(zip));
	await A.page.locator('#explorer-slot').click();
	await A.page.waitForTimeout(500);
	await A.page.locator('#packs-folder').dblclick();
	await A.page.waitForTimeout(300);
	h.check((await A.page.locator('#explorer-list [data-pack="meshy-e2e"]').count()) === 1, 'the pack with the meshy-post GLB lists in the Explorer');
	await A.page.locator('#explorer-list [data-pack="meshy-e2e"]').click();
	await A.page.waitForTimeout(400);

	const before = await A.page.evaluate(() => {
		let g;
		window.__stores.objectsGroup.subscribe((x) => (g = x))();
		return g.children.length;
	});
	const nItems = await A.page.evaluate(async () => {
		const s = window.__stores;
		let items;
		s.packs.openPackItems.subscribe((x) => (items = x))();
		await s.explorerDrop.dropExplorerItem({ id: items[0].id, kind: 'object', name: items[0].name }, 400, 300);
		return items.length;
	});
	h.check(nItems === 1, `the opened pack shows its one item (${nItems})`);
	let a = null;
	for (let t = 0; t < 40 && !(a && a.count === before + 1 && a.maps >= 1); t++) {
		await A.page.waitForTimeout(500);
		a = await measure(A.page, 'MeshyCrate');
	}
	console.log('A', JSON.stringify(a));
	h.check(a && a.count === before + 1, `placing the item adds one object (${before} → ${a?.count})`);
	h.check(a && a.meshes >= 1 && a.tris > 100, `it has real geometry (${a?.meshes} meshes, ${a?.tris} tris)`);
	h.check(a && a.maps >= 1 && a.mapW > 0 && a.mapW <= 2048, `it is textured, map ${a?.mapW}px (≤ 2048)`);
	h.check(a && Math.abs(a.minY) < 0.02, `bottom pivot: the model sits on its origin (minY offset ${a?.minY?.toFixed(3)})`);
	if (EXPECT_H) h.check(a && Math.abs(a.h - EXPECT_H) < 0.02, `real-world scale: height ${a?.h?.toFixed(3)} m ≈ ${EXPECT_H} m`);

	let b = null;
	await h.eventually(
		async () => (b = await measure(B.page, 'MeshyCrate')),
		(r) => !!r && r.count === a.count && r.maps >= 1 && r.tris === a.tris,
		'peer B receives it with the same geometry and a texture',
		20000
	);
	console.log('B', JSON.stringify(b));
	if (SHOT) await A.page.screenshot({ path: SHOT });
	await h.finish(browser);
});
