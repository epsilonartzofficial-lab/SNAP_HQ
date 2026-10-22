# Blockcraft feature checklist

Three states only:

- **Working**: implemented and tested. The evidence column says how: unit tests (`npm test`), browser
  end-to-end scenarios A–I (`npm run e2e`, headless Chromium), or a manual check in the browser.
- **Partial**: exists but is incomplete, differs from the reference, or lacks tests for a part that matters.
- **Missing**: not implemented. A texture, menu entry, data row or code stub alone never counts as Working.

Reference: Minecraft Java Edition 26.3 (stable, 15 September 2026). Reference numbers and sources are in
[research/REFERENCE-NOTES.md](research/REFERENCE-NOTES.md).

**Last updated: Stage 1, v0.2.0.** Results: 104/104 unit tests and 9/9 browser scenarios pass (284 s run).
Nothing was tested on a physical phone or tablet, or on a GPU. The browser tests use software rendering at
about 17 fps.

## Browser scenarios

| | Scenario |
|---|---|
| A | Main menu, create a Survival world with a seed, HUD shows 10 hearts and 10 hunger |
| B | First day: punch 3 logs (3.1 s each), craft planks, sticks and a table, 3×3 wooden pickaxe, stone drops nothing by hand and cobblestone with the pickaxe, stone pickaxe |
| C | Fall damage (4 → 1, 10 → 7, 3.5 → 0), drowning (2 damage per second after 15.9 s), hunger drain, eating an apple (1.65 s), no flying in Survival, no fall damage in Creative |
| D | Death with the inventory open: everything drops, respawn, walk back and recover it all, tool wear kept |
| E | Save and reload keep blocks, inventory including crafting grid and cursor, stats, position and dropped items; v0.1 save migrates |
| F | Creative: instant break, no drops, infinite placing, item palette, bin, flying |
| G | No pointer lock: drag to look, hold still to mine, quick click breaks, menu button, mode switch |
| H | Touch (emulated Pixel 7): menus, controls, look, inventory, long-press split, joystick, Mine |
| I | Crossing chunk borders: streaming, meshing, generator determinism, edits survive unload |

## 1. Game modes and player interaction

