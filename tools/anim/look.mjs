// look: render animated GLBs at clip times with three.js's own GLTFLoader + AnimationMixer in
// headless Chromium. That proves the clips bind to the nodes the way the app will bind them, and
// that the hinge is where it should be. A labelled contact sheet comes out.
//
//   node tools/anim/look.mjs --sheet out.png [--yaw 35] [--size 320] a.glb:open@0,0.5,1 b.glb:loop@0,0.3 c.glb
//
// `file:clip@t1,t2` renders that clip at each time (seconds; `end` = its duration); a bare file
// renders the rest pose with NO mixer (what the app shows on placement). Each cell is labelled
// with the item, the clip and the time, plus `!` when a cell found a problem (a clip track that
// did not bind to a node).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { TOOLS } from './anim.mjs';

const req = createRequire(path.join(TOOLS, 'package.json'));
const pw = await import(pathToFileURL(req.resolve('playwright-core')).href);
const chromium = pw.chromium ?? pw.default.chromium;
const { contactSheet } = await import(pathToFileURL(path.join(TOOLS, 'lib/thumb.js')).href);
const THREE_DIR = path.join(TOOLS, 'node_modules/three');
const ORIGIN = 'http://anim-look.local';

const PAGE = `<!doctype html><html><body style="margin:0">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const cache = new Map();
window.render = async (url, clip, t, size, yaw, pitch, frame) => {
	renderer.setSize(size, size, false);
	const scene = new THREE.Scene();
	scene.environment = env;
	scene.background = new THREE.Color('#d8d4cc');
	const key = new THREE.DirectionalLight(0xffffff, 1.6);
	key.position.set(3, 6, 4);
	scene.add(key, new THREE.HemisphereLight(0xffffff, 0x6b5a48, 0.5));
	if (!cache.has(url)) cache.set(url, await new GLTFLoader().loadAsync(url));
	const gltf = cache.get(url);
	const obj = gltf.scene.clone(true);
	scene.add(obj);
	// frame on the REST pose so every time of one clip shares a camera
	const box = new THREE.Box3().setFromObject(obj);
	const problems = [];
	let duration = 0;
	if (clip) {
		const c = gltf.animations.find((a) => a.name === clip);
		if (!c) problems.push('no clip ' + clip);
		else {
			for (const tr of c.tracks) {
				const name = THREE.PropertyBinding.parseTrackName(tr.name).nodeName;
				if (!obj.getObjectByName(name)) problems.push('unbound ' + tr.name);
			}
			const mixer = new THREE.AnimationMixer(obj);
			const action = mixer.clipAction(c);
			action.setLoop(THREE.LoopOnce, 1);
			action.clampWhenFinished = true;
			action.play();
			duration = c.duration;
			mixer.setTime(t === 'end' ? c.duration : Math.min(+t, c.duration));
		}
	}
	const both = new THREE.Box3().setFromObject(obj).union(box);
	const sphere = (frame === 'pose' ? both : box).getBoundingSphere(new THREE.Sphere());
	const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
	const dist = Math.max(sphere.radius, 1e-3) / Math.sin(THREE.MathUtils.degToRad(15)) * 1.05;
	const a = THREE.MathUtils.degToRad(yaw);
	const dir = new THREE.Vector3(Math.sin(a), pitch, Math.cos(a)).normalize();
	cam.position.copy(sphere.center).addScaledVector(dir, dist);
	cam.lookAt(sphere.center);
	renderer.render(scene, cam);
	return { png: renderer.domElement.toDataURL('image/png'), problems, duration, clips: gltf.animations.map((a) => a.name) };
};
window.ready = true;
</script></body></html>`;

const GPU_ARGS = ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-gpu', '--ignore-gpu-blocklist'];

/**
 * @param {{glb: string, clip?: string, times?: (number|string)[], label?: string, out?: string}[]} items
 * @param {{sheet: string, size?: number, yaw?: number, pitch?: number, cols?: number, bg?: string}} o
 */
export async function look(items, o) {
	const browser = await chromium.launch({ args: GPU_ARGS });
	const tmp = fs.mkdtempSync(path.join(path.dirname(path.resolve(o.sheet)), '.look-'));
	const report = [];
	try {
		const page = await browser.newPage();
		const files = new Map(items.map((it, i) => [`/m/${i}.glb`, path.resolve(it.glb)]));
		await page.route(`${ORIGIN}/**`, async (/** @type {any} */ route) => {
			const p = new URL(route.request().url()).pathname;
			if (p === '/') return route.fulfill({ body: PAGE, contentType: 'text/html' });
			if (p.startsWith('/three/')) {
				const f = path.join(THREE_DIR, p.slice(7));
				if (fs.existsSync(f)) return route.fulfill({ body: fs.readFileSync(f), contentType: 'text/javascript' });
			}
			if (files.has(p)) return route.fulfill({ body: fs.readFileSync(/** @type {string} */ (files.get(p))), contentType: 'model/gltf-binary' });
			return route.fulfill({ status: 404, body: '' });
		});
		const errors = /** @type {string[]} */ ([]);
		page.on('pageerror', (/** @type {any} */ e) => errors.push(e.message));
		await page.goto(`${ORIGIN}/`);
		await page.waitForFunction(() => /** @type {any} */ (window).ready === true, null, { timeout: 30000 }).catch(() => {
			throw new Error('look page failed: ' + errors.join('; '));
		});
		const cells = [];
		for (const [i, it] of items.entries()) {
			for (const t of it.clip ? it.times ?? [0, 'end'] : [0]) {
				const r = await page.evaluate((/** @type {any[]} */ a) => /** @type {any} */ (window).render(...a), [`/m/${i}.glb`, it.clip ?? null, t, o.size ?? 320, o.yaw ?? 35, o.pitch ?? 0.45, 'pose']);
				const png = path.join(tmp, `${cells.length}.png`);
				fs.writeFileSync(png, Buffer.from(r.png.split(',')[1], 'base64'));
				if (it.out) {
					// a single-cell request with `out` doubles as the item's thumbnail
					const sharp = (await import(pathToFileURL(req.resolve('sharp')).href)).default;
					fs.mkdirSync(path.dirname(it.out), { recursive: true });
					await sharp(png).webp({ quality: 82 }).toFile(it.out);
				}
				const name = it.label ?? path.basename(it.glb, '.glb');
				cells.push({ png, label: `${r.problems.length ? '! ' : ''}${name}${it.clip ? ` ${it.clip}@${t}` : ''}` });
				report.push({ glb: it.glb, clip: it.clip ?? null, t, problems: r.problems, clips: r.clips, duration: r.duration });
			}
		}
		await contactSheet(cells, o.sheet, o.size ?? 320);
		return report;
	} finally {
		await browser.close();
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const args = process.argv.slice(2);
	const opt = (/** @type {string} */ k, /** @type {any} */ d) => (args.includes(k) ? args.splice(args.indexOf(k), 2)[1] : d);
	const sheet = opt('--sheet', 'look.png');
	const yaw = +opt('--yaw', 35);
	const size = +opt('--size', 320);
	const pitch = +opt('--pitch', 0.45);
	const items = args.map((a) => {
		const [glb, spec] = a.split(':');
		if (!spec) return { glb };
		const [clip, ts] = spec.split('@');
		return { glb, clip, times: ts ? ts.split(',').map((x) => (x === 'end' ? x : +x)) : undefined };
	});
	const report = await look(items, { sheet, yaw, size, pitch });
	for (const r of report) if (r.problems.length) console.log(JSON.stringify(r));
	console.log(sheet, report.length, 'cells,', report.filter((r) => r.problems.length).length, 'with problems');
}
