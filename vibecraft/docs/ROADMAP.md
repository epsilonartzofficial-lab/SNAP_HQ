# Vibecraft roadmap

Vibecraft is a browser survival sandbox inspired by Minecraft Java Edition. The gameplay reference is the
latest stable Java release, **26.3 "Wilderness Bound" (15 September 2026)**. Snapshots and release candidates
are not used as a baseline. All code, textures, names and interface art are original.

This is a long-term plan. Each stage ships as a playable, tested build and updates
[FEATURES.md](FEATURES.md), the checklist of what is working, partial or missing. A stage is done only when
its player scenario works end to end in a real browser, including saving and reloading.

**Reference note.** The official 26.3 article on minecraft.net and the Minecraft Wiki are blocked by this
project's cloud network proxy, so reference facts come from search results and secondary sources
(see [research/REFERENCE-NOTES.md](research/REFERENCE-NOTES.md)). Core survival numbers (mining times, hunger,
damage) have been stable for many releases. Items that could not be checked against a primary source are
marked "unverified".

## How every stage is run

1. Write the player scenario and acceptance checks before building.
2. Implement the whole path: rules, UI, saving and error handling.
3. Test with Node unit tests (`npm test`), browser end-to-end tests (`npm run e2e`, headless Chromium),
   and by playing. Cover keyboard and mouse, the no-pointer-lock fallback, touch emulation, save and reload,
   chunk borders and likely regressions. Say plainly what was not tested on physical hardware.
4. Fix what testing finds, then publish a playable preview and the exportable build (`npm run build`).
5. Update the checklist, and keep a recoverable checkpoint (git history plus `releases/`).
6. Worlds keep working across versions. The save format and the world-generator version are versioned
   separately, and terrain changes ship as a new generator version so existing worlds keep their land.

## Update plan (small releases, from v0.3.1)

The stages below are long. From v0.3.1 the work ships as small updates of a few hours each. After every
update: run the tests, push, publish a build, write a short report, and stop for the owner to playtest.

| Update | Contents | Done when |
|---|---|---|
| 0.3.1 Fix and verify | All browser scenarios green, new creature scenario L, checklist and README current | Every automated test passes |
| 0.3.2 Sound | Original generated sound effects for steps, mining, placing, hits, eating, animals, monsters, water; volume setting | Every common action has a sound; volume is saved |
| 0.3.3 Building blocks (done) | Logs placed along any axis; slabs and stairs for each wood and stone, placed on top, bottom, vertical, upside down and turned every way | Every orientation places from the face you click and survives save and reload |
| 0.3.4 Biome variety | Birch, spruce, jungle and acacia tree shapes; tall grass, ferns, dead bushes, berry bushes, biome flowers | 500 blocks of walking crosses visibly different places |
| 0.3.5 Farming and breeding | Hoe, seeds, wheat growth stages, bread; animals follow wheat, breed, babies grow up | A farm and a herd in one session |
| 0.3.6 Bow, shears, wool | Bow and arrows, shearing, dyes from flowers, coloured wool | Craft a bow, shoot a monster, build with coloured wool |
| 0.3.7 Item art | Redrawn tool, food and armor icons and held items | Every item is recognisable at hotbar size |
| 0.3.8 Character creation | Skin, hair, shirt and trousers chosen per world; first-person arm matches | Choices are saved with the world |
| 0.3.9 Desktop app | Electron package; Ctrl to sprint; Ctrl+W can't close the game | An installable app runs existing worlds |

### 0.3.3 report

- Block states: a sparse per-chunk map of orientation bytes next to the block ids; saved in edits as
  `id + state * 256`, so older saves load unchanged. `world.getState()`, `world.setBlock(x, y, z, id, state)`.
- `js/blocks-building.js`: log axis, 16 materials × (slab, stairs) at ids 160–191, boxes for every state,
  placement rules; `js/recipes-building.js`: 3 in a row → 6 slabs, staircase → 4 stairs.
- Rendering: rotated log bark and end rings, box meshing for slabs and stairs, shaped held and dropped items, icons.
- Physics: box collision and 0.6 step-up for the player and creatures; the crosshair hits only a block's real shape.
- Fixed during testing: the save loader refused worlds containing oriented blocks.
- Results: unit 120/120, lighting 16/16, browser 13/14 then 14/14 after two test-timing fixes (N: hold the button
  until the slab appears; world C: natural random ticks paused while the test grows the sapling), world 5/5.
- Cobblestone redrawn (rounded, lit stones in lighter mortar) and stone smoothed, after the owner found blocks hard
  to tell apart.
- Scenario B: its intermittent failure was the bare-hand stone dig (7.5 s of game time) running past a 20 s
  real-time limit on the slow software renderer; the limit is now 45 s.

### 0.3.2 report

- New `js/audio.js`: every sound is synthesized with the Web Audio API (filtered noise and oscillators), so there
  are no audio files and nothing copied. Materials: grass, dirt, gravel, sand, snow, plants, wool, wood, stone, glass.
  Creature voices for all seven creatures. Sounds are placed left/right and fade with distance (16–20 blocks).
