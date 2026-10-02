# Arcane Study Kit — kit guide

Seven hero props for a wizard's study, an alchemist's workshop or an observatory: a crystal
ball, an alchemist's table, a lectern with an open spellbook, a brass telescope, an armillary
sphere, a shelf of potions and a round rune rug. They were made for the **Wizard's Tower**
example level (Templates ▸ General), which builds the tower itself from the **Modular
Architecture Kit**, furnishes it from **Interiors** and **Props**, and makes it work with the
**Interactive Kit** (doors, a trapdoor, a chest, a lever).

Same look as the other kits — "stylized realistic", chunky, hand-painted PBR in dark walnut,
aged brass and parchment — and **one accent colour: deep violet** (the crystal ball's glow, the
globe, the potion glass, the rug, the runes in the book).

## Scale and pivots

**1 unit = 1 metre**, every pivot at the **bottom centre**: drop a piece on a floor and it rests
on it. The kit's floor tiles have their top at **y = 0.1**, so put props at y = 0.1 on them.

| Piece | Size x × y × z (m) | Tris | LODs | Place it |
|---|---|---|---|---|
| `CrystalBall` | 0.49 × 0.55 × 0.49 | 3122 | 2 | on a table (the alchemist's table top is at 0.76 m) or its own stool |
| `AlchemyTable` | 1.6 × 1.11 × 0.88 | 6000 | 2 | against a wall, the long side facing the room |
| `Lectern` | 0.98 × 1.25 × 0.61 | 3499 | 1 | free-standing, the book facing +Z |
| `Telescope` | 1.6 × 1.6 × 0.48 | 3691 | 1 | by a window or on a roof, the tube along X |
| `Armillary` | 0.84 × 0.9 × 0.81 | 4999 | 1 | on the floor or a plinth |
| `PotionShelf` | 1.11 × 1.8 × 0.44 | 5999 | 2 | back to a wall: its back is 0.22 m behind the pivot, so on an architecture-kit wall (0.25 m thick, centred on its line) put it 0.345 m in front of the line |
| `RuneRug` | 2.4 × 0.02 × 2.4 | 601 | 1 | flat on a floor (y = 0.1 on kit tiles) |

## Levels of detail and flicker

Every piece has `lods` rows (contract P1) built by `tools/lod` (`lod.mjs`: meshopt-simplified per
primitive in place, visually gated) and went through `defight-all.mjs` (the Telescope had 198
coplanar pairs → 0). `node tools/lod/lod.mjs --check arcane-kit` verifies.

## How it was made

Meshy.ai, preview-then-refine: eight previews (5 credits each) looked at as renders, one rejected
(a lectern that read as a cabinet) and re-prompted, seven refined (10 each) with a deep-violet
accent — 110 credits under the `33-scenes` cap. Then `tools/meshy` post-processing (1024²
textures, real metres, bottom-centre pivots), the rug laid flat by hand, `tools/lod`.
