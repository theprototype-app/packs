# Interiors: Home, Tavern & Office — kit guide

30 pieces for furnishing the inside of buildings: tavern and dining furniture, a bar,
a home (armchair, sofa, double bed, wardrobe, fireplace), a kitchen run, an office desk,
lights, decor — and **wall trims that snap to the Modular Architecture Kit's walls**
(skirting, deep-teal wainscot panelling, a cornice, with doorway cut-outs that meet the
kit's Door frame). Same scale (real metres), same "stylized realistic" look as the
architecture, props and nature packs (chunky readable shapes, hand-painted PBR, warm oak /
sandstone / iron / brass), and **one accent colour: deep teal** (upholstery, the painted
wainscot and kitchen cupboards, the rug, the lamp shade, the plant pot, the bed throw).

## Scale and pivots

**1 unit = 1 metre**: a table top is 0.76–0.78 m high, a chair seat ~0.45 m, a bar top
1.1 m, a kitchen worktop 0.92 m, a wardrobe 2 m. Three pivots:

| Pivot | Pieces | Place it |
|---|---|---|
| **bottom-centre** | free-standing furniture, rugs, the floor lamp, the sets | drop it on a floor: it rests on it |
| **wall-line** | everything that stands or hangs on a wall: trims, sconce, picture, wall shelf, fireplace, back-bar, kitchen counter, stove, wardrobe, double bed (headboard) | origin **on the wall's grid line**, the piece's back 0.125 m in front of it — exactly on the face of an architecture-kit wall (0.25 m thick, centred on its line). Give it the wall's x/z and rotation and it sits flush, facing into the room (+Z) |
| **top-centre** | the chandelier | origin at the ceiling rose: place it at **y = 3** (the next storey) and it hangs 0.92 m down |

**Wall-line in practice.** A wall at `(1, 0, 0)`, 0° has its room-side face at `z = 0.125`.
A kitchen counter at `(0.5, 0, 0)`, 0° stands with its back on that face; a second one at
`(1.5, 0, 0)` continues the run (counters are exactly 1 m). Turn a wall-line piece 180° to
put it on the wall's OTHER face; on a wall rotated 90° (on the line `x = 0`), use rotation
90° and it faces +X. With **Snapping ▸ Position 0.5** every wall-line piece lands on the
wall. Raise wall-hung pieces to taste: sconce ~1.6 m, picture ~1.3 m, shelf ~1.1 m.

## The wall trims

All 2 m long — one per wall panel — with the wall's own pivot: **same position, same
rotation as the wall** (y = 0 too), and they cover its room-side (+Z) face; rotate 180° for
the other face.

- **Skirting**: 0.25 m tall from the wall's foot, so 0.15 m shows above the kit's floor tiles
  (their top is y = 0.1) — the lower 0.1 m hides in the tiles (or reads as a tall skirting on
  a bare floor).
- **Wainscot** (deep-teal panelling with an oak rail): 0.93 m tall, three raised panels; it
  stops below the kit's window sill (0.975 m), so it runs under a **Wall — window** too. It
  carries its own skirting.
- **Cornice**: a cove moulding whose top is at y = 3, under the storey above.
- **…Doorway** versions: the same with a 1.3 m gap in the middle — exactly the kit's **Door**
  frame width. Put them at the doorway wall's spot; the Door frame covers the cut ends.

Runs and corners are seamless and **never flicker**: trims butt end to end along a wall, and
at an inner corner the two runs cross (their tops slope and their undersides tilt, so they
never share a plane); their backs sit 2 cm inside the wall's brick/plaster relief, and faces
that would only ever be buried (the back, the foot, the top under a ceiling) are not
modelled. The pack's unit test proves 0 same-facing coplanar overlaps for every procedural
piece, every straight run and inner corner, and against the real walls, window, doorway,
Door and floor/ceiling tiles (`_src/test/kit.test.mjs`, probe `_src/zfight.mjs`).

## Lights

The sconce's chimney, the floor lamp's shade lining and bulb glow (emissive, warm); the
chandelier's six candles carry their flames as ONE node named `Flame` (emissive,
KHR_materials_emissive_strength), so a game can hide it for "unlit" and the app's bloom
picks it up — one draw call for all six.

