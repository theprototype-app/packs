// Painted textures for the hand-built scifi-kit pieces (grating, ramp, railing, pipes, vent,
// wall screen, lamp, light strips). Each is an SVG rasterised by sharp (librsvg) → JPEG;
// feTurbulence with stitchTiles makes the material swatches tile. The palette is the kit's:
// off-white painted panels, warm gunmetal, dark rubber, and ONE accent — teal, the same
// hue as props-kit's sci-fi crate and console (#2a6e6a paint, #52d6cc light).
import { createRequire } from 'node:module';
import { TOOLS } from './kit-post.mjs';

const sharp = createRequire(`${TOOLS}/package.json`)('sharp');

export const TEAL = '#2f7f7a';
export const TEAL_LIGHT = '#52d6cc';

/** a coloured noise layer: `a` = alpha gain, `b` = alpha bias of the noise's R channel */
const noise = (id, fx, fy, oct, seed, rgb, a, b) => `
<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
 <feTurbulence type="fractalNoise" baseFrequency="${fx} ${fy}" numOctaves="${oct}" seed="${seed}" stitchTiles="stitch"/>
 <feColorMatrix type="matrix" values="0 0 0 0 ${rgb[0]}  0 0 0 0 ${rgb[1]}  0 0 0 0 ${rgb[2]}  ${a} 0 0 0 ${b}"/>
</filter>`;

const hex = (h) => [1, 3, 5].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3));

/** a tileable painted-metal swatch: base + soft mottling + fine speckle + optional panel seams */
function swatch({ base, light, dark, fx = 0.012, fy = 0.012, seed = 2, seams = 0, size = 512, extra = '' }) {
	let lines = '';
	// panel seams every size/seams px, both ways: a dark groove with a lit lower lip
	for (let i = 0; i < seams; i++) {
		const p = Math.round((i * size) / seams);
		lines += `<rect x="0" y="${p}" width="${size}" height="3" fill="${dark}" opacity="0.8"/><rect x="0" y="${p + 3}" width="${size}" height="2" fill="${light}" opacity="0.45"/>`;
		lines += `<rect x="${p}" y="0" width="3" height="${size}" fill="${dark}" opacity="0.8"/><rect x="${p + 3}" y="0" width="2" height="${size}" fill="${light}" opacity="0.45"/>`;
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
<defs>${noise("g", fx, fy, 4, seed, hex(light), 1.6, -0.8)}${noise("d", fx * 1.7, fy * 1.3, 3, seed + 7, hex(dark), 1.6, -1.0)}${noise('s', 0.4, 0.4, 2, seed + 3, hex(dark), 1.1, -0.55)}</defs>
<rect width="100%" height="100%" fill="${base}"/>
<rect width="100%" height="100%" filter="url(#g)"/>
<rect width="100%" height="100%" filter="url(#d)"/>
<rect width="100%" height="100%" filter="url(#s)" opacity="0.45"/>
${lines}${extra}</svg>`;
}

/** diagonal accent stripes (a ramp's edge, a pad's rim): teal on gunmetal */
function stripes(size = 512) {
	let s = '';
	for (let i = -size; i < size * 2; i += 128) s += `<polygon points="${i},0 ${i + 64},0 ${i + 64 - size},${size} ${i - size},${size}" fill="${TEAL}" opacity="0.92"/>`;
	return swatch({ base: '#4a4a4c', light: '#6c6b6a', dark: '#2a2a2c', seed: 23, extra: s });
}

/** an abstract status display — bars, a trace, rings; NO text (the art direction) */
function screenUI(size = 512) {
	const h = size / 2;
	let s = `<rect width="${size}" height="${h}" fill="#08201f"/>`;
	for (let y = 0; y < h; y += 16) s += `<rect x="0" y="${y}" width="${size}" height="1" fill="${TEAL_LIGHT}" opacity="0.08"/>`;
	[0.55, 0.8, 0.35, 0.65, 0.9, 0.45, 0.7].forEach((v, i) => {
		s += `<rect x="${24 + i * 26}" y="${h - 24 - v * 150}" width="16" height="${v * 150}" fill="${TEAL_LIGHT}" opacity="0.85"/>`;
	});
	let d = `M 220 ${h - 60}`;
	for (let x = 220; x <= 400; x += 12) d += ` L ${x} ${h - 60 - 50 * Math.sin(x / 17) * Math.cos(x / 41) - 30}`;
	s += `<path d="${d}" stroke="${TEAL_LIGHT}" stroke-width="4" fill="none"/>`;
	s += `<rect x="216" y="30" width="190" height="${h - 56}" stroke="${TEAL_LIGHT}" stroke-width="2" fill="none" opacity="0.5"/>`;
	s += `<circle cx="460" cy="${h / 2}" r="36" stroke="${TEAL_LIGHT}" stroke-width="6" fill="none"/><circle cx="460" cy="${h / 2}" r="18" fill="${TEAL_LIGHT}" opacity="0.7"/>`;
	s += `<path d="M 460 ${h / 2 - 36} A 36 36 0 0 1 496 ${h / 2}" stroke="#e8fffc" stroke-width="6" fill="none"/>`;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${h}">${s}</svg>`;
}

export const SWATCHES = {
	white: () => swatch({ base: '#d9d6cf', light: '#ecebe6', dark: '#9d9a93', seed: 5 }),
	whitePanels: () => swatch({ base: '#d9d6cf', light: '#ecebe6', dark: '#8e8b85', seed: 5, seams: 2 }),
	gunmetal: () => swatch({ base: '#57585a', light: '#7a7a79', dark: '#333436', seed: 9 }),
	dark: () => swatch({ base: '#2c2d30', light: '#46474a', dark: '#18191b', seed: 13, fx: 0.03, fy: 0.03 }),
	teal: () => swatch({ base: TEAL, light: '#45958f', dark: '#1d4d4a', seed: 17 }),
	stripes,
	screen: screenUI,
	glow: () => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#e6fffb"/></svg>`
};

/** rasterise an SVG to JPEG bytes */
export async function jpeg(svg, width = 512) {
	return new Uint8Array(await sharp(Buffer.from(svg)).resize({ width }).jpeg({ quality: 86 }).toBuffer());
}
