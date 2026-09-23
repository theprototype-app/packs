#!/usr/bin/env node
// render.mjs — headless three.js renders for the nature kit (LOOK sheets, item screenshots, the cover).
// Uses the meshy tool's node_modules (three, playwright-core, sharp): set MESHY_TOOL or keep the default.
//
//   node render.mjs look  out.png a.glb b.glb …              clay (grey, lit) contact sheet, 2 angles each
//   node render.mjs thumb in.glb out.png [--size 512]         textured item screenshot (transparent-free, warm bg)
//   node render.mjs scene scene.json out.png [--size 1024]    a composed scene: {items:[{glb,pos:[x,y,z],rotY,scale}], cam:{pos,target}, ground:true}
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const TOOL = process.env.MESHY_TOOL || '/home/deck/.code/theprototype-app/packs-lane-30c-tools/tools/meshy';
const require = createRequire(path.join(TOOL, 'package.json'));
const { chromium } = require('playwright-core');
const sharp = require('sharp');
const THREE_DIR = path.dirname(path.dirname(require.resolve('three')));
const ORIGIN = 'http://nature-render.local';

const PAGE = `<!doctype html><html><body style="margin:0">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const pmrem = new THREE.PMREMGenerator(renderer);
const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const loader = new GLTFLoader();
const clay = new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.85 });
function lights(scene, span) {
	const key = new THREE.DirectionalLight(0xfff1dd, 2.2);
	key.position.set(span * 0.6, span * 1.2, span * 0.8);
	key.castShadow = true;
	key.shadow.mapSize.set(2048, 2048);
	const c = key.shadow.camera; c.left = c.bottom = -span; c.right = c.top = span; c.near = 0.1; c.far = span * 5;
	key.shadow.bias = -0.0005;
	scene.add(key, new THREE.HemisphereLight(0xcfe3ff, 0x5b4a38, 0.7));
}
function frame(obj, yaw, pitch = 0.45, fov = 30, pad = 1.08) {
	const box = new THREE.Box3().setFromObject(obj);
	const sphere = box.getBoundingSphere(new THREE.Sphere());
	const cam = new THREE.PerspectiveCamera(fov, 1, 0.01, 2000);
	const r = Math.max(sphere.radius, 1e-3);
	const dist = (r / Math.sin(THREE.MathUtils.degToRad(fov / 2))) * pad;
	const a = THREE.MathUtils.degToRad(yaw);
	const dir = new THREE.Vector3(Math.sin(a), pitch, Math.cos(a)).normalize();
	cam.position.copy(sphere.center).addScaledVector(dir, dist);
	cam.lookAt(sphere.center);
	return { cam, box };
}
function stats(obj) {
	let tris = 0;
	obj.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
	return Math.round(tris);
}
window.renderOne = async (url, size, bg, yaw, mode) => {
	renderer.setSize(size, size, false);
	renderer.setPixelRatio(1);
	const scene = new THREE.Scene();
	scene.environment = env;
	scene.environmentIntensity = 0.6;
	scene.background = new THREE.Color(bg);
	const gltf = await loader.loadAsync(url);
	const obj = gltf.scene;
	obj.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; if (mode === 'clay') o.material = clay; } });
	scene.add(obj);
	const { cam, box } = frame(obj, yaw);
	const span = box.getSize(new THREE.Vector3()).length();
	lights(scene, span);
	const ground = new THREE.Mesh(new THREE.CircleGeometry(span * 3, 48), new THREE.ShadowMaterial({ opacity: 0.25 }));
	ground.rotation.x = -Math.PI / 2; ground.position.y = box.min.y; ground.receiveShadow = true;
	scene.add(ground);
	renderer.render(scene, cam);
	return { png: renderer.domElement.toDataURL('image/png'), tris: stats(obj), size: box.getSize(new THREE.Vector3()).toArray() };
};
window.renderScene = async (spec, size, urls) => {
	renderer.setSize(size[0], size[1], false);
	renderer.setPixelRatio(1);
	const scene = new THREE.Scene();
	scene.environment = env;
	scene.environmentIntensity = 0.55;
	scene.background = new THREE.Color(spec.bg || '#a9c4d8');
	scene.fog = spec.fog ? new THREE.Fog(spec.bg || '#a9c4d8', spec.fog[0], spec.fog[1]) : null;
	const cache = new Map();
	let tris = 0;
	for (let i = 0; i < spec.items.length; i++) {
		const it = spec.items[i];
		if (!cache.has(urls[i])) cache.set(urls[i], (await loader.loadAsync(urls[i])).scene);
		const o = cache.get(urls[i]).clone(true);
		o.position.fromArray(it.pos || [0, 0, 0]);
		o.rotation.y = THREE.MathUtils.degToRad(it.rotY || 0);
		if (it.scale) o.scale.setScalar(it.scale);
		o.traverse((m) => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; } });
		tris += stats(o);
		scene.add(o);
	}
	const span = spec.span || 30;
	const key = new THREE.DirectionalLight(0xfff0d8, 2.4);
	key.position.set(span * 0.5, span, span * 0.35);
	key.castShadow = true;
	key.shadow.mapSize.set(4096, 4096);
	const c = key.shadow.camera; c.left = c.bottom = -span; c.right = c.top = span; c.near = 0.1; c.far = span * 4;
	key.shadow.bias = -0.0004;
	scene.add(key, new THREE.HemisphereLight(0xcfe3ff, 0x5b4a38, 0.8));
	if (spec.ground) {
		const g = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: spec.ground === true ? 0x6f7f45 : spec.ground, roughness: 1 }));
		g.rotation.x = -Math.PI / 2; g.receiveShadow = true; g.position.y = -0.005;
		scene.add(g);
	}
	const cam = new THREE.PerspectiveCamera(spec.cam.fov || 40, size[0] / size[1], 0.05, 2000);
	cam.position.fromArray(spec.cam.pos);
	cam.lookAt(new THREE.Vector3().fromArray(spec.cam.target));
	renderer.render(scene, cam);
	return { png: renderer.domElement.toDataURL('image/png'), tris };
};
window.ready = true;
</script></body></html>`;

