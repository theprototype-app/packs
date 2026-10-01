// judge: does a simplified level POP? Renders LOD0 and a candidate level with the same
// material, light and camera at the pixel size the level is SEEN at (where core switches to
// it), from four sides, and measures how many of the object's pixels change visibly.
// lod.mjs keeps the coarsest candidate the judge accepts.
//
// Headless three.js in Chromium, served from a fake origin by page.route (the same setup as
// tools/meshy/lib/thumb.js): no port, no network.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const req = createRequire(path.join(ROOT, 'tools/meshy/package.json'));
const pw = await import(pathToFileURL(req.resolve('playwright-core')).href);
const chromium = pw.chromium ?? pw.default.chromium;
const THREE_DIR = path.dirname(path.dirname(req.resolve('three')));
const ORIGIN = 'http://lod-judge.local';

const PAGE = `<!doctype html><html><body style="margin:0">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const gl = renderer.getContext();
async function shots(url, size, yaws, frame) {
	renderer.setSize(size, size, false);
	renderer.setPixelRatio(1);
	const scene = new THREE.Scene();
	scene.environment = env;
	renderer.setClearColor(0x000000, 0);
	const key = new THREE.DirectionalLight(0xffffff, 1.6);
	key.position.set(3, 6, 4);
	scene.add(key, new THREE.HemisphereLight(0xffffff, 0x6b5a48, 0.5));
	const obj = (await new GLTFLoader().loadAsync(url)).scene;
	scene.add(obj);
	const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
	const out = [];
	for (const yaw of yaws) {
		const a = THREE.MathUtils.degToRad(yaw);
		const dir = new THREE.Vector3(Math.sin(a), 0.45, Math.cos(a)).normalize();
		cam.position.copy(frame.c).addScaledVector(dir, frame.dist);
		cam.lookAt(frame.c);
		renderer.render(scene, cam);
		const px = new Uint8Array(size * size * 4);
		gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
		out.push(px);
	}
	obj.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); for (const m of [].concat(o.material)) { for (const k in m) if (m[k]?.isTexture) m[k].dispose(); m.dispose(); } } });
	return out;
}
window.compare = async (a, b, size, yaws, delta) => {
	// frame on LOD0's bounding sphere so both renders share one camera
	const ref = (await new GLTFLoader().loadAsync(a)).scene;
	const sphere = new THREE.Box3().setFromObject(ref).getBoundingSphere(new THREE.Sphere());
	const frame = { c: sphere.center, dist: Math.max(sphere.radius, 1e-3) / Math.sin(THREE.MathUtils.degToRad(15)) * 1.05 };
	const A = await shots(a, size, yaws, frame);
	const B = await shots(b, size, yaws, frame);
	let object = 0, pop = 0, sum = 0;
	for (let k = 0; k < A.length; k++) {
		const x = A[k], y = B[k];
		for (let i = 0; i < x.length; i += 4) {
			if (x[i + 3] < 8 && y[i + 3] < 8) continue;
			object++;
			// premultiplied by alpha so a silhouette change counts as much as a colour one
			const d = Math.abs(x[i] * x[i + 3] - y[i] * y[i + 3]) / 255 + Math.abs(x[i + 1] * x[i + 3] - y[i + 1] * y[i + 3]) / 255 + Math.abs(x[i + 2] * x[i + 3] - y[i + 2] * y[i + 3]) / 255 + Math.abs(x[i + 3] - y[i + 3]);
			sum += d;
			if (d > delta) pop++;
		}
	}
	return { object, pop: object ? pop / object : 0, mean: object ? sum / object : 0 };
};
// a shot of a LEVEL the way core draws it: the level's geometry with LOD0's materials,
// matched by node name (fallback: traverse order), framed on LOD0's sphere
window.shotAs = async (lod0, level, size, yaw) => {
	const ref = (await new GLTFLoader().loadAsync(lod0)).scene;
	const sphere = new THREE.Box3().setFromObject(ref).getBoundingSphere(new THREE.Sphere());
	const frame = { c: sphere.center, dist: Math.max(sphere.radius, 1e-3) / Math.sin(THREE.MathUtils.degToRad(15)) * 1.05 };
	let url = level;
	if (level !== lod0) {
		const mats = new Map();
		const order = [];
		ref.traverse((o) => { if (o.isMesh) { mats.set(o.name, o.material); order.push(o.material); } });
		const lv = (await new GLTFLoader().loadAsync(level)).scene;
		let k = 0;
		lv.traverse((o) => { if (o.isMesh) { o.material = mats.get(o.name) ?? order[k] ?? o.material; k++; } });
		window.__override = lv;
		url = null;
	}
	renderer.setSize(size, size, false);
	renderer.setPixelRatio(1);
	const scene = new THREE.Scene();
	scene.environment = env;
	scene.background = new THREE.Color(0xd8d4cc);
	const key = new THREE.DirectionalLight(0xffffff, 1.6);
	key.position.set(3, 6, 4);
	scene.add(key, new THREE.HemisphereLight(0xffffff, 0x6b5a48, 0.5));
	scene.add(url ? ref : window.__override);
	const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
	const a = THREE.MathUtils.degToRad(yaw);
	cam.position.copy(frame.c).addScaledVector(new THREE.Vector3(Math.sin(a), 0.45, Math.cos(a)).normalize(), frame.dist);
	cam.lookAt(frame.c);
	renderer.render(scene, cam);
	let tris = 0;
	(url ? ref : window.__override).traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
	return { png: renderer.domElement.toDataURL('image/png'), tris: Math.round(tris) };
};
window.ready = true;
</script></body></html>`;

