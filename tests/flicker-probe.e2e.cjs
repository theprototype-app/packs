// E2E: the FLICKER PROBE — does a pack object shimmer while the camera moves?
//
// The user: "Block in modular kit flickers … only when moving around scene". A still frame
// cannot show it, so this measures it the way the eye sees it: the REAL app renders frames
// while the camera walks a slow path, and a pixel FLICKERS when one frame disagrees with
// both of its neighbours while the neighbours agree with each other:
//
//     |F[k] - (F[k-1] + F[k+1]) / 2| > HI   and   |F[k-1] - F[k+1]| < LO
//
// Smooth motion (an edge sliding across a pixel, shading changing with the angle) moves
// monotonically, so its middle frame sits between the outer two and never counts. Z-fighting,
// LOD pops back and forth, a quality governor stepping up and down and shadow acne all
// produce exactly the toggle above. Each suspect can be switched off for the same path:
//
//   MODE=diagnose  the Block (+ snapped neighbours) scene: as shipped, then LOD off, quality
//                  governor off, shadows off, post off, single-sided materials, and the
//                  working-tree (fixed) meshes — the counts name the cause
//   MODE=scan      every item of PACKS (comma list, default all mesh packs) alone on the
//                  floor, orbited at walking distance; REF=before|after|both
//
// Pack files come straight from this checkout through a route on https://packs.invalid
// (the core dev server must run with VITE_PACKS_BASE=https://packs.invalid). A path under
// `@main/` serves the bytes of origin/main instead — the "before" in the same browser.
//
//   (core) VITE_PACKS_BASE=https://packs.invalid npx vite dev --port 5272 --strictPort --host
//   e2e-slot -- env APP_URL=https://theprototype.app:5272/ CORE=<core worktree> MODE=diagnose node tests/flicker-probe.e2e.cjs
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const CORE = process.env.CORE || '/home/deck/.code/theprototype-app/theprototype-lane-33-pl-engine';
const h = require(path.join(CORE, 'tests/e2e/helpers.cjs'));
const REPO = path.resolve(__dirname, '..');
const BASE = 'https://packs.invalid';
const MODE = process.env.MODE || 'diagnose';
const SHOTS = process.env.SHOTS || path.join(os.homedir(), '.code/lanes-30/after-33/33-pack-fix-lod');
const BEFORE_REV = process.env.BEFORE_REV || 'origin/main';
const STEPS = Number(process.env.STEPS || 48);
const OUT = process.env.OUT || path.join(SHOTS, `flicker-${MODE}.json`);
fs.mkdirSync(SHOTS, { recursive: true });

