// rules: the pure halves of the pack checks (no file access) — what a row, a pivot, a behavior or a
// LOD list must look like. check.mjs feeds them measured numbers; test/rules.test.mjs proves each one
// red on a bad input.

/** core's behaviorCore.js enums (33 P2) — kept in step by hand; a new type needs core first */
export const BEHAVIOR_TYPES = ['door', 'toggle', 'oneshot', 'loop'];
export const BEHAVIOR_TRIGGERS = ['click', 'proximity', 'knock'];
const BEHAVIOR_KEYS = ['type', 'clip', 'closeClip', 'trigger', 'autoplay', 'sound', 'collider'];
/** core lodGroupCore MAX_LEVELS is 6 (LOD0 + 5 files) */
export const MAX_LOD_FILES = 5;
const ROW_KEYS = ['name', 'label', 'screenshot', 'variants', 'lods', 'behavior', 'size', 'box', 'tris', 'bytes', 'animated'];
const INDEX_KEYS = ['name', 'title', 'value', 'zip', 'attribution', 'copyright', 'license', 'source', 'cover'];
export const PIVOTS = ['bottom-center', 'bottom-center-back', 'top-center', 'wall-pivot', 'wall-face', 'foot', 'hinge', 'any'];

/** a repo-relative path that stays inside its folder @param {any} p */
export const safeRel = (p) => typeof p === 'string' && p.trim() !== '' && !p.includes('..') && !p.startsWith('/') && !/^[a-z]+:/i.test(p);
const isUrl = (/** @type {any} */ p) => typeof p === 'string' && /^https?:\/\//.test(p);

/**
 * One index.json row. @param {any} row @returns {string[]} problems
 */
export function indexRowProblems(row) {
	const out = [];
	if (!row || typeof row !== 'object') return ['not an object'];
	if (typeof row.name !== 'string' || !/^[a-z0-9_-]+$/i.test(row.name)) out.push('name must be a folder-safe string');
	if (typeof row.title !== 'string' || !row.title.trim()) out.push('title missing');
	if (!!row.value === !!row.zip) out.push('needs exactly one of value | zip');
	for (const k of ['value', 'attribution', 'cover']) if (row[k] !== undefined && !safeRel(row[k]) && !isUrl(row[k])) out.push(`${k} must be a repo-relative path or an https URL`);
	if (row.zip !== undefined && typeof row.zip !== 'string') out.push('zip must be a path');
	if (typeof row.attribution !== 'string') out.push('attribution missing');
	for (const k of ['copyright', 'license']) if (typeof row[k] !== 'string') out.push(`${k} must be a string ("" when none)`);
	if (!isUrl(row.source)) out.push('source must be an https URL');
	for (const k of Object.keys(row)) if (!INDEX_KEYS.includes(k)) out.push(`unknown key "${k}"`);
	return out;
}

/**
 * One item row of a pack's model list (default.json). Shape only; files are check.mjs's.
 * @param {any} row @returns {string[]}
 */
export function itemRowProblems(row) {
	const out = [];
	if (!row || typeof row !== 'object') return ['not an object'];
	if (typeof row.name !== 'string' || !/^[A-Za-z0-9_-]+$/.test(row.name)) out.push('name must be a folder-safe string');
	if (row.label !== undefined && typeof row.label !== 'string') out.push('label must be a string');
	if (row.screenshot !== undefined && !safeRel(row.screenshot) && !isUrl(row.screenshot)) out.push('screenshot must be a relative path or an https URL');
	const glb = row.variants?.['glTF-Binary'];
	if (typeof glb !== 'string' || !(safeRel(glb) || isUrl(glb))) out.push('variants["glTF-Binary"] must be a file name or an https URL');
	else if (!isUrl(glb) && !/\.glb$/i.test(glb)) out.push('variants["glTF-Binary"] must be a .glb');
	if (row.lods !== undefined) out.push(...lodsProblems(row.lods));
	if (row.behavior !== undefined) out.push(...behaviorProblems(row.behavior));
	out.push(...dimsShapeProblems(row));
	for (const k of Object.keys(row)) if (!ROW_KEYS.includes(k)) out.push(`unknown key "${k}"`);
	return out;
}

