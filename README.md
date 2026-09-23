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
scifi-kit/                       Sci-fi & Modern Kit: 28 snap-together station pieces + dressing
                                 on the 1 m grid (CC0, made with Meshy.ai; kit.md = how to build)
tools/scifi-kit/                 its reproducible build (Meshy jobs, post-processing, procedural pieces)
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
- `audio-essentials/` — all CC0; per-file sources in
  [CREDITS.md](audio-essentials/CREDITS.md) (Kenney.nl, OpenGameArt).
- `scifi-kit/` — © theprototype, CC0 1.0; made with [Meshy.ai](https://www.meshy.ai/)
  (see its `attribution.html`).

See [LICENSE](LICENSE) and each pack's `attribution.html`.
