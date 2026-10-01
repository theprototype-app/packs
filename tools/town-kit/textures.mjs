// Painted textures for the hand-built town-kit pieces (fence, garden gate, banners, signpost,
// curbs, sidewalk and crossing slabs). Each is an SVG rasterised by sharp (librsvg) → JPEG;
// feTurbulence with stitchTiles makes the swatches tile. Palette = the kit's: weathered oak,
// white-washed pickets, dark wrought iron, pale granite / sandstone flags, and ONE accent —
// terracotta red (the same hue the Meshy pieces' awning, roofs and banners are graded to).
import { createRequire } from 'node:module';
import { TOOLS } from './kit-post.mjs';

const sharp = createRequire(`${TOOLS}/package.json`)('sharp');

export const TERRACOTTA = '#b4503a';

/** a coloured noise layer: `a` = alpha gain, `b` = alpha bias of the noise's R channel */
const noise = (id, fx, fy, oct, seed, rgb, a, b) => `
<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
 <feTurbulence type="fractalNoise" baseFrequency="${fx} ${fy}" numOctaves="${oct}" seed="${seed}" stitchTiles="stitch"/>
 <feColorMatrix type="matrix" values="0 0 0 0 ${rgb[0]}  0 0 0 0 ${rgb[1]}  0 0 0 0 ${rgb[2]}  ${a} 0 0 0 ${b}"/>
</filter>`;

const hex = (h) => [1, 3, 5].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3));

/** a tileable swatch: base + soft mottling + fine speckle (+ `extra` svg on top) */
function swatch({ base, light, dark, fx = 0.012, fy = 0.012, seed = 2, size = 512, extra = '', speckle = 0.45 }) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
<defs>${noise('g', fx, fy, 4, seed, hex(light), 1.6, -0.8)}${noise('d', fx * 1.7, fy * 1.3, 3, seed + 7, hex(dark), 1.6, -1.0)}${noise('s', 0.4, 0.4, 2, seed + 3, hex(dark), 1.1, -0.55)}</defs>
<rect width="100%" height="100%" fill="${base}"/>
<rect width="100%" height="100%" filter="url(#g)"/>
<rect width="100%" height="100%" filter="url(#d)"/>
<rect width="100%" height="100%" filter="url(#s)" opacity="${speckle}"/>
${extra}</svg>`;
}

/** wood: grain runs along V (stretched noise), plank gaps every size/planks px along U */
function wood({ base, light, dark, seed, planks = 0, size = 512 }) {
	let lines = '';
	for (let i = 0; i < planks; i++) {
		const p = Math.round((i * size) / planks);
		lines += `<rect x="${p}" y="0" width="4" height="${size}" fill="${dark}" opacity="0.85"/><rect x="${p + 4}" y="0" width="2" height="${size}" fill="${light}" opacity="0.35"/>`;
	}
	return swatch({ base, light, dark, fx: 0.004, fy: 0.09, seed, size, extra: lines, speckle: 0.25 });
}

/** flagstones: irregular-ish rectangular slabs with grout lines (tiles at 1 m, so 2 × 2 per tile) */
function flags({ base, light, dark, grout, seed, size = 512 }) {
	let s = '';
	const rows = [
		[0, 0.55, 1],
		[0, 0.4, 0.75, 1]
	];
	const h = size / 2;
	for (let r = 0; r < 2; r++) {
		const y = r * h;
		s += `<rect x="0" y="${y}" width="${size}" height="5" fill="${grout}"/>`;
		for (const f of rows[r]) s += `<rect x="${Math.round(f * size) - 2}" y="${y}" width="5" height="${h}" fill="${grout}"/>`;
	}
	s += `<rect x="0" y="0" width="5" height="${size}" fill="${grout}"/>`;
	return swatch({ base, light, dark, seed, fx: 0.02, fy: 0.02, size, extra: s, speckle: 0.6 });
}

/** a striped cloth (banner): two accent stripes on terracotta */
function cloth(size = 512) {
	let s = '';
	for (const y of [0.08, 0.86]) s += `<rect x="0" y="${Math.round(y * size)}" width="${size}" height="${Math.round(0.05 * size)}" fill="#e2c48a" opacity="0.95"/>`;
	// a plain lozenge emblem — no text, no logos
	const c = size / 2;
	s += `<polygon points="${c},${c - 70} ${c + 52},${c} ${c},${c + 70} ${c - 52},${c}" fill="#e2c48a" opacity="0.95"/>`;
	s += `<polygon points="${c},${c - 40} ${c + 30},${c} ${c},${c + 40} ${c - 30},${c}" fill="${TERRACOTTA}"/>`;
	return swatch({ base: TERRACOTTA, light: '#cf6a50', dark: '#7c3122', seed: 31, fx: 0.01, fy: 0.03, size, extra: s, speckle: 0.2 });
}

export const SWATCHES = {
	oak: () => wood({ base: '#7a5a3c', light: '#9c7853', dark: '#4a3422', seed: 4 }),
	oakPlanks: () => wood({ base: '#7a5a3c', light: '#9c7853', dark: '#3d2b1c', seed: 4, planks: 4 }),
	pickets: () => wood({ base: '#d8d0c0', light: '#ebe5d8', dark: '#9b917f', seed: 8 }),
	iron: () => swatch({ base: '#2e2c2b', light: '#4a4644', dark: '#161514', seed: 11, fx: 0.03, fy: 0.03 }),
	cloth,
	terracotta: () => swatch({ base: TERRACOTTA, light: '#cf6a50', dark: '#7c3122', seed: 19 }),
	granite: () => swatch({ base: '#76736d', light: '#8e8a83', dark: '#4e4b47', seed: 21, fx: 0.03, fy: 0.03 }),
	flags: () => flags({ base: '#b9a888', light: '#d2c3a4', dark: '#857559', grout: '#5e5243', seed: 25 }),
	paleFlags: () => flags({ base: '#d4cbb8', light: '#e8e1d2', dark: '#a39a86', grout: '#6b6152', seed: 27 }),
	gold: () => swatch({ base: '#b08a3c', light: '#d6b060', dark: '#6d5224', seed: 29 })
};

/** rasterise an SVG to JPEG bytes */
export async function jpeg(svg, width = 512) {
	return new Uint8Array(await sharp(Buffer.from(svg)).resize({ width }).jpeg({ quality: 86 }).toBuffer());
}
