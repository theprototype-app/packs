# tools/kit-build — the one pack build tool, and the pack CI

Every kit used to carry its own copy of the post-processing (architecture, sci-fi and town had a
`kit-post.mjs` each; nature, props and interior their own grade / emissive / flat-for-sync
helpers). They now share this tool. A kit keeps only its **recipe** — which Meshy raw, kitbash or
procedural piece makes each item — and everything after it is here.

```
cd tools/meshy && npm ci                              # once: the deps every pack tool uses
node tools/kit-build/kit-build.mjs <command> …
```

| command | what it does |
|---|---|
| `build <pack> [--only A,B] [--no-thumbs]` | the pack's recipe → `pass --write` → judged defight → LOD1/LOD2 → thumbnails → `check` |
| `post <raw.glb> <out.glb> '<job>'` | the one post step on a Meshy raw: pre-rotate, meshy-post (weld, **decimate to `targetTris`**, stretch to `dims`, pivot, textures to the cap as JPEG), seam clamp, offset, **emissive policy** + albedo grade, recolor, glow mask, defight (`lib/post.mjs` documents the job) |
| `pass <pack…\|--all> [--write]` | on the SHIPPED LOD0s, from `packs.json`: emissive policy, **texture cap per pack**, PNG → JPEG for an opaque file over the 5 MiB share cap, **decimate to the category budget**. Dry run unless `--write`; a compliant file is never rewritten |
| `lod <pack>` | `tools/lod`: judged defight of LOD0s, then LOD1/LOD2 files + each row's `lods` (P1), then `--check` |
| `thumbs <pack> [--only A,B]` | renders each row's screenshot (512², transparent, yaw 35°) |
| `flicker <pack…\|--all> [--record]` | the static z-fight probe; `--record` RENDERS every file over the limit (headless) and writes `flicker-baseline.json` |
| `report [pack…] [--md f] [--json f]` | the **budget report**: per item tris vs budget, MiB, largest texture, LOD triangles, z-fight cm² |
| `check [pack…] [--summary f] [--json f]` | **the CI** — exit 1 on any error that `allow.json` does not list |

The recipes `build` runs: `tools/architecture-kit/build.mjs`, `tools/scifi-kit/build.mjs`,
`tools/town-kit/build.mjs`, `tools/interactive-kit/build.mjs`, `nature-kit/build/finalize.mjs`,
`props-kit/_src/build.mjs`, `interior-kit/_src/build.mjs` (they read the staged Meshy raws under
`~/.code/lanes-30/meshy/staging/`; nothing here spends credits).

**Byte-stable.** When the forks were folded in (roadmap 34), the old and the new code rebuilt the
architecture, nature, props, interior and sci-fi kits from the same raws: 159 / 159 GLBs
byte-identical. `pass --all` on main changes exactly one file (default/SvelteRune, see below).

## The checks (`check`, run on every packs PR)

| check | rule |
|---|---|
| index | `index.json` rows: name, title, exactly one of value / zip, attribution, copyright, license, https source; files exist; every pack has a policy in `packs.json` |
| manifest | each model list: row shape incl. **`lods`** (P1: files beside LOD0, ratios in (0, 1], finest first) and **`behavior`** (P2: type, clip, trigger, autoplay only for `loop`, closeClip only for door/toggle, no unknown keys — core silently normalises a typo, the CI refuses it); unique names; no orphan GLBs (warn) |
| size | every GLB ≤ 5 MiB (the share cap — bigger never reaches a peer); warn > 2 MiB |
| tris | LOD0's drawn triangles ≤ the item's category budget |
| textures | largest texture side ≤ the pack's cap |
| emissive | a pack whose policy is `none` has nothing that glows; an emissive map under a black factor warns |
| scale | the bbox is in metres: largest extent ≥ 5 cm and ≤ the category's maximum |
| pivot | the origin is where the item's pivot rule says (below) |
| lods | items over 2 000 triangles ship LOD files; each exists, has fewer triangles than LOD0, its `ratio` is the measured one (± 0.05), keeps LOD0's mesh-node names (core swaps BY NAME) and its clips |
| behavior | the clips a behavior names exist in the GLB and in every LOD file |
| flicker | the static z-fight probe (`tools/lod/coplanar.mjs`: coplanar triangle pairs, both facings when double-sided) ≤ 1 cm² — or at most the file's recorded baseline |
| thumb | the row's screenshot exists, decodes, ≥ 64 px |

### Policy: `packs.json`

`categories` give the triangle budget and largest extent (tile 2 500 · prop 6 000 · modular 6 500 ·
functional 7 000 · hero 8 000 · set 12 000 · tree 15 000 · legacy 25 000). `packs` give each pack's
`textureCap`, `emissive` (`none` | `allowed`), default `category` and `pivot`, and per-item
overrides. **A new pack needs a row here** — the check says so.

Pivot rules: `bottom-center` (default) · `bottom-center-back` (a tapestry, a torch: back on the
origin) · `top-center` (hangs: a chandelier, a fan) · `wall-pivot` (shares the wall's bottom-centre
origin and starts above the floor: a window) · `wall-face` (origin on the wall line, the piece on
the wall's face: interior trims, a wall screen) · `foot` (stands on its origin, which is under the
piece but not its middle: a signpost's post) · `hinge` (origin within 5 cm of the piece: a lever
handle) · `any` (legacy packs that keep their source scene's coordinates).

### Accepted failures: `allow.json`

`{pack, item ('*' = all), check, file?, reason}`. Every entry carries the reason it is accepted; an
entry that matches nothing is reported so it gets removed once the item is fixed. Today: 15 items
`tools/lod` builds no level for (its visual gate refuses every candidate — foliage, straw and fine
detail need impostor levels, roadmap-33 F2) and nature-kit's PondSet render flicker.

### The z-fight baseline: `flicker-baseline.json`

The static probe over-counts: a coplanar pair hidden inside a piece, or one whose two layers carry
the same texels, never shows — which is why 33-pack-fix-lod only rewrote a file when a RENDER
flickered clearly less. A file over the static limit therefore passes only if it was rendered
(`tools/lod/judge.mjs` flicker: 512², 12 orbit poses, micro-triplets) at ≤ 400 px and recorded with
its overlap; the CI holds it to that area (+2 %). After `defight-all` or a rebuild:

```
node tools/kit-build/kit-build.mjs flicker <pack> --record   # refuses (exit 1) a file over 400 px
```

## Making the check required (repo admin)

The workflow is `.github/workflows/pack-checks.yml`, job **`pack-checks`**. In GitHub: Settings →
Branches → branch protection rule for `main` (or Rules → Rulesets) → *Require status checks to pass*
→ add `pack-checks`. Or:

```
gh api -X PUT repos/theprototype-app/packs/branches/main/protection --input - <<'JSON'
{"required_status_checks": {"strict": false, "contexts": ["pack-checks"]},
 "enforce_admins": false, "required_pull_request_reviews": null, "restrictions": null}
JSON
```

## Tests

`node --test tools/kit-build/test/*.test.mjs` — a fixture pack that passes every check, then each
check shown red on the one thing it exists to catch (and `pass` fixing it, byte-stable after).