const TYPES = { '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const gitCache = new Map();
/** bytes of `rel` at the working tree, or at BEFORE_REV under `@main/` */
function packFile(rel) {
	if (rel.startsWith('@main/')) {
		const p = rel.slice('@main/'.length);
		if (!gitCache.has(p)) {
			try {
				gitCache.set(p, execFileSync('git', ['-C', REPO, 'show', `${BEFORE_REV}:${p}`], { maxBuffer: 64 << 20 }));
			} catch {
				gitCache.set(p, null);
			}
		}
		return gitCache.get(p);
	}
	const file = path.join(REPO, path.normalize(rel));
	if (!file.startsWith(REPO) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
	return fs.readFileSync(file);
}

async function servePacks(ctx) {
	await ctx.route(`${BASE}/**`, (route) => {
		const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//, '');
		const body = packFile(rel);
		if (!body) return route.fulfill({ status: 404, body: 'not found', headers: { 'Access-Control-Allow-Origin': '*' } });
		return route.fulfill({ status: 200, body, headers: { 'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' } });
	});
}

/** the model-list rows of a pack */
const packList = (pack) => JSON.parse(fs.readFileSync(path.join(REPO, pack, 'default.json'), 'utf8'));
const glbUrl = (pack, row, ref) => `${BASE}/${ref === 'before' ? '@main/' : ''}${pack}/${row.name}/glTF-Binary/${row.variants['glTF-Binary']}`;

const uuidsNow = (page) =>
	page.evaluate(() => {
		let g;
		window.__stores.objectsGroup.subscribe((x) => (g = x))();
		return g.children.map((c) => c.uuid);
	});

/** drop a GLB the way the Explorer does, then place it with the editor's `move` */
async function place(page, url, name, pos, rotY = 0) {
	const before = new Set(await uuidsNow(page));
	await page.evaluate(({ url, name }) => window.__stores.explorerDrop.dropExplorerItem({ url, name, kind: 'object' }, 400, 300), { url, name });
	let uuid = null;
	for (let t = 0; t < 80 && !uuid; t++) {
		await page.waitForTimeout(150);
		uuid = (await uuidsNow(page)).find((u) => !before.has(u)) ?? null;
	}
	if (!uuid) throw new Error(`${name} never appeared`);
	await page.evaluate(
		({ uuid, pos, rot }) => {
			const s = window.__stores;
			let g;
			s.objectsGroup.subscribe((x) => (g = x))();
			const o = g.getObjectByProperty('uuid', uuid);
			o.position.set(pos[0], pos[1], pos[2]);
			o.rotation.set(0, rot, 0);
			o.updateMatrix();
			o.updateMatrixWorld(true);
		},
		{ uuid, pos, rot: (rotY * Math.PI) / 180 }
	);
	return uuid;
}

async function clearScene(page) {
	await page.evaluate(() => {
		const s = window.__stores;
		let g;
		s.objectsGroup.subscribe((x) => (g = x))();
		for (const c of [...g.children]) {
			c.removeFromParent();
			c.traverse((n) => n.geometry?.dispose?.());
		}
		s.objectActions.deselectObject?.();
	});
}

/** the suspects, each one switchable for the same path */
const setSuspects = (page, sw) =>
	page.evaluate((sw) => {
		const s = window.__stores;
		let renderer;
		let scene;
		s.globalRenderer.subscribe((x) => (renderer = x))();
		s.globalScene.subscribe((x) => (scene = x))();
		s.lod.lodEnabled.set(!sw.noLod);
		s.qualityGovernor.setAutoQuality(!sw.noGovernor);
		s.viewportOverrides.setRenderLayer('post', !sw.noPost);
		scene.traverse((n) => {
			if (n.isLight && n.shadow) {
				n.userData.__probeCast ??= n.castShadow;
				n.castShadow = sw.noShadows ? false : n.userData.__probeCast;
			}
			if (n.isMesh) {
				for (const m of [].concat(n.material)) {
					if (!m) continue;
					m.userData.__probeSide ??= m.side;
					const side = sw.frontOnly ? s.THREE.FrontSide : m.userData.__probeSide;
					if (m.side !== side) {
						m.side = side;
						m.needsUpdate = true;
					}
				}
			}
		});
		renderer.shadowMap.needsUpdate = true;
		return { lod: !sw.noLod, governor: !sw.noGovernor, post: !sw.noPost, shadows: !sw.noShadows, frontOnly: !!sw.frontOnly };
	}, sw);

/**
 * In-page: walk the camera along `path`, a list of POSES each given as a micro-TRIPLET
 * ([eye, target] × 3, the camera nudged by a third of a pixel either side — the smallest
 * real head motion). Smooth motion is linear across a triplet; anything that toggles is
 * not. Captures the frames the app renders, counts flicker pixels per pose, and returns
 * the governor / LOD activity seen along the way + a heat-map PNG (data URL).
 */
const walk = (page, path, opts = {}) =>
	page.evaluate(
		async ({ path, hi, lo, heat }) => {
			const s = window.__stores;
			let renderer;
			let cam;
			let oc;
			s.globalRenderer.subscribe((x) => (renderer = x))();
			s.globalCamera.subscribe((x) => (cam = x))();
			s.orbitControls.subscribe((x) => (oc = x))();
			const src = renderer.domElement;
			const W = src.width;
			const H = src.height;
			const c2 = document.createElement('canvas');
			c2.width = W;
			c2.height = H;
			const ctx = c2.getContext('2d', { willReadFrequently: true });
			const raf = () => new Promise((r) => requestAnimationFrame(r));
			const mask = new Uint16Array(W * H);
			const counts = [];
			const quality = [];
			const lodLevels = [];
			const levelOf = () => {
				let q = null;
				s.qualityGovernor.qualityState.subscribe((x) => (q = x))();
				return q?.level ?? null;
			};
			const shoot = async ([eye, target]) => {
				cam.position.set(eye[0], eye[1], eye[2]);
				oc.target.set(target[0], target[1], target[2]);
				oc.update();
				// the next frame's app callback renders the moved camera; ours runs after it
				// in the same frame, while the drawing buffer still holds that render
				await raf();
				await raf();
				ctx.drawImage(src, 0, 0);
				return ctx.getImageData(0, 0, W, H).data;
			};
			let last = null;
			for (const triplet of path) {
				// settle on the pose first (a LOD / governor change from the big step lands now)
				await shoot(triplet[0]);
				const a = await shoot(triplet[0]);
				const b = await shoot(triplet[1]);
				const c = await shoot(triplet[2]);
				quality.push(levelOf());
				lodLevels.push((s.lod.lodStats?.().meshes ?? []).map((m) => m.current).join(''));
				let n = 0;
				for (let i = 0, p = 0; i < b.length; i += 4, p++) {
					const ac = Math.abs(a[i] - c[i]) + Math.abs(a[i + 1] - c[i + 1]) + Math.abs(a[i + 2] - c[i + 2]);
					if (ac >= lo) continue;
					const mid =
						Math.abs(2 * b[i] - a[i] - c[i]) + Math.abs(2 * b[i + 1] - a[i + 1] - c[i + 1]) + Math.abs(2 * b[i + 2] - a[i + 2] - c[i + 2]);
					if (mid > 2 * hi) {
						n++;
						mask[p]++;
					}
				}
				counts.push(n);
				last = b;
			}
			let png = null;
			if (heat && last) {
				// the last pose, darkened, with every pixel that ever flickered painted red
				const img = new ImageData(new Uint8ClampedArray(last), W, H);
				for (let p = 0; p < W * H; p++) {
					const i = p * 4;
					if (mask[p]) {
						img.data[i] = 255;
						img.data[i + 1] = 0;
						img.data[i + 2] = 0;
					} else {
						img.data[i] *= 0.6;
						img.data[i + 1] *= 0.6;
						img.data[i + 2] *= 0.6;
					}
				}
				ctx.putImageData(img, 0, 0);
				png = c2.toDataURL('image/png');
			}
			let pixels = 0;
			for (let p = 0; p < W * H; p++) if (mask[p]) pixels++;
			return { counts, total: counts.reduce((x, y) => x + y, 0), pixels, quality, lodLevels, png, size: [W, H] };
		},
		{ path, hi: opts.hi ?? 40, lo: opts.lo ?? 24, heat: !!opts.heat }
	);

/** the micro-step: 0.02° of orbit ≈ a third of a pixel at 1280×720, fov 40 */
const MICRO = Number(process.env.MICRO_DEG ?? 0.02);

/** a walking orbit: eye at `height`, `radius` from `centre`, `deg` degrees of arc in `steps`
 * poses, each a micro-triplet */
function orbit(centre, radius, height, startDeg, deg, steps = STEPS) {
	const at = (d) => {
		const a = (d * Math.PI) / 180;
		return [[centre[0] + Math.sin(a) * radius, height, centre[2] + Math.cos(a) * radius], centre];
	};
	const out = [];
	for (let k = 0; k < steps; k++) {
		const d = startDeg + (deg * k) / Math.max(1, steps - 1);
		out.push([at(d - MICRO), at(d), at(d + MICRO)]);
	}
	return out;
}
/** walking toward `centre` from `far` to `near` metres and back (distances change, so a LOD
 * edge is crossed both ways); each pose is a micro-triplet sideways */
function dolly(centre, dir, far, near, height, steps = STEPS) {
	const out = [];
	const base = (Math.atan2(dir[0], dir[1]) * 180) / Math.PI;
	for (let k = 0; k < steps; k++) {
		const t = k / Math.max(1, steps - 1);
		const d = far + (near - far) * (t < 0.5 ? t * 2 : 2 - t * 2);
		out.push(orbit(centre, d, height, base, 0, 1)[0]);
	}
	return out;
}

function savePng(dataUrl, file) {
	if (!dataUrl) return;
	fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

async function newPeer(browser) {
	const A = await h.setupPage(browser, 'A');
	await servePacks(A.ctx);
	await h.freshReload(A);
	await A.page.waitForTimeout(2500);
	// the probe looks at pack meshes: editor chrome inside the canvas stays out of it
	await A.page.evaluate(() => {
		const s = window.__stores;
		s.objectActions.deselectObject?.();
	});
	return A;
}

const BLOCK_SCENE = (ref) => {
	const arch = packList('architecture-kit');
	const row = (n) => arch.find((r) => r.name === n);
	const u = (n) => glbUrl('architecture-kit', row(n), ref);
	// the Block alone in front, two snapped neighbours (side by side, stacked), a Block
	// standing on a floor tile, and a wall behind — every coplanar contact the kit allows
	return [
		['Block', u('Block'), [1, 0, 1]],
		['Block', u('Block'), [3, 0, 1]],
		['Block', u('Block'), [3, 1, 1]],
		['FloorStone', u('FloorStone'), [1, 0, -1]],
		['Block', u('Block'), [1, 0.1, -1]],
		['WallStone', u('WallStone'), [2, 0, -2.125]]
	];
};

async function diagnose(browser) {
	const A = await newPeer(browser);
	const report = { mode: 'diagnose', steps: STEPS, runs: [] };
	const paths = {
		orbit: orbit([2, 0.5, 0], 5, 1.7, -60, 50),
		dolly: dolly([2, 0.5, 0], [0.35, 0.94], 26, 3, 1.7),
		grazing: orbit([2, 0.5, 0], 9, 0.6, 20, 30)
	};
	for (const ref of ['before', 'after']) {
		await clearScene(A.page);
		for (const [name, url, pos] of BLOCK_SCENE(ref)) await place(A.page, url, name, pos);
		await A.page.waitForTimeout(1500);
		const configs = [
			['as shipped', {}],
			['LOD off', { noLod: true }],
			['governor off', { noGovernor: true }],
			['shadows off', { noShadows: true }],
			['post off', { noPost: true }],
			['all core suspects off', { noLod: true, noGovernor: true, noShadows: true, noPost: true }],
			['single-sided materials', { frontOnly: true }]
		];
		for (const [label, sw] of ref === 'before' ? configs : configs.slice(0, 1).concat([configs[5]])) {
			await setSuspects(A.page, sw);
			await A.page.waitForTimeout(600);
			for (const [pname, p] of Object.entries(paths)) {
				const r = await walk(A.page, p, { heat: pname === 'orbit' && (label === 'as shipped' || label === 'all core suspects off') });
				const file = r.png ? path.join(SHOTS, `flicker-${ref}-${label.replace(/\W+/g, '-')}-${pname}.png`) : null;
				if (file) savePng(r.png, file);
				const qs = [...new Set(r.quality)];
				const lods = [...new Set(r.lodLevels)];
				console.log(`${ref.padEnd(6)} ${label.padEnd(24)} ${pname.padEnd(8)} flicker px ${String(r.total).padStart(7)} (distinct ${r.pixels}) quality levels ${JSON.stringify(qs)} lod levels ${JSON.stringify(lods)}`);
				report.runs.push({ ref, label, path: pname, total: r.total, pixels: r.pixels, counts: r.counts, quality: qs, lods, heat: file });
			}
		}
		await setSuspects(A.page, {});
	}
	fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
	const get = (ref, label, p) => report.runs.find((r) => r.ref === ref && r.label === label && r.path === p)?.total ?? -1;
	const shipped = get('before', 'as shipped', 'orbit') + get('before', 'as shipped', 'grazing');
	const coreOff = get('before', 'all core suspects off', 'orbit') + get('before', 'all core suspects off', 'grazing');
	const fixed = get('after', 'as shipped', 'orbit') + get('after', 'as shipped', 'grazing') + get('after', 'as shipped', 'dolly');
	h.check(shipped > 0, `RED: the shipped Block scene flickers while the camera moves (${shipped} px)`);
	h.check(coreOff > shipped * 0.5, `the cause is NOT core: with LOD, governor, shadows and post all off it still flickers (${coreOff} px)`);
	h.check(fixed <= Math.max(20, shipped * 0.02), `GREEN: the fixed meshes do not flicker on the same paths (${fixed} px)`);
	await h.finish(browser);
}

async function scan(browser) {
	const PACKS = (process.env.PACKS || 'architecture-kit,nature-kit,props-kit,scifi-kit,default,cube_diorama').split(',').filter(Boolean);
	const REFS = process.env.REF === 'both' || !process.env.REF ? ['before', 'after'] : [process.env.REF];
	const LIMIT = Number(process.env.FLICKER_LIMIT || 20);
	const A = await newPeer(browser);
	const report = { mode: 'scan', steps: STEPS, limit: LIMIT, items: [] };
	if (fs.existsSync(OUT) && process.env.APPEND) Object.assign(report, JSON.parse(fs.readFileSync(OUT, 'utf8')));
	await setSuspects(A.page, { noGovernor: true });
	for (const pack of PACKS) {
		for (const row of packList(pack)) {
			for (const ref of REFS) {
				await clearScene(A.page);
				let uuid;
				try {
					uuid = await place(A.page, glbUrl(pack, row, ref), row.name, [0, 0, 0]);
				} catch (e) {
					console.log(`skip ${pack}/${row.name} ${ref}: ${e.message}`);
					continue;
				}
				// frame it: the walking distance is 2.5 bounding radii (≥ 2 m)
				const box = await A.page.evaluate((u) => {
					const s = window.__stores;
					let g;
					s.objectsGroup.subscribe((x) => (g = x))();
					const o = g.getObjectByProperty('uuid', u);
					const b = new s.THREE.Box3().setFromObject(o);
					const c = b.getCenter(new s.THREE.Vector3());
					const r = b.getSize(new s.THREE.Vector3()).length() / 2;
					return { c: c.toArray(), r };
				}, uuid);
				await A.page.waitForTimeout(400);
				const R = Math.max(2, box.r * 2.5);
				const p1 = orbit(box.c, R, box.c[1] + R * 0.35, 25, 40);
				const p2 = orbit(box.c, R * 1.8, box.c[1] + R * 0.1, 200, 25);
				const r1 = await walk(A.page, p1, { heat: true });
				const r2 = await walk(A.page, p2);
				const total = r1.total + r2.total;
				const flag = total > LIMIT ? 'FLICKER' : 'ok     ';
				if (total > LIMIT) savePng(r1.png, path.join(SHOTS, `scan-${ref}-${pack}-${row.name}.png`));
				console.log(`${flag} ${ref.padEnd(6)} ${pack}/${row.name} ${total} px`);
				report.items.push({ pack, name: row.name, ref, total, near: r1.total, far: r2.total });
			}
		}
	}
	fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
	const after = report.items.filter((i) => i.ref === 'after');
	if (after.length) {
		const bad = after.filter((i) => i.total > LIMIT);
		h.check(bad.length === 0, `GREEN: no pack item flickers on the walking paths (${after.length - bad.length}/${after.length}; over: ${bad.map((b) => `${b.pack}/${b.name} ${b.total}`).join(', ') || 'none'})`);
	}
	const before = report.items.filter((i) => i.ref === 'before' && i.total > LIMIT);
	if (REFS.includes('before')) console.log(`before: ${before.length} items flicker: ${before.map((b) => `${b.pack}/${b.name} ${b.total}`).join(', ')}`);
	await h.finish(browser);
}

h.run(async () => {
	const browser = await h.launch({ args: h.GPU_ARGS });
	if (MODE === 'scan') return scan(browser);
	return diagnose(browser);
});
