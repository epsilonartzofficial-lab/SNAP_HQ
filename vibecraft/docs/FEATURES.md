# Vibecraft feature checklist

Three states only:

- **Working**: implemented and tested. The evidence column says how: unit tests (`npm test`), browser
  scenarios (`npm run e2e`, letters A–L; `node tests/e2e-world.mjs`, marked W-A to W-E), or a manual check.
- **Partial**: exists but is incomplete, differs from the reference, or lacks tests for a part that matters.
- **Missing**: not implemented. A texture, menu entry, data row or code stub alone never counts as Working.

Reference: Minecraft Java Edition 26.3 (stable, 15 September 2026). Reference numbers and sources are in
[research/REFERENCE-NOTES.md](research/REFERENCE-NOTES.md).

**Last updated: v0.3.3.** Results: 115/115 unit tests, 16/16 lighting tests; browser results are in the
v0.3.1 report in [ROADMAP.md](ROADMAP.md). Nothing was tested on a physical phone or tablet, or on a GPU.
The browser tests use software rendering at well under 30 fps.

## Browser scenarios

| | Scenario |
|---|---|
| A | Main menu, create a Survival world with a seed (Biomes is the default world type), HUD shows 10 hearts and 10 hunger |
| B | First day: punch logs, craft planks, sticks, table, wooden pickaxe, stone, stone pickaxe |
| C | Fall damage, drowning, hunger drain, eating, no flying in Survival, no fall damage in Creative |
| D | Death with the inventory open: everything drops, respawn, walk back and recover it all |
| E | Save and reload keep blocks, inventory, cursor, stats, position and dropped items; v0.1 save migrates |
| F | Creative: instant break, no drops, infinite placing, item palette, bin, flying |
| G | No pointer lock: drag to look, hold still to mine, quick click breaks, menu button, mode switch |
| H | Touch (emulated Pixel 7): menus, controls, look, inventory, long-press split, joystick, Mine |
| I | Crossing chunk borders: streaming, meshing, generator determinism, edits survive unload |
| J | Furnace smelting, chest storage across reload, broken containers spill their contents |
| K | Developer console and panel: commands, completion, cheats gating |
| N | Logs along every axis; slabs bottom, vertical and top; stairs upright and upside down; walking up a slab; aiming through a slab's empty half; orientation survives save and reload |
| M | Audio unlocks on the first click; walking, placing, digging, breaking and hitting make sounds; all sounds synthesize without errors and are audible; volume slider saves |
| L | Animals spawn in a Biomes world; two sword hits kill a pig for raw pork; shift-click equips a chestplate and the armor bar shows; a bed skips the night and is the respawn point |
| W-A–W-E | Torch light across chunk borders, torches dropping, sapling growth and grass, falling sand, day/night shading |

## 1. Game modes and player interaction

| Feature | State | Evidence and notes |
|---|---|---|
| Survival and Creative with correct differences | Working | C, F |
| Switch mode from the pause menu (worlds with cheats on) | Working | G |
| First-person arm, held item, swing, equip and eating animation | Working | Manual screenshots. The arm is textured and posed low right like the reference. |
| Mine (hold, timed by block and tool) | Working | B, unit tests |
| Place blocks | Working | B, F |
| Block orientation: logs along x, y or z; slabs and stairs for 16 materials, placed bottom, top, vertical (against walls) and upside down, stairs turned 24 ways | Working | N, unit tests. Sneak on a wall for a horizontal slab. Two slabs don't merge into a double slab yet. |
| Step up onto slabs and stairs without jumping (0.6 blocks), for players and creatures | Working | N (player); creatures by code review only |
| Use: crafting table, furnace, chest, bed, eat | Working | B, C, J, L |
| Attack creatures (critical hits, knockback, sword wear) | Working | L, unit tests for the damage rules. The reference attack cooldown is switched off for now (owner request); every hit is full strength. |
| Pick block (middle click) | Partial | Not covered by automated tests. |
| Sneak | Partial | Not covered by automated tests. |
| Sprint | Partial | Double-tap W. The reference uses Ctrl, which browsers reserve (Ctrl+W closes the tab); planned for the desktop app. |
| Swim, fly (Creative) | Working | C, F |
| Climb (ladders, vines) | Missing | |
| Desktop mouse with pointer lock, no-pointer-lock fallback | Working | A–G |
| Touch controls | Partial | H (emulated only). |
| Settings: sensitivity, invert Y, FOV, sound volume, render distance (4–64), reduce motion, hurt tilt, coordinates, developer mode | Partial | Saved; only partly covered by tests. |
| Sound effects: footsteps and digging by material, breaking, placing, hits, eating, splashes, item pickup, interface clicks, creature voices (ambient, hurt, death), arrows; positioned left/right and by distance | Working | M (each sound plays, the output reaches a real level, volume saved). Synthesized at run time, all original. Not judged by ear on real speakers. |
| Music | Missing | |
| Key rebinding, GUI scale | Missing | |

