# tools/lod — no z-fighting, and levels of detail for every pack item

Offline steps for the packs (roadmap 33, contract P1). Node ≥ 20, deps from `tools/meshy`
(`cd tools/meshy && npm ci` once). No credits, no network.

## The one command for a pack

```
node tools/lod/defight-all.mjs <pack>   # 1. LOD0s: settle coplanar layers (bbox unchanged)
node tools/lod/lod.mjs <pack>           # 2. levels: <name>.lod1.glb / .lod2.glb + "lods" rows
node tools/lod/lod.mjs --check <pack>   # verify (exit 1 on a problem)
node tools/lod/sheet.mjs <dir> <pack>   # optional: the near/far LOOK, <dir>/lod-<pack>.png
```

Both steps are re-runnable: levels are always rebuilt from LOD0 and the rows rewritten. Run
them after every change to a pack's GLBs. `report.json` lists every item's levels and every
skipped item with its reason.

## What each step does

- **coplanar.mjs** — the static z-fight probe: pairs of triangles in one plane (facing within
  1°, every corner within 1 mm; both facings when the material is double-sided) that overlap
  by more than 1 mm². `node tools/lod/coplanar.mjs a.glb b.glb …`
- **defight.mjs** — per coplanar cluster, largest triangle first: hidden duplicates are dropped,
  partial overlaps pushed 2.5 mm per layer toward the piece's middle (clamped into its bounds).
  Files under 1 cm² of overlap are left byte-identical. The architecture/scifi kit-post runs it
  last (their seam clamp is what folds relief into coplanar layers).
- **lod.mjs** — per item over the floor (500 tris; 2000 for `default` / `cube_diorama`): a copy
  of LOD0 simplified PER PRIMITIVE IN PLACE with meshoptimizer's attribute-aware simplifier
  (positions + normals + UV0). Node names, hierarchy, transforms, skins, morph targets and
  animations are kept exactly — core swaps geometry per node BY NAME and draws every level with
  LOD0's material, so an animated door keeps its clip. Surviving vertices keep their own normals:
  no lighting pop. Targets 0.5 / 0.2 of LOD0's triangles, but every level is **visually gated**
  (`judge.mjs`): rendered with LOD0's textures at the size core first shows it (180 px / 72 px =
  25 % / 10 % of a 720 p view) from four sides, it must stay within a mean colour change of 30;
  the coarsest passing error cap wins. A level is kept only at <= 80 % of the level before (core's
  own rule). The row's `ratio` is the MEASURED triangle fraction. Level textures are shrunk (1/4,
  1/8 per side) — core never draws them.

```jsonc
// a row in <pack>/default.json after lod.mjs
{ "name": "WallStone", "variants": { "glTF-Binary": "wall-stone.glb" },
  "lods": [{ "file": "wall-stone.lod1.glb", "ratio": 0.5 }] }
```

Tests: `node --test tools/lod/test/*.test.mjs`. The render flicker probe in the real app:
`tests/flicker-probe.e2e.cjs` (see its header).
