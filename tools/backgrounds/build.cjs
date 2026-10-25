#!/usr/bin/env node
// Builds backgrounds/*.json + backgrounds/index.json — the fluid shader BACKGROUND presets
// (core roadmap 65 M2). Each preset is an ORDINARY background-domain shader graph: the same
// document a person gets by building it node by node in the app's Shader editor (Background
// tab), so "delete a node and see what changes" is how the vocabulary is learnt. Positions
// are authored left-to-right because these are the first background graphs most people open.
//
// 65 gradient adds the GRADIENT family: eight looks close to ShaderGradient's well-known presets
// (github.com/ruucm/shadergradient, MIT © ruucm, stone-skipper — the parameter sets are adapted
// from its presets.ts, so those rows carry its licence; see backgrounds/ATTRIBUTION.md), each a
// two-node graph: the core's Gradient lab node into the Background output. Their index rows name
// the node in `needs`, so a build of the app without it never lists them.
//
//   node tools/backgrounds/build.cjs          writes the files
//   node tools/backgrounds/build.cjs --check  exits 1 when the committed files are stale
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '..', 'backgrounds');
/** the document format the app reads (core src/lib/backgroundPresets.js PRESET_FORMAT) */
const FORMAT = 1;

const node = (id, type, x, y, data = {}) => ({ id, type, position: { x, y }, data });
// the editor's canonical edge id shape, handles included
const edge = (source, sourceHandle, target, targetHandle) => ({
	id: 'e-' + source + '.' + sourceHandle + '-' + target + '.' + targetHandle,
	source,
	sourceHandle,
	target,
	targetHandle
});
const num = (id, value, x, y) => node(id, 'float', x, y, { value });