const GPU_ARGS = ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-gpu', '--ignore-gpu-blocklist'];

async function withPage(files, fn) {
	const browser = await chromium.launch({ args: GPU_ARGS });
	try {
		const page = await browser.newPage();
		await page.route(`${ORIGIN}/**`, async (route) => {
			const p = decodeURIComponent(new URL(route.request().url()).pathname);
			if (p === '/') return route.fulfill({ body: PAGE, contentType: 'text/html' });
			if (p.startsWith('/three/')) {
				const f = path.join(THREE_DIR, p.slice(7));
				if (f.startsWith(THREE_DIR) && fs.existsSync(f)) return route.fulfill({ body: fs.readFileSync(f), contentType: 'text/javascript' });
			}
			if (files.has(p)) return route.fulfill({ body: fs.readFileSync(files.get(p)), contentType: 'model/gltf-binary' });
			return route.fulfill({ status: 404, body: 'nf' });
		});
		const errors = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await page.goto(`${ORIGIN}/`);
		await page.waitForFunction(() => window.ready === true, null, { timeout: 30000 }).catch(() => {
			throw new Error('render page failed: ' + errors.join('; '));
		});
		return await fn(page);
	} finally {
		await browser.close();
	}
}
const png = (d) => Buffer.from(d.split(',')[1], 'base64');
const opt = (args, k, d) => {
	const i = args.indexOf(k);
	return i >= 0 ? args.splice(i, 2)[1] : d;
};

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'look') {
	const [out, ...glbs] = rest;
	const files = new Map(glbs.map((g, i) => [`/m/${i}.glb`, path.resolve(g)]));
	const cell = 320;
	const cells = await withPage(files, async (page) => {
		const r = [];
		for (let i = 0; i < glbs.length; i++) {
			const a = await page.evaluate((x) => window.renderOne(...x), [`/m/${i}.glb`, cell, '#5d6770', 35, 'clay']);
			const b = await page.evaluate((x) => window.renderOne(...x), [`/m/${i}.glb`, cell, '#5d6770', 215, 'clay']);
			r.push({ a: png(a.png), b: png(b.png), label: `${glbs[i].split('/').slice(-3, -1).join('/')} ${a.tris}t ${a.size.map((v) => v.toFixed(1)).join('×')}` });
		}
		return r;
	});
	const cols = Math.min(3, cells.length), W = cell * 2, L = 22, rows = Math.ceil(cells.length / cols);
	const comps = [];
	cells.forEach((c, i) => {
		const x = (i % cols) * W, y = Math.floor(i / cols) * (cell + L);
		comps.push({ input: c.a, left: x, top: y }, { input: c.b, left: x + cell, top: y });
		comps.push({ input: Buffer.from(`<svg width="${W}" height="${L}"><rect width="100%" height="100%" fill="#222"/><text x="6" y="16" font-family="sans-serif" font-size="13" fill="#eee">${c.label.replace(/[<&>]/g, '')}</text></svg>`), left: x, top: y + cell });
	});
	await sharp({ create: { width: cols * W, height: rows * (cell + L), channels: 3, background: '#333' } }).composite(comps).png().toFile(out);
	console.log(out);
} else if (cmd === 'thumb') {
	const size = Number(opt(rest, '--size', 512));
	const yaw = Number(opt(rest, '--yaw', 35));
	const bg = opt(rest, '--bg', '#d9d3c5');
	const mode = opt(rest, '--mode', 'tex');
	const [glb, out] = rest;
	const r = await withPage(new Map([['/m/0.glb', path.resolve(glb)]]), (page) => page.evaluate((x) => window.renderOne(...x), ['/m/0.glb', size, bg, yaw, mode]));
	fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
	const img = sharp(png(r.png));
	await (out.endsWith('.webp') ? img.webp({ quality: 85 }) : out.endsWith('.jpg') ? img.jpeg({ quality: 86 }) : img.png()).toFile(out);
	console.log(JSON.stringify({ out, tris: r.tris, size: r.size.map((v) => +v.toFixed(3)) }));
} else if (cmd === 'scene') {
	const w = Number(opt(rest, '--w', 1280)), h = Number(opt(rest, '--h', 720));
	const [specPath, out] = rest;
	const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
	const base = path.dirname(path.resolve(specPath));
	const uniq = [...new Set(spec.items.map((it) => path.resolve(base, it.glb)))];
	const files = new Map(uniq.map((g, i) => [`/m/${i}.glb`, g]));
	const urls = spec.items.map((it) => `/m/${uniq.indexOf(path.resolve(base, it.glb))}.glb`);
	const r = await withPage(files, (page) => page.evaluate((x) => window.renderScene(...x), [spec, [w, h], urls]));
	const img = sharp(png(r.png));
	await (out.endsWith('.webp') ? img.webp({ quality: 85 }) : out.endsWith('.jpg') ? img.jpeg({ quality: 88 }) : img.png()).toFile(out);
	console.log(JSON.stringify({ out, tris: r.tris }));
} else if (cmd === 'sheet') {
	// node render.mjs sheet out.png a.webp b.webp …  — a labelled grid of existing images
	const [out, ...imgs] = rest;
	const cell = 256, L = 20, cols = Math.min(6, imgs.length), rows = Math.ceil(imgs.length / cols);
	const comps = [];
	for (let i = 0; i < imgs.length; i++) {
		const x = (i % cols) * cell, y = Math.floor(i / cols) * (cell + L);
		comps.push({ input: await sharp(imgs[i]).resize(cell, cell).toBuffer(), left: x, top: y });
		const label = path.basename(path.dirname(imgs[i])).replace(/[<&>]/g, '');
		comps.push({ input: Buffer.from(`<svg width="${cell}" height="${L}"><rect width="100%" height="100%" fill="#222"/><text x="6" y="15" font-family="sans-serif" font-size="13" fill="#eee">${label}</text></svg>`), left: x, top: y + cell });
	}
	await sharp({ create: { width: cols * cell, height: rows * (cell + L), channels: 3, background: '#333' } }).composite(comps).png().toFile(out);
	console.log(out);
} else {
	console.error('usage: render.mjs look|thumb|scene|sheet …');
	process.exit(2);
}
