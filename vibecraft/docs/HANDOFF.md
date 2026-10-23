# Handoff (23 October 2026, end of v0.3.3)

Read this first in a new session, then `docs/ROADMAP.md` ("Update plan") and `docs/FEATURES.md`.

## The project

- Repo `epsilonartzofficial-lab/SNAP_HQ`, game in `vibecraft/`. Branch `claude/exciting-einstein-h75vtu`, PR
  https://github.com/epsilonartzofficial-lab/SNAP_HQ/pull/3 (pushing to the branch updates it).
- Vibecraft: browser survival sandbox inspired by Minecraft Java 26.3. Original code, art, names and sounds.
  Classic `<script>` files on a global `BC` namespace, runs from `index.html` over file://, vendored three.js r128.
- Build: `node tools/build.mjs` (from `vibecraft/`) → `dist/vibecraft.html` (offline single file, send to the owner
  with SendUserFile) and `dist/artifact.html` (publish to https://claude.ai/artifact/Eu4FumeX9CMCGA3m52shwX by
  publishing that file path with the artifact `url`).
- Tests: `node tests/unit.mjs` (115), `node tests/lighting.mjs` (16), `node tests/e2e.mjs [letters]` (A–M, about
  8 min), `node tests/e2e-world.mjs` (5). Run browser suites with nothing else using the CPU; they use software
  rendering and time out under load.

## How the owner wants to work

- Small updates of a few hours, in the order in the roadmap's update plan. After each update: run tests, commit,
  push, build, publish the artifact, send `dist/vibecraft.html`, and report. Then continue to the next update.
- Every report includes **usage** for that update: run
  `node tools/usage.mjs <this session's transcript .jsonl> <update start ISO time>` (transcripts live in
  `/root/.claude/projects/<project>/<session id>.jsonl`) and convert with Opus 5.5 prices: input $4/M,
  output $20/M, cache reads $0.20/M, 1-hour cache writes assumed $8/M.
- The session usage percentage is not visible to Claude. When the owner says usage is near 95 %, stop, finish and
  push the current update, and write a new handoff.
- **Stop before the desktop app (0.3.9)** and discuss: the owner mentioned Godot. Godot would be a rewrite of the
  game in GDScript/C#; Electron or Tauri wraps the existing game in hours. Give the trade-off, let them choose.
- Owner preferences: direct answers, no filler; sprint is double-tap W (no R); Ctrl-sprint only in the desktop app.

## Status

- **0.3.1 done**: bed placement fix, e2e scenario L (animals, melee, armor, beds), docs refreshed.
- **0.3.2 done (sound)**: `js/audio.js` synthesizes all sounds; volume setting; e2e scenario M.
- **0.3.3 done (building blocks)**: block states (see ROADMAP "0.3.3 report"), logs on any axis, slabs and stairs
  for 16 materials in every orientation, box collision with step-up, e2e scenario N. Cobblestone redrawn on the
  owner's request (they found blocks hard to tell apart); stone smoothed.
- Scenario B's intermittent failure is explained and fixed (bare-hand stone dig ran past a 20 s real-time limit
  on the slow software renderer).
- Known gaps: two slabs don't merge into a double slab; the block highlight outline is still a full cube.
- **Owner feedback to act on next**: textures are sometimes hard to tell apart. 0.3.7 (item art) could grow into
  a block-and-item texture pass; consider moving it earlier.
- **Next update: 0.3.4 Biome variety**: different tree shapes per biome (birch, spruce, jungle, acacia exist as
  log/leaf blocks in `js/blocks-biomes.js`; tree placement is in `js/worldgen2.js`), ground plants (tall grass,
  ferns, dead bushes, berry bushes, biome flowers), and distant-terrain colours to match.
- After that: 0.3.5 farming and breeding, 0.3.6 bow/shears/wool, 0.3.7 item art, 0.3.8 character creation,
  then stop for the desktop-app decision.

## Usage so far (API-equivalent estimates)

| Update | Requests | Output tokens | Cache reads | Cache writes | Estimate |
|---|---|---|---|---|---|
| 0.3.1 | 31 | 16.9k | 8.24M | 27.9k | about $2.20 |
| 0.3.2 (with this handoff) | 38 | 35.0k | 11.95M | 93.1k | about $3.85 |
| 0.3.3 + phone check + cobblestone | 58 | 66.8k | 24.3M | 547k | about $10.60 |

Cache reads were most of the cost: each request re-reads the whole conversation (about 300k tokens at 0.3.1,
about 500k by the end of 0.3.3). In 0.3.3 the cache also expired during an overnight pause, so the whole
conversation was written to the cache again (the 547k of cache writes, about $4.40). A fresh
session with this handoff starts much smaller, so the same work should cost noticeably less per update.
Effort was low to medium; thinking was about 25 % of output. That looked sufficient for these updates, and the
bugs that slipped through were caught by tests, not by more thinking.

## Useful facts

- Save keys `blockcraft.v2.*` are intentionally unchanged since the rename (old worlds keep loading).
- Creature light uses `world.getSkyLight(x, y, z)`; `BC.lighting.getSkyLight` has no world argument.
- Biomes generator: `gen.sample()` costs about 1 ms per column; use `gen.surfaceScan()` or `gen.scan()` for bulk.
- Distant terrain (`js/farterrain.js`) builds one tile per frame; its hole follows `world.readyRadius()`.
- e2e helpers worth knowing: `g.createWorld({ seed, gen, mode })` (gen defaults to 1, Classic), `__e2e.findGround`,
  `g.teleport`, `g.placeOn`, `g.mine`, `g.aim`, `g.frames(n)` (wait between aiming and clicking), `g.pauseLikeEsc()`.
