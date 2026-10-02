// Tileable paving textures for the street pieces: cobbles (rounded stones in staggered rows)
// and flagstones (big rectangular slabs). A jittered, row-staggered point set on a TORUS
// (every distance wraps) gives Voronoi cells that continue across the texture's edges, so a
// road built from many 2 × 2 m tiles shows one continuous pavement with no seam at the
// joints — something a per-tile Meshy texture atlas cannot do.
//
// Per pixel: F1/F2 (nearest / second-nearest cell distances) → the gap between them is the
// joint; a soft dome inside each stone is the height; the albedo is a per-stone tint plus
// fine grain, darkened into the joints; the normal map is the height's finite difference.
// slabs() lays rectangular flagstones in running-bond rows (a Chebyshev Voronoi ties over
// whole regions and paints them as joint).
import { createRequire } from 'node:module';
import { TOOLS } from './kit-post.mjs';

const sharp = createRequire(`${TOOLS}/package.json`)('sharp');

/** small deterministic PRNG (mulberry32) */
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** value noise on a wrapped lattice (period = `cells`), smooth-stepped, 0..1 */
function wrapNoise(seed, cells) {
	const r = rng(seed);
	const g = Float32Array.from({ length: cells * cells }, r);
	const at = (i, j) => g[((j % cells) + cells) % cells * cells + (((i % cells) + cells) % cells)];
	return (u, v) => {
		const x = u * cells;
		const y = v * cells;
		const i = Math.floor(x);
		const j = Math.floor(y);
		const fx = x - i;
		const fy = y - j;
		const sx = fx * fx * (3 - 2 * fx);
		const sy = fy * fy * (3 - 2 * fy);
		const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
		const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
		return a + (b - a) * sy;
	};
}

const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/**
 * @param {{size?: number, rows: number, cols: number, jitter?: number, stagger?: number,
 *   metric?: 'euclid'|'cheb', joint?: number, dome?: number, palette: string[], grout: string,
 *   seed?: number, aspect?: number}} o
 *   rows × cols cells over the texture (which spans the piece's UV period); `joint` = joint
 *   half-width in cell units; `palette` = stone tints picked per cell.
 * @returns {Promise<{albedo: Uint8Array, normal: Uint8Array}>} JPEG bytes
 */