/**
 * The `lods` field (contract P1): [{file, ratio}], finest first. Core silently DROPS a bad entry,
 * so the CI is strict where the app is lenient. @param {any} lods @returns {string[]}
 */
export function lodsProblems(lods) {
	if (!Array.isArray(lods) || !lods.length) return ['lods must be a non-empty array'];
	const out = [];
	if (lods.length > MAX_LOD_FILES) out.push(`lods: at most ${MAX_LOD_FILES} files (core draws LOD0 + ${MAX_LOD_FILES})`);
	let prev = 1;
	lods.forEach((l, i) => {
		if (!l || typeof l !== 'object') return out.push(`lods[${i}] is not an object`);
		if (!safeRel(l.file) || !/\.glb$/i.test(l.file) || l.file.includes('/')) out.push(`lods[${i}].file must be a .glb beside LOD0 (no folders, no ..)`);
		if (typeof l.ratio !== 'number' || !(l.ratio > 0 && l.ratio <= 1)) out.push(`lods[${i}].ratio must be a number in (0, 1]`);
		else if (l.ratio > prev) out.push(`lods[${i}].ratio ${l.ratio} is coarser-first: list levels finest first`);
		else prev = l.ratio;
		for (const k of Object.keys(l)) if (k !== 'file' && k !== 'ratio') out.push(`lods[${i}]: unknown key "${k}"`);
	});
	return out;
}

/**
 * The `behavior` field (33 P2). Core normalizes (an unknown trigger becomes 'click', an autoplay on a
 * door is ignored); the CI refuses instead, so a typo cannot ship as a silent default.
 * @param {any} b @returns {string[]}
 */
export function behaviorProblems(b) {
	if (!b || typeof b !== 'object' || Array.isArray(b)) return ['behavior must be an object'];
	const out = [];
	if (!BEHAVIOR_TYPES.includes(b.type)) out.push(`behavior.type must be one of ${BEHAVIOR_TYPES.join('|')}`);
	if (typeof b.clip !== 'string' || !b.clip.trim() || b.clip.length > 64) out.push('behavior.clip must be a clip name (1-64 chars)');
	if (b.trigger !== undefined && !BEHAVIOR_TRIGGERS.includes(b.trigger)) out.push(`behavior.trigger must be one of ${BEHAVIOR_TRIGGERS.join('|')}`);
	if (b.autoplay !== undefined && typeof b.autoplay !== 'boolean') out.push('behavior.autoplay must be true or false');
	if (b.autoplay === true && b.type !== 'loop') out.push('behavior.autoplay is only for type "loop" (nothing else plays on placement)');
	if (b.closeClip !== undefined) {
		if (b.type !== 'door' && b.type !== 'toggle') out.push('behavior.closeClip is only for door / toggle');
		else if (typeof b.closeClip !== 'string' || !b.closeClip.trim()) out.push('behavior.closeClip must be a clip name');
		else if (b.closeClip === b.clip) out.push('behavior.closeClip equals clip (leave it out to play clip backwards)');
	}
	if (b.sound !== undefined && (typeof b.sound !== 'string' || !b.sound.trim())) out.push('behavior.sound must be a game-sound name');
	if (b.collider !== undefined && b.collider !== 'follow') out.push('behavior.collider must be "follow" (or absent)');
	for (const k of Object.keys(b)) if (!BEHAVIOR_KEYS.includes(k)) out.push(`behavior: unknown key "${k}"`);
	return out;
}

/** the clips a behavior needs, all present in the GLB? @param {any} b @param {string[]} clips */
export function behaviorClipProblems(b, clips) {
	const out = [];
	for (const k of ['clip', 'closeClip']) if (typeof b?.[k] === 'string' && !clips.includes(b[k])) out.push(`behavior.${k} "${b[k]}" is not a clip of the GLB (has: ${clips.join(', ') || 'none'})`);
	return out;
}

/** tolerance: absolute floor or a share of the extent, whichever is larger */
const tol = (/** @type {number} */ extent, /** @type {number} */ share, /** @type {number} */ floor) => Math.max(floor, share * extent);

/**
 * Where the origin sits in the bbox, per axis. centre: within max(3 cm, 10 % of the extent) of the
 * middle; a face: within max(2 cm, 2 %) of it.
 * @param {number[]} min @param {number[]} max
 */