## Physics

Every GLB carries a **collider hint** in its scene extras (`colliderHint`, read by the app's
collider inference): `box` for cabinets, counters, beds, tables with straight legs and the
trims; `cylinder` for round tables, stools, the plant, the lamp, the rug and the chandelier;
`hull` for the armchair and the sofa. A user's own collider choice still wins.

## Items

<!-- items:start -->
| Item | Folder | Size x × y × z (m) | Tris | GLB | Pivot | Collider | Source |
|---|---|---|---|---|---|---|---|
| Round table (tavern) | `RoundTable` | 0.95 × 0.76 × 0.95 | 3000 | 468 KB | bottom-centre | cylinder | Meshy |
| Long table (2.2 m) | `LongTable` | 2.20 × 0.78 × 0.90 | 3000 | 687 KB | bottom-centre | box | Meshy |
| Trestle bench (1.8 m) | `Bench` | 1.80 × 0.46 × 0.36 | 2000 | 651 KB | bottom-centre | box | Meshy (variant of LongTable) |
| Bar stool | `BarStool` | 0.39 × 0.75 × 0.39 | 1799 | 342 KB | bottom-centre | cylinder | Meshy |
| Stool (low) | `Stool` | 0.38 × 0.46 × 0.38 | 1500 | 331 KB | bottom-centre | cylinder | Meshy (variant of BarStool) |
| Bar counter (2 m section) | `BarCounter` | 2.00 × 1.10 × 0.70 | 3999 | 494 KB | bottom-centre | box | Meshy (retextured) |
| Back-bar shelves (bottles) | `BackBar` | 2.00 × 2.00 × 0.50 | 4999 | 573 KB | wall-line | box | Meshy |
| Crate of fruit | `CrateGoods` | 0.46 × 0.50 × 0.45 | 3065 | 650 KB | bottom-centre | box | Meshy |
| Wingback armchair (teal) | `Armchair` | 0.90 × 1.05 × 1.00 | 3897 | 535 KB | bottom-centre | hull | Meshy |
| Sofa, three seats (teal) | `Sofa` | 2.10 × 0.85 × 0.90 | 4744 | 444 KB | bottom-centre | hull | Meshy |
| Double bed (teal throw) | `DoubleBed` | 1.60 × 1.15 × 2.10 | 5000 | 457 KB | wall-line | box | Meshy |
| Wardrobe (double) | `Wardrobe` | 1.20 × 2.00 × 0.60 | 3999 | 529 KB | wall-line | box | Meshy |
| Snake plant in a teal pot | `Plant` | 0.35 × 0.95 × 0.34 | 3989 | 872 KB | bottom-centre | cylinder | Meshy |
| Writing desk (office) | `Desk` | 1.40 × 0.76 × 0.70 | 3215 | 467 KB | bottom-centre | box | Meshy |
| Kitchen counter (1 m, teal doors) | `KitchenCounter` | 1.00 × 0.92 × 0.62 | 3000 | 418 KB | wall-line | box | Meshy |
| Cast-iron range stove | `Stove` | 0.90 × 0.95 × 0.65 | 3877 | 609 KB | wall-line | box | Meshy |
| Stone fireplace | `Fireplace` | 1.80 × 1.60 × 0.60 | 5000 | 629 KB | wall-line | box | Meshy |
| Wall sconce (brass) | `WallSconce` | 0.12 × 0.44 × 0.20 | 400 | 55 KB | wall-line | box | procedural |
| Floor lamp (teal shade) | `FloorLamp` | 0.47 × 1.66 × 0.47 | 1200 | 136 KB | bottom-centre | cylinder | procedural |
| Iron chandelier (hangs from y = 3) | `Chandelier` | 0.92 × 0.92 × 0.88 | 4464 | 226 KB | top-centre | cylinder | procedural |
| Round rug Ø 2 m (teal) | `RugRound` | 2.00 × 0.01 × 2.00 | 256 | 442 KB | bottom-centre | cylinder | procedural |
| Framed landscape (wall) | `Picture` | 0.92 × 0.68 × 0.04 | 130 | 151 KB | wall-line | box | procedural |
| Wall shelf with books | `WallShelfBooks` | 1.20 × 0.83 × 0.24 | 860 | 192 KB | wall-line | box | procedural |
| Skirting (2 m, on a wall) | `Skirting` | 2.00 × 0.25 × 0.04 | 64 | 30 KB | wall-line | box | procedural |
| Skirting, doorway (2 m) | `SkirtingDoorway` | 2.00 × 0.25 × 0.04 | 56 | 30 KB | wall-line | box | procedural |
| Wainscot panelling (2 m, teal) | `Wainscot` | 2.00 × 0.93 × 0.06 | 166 | 49 KB | wall-line | box | procedural |
| Wainscot, doorway (2 m, teal) | `WainscotDoorway` | 2.00 × 0.93 × 0.06 | 136 | 49 KB | wall-line | box | procedural |
| Cornice (2 m, at the ceiling) | `Cornice` | 2.00 × 0.21 × 0.18 | 100 | 37 KB | wall-line | box | procedural |
| Tavern table + 4 stools | `TavernTableSet` | 1.80 × 0.76 × 1.80 | 9000 | 798 KB | bottom-centre | cylinder | set: RoundTable + Stool + Stool + Stool + Stool |
| Long table + 2 benches | `DiningSet` | 2.20 × 0.78 × 1.80 | 7000 | 819 KB | bottom-centre | box | set: LongTable + Bench + Bench |
<!-- items:end -->

