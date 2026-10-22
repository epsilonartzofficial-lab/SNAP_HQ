# Handoff (22 October 2026, end of v0.3.2)

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
- **0.3.2 done (sound)**: `js/audio.js` synthesizes all sounds with Web Audio; hooks in `game.js` and `mobs.js`;
  volume setting; e2e scenario M checks that sounds play and reach a real level.
  Latest full run: unit 115/115, lighting 16/16, e2e 12/13 (B failing, see below), world e2e 5/5.
- **Open issue: scenario B is intermittent** (passed 1 of 3 runs alone). Two failure points seen:
  "right-click on the block did not open a screen" (crafting table) and "block 6,20,0 did not break within
  20000 ms" (stone with a wooden pickaxe). Hypothesis, not yet confirmed: since v0.3.0 animals spawn in Classic
  worlds, and one standing in the line of sight takes the click (`interact()` in `game.js` checks the creature
  ray first). `mine()` in `tests/e2e.mjs` now prints creatures within 4 blocks on failure; run `node tests/e2e.mjs B`
  and read the full failure line (it is long; do not cut it off). If confirmed, add a `creatures = false` option to
  the e2e `createWorld` helper that sets `BC.game.mobs.config.spawning = false` and calls `BC.game.mobs.clear()`
  for scenarios A–K, and pass `creatures: true` in L. Then rerun the whole suite.
- **Next update: 0.3.3 Building blocks** (owner request): logs placed along any axis (currently always vertical),
  slabs and stairs for each wood and stone, placeable top, bottom, vertical (against a wall) and upside down,
  turned every way. Needs: block states (orientation per block id or variant ids; there is a `placeAs` hook in
  `place()` in `game.js` and `frontAxis` support), meshing for non-cube shapes in `render.js`, collision shapes in
  `game.js` physics and `mobs.js`, recipes, textures, save compatibility (block ids are saved, never renumber;
  id ranges are in ROADMAP "Id ranges"), unit and e2e tests.
- After that: 0.3.4 biome variety, 0.3.5 farming and breeding, 0.3.6 bow/shears/wool, 0.3.7 item art,
  0.3.8 character creation, then stop for the desktop-app decision.

## Usage so far (API-equivalent estimates)

| Update | Requests | Output tokens | Cache reads | Cache writes | Estimate |
|---|---|---|---|---|---|
| 0.3.1 | 31 | 16.9k | 8.24M | 27.9k | about $2.20 |
| 0.3.2 (with this handoff) | 38 | 35.0k | 11.95M | 93.1k | about $3.85 |

Cache reads are about 75 % of the cost: each request re-read a conversation of about 300k tokens. A fresh
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
