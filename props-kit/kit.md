# Props & Interiors — kit guide

33 pieces for furnishing and dressing rooms, villages and prototypes: furniture,
storage and loot, lights, village and workshop pieces, **game-logic props with real
hinge pivots**, and a small sci-fi pair. Built to sit in the same rooms as the
**Modular Architecture Kit** and the nature pack: same scale (real metres), same
"stylized realistic" look (chunky readable shapes, hand-painted PBR, warm oak /
sandstone / slate / iron / brass), and **one accent colour: teal** (the painted crate,
the bed blanket, the tapestry, the button caps, the market awning).

## Scale, pivots and the grid

- **1 unit = 1 metre**, real-world sizes: a table top is 0.78 m high, a chair seat
  ~0.45 m, a door key 16 cm, the ladder exactly one 3 m storey.
- **Floor pieces pivot at the bottom centre** of their footprint: drop them on a floor
  and they rest on it (nothing sinks, nothing floats).
- **Wall pieces** (`WallTorch`, `WallButton`, `Tapestry`) pivot at the **bottom centre
  of their BACK face**; the back face is the plane z = 0 and the piece faces +z. Put
  the origin on the wall surface and the piece sits flush.
- **Hinged pieces pivot at the hinge**, so rotating the object in the app swings it:
  - `Hatch` (1 × 1 m trapdoor): origin on the hinge line along its back edge. Rotate
    about X: 0° closed, −90° standing open.
  - `LeverHandle`: origin on the axle. Place it on a `LeverBase` at **(0, 0.16, 0)**
    relative to the base, then rotate about X, ±35° is a throw.
- **Pickups** (`DoorKey`) pivot at their centre (grabbable, it rests flat).
- **Grid-exact pieces**: `PressurePlate` and `Hatch` are exactly 1 × 1 m, so they fill a
  grid cell. `Rug` is 2 × 1.3 m, `Ladder` is 3 m tall.

**Snapping in the app:** right-click the viewport, **Snapping ▸ Position ▸ 1** (or 0.5).
The gizmo then moves pieces in whole-metre steps. A bottom-centre pivot puts a piece's
centre on a grid line, so a 1 × 1 m plate snapped to 0.5 fills exactly one cell. The
architecture kit's 2 m walls and floors snap on the same grid, so props line up with
wall faces (a wall face at z = −2.5 takes a wall torch at z = −2.5).

## Lights

Torches and candles carry their flame as a **separate node named `Flame`**, with an
emissive, untextured material (KHR_materials_emissive_strength). A game can hide the
flame for "unlit" without touching the prop, and the app's bloom picks it up. The
`Lantern` glows through its own panes: its albedo doubles as the emissive map.

## Game logic recipes

- **Lever:** `LeverBase` plus `LeverHandle` at +0.16 m. A Flow graph (or a module) rotates
  the handle's X between −35° and +35° and fires the event.
- **Trapdoor:** place `Hatch` over a hole in the floor. Opening it is a rotation of −90°
  about X, with the hinge staying put.
- **Pressure plate / wall button:** trigger-volume props. Put a trigger on the plate's
  1 × 1 m cell, or a click/interact on the button cap.
- **Key and chest:** `DoorKey` is a pickup (16 cm). `Chest` is loot dressing.

## Items

