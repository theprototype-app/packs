// The interior-kit item list — the ONE place a piece's source, size, pivot and collider
// are decided. build.mjs reads it; kit.md's table is generated from it.
//
// src.meshy = a Meshy job id in staging/33-pack-interior (its newest <stage>-<n>/raw.glb),
//   post-processed here (never shipped raw): targetTris, dims (m), fit, rotateY.
// src.proc = a procedural.mjs piece (exact geometry, its own pivot).
// src.kitbash = built from other items' finished GLBs: [[item, x, z, yawDeg], …].
//
// pivot (kit.md):
//   'bottom-centre' — free-standing floor pieces;
//   'wall-line'     — pieces that stand or hang against a wall: origin ON the architecture
//                     kit's wall grid line, the back face 0.125 m in front of it (= the wall's
//                     face), so the piece takes the wall's position + rotation and sits flush;
//   'top-centre'    — the chandelier hangs from its origin (the ceiling).
// collider = the scene extras' `colliderHint` (core colliderSpec.inferredColliderKind):
//   box | cylinder | hull — what physics builds for the piece unless the user picks another.

/** pale pine → the kit's warm oak (props-kit's grade: per-channel multiply) */
const OAK = { mul: [0.7, 0.56, 0.47] };
/** Meshy's light turquoise velvet → the pack's DEEP teal */
const DEEP_TEAL = { mul: [0.5, 0.56, 0.58] };
/** the same, on teal texels only (painted cupboards beside a marble top) */
const DEEP_TEAL_ONLY = { mul: [0.55, 0.62, 0.64], only: 'teal' };
/** an orange pine → a quieter oak */
const OAK_SOFT = { mul: [0.72, 0.6, 0.52] };

/** a wall-standing Meshy piece: post with the back face at z = 0, then shift it onto the wall face */
const WALL = { pivot: 'bottom-center-back', wallLine: true };

