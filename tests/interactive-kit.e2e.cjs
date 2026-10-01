// E2E: the Interactive Kit in the real app, read the way production reads it
// (PACKS_BASE → index.json → interactive-kit/default.json → <Item>/glTF-Binary/<file>).
//
//   1. the pack lists in the Explorer's Packs section and opens with every item + thumbnail
//   2. CATALOGUE: every item places, is textured, within budget, at its built bbox, with its clips
//   3. STILL: placed and left alone for 2.5 s in Edit, no moving part moves (every node a clip
//      animates keeps its rest TRS / morph weights). On a 1.18 engine this is the `idle`-first
//      guard (1.18 autoplays animations[0]); COUNTERFACTUAL: the same door re-packed WITHOUT its
//      idle clip swings open by itself on the same engine.
//   4. INTERACT (anim-core engine, feature-detected: skipped with a note when core has no
//      behavior runtime, window.__stores.packBehavior): click the door → it opens with its sound; the walker capsule passes
//      the doorway only when open; peer B sees it open; back in Edit it stands closed; a oneshot
//      plays once; the ambient loop runs in Interact.
//   5. LODS: every `lods` file the row lists loads and keeps the item's node names + clips.
//   screenshots → $SHOTS (default ~/.code/lanes-30/after-33/33-anim-kit/)
//
//   node tools/architecture-kit/serve-pack.mjs 15274 <core>/certs &
//   (core) VITE_PACKS_BASE=https://theprototype.app:15274 npx vite dev --port 5274 --strictPort --host theprototype.app
//   e2e-slot -- env APP_URL=https://theprototype.app:5274/ CORE=<core worktree> node tests/interactive-kit.e2e.cjs
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const CORE = process.env.CORE || '/home/deck/.code/theprototype-app/theprototype-lane-33-ak-engine';
const h = require(path.join(CORE, 'tests/e2e/helpers.cjs'));
const REPO = path.resolve(__dirname, '..');
const PACK = 'interactive-kit';
const SHOTS = process.env.SHOTS || path.join(os.homedir(), '.code/lanes-30/after-33/33-anim-kit');
const PACKS_BASE = process.env.PACKS_BASE || 'https://theprototype.app:15274';
const list = JSON.parse(fs.readFileSync(path.join(REPO, PACK, 'default.json'), 'utf8'));
const report = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/interactive-kit/report.json'), 'utf8'));
const TRI_BUDGET = 8000; // props 1-8k, architecture pieces 1-6k (a gate wall is two pieces)
fs.mkdirSync(SHOTS, { recursive: true });

/** the moving nodes of an item: every node except the static Frame* ones */
const movers = (/** @type {string} */ name) => report[name].nodes.filter((/** @type {string} */ n) => !/^Frame/.test(n));
const near = (/** @type {number[]} */ a, /** @type {number[]} */ b, eps = 3e-3) => a.every((v, i) => Math.abs(v - b[i]) < eps);

const uuidsNow = (page) =>
	page.evaluate(() => {
		let g;
		window.__stores.objectsGroup.subscribe((x) => (g = x))();
		return g.children.map((c) => c.uuid);
	});

/** place a pack item (or any GLB url) the way a drop does, then move it with the editor's own `move` */
async function place(page, name, pos, url = null) {
	const before = new Set(await uuidsNow(page));
	await page.evaluate(
		async ({ n, url }) => {
			const s = window.__stores;
			let items;
			s.packs.openPackItems.subscribe((x) => (items = x))();
			const it = items.find((i) => i.name === n);
			await s.explorerDrop.dropExplorerItem({ url: url ?? it.glbUrl, name: n, kind: 'object' }, 400, 300);
		},
		{ n: name, url }
	);
	let uuid = null;
	for (let t = 0; t < 80 && !uuid; t++) {
		await page.waitForTimeout(250);
		uuid = (await uuidsNow(page)).find((u) => !before.has(u)) ?? null;
	}
	if (!uuid) throw new Error(`${name} never appeared`);
	await page.waitForTimeout(150);
	await page.evaluate(
		({ uuid, pos }) => {
			const s = window.__stores;
			let g;
			let p;
			s.objectsGroup.subscribe((x) => (g = x))();
			s.peers.subscribe((x) => (p = x))();
			const o = g.getObjectByProperty('uuid', uuid);
			o.position.set(pos[0], pos[1], pos[2]);
			o.updateMatrix();
			p?.send({ type: 'move', uuid, pos: o.position.toArray(), rot: [0, 0, 0], scale: o.scale.toArray() });
		},
		{ uuid, pos }
	);
	return uuid;
}

