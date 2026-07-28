# theprototype.app packs

Content packs for [theprototype.app](https://theprototype.app) — served to the app
via the jsDelivr CDN (`https://cdn.jsdelivr.net/gh/theprototype-app/packs@v1`).

## Layout

```
index.json                       the pack list the app fetches
default/                         The Prototype starter models (logo, Svelte rune, duck)
cube_diorama/                    Blender Studio's Cube Diorama, split per object (CC0)
khronos-sample-assets/           metadata only — model bytes are fetched straight from
                                 github.com/KhronosGroup/glTF-Sample-Assets (CC-BY 4.0)
audio-essentials/                23 CC0 sounds (Kenney + OpenGameArt), installable .zip
```

Each `index.json` row: `{name, title, value | zip, attribution, copyright, license, source}` —
`value` points at a model-list JSON (relative to this repo), `zip` at a self-describing
installable pack. The formats are documented in the app repo's
[PACKS.md](https://github.com/theprototype-app/core/blob/main/PACKS.md).

## Versioning

The app pins a tag (`@v1`) so pack changes never break released builds. Bump the tag
after content changes; jsDelivr caches aggressively.

## Licenses

- `default/` — The Prototype's own models (the Svelte rune references the
  [Svelte branding](https://github.com/sveltejs/branding); no endorsement implied).
- `cube_diorama/` — Blender Studio, CC0 ([demo files](https://www.blender.org/download/demo-files/)).
- `khronos-sample-assets/` — © The Khronos Group, CC-BY 4.0; bytes stay in the
  [upstream repo](https://github.com/KhronosGroup/glTF-Sample-Assets), this repo holds
  only an index.
- `audio-essentials/` — all CC0; per-file sources in
  [CREDITS.md](audio-essentials/CREDITS.md) (Kenney.nl, OpenGameArt).

See [LICENSE](LICENSE) and each pack's `attribution.html`.
