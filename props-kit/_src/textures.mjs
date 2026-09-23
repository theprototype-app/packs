// Procedural textures for the hand-built props-kit pieces (lever, button, ladder, rug, …).
// Each is an SVG rasterised by sharp (librsvg) → JPEG. feTurbulence with stitchTiles
// makes the material swatches tile seamlessly; the rug and the tapestry are single
// non-tiling layouts. Palette = the locked art direction: oak, iron, brass, sandstone,
// slate, and the pack's ONE accent colour — teal (#2f7f7b), the painted crate's.
import { createRequire } from 'node:module';

const TOOLS = process.env.MESHY_TOOLS ?? '/home/deck/.code/theprototype-app/packs-lane-30c-tools/tools/meshy';
const sharp = createRequire(`${TOOLS}/package.json`)('sharp');

export const TEAL = '#2a6e6a';
export const TEAL_DARK = '#1b4a48';

/** a coloured noise layer: `a` = alpha gain, `b` = alpha bias of the noise's R channel */
const noise = (id, fx, fy, oct, seed, rgb, a, b) => `
<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
 <feTurbulence type="fractalNoise" baseFrequency="${fx} ${fy}" numOctaves="${oct}" seed="${seed}" stitchTiles="stitch"/>
 <feColorMatrix type="matrix" values="0 0 0 0 ${rgb[0]}  0 0 0 0 ${rgb[1]}  0 0 0 0 ${rgb[2]}  ${a} 0 0 0 ${b}"/>
</filter>`;

const hex = (h) => [1, 3, 5].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3));