## Recipes

### A tavern (on the architecture kit's 4 × 4 m cottage, kit.md there)
Bar counters ×2 at `(1, 0.1, 2.6)` and `(3, 0.1, 2.6)`, back-bar on the north wall at
`(1, 0.1, 0)` (wall-line), bar stools in front at z ≈ 3.2, a Tavern table set by the door,
the chandelier at `(2, 3, 2)`, wainscot on every wall, sconces either side of the back-bar.

### A kitchen
Kitchen counter, stove, kitchen counter along one wall — wall-line, x = 0.5 / 1.45 / 2.4 —
a crate of fruit on the floor, a picture above.

### A study
Desk facing the window wall, a wall shelf of books beside it, armchair + floor lamp + round
rug in the corner, skirting and cornice on the walls.

## How it was made

- **Meshy.ai** (text-to-3D) made the 16 sculpted meshes: every idea was **previewed** (5
  credits), looked at as a render, and **refined** (10) only if it was a keeper. Three
  previews were rejected (a curved bar desk, a too-narrow wardrobe, a fragmented fern) and
  re-prompted; one refine was **retextured** (the bar counter's front was painted as glass
  cases). Prompts and settings: `_src/jobs-*.json`. 250 credits under the
  `33-pack-interior` cap.
- **Variants cost nothing:** the bench is the long table's mesh restretched, the low stool
  is the bar stool's; the two sets are arranged from finished pieces.
- **Repairs (0 credits):** Meshy ships a few vertex normals that are zero or point against
  their triangle — they render black (the bed's headboard had a black triangle). The build
  rebuilds them from the face normals; unpainted black texels are filled from their
  neighbours; pale pine is graded to oak and light turquoise to the pack's deep teal (a
  hue-selective grade on the kitchen counter, so its marble top keeps its colour).
- **Procedural** (`_src/procedural.mjs`): trims, lights, the rug, the picture (an abstract
  painted landscape — no text), the book shelf (one atlas material for all the books).
- **Every GLB is flat** (mesh nodes are direct scene children, one primitive each — core's
  scene sync sends nested groups with a world pose) and ≤ 4 meshes (draw calls).
- Rebuild: `node interior-kit/_src/build.mjs` (reads the Meshy staging folder), `node
  interior-kit/_src/cover.mjs`, `node interior-kit/_src/kitmd.mjs`; tests: `node --test
  interior-kit/_src/test/*.test.mjs`; in-app proof: `interior-kit/_src/e2e-interior-kit.cjs`.

License: **CC0-1.0**, © theprototype, made with Meshy.ai. See `attribution.html`.