export function pivotOf(min, max) {
	/** @param {number} i */
	const axis = (i) => {
		const e = max[i] - min[i];
		const c = (min[i] + max[i]) / 2;
		const f = tol(e, 0.02, 0.02);
		return { centre: Math.abs(c) <= tol(e, 0.1, 0.03), min: Math.abs(min[i]) <= f, max: Math.abs(max[i]) <= f, above: min[i] >= -f, inside: min[i] <= 0.05 && max[i] >= -0.05 };
	};
	return { x: axis(0), y: axis(1), z: axis(2) };
}

/**
 * Does the bbox satisfy the declared pivot rule? @param {number[]} min @param {number[]} max
 * @param {string} rule @returns {string | null} what is wrong, null when it holds
 */
export function pivotProblem(min, max, rule) {
	const p = pivotOf(min, max);
	const at = `bbox x ${min[0].toFixed(2)}..${max[0].toFixed(2)}, y ${min[1].toFixed(2)}..${max[1].toFixed(2)}, z ${min[2].toFixed(2)}..${max[2].toFixed(2)}`;
	switch (rule) {
		case 'any':
			return null;
		case 'bottom-center':
			return p.x.centre && p.z.centre && p.y.min ? null : `pivot is not bottom-centre (${at})`;
		case 'bottom-center-back':
			return p.x.centre && p.z.min && p.y.min ? null : `pivot is not bottom-centre-back (${at})`;
		case 'top-center':
			return p.x.centre && p.z.centre && p.y.max ? null : `pivot is not top-centre (${at})`;
		case 'wall-pivot':
			return p.x.centre && p.z.centre && p.y.above ? null : `pivot is not the wall's bottom-centre (${at})`;
		case 'wall-face':
			return p.x.centre && p.y.above && min[2] >= -0.02 && min[2] <= 0.3 ? null : `pivot is not on the wall line behind the piece (${at})`;
		case 'foot':
			return p.y.min && min[0] <= 0 && max[0] >= 0 && min[2] <= 0 && max[2] >= 0 ? null : `pivot is not under the piece (${at})`;
		case 'hinge':
			return p.x.inside && p.y.inside && p.z.inside ? null : `the hinge pivot is outside the piece (${at})`;
	}
	return `unknown pivot rule "${rule}" (one of ${PIVOTS.join('|')})`;
}

/**
 * Scale sanity: the bbox is in METRES — a piece exported in centimetres is 100× too big, one in
 * kilometres a speck. @param {number[]} size @param {number} maxExtent @param {number} minExtent
 */
export function scaleProblem(size, maxExtent, minExtent) {
	if (!size.every(Number.isFinite)) return 'bbox is not finite';
	const big = Math.max(...size);
	if (big < minExtent) return `largest extent ${big.toFixed(3)} m is under ${minExtent} m — exported in km, or empty?`;
	if (big > maxExtent) return `largest extent ${big.toFixed(2)} m is over the category's ${maxExtent} m — exported in cm?`;
	return null;
}

/**
 * The dims fields' SHAPE (core 39 P4) — core reads them before any download, so a malformed one
 * draws a wrong ghost. Whether they are CURRENT is check.mjs's job (it measures the file).
 * @param {any} row @returns {string[]}
 */
export function dimsShapeProblems(row) {
	const out = [];
	const num = (/** @type {any} */ v) => typeof v === 'number' && Number.isFinite(v);
	if (row.size !== undefined && !(Array.isArray(row.size) && row.size.length === 3 && row.size.every((/** @type {any} */ v) => num(v) && v >= 0)))
		out.push('size must be [width, height, depth] in metres (three numbers >= 0)');
	if (row.box !== undefined && !(Array.isArray(row.box) && row.box.length === 6 && row.box.every(num) && row.box[3] >= row.box[0] && row.box[4] >= row.box[1] && row.box[5] >= row.box[2]))
		out.push('box must be [minX, minY, minZ, maxX, maxY, maxZ] with max >= min');
	if (row.tris !== undefined && !(Number.isInteger(row.tris) && row.tris >= 0)) out.push('tris must be a whole number >= 0');
	if (row.bytes !== undefined && !(Number.isInteger(row.bytes) && row.bytes > 0)) out.push('bytes must be a whole number > 0');
	if (row.animated !== undefined && row.animated !== true) out.push('animated is true or absent');
	return out;
}
