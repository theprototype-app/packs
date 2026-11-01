# Skies (HDRIs) for Configure scene

The five sky presets of theprototype.app's *Configure scene ▸ Sky* (roadmap 59 T3). They moved off the
app bundle in 1.4x: the app downloads one the first time it is picked, from the ref-pinned jsDelivr
mirror of this repo (`https://cdn.jsdelivr.net/gh/theprototype-app/packs@format-1/hdri/<file>`), and
keeps it in the browser (Cache Storage `tp-skies-v1`). The small preview cards stay in the app.

This folder is NOT an Explorer pack: it has no `index.json` row and no manifest. The file names are
part of the app's contract (`src/lib/hdri/catalog.js`) — never rename or re-encode them; add a new
file under a new name instead.

All five are **CC0** (public domain) from [Poly Haven](https://polyhaven.com/hdris), at their 1k size
(1024×512 Radiance RGBE), unmodified.

| preset | file | Poly Haven asset | author(s) |
|---|---|---|---|
| Clear sky | `kloofendal_48d_partly_cloudy_puresky_1k.hdr` | [Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) | Greg Zaal, Jarod Guest |
| Meadow | `meadow_2_1k.hdr` | [Meadow 2](https://polyhaven.com/a/meadow_2) | Sergej Majboroda |
| Sunrise | `spruit_sunrise_1k.hdr` | [Spruit Sunrise](https://polyhaven.com/a/spruit_sunrise) | Greg Zaal |
| Starlight | `dikhololo_night_1k.hdr` | [Dikhololo Night](https://polyhaven.com/a/dikhololo_night) | Greg Zaal |
| Photo studio | `studio_small_09_1k.hdr` | [Studio Small 09](https://polyhaven.com/a/studio_small_09) | Sergej Majboroda |

## UltraHDR sizes (roadmap 72, LK2)

Beside each `.hdr` sit `_1k.jpg`, `_2k.jpg` and `_4k.jpg` (Meadow also has `_8k.jpg`, the showcase): the
same Poly Haven skies at those sizes, CC0, encoded as UltraHDR (an SDR JPEG + a gain map) by the core
repo's `scripts/hdri-uhdr.cjs` from Poly Haven's own `.hdr` of that size.
The `.hdr` files stay: older releases fetch them, and they are the fallback.

```
node scripts/hdri-uhdr.cjs <id>_1k.hdr <id>_1k.jpg --gs 1 --gq 95 --q 92 --check   # the light: full-size gain map
node scripts/hdri-uhdr.cjs <id>_4k.hdr <id>_4k.jpg --check                         # sky only: half-size gain map
```

The 1K file is what the app LIGHTS a scene from, so `--check` must read energy within 2% of the source
(measured 0.992 to 1.018). The larger files only draw the sky; there the sun's disc loses energy to the
half-size gain map (0.59 to 0.99) and still clips to white on screen.

`sha256sum -c hdri/SHA256SUMS` verifies the bytes (and a jsDelivr purge: fetch each URL and compare).