const GPU_ARGS = ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-gpu', '--ignore-gpu-blocklist'];

/** where each level is first seen: its height on a 720 px viewport (see lod.mjs) */
export const SEEN_AT = [180, 72];
/** a pixel POPS when its RGB (+alpha) moves by more than this (sum over channels, 0..1020) */
export const POP_DELTA = 90;

export class Judge {
	async open() {
		this.browser = await chromium.launch({ args: GPU_ARGS });
		this.page = await this.browser.newPage();
		this.files = new Map();
		await this.page.route(`${ORIGIN}/**`, async (route) => {
			const p = new URL(route.request().url()).pathname;
			if (p === '/') return route.fulfill({ body: PAGE, contentType: 'text/html' });
			if (p.startsWith('/three/')) {
				const f = path.join(THREE_DIR, p.slice('/three/'.length));
				if (f.startsWith(THREE_DIR) && fs.existsSync(f)) return route.fulfill({ body: fs.readFileSync(f), contentType: 'text/javascript' });
			}
			if (this.files.has(p)) return route.fulfill({ body: this.files.get(p), contentType: 'model/gltf-binary' });
			return route.fulfill({ status: 404, body: 'not found' });
		});
		await this.page.goto(`${ORIGIN}/`);
		await this.page.waitForFunction(() => /** @type {any} */ (window).ready === true, null, { timeout: 30000 });
		this.n = 0;
		return this;
	}
	/**
	 * @param {Uint8Array} lod0 GLB bytes @param {Uint8Array} level GLB bytes (with LOD0's textures)
	 * @param {number} size px @returns {Promise<{pop: number, mean: number}>}
	 */
	async compare(lod0, level, size) {
		const a = `/m/${this.n++}.glb`;
		const b = `/m/${this.n++}.glb`;
		this.files.set(a, Buffer.from(lod0));
		this.files.set(b, Buffer.from(level));
		try {
			return await this.page.evaluate(([a, b, s, d]) => /** @type {any} */ (window).compare(a, b, s, [35, 125, 215, 305], d), [a, b, size, POP_DELTA]);
		} finally {
			this.files.delete(a);
			this.files.delete(b);
		}
	}
	/** `level` drawn as core draws it (LOD0's materials) at `size` px → {png (data URL), tris};
	 * pass the same bytes twice for LOD0 itself */
	async shotAs(lod0, level, size, yaw = 35) {
		const a = `/m/${this.n++}.glb`;
		const b = level === lod0 ? a : `/m/${this.n++}.glb`;
		this.files.set(a, Buffer.from(lod0));
		this.files.set(b, Buffer.from(level));
		try {
			return await this.page.evaluate(([a, b, s, y]) => /** @type {any} */ (window).shotAs(a, b, s, y), [a, b, size, yaw]);
		} finally {
			this.files.delete(a);
			this.files.delete(b);
		}
	}
	async close() {
		await this.browser?.close();
	}
}