/** in-page: bbox, tris, textures, clips and every named node's local TRS (+ morph weights) */
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
			const box = new s.THREE.Box3().setFromObject(obj, true); // precise: the POSE, not the morph-inflated geometry box
			let tris = 0;
			let maps = 0;
			const nodes = {};
			obj.traverse((o) => {
				if (o.name && !nodes[o.name]) nodes[o.name] = { p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray(), w: o.morphTargetInfluences ? [...o.morphTargetInfluences] : null };
				if (!o.isMesh) return;
				if (o.morphTargetInfluences && nodes[o.parent?.name]) nodes[o.parent.name].w ??= [...o.morphTargetInfluences];
				tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
				for (const m of [].concat(o.material)) if (m?.map?.image) maps++;
			});
			out[id] = { min: box.min.toArray(), max: box.max.toArray(), tris: Math.round(tris), maps, nodes, clips: obj.userData.animatedClips ?? null, behavior: obj.userData.behavior ?? null };
		}
		return out;
	}, uuids);

/** did any moving node of `name` change between two measures */
function moved(name, a, b) {
	const out = [];
	for (const n of movers(name)) {
		const x = a.nodes[n];
		const y = b.nodes[n];
		if (!x || !y) {
			out.push(`${n} missing`);
			continue;
		}
		if (!near(x.p, y.p) || !near(x.q, y.q) || !near(x.s, y.s) || (x.w && y.w && !near(x.w, y.w))) out.push(n);
	}
	return out;
}

/** frame the camera on a point from a direction, for a screenshot */
const look = (page, target, from) =>
	page.evaluate(
		({ target, from }) => {
			const s = window.__stores;
			let cam;
			let oc;
			s.globalCamera?.subscribe((x) => (cam = x))();
			s.orbitControls?.subscribe((x) => (oc = x))();
			if (!cam) return;
			cam.position.set(target[0] + from[0], target[1] + from[1], target[2] + from[2]);
			cam.lookAt(target[0], target[1], target[2]);
			if (oc) {
				oc.target.set(target[0], target[1], target[2]);
				oc.update();
			}
		},
		{ target, from }
	);

/** a copy of a kit GLB with its `idle` clip removed (the counterfactual for STILL) */
async function withoutIdle(file, out) {
	const { pathToFileURL } = require('node:url');
	const { io } = await import(pathToFileURL(path.join(REPO, 'tools/anim/anim.mjs')).href);
	const doc = await io.read(file);
	doc.getRoot().listAnimations().find((a) => a.getName() === 'idle')?.dispose();
	await io.write(out, doc);
}