- Hooks: footsteps every ~1.7 blocks (quieter when sneaking), landing, splash, swimming, digging every 0.25 s,
  break, place, swing, hit (with a sharper crit), player hurt, eating and burp, item pickup, opening tables and
  containers, tools breaking, menu clicks; creatures speak now and then, when hurt, when dying, and archers when shooting.
- Settings: Sound volume (default 70 %), saved.
- New browser scenario M.
- Results: unit 115/115, lighting 16/16, browser 12/13, world 5/5. Scenario B is intermittent (see HANDOFF.md).

### 0.3.1 report

- Fixed: beds could not be placed by right-click (only block items reached the placing code).
- Scenario I now allows edits the world makes itself (grass spreading), which it previously counted as a mismatch.
- Scenarios B, C and G failed in the previous full run only because other jobs were loading the machine; they
  pass on their own and in the clean full run.
- Results: 115/115 unit, 16/16 lighting, 12/12 browser scenarios (A–L), 5/5 world scenarios. In L the test
  now waits two frames between aiming and clicking; clicking in the same frame as the aim change missed once.
- New scenario L covers animals, melee, armor and beds. New unit tests cover armor absorption, difficulty
  scaling, armor slots and the armor and bed recipes.

## Stage 0: Creative sandbox (v0.1, done)

Single-file creative voxel sandbox. Preserved and still playable at `releases/0.1/index.html`.

## Stage 1: First-day Survival core (v0.2, this release)

**Player scenario.** From the main menu, create a Survival world with a chosen seed. Spawn with an empty
inventory, 10 hearts and 10 hunger. Punch a tree for about three seconds per log. Logs drop as items and are
picked up. Open the inventory, craft planks, sticks and a crafting table in the 2×2 grid. Place the table,
open its 3×3 grid and craft a wooden pickaxe. Mine stone for cobblestone (bare hands get nothing) and craft
stone tools. Tools wear out and break. Eat apples from leaves when hungry. Take fall damage, drown if you stay
underwater, die, see the death screen, respawn and walk back to recover the dropped items. Save and quit,
come back later and find inventory, health, hunger, position, dropped items and builds as you left them.
Creative worlds keep flight, instant breaking and the full item palette. Survival cannot use them.

**Acceptance checks**
- Survival and Creative differ correctly: no flying, instant breaking, palette or infinite blocks in Survival.
- Mining times follow the reference formula: log by hand 3.0 s, stone by hand 7.5 s with no drop, stone with a
  wooden pickaxe 1.15 s, dirt 0.75 s. Mining is 5× slower in the air or with eyes underwater.
- Tool tiers gate drops: iron ore needs stone or better, gold and diamond ore need iron or better.
- Tools lose durability (wood 59, stone 131, iron 250, gold 32, diamond 1561) and break.
- Health, hunger, saturation and exhaustion follow the reference rules, including natural regeneration,
  starvation limits per difficulty and Peaceful regeneration.
- Fall damage is `floor(distance − 3)` (the current Java rule; falls under 4 blocks are harmless). Drowning starts after 15 s of air and deals 2 damage per second.
- Cactus, starvation and the void deal damage. Creative takes void damage only.
- Death drops the whole inventory at the death spot. Respawn puts you at the world spawn.
- Inventory: 36 slots, stack limit 64 (tools 1), click, right-click split, shift-click, number-key swap,
  drop with Q, drop outside the window. Items in the crafting grid or on the cursor are never lost when the
  window closes, the player dies, or the page is saved and reloaded.
- A recipe list shows what can be crafted with the current grid and fills the grid on click.
- World list with create (name, mode, difficulty, seed, cheats), play, delete (confirmed), export and import.
  The v0.1 save is migrated into a Creative world and the original key is kept as a backup.
- Settings: mouse sensitivity, invert Y, field of view, render distance, reduced camera motion,
  hurt tilt, coordinates.
- Touch: joystick, look drag, jump, mine, use, sneak, drop, inventory, with long-press to split stacks.
- The terrain generator is byte-identical to v0.1 for the same seed (golden chunk hashes).

## Stage 1.5: Developer toolkit and main menu (owner requests)

**Player scenario.** While playtesting, press `/` (or T) to open a command console with tab completion, or F4 for
a developer panel. Change the time of day and day length, switch game mode, teleport by coordinates, find the
nearest cave or biome, give yourself any item, heal, feed, fly faster, pass through walls, see ores through stone,
show chunk borders and inspect the block and biome you look at. Later stages add their own commands, such as
spawning creatures and tuning spawn rates per biome. The title screen follows a Hytale-like layout: a live
world panorama, logo, a vertical menu on the left and content panels on the right.

**Acceptance checks:** every command validates its input and reports errors in the console; commands work only
in worlds with cheats on, or everywhere with Developer mode enabled in Settings; console history persists between
sessions; the dev panel and console are keyboard and touch usable.