const PRESETS = [
	{
		key: 'mesh-gradient',
		label: 'Mesh gradient',
		hint: 'Four soft colours drifting into each other; the first one leans towards your pointer.',
		layer: { pointer: true, scroll: false },
		nodes: [
			node('uv', 'aspectUv', 40, 60),
			node('ptr', 'pointer', 40, 220),
			node('ptrUv', 'aspectUv', 240, 240),
			node('mesh', 'meshGradient', 460, 80, {
				colorA: '#ff7a9c', colorB: '#ffd58a', colorC: '#7a8cff', colorD: '#46d9c4',
				speed: 0.35, warp: 0.7, pull: 0.45, sharpness: 2.2
			}),
			node('grain', 'grain', 460, 380, { amount: 0.035, size: 1.5, animate: 1 }),
			node('mixed', 'add', 760, 160),
			node('out', 'backgroundOutput', 980, 160)
		],
		edges: [
			edge('uv', 'out', 'mesh', 'uv'),
			edge('ptr', 'position', 'ptrUv', 'uv'),
			edge('ptrUv', 'out', 'mesh', 'focus'),
			edge('mesh', 'out', 'mixed', 'a'),
			edge('grain', 'out', 'mixed', 'b'),
			edge('mixed', 'out', 'out', 'color')
		]
	},
	{
		key: 'silk-gradient',
		label: 'Silk gradient',
		hint: 'A tilted, slowly folding ribbon of colour in the style of modern product pages. Scrolling shifts the palette; the pointer nudges the folds.',
		layer: { pointer: true, scroll: true },
		nodes: [
			node('uv', 'aspectUv', 40, 40),
			node('ptr', 'pointer', 40, 200),
			node('nudgeAmt', 'float', 40, 330, { value: 0.06 }),
			node('nudge', 'multiply', 240, 220),
			node('shifted', 'add', 240, 60),
			node('tilt', 'rotateUv', 440, 60, { angle: -14, speed: 0, center: [0.5, 0.5] }),
			node('warp', 'domainWarp', 640, 60, { amount: 0.55, scale: 1.4, speed: 0.05 }),
			node('chan', 'split', 840, 20),
			node('folds', 'fbm', 840, 200, { scale: 1.6, octaves: 3, lacunarity: 2, gain: 0.5 }),
			node('xw', 'float', 840, 380, { value: 0.85 }),
			node('xs', 'multiply', 1040, 20),
			node('fw', 'float', 1040, 380, { value: 0.55 }),
			node('fs', 'multiply', 1040, 200),
			node('scroll', 'scroll', 1040, 500),
			node('sw', 'float', 1040, 620, { value: 0.45 }),
			node('ss', 'multiply', 1240, 500),
			node('t1', 'add', 1240, 100),
			node('t', 'add', 1420, 160),
			node('ramp', 'gradient', 1600, 120, { colorA: '#1d2a7a', colorB: '#c23bd4', colorC: '#ffb067', mid: 0.48 }),
			node('cyan', 'color', 1600, 340, { value: '#52e5ff' }),
			node('hl', 'smoothstep', 1600, 470, { edge0: 0.62, edge1: 0.9 }),
			node('silk', 'mix', 1820, 200),
			node('out', 'backgroundOutput', 2040, 200)
		],
		edges: [
			edge('ptr', 'position', 'nudge', 'a'),
			edge('nudgeAmt', 'out', 'nudge', 'b'),
			edge('uv', 'out', 'shifted', 'a'),
			edge('nudge', 'out', 'shifted', 'b'),
			edge('shifted', 'out', 'tilt', 'uv'),
			edge('tilt', 'out', 'warp', 'uv'),
			edge('warp', 'out', 'chan', 'value'),
			edge('warp', 'out', 'folds', 'uv'),
			edge('chan', 'x', 'xs', 'a'),
			edge('xw', 'out', 'xs', 'b'),
			edge('folds', 'out', 'fs', 'a'),
			edge('fw', 'out', 'fs', 'b'),
			edge('scroll', 'progress', 'ss', 'a'),
			edge('sw', 'out', 'ss', 'b'),
			edge('xs', 'out', 't1', 'a'),
			edge('fs', 'out', 't1', 'b'),
			edge('t1', 'out', 't', 'a'),
			edge('ss', 'out', 't', 'b'),
			edge('t', 'out', 'ramp', 't'),
			edge('folds', 'out', 'hl', 'a'),
			edge('ramp', 'out', 'silk', 'a'),
			edge('cyan', 'out', 'silk', 'b'),
			edge('hl', 'out', 'silk', 't'),
			edge('silk', 'out', 'out', 'color')
		]
	},
	{
		key: 'noise-flow',
		label: 'Noise flow',
		hint: 'Contour lines streaming through warped noise, like wind on a weather map. The flow bends towards your pointer.',
		layer: { pointer: true, scroll: false },
		nodes: [
			node('uv', 'aspectUv', 40, 40),
			node('ptr', 'pointer', 40, 200),
			node('ptrUv', 'aspectUv', 240, 220),
			node('toward', 'subtract', 440, 160),
			node('pullAmt', 'float', 440, 320, { value: 0.08 }),
			node('pull', 'multiply', 640, 180),
			node('bent', 'add', 640, 40),
			node('warp', 'domainWarp', 840, 40, { amount: 0.7, scale: 2.2, speed: 0.07 }),
			node('field', 'fbm', 1040, 40, { scale: 2.6, octaves: 5, lacunarity: 2, gain: 0.5 }),
			node('bands', 'float', 1040, 220, { value: 9 }),
			node('scaled', 'multiply', 1240, 60),
			node('time', 'time', 1240, 220, { speed: 0.25 }),
			node('moving', 'subtract', 1420, 100),
			node('wrap', 'fract', 1600, 100),
			node('half', 'float', 1600, 240, { value: 0.5 }),
			node('centre', 'subtract', 1780, 120),
			node('dist', 'abs', 1960, 120),
			node('line', 'smoothstep', 2140, 120, { edge0: 0.4, edge1: 0.5 }),
			node('ramp', 'gradient', 1960, 300, { colorA: '#05070f', colorB: '#0f2b4a', colorC: '#1a6b7a', mid: 0.55 }),
			node('ink', 'color', 2140, 300, { value: '#9ff6ff' }),
			node('mixed', 'mix', 2340, 200),
			node('out', 'backgroundOutput', 2540, 200)
		],
		edges: [
			edge('ptr', 'position', 'ptrUv', 'uv'),
			edge('ptrUv', 'out', 'toward', 'a'),
			edge('uv', 'out', 'toward', 'b'),
			edge('toward', 'out', 'pull', 'a'),
			edge('pullAmt', 'out', 'pull', 'b'),
			edge('uv', 'out', 'bent', 'a'),
			edge('pull', 'out', 'bent', 'b'),
			edge('bent', 'out', 'warp', 'uv'),
			edge('warp', 'out', 'field', 'uv'),
			edge('field', 'out', 'scaled', 'a'),
			edge('bands', 'out', 'scaled', 'b'),
			edge('scaled', 'out', 'moving', 'a'),
			edge('time', 'out', 'moving', 'b'),
			edge('moving', 'out', 'wrap', 'a'),
			edge('wrap', 'out', 'centre', 'a'),
			edge('half', 'out', 'centre', 'b'),
			edge('centre', 'out', 'dist', 'a'),
			edge('dist', 'out', 'line', 'a'),
			edge('field', 'out', 'ramp', 't'),
			edge('ramp', 'out', 'mixed', 'a'),
			edge('ink', 'out', 'mixed', 'b'),
			edge('line', 'out', 'mixed', 't'),
			edge('mixed', 'out', 'out', 'color')
		]
	},
	{
		key: 'metaballs',
		label: 'Metaballs',
		hint: 'Glossy blobs that melt into each other like a lava lamp; one of them follows your pointer.',
		layer: { pointer: true, scroll: false },
		nodes: [
			node('uv', 'aspectUv', 40, 40),
			node('ptr', 'pointer', 40, 220),
			node('ptrUv', 'aspectUv', 240, 240),
			node('blobs', 'blobs', 460, 60, { count: 6, radius: 0.11, speed: 0.45, smoothness: 0.14, softness: 0.006, attractRadius: 0.085 }),
			node('chan', 'split', 260, 420),
			node('bg', 'gradient', 700, 360, { colorA: '#120a2a', colorB: '#1c1450', colorC: '#2a1a5e', mid: 0.5 }),
			node('fill', 'gradient', 700, 120, { colorA: '#ff4fa3', colorB: '#ff9a5a', colorC: '#ffe46b', mid: 0.5 }),
			node('body', 'mix', 940, 200),
			// GLSL leaves smoothstep undefined for edge0 >= edge1, so a falloff is One minus a rise
			node('glowRise', 'smoothstep', 940, 420, { edge0: 0.0, edge1: 0.16 }),
			node('glowW', 'oneMinus', 1000, 520),
			node('glowAmt', 'float', 940, 560, { value: 0.35 }),
			node('glow', 'multiply', 1140, 440),
			node('glowCol', 'color', 1140, 600, { value: '#ff6ad5' }),
			node('glowRgb', 'multiply', 1320, 460),
			node('lit', 'add', 1500, 260),
			node('out', 'backgroundOutput', 1700, 260)
		],
		edges: [
			edge('uv', 'out', 'blobs', 'uv'),
			edge('ptr', 'position', 'ptrUv', 'uv'),
			edge('ptrUv', 'out', 'blobs', 'attract'),
			edge('uv', 'out', 'chan', 'value'),
			edge('chan', 'y', 'bg', 't'),
			edge('chan', 'y', 'fill', 't'),
			edge('bg', 'out', 'body', 'a'),
			edge('fill', 'out', 'body', 'b'),
			edge('blobs', 'mask', 'body', 't'),
			edge('blobs', 'sdf', 'glowRise', 'a'),
			edge('glowRise', 'out', 'glowW', 'a'),
			edge('glowW', 'out', 'glow', 'a'),
			edge('glowAmt', 'out', 'glow', 'b'),
			edge('glowCol', 'out', 'glowRgb', 'a'),
			edge('glow', 'out', 'glowRgb', 'b'),
			edge('body', 'out', 'lit', 'a'),
			edge('glowRgb', 'out', 'lit', 'b'),
			edge('lit', 'out', 'out', 'color')
		]
	},
	{
		key: 'grain-dither',
		label: 'Grain & dither',
		hint: 'A soft dusk gradient broken into retro dither steps with film grain on top; a pool of light follows your pointer.',
		layer: { pointer: true, scroll: false },
		nodes: [
			node('uv', 'aspectUv', 40, 40),
			node('chan', 'split', 240, 40),
			node('cloud', 'fbm', 240, 220, { scale: 2, octaves: 4, lacunarity: 2, gain: 0.5 }),
			node('cloudAmt', 'float', 240, 400, { value: 0.22 }),
			node('cloudS', 'multiply', 440, 260),
			node('t', 'add', 620, 100),
			node('ramp', 'gradient', 800, 80, { colorA: '#2b1b4a', colorB: '#c4577a', colorC: '#ffc98a', mid: 0.42 }),
			node('ptr', 'pointer', 40, 560),
			node('ptrUv', 'aspectUv', 240, 560),
			node('dist', 'distance', 440, 520),
			node('spotRise', 'smoothstep', 620, 460, { edge0: 0.0, edge1: 0.35 }),
			node('spot', 'oneMinus', 660, 580),
			node('spotAmt', 'float', 620, 680, { value: 0.35 }),
			node('spotS', 'multiply', 800, 540),
			node('lit', 'add', 1000, 200),
			node('bayer', 'bayer', 1000, 420, { scale: 2 }),
			node('half', 'float', 1000, 560, { value: 0.5 }),
			node('centred', 'subtract', 1180, 440),
			node('depth', 'float', 1180, 600, { value: 0.16 }),
			node('dither', 'multiply', 1360, 460),
			node('dithered', 'add', 1360, 220),
			node('steps', 'posterize', 1540, 220, { steps: 7 }),
			node('grain', 'grain', 1540, 420, { amount: 0.05, size: 2, animate: 1 }),
			node('final', 'add', 1740, 260),
			node('out', 'backgroundOutput', 1940, 260)
		],
		edges: [
			edge('uv', 'out', 'chan', 'value'),
			edge('uv', 'out', 'cloud', 'uv'),
			edge('cloud', 'out', 'cloudS', 'a'),
			edge('cloudAmt', 'out', 'cloudS', 'b'),
			edge('chan', 'y', 't', 'a'),
			edge('cloudS', 'out', 't', 'b'),
			edge('t', 'out', 'ramp', 't'),
			edge('ptr', 'position', 'ptrUv', 'uv'),
			edge('uv', 'out', 'dist', 'a'),
			edge('ptrUv', 'out', 'dist', 'b'),
			edge('dist', 'out', 'spotRise', 'a'),
			edge('spotRise', 'out', 'spot', 'a'),
			edge('spot', 'out', 'spotS', 'a'),
			edge('spotAmt', 'out', 'spotS', 'b'),
			edge('ramp', 'out', 'lit', 'a'),
			edge('spotS', 'out', 'lit', 'b'),
			edge('bayer', 'out', 'centred', 'a'),
			edge('half', 'out', 'centred', 'b'),
			edge('centred', 'out', 'dither', 'a'),
			edge('depth', 'out', 'dither', 'b'),
			edge('lit', 'out', 'dithered', 'a'),
			edge('dither', 'out', 'dithered', 'b'),
			edge('dithered', 'out', 'steps', 'a'),
			edge('steps', 'out', 'final', 'a'),
			edge('grain', 'out', 'final', 'b'),
			edge('final', 'out', 'out', 'color')
		]
	}
];