/** a tileable swatch: base fill + streak/grain noise + fine speckle */
function swatch({ base, light, dark, fx = 0.004, fy = 0.07, seed = 2, planks = 0, courses = 0, size = 512 }) {
	const L = hex(light);
	const D = hex(dark);
	let lines = '';
	// coursed masonry: `courses` rows of blocks, joints staggered half a block per row
	for (let r = 0; r < courses; r++) {
		const h = size / courses;
		const y = Math.round(r * h);
		lines += `<rect x="0" y="${y}" width="${size}" height="4" fill="${dark}" opacity="0.7"/>`;
		for (let k = 0; k < 3; k++) {
			const x = Math.round(((k + (r % 2) * 0.5) * size) / 3) % size;
			lines += `<rect x="${x}" y="${y}" width="4" height="${Math.round(h)}" fill="${dark}" opacity="0.7"/><rect x="${x + 4}" y="${y + 4}" width="3" height="${Math.round(h) - 4}" fill="${light}" opacity="0.3"/>`;
		}
	}
	for (let i = 1; i <= planks; i++) {
		const y = Math.round((i * size) / planks) - 2;
		lines += `<rect x="0" y="${y}" width="${size}" height="3" fill="${dark}" opacity="0.85"/><rect x="0" y="${y + 3}" width="${size}" height="2" fill="${light}" opacity="0.35"/>`;
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
<defs>${noise('g', fx, fy, 4, seed, L, 2.2, -0.9)}${noise('d', fx * 1.7, fy * 0.6, 3, seed + 7, D, 2.4, -1.25)}${noise('s', 0.35, 0.35, 2, seed + 3, D, 1.2, -0.55)}</defs>
<rect width="100%" height="100%" fill="${base}"/>
<rect width="100%" height="100%" filter="url(#g)"/>
<rect width="100%" height="100%" filter="url(#d)"/>
<rect width="100%" height="100%" filter="url(#s)" opacity="0.5"/>
${lines}</svg>`;
}

export const SWATCHES = {
	oak: () => swatch({ base: '#74492a', light: '#a06f45', dark: '#4a2b15', planks: 0 }),
	oakPlanks: () => swatch({ base: '#74492a', light: '#a06f45', dark: '#3e220f', planks: 4, seed: 5 }),
	iron: () => swatch({ base: '#4a4642', light: '#6e6862', dark: '#2a2725', fx: 0.02, fy: 0.02, seed: 9 }),
	brass: () => swatch({ base: '#a47a36', light: '#cfa45a', dark: '#6e4e1e', fx: 0.015, fy: 0.03, seed: 4 }),
	sandstone: () => swatch({ base: '#a08462', light: '#c2a680', dark: '#6e5638', fx: 0.012, fy: 0.012, seed: 11 }),
	wallStone: () => swatch({ base: '#a58c6c', light: '#c4ad8c', dark: '#6a5438', fx: 0.03, fy: 0.03, seed: 29, courses: 4 }),
	slate: () => swatch({ base: '#5d6266', light: '#7d8388', dark: '#3a3e42', fx: 0.01, fy: 0.02, seed: 13 }),
	cloth: () => swatch({ base: '#4a3a2c', light: '#8a7658', dark: '#1e1712', fx: 0.05, fy: 0.3, seed: 19 }),
	teal: () => swatch({ base: TEAL, light: '#3d8781', dark: TEAL_DARK, fx: 0.01, fy: 0.05, seed: 17 })
};

/** the rug: 2:1.3 layout — a wool field, a cream border, the teal accent band, a medallion */
export function rugSvg(w = 1024, h = 666) {
	const cx = w / 2;
	const cy = h / 2;
	const diamond = (rx, ry, fill, op = 1) => `<polygon points="${cx},${cy - ry} ${cx + rx},${cy} ${cx},${cy + ry} ${cx - rx},${cy}" fill="${fill}" opacity="${op}"/>`;
	let motifs = '';
	for (let i = 0; i < 14; i++) {
		const x = 70 + (i * (w - 140)) / 13;
		motifs += `<polygon points="${x},46 ${x + 12},58 ${x},70 ${x - 12},58" fill="${TEAL}"/><polygon points="${x},${h - 70} ${x + 12},${h - 58} ${x},${h - 46} ${x - 12},${h - 58}" fill="${TEAL}"/>`;
	}
	for (let i = 0; i < 8; i++) {
		const y = 70 + (i * (h - 140)) / 7;
		motifs += `<polygon points="46,${y} 58,${y - 12} 70,${y} 58,${y + 12}" fill="${TEAL}"/><polygon points="${w - 70},${y} ${w - 58},${y - 12} ${w - 46},${y} ${w - 58},${y + 12}" fill="${TEAL}"/>`;
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<defs>${noise('wv', 0.9, 0.25, 2, 21, hex('#2a140c'), 1.6, -0.55)}${noise('mt', 0.01, 0.01, 3, 23, hex('#e9d6ae'), 0.8, -0.5)}</defs>
<rect width="100%" height="100%" fill="#7a2e22"/>
<rect x="18" y="18" width="${w - 36}" height="${h - 36}" fill="none" stroke="#e2cfa3" stroke-width="16"/>
<rect x="36" y="36" width="${w - 72}" height="${h - 72}" fill="none" stroke="#5a1f17" stroke-width="10"/>
${motifs}
<rect x="96" y="96" width="${w - 192}" height="${h - 192}" fill="none" stroke="#e2cfa3" stroke-width="6"/>
<rect x="110" y="110" width="${w - 220}" height="${h - 220}" fill="none" stroke="${TEAL}" stroke-width="12"/>
${diamond(w * 0.3, h * 0.3, '#e2cfa3')}${diamond(w * 0.27, h * 0.265, '#8e3a2b')}${diamond(w * 0.17, h * 0.17, TEAL)}${diamond(w * 0.1, h * 0.1, '#e2cfa3')}${diamond(w * 0.045, h * 0.045, '#5a1f17')}
<circle cx="${cx - w * 0.3}" cy="${cy}" r="22" fill="${TEAL}"/><circle cx="${cx + w * 0.3}" cy="${cy}" r="22" fill="${TEAL}"/>
<rect width="100%" height="100%" filter="url(#mt)"/>
<rect width="100%" height="100%" filter="url(#wv)"/>
</svg>`;
}

/** the tapestry: a teal field, brass border, an abstract compass-star emblem (no text, no logo) */
export function tapestrySvg(w = 640, h = 1024) {
	const cx = w / 2;
	const cy = h * 0.42;
	const star = (r1, r2, n, fill) => {
		const pts = [];
		for (let i = 0; i < n * 2; i++) {
			const r = i % 2 ? r2 : r1;
			const a = (i * Math.PI) / n - Math.PI / 2;
			pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
		}
		return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
	};
	let chevrons = '';
	for (let i = 0; i < 3; i++) {
		const y = h * 0.74 + i * 34;
		chevrons += `<polyline points="${cx - 120},${y} ${cx},${y + 40} ${cx + 120},${y}" fill="none" stroke="#d8b25e" stroke-width="12"/>`;
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<defs>${noise('wv', 0.6, 0.9, 2, 31, hex('#0b2524'), 1.5, -0.5)}${noise('mt', 0.008, 0.012, 3, 33, hex('#6fb8b0'), 1.3, -0.62)}</defs>
<rect width="100%" height="100%" fill="${TEAL}"/>
<rect width="100%" height="100%" filter="url(#mt)"/>
<rect x="22" y="22" width="${w - 44}" height="${h - 44}" fill="none" stroke="#c99a45" stroke-width="18"/>
<rect x="48" y="48" width="${w - 96}" height="${h - 96}" fill="none" stroke="${TEAL_DARK}" stroke-width="6"/>
<circle cx="${cx}" cy="${cy}" r="${w * 0.3}" fill="${TEAL_DARK}" stroke="#d8b25e" stroke-width="10"/>
${star(w * 0.27, w * 0.08, 8, '#e2c27a')}${star(w * 0.17, w * 0.05, 4, '#f0dca8')}
<circle cx="${cx}" cy="${cy}" r="${w * 0.045}" fill="#7a2e22"/>
${chevrons}
<rect width="100%" height="100%" filter="url(#wv)"/>
</svg>`;
}

/** @param {string} svg @param {number} [size] square resize (omit to keep the svg size) */
export async function jpeg(svg, size) {
	let img = sharp(Buffer.from(svg));
	if (size) img = img.resize(size, size, { fit: 'fill' });
	return img.jpeg({ quality: 86 }).toBuffer();
}
