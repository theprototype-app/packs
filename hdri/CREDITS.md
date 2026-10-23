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

`sha256sum -c hdri/SHA256SUMS` verifies the bytes (and a jsDelivr purge: fetch each URL and compare).
