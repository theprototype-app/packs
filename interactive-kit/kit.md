# Interactive Kit — doors that open, lids that lift, levers that throw

19 **animated, functional** pieces for the other kits: doors **with their frames** that open and
close, a trapdoor, window shutters, a chest, a crate, a wardrobe and a chest of drawers, a lever,
a pressure plate and a wall button, a portcullis, plus three ambient pieces that move on their
own (a torch flame, a banner, a ceiling fan). They fit the **Modular Architecture Kit**'s
doorway and window, the **Sci-fi Kit**'s doorway, and the 1 m grid, and they share the look of
the architecture, props and sci-fi kits. Most of them **are** those kits' pieces, cut apart and
hinged.

## How they behave in the app

Every item carries a **`behavior`** (in its `default.json` row and in the GLB's `scene.extras`):

| type | what happens | items |
|---|---|---|
| `door` | each trigger alternates **open ⇄ close**; the moving part's collider follows it, so an open door lets you walk through | doors, gates, portcullis, sliding doors |
| `toggle` | each trigger alternates its two clips | trapdoor, shutters, chest, crate, wardrobe, drawers |
| `oneshot` | each trigger plays the clip once | lever, pressure plate, wall button |
| `loop` + `autoplay` | plays for ever, from the moment it is placed | torch flame, banner, ceiling fan — **the only autoplaying items** |

**Nothing else moves by itself.** A door placed in a scene stands closed, in Edit, after a reload
and in a loop. It opens only in **Interact / Play**, on a click (or a laser / poke in VR), or by
proximity (within 1.5 m) for the sliding doors and the pressure plate. The state is shared with
everyone in the session. Each trigger plays a sound: `door`, `gate`, `slide`, `lid`, `lever`,
`click`.

## The parts of an item

- **`Frame`** is the static part (a door's frame, a chest's body, a lever's base). A gate's second
  pillar (`FrameR`) and a gate wall's upper storey (`FrameTop`) are static too.
- **The moving part's node origin is its hinge or axle**: `Leaf` (a door), `LeafL`/`LeafR` (a
  pair), `PanelL`/`PanelR` (sliding), `ShutterL`/`ShutterR`, `Lid`, `DoorL`/`DoorR`,
  `Drawer1..3`, `Handle`, `Plate`, `Cap`, `Grid`, `Rotor`, `Flame`. `Banner` moves by morph
  targets instead of a transform.
- **Clips**: `open` and `close` (or `close` and `open` for the shutters, which are placed open),
  `pull` or `press` for a oneshot, and `loop` for an ambient piece. Every GLB also starts with a
  static `idle` clip (the rest pose, held). An app that plays a model's first clip on its own
  (theprototype 1.18 and earlier) therefore still shows a closed, still door.
- **Doors open away from their front** (+Z), into the room behind them, about the hinge on
  their left as you face them.

## Fitting them to the other kits

- **Door + frame** and **Studded oak door + frame** go at the SAME position and rotation as the
  architecture kit's **Wall — doorway** (1.0 × 2.2 m opening), exactly like its static Door.
- **Window + shutters** goes at the same spot as a **Wall — window**. It is placed with the
  shutters open (flat against the wall); the first click closes them.
- **Double door** and **Portcullis** REPLACE a wall: they are the sandstone wall with a wider
  opening cut by the architecture kit's own tool. The portcullis piece is 4.5 m tall because its
  grid winds up into the half storey above the gate.
- **Iron gate**: its two sandstone pillars stand on grid points 2 m apart (x = ±1), like the
  kit's Gate between two Pillars.
- **Sci-fi sliding door** goes at the same spot as the sci-fi kit's **Wall — open doorway**. Its
  panels part into that wall, so on its own they slide out past the frame. **Sci-fi wall +
  sliding door** is the self-contained version.
- **Ceiling fan**: the origin is the ceiling mount, so place it at the ceiling's height (y = 3
  for one storey).
- **Torch**, **banner** and **wall button** pivot on the wall surface (the back face is z = 0) and
  face +Z, like the props kit's wall pieces.

## Items