export async function stones(o) {
	const N = o.size ?? 1024;
	const R = rng(o.seed ?? 7);
	const jitter = o.jitter ?? 0.3;
	const stagger = o.stagger ?? 0.5;
	const pts = [];
	for (let r = 0; r < o.rows; r++) {
		for (let c = 0; c < o.cols; c++) {
			const x = (c + 0.5 + (r % 2) * stagger + (R() - 0.5) * jitter) / o.cols;
			const y = (r + 0.5 + (R() - 0.5) * jitter * 0.6) / o.rows;
			pts.push({ x: ((x % 1) + 1) % 1, y, tint: Math.floor(R() * o.palette.length), shade: 0.82 + R() * 0.3, tilt: [R() - 0.5, R() - 0.5] });
		}
	}
	// cell-space scale: distances measured in "cell widths" so the joint is the same on both axes
	const sx = o.cols;
	const sy = o.rows;
	// bucket points into the rows×cols grid for a 3×3 neighbourhood search
	const grid = Array.from({ length: o.rows * o.cols }, () => []);
	for (const p of pts) grid[Math.min(o.rows - 1, Math.floor(p.y * o.rows)) * o.cols + Math.min(o.cols - 1, Math.floor(p.x * o.cols))].push(p);
	const pal = o.palette.map(hexRGB);
	const grout = hexRGB(o.grout);
	const grain = wrapNoise((o.seed ?? 7) + 11, 256);
	const mottle = wrapNoise((o.seed ?? 7) + 23, 8);
	const joint = o.joint ?? 0.07;
	const dome = o.dome ?? 0.35;
	const H = new Float32Array(N * N);
	const rgb = Buffer.alloc(N * N * 3);
	for (let py = 0; py < N; py++) {
		const v = (py + 0.5) / N;
		const gr = Math.floor(v * o.rows);
		for (let px = 0; px < N; px++) {
			const u = (px + 0.5) / N;
			const gc = Math.floor(u * o.cols);
			let d1 = 1e9;
			let d2 = 1e9;
			let best = null;
			for (let dr = -2; dr <= 2; dr++) {
				const rr = (((gr + dr) % o.rows) + o.rows) % o.rows;
				for (let dc = -2; dc <= 2; dc++) {
					const cc = (((gc + dc) % o.cols) + o.cols) % o.cols;
					for (const p of grid[rr * o.cols + cc]) {
						let dx = p.x - u;
						let dy = p.y - v;
						dx -= Math.round(dx); // torus wrap
						dy -= Math.round(dy);
						dx *= sx;
						dy *= sy * (o.aspect ?? 1);
						const d = o.metric === 'cheb' ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.hypot(dx, dy);
						if (d < d1) {
							d2 = d1;
							d1 = d;
							best = p;
						} else if (d < d2) d2 = d;
					}
				}
			}
			const edge = (d2 - d1) / 2; // distance to the joint, in cell units
			const inStone = Math.min(1, Math.max(0, (edge - joint) / dome));
			const g = grain(u, v);
			const m = mottle(u, v);
			// height: 0 in the joint, a rounded dome inside the stone, a little grain on top
			const h = inStone > 0 ? Math.sqrt(inStone * (2 - inStone)) * 0.85 + g * 0.15 : 0;
			H[py * N + px] = h;
			const t = pal[best.tint];
			const k = best.shade * (0.86 + 0.22 * g) * (0.92 + 0.16 * m);
			const ao = 0.55 + 0.45 * Math.min(1, inStone * 2.2); // darker towards the joint
			const i = (py * N + px) * 3;
			if (edge < joint) {
				const kg = 0.8 + 0.4 * g;
				rgb[i] = grout[0] * kg;
				rgb[i + 1] = grout[1] * kg;
				rgb[i + 2] = grout[2] * kg;
			} else {
				rgb[i] = Math.min(255, t[0] * k * ao);
				rgb[i + 1] = Math.min(255, t[1] * k * ao);
				rgb[i + 2] = Math.min(255, t[2] * k * ao);
			}
		}
	}
	return encode(N, H, rgb, o.normalStrength ?? 6);
}

/**
 * Rectangular slabs in running-bond rows (flagstones, crossing slabs): `rows` rows over the
 * period, each row cut into slabs of random length (min..max, in fractions of the period) with
 * the last cut wrapping, so the texture tiles. Same outputs as stones().
 * @param {{size?: number, rows: number, min: number, max: number, joint: number, bevel: number,
 *   palette: string[], grout: string, seed?: number, normalStrength?: number}} o  joint/bevel in UV units
 */
