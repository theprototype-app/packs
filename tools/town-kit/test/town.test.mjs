// node --test tools/town-kit/test/ — the procedural half of town-kit, no credits, no Meshy:
// the paving textures tile with no seam, the street tiles are exactly 2 × 2 m on a bottom-centre
// pivot, no piece (and no two neighbouring fence sections) has two same-facing faces on one
// plane overlapping (the z-fight that shimmers only while the camera moves — K1), and the
// garden gate is a P2 door: frame + a Leaf on the hinge, open/close clips, behavior extras.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { TOOLS } from '../kit-post.mjs';
import { PAVING } from '../stones.mjs';
import { PIECES, GATE, writePiece } from '../procedural.mjs';

const req = createRequire(path.join(TOOLS, 'package.json'));
const load = async (/** @type {string} */ id) => import(pathToFileURL(req.resolve(id)).href);
const { NodeIO } = await load('@gltf-transform/core');
const { getBounds } = await load('@gltf-transform/functions');
const sharp = (await load('sharp')).default;
const io = new NodeIO();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'town-test-'));

/** a piece's document @param {string} name */
async function docOf(name) {
	const f = path.join(tmp, `${name}.glb`);
	await writePiece(name, f);
	return io.read(f);
}

/** world triangles of every static mesh (node translation applied; the gate's Leaf at rest)
 * @returns {{p: number[][], n: number[]}[]} */
function triangles(doc, offset = [0, 0, 0]) {
	const out = [];
	for (const node of doc.getRoot().listScenes()[0].listChildren()) {
		const t = node.getTranslation();
		for (const prim of node.getMesh()?.listPrimitives() ?? []) {
			const pos = prim.getAttribute('POSITION');
			const idx = prim.getIndices();
			const count = idx ? idx.getCount() : pos.getCount();
			const v = [0, 0, 0];
			const at = (i) => {
				pos.getElement(idx ? idx.getScalar(i) : i, v);
				return [v[0] + t[0] + offset[0], v[1] + t[1] + offset[1], v[2] + t[2] + offset[2]];
			};
			for (let i = 0; i < count; i += 3) {
				const p = [at(i), at(i + 1), at(i + 2)];
				const e1 = p[1].map((x, k) => x - p[0][k]);
				const e2 = p[2].map((x, k) => x - p[0][k]);
				const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
				const l = Math.hypot(...n);
				if (l < 1e-9) continue;
				out.push({ p, n: n.map((x) => x / l) });
			}
		}
	}
	return out;
}

/** the area (m²) two coplanar triangles share: both projected onto the plane's dominant axes,
 * then Sutherland-Hodgman clipping of one by the other */
function overlapArea(A, B) {
	const ax = A.n.map(Math.abs);
	const drop = ax[0] >= ax[1] && ax[0] >= ax[2] ? 0 : ax[1] >= ax[2] ? 1 : 2;
	const [u, v] = [0, 1, 2].filter((k) => k !== drop);
	const ccw = (poly) => (area2(poly) < 0 ? poly.slice().reverse() : poly);
	const P = ccw(A.p.map((q) => [q[u], q[v]]));
	const Q = ccw(B.p.map((q) => [q[u], q[v]]));
	let out = P;
	for (let i = 0; i < Q.length && out.length; i++) {
		const a = Q[i];
		const b = Q[(i + 1) % Q.length];
		const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
		const inp = out;
		out = [];
		for (let k = 0; k < inp.length; k++) {
			const c = inp[k];
			const d = inp[(k + 1) % inp.length];
			const sc = side(c);
			const sd = side(d);
			if (sc >= 0) out.push(c);
			if ((sc >= 0) !== (sd >= 0)) {
				const t = sc / (sc - sd);
				out.push([c[0] + t * (d[0] - c[0]), c[1] + t * (d[1] - c[1])]);
			}
		}
	}
	// back to plane area: the projection shrinks it by |n[drop]|
	return out.length >= 3 ? Math.abs(area2(out)) / 2 / ax[drop] : 0;
}
const area2 = (poly) => poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1], 0);

/** pairs of same-facing coplanar triangles from DIFFERENT parts that overlap (z-fight) */
function zFights(trisA, trisB = null) {
	const key = (t) => {
		const d = t.n[0] * t.p[0][0] + t.n[1] * t.p[0][1] + t.n[2] * t.p[0][2];
		return `${t.n.map((x) => Math.round(x * 1000)).join(',')}|${Math.round(d * 2000)}`;
	};
	const groups = new Map();
	const all = trisB ? [...trisA.map((t) => ({ ...t, s: 0 })), ...trisB.map((t) => ({ ...t, s: 1 }))] : trisA.map((t, i) => ({ ...t, s: t.s ?? i }));
	for (const t of all) {
		const k = key(t);
		if (!groups.has(k)) groups.set(k, []);
		groups.get(k).push(t);
	}
	let fights = 0;
	for (const g of groups.values()) {
		for (let i = 0; i < g.length; i++) {
			for (let j = i + 1; j < g.length; j++) {
				if (g[i].s === g[j].s) continue;
				if (overlapArea(g[i], g[j]) > 1e-6) fights++;
			}
		}
	}
	return fights;
}

/** every triangle of a piece tagged with the geometry (box, prism, tube …) it came from, so a
 * part's own coplanar triangles (a box face is two) never count — only DIFFERENT parts do */
