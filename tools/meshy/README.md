# tools/meshy — the budgeted Meshy.ai pipeline

One shared, credit-safe path from a prompt to a pack-ready GLB. **Every** Meshy
generation for theprototype goes through `meshy-gen` with `--requester <lane slug>`;
nothing else holds the key.

```
npm ci                                              # in tools/meshy (Node ≥ 20)
set -a; . ~/.config/theprototype/meshy.env; set +a  # the key: env only, never in a file here
node bin/meshy-gen.js --requester <slug> --job jobs.json [--dry-run] [--post] [--concurrency 2]
node bin/meshy-post.js raw.glb model.glb --job job.json [--thumb thumb.webp]
node bin/meshy-thumb.js a.glb b.glb … --sheet sheet.png      # LOOK before you refine
node bin/meshy-balance.js                                    # live balance, spend vs cap, drift
node bin/meshy-library.js --search walk                      # animation library ids (free GET)
node bin/meshy-rigged.js rig.glb out.glb --clip walking.glb=walk --clip anim.glb=hit,death --tris 8000
npm test                                                     # ledger/cap/idempotency/post — no credits
```

Shared state (`MESHY_HOME`, default `~/.code/lanes-30/meshy/`): `budget.json` (per-requester
caps + notes), `ledger.jsonl` (append-only, every line under `flock`), `READY`,
`staging/<requester>/<job>/<stage>-<attempt>/{raw.glb, meshy-thumb.png, task.json, job.json, model.glb, thumb.webp}`.

## A job

```jsonc
{
  "id": "crate-small",          // slug; idempotency key with requester + stage + attempt
  "pack": "props-kit",
  "prompt": "a small wooden crate with iron corner brackets",   // preview only, ≤ 600 chars
  "stage": "preview",           // preview | refine | retexture | remesh
  "model": "t2",                // preview: t2 (default, 5 cr) | meshy-6-lite (5) | meshy-6 / meshy-7.1 (20)
  "targetTris": 3000,           // t2 generates AT this count; meshy-post simplifies to it
  "texturePrompt": "weathered oak, dark iron",   // refine / retexture (required for retexture)
  "from": "crate",              // refine/retexture/remesh: which job's mesh (default: this id)
  "sourceTaskId": "…",          // …or an explicit Meshy task id
  "style": "house",             // house (default: appends the locked art direction) | none
  "category": "prop",
  "dims": { "y": 0.6 },         // metres; any of x/y/z
  "fit": "contain",             // contain (uniform) | stretch (each given axis exactly — modular pieces)
  "pivot": "bottom-center",     // bottom-center | bottom-back-left | bottom-center-back | center | none
  "rotateY": 0, "hero": false   // hero → 2048² textures
}
```

**Characters (30c-game-assets):** `"stage": "rig"` (5 cr, `heightMeters`, default 1.7) auto-rigs
the textured refine/retexture of `from` — a HUMANOID with clear limbs, facing +Z — and saves
`raw.glb` (the rigged character) + `walking.glb` + `running.glb` (Meshy's basic clips, included).
`"stage": "animate"` (3 cr per action, `actionIds` 1-10 from `meshy-library`, optional `fps`)
takes the rig of `from` and saves `raw.glb` with those clips. `--post` skips both (meshy-post
would tear a skin off its skeleton): merge them with `meshy-rigged`, which copies every clip onto
the base skeleton by node name, names them (`walk`, `hit`, `death`…), welds/simplifies the skinned
mesh, drops the black emissive and resizes textures to 1024² JPEG.

`refine` finds the SUCCEEDED `preview` of `from` (or its own id) in the ledger;
`retexture` takes the newest refine/retexture/preview mesh of `from`.

## Why it cannot double-spend

* **Cap check + reservation are one `flock` hold** on `ledger.jsonl`: concurrent lanes
  never both squeeze under a cap (unit test: 8 processes, 20-credit cap → exactly 4).
* **Idempotent by job key** `<requester>/<id>/<stage>#<attempt>`: re-running a job
  resumes its task (poll / re-download), it never POSTs again. `--again` is the
  only way to pay for a second generation of the same id.
* **In-doubt POSTs are adopted, not repeated**: a reservation without a task id
  (crash, timeout, 5xx after the request left) is matched against Meshy's task list
  on the next run; only when Meshy has no such task is the reservation released.
* **429 / connection-refused** mean "not created" and are retried with backoff;
  other 4xx release the reservation (not charged); FAILED tasks are refunded by
  Meshy and the ledger books `consumed_credits` as the truth.

## meshy-post (every asset, no exceptions)

bake node transforms → rotateY → weld → simplify to `targetTris` (meshoptimizer) →
join → scale to `dims` → pivot → drop the black emissive map Meshy-6 ships →
textures to 1024² JPEG (2048² hero) → prune/dedup → `asset.extras.meshyPost`.
No Draco/Meshopt geometry compression and no WebP: core's Explorer preview parse and
the scene-sync receiver use a bare `GLTFLoader` without decoders, and the sync's
`GLTFExporter` round-trip keeps JPEG as-is. Refuses to write a GLB over the 5 MB share cap.
Meshy's own generator/extras are never stripped (Meshy ToS §2.4).

## Tests

`npm test` — 28 unit tests (7 for rig/animate/meshy-rigged) (ledger, cap, cross-process flock race, idempotency,
orphan adoption, refunds, 429/5xx classification, key scrubbing, post-processing
geometry/texture/pivot math on a synthetic GLB). `test/e2e-app-load.cjs` — a
post-processed GLB imported as a pack into a running core dev server, placed,
measured (textured, 0.8 m, bottom pivot) and replicated to a second peer (see its header).