export const ITEMS = [
	// ---- tavern & dining
	{ name: 'RoundTable', grade: OAK, label: 'Round table (tavern)', src: { meshy: 'round-table', stage: 'refine' }, post: { targetTris: 3000, dims: { x: 0.95, y: 0.76, z: 0.95 }, fit: 'stretch' }, collider: 'cylinder', tags: ['furniture', 'tavern'] },
	{ name: 'LongTable', grade: OAK, label: 'Long table (2.2 m)', src: { meshy: 'long-table', stage: 'refine' }, post: { targetTris: 3000, dims: { x: 2.2, y: 0.78, z: 0.9 }, fit: 'stretch' }, collider: 'box', tags: ['furniture', 'dining'] },
	{ name: 'Bench', grade: OAK, label: 'Trestle bench (1.8 m)', src: { meshy: 'long-table', stage: 'refine' }, post: { targetTris: 2000, dims: { x: 1.8, y: 0.46, z: 0.36 }, fit: 'stretch' }, collider: 'box', tags: ['furniture', 'dining'], variantOf: 'LongTable' },
	{ name: 'BarStool', grade: OAK, label: 'Bar stool', src: { meshy: 'bar-stool', stage: 'refine' }, post: { targetTris: 1800, dims: { y: 0.75 } }, collider: 'cylinder', tags: ['furniture', 'tavern'] },
	{ name: 'Stool', grade: OAK, label: 'Stool (low)', src: { meshy: 'bar-stool', stage: 'refine' }, post: { targetTris: 1500, dims: { x: 0.38, y: 0.46, z: 0.38 }, fit: 'stretch' }, collider: 'cylinder', tags: ['furniture', 'tavern'], variantOf: 'BarStool' },
	{ name: 'BarCounter', label: 'Bar counter (2 m section)', src: { meshy: 'bar-counter-oak', stage: 'retexture' }, post: { targetTris: 4000, dims: { x: 2.0, y: 1.1, z: 0.7 }, fit: 'stretch' }, collider: 'box', tags: ['furniture', 'tavern'] },
	{ name: 'BackBar', label: 'Back-bar shelves (bottles)', src: { meshy: 'back-bar', stage: 'refine' }, post: { targetTris: 5000, dims: { x: 2.0, y: 2.0, z: 0.5 }, fit: 'stretch', ...WALL }, collider: 'box', tags: ['furniture', 'tavern', 'wall'] },
	{ name: 'CrateGoods', grade: OAK_SOFT, label: 'Crate of fruit', src: { meshy: 'crate-goods', stage: 'refine' }, post: { targetTris: 3000, dims: { y: 0.5 } }, collider: 'box', tags: ['storage', 'tavern', 'kitchen'] },

	// ---- home
	{ name: 'Armchair', grade: DEEP_TEAL, label: 'Wingback armchair (teal)', src: { meshy: 'armchair', stage: 'refine' }, post: { targetTris: 4000, dims: { y: 1.05 } }, collider: 'hull', tags: ['furniture', 'home'] },
	{ name: 'Sofa', grade: DEEP_TEAL, label: 'Sofa, three seats (teal)', src: { meshy: 'sofa', stage: 'refine' }, post: { targetTris: 5000, dims: { x: 2.1, y: 0.85, z: 0.9 }, fit: 'stretch' }, collider: 'hull', tags: ['furniture', 'home'] },
	{ name: 'DoubleBed', inpaint: true, label: 'Double bed (teal throw)', src: { meshy: 'double-bed', stage: 'refine' }, post: { targetTris: 5000, dims: { x: 1.6, y: 1.15, z: 2.1 }, fit: 'stretch', ...WALL }, collider: 'box', tags: ['furniture', 'home', 'wall'] },
	{ name: 'Wardrobe', grade: OAK_SOFT, label: 'Wardrobe (double)', src: { meshy: 'wardrobe2', stage: 'refine' }, post: { targetTris: 4000, dims: { x: 1.2, y: 2.0, z: 0.6 }, fit: 'stretch', ...WALL }, collider: 'box', tags: ['furniture', 'home', 'wall'] },
	{ name: 'Plant', label: 'Snake plant in a teal pot', src: { meshy: 'plant2', stage: 'refine' }, post: { targetTris: 4000, dims: { y: 0.95 } }, collider: 'cylinder', tags: ['decor'] },

	// ---- office
	{ name: 'Desk', grade: OAK, label: 'Writing desk (office)', src: { meshy: 'desk', stage: 'refine' }, post: { targetTris: 3500, dims: { x: 1.4, y: 0.76, z: 0.7 }, fit: 'stretch' }, collider: 'box', tags: ['furniture', 'office'] },

	// ---- kitchen
	{ name: 'KitchenCounter', grade: DEEP_TEAL_ONLY, label: 'Kitchen counter (1 m, teal doors)', src: { meshy: 'kitchen-counter', stage: 'refine' }, post: { targetTris: 3000, dims: { x: 1.0, y: 0.92, z: 0.62 }, fit: 'stretch', ...WALL }, collider: 'box', tags: ['furniture', 'kitchen', 'wall'] },
	{ name: 'Stove', label: 'Cast-iron range stove', src: { meshy: 'stove', stage: 'refine' }, post: { targetTris: 4000, dims: { x: 0.9, y: 0.95, z: 0.65 }, fit: 'stretch', ...WALL }, collider: 'box', tags: ['furniture', 'kitchen', 'wall'] },
	{ name: 'Fireplace', label: 'Stone fireplace', src: { meshy: 'fireplace', stage: 'refine' }, post: { targetTris: 5000, dims: { x: 1.8, y: 1.6, z: 0.6 }, fit: 'stretch', ...WALL }, collider: 'box', tags: ['home', 'tavern', 'wall'] },

	// ---- light
	{ name: 'WallSconce', label: 'Wall sconce (brass)', src: { proc: 'WallSconce' }, collider: 'box', tags: ['light', 'wall'] },
	{ name: 'FloorLamp', label: 'Floor lamp (teal shade)', src: { proc: 'FloorLamp' }, collider: 'cylinder', tags: ['light', 'home'] },
	{ name: 'Chandelier', label: 'Iron chandelier (hangs from y = 3)', src: { proc: 'Chandelier' }, collider: 'cylinder', tags: ['light', 'tavern'] },

	// ---- decor
	{ name: 'RugRound', label: 'Round rug Ø 2 m (teal)', src: { proc: 'RugRound' }, collider: 'cylinder', tags: ['decor'] },
	{ name: 'Picture', label: 'Framed landscape (wall)', src: { proc: 'Picture' }, collider: 'box', tags: ['decor', 'wall'] },
	{ name: 'WallShelfBooks', label: 'Wall shelf with books', src: { proc: 'WallShelfBooks' }, collider: 'box', tags: ['decor', 'wall', 'office'] },

	// ---- wall trims (snap to the architecture kit's walls)
	{ name: 'Skirting', label: 'Skirting (2 m, on a wall)', src: { proc: 'Skirting' }, collider: 'box', tags: ['trim', 'wall'] },
	{ name: 'SkirtingDoorway', label: 'Skirting, doorway (2 m)', src: { proc: 'SkirtingDoorway' }, collider: 'box', tags: ['trim', 'wall'] },
	{ name: 'Wainscot', label: 'Wainscot panelling (2 m, teal)', src: { proc: 'Wainscot' }, collider: 'box', tags: ['trim', 'wall'] },
	{ name: 'WainscotDoorway', label: 'Wainscot, doorway (2 m, teal)', src: { proc: 'WainscotDoorway' }, collider: 'box', tags: ['trim', 'wall'] },
	{ name: 'Cornice', label: 'Cornice (2 m, at the ceiling)', src: { proc: 'Cornice' }, collider: 'box', tags: ['trim', 'wall'] },

	// ---- kitbash sets (0 credits: finished pieces arranged, one GLB)
	{ name: 'TavernTableSet', label: 'Tavern table + 4 stools', src: { kitbash: [['RoundTable', 0, 0, 0], ['Stool', 0.68, 0, 80], ['Stool', -0.68, 0, -100], ['Stool', 0, 0.68, 10], ['Stool', 0, -0.68, 190]] }, collider: 'cylinder', tags: ['furniture', 'tavern', 'set'] },
	{ name: 'DiningSet', label: 'Long table + 2 benches', src: { kitbash: [['LongTable', 0, 0, 0], ['Bench', 0, 0.72, 0], ['Bench', 0, -0.72, 0]] }, collider: 'box', tags: ['furniture', 'dining', 'set'] }
];

/** the pivot each item documents (kit.md and the e2e use it) */
export function pivotOf(item) {
	if (item.post?.wallLine) return 'wall-line';
	if (item.src.proc) return { WallSconce: 'wall-line', Picture: 'wall-line', WallShelfBooks: 'wall-line', Skirting: 'wall-line', SkirtingDoorway: 'wall-line', Wainscot: 'wall-line', WainscotDoorway: 'wall-line', Cornice: 'wall-line', Chandelier: 'top-centre' }[item.src.proc] ?? 'bottom-centre';
	return 'bottom-centre';
}