<!-- items:start -->
| Item | Folder | Size x × y × z (m) | Tris | GLB | Nodes | Behavior | Place it | Made from |
|---|---|---|---|---|---|---|---|---|
| Door + frame, opens (fits the kit doorway) | `DoorWood` | 1.3 × 2.35 × 0.33 | 2870 | 482 KB | Frame, Leaf | door: `open` / `close`, click, sound `door` | at the SAME position and rotation as a Wall — doorway (architecture kit) | architecture-kit Door, split |
| Studded oak door + frame, opens | `DoorStudded` | 1.36 × 2.35 × 0.35 | 2558 | 661 KB | Frame, Leaf | door: `open` / `close`, click, sound `door` | at the SAME position and rotation as a Wall — doorway | Meshy leaf + procedural oak frame |
| Double door in a sandstone wall (2 × 3 m) | `DoorDouble` | 2 × 3 × 0.25 | 4775 | 1211 KB | Frame, LeafL, LeafR | door: `open` / `close`, click, sound `door` | in place of a Wall: on a grid line, x or z on an odd metre | architecture-kit Wall (cut 1.6 × 2.4 m) + Gate leaves |
| Iron gate between two pillars | `IronGate` | 2.5 × 3 × 0.5 | 5866 | 971 KB | Frame, FrameR, LeafL, LeafR | door: `open` / `close`, click, sound `gate` | on a grid line, the pillars on the grid points 2 m apart (x = ±1) | Meshy gate + architecture-kit Pillars |
| Portcullis in a gate wall (2 × 4.5 m) | `Portcullis` | 2 × 4.5 × 0.25 | 6307 | 1385 KB | Frame, FrameTop, Grid | door: `open` / `close`, click, sound `gate` | in place of a Wall; the half-storey above holds the raised grid | Meshy grid + architecture-kit Wall (cut 1.7 × 2.2 m) + half wall |
| Sci-fi sliding door + frame, opens (fits the doorway) | `SlidingDoor` | 1.5 × 2.6 × 0.3 | 3294 | 291 KB | Frame, PanelL, PanelR | door: `open` / `close`, proximity, sound `slide` | at the SAME position and rotation as a scifi-kit Wall — open doorway (the panels slide into the wall) | scifi-kit Sliding door, split |
| Sci-fi wall + sliding door, opens | `WallSlidingDoor` | 2 × 3 × 0.3 | 4640 | 494 KB | Frame, PanelL, PanelR | door: `open` / `close`, proximity, sound `slide` | like a scifi-kit Wall | scifi-kit Wall + sliding door, split |
| Trapdoor + floor frame (1.2 m) | `Trapdoor` | 1.24 × 0.1 × 1.24 | 546 | 87 KB | Frame, Leaf | toggle: `open` / `close`, click, sound `door` | on a floor; the shaft under the hatch is dark | props-kit Hatch + procedural oak frame |
| Window + shutters that close (fits the window wall) | `Shutters` | 1.55 × 1.25 × 0.48 | 2564 | 566 KB | Frame, ShutterL, ShutterR | toggle: `close` / `open`, click, sound `door` | at the SAME position and rotation as a Wall — window (architecture kit) | architecture-kit Window, shutters re-hung |
| Treasure chest, lid opens | `Chest` | 0.77 × 0.6 × 0.69 | 3120 | 801 KB | Frame, Lid | toggle: `open` / `close`, click, sound `lid` | on a floor | props-kit Chest, split |
| Crate, lid opens | `Crate` | 0.81 × 0.55 × 0.55 | 2752 | 703 KB | Frame, Lid | toggle: `open` / `close`, click, sound `lid` | on a floor | props-kit Crate, split |
| Oak wardrobe, doors open | `Cabinet` | 1 × 1.5 × 0.5 | 3847 | 382 KB | Frame, DoorL, DoorR | toggle: `open` / `close`, click, sound `door` | on a floor, back to a wall | Meshy |
| Chest of drawers, drawers slide out | `Drawers` | 1 × 1 × 0.5 | 4244 | 538 KB | Frame, Drawer1, Drawer2, Drawer3 | toggle: `open` / `close`, click, sound `lid` | on a floor, back to a wall | Meshy |
| Lever (pull: one-shot) | `Lever` | 0.34 × 0.58 × 0.43 | 424 | 132 KB | Frame, Handle | oneshot: `pull`, click, sound `lever` | on a floor or a ledge | props-kit Lever base + handle |
| Pressure plate 1 × 1 m (steps sink it) | `PressurePlate` | 1 × 0.05 × 1 | 72 | 88 KB | Frame, Plate | oneshot: `press`, proximity, sound `click` | on a floor, filling one grid cell | props-kit Pressure plate, split |
| Wall button (press: one-shot) | `WallButton` | 0.2 × 0.2 × 0.1 | 300 | 99 KB | Frame, Cap | oneshot: `press`, click, sound `click` | origin on a wall face, facing out | props-kit Wall button, split |
| Wall torch, flickering flame (ambient) | `Torch` | 0.1 × 0.69 × 0.32 | 652 | 139 KB | Frame, Flame | loop (autoplay): `loop`, click | origin on a wall face, facing out | props-kit Wall torch |
| Banner stirring in a draught (ambient) | `Banner` | 1.34 × 1.66 × 0.09 | 640 | 435 KB | Frame, Banner | loop (autoplay): `loop`, click | origin on a wall face, facing out | props-kit Tapestry + morph targets |
| Ceiling fan, turning (ambient) | `CeilingFan` | 1.3 × 0.99 × 1.3 | 2540 | 690 KB | Frame, Rotor | loop (autoplay): `loop`, click | origin at the mount: put it at the ceiling height (y = 3) | Meshy |
<!-- items:end -->

## How they were made

With the **embedded tools** in `tools/anim/` (glTF-Transform + three.js, 0 credits), the existing
kit meshes are split along planes into named nodes. Triangles that cross a cut are clipped, not
dropped, so a leaf has a straight edge. Each cut is sealed with a cap that wears a texel of the
piece itself. The hinge goes on the node origin. Then `open`/`close` keyframes are authored
(eased swings and slides, a flicker, a morph wave), and `tools/anim/look.mjs` renders every clip
in three.js to check it. Six meshes are new, generated with **Meshy.ai** (requester
`33-anim-kit`): the studded door leaf, the iron gate, the portcullis grid, the wardrobe, the
chest of drawers and the ceiling fan. `node tools/interactive-kit/build.mjs` rebuilds the pack.
`tools/interactive-kit/rigs.mjs` is the whole recipe.

**LODs** (the `lods` rows, contract P1): `tools/lod` (33-pack-fix-lod) runs on the built GLBs:
`node tools/lod/defight-all.mjs interactive-kit && node tools/lod/lod.mjs interactive-kit`. It
first settles coplanar layers, then writes `<name>.lod1.glb` / `.lod2.glb`, simplified PER NODE.
The node names, hierarchy and clips stay the same, so a door at LOD2 still opens. 16 items have
levels. The Lever, Pressure plate and Wall button are under the tool's 500-triangle floor, so
they have none. Re-run both steps after any rebuild: build.mjs keeps the `lods` rows, but it
rewrites the LOD0s.

License: **CC0-1.0**. See `attribution.html`.
