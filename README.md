# theprototype.app packs

Content packs for [theprototype.app](https://theprototype.app) — served to the app
via the jsDelivr CDN (`https://cdn.jsdelivr.net/gh/theprototype-app/packs@format-1`).

## Layout

```
index.json                       the pack list the app fetches
default/                         The Prototype starter models (logo, Svelte rune, duck)
cube_diorama/                    Blender Studio's Cube Diorama, split per object (CC0)
khronos-sample-assets/           metadata only — model bytes are fetched straight from
                                 github.com/KhronosGroup/glTF-Sample-Assets (CC-BY 4.0)
audio-essentials/                23 CC0 sounds (Kenney + OpenGameArt), installable .zip
nature-kit/                      Nature & Terrain: 31 trees/plants/rocks/cliff/path/pond pieces
                                 (made with Meshy.ai, CC0) — see nature-kit/kit.md
architecture-kit/                Modular Architecture Kit: 32 walls/floors/roof/stairs/tower pieces
                                 on the 1 m grid (made with Meshy.ai, CC0) — see architecture-kit/kit.md
props-kit/                       Props & Interiors: 33 furnishing / dressing / game-logic
                                 props (made with Meshy.ai + procedural, CC0), kit.md
scifi-kit/                       Sci-fi & Modern Kit: 28 snap-together station pieces + dressing
                                 on the 1 m grid (CC0, made with Meshy.ai; kit.md = how to build)
tools/scifi-kit/                 its reproducible build (Meshy jobs, post-processing, procedural pieces)
tools/lod/                       no z-fighting (defight) + offline LODs: <name>.lod1/.lod2.glb and
                                 each row's "lods" field — see tools/lod/README.md
interactive-kit/                 Interactive Kit: 19 animated, functional pieces — doors WITH frames,
                                 gates, portcullis, trapdoor, shutters, chest, drawers, lever, plate,
                                 ambient torch/banner/fan — each with a `behavior` (kit.md)
tools/anim/                      the embedded rigging tools: split a mesh into frame + hinged parts,
                                 author open/close clips, render them (look.mjs); 0 credits
tools/interactive-kit/           the Interactive Kit's recipes (rigs.mjs) and build
interior-kit/                    Interiors: Home, Tavern & Office: 30 furniture / kitchen / bar / lights /
                                 decor pieces + wall trims that snap to the architecture kit's walls
                                 (CC0, made with Meshy.ai + procedural; kit.md, build in interior-kit/_src/)
town-kit/                        Town & Market Kit: 27 pieces — street tiles (cobble road, curb, corner,
                                 crossing, sidewalk), square, market and street-furniture pieces, an
                                 opening garden gate (made with Meshy.ai + procedural, CC0) — kit.md
tools/town-kit/                  its reproducible build + e2e
arcane-kit/                      Arcane Study Kit: 7 wizard's-study hero props with LODs (crystal ball,
                                 alchemist's table, lectern, telescope, armillary, potions, rune rug; CC0, Meshy.ai)
```

Each `index.json` row: `{name, title, value | zip, attribution, copyright, license, source}` —
`value` points at a model-list JSON (relative to this repo), `zip` at a self-describing
installable pack. The formats are documented in the app repo's
[PACKS.md](https://github.com/theprototype-app/core/blob/main/PACKS.md).

## Versioning

The app pins a ref (`@format-1`, `PACKS_BASE` in core's `src/lib/packs.js`) so pack
changes never break released builds. After a content change:

```
git tag -f format-1 && git push -f origin format-1     # re-point the serving ref
curl https://purge.jsdelivr.net/gh/theprototype-app/packs@format-1/index.json
# ...and each changed file path under the ref
```

jsDelivr caches a ref for up to 12 hours; the purge makes it immediate.

**THE REF MUST NOT LOOK LIKE A VERSION.** jsDelivr parses `v1` as a SEMVER VERSION and
caches a version's files PERMANENTLY (`cache-control: immutable`, one year) — a retag of
`v1` is a no-op forever, and `purge.jsdelivr.net` reports `finished` without
re-resolving it. `v1` is DEAD: it stays where jsDelivr first resolved it, for the builds
that shipped against it. A ref jsDelivr cannot parse as a version (tag or branch) is
reported as `x-jsd-version-type: branch` with a 12-hour `s-maxage`, which is what makes
the ritual above work — measured on the scenes repo, core issue #230.

The ref name tracks the `index.json` FORMAT, and a format bump takes a NEW ref
(`format-2`, ...) — never reuse an old one, because builds already in the wild keep
reading the ref they were built against.

## Licenses

- `default/` — The Prototype's own models (the Svelte rune references the
  [Svelte branding](https://github.com/sveltejs/branding); no endorsement implied).
- `cube_diorama/` — Blender Studio, CC0 ([demo files](https://www.blender.org/download/demo-files/)).
- `khronos-sample-assets/` — © The Khronos Group, CC-BY 4.0; bytes stay in the
  [upstream repo](https://github.com/KhronosGroup/glTF-Sample-Assets), this repo holds
  only an index.
- `architecture-kit/` — © theprototype, CC0; made with [Meshy.ai](https://www.meshy.ai) and
  post-processed here (`tools/architecture-kit/`) — see its `attribution.html` and `kit.md`.
- `props-kit/` — © theprototype, CC0; made with [Meshy.ai](https://www.meshy.ai) (paid
  plan: the output is ours) plus procedural pieces — see its `attribution.html` and `kit.md`.
- `audio-essentials/` — all CC0; per-file sources in
  [CREDITS.md](audio-essentials/CREDITS.md) (Kenney.nl, OpenGameArt).
- `nature-kit/` — © theprototype, CC0; made with [Meshy.ai](https://www.meshy.ai) and
  post-processed here (`nature-kit/build/`); grass, leaves decal and pond water are procedural.
- `interactive-kit/` — © theprototype, CC0; the architecture, props and sci-fi kits' pieces
  rigged with `tools/anim/`, plus six meshes made with [Meshy.ai](https://www.meshy.ai) — see its
  `attribution.html` and `kit.md`.
- `scifi-kit/` — © theprototype, CC0 1.0; made with [Meshy.ai](https://www.meshy.ai/)
  (see its `attribution.html`).
- `interior-kit/` — © theprototype, CC0 1.0; made with [Meshy.ai](https://www.meshy.ai/)
  (paid plan) plus procedural trims, lights and decor — see its `attribution.html` and `kit.md`.
- `town-kit/` — © theprototype, CC0 1.0; made with [Meshy.ai](https://www.meshy.ai/) plus
  procedural pieces (`tools/town-kit/`) — see its `attribution.html` and `kit.md`.
- `arcane-kit/` — © theprototype, CC0 1.0; made with [Meshy.ai](https://www.meshy.ai/)
  (see its `attribution.html`).

See [LICENSE](LICENSE) and each pack's `attribution.html`.
