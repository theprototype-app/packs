// Procedural textures for the hand-built interior-kit pieces (trims, wainscot, lamps,
// rugs, the picture, the books). Each is an SVG rasterised by sharp (librsvg) → JPEG.
// feTurbulence with stitchTiles makes the material swatches tile seamlessly; the rug,
// the painting and the book-spine atlas are single non-tiling layouts. Palette = the
// locked art direction (oak, iron, brass, sandstone, slate, cream linen) and the pack's
// ONE accent colour — DEEP TEAL (painted wainscot, upholstery, the rug field, the shade).
// Forked from props-kit/_src/textures.mjs (same swatch recipe, so the kits match).
import { createRequire } from 'node:module';

const TOOLS = process.env.MESHY_TOOLS ?? new URL('../../tools/meshy', import.meta.url).pathname;
const sharp = createRequire(`${TOOLS}/package.json`)('sharp');

export const TEAL = '#1f5c5a';
export const TEAL_LIGHT = '#2f7a76';
export const TEAL_DARK = '#123a39';
const CREAM = '#e4d3ad';
const OXBLOOD = '#6e2a20';
const OCHRE = '#b58a3a';

/** a coloured noise layer: `a` = alpha gain, `b` = alpha bias of the noise's R channel */
const noise = (id, fx, fy, oct, seed, rgb, a, b) => `
<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
 <feTurbulence type="fractalNoise" baseFrequency="${fx} ${fy}" numOctaves="${oct}" seed="${seed}" stitchTiles="stitch"/>
 <feColorMatrix type="matrix" values="0 0 0 0 ${rgb[0]}  0 0 0 0 ${rgb[1]}  0 0 0 0 ${rgb[2]}  ${a} 0 0 0 ${b}"/>
</filter>`;

const hex = (h) => [1, 3, 5].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3));

/** a tileable swatch: base fill + streak/grain noise + fine speckle (+ plank joints) */
function swatch({ base, light, dark, fx = 0.004, fy = 0.07, seed = 2, planks = 0, size = 512 }) {
	const L = hex(light);
	const D = hex(dark);
	let lines = '';
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
	oak: () => swatch({ base: '#74492a', light: '#a06f45', dark: '#4a2b15' }),
	oakDark: () => swatch({ base: '#4e2f1a', light: '#74492a', dark: '#2c190c', seed: 8 }),
	oakPlanks: () => swatch({ base: '#74492a', light: '#a06f45', dark: '#3e220f', planks: 4, seed: 5 }),
	iron: () => swatch({ base: '#3e3a37', light: '#615b55', dark: '#221f1d', fx: 0.02, fy: 0.02, seed: 9 }),
	brass: () => swatch({ base: '#a47a36', light: '#cfa45a', dark: '#6e4e1e', fx: 0.015, fy: 0.03, seed: 4 }),
	plaster: () => swatch({ base: '#d9ccb4', light: '#ebe1cc', dark: '#a89a80', fx: 0.02, fy: 0.02, seed: 41 }),
	/** painted wood: deep teal over a faint grain (the wainscot, the lamp shade's trim) */
	tealPaint: () => swatch({ base: TEAL, light: '#26696a', dark: '#174a48', fx: 0.003, fy: 0.03, seed: 17 }),
	/** woven fabric: the floor-lamp shade */
	tealCloth: () => swatch({ base: '#245f5c', light: '#3a827d', dark: '#123a39', fx: 0.25, fy: 0.25, seed: 43 }),
	linen: () => swatch({ base: '#e8dcc0', light: '#f6eedb', dark: '#b9a982', fx: 0.3, fy: 0.3, seed: 47 }),
	wax: () => swatch({ base: '#efe4c8', light: '#fbf4e2', dark: '#cdbd98', fx: 0.05, fy: 0.05, seed: 51 }),
	ceramic: () => swatch({ base: '#e9e2d2', light: '#fbf8ef', dark: '#bdb4a2', fx: 0.02, fy: 0.02, seed: 53 })
};