// ---- the Gradient family (65 gradient) --------------------------------------------------------
/** the Gradient lab node's params, mirroring core src/lib/gradientLabCore.js GRADIENT_PARAMS defaults
 *  (the app normalizes whatever a file holds, so a key left out only takes the default) */
const LAB_DEFAULTS = {
	shape: 'plane', color1: '#ff5005', color2: '#dbba95', color3: '#d0bce1', speed: 0.4, density: 1.3, strength: 4,
	frequency: 5.5, amplitude: 1, brightness: 1.2, lighting: 'ambient', environment: 'city', reflection: 0.1,
	azimuth: 180, polar: 90, distance: 3.6, zoom: 1, fov: 45, posX: -1.4, posY: 0, posZ: 0, rotX: 0, rotY: 10, rotZ: 50, grain: 1
};
const SPHERE = { shape: 'sphere', distance: 14, posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0 };
const WATER = { shape: 'waterPlane', amplitude: 0, frequency: 0, posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0 };
const GRADIENTS = [
	{
		key: 'ember-ribbon',
		label: 'Ember ribbon',
		hint: 'A warm ribbon of orange, sand and lilac folding slowly across the frame, with a fine print grain.',
		lab: { speed: 0.4, density: 1.3, strength: 4 }
	},
	{
		key: 'violet-orb',
		label: 'Violet orb',
		hint: 'Seen up close, a sphere of periwinkle and violet that twists into soft spirals.',
		lab: { ...SPHERE, color1: '#809bd6', color2: '#910aff', color3: '#af38ff', azimuth: 250, polar: 140, zoom: 12.5, rotZ: 140, amplitude: 7, density: 0.8, speed: 0.3, strength: 0.4, brightness: 1.5 }
	},
	{
		key: 'mint-tide',
		label: 'Mint tide',
		hint: 'Rolling swells of mint and aqua fading to white, like light under shallow water. No grain.',
		lab: { ...WATER, color1: '#94ffd1', color2: '#6bf5ff', color3: '#ffffff', azimuth: 170, polar: 70, distance: 4.4, posY: 0.9, posZ: -0.3, rotX: 45, density: 1.2, speed: 0.2, strength: 3.4, grain: 0 }
	},
	{
		key: 'glass-orbit',
		label: 'Glass orbit',
		hint: 'A glossy teal and amber sphere seen from below, catching soft reflections from a studio around it.',
		lab: { ...SPHERE, color1: '#73bfc4', color2: '#ff810a', color3: '#8da0ce', lighting: 'environment', reflection: 0.4, azimuth: 270, polar: 180, zoom: 15.1, posX: -0.1, rotY: 130, rotZ: 70, amplitude: 3.2, density: 0.8, speed: 0.3, strength: 0.3, brightness: 0.8 }
	},
	{
		key: 'night-swell',
		label: 'Night swell',
		hint: 'Slate and lavender waves rising out of near black: a calm, dark backdrop.',
		lab: { ...WATER, color1: '#606080', color2: '#8d7dca', color3: '#212121', azimuth: 180, polar: 80, distance: 2.8, rotX: 50, rotZ: -60, density: 1.5, speed: 0.3, strength: 1.5, brightness: 1 }
	},
	{
		key: 'indigo-bloom',
		label: 'Indigo bloom',
		hint: 'White and gold blooming out of deep indigo on a slowly turning sphere. No grain.',
		lab: { ...SPHERE, color1: '#ffffff', color2: '#ffbb00', color3: '#0700ff', azimuth: 0, polar: 140, zoom: 17.3, amplitude: 1.4, density: 1.1, speed: 0.1, strength: 1, brightness: 1.1, grain: 0 }
	},
	{
		key: 'deep-space',
		label: 'Deep space',
		hint: 'Electric violet and coral drifting through black, like a nebula. No grain.',
		lab: { ...WATER, color1: '#5606ff', color2: '#fe8989', color3: '#000000', azimuth: 180, polar: 115, distance: 3.9, posX: -0.5, posY: 0.1, rotZ: 235, density: 1.1, speed: 0.1, strength: 2.4, brightness: 1.1, grain: 0 }
	},
	{
		key: 'tangerine-sea',
		label: 'Tangerine sea',
		hint: 'A sea of hot orange with rust-red troughs, seen low across its surface. No grain.',
		lab: { ...WATER, color1: '#ff6a1a', color2: '#c73c00', color3: '#fd4912', azimuth: 180, polar: 95, distance: 2.4, posY: -2.1, rotZ: 225, density: 1.8, speed: 0.2, strength: 3, brightness: 1.2, grain: 0 }
	}
];
const GRADIENT_LICENSE = 'MIT';
const GRADIENT_ATTRIBUTION = 'Adapted from ShaderGradient presets (github.com/ruucm/shadergradient), MIT © ruucm, stone-skipper';
for (const g of GRADIENTS) {
	PRESETS.push({
		key: g.key,
		label: g.label,
		hint: g.hint,
		family: 'Gradient',
		needs: ['gradientLab'],
		license: GRADIENT_LICENSE,
		attribution: GRADIENT_ATTRIBUTION,
		layer: { pointer: false, scroll: false },
		nodes: [node('lab', 'gradientLab', 80, 80, { ...LAB_DEFAULTS, ...g.lab }), node('out', 'backgroundOutput', 420, 120)],
		edges: [edge('lab', 'out', 'out', 'color')]
	});
}