function partsTagged(name) {
	const piece = PIECES[name]();
	const out = [];
	let part = 0;
	for (const { t, parts } of piece.nodes.values()) {
		for (const geos of parts.values()) {
			for (const g0 of geos) {
				const g = g0.index ? g0.toNonIndexed() : g0;
				const pos = g.attributes.position;
				for (let i = 0; i + 2 < pos.count; i += 3) {
					const p = [0, 1, 2].map((k) => [pos.getX(i + k) + t[0], pos.getY(i + k) + t[1], pos.getZ(i + k) + t[2]]);
					const e1 = p[1].map((x, k) => x - p[0][k]);
					const e2 = p[2].map((x, k) => x - p[0][k]);
					const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
					const l = Math.hypot(...n);
					if (l > 1e-9) out.push({ p, n: n.map((x) => x / l), s: part });
				}
				part++;
			}
		}
	}
	return out;
}

test('paving textures tile: the wrap-around seam is no stronger than any neighbouring column', async () => {
	for (const k of Object.keys(PAVING)) {
		const { albedo } = await PAVING[k]();
		const { data, info } = await sharp(Buffer.from(albedo)).raw().toBuffer({ resolveWithObject: true });
		const W = info.width;
		const col = (x) => {
			let s = 0;
			for (let y = 0; y < info.height; y++) for (let c = 0; c < 3; c++) s += Math.abs(data[(y * W + x) * 3 + c] - data[(y * W + ((x + 1) % W)) * 3 + c]);
			return s / info.height;
		};
		const typical = [100, 300, 500, 700].map(col).reduce((a, b) => a + b) / 4;
		const seam = col(W - 1);
		assert.ok(seam < typical * 2, `${k}: seam column diff ${seam.toFixed(1)} vs typical ${typical.toFixed(1)}`);
	}
});

test('street tiles are exactly 2 × 2 m, bottom-centre pivot, curb top = sidewalk top', async () => {
	const tops = {};
	for (const name of ['Road', 'RoadCurb', 'RoadCorner', 'RoadCrossing', 'Sidewalk']) {
		const b = getBounds((await docOf(name)).getRoot().listScenes()[0]);
		assert.deepEqual([b.min[0], b.min[1], b.min[2], b.max[0], b.max[2]].map((v) => +v.toFixed(6) + 0), [-1, 0, -1, 1, 1], name);
		tops[name] = +b.max[1].toFixed(6);
	}
	assert.equal(tops.Road, 0.2);
	assert.equal(tops.RoadCrossing, 0.2);
	assert.equal(tops.RoadCurb, tops.Sidewalk);
	assert.equal(tops.Sidewalk, 0.35);
});

test('no piece has overlapping same-facing coplanar faces (moving-camera z-fight)', async () => {
	for (const name of Object.keys(PIECES)) {
		const fights = zFights(partsTagged(name));
		assert.equal(fights, 0, `${name}: ${fights} z-fighting triangle pairs`);
	}
});

test('two fence sections side by side never stack posts (half posts meet back to back)', async () => {
	const doc = await docOf('Fence');
	const fights = zFights(triangles(doc), triangles(doc, [2, 0, 0]));
	assert.equal(fights, 0, `fence + fence: ${fights} z-fighting pairs at the joint`);
	const gate = await docOf('FenceGate');
	assert.equal(zFights(triangles(gate), triangles(doc, [2, 0, 0])), 0, 'gate + fence');
	assert.equal(zFights(triangles(doc, [-2, 0, 0]), triangles(gate)), 0, 'fence + gate');
});

test('the garden gate is a P2 door: static frame, Leaf on the hinge, open/close clips', async () => {
	const doc = await docOf('FenceGate');
	const leaf = doc.getRoot().listNodes().find((n) => n.getName() === 'Leaf');
	assert.ok(leaf, 'a Leaf node');
	assert.deepEqual(leaf.getTranslation(), [GATE.hinge, 0, 0]);
	const anims = Object.fromEntries(doc.getRoot().listAnimations().map((a) => [a.getName(), a]));
	assert.deepEqual(Object.keys(anims).sort(), ['close', 'open']);
	for (const [name, a] of Object.entries(anims)) {
		const ch = a.listChannels();
		assert.equal(ch.length, 1, `${name}: one channel`);
		assert.equal(ch[0].getTargetNode(), leaf, `${name} animates the Leaf only (the frame stays)`);
		assert.equal(ch[0].getTargetPath(), 'rotation');
		const out = ch[0].getSampler().getOutput();
		const last = out.getElement(out.getCount() - 1, []);
		const deg = (2 * Math.atan2(last[1], last[3]) * 180) / Math.PI;
		assert.ok(Math.abs(deg - (name === 'open' ? GATE.open : 0)) < 0.01, `${name} ends at ${deg.toFixed(2)}°`);
	}
	// closed, the leaf fits between the posts (inner faces at ±0.88)
	const b = getBounds(leaf);
	assert.ok(b.min[0] >= -0.88 && b.max[0] <= 0.88, `leaf spans ${b.min[0].toFixed(3)}…${b.max[0].toFixed(3)}`);
});

test('collider hints ride the scene extras (static pieces) and the gate has none', async () => {
	const want = { Road: 'box', Sidewalk: 'box', Fence: 'box', Bridge: 'hull', BannerPole: 'cylinder' };
	for (const [name, hint] of Object.entries(want)) assert.equal((await docOf(name)).getRoot().listScenes()[0].getExtras().colliderHint, hint, name);
	assert.equal((await docOf('FenceGate')).getRoot().listScenes()[0].getExtras().colliderHint, undefined);
});