/** the round rug: concentric deep-teal field, cream and oxblood bands, a star medallion (no text) */
export function roundRugSvg(s = 1024) {
	const c = s / 2;
	const ring = (r, w, col, op = 1) => `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${col}" stroke-width="${w}" opacity="${op}"/>`;
	let dots = '';
	for (let i = 0; i < 36; i++) {
		const a = (i * Math.PI * 2) / 36;
		const r = s * 0.405;
		dots += `<circle cx="${(c + r * Math.cos(a)).toFixed(1)}" cy="${(c + r * Math.sin(a)).toFixed(1)}" r="${s * 0.012}" fill="${CREAM}"/>`;
	}
	let petals = '';
	for (let i = 0; i < 12; i++) {
		const a = (i * 360) / 12;
		petals += `<ellipse cx="${c}" cy="${c - s * 0.17}" rx="${s * 0.03}" ry="${s * 0.07}" fill="${OCHRE}" transform="rotate(${a} ${c} ${c})"/>`;
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">
<defs>${noise('wv', 0.9, 0.9, 2, 61, hex('#0b1e1d'), 1.6, -0.55)}${noise('mt', 0.01, 0.01, 3, 63, hex('#6fb0aa'), 0.9, -0.5)}</defs>
<rect width="100%" height="100%" fill="${CREAM}"/>
<circle cx="${c}" cy="${c}" r="${s * 0.5}" fill="${TEAL}"/>
${ring(s * 0.47, s * 0.03, CREAM)}${ring(s * 0.44, s * 0.012, OXBLOOD)}${dots}${ring(s * 0.37, s * 0.014, CREAM)}
<circle cx="${c}" cy="${c}" r="${s * 0.25}" fill="${TEAL_DARK}" stroke="${CREAM}" stroke-width="${s * 0.012}"/>
${petals}
<circle cx="${c}" cy="${c}" r="${s * 0.09}" fill="${OXBLOOD}" stroke="${CREAM}" stroke-width="${s * 0.01}"/>
<circle cx="${c}" cy="${c}" r="${s * 0.035}" fill="${CREAM}"/>
<rect width="100%" height="100%" filter="url(#mt)"/>
<rect width="100%" height="100%" filter="url(#wv)"/>
</svg>`;
}

/** the painting: an abstract landscape — sky, hills, a lake, a few trees, a low sun. No text. */
export function landscapeSvg(w = 1024, h = 720) {
	let trees = '';
	for (const [x, y, k] of [[0.18, 0.66, 1], [0.24, 0.68, 0.8], [0.72, 0.6, 0.9], [0.78, 0.62, 1.1], [0.83, 0.6, 0.7]]) {
		const tx = x * w;
		const ty = y * h;
		trees += `<rect x="${tx - 4 * k}" y="${ty}" width="${8 * k}" height="${28 * k}" fill="#3a2a1a"/><ellipse cx="${tx}" cy="${ty - 18 * k}" rx="${26 * k}" ry="${38 * k}" fill="#2f4a2c"/><ellipse cx="${tx - 8 * k}" cy="${ty - 26 * k}" rx="${14 * k}" ry="${18 * k}" fill="#4a6a3a" opacity="0.8"/>`;
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f93a8"/><stop offset="0.55" stop-color="#e3c99a"/><stop offset="1" stop-color="#e9b77a"/></linearGradient>
<linearGradient id="lake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fb0b5"/><stop offset="1" stop-color="${TEAL}"/></linearGradient>
${noise('br', 0.02, 0.06, 3, 71, hex('#2b2116'), 1.0, -0.45)}${noise('cv', 0.6, 0.6, 2, 73, hex('#f4ead2'), 0.8, -0.45)}
</defs>
<rect width="100%" height="100%" fill="url(#sky)"/>
<circle cx="${w * 0.62}" cy="${h * 0.42}" r="${h * 0.07}" fill="#f6e2b0"/>
<path d="M0 ${h * 0.55} Q ${w * 0.2} ${h * 0.38} ${w * 0.42} ${h * 0.52} T ${w} ${h * 0.47} V ${h} H 0 Z" fill="#7c8a72"/>
<path d="M0 ${h * 0.62} Q ${w * 0.35} ${h * 0.5} ${w * 0.6} ${h * 0.6} T ${w} ${h * 0.58} V ${h} H 0 Z" fill="#5d7650"/>
<path d="M${w * 0.3} ${h * 0.74} Q ${w * 0.5} ${h * 0.68} ${w * 0.72} ${h * 0.74} Q ${w * 0.55} ${h * 0.84} ${w * 0.3} ${h * 0.74} Z" fill="url(#lake)"/>
<path d="M0 ${h * 0.8} Q ${w * 0.25} ${h * 0.72} ${w * 0.5} ${h * 0.86} T ${w} ${h * 0.8} V ${h} H 0 Z" fill="#46603c"/>
${trees}
<rect width="100%" height="100%" filter="url(#br)"/>
<rect width="100%" height="100%" filter="url(#cv)" opacity="0.25"/>
</svg>`;
}

/** Book-spine atlas: a COLS × ROWS grid of cloth/leather spines (gold bands, no titles),
 * so every book on a shelf shares ONE material (one draw call) and picks a cell by UV. */
export const BOOK_ATLAS = { cols: 4, rows: 3, pages: 8 };
export function bookAtlasSvg(w = 512, h = 512) {
	const cols = [OXBLOOD, TEAL, '#3f5a3a', OCHRE, '#5a3a24', TEAL_DARK, '#7a6a52', '#2e3a4a'];
	const cw = w / BOOK_ATLAS.cols;
	const ch = h / BOOK_ATLAS.rows;
	let cells = '';
	cols.forEach((col, i) => {
		const x = (i % BOOK_ATLAS.cols) * cw;
		const y = Math.floor(i / BOOK_ATLAS.cols) * ch;
		cells += `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" fill="${col}"/>`;
		// gold bands near both ends of the spine (v runs along the spine's height)
		for (const f of [0.1, 0.16, 0.84, 0.9]) cells += `<rect x="${x}" y="${y + ch * f}" width="${cw}" height="${ch * 0.02}" fill="#d2a955" opacity="0.9"/>`;
		cells += `<rect x="${x + cw * 0.3}" y="${y + ch * 0.36}" width="${cw * 0.4}" height="${ch * 0.22}" fill="#000" opacity="0.18"/>`;
	});
	// cell 8 = the page block (cream, fine lines) for the books' top / bottom / fore-edge
	{
		const x = 0;
		const y = 2 * ch;
		cells += `<rect x="${x}" y="${y}" width="${w}" height="${ch}" fill="#e9dcbc"/>`;
		for (let i = 1; i < 24; i++) cells += `<rect x="${x}" y="${y + (i * ch) / 24}" width="${cw}" height="1" fill="#b9a982" opacity="0.6"/>`;
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<defs>${noise('lt', 0.08, 0.02, 3, 81, hex('#000000'), 1.2, -0.6)}</defs>
${cells}
<rect width="100%" height="100%" filter="url(#lt)"/>
</svg>`;
}

/** @param {string} svg @param {number|[number,number]} [size] resize (omit to keep the svg size) */
export async function jpeg(svg, size) {
	let img = sharp(Buffer.from(svg));
	if (size) img = Array.isArray(size) ? img.resize(size[0], size[1], { fit: 'fill' }) : img.resize(size, size, { fit: 'fill' });
	return img.jpeg({ quality: 86 }).toBuffer();
}