h.run(async () => {
	const browser = await h.launch();
	const A = await h.setupPage(browser, 'A');

	// ---------- 1. the pack lists and opens ----------
	await A.page.locator('#explorer-slot').click();
	await A.page.waitForTimeout(600);
	await A.page.locator('#packs-folder').dblclick();
	await A.page.waitForTimeout(800);
	const row = A.page.locator(`#explorer-list [data-pack="${PACK}"]`);
	h.check((await row.count()) === 1, 'the Interactive Kit lists in the Explorer Packs section');
	await A.page.screenshot({ path: path.join(SHOTS, 'explorer-packs.png') });
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
	h.check(thumbs === list.length, `every item's screenshot loads (${thumbs} / ${list.length})`);
	await A.page.screenshot({ path: path.join(SHOTS, 'explorer-items.png') });

	// ---------- 2. CATALOGUE ----------
	const placed = [];
	let x = -14;
	for (const it of list) {
		const r = report[it.name];
		const w = r.max[0] - r.min[0];
		const pos = [x - r.min[0], 0, -6];
		x += w + 1;
		placed.push({ name: it.name, uuid: await place(A.page, it.name, pos), pos });
	}
	await A.page.waitForTimeout(800);
	const m0 = await measure(A.page, placed.map((p) => p.uuid));
	for (const p of placed) {
		const r = report[p.name];
		const got = m0[p.uuid];
		const exp = { min: r.min.map((v, i) => v + p.pos[i]), max: r.max.map((v, i) => v + p.pos[i]) };
		h.check(
			got && near(got.min, exp.min, 0.02) && near(got.max, exp.max, 0.02) && got.maps > 0 && got.tris <= TRI_BUDGET,
			`${p.name}: placed at its built bbox, textured (${got?.maps} maps), ${got?.tris} tris${got ? "" : " (missing)"} ${got && !near(got.min, exp.min, 0.02) ? JSON.stringify([got.min, got.max]) : ""}`
		);
		h.check(movers(p.name).every((nm) => got?.nodes[nm]), `${p.name}: its moving parts arrive as named nodes (${movers(p.name).join(', ')})`);
	}

	// ---------- 3. STILL on placement (Edit) ----------
	await A.page.waitForTimeout(2500);
	const m1 = await measure(A.page, placed.map((p) => p.uuid));
	for (const p of placed) {
		const mv = moved(p.name, m0[p.uuid], m1[p.uuid]);
		h.check(mv.length === 0, `${p.name}: placed and left alone in Edit for 2.5 s, nothing moves${mv.length ? ` (moved: ${mv.join(', ')})` : ''}`);
	}
	await look(A.page, [-6, 1.2, -6], [0, 2.5, 9]);
	await A.page.waitForTimeout(500);
	await A.page.screenshot({ path: path.join(SHOTS, 'catalogue-placed-still.png') });

	// counterfactual: the door re-packed WITHOUT the idle clip, same engine
	const door = path.join(REPO, PACK, 'DoorWood/glTF-Binary/door-wood.glb');
	const noIdleRel = `${PACK}/DoorWood/glTF-Binary/door-wood.no-idle.glb`;
	await withoutIdle(door, path.join(REPO, noIdleRel));
	try {
		const cf = await place(A.page, 'DoorWood', [-10, 0, 4], `${PACKS_BASE}/${noIdleRel}`);
		await A.page.waitForTimeout(400);
		const c0 = await measure(A.page, [cf]);
		await A.page.waitForTimeout(1500);
		const c1 = await measure(A.page, [cf]);
		const swings = moved('DoorWood', c0[cf], c1[cf]).length > 0;
		const autoplays = await A.page.evaluate(() => typeof window.__stores.packBehavior === 'undefined');
		// on a 1.18 engine the leaf swings by itself; on anim-core's engine nothing autoplays at all
		h.check(autoplays ? swings : !swings, autoplays ? 'COUNTERFACTUAL (1.18 engine): the same door WITHOUT its idle clip swings open by itself' : 'anim-core engine: even without idle, the placed door stays still');
		await A.page.evaluate((u) => {
			let g;
			window.__stores.objectsGroup.subscribe((x) => (g = x))();
			g.getObjectByProperty('uuid', u)?.removeFromParent();
		}, cf);
	} finally {
		fs.rmSync(path.join(REPO, noIdleRel), { force: true });
	}

	// ---------- 4. INTERACT (anim-core) ----------
	const hasBehavior = await A.page.evaluate(() => !!window.__stores.packBehavior);
	if (!hasBehavior) console.log('NOTE: this engine has no behavior runtime (window.__stores.packBehavior) — section 4 skipped; run it against origin/feat/33-anim-core');
	else await require('./interactive-kit.behavior.cjs')({ h, A, browser, place, measure, moved, movers, look, placed, SHOTS, report, list });

	// ---------- 5. LODS ----------
	const { pathToFileURL } = require('node:url');
	const { io } = await import(pathToFileURL(path.join(REPO, 'tools/anim/anim.mjs')).href);
	let lodRows = 0;
	for (const it of list) {
		for (const l of it.lods ?? []) {
			lodRows++;
			const f = path.join(REPO, PACK, it.name, 'glTF-Binary', l.file);
			const ok = fs.existsSync(f);
			let same = false;
			if (ok) {
				const d = await io.read(f);
				const names = d.getRoot().listNodes().map((nd) => nd.getName());
				const clips = d.getRoot().listAnimations().map((a) => a.getName());
				same = report[it.name].nodes.every((nm) => names.includes(nm)) && report[it.name].clips.every((c) => clips.includes(c));
			}
			h.check(ok && same, `${it.name} ${l.file}: exists and keeps the item's nodes + clips`);
		}
	}
	if (!lodRows) console.log('NOTE: no item lists `lods` yet');
	await h.finish(browser);
});