**Later owner requests (not scheduled yet):** character creation, a new game name, and a desktop build (for
example Electron or Tauri) where Ctrl-to-sprint can work because the browser no longer owns Ctrl+W.

## Stage 2: Furnace, light and storage

**Player scenario.** On the first evening, mine coal, craft torches and light a shelter. Build a furnace, smelt
raw iron into ingots and cobblestone into stone, and burn logs into charcoal. Store items in a chest. Craft
iron tools and later mine diamonds. Plant saplings and watch trees grow.

**Planned scope:** block and sky light with propagation and smooth-lit meshes, darkness underground and at night,
torches, furnace block and UI (fuel, smelting time, output slots, persistence), glass, stone, charcoal, iron and
diamond tiers reachable in Survival, chests (single, and double if feasible), saplings with growth, sand and gravel
falling, hoe and shears.

**Acceptance checks (draft):** light values match the reference (torch 14, −1 per block). Furnace smelts one item
per 10 s, coal smelts 8 items, and keeps working in loaded chunks. Chest contents survive save, reload and
breaking the chest (contents drop). A new world can go from nothing to an iron pickaxe without Creative.

## Stage 3: Creatures, combat and night

**Player scenario.** Animals roam grassland. Hunt them for meat and wool, cook the meat in the furnace. At night,
hostile creatures spawn in darkness and hunt you. Fight with swords and axes (attack cooldown, knockback,
critical hits) and wear armor. Sleep in a bed to skip the night and set your respawn point.

**Planned scope:** entity framework (AI, pathing on the voxel grid, physics, persistence, performance caps),
passive, neutral and hostile mobs with original designs and names, spawning rules tied to light, difficulty and
mob caps, daylight burning, drops, combat model, armor slots and damage reduction, beds, sleeping and spawn
points, audio groundwork for hit and hurt feedback.

## Stage 4: World generation v2, the geography foundation

Groundwork for the 200+ biome system (see [BIOMES.md](BIOMES.md)).

**Player scenario.** A new world has continents, oceans, coasts, rivers that run to the sea, mountain ranges and
climate bands that change gradually. A map and inspector show the underlying climate fields and biome
assignment, and statistics show how often each outcome occurs.

**Planned scope:** continuous deterministic fields (continentalness, erosion, peaks and valleys, temperature,
humidity, precipitation, river distance), terrain from splines, a first set of about 20 base biomes in coherent
families, generator version 2 alongside version 1, an in-game biome inspector (F3 plus a map screen), and a
Node census tool that measures biome distribution, patch sizes, transition quality and distinctness. Candidate
ocean, continent and biome-size proportions will be measured and shown to you before any are chosen.

## Stage 5: Fluids and farming

Flowing water and lava (source and flow rules, performance-bounded updates), buckets, farmland and hydration,
wheat and other crops on random ticks, bone meal, bread, sugar cane, and later animal breeding.

## Stage 6: Biome expansion toward 200+ outcomes

Variants and sub-biomes built from the stage 4 layers: vegetation sets (grass, flowers, bushes, new tree species),
geology (rock strata and ore distribution by region), hydrology (lakes, swamps, springs), weather (rain, snow,
thunderstorms), biome-specific creatures and resources, and survival conditions such as cold or heat. Growth is
measured with the census tool, and only outcomes that differ in ways a player can see or use count toward 200.

## Stage 7: Structures, loot and villages

Structure placement framework (seeded, stable across chunk borders), villages with original inhabitants and
trading, ruins, an abandoned camp inspired by 26.3, dungeons with spawners, chests with loot tables, and maps.

## Stage 8: Audio, controls and accessibility

Procedural sound effects (Web Audio), ambient sound and music, key rebinding, GUI scale, subtitles for sounds,
colour-blind friendly indicators, and gamepad support.

## Stage 9: Long-term progression

Experience and levels, enchanting, anvils, potions and brewing, an original second dimension reached through a
portal, and an original boss encounter.

## Performance track (runs alongside all stages)

Chunk generation and meshing in Web Workers, greedy or merged meshing, a larger world height, entity caps, and
profiling on low-end and mobile hardware.

## Id ranges

Block and item ids are stored in saves and never change. Each workstream adds content in its own files and
range so parallel work cannot collide.

| Range | Blocks | Items |
|---|---|---|
| Stage 1 | 1–20 | 256–263, tools 300–349 (hoe and shears slots reserved) |
| World systems: torch, sapling, falling blocks, plants (`blocks-world.js`) | 21–29 | 280–299 |
| Stage 2 utility: furnace, chest, bed (`blocks-stage2.js`, `items-stage2.js`) | 30–39 | 264–279 |
| Biomes for generator v2 (`blocks-biomes.js`) | 40–119 | 400–449 |
| Creatures and combat | 120–159 | 350–399 |
| Future | 160–255 | 450+ |