| Feature | State | Evidence and notes |
|---|---|---|
| Survival and Creative with correct differences | Working | C, F, code review. Survival blocks flying, instant breaking, the palette, infinite blocks and item-creating pick-block. |
| Switch mode from the pause menu (worlds with cheats on) | Working | G |
| First-person hand and held item, swing, equip and eating animation | Working | Manual screenshots |
| Mine (hold, timed by block and tool) | Working | B, unit tests |
| Place blocks | Working | B, F |
| Use: open crafting table, eat | Working | B, C |
| Attack | Partial | Swings, but there is nothing to hit until creatures exist (Stage 3). |
| Pick block (middle click) | Partial | Implemented for both modes; not covered by automated tests. |
| Sneak (slower, lower camera, won't walk off edges) | Partial | Implemented; not covered by automated tests. |
| Sprint | Partial | Double-tap W or hold R, needs food above 6. The reference uses Ctrl, which browsers reserve (Ctrl+W closes the tab). Not covered by automated tests. |
| Swim | Working | v0.1 baseline plus C |
| Climb (ladders, vines) | Missing | |
| Fly | Working | Creative only (F, C) |
| Desktop mouse with pointer lock | Working | A–F. Headless mouse movement under lock can't be simulated, so look direction is set by test hooks. |
| No-pointer-lock fallback | Working | G |
| Touch controls | Partial | H (emulated only). No physical-device test. |
| Settings: sensitivity, invert Y, FOV, render distance, reduce motion, hurt tilt, coordinates | Partial | Implemented and saved; only migration of render distance is covered by tests. |
| Audio settings | Missing | There is no audio yet. |
| Graphics settings beyond FOV and render distance | Missing | |
| Key rebinding | Missing | |
| Accessibility | Partial | Reduce motion, hurt-tilt toggle, coordinates, visible keyboard focus. No subtitles, GUI scale or colour options. |

## 2. Survival

| Feature | State | Evidence and notes |
|---|---|---|
| Health (20) with HUD | Working | A, C, D |
| Hunger, saturation, exhaustion | Working | Unit tests, C |
| Natural regeneration, starvation limits per difficulty, Peaceful regeneration | Working | Unit tests of the rules. The in-game integration is exercised by C. |
| Fall damage `floor(distance − 3)` | Working | C, unit tests. Current Java rule; water landings cancel it. |
| Drowning | Working | C |
| Cactus damage | Partial | Implemented; not covered by automated tests. |
| Void damage | Partial | Implemented, but the world floor is solid below y = 0, so it can't happen in normal play. |
| Invulnerability window after a hit, 3 s spawn protection | Working | Unit tests; spawn protection checked in the browser |
| Armor | Missing | Stage 3 |
| Death screen, drops, respawn, recovery | Working | D |
| Respawn safety | Working | Respawns on the current top block of the spawn column (checked with a 26-block shaft). |
| Sleeping, beds, personal spawn points | Missing | Stage 3. Respawn uses the world spawn. |
| Pause flow | Working | G, E |

## 3. Items and inventory

| Feature | State | Evidence and notes |
|---|---|---|
| Stack limits (64, tools 1) | Working | Unit tests |
| Item pickup | Working | B, D |
| Inventory screen: click, right-click split and place-one, shift-click | Working | Unit tests (including a 16,000-click conservation test), B, H |
| Number-key swap and Q drop while hovering | Partial | Implemented; not covered by automated tests. |
| Hotbar | Working | A–H |
| Equipment slots (armor, offhand) | Missing | Stage 3 |
| Durability and tool breaking | Working | Unit tests, B |
| Block drops and tool-tier gating | Working | Unit tests, B |
| Containers (chests) | Missing | Stage 2 |
| Items kept across save, reload, death, closing windows and mode changes | Working | D, E, code review. Items in the grid or on the cursor are always returned or dropped, never lost. |
| Dropped item merging, 5-minute despawn | Partial | Implemented; not covered by automated tests. A 2,000-stack safety cap exists; the reference has none. |

## 4. Resources and crafting

| Feature | State | Evidence and notes |
|---|---|---|
| Wood, planks, sticks, crafting table | Working | B |
| 2×2 and 3×3 crafting, mirrored recipes | Working | B, unit tests |
| Recipe list that fills the grid | Working | B |
| Wooden and stone tools | Working | B |
| Iron, golden and diamond tools | Partial | Recipes exist, but ingots need a furnace (Stage 2), so they can't be made in Survival yet. |
| Mining speeds and harvest tiers | Working | Unit tests match the reference: stone by hand 7.5 s, wooden pickaxe 1.15 s, log 3 s, dirt 0.75 s. |
| Furnace, fuel, smelting, cooking | Missing | Stage 2 |
| Food | Partial | Apples from leaves only, at 1 in 20 (the reference is 1 in 200) until animals exist. |
| Complete first day without Creative | Partial | Wood and stone tools, shelter and apples work. There are no torches, furnace, bed or meat yet. |

## 5. Combat and creatures

| Feature | State | Evidence and notes |
|---|---|---|
| Passive, neutral and hostile creatures | Missing | Stage 3 |
| Weapons | Missing | Swords and axes exist as items with reference damage values, but there is no combat. |
| Damage timing, knockback, armor interaction | Missing | Stage 3 |

## 6. World systems

| Feature | State | Evidence and notes |
|---|---|---|
| Blocks | Working | 20 types: the 19 from v0.1 plus the crafting table |
| Day and night cycle | Working | Sky colour, sun, moon, stars and clouds; global brightness only |
| Lighting and darkness (block and sky light) | Missing | Stage 2 |
| Flowing water and lava | Missing | Water is static; there is no lava. |
| Falling sand and gravel | Missing | |
| Farming and crop growth | Missing | Stage 5 |
| Trees and vegetation | Partial | Generated oak trees and cacti. No saplings, growth or grass plants. |
| Weather | Missing | |
| Villages, structures, loot | Missing | Stage 7 |
| Dimensions, portals, enchanting, bosses | Missing | Stage 9 |

## 7. Interface and world management

| Feature | State | Evidence and notes |
|---|---|---|
| Main menu | Working | A |
| Create world: name, mode, difficulty, seed, cheats | Working | A, F. Text seeds use the same hashing as the reference. |
| World list and loading | Working | E |
| Delete world (two-step confirmation) | Partial | Implemented; not covered by automated tests. |
| Export and import (text, file, download) | Partial | Implemented, and the save layer is unit-tested; the UI isn't. Inside the claude.ai viewer, downloads are blocked, so use Copy or a file picker there. |
| Pause-menu export when storage is full, confirmation before quitting after a failed save | Partial | Implemented after review; not covered by automated tests. |
| Leave and return without losing builds or progress | Working | E |
| v0.1 save migration (the original is kept as a backup) | Working | E, unit tests |
| Error recovery: corrupt index, blocked or full storage, worlds from a newer version | Partial | Save layer unit-tested; the in-game banners aren't covered by automated tests. |

## World generation and biomes

| Feature | State | Evidence and notes |
|---|---|---|
| Seeded endless terrain, generator version 1 | Working | Byte-identical to v0.1: 28 golden chunk hashes over 4 seeds |
| Generation stable across chunk borders | Working | I, unit tests |
| Caves and ores | Working | Simple noise tunnels and caverns; single-block ores, no veins |
| Broad land types | Partial | Plains, forest density, desert, beach, sea floor and snowy peaks from one height function. No real biome data. |
| Save-version handling for generator changes | Working | Each world stores `gen`; unknown versions are refused instead of regenerated. |
| Hierarchical 200+ biome system | Missing | Design in [BIOMES.md](BIOMES.md); geography foundation is Stage 4. |
| Biome inspection and measurement tools | Missing | Stage 4 |

## Project and tooling

| Feature | State | Evidence and notes |
|---|---|---|
| Runs from file:// with no build step | Working | `index.html` plus classic scripts and vendored three.js r128 |
| Single-file export | Working | `npm run build` writes `dist/blockcraft.html` (offline) and `dist/artifact.html` |
| v0.1 kept playable | Working | `releases/0.1/index.html` |
| Automated tests | Working | `npm test` (104 unit tests), `npm run e2e` (9 browser scenarios) |

## Known differences from the reference (Java 26.3)

- Sprint is double-tap W or hold R, not Ctrl.
- Apples drop at 1 in 20 from leaves, not 1 in 200, until animals exist.
- Survival reach is 4.5 blocks and Creative 5, as in the reference, but targeting ignores entities.
- The world is 80 blocks tall with sea level at 24; the reference is −64 to 320 with sea level 63.
- Dropped items have a 2,000-stack safety cap.
- There is no XP, so ores drop no experience.
- The mining-crack overlay, hunger icons and all other art are original, not the reference's.

## Next stage

Stage 2: furnace, light and storage. See [ROADMAP.md](ROADMAP.md).