<!-- items:start -->
| Item | Folder | Size x × y × z (m) | Tris | GLB | Pivot | Source |
|---|---|---|---|---|---|---|
| Table | `Table` | 1.80 × 0.78 × 0.95 | 2999 | 506 KB | bottom-centre | Meshy |
| Bench | `Bench` | 1.50 × 0.46 × 0.38 | 2999 | 506 KB | bottom-centre | Meshy (size variant of Table) |
| Chair | `Chair` | 0.51 × 0.95 × 0.52 | 2500 | 473 KB | bottom-centre | Meshy |
| Bed (single) | `Bed` | 1.10 × 1.00 × 2.05 | 4000 | 669 KB | bottom-centre | Meshy |
| Bookcase | `Bookcase` | 1.32 × 2.00 × 0.68 | 4928 | 692 KB | bottom-centre | Meshy |
| Workbench | `Workbench` | 1.24 × 0.92 × 0.59 | 4919 | 543 KB | bottom-centre | Meshy |
| Rug 2 × 1.3 m | `Rug` | 2.12 × 0.01 × 1.30 | 396 | 291 KB | bottom-centre | procedural |
| Tapestry (wall) | `Tapestry` | 1.34 × 1.66 × 0.09 | 640 | 406 KB | bottom-centre-back (wall) | procedural |
| Potted plant | `PottedPlant` | 0.60 × 1.00 × 0.63 | 5007 | 748 KB | bottom-centre | Meshy |
| Crate (oak) | `Crate` | 0.81 × 0.55 × 0.55 | 2500 | 688 KB | bottom-centre | Meshy |
| Crate large | `CrateLarge` | 1.25 × 0.85 × 0.84 | 2500 | 688 KB | bottom-centre | Meshy (size variant of Crate) |
| Crate (painted teal) | `CrateTeal` | 0.73 × 0.50 × 0.50 | 2500 | 662 KB | bottom-centre | Meshy |
| Crate stack | `CrateStack` | 1.66 × 1.05 × 0.67 | 7500 | 1302 KB | bottom-centre | kitbash |
| Barrel | `Barrel` | 0.48 × 0.90 × 0.55 | 2478 | 599 KB | bottom-centre | Meshy |
| Barrel small | `BarrelSmall` | 0.32 × 0.60 × 0.37 | 2478 | 599 KB | bottom-centre | Meshy (size variant of Barrel) |
| Treasure chest | `Chest` | 0.77 × 0.60 × 0.69 | 2910 | 787 KB | bottom-centre | Meshy |
| Grain sacks | `Sacks` | 1.24 × 0.75 × 1.10 | 3590 | 1205 KB | bottom-centre | Meshy |
| Lantern | `Lantern` | 0.19 × 0.38 × 0.15 | 1876 | 469 KB | bottom-centre | Meshy |
| Wall torch | `WallTorch` | 0.10 × 0.69 × 0.32 | 652 | 144 KB | bottom-centre-back (wall) | procedural |
| Candle cluster | `Candles` | 0.17 × 0.30 × 0.17 | 2500 | 567 KB | bottom-centre | Meshy |
| Cauldron | `Cauldron` | 0.97 × 0.60 × 0.82 | 3000 | 311 KB | bottom-centre | Meshy |
| Village well | `Well` | 2.58 × 2.60 × 2.56 | 5999 | 758 KB | bottom-centre | Meshy |
| Market stall | `MarketStall` | 2.60 × 2.60 × 1.85 | 5671 | 724 KB | bottom-centre | Meshy |
| Signpost | `Signpost` | 1.35 × 2.32 × 0.70 | 104 | 104 KB | bottom-centre | procedural |
| Ladder (3 m, one storey) | `Ladder` | 0.53 × 3.00 × 0.06 | 336 | 80 KB | bottom-centre | procedural |
| Lever base | `LeverBase` | 0.34 × 0.20 × 0.24 | 120 | 65 KB | bottom-centre | procedural |
| Lever handle (hinge pivot) | `LeverHandle` | 0.14 × 0.54 × 0.08 | 304 | 98 KB | hinge axle, rotate X | procedural |
| Wall button | `WallButton` | 0.20 × 0.20 × 0.10 | 300 | 105 KB | bottom-centre-back (wall) | procedural |
| Pressure plate 1 × 1 m | `PressurePlate` | 1.00 × 0.05 × 1.00 | 72 | 87 KB | bottom-centre | procedural |
| Trapdoor 1 × 1 m (hinge pivot) | `Hatch` | 1.00 × 0.09 × 1.00 | 496 | 85 KB | hinge: back edge, rotate X | procedural |
| Door key | `DoorKey` | 0.16 × 0.02 × 0.07 | 556 | 80 KB | centre (pickup) | procedural |
| Sci-fi console | `SciFiConsole` | 0.63 × 1.10 × 0.53 | 3813 | 495 KB | bottom-centre | Meshy |
| Sci-fi crate | `SciFiCrate` | 0.88 × 0.60 × 0.60 | 2500 | 607 KB | bottom-centre | Meshy |
<!-- items:end -->

## How it was made

- **Meshy.ai** (text-to-3D) made the sculpted pieces. Each was **previewed**, looked at
  as a render, then **refined** only if it was a keeper. Prompts and settings are in
  `_src/jobs-*.json`. The 30c budget tool (`tools/meshy`) spent the credits under the
  `30c-pack-props` cap: 285 credits for 16 fresh meshes, 2 retextures of an already-paid
  crate mesh, and 4 rejected previews (barrel, wall torch ×2, candles).
- **Variants cost nothing:** `Bench` is the table's mesh restretched, `BarrelSmall` and
  `CrateLarge` are rescales, and `CrateStack` is kitbashed from finished crates.
- **Procedural** (`_src/procedural.mjs`) made the pieces whose value is an exact shape or
  pivot: lever, button, pressure plate, trapdoor, key, ladder, rug, tapestry, signpost,
  wall torch, and every flame. Their textures are SVG-painted swatches (`_src/textures.mjs`).
- **Every Meshy mesh was post-processed** by `tools/meshy` meshy-post (weld, simplify
  to the triangle budget, bake the scale to metres, set the pivot, 1024² JPEG textures)
  and then colour-graded where Meshy painted off-palette (table, bench and crates
  moved from pale pine to the kit's oak). No raw Meshy output ships.
- Rebuild: `node _src/build.mjs` (reads the Meshy staging folder), `node _src/cover.mjs`,
  `node _src/kitmd.mjs`. E2E proof: `_src/e2e-props-kit.cjs` (header says how).

License: **CC0-1.0**, © theprototype, made with Meshy.ai. See `attribution.html`.