## 2. Survival

| Feature | State | Evidence and notes |
|---|---|---|
| Health, hunger, saturation, exhaustion, regeneration | Working | Unit tests, C |
| Fall damage, drowning | Working | C |
| Damage from creatures, scaled by difficulty | Working | Unit tests of the scaling; in-game hits checked manually |
| Armor: 4 slots, leather/iron/gold/diamond, reference absorption formula, wear | Working | Unit tests, L |
| Death screen, drops (armor included), respawn | Working | D |
| Beds: place, sleep at night (not with monsters near), respawn beside the bed | Working | L |
| Pause flow | Working | G, E |

## 3. Items, inventory and crafting

| Feature | State | Evidence and notes |
|---|---|---|
| Inventory, hotbar, stacks, splitting, shift-click | Working | Unit tests, B, H |
| Creative palette with search | Partial | Palette covered by F; the search box is not covered by automated tests. |
| Wood, stone, iron, gold and diamond tools; swords and axes | Working | B, unit tests |
| Furnace, fuel, smelting, cooking meat, charcoal, glass | Working | J, unit tests |
| Chests | Working | J |
| Food: apples (1 in 200 from leaves, as the reference), raw and cooked pork, beef, mutton, chicken | Working | Unit tests, L |
| Animal drops: leather, feathers, wool; monster drops: bones, arrows, silk | Partial | Drop tables exist; only raw pork is checked in L. |
| Bow, shears, dyes, coloured wool | Missing | Planned for v0.3.5. |

## 4. Creatures

| Feature | State | Evidence and notes |
|---|---|---|
| Passive animals: pig, cow, sheep, chicken | Working | L. Herds appear on new chunks (25 % per chunk; the reference is 10 %) and every 20 s up to a cap. |
| Hostile creatures (original designs): Mirewalker (melee, burns in daylight), Hollow Archer (shoots arrows), Cragskitter (climbs walls) | Partial | They spawn in the dark and attack; checked manually, no automated scenario. |
| Pathfinding, panic when hit, despawning | Partial | Implemented; not covered by automated tests. |
| Breeding, baby animals | Missing | Planned for v0.3.4. |
| Developer commands: /summon, /killall, /spawning, /mobs, spawn sliders | Partial | Manual checks. |

## 5. World systems

| Feature | State | Evidence and notes |
|---|---|---|
| Day and night cycle | Working | W-E |
| Sky and block light, torches, smooth lighting | Working | W-A, W-B, lighting tests |
| Saplings and tree growth, grass spread | Working | W-C |
| Falling sand and gravel | Working | W-D |
| Flowing water and lava | Missing | |
| Farming | Missing | Planned for v0.3.4. |
| Weather, structures, dimensions | Missing | |

## 6. World generation

| Feature | State | Evidence and notes |
|---|---|---|
| Classic generator (version 1), byte-identical to v0.1 | Working | Golden hashes, I |
| Biomes generator (version 2, default): continents, rivers, 39 biomes in 14 families | Working | Unit tests, census tool (`tools/census.mjs`) |
| Biome-specific trees and ground plants | Partial | Planned for v0.3.3. |
| Distant terrain beyond 16 chunks, up to 64 | Partial | Manual screenshots. Builds about one 64-block tile per frame (~11 ms each in Node), so it fills in over several seconds. Player edits are not shown out there. |
| Spawn point on open ground (not on tree tops) | Working | L, manual check |
| 200+ biome hierarchy | Missing | Design in [BIOMES.md](BIOMES.md). |

## 7. Interface and project

| Feature | State | Evidence and notes |
|---|---|---|
| Main menu (Hytale-like layout), world list, create, delete, export, import | Working | A, E |
| Save format v2 with migration from v0.1 | Working | E, unit tests |
| Runs from file:// with no build step | Working | |
| Single-file builds | Working | `npm run build` writes `dist/vibecraft.html` and `dist/artifact.html` |

## Known differences from the reference (Java 26.3)

- Sprint is double-tap W, not Ctrl.
- The world is 80 blocks tall with sea level at 24; the reference is −64 to 320 with sea level 63.
- Animal herds are 2.5× more common on new chunks, because fewer chunks are in view.
- There is no XP.
- All creature designs, textures and names are original.
