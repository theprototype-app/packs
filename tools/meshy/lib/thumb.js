// meshy-thumb: render GLBs with headless three.js (Playwright/Chromium) → 512² webp.
// The page is served from a fake origin by page.route (three from this package's
// node_modules, models from disk), so nothing listens on a port and nothing touches
// the network. Vulkan ANGLE like core's e2e helpers; a thumbnail does not need GPU
// accuracy, so a SwiftShader fallback is fine here.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const THREE_DIR = path.dirname(path.dirname(require.resolve('three'))); // …/node_modules/three
const ORIGIN = 'http://meshy-thumb.local';

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
const pmrem = new THREE.PMREMGenerator(renderer);
const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
window.renderGlb = async (url, size, bg, yaw) => {
	renderer.setSize(size, size, false);
	renderer.setPixelRatio(1);
	const scene = new THREE.Scene();
	scene.environment = env;
	if (bg) scene.background = new THREE.Color(bg);
	renderer.setClearColor(0x000000, bg ? 1 : 0);
	const key = new THREE.DirectionalLight(0xffffff, 1.6);
	key.position.set(3, 6, 4);
	scene.add(key, new THREE.HemisphereLight(0xffffff, 0x6b5a48, 0.5));
	const gltf = await new GLTFLoader().loadAsync(url);
	const obj = gltf.scene;
	scene.add(obj);
	const box = new THREE.Box3().setFromObject(obj);
	const sphere = box.getBoundingSphere(new THREE.Sphere());
	const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
	const r = Math.max(sphere.radius, 1e-3);
	const dist = r / Math.sin(THREE.MathUtils.degToRad(15)) * 1.08;
	const a = THREE.MathUtils.degToRad(yaw);
	const dir = new THREE.Vector3(Math.sin(a), 0.55, Math.cos(a)).normalize();
	cam.position.copy(sphere.center).addScaledVector(dir, dist);
	cam.lookAt(sphere.center);
	renderer.render(scene, cam);
	let tris = 0;
	obj.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
	const size3 = box.getSize(new THREE.Vector3());
	return { png: renderer.domElement.toDataURL('image/png'), tris, size: size3.toArray(), gl: renderer.getContext().getParameter(renderer.getContext().VERSION) };
};
window.ready = true;
</script></body></html>`;

const GPU_ARGS = ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-gpu', '--ignore-gpu-blocklist'];

/**
 * @param {{glb: string, out: string}[]} items
 * @param {{size?: number, bg?: string | null, yaw?: number}} [o]
 * @returns {Promise<{glb: string, out: string, tris: number, size: number[]}[]>}
 */
export async function renderThumbs(items, { size = 512, bg = null, yaw = 35 } = {}) {
	const browser = await chromium.launch({ args: GPU_ARGS });
	try {
		const page = await browser.newPage();
		const files = new Map(items.map((it, i) => [`/model/${i}.glb`, path.resolve(it.glb)]));
		await page.route(`${ORIGIN}/**`, async (route) => {
			const p = new URL(route.request().url()).pathname;
			if (p === '/' || p === '/index.html') return route.fulfill({ body: PAGE, contentType: 'text/html' });
			if (p.startsWith('/three/')) {
				const f = path.join(THREE_DIR, p.slice('/three/'.length));
				if (f.startsWith(THREE_DIR) && fs.existsSync(f)) return route.fulfill({ body: fs.readFileSync(f), contentType: 'text/javascript' });
			}
			if (files.has(p)) return route.fulfill({ body: fs.readFileSync(/** @type {string} */ (files.get(p))), contentType: 'model/gltf-binary' });
			return route.fulfill({ status: 404, body: 'not found' });
		});
		const errors = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await page.goto(`${ORIGIN}/`);
		await page.waitForFunction(() => /** @type {any} */ (window).ready === true, null, { timeout: 30_000 }).catch(() => {
			throw new Error(`thumb page failed: ${errors.join('; ')}`);
		});
		const out = [];
		for (let i = 0; i < items.length; i++) {
			const r = await page.evaluate(([u, s, b, y]) => /** @type {any} */ (window).renderGlb(u, s, b, y), [`/model/${i}.glb`, size, bg, yaw]);
			const png = Buffer.from(r.png.split(',')[1], 'base64');
			fs.mkdirSync(path.dirname(items[i].out), { recursive: true });
			const ext = path.extname(items[i].out).toLowerCase();
			const img = sharp(png);
			await (ext === '.png' ? img.png() : ext === '.jpg' || ext === '.jpeg' ? img.flatten({ background: bg ?? '#d8d4cc' }).jpeg({ quality: 85 }) : img.webp({ quality: 82 })).toFile(items[i].out);
			out.push({ glb: items[i].glb, out: items[i].out, tris: Math.round(r.tris), size: r.size.map((v) => +v.toFixed(3)) });
		}
		return out;
	} finally {
		await browser.close();
	}
}

/**
 * A labelled contact sheet so a lane can LOOK at a whole batch in one image.
 * @param {{png: string, label: string}[]} cells image paths + labels @param {string} out @param {number} [cell]
 */
export async function contactSheet(cells, out, cell = 256) {
	const cols = Math.min(4, cells.length);
	const rows = Math.ceil(cells.length / cols);
	const label = 22;
	const comps = [];
	for (let i = 0; i < cells.length; i++) {
		const x = (i % cols) * cell;
		const y = Math.floor(i / cols) * (cell + label);
		comps.push({ input: await sharp(cells[i].png).resize(cell, cell, { fit: 'contain', background: '#d8d4cc' }).toBuffer(), left: x, top: y });
		const text = cells[i].label.replace(/[<&>]/g, '').slice(0, 34);
		comps.push({
			input: Buffer.from(`<svg width="${cell}" height="${label}"><rect width="100%" height="100%" fill="#222"/><text x="6" y="16" font-family="sans-serif" font-size="13" fill="#eee">${text}</text></svg>`),
			left: x,
			top: y + cell
		});
	}
	await sharp({ create: { width: cols * cell, height: rows * (cell + label), channels: 4, background: '#d8d4cc' } })
		.composite(comps)
		.png()
		.toFile(out);
	return out;
}

