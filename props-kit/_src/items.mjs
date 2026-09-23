// The props-kit item list — the ONE place a piece's source, size and pivot are decided.
// build.mjs reads it; kit.md's table is generated from it.
//
// src.meshy = a Meshy job id in staging/30c-pack-props (its newest <stage>-<n>/raw.glb),
//   post-processed here (never shipped raw): targetTris, dims (m), fit, pivot, rotateY.
// src.budget = a mesh the 30c-meshy-budget lane already paid for (its staging folder).
// src.proc = a procedural.mjs piece (exact geometry, its own pivot).
// src.kitbash = built from other items' finished GLBs.
// flames = emissive Flame nodes appended after post (positions in the POSTED frame).
//
// Pivots (kit.md): floor props bottom-centre; wall props bottom-centre-BACK (the back
// face is z = 0, the prop faces +z); hinged parts at their hinge.

/** pale pine → the kit's warm oak (build.mjs grade: per-channel multiply) */
const OAK = { mul: [0.78, 0.6, 0.48] };

export const ITEMS = [
	// ---- furniture
	{ name: 'Table', label: 'Table', src: { meshy: 'table', stage: 'refine' }, post: { targetTris: 3000, dims: { x: 1.8, y: 0.78, z: 0.95 }, fit: 'stretch' }, grade: OAK, tags: ['furniture'] },
	{ name: 'Bench', label: 'Bench', src: { meshy: 'table', stage: 'refine' }, post: { targetTris: 3000, dims: { x: 1.5, y: 0.46, z: 0.38 }, fit: 'stretch' }, grade: OAK, tags: ['furniture'], variantOf: 'Table' },
	{ name: 'Chair', label: 'Chair', src: { meshy: 'chair', stage: 'refine' }, post: { targetTris: 2500, dims: { y: 0.95 } }, tags: ['furniture'] },
	{ name: 'Bed', label: 'Bed (single)', src: { meshy: 'bed', stage: 'refine' }, post: { targetTris: 4000, dims: { x: 1.1, y: 1.0, z: 2.05 }, fit: 'stretch' }, tags: ['furniture'] },
	{ name: 'Bookcase', label: 'Bookcase', src: { meshy: 'bookcase', stage: 'refine' }, post: { targetTris: 5000, dims: { y: 2.0 } }, tags: ['furniture'] },
	{ name: 'Workbench', label: 'Workbench', src: { meshy: 'workbench', stage: 'refine' }, post: { targetTris: 5000, dims: { y: 0.92 } }, tags: ['furniture', 'crafting'] },
	{ name: 'Rug', label: 'Rug 2 × 1.3 m', src: { proc: 'Rug' }, tags: ['furniture', 'decor'] },
	{ name: 'Tapestry', label: 'Tapestry (wall)', src: { proc: 'Tapestry' }, tags: ['decor', 'wall'] },
	{ name: 'PottedPlant', label: 'Potted plant', src: { meshy: 'plant', stage: 'refine' }, post: { targetTris: 5000, dims: { y: 1.0 } }, tags: ['decor'] },

	// ---- storage & loot
	{ name: 'Crate', label: 'Crate (oak)', src: { meshy: 'crate-oak', stage: 'retexture' }, post: { targetTris: 2500, dims: { y: 0.55 } }, grade: OAK, tags: ['storage'] },
	{ name: 'CrateLarge', label: 'Crate large', src: { meshy: 'crate-oak', stage: 'retexture' }, post: { targetTris: 2500, dims: { y: 0.85 } }, grade: OAK, tags: ['storage'], variantOf: 'Crate' },
	{ name: 'CrateTeal', label: 'Crate (painted teal)', src: { budget: 'test-crate-painted/retexture-1' }, post: { targetTris: 2500, dims: { y: 0.5 } }, tags: ['storage'] },
	{ name: 'CrateStack', label: 'Crate stack', src: { kitbash: 'crateStack' }, tags: ['storage'] },
	{ name: 'Barrel', label: 'Barrel', src: { meshy: 'barrel2', stage: 'refine' }, post: { targetTris: 2500, dims: { y: 0.9 } }, tags: ['storage'] },
	{ name: 'BarrelSmall', label: 'Barrel small', src: { meshy: 'barrel2', stage: 'refine' }, post: { targetTris: 2500, dims: { y: 0.6 } }, tags: ['storage'], variantOf: 'Barrel' },
	{ name: 'Chest', label: 'Treasure chest', src: { meshy: 'chest', stage: 'refine' }, post: { targetTris: 3000, dims: { y: 0.6 } }, tags: ['storage', 'loot'] },
	{ name: 'Sacks', label: 'Grain sacks', src: { meshy: 'sacks', stage: 'refine' }, post: { targetTris: 3500, dims: { y: 0.75 } }, tags: ['storage'] },

	// ---- light
	{ name: 'Lantern', label: 'Lantern', src: { meshy: 'lantern', stage: 'refine' }, post: { targetTris: 2000, dims: { y: 0.38 } }, tags: ['light'], glow: 0.7 },
	{ name: 'WallTorch', label: 'Wall torch', src: { proc: 'WallTorch' }, tags: ['light', 'wall'] },
	{ name: 'Candles', label: 'Candle cluster', src: { meshy: 'candles2', stage: 'refine' }, post: { targetTris: 2500, dims: { y: 0.3 } }, tags: ['light'] },

	// ---- village & work
	{ name: 'Cauldron', label: 'Cauldron', src: { meshy: 'cauldron', stage: 'refine' }, post: { targetTris: 3000, dims: { y: 0.6 } }, tags: ['crafting'] },
	{ name: 'Well', label: 'Village well', src: { meshy: 'well', stage: 'refine' }, post: { targetTris: 6000, dims: { y: 2.6 } }, tags: ['village'] },
	{ name: 'MarketStall', label: 'Market stall', src: { meshy: 'stall', stage: 'refine' }, post: { targetTris: 6000, dims: { y: 2.6 } }, tags: ['village'] },
	{ name: 'Signpost', label: 'Signpost', src: { proc: 'Signpost' }, tags: ['village'] },
	{ name: 'Ladder', label: 'Ladder (3 m, one storey)', src: { proc: 'Ladder' }, tags: ['village', 'traversal'] },

	// ---- game logic
	{ name: 'LeverBase', label: 'Lever base', src: { proc: 'LeverBase' }, tags: ['logic'] },
	{ name: 'LeverHandle', label: 'Lever handle (hinge pivot)', src: { proc: 'LeverHandle' }, tags: ['logic'] },
	{ name: 'WallButton', label: 'Wall button', src: { proc: 'WallButton' }, tags: ['logic', 'wall'] },
	{ name: 'PressurePlate', label: 'Pressure plate 1 × 1 m', src: { proc: 'PressurePlate' }, tags: ['logic'] },
	{ name: 'Hatch', label: 'Trapdoor 1 × 1 m (hinge pivot)', src: { proc: 'Hatch' }, tags: ['logic'] },
	{ name: 'DoorKey', label: 'Door key', src: { proc: 'DoorKey' }, tags: ['logic', 'pickup'] },

	// ---- prototype / sci-fi pair
	{ name: 'SciFiConsole', label: 'Sci-fi console', src: { meshy: 'console', stage: 'refine' }, post: { targetTris: 4000, dims: { y: 1.1 } }, tags: ['scifi'] },
	{ name: 'SciFiCrate', label: 'Sci-fi crate', src: { meshy: 'crate-scifi', stage: 'retexture' }, post: { targetTris: 2500, dims: { y: 0.6 } }, tags: ['scifi', 'storage'] }
];
