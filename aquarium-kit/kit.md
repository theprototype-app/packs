# Aquarium Kit — kit guide

Seven pieces for a reef tank, a pond or an underwater scene: three realistic reef fish, a reef
rock arch a fish can swim through, a staghorn coral and two aquatic plants. They were made for the
**Aquarium** example (Templates ▸ Examples), where the fish swim with core's general-purpose motion
nodes (Follow Path, Wander, Orient to Velocity, Body Wave) and wear the **Fish scales** thin-film
look.

## Scale and pivots

**1 unit = 1 metre.** The Aquarium's tank is 4 × 2 × 1.6 m, so the fish are sized for it (a real
clownfish is 0.1 m — scale a piece down for a desk tank).

| Piece | Size x × y × z (m) | Tris | LODs | Pivot | Place it |
|---|---|---|---|---|---|
| `FishClown` | 0.13 × 0.14 × 0.32 | 4000 | 2 | **centre**, nose +Z | free in the water |
| `FishTang` | 0.17 × 0.22 × 0.42 | 3973 | 1 | **centre**, nose +Z | free in the water |
| `FishAngel` | 0.18 × 0.24 × 0.42 | 3908 | 1 | **centre**, nose +Z | free in the water |
| `CoralArch` | 1.0 × 0.69 × 0.54 | 5209 | 1 | bottom centre | on the sand; the opening runs along X |
| `CoralBranch` | 0.57 × 0.5 × 0.54 | 5234 | — | bottom centre | on the sand or a rock |
| `PlantSword` | 0.57 × 0.9 × 0.61 | 4004 | — | bottom centre | on the sand, back of the tank |
| `PlantEelgrass` | 0.77 × 1.3 × 0.77 | 3509 | — | bottom centre | in clumps along the back glass |

(`kit-build dims` writes the exact `size` / `box` of every row into `default.json`.)

The fish face **+Z** and turn about their **middle** (the new `center` pivot rule in
`tools/kit-build`): that is what Follow Path, Orient to Velocity and Body Wave expect (`forward`
+z), and what lets a fish bank and bend about its own body.

## The look

The fish carry **KHR_materials_iridescence** (factor 0.55, IOR 1.45, 140-460 nm): the thin-film
flash of a turning fish. Core draws it at the device's **look tier** — on a desktop and a phone, not
in a headset (40 F16). The plants are double-sided (their ribbon leaves have no back faces).

## Levels of detail

`kit-build lod` built levels for the fish and the arch. The branching coral and both plants have
none: the visual gate refuses every candidate (thin branches and ribbon leaves need impostor
levels, roadmap-33 F2 — listed in `tools/kit-build/allow.json`); core's automatic runtime LOD still
applies.

## How it was made

Meshy.ai, preview-then-refine under the `40-aquarium` cap (310): eleven previews (5 credits each,
`meshy-6-lite`, style none — "realistic"), looked at as a sheet; one rejected (a potted garden plant)
and one angelfish dropped for a spike; seven refined (10 each); the arch (black inside) and the
Amazon sword (lime, dark spots) retextured (10 each) — **145 credits**. Then
`node tools/aquarium-kit/build.mjs` (kit-build's post step + the film + double-sided leaves),
`kit-build lod`, `thumbs`, `dims --write`, `check`.