function files() {
	/** @type {Record<string, string>} */
	const out = {};
	const index = {
		format: FORMAT,
		title: 'Fluid backgrounds',
		license: 'CC0-1.0',
		presets: PRESETS.map((p) => ({
			key: p.key,
			label: p.label,
			hint: p.hint,
			file: p.key + '.json',
			// 65 gradient: optional, additive within format 1 (core backgroundPresetsCore.normalizePresetIndex)
			...(p.family ? { family: p.family, needs: p.needs, license: p.license, attribution: p.attribution } : {})
		}))
	};
	out['index.json'] = JSON.stringify(index, null, '\t') + '\n';
	for (const p of PRESETS) {
		const doc = {
			format: FORMAT,
			domain: 'background',
			name: p.label,
			preset: p.key,
			...(p.license ? { license: p.license, attribution: p.attribution } : {}),
			layer: p.layer,
			nodes: p.nodes,
			edges: p.edges
		};
		out[p.key + '.json'] = JSON.stringify(doc, null, '\t') + '\n';
	}
	return out;
}

const check = process.argv.includes('--check');
let stale = 0;
for (const [name, text] of Object.entries(files())) {
	const target = path.join(OUT, name);
	if (check) {
		const have = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
		if (have !== text) {
			console.log('STALE ' + name);
			stale++;
		}
	} else {
		fs.mkdirSync(OUT, { recursive: true });
		fs.writeFileSync(target, text);
		console.log('wrote backgrounds/' + name);
	}
}
if (check) {
	console.log(stale ? stale + ' stale file(s) — run node tools/backgrounds/build.cjs' : 'backgrounds/ up to date');
	process.exit(stale ? 1 : 0);
}
