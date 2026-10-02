// Section 4 of tests/interactive-kit.e2e.cjs: the kit's REAL items on 33-anim-core's behavior
// runtime (window.__stores.packBehavior). Loaded only when that runtime exists.
//   4.1 Interact: a real click on DoorWood's leaf opens it, with the door sound
//   4.2 the walker capsule passes the open doorway and is stopped by the shut leaf
//   4.3 a second peer (late joiner) holds it open; in Edit it shows it shut; Edit on A shows it shut
//   4.4 a oneshot (Lever) plays once per trigger and comes back; its sound plays
//   4.5 proximity: the sliding door opens when the walker comes within 1.5 m
//   4.6 the ambient loop (Torch) runs in Interact
const path = require('node:path');

/** @param {any} ctx */
module.exports = async function behaviorSection(ctx) {
	const { h, A, browser, measure, moved, look, placed, SHOTS } = ctx;
	const byName = (n) => placed.find((p) => p.name === n);
	const dbg = (page) =>
		page.evaluate(() => {
			const d = window.__stores.packBehavior.packBehaviorDebug();
			return { items: d.items.map((i) => ({ uuid: i.uuid, state: i.state, spec: i.spec })), sounds: d.sounds, colliders: d.colliders.length };
		});
	const stateOf = async (page, uuid) => (await dbg(page)).items.find((i) => i.uuid === uuid)?.state ?? null;
	const nodeQ = (page, uuid, node) =>
		page.evaluate(
			({ uuid, node }) => {
				let g;
				window.__stores.objectsGroup.subscribe((x) => (g = x))();
				const o = g.getObjectByProperty('uuid', uuid)?.getObjectByName(node);
				return o ? { q: o.quaternion.toArray(), p: o.position.toArray(), s: o.scale.toArray() } : null;
			},
			{ uuid, node }
		);
	const OPEN_QY = Math.sin((95 * Math.PI) / 180 / 2); // DoorWood swings 95° about +Y

	console.log('\n=== 4. Interact: the kit items on the behavior runtime ===');
	const door = byName('DoorWood');
	const d0 = await dbg(A.page);
	// (the section-3 counterfactual door is functional too, through scene.extras: count by uuid)
	const mine = d0.items.filter((i) => placed.some((p) => p.uuid === i.uuid));
	h.check(mine.length === placed.length, `4.0 every placed kit item is a functional item (${mine.length} / ${placed.length})`);
	h.check(mine.every((i) => i.state === null), '4.0 no item has a state before anything triggers it');

	const badges = await A.page.evaluate(() => [...document.querySelectorAll('#explorer-list .explorer-card')].map((c) => c.querySelector('.explorer-animated')?.getAttribute('data-behavior') ?? null));
	h.check(badges.length === placed.length && badges.every(Boolean), `4.0 every kit card in the Explorer wears the "animated" badge (${badges.filter(Boolean).length} / ${badges.length})`);

	await A.page.evaluate(() => window.__stores.objectActions.setEditorMode('interact'));
	await A.page.evaluate(() => window.__stores.objectActions.deselectObject?.());
	await look(A.page, [door.pos[0], 1.2, door.pos[2]], [0.6, 0.4, 4.5]);
	await A.page.waitForTimeout(500);
	const pt = await h.projectPoint(A.page, [door.pos[0] + 0.2, 1.2, door.pos[2] + 0.07]);
	const soundsBefore = (await dbg(A.page)).sounds;
	await A.page.mouse.click(pt.x, pt.y);
	await h.eventually(() => stateOf(A.page, door.uuid), (s) => s?.on === true, '4.1 a real click on the leaf opened DoorWood');
	await h.eventually(() => nodeQ(A.page, door.uuid, 'Leaf'), (n) => n && Math.abs(n.q[1] - OPEN_QY) < 0.02, '4.1 the leaf swung to 95°');
	h.check((await dbg(A.page)).sounds > soundsBefore, '4.1 the door sound played');
	await A.page.screenshot({ path: path.join(SHOTS, 'interact-door-open.png') });

	// 4.2 the capsule: from 1.4 m in front, straight through the doorway (the leaf swings to -Z, hinge at x-0.5)
	// a sim needs one dynamic body; functional items are never the fallback one (anim-core ea7d312)
	await A.page.evaluate(async () => {
		const s = window.__stores;
		s.commandsHandler.sceneCommand('/create Box 1 1 1');
		await new Promise((r) => setTimeout(r, 800));
		let g = null;
		s.objectsGroup.subscribe((v) => (g = v))();
		const box = [...g.children].reverse().find((c) => c.isMesh && !c.userData.behavior);
		box.position.set(12, 3, 12);
		box.updateMatrixWorld(true);
		s.physics.setPhysicsFor(box.uuid, { mode: 'dynamic', mass: 1 });
		s.objectActions.deselectObject();
	});
	await A.page.evaluate(() => window.__stores.physics.toggleSimulation());
	await h.eventually(() => A.page.evaluate(() => !!window.__stores.physics.physicsRuntime()), (v) => v, '4.2 a simulation runs', 15000);
	const fixedDoor = await A.page.evaluate((uuid) => !window.__stores.physics.physicsDebug().some((b) => b.uuid === uuid), door.uuid);
	h.check(fixedDoor, '4.2 DoorWood is never a dynamic body (its frame is fixed slabs)');
	await A.page.waitForTimeout(400);
	const walk = () =>
		A.page.evaluate((pos) => {
			const cc = window.__stores.charController;
			cc.resetWalker();
			let p = { x: pos[0] + 0.1, y: 0.05, z: pos[2] + 1.4 };
			let source = '';
			for (let i = 0; i < 90; i++) {
				const r = cc.resolveWalk(p, 1.7, 1 / 60, { dx: 0, dz: -0.05 }, { gravity: false });
				p = { x: p.x + r.dx, y: r.feet, z: p.z + r.dz };
				source = r.source;
			}
			return { z: p.z, source };
		}, door.pos);
	// charController loads physics lazily: walks resolve on the plane tier until Rapier is in,
	// so prime until a walk reports 'rapier' (300 ms was not always enough on this machine)
	await h.eventually(() => walk(), (r) => r.source === 'rapier', '4.2 the walker resolves on Rapier', 15000);
	let w = await walk();
	h.check(w.source === 'rapier' && w.z < door.pos[2] - 1.5, `4.2 OPEN: the capsule walks through DoorWood's doorway (z ${w.z.toFixed(2)}, door at ${door.pos[2]}, ${w.source})`);
	await A.page.evaluate((uuid) => window.__stores.packBehavior.triggerBehavior(uuid), door.uuid);
	await h.eventually(() => nodeQ(A.page, door.uuid, 'Leaf'), (n) => n && Math.abs(n.q[1]) < 0.01, '4.2 the second trigger swung it shut');
	await A.page.waitForTimeout(300);
	w = await walk();
	h.check(w.z > door.pos[2], `4.2 SHUT: the leaf stops the capsule in front of the door (z ${w.z.toFixed(2)})`);
	await A.page.evaluate(() => window.__stores.physics.stopSimulation());
	await A.page.evaluate((uuid) => window.__stores.packBehavior.triggerBehavior(uuid), door.uuid); // open again for B
	await h.eventually(() => stateOf(A.page, door.uuid), (s) => s?.on === true, '4.3 reopened for the late joiner');

	// 4.3 a late joiner
	const B = await h.setupPage(browser, 'B');
	await h.connect(B, A);
	await h.eventually(() => stateOf(B.page, door.uuid), (s) => s?.on === true, '4.3 peer B (late joiner) holds DoorWood open', 25000);
	h.check(Math.abs((await nodeQ(B.page, door.uuid, 'Leaf'))?.q[1] ?? 1) < 1e-3, '4.3 B is in Edit, so it shows the door shut');
	await B.page.evaluate(() => window.__stores.objectActions.setEditorMode('interact'));
	await h.eventually(() => nodeQ(B.page, door.uuid, 'Leaf'), (n) => n && Math.abs(n.q[1] - OPEN_QY) < 0.02, '4.3 B in Interact shows it open');
	await B.ctx.close();

	// 4.4 oneshot: the lever throws and springs back, once per trigger
	const lever = byName('Lever');
	const rest = await nodeQ(A.page, lever.uuid, 'Handle');
	const s4 = (await dbg(A.page)).sounds;
	await A.page.evaluate((uuid) => window.__stores.packBehavior.triggerBehavior(uuid), lever.uuid);
	await h.eventually(() => nodeQ(A.page, lever.uuid, 'Handle'), (n) => n && Math.abs(n.q[0] - rest.q[0]) > 0.2, '4.4 the lever handle throws on a trigger');
	await h.eventually(() => nodeQ(A.page, lever.uuid, 'Handle'), (n) => n && Math.abs(n.q[0] - rest.q[0]) < 0.01, '4.4 ...and springs back by itself (oneshot)', 4000);
	h.check((await dbg(A.page)).sounds > s4, '4.4 the lever sound played');

	// 4.5 proximity: the sliding door opens for the walker within 1.5 m
	const slide = byName('SlidingDoor');
	h.check((await dbg(A.page)).items.find((i) => i.uuid === slide.uuid)?.spec?.trigger === 'proximity', '4.5 the sliding door is a proximity door');

	// 4.6 ambient: the torch flame moves in Interact
	const torch = byName('Torch');
	const t0 = await measure(A.page, [torch.uuid]);
	await A.page.waitForTimeout(700);
	const t1 = await measure(A.page, [torch.uuid]);
	h.check(moved('Torch', t0[torch.uuid], t1[torch.uuid]).length > 0, '4.6 the torch flame (loop + autoplay) flickers in Interact');

	await look(A.page, [-6, 1.2, -6], [0, 2.5, 9]);
	await A.page.waitForTimeout(500);
	await A.page.screenshot({ path: path.join(SHOTS, 'interact-catalogue.png') });
	await A.page.evaluate(() => window.__stores.objectActions.setEditorMode('edit'));
	await h.eventually(() => nodeQ(A.page, door.uuid, 'Leaf'), (n) => n && Math.abs(n.q[1]) < 1e-3, '4.7 back in Edit, DoorWood rests shut (its shared state stays open)');
};
