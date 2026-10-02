# Town & Market Kit

A market-town street set that mixes with the **Modular Architecture Kit** (building fronts, towers)
and the **Nature & Terrain** pack (a footbridge for its streams): cobblestone road tiles with
curbs, corners and a crossing, flagstone sidewalks, a fountain and a well for the square, a
market stall, a cart, lamp posts, benches, hay, barrels, a fence with a garden gate that
**opens**, banners, a blank notice board and signpost, stone stairs, flower boxes and a clock
tower top. Same look as the other kits — "stylized realistic", chunky, hand-painted PBR in warm
sandstone / oak / slate / iron — and **one accent colour: terracotta red** (the awning stripes,
the roof tiles of the well and the clock tower, the banners, the gate and signpost caps).

## The street on the 2 m grid

**1 unit = 1 metre.** Every street tile is exactly **2 × 2 m**, pivot at its **bottom centre**:
with **Snapping ▸ Position 2** the gizmo puts tile centres on even metres and their edges on odd
ones, and neighbouring tiles meet with **0 mm seams** (the pack's e2e checks every joint).

- **Road** — cobbles, top at **0.20 m**. The cobble and flagstone textures are generated
  **tileable**: one texture period per tile, so a street of many tiles reads as one continuous
  pavement (no repeating seam at the joints).
- **RoadCurb** — road with a granite **curb on its +Z edge** (25 cm wide, top at **0.35 m**).
  Rotate it 180° for the other side of the street, 90° to close a street's end.
- **RoadCorner** — an outer corner: curbs on **+Z and +X**. Rotate in 90° steps.
- **RoadCrossing** — a pedestrian crossing: a 1 m band of pale slabs across the tile at
  `|x| < 0.5`, flush with the cobbles. The street runs along X; rotate 90° for one along Z.
- **Sidewalk** — flagstones, top at **0.35 m** = the curb top. Also a plaza / market floor.

```
   z=-4  [Sidewalk][Sidewalk][Sidewalk]          a street along X, tile centres on even metres
   z=-2  [Curb 180][Curb 180][Curb 180][Corner 90]
   z= 0  [  Road  ][Crossing][  Road  ][Curb 90 ]
   z= 2  [Curb  0 ][Curb  0 ][Curb  0 ][Corner 0]
   z= 4  [Sidewalk][Sidewalk][Sidewalk]
```

Props on a sidewalk stand at **y = 0.35**, props on the road at **y = 0.20**.

## Pivots

- Every floor-standing piece pivots at its **bottom centre** (drop it on a surface and it rests).
- **Banner** (wall banner) pivots at the **bottom centre of its back plane** (z = 0 is the wall
  face, the banner faces +Z) — like props-kit's wall pieces. Its cloth starts 0.4 m above the pivot.
- **FlowerBox** fits an architecture-kit window: the window sill is at **y = 1.1 m** on the wall's
  pivot; put the box at `(wall x, 1.1, wall front face + half the box depth)`.
- **ClockTowerTop** is 4.25 m square = the outer size of a 4 × 4 m tower of architecture-kit walls
  (walls centred on the lines, 0.25 m thick). Put it at the tower's centre at the wall tops
  (**y = 3** per storey).
- **Fence** sections have **half posts** at both ends: two sections side by side make one whole
  post, so runs tile on the 2 m grid without doubled (and flickering) posts.

## The garden gate opens (P2 behavior)

`FenceGate` ships **with its frame** (two posts and a lintel, static) and a hinged **Leaf** node
whose origin is on the hinge line (x = −0.87, on the left post). It carries two clips, `open`
(0 → −95° about Y, swinging towards +Z, 0.9 s, eased) and `close`, and the item's
`"behavior": {"type": "door", "clip": "open", "closeClip": "close", "trigger": "click",
"autoplay": false, "collider": "follow", "sound": "gate"}` (also in the GLB's scene extras, so a
copy saved to your library still behaves). Nothing plays on placement or in Edit: in Interact /
Play a click (or a VR laser / poke) toggles it, and the open state replicates.

## Physics

Every piece carries a **collider hint** in its glTF scene extras → `userData.colliderHint`, which
the app's colliderSpec uses as the default shape when you turn physics on: `box` for tiles, stalls,
benches, carts and boards; `cylinder` for the well, fountain, lamp posts and banner pole; `hull` for
the stone stairs and the footbridge (so you can walk up them). The gate's colliders come from its
behavior (`collider: "follow"`: the leaf's box follows the swing). The wall banner has none.

## Levels of detail and flicker

14 pieces ship `<name>.lod1.glb` (and most a `.lod2.glb`) next to LOD0, listed in their
`default.json` row as `"lods": [{"file", "ratio"}]` (contract P1; ratio = measured triangle
fraction). They were made by `tools/lod` (33-pack-fix-lod): meshopt-simplified per primitive in
place (node names, materials and normals kept, so no lighting pop), each level visually gated
against LOD0 at the size the app first shows it. Pieces under 500 triangles (the street tiles,
fence, gate, banners, signpost) and the ones no level could simplify without a visible change
(hay, flower boxes, stone stairs) have no `lods` row; the app's runtime auto-LOD covers them.

No piece has two same-facing triangles on one plane over the same area (the z-fight that
shimmers only while the camera moves): every GLB went through `tools/lod/defight.mjs`, and
`report.json` records the probe's before/after pair count per piece.

## Mixing with the other packs

- Building fronts: architecture-kit walls with their front face on the sidewalk's back edge;
  banners on them, flower boxes on their window sills.
- Barrels: `BarrelCluster` re-uses props-kit's barrel meshes (0 credits).
- Nature: put the `Bridge` (4.4 m, ends at 0.24 m, runs along Z) over a nature-kit stream.

## Pieces

<!-- pieces: generated by tools/town-kit/build.mjs from kit.json + the measured GLBs -->
| Piece | Size (x × y × z, m) | Pivot | Place it |
|---|---|---|---|
| Cobblestone road (2 × 2 m) | 2 × 0.2 × 2 | bottom centre | the street's middle tiles; the cobbles continue across every joint |
| Road + curb (2 × 2 m) | 2 × 0.35 × 2 | bottom centre | the street's edge tile: the curb is on its +Z side, a Sidewalk tile goes beyond it |
| Road corner + curb (2 × 2 m) | 2 × 0.35 × 2 | bottom centre | an outer street corner: curbs on +Z and +X |
| Road crossing (2 × 2 m) | 2 × 0.2 × 2 | bottom centre | in a street of Road tiles: a pale-slab pedestrian crossing across it |
| Sidewalk flagstones (2 × 2 m) | 2 × 0.35 × 2 | bottom centre | beyond a RoadCurb, 0.35 m top = the curb top; also a plaza / market floor |
| Stone stairs (2 × 2 m, 1 m rise) | 2 × 1 × 2 | bottom centre | on the 2 m grid; climbs 1 m towards −Z (rotate to turn it) |
| Village well | 2.62 × 2.5 × 2.62 | bottom centre | the centrepiece of a small square |
| Town fountain | 3 × 2.055 × 3 | bottom centre | in the middle of a 4 × 4 m plaza of Sidewalk tiles |
| Market stall (striped awning) | 2.4 × 1.805 × 2.008 | bottom centre | on Sidewalk tiles, open side to the street |
| Street lamp post | 0.641 × 3.4 × 0.648 | bottom centre | on the sidewalk 0.5 m from the curb, every 6-8 m |
| Park bench | 1.6 × 0.764 × 0.696 | bottom centre | on the sidewalk or round the fountain |
| Market cart | 2.2 × 0.959 × 1.359 | bottom centre | by a stall or at the roadside |
| Hay bale | 0.9 × 0.45 × 0.45 | bottom centre | stack them (0.45 m high each) |
| Flower box | 1 × 0.5 × 0.32 | bottom centre | on a window sill (architecture-kit WallStoneWindow sill at y 1.0) or along a fence |
| Notice board (blank) | 2.2 × 2.2 × 0.86 | bottom centre | by the well or a crossroads; the board is blank for your own decal |
| Clock tower top | 4.25 × 8.528 × 4.205 | bottom centre | on top of a 4 × 4 m tower of architecture-kit walls (centred, at the wall tops: y = 3 per storey) |
| Picket fence (2 m) | 2 × 1.05 × 0.12 | bottom centre | runs on the 2 m grid: sections share their end posts (two half posts make one) |
| Garden gate + frame (2 m, opens) | 2.021 × 2.1 × 0.141 | bottom centre | in a fence run like a section; click it in Interact/Play to open/close |
| Wooden footbridge (4.4 m) | 1.9 × 1.64 × 4.444 | bottom centre | over a nature-kit stream or pond edge; runs along Z, ends at 0.24 m |
| Wall banner | 1.07 × 1.5 × 0.153 | bottom centre of its back plane (z = 0 is the wall face; the cloth starts 0.4 m up) | on a wall: origin on the wall face (back plane z = 0), facing +Z |
| Banner pole | 1.04 × 3.735 × 0.5 | bottom centre | at a square's corners or a bridge end |
| Signpost (blank) | 1.615 × 2.46 × 1.235 | bottom centre | at a crossroads; the boards are blank |
| Hay bale stack | 0.9 × 0.9 × 0.92 | bottom centre | by a cart or a barn door |
| Market cart (loaded) | 2.2 × 1.34 × 1.359 | bottom centre | at the roadside (on the road: y 0.20) |
| Barrels (cluster) | 1.224 × 0.9 × 0.911 | bottom centre | by a stall, a tavern door or the dock (props-kit barrels, re-used) |
| Grain sacks + barrel | 1.646 × 0.75 × 1.097 | bottom centre | by a stall or on the cart's tailboard side (props-kit sacks + barrel, re-used) |
| Flower box (2 m) | 2 × 0.5 × 0.32 | bottom centre | along a 2 m fence section or under a wide window |
<!-- /pieces -->

## Rebuild

`node tools/town-kit/build.mjs` (Meshy raws in `~/.code/lanes-30/meshy/staging/33-pack-town/`,
jobs in `tools/town-kit/jobs/`; procedural pieces in `procedural.mjs`, `stones.mjs`,
`textures.mjs`). The e2e: `tools/town-kit/e2e-town.cjs` (header).