export async function slabs(o) {
	const N = o.size ?? 1024;
	const R = rng(o.seed ?? 5);
	const rows = [];
	for (let r = 0; r < o.rows; r++) {
		const start = R();
		const cuts = [];
		let x = 0;
		while (x < 1 - o.min) {
			cuts.push((start + x) % 1);
			x += o.min + R() * (o.max - o.min);
		}
		cuts.sort((a, b) => a - b);
		rows.push({ cuts, tints: cuts.map(() => ({ t: Math.floor(R() * o.palette.length), shade: 0.85 + R() * 0.25 })) });
	}
	const pal = o.palette.map(hexRGB);
	const grout = hexRGB(o.grout);
	const grain = wrapNoise((o.seed ?? 5) + 11, 256);
	const mottle = wrapNoise((o.seed ?? 5) + 23, 8);
	const H = new Float32Array(N * N);
	const rgb = Buffer.alloc(N * N * 3);
	const rh = 1 / o.rows;
	for (let py = 0; py < N; py++) {
		const v = (py + 0.5) / N;
		const ri = Math.min(o.rows - 1, Math.floor(v / rh));
		const row = rows[ri];
		const dy = Math.min(v - ri * rh, (ri + 1) * rh - v);
		for (let px = 0; px < N; px++) {
			const u = (px + 0.5) / N;
			// the slab: the last cut at or before u (wrapping)
			let k = row.cuts.length - 1;
			for (let c = 0; c < row.cuts.length; c++) if (row.cuts[c] <= u) k = c;
			const a = row.cuts[k];
			const b = row.cuts[(k + 1) % row.cuts.length];
			const da = (u - a + 1) % 1;
			const db = (b - u + 1) % 1;
			const edge = Math.min(dy, da, db);
			const g = grain(u, v);
			const m = mottle(u, v);
			const inStone = Math.min(1, Math.max(0, (edge - o.joint) / o.bevel));
			H[py * N + px] = inStone > 0 ? Math.sqrt(inStone * (2 - inStone)) * 0.9 + g * 0.1 : 0;
			const i = (py * N + px) * 3;
			if (edge < o.joint) {
				const kg = 0.8 + 0.4 * g;
				rgb[i] = grout[0] * kg;
				rgb[i + 1] = grout[1] * kg;
				rgb[i + 2] = grout[2] * kg;
			} else {
				const s = row.tints[k];
				const t = pal[s.t];
				const kk = s.shade * (0.9 + 0.15 * g) * (0.92 + 0.16 * m) * (0.75 + 0.25 * inStone);
				rgb[i] = Math.min(255, t[0] * kk);
				rgb[i + 1] = Math.min(255, t[1] * kk);
				rgb[i + 2] = Math.min(255, t[2] * kk);
			}
		}
	}
	return encode(N, H, rgb, o.normalStrength ?? 3);
}

/** albedo + normal-map JPEGs from a height field and colours */
async function encode(N, H, rgb, strength) {
	const nrm = Buffer.alloc(N * N * 3);
	for (let y = 0; y < N; y++) {
		for (let x = 0; x < N; x++) {
			const hx = H[y * N + ((x + 1) % N)] - H[y * N + ((x - 1 + N) % N)];
			const hy = H[((y + 1) % N) * N + x] - H[((y - 1 + N) % N) * N + x];
			const nx = -hx * strength;
			const ny = hy * strength; // image y runs down, texture v runs up
			const l = Math.hypot(nx, ny, 1);
			const i = (y * N + x) * 3;
			nrm[i] = ((nx / l) * 0.5 + 0.5) * 255;
			nrm[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
			nrm[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
		}
	}
	const raw = { raw: { width: N, height: N, channels: /** @type {3} */ (3) } };
	return {
		albedo: new Uint8Array(await sharp(rgb, raw).jpeg({ quality: 86 }).toBuffer()),
		normal: new Uint8Array(await sharp(nrm, raw).jpeg({ quality: 90 }).toBuffer())
	};
}

/** the kit's paving: one texture period = one 2 × 2 m tile (UV 0..1 over 2 m) */
export const PAVING = {
	// rounded grey-brown cobbles, ~11 cm rows
	cobble: () => stones({ rows: 18, cols: 15, jitter: 0.35, palette: ['#8a8580', '#7d7871', '#948b7f', '#6f6c69', '#9a9286'], grout: '#3b352e', joint: 0.06, dome: 0.32, seed: 3 }),
	// warm sandstone flags, 4 × 5 slabs per tile
	flags: () => slabs({ rows: 5, min: 0.18, max: 0.34, joint: 0.004, bevel: 0.012, palette: ['#b9a888', '#c4b393', '#a89878', '#bfae8c'], grout: '#5e5243', seed: 9 }),
	// pale limestone crossing slabs (long, laid across the road)
	pale: () => slabs({ rows: 8, min: 0.3, max: 0.55, joint: 0.004, bevel: 0.01, palette: ['#ddd5c4', '#d2c9b6', '#e6dfd0'], grout: '#6b6152', seed: 13 })
};
