# Blockcraft reference notes

Compiled 2026-09-28 for Stages 2 to 6. Factual research only, no game code. Gameplay reference: Minecraft Java Edition
**26.3 "Wilderness Bound"**, released 2026-09-15.

## 0. How to read this file

Confidence tags on facts:

- **[P] primary**: read directly from the shipped 26.3 game data (data pack JSON) or the decompiled 26.3 source.
- **[S] secondary**: from search-result snippets or third-party pages (usually not opened in full).
- **[D] derived**: computed by me from [P] data or from public code; approximate, method stated.
- **[U] uncertain or unverified**: plausible or remembered, but no source checked.

Provenance and limits:

- minecraft.wiki, minecraft.net, the Fandom wikis, Wikipedia, Hytale and Terraria wiki sites, Red Blob Games, Sportskeeda and most
  blogs are blocked by the egress proxy (WebFetch returns EGRESS_BLOCKED). WebSearch works, so those sites appear here only as [S].
- GitHub is reachable. [P] facts come from two third-party mirrors of Mojang's own release output: the vanilla data pack and
  registries (`misode/mcmeta`, tags `26.3-data-json`, `26.x-registries`) and the decompiled Mojang-mapped source
  (`mc-dataminning/build-changes`, tag `26.3`). This is not minecraft.net, but the mirror's `version.json` matches the release:
  id `26.3`, release_time `2026-09-15T11:23:02+00:00`, data_version 5023, protocol 777, data_pack_version 121, resource_pack_version 97.
- A mirror could in theory differ from what Mojang ships. I found no sign of that: dates, version ids and registry diffs agree
  with the [S] descriptions of every drop.
- I did not verify hardcoded behaviour that is not in the pack or the decompiled files I opened (for example mob AI details).
  Those spots are tagged [U].

## 1. Minecraft Java Edition 26.3 and the current version scheme

### 1.1 Version numbering

- Since 26.1 the Java release format is `YY.D.H`: two-digit year, drop number within that year, hotfix counter [S: minecraft.net
  article "new version numbering system", wiki "Version formats"]. Confirmed by tags in the mirror: `26.1`, `26.1.1`, `26.1.2`,
  `26.2`, `26.3` [P]. 1.21.11 (2025-12-09) was the last `1.x` release [P].
- Cadence: three to four game drops a year, roughly quarterly, each with hotfixes [S]. 2026 so far: 26.1 (Mar 24), 26.2 (Jun 16),
  26.3 (Sep 15) [P dates]. A `26.4-snapshot-1` exists in the mirror, so 26.3 is the latest stable but not the newest line [P: tag list].
- 26.1 is the first fully unobfuscated release and requires Java 25 [S]. It also did a one-time, irreversible world-storage
  reorganisation into subfolders [S, single source class; U on exact layout].
- Bedrock uses a different scheme for the same drops (26.10 for Tiny Takeover, 26.50 for Wilderness Bound) [S].
- Data pack format numbers moved fast: 1.21.4 = 61, 1.21.11 = 94, 26.1 = 101, 26.2 = 107, 26.3 = 121 [P]. The jump 107 to 121 reflects a
  large amount of hardcoded behaviour moving into data (section 1.5).

### 1.2 What 26.3 added (registry diff 26.2 to 26.3) [P]

Totals after the drop: 1286 blocks, 1658 items, 161 entity types, 67 biomes (56 of them Overworld). New in 26.3:

- **90 blocks**: 16 wool stairs + 16 wool slabs, 16 concrete stairs + 16 concrete slabs (all 16 dye colours); 23 poplar blocks;
  `red_shrub`, `shelf_mushroom`, `straw_bed`.
- **Poplar wood set** (log, stripped log, wood, stripped wood, planks, stairs, slab, fence, gate, door, trapdoor, button, pressure plate,
  sign, hanging sign, shelf, sapling, potted sapling) plus `poplar_boat` and `poplar_chest_boat`. Three leaf blocks:
  `red_poplar_leaves`, `orange_poplar_leaves`, `yellow_poplar_leaves`.
- **121 items**: the above, 16 `*_cushion` items, and 16 structure explorer maps: `abandoned_camp`, `buried_ancient_city`,
  `buried_mineshaft`, `buried_treasure`, `buried_trial_chambers`, `desert_pyramid`, `jungle_pyramid`, `ocean_monument`, `swamp_hut`,
  `warm_ocean_ruins`, `woodland_mansion`, and five village maps (desert, plains, savanna, snowy, taiga).
- **3 entity types**: `cushion` (the sitting entity), `poplar_boat`, `poplar_chest_boat`. 23 new sound events (poplar leaves incl.
  ambient and fall, red shrub, shelf mushroom incl. bounce, straw bed, cushion sit and get-up).
- **1 biome**: `dappled_forest`. **1 structure family**: the abandoned camp (18 biome-specific variants).
- No new game rules or attributes. Fixes listed by [S] include a sulfur spike and pointed dripstone growth speed that had been set
  25 times too fast, hopper and dropper bugs. A GamingOnLinux snippet mentions SDL3 [S, single source, U].

Recipes [P]: straw bed = 3 hay blocks in a row gives 4 straw beds. Cushion = 3 matching wool slabs in a row (one per colour).
`rabbit_stew_from_shelf_mushroom` exists. Wool and concrete stairs: 6 blocks in the usual staircase give 4; slabs: 3 blocks in a row give 6.

### 1.3 Straw bed and cushion rules [P]

- Overworld dimension attribute `gameplay/straw_bed_rule` (new in 26.3): `can_sleep: when_dark`, `can_set_spawn: never`,
  `destroy_on_leave: true`. Normal beds: `gameplay/bed_rule` = `can_sleep: when_dark`, `can_set_spawn: always`. In the Nether both rules are
  `can_sleep: never`, `can_set_spawn: never`, `destroy_on_use: true` (the bed explodes). The bed rule as data dates from 1.21.11, when
  environment attributes were introduced (the `environment_attribute` registry has 45 entries in 1.21.11 and none in 1.21.10).
- So a straw bed lets you skip the night once and does not move the respawn point; it is removed when you get up. Cushions are an
  entity you sit on. Neither is a survival-critical mechanic.

### 1.4 Dappled forest and abandoned camp [P]

- Biome JSON: temperature 0.6, downfall 0.6, precipitation on, grass `#df6827`, foliage `#e68e30`, dry foliage `#8c3a04`, water
  `#375154`, sky `#7ca3ff`, fog `#ccd8e2`, music `overworld.forest`. Mob spawns: sheep 12, pig 10, chicken 10, cow 8, rabbit 4, fox 4
  (weights); standard monsters (spider, zombie, skeleton, creeper, slime, enderman, witch); bats; glow squid underground.
- Placement in the Overworld climate table: temperature index 1, humidity index 0, only when weirdness is 0 or above (the "variant"
  half). It takes the place of `plains` in that cell. That is the cool, dry column next to snowy plains and taiga (section 3.5).
  My simulation puts it at about 0.4 to 0.7 percent of world area, so it is a rare biome [D].
- Vegetation: `trees_dappled_forest` is a weighted selector: orange poplar leaf litter 240, red 200, yellow 90, fallen poplar tree 120,
  spruce 27. Placed 6 per chunk. Poplar trees use dedicated trunk and foliage placers and a 40 % chance of a shelf mushroom decorator.
  Also `patch_red_shrub` (count 8), `brown_mushroom_dappled_forest` (count 96 with 1 in 2 chance), glow lichen, forest grass.
  Surface rule: grass on dirt, with rare coarse dirt patches where the `small_patch` noise exceeds 1.2.
- Abandoned camp: one `random_spread` structure set (spacing 37 chunks, separation 8, salt 91231127) choosing among 18 structures by
  weight 1 each, one per biome group: bamboo jungle, birch, cherry grove, dappled forest, flower forest, forest, meadow, old growth
  birch, old growth pine, old growth spruce, pale garden, savanna, snowy taiga, sparse jungle, swamp, taiga, windswept forest, wooded
  badlands. Jigsaw, size 2, max distance 80, step `surface_structures`, terrain adaptation `beard_thin`. Loot tables
  `abandoned_camp_common_chest`, `abandoned_camp_secret_chest`, `abandoned_camp_barrel`. Contents [S]: empty tent, campfire, wool
  stairs, straw beds, cushions, sometimes cobwebs, a tree or a small crop plot.

### 1.5 Technical changes visible in the 26.3 data [P]

- Furnace fuel times, brewing and composting are now data: new `context_int_provider` and `context_float_provider` registries. For
  example fuel time = a base tick count divided by a factor that is 2 in a blast furnace or smoker (the `block/fast_cooking`
  predicate matches `smoker` and `blast_furnace`). Recipes now list `cookingtime` 200 for smelting, blasting and smoking, with a x2
  speed multiplier for the fast blocks, versus a 100-tick blasting recipe in 26.1. Net gameplay is the same (section 2.2) [D].
- New data folders: `block_transformer` (axe, hoe, shovel conversions), `recipe/brewing`, `loot_table/till`, many new block and item tags
  that replace hardcoded lists (for example `blocks_motion`, `washed_away_by_fluids`, `turns_into_farmland`, `villagers_can_sleep_on_bed`).
- Worldgen data was restructured: `configured_feature` became `feature` (that registry grew from 63 to 240 entries), `configured_carver`
  became `carver`, new folders `block_state_provider`, `material_condition` and `material_rule` (surface rules moved out of the noise
  settings, which now carry `material_rule`, `aquifers` and `debug_functions` instead of `surface_rule`). Data packs written for 26.2 will not
  load unchanged [P folder diff; D on the consequence]. Overworld biome files still load the same climate table (the preset lives in code).
- Mob spawn tables moved from a biome's own field into the environment attribute `gameplay/natural_mob_spawns` (with an `overlay`
  modifier); `gameplay/creature_world_gen_spawn_probability` is new too [P]. Environment attributes layer dimension, biome and timeline values.
- The 26.3 decompiled source samples density functions in batched volumes (`DensityVolume`, `sampleVolume`) and its surface-rule class is
  `MaterialSystem`. The mirror has no 26.2 source to compare with, so I cannot say whether the volume sampling is new in 26.3 [U].

### 1.6 Drops of 2025 to 2026 and their effect on core survival

Dates and version ids are [P]. "New content" is from registry diffs [P]; names and feature summaries are [S] where marked.

| Version | Name | Date | New content | Changed core survival? |
|---|---|---|---|---|
| 1.21.5 | Spring to Life | 2025-03-25 | bush, cactus flower, firefly bush, leaf litter, dry grass, wildflowers, blue and brown eggs, fallen trees feature [P]; warm and cold farm animal variants [U, from memory; variant registries exist in 26.3 data] | Low. Ambience and variants only. |
| 1.21.6 | Chase the Skies | 2025-06-17 | happy ghast, dried ghast, 16 harnesses, waypoint and camera attributes; locator bar, craftable saddles, leash changes [S] | Low. Locator bar is new UI, mounts are new. |
| 1.21.7, 1.21.8 | hotfixes | 2025-06-30, 07-17 | none of note | No. |
| 1.21.9, 1.21.10 | The Copper Age | 2025-09-30, 10-07 | copper golem, copper tools and armor, copper chest, copper torch and lantern, shelves, `iron_chain`, copper nugget | **Yes, medium.** New tool tier between stone and iron; tools and armor smelt to nuggets. |
| 1.21.11 | Mounts of Mayhem | 2025-12-09 | 7 spears, nautilus, zombie nautilus, camel husk, parched, netherite horse armor, Lunge enchantment | **Yes, medium.** New weapon class with speed-based charge attacks [S]. Game rules renamed to `snake_case` (`advance_time`, `spawn_mobs`) [S]. Environment attributes and timelines arrive: sky light level, `monsters_burn` and bed rules become data [P]. |
| 26.1 | Tiny Takeover | 2026-03-24 | golden dandelion, craftable name tag, baby mob models, stonecutter conversions [S]; hotfixes 26.1.1 (04-01), 26.1.2 (04-09) | Low for gameplay. Big technical release (Java 25, storage, data-driven trades, world clocks, worldgen feature refactor). |
| 26.2 | Chaos Cubed | 2026-06-16 | `sulfur_caves` biome, sulfur cube mob, sulfur and cinnabar block families, 5 attributes (bounciness, friction, air drag, name tag distances), new speleothem features replacing dripstone features | Low. A new cave biome and mob. [S] friends list, F3+F4 sets default game mode, touchscreen mode removed. |
| 26.3 | Wilderness Bound | 2026-09-15 | see 1.2 to 1.5 | Low: straw bed (sleep once, no spawn), sitting. Large technical change: fuel, brewing, worldgen data and mob spawn tables moved into data. |

Conclusion: the numbers in section 2 (hunger, light, spawning, damage formulas, mob caps) live in code and data that these drops did
not touch in any way I could see in 26.3. I did not diff them against 1.20 line by line, so "unchanged since" is [U]; "correct for 26.3" is [P].
Cross-checks [P]: the Copper Age tier exists in 26.3 code (`ToolMaterial.COPPER`), and the spear family is in `Items`.

## 2. Core survival reference numbers (26.3)

Unless tagged otherwise, every number is [P] from `data/minecraft` JSON or decompiled source. 20 ticks = 1 second.

### 2.1 Time, sky light, block light, sleeping

- Day length 24000 ticks. Timeline markers: `day` 1000, `noon` 6000, `night` 13000, `midnight` 18000, `wake_up_from_sleep` 0.
- Sky light level track (`timeline/day.json`): 15 from tick 133 to 11867, linear down to 4 by tick 13670, stays 4 until 22330, back to 15
  at tick 133 of the next day. `skyDarken = 15 - skyLightLevel` (integer). `monsters_burn` is true from tick 23460 to 12542;
  `bees_stay_in_hive` and the sleep window use the same 12542 to 23460 range [D: `skyDarken >= 4` first reached near tick 12542].
- Weather blends the sky light toward 4: rain alpha 0.3125, thunder alpha 0.52734375. At noon: rain gives 11.56 (skyDarken 3, still
  "bright"), thunder gives 9.2 (skyDarken 5, "dark") [D]. So you can sleep at night or in a thunderstorm, but not in plain rain.
- Block light: maximum 15, and each step loses `max(1, block light dampening)`: 1 per air block. Emission: torch and wall torch 14,
  copper torch 14, soul torch 10, lit redstone torch 7, lit furnace/blast furnace/smoker 13, campfire 15, soul campfire 10, lantern 15,
  soul lantern 10, lava 15, glowstone 15, sea lantern 15, jack o'lantern 15, redstone lamp 15, end rod 14, glow lichen 7, magma 3.
- Torch recipe: 1 stick under 1 coal or charcoal gives 4 torches. Soul torch uses soul sand or soul soil instead.
- Bed recipe: 3 wool over 3 planks of any type (wool colour sets the bed colour). Bed use: must be within 3 blocks horizontally and 2
  vertically of the bed block; space above must be free; setting spawn happens before the night check when the rule allows it. Sleeping needs
  `can_sleep: when_dark`; no monster that "prevents rest" (see 2.4) within +-8 blocks horizontally and +-5 vertically of the bed centre
  (creative mode skips this). Players wake after the night is skipped; deep sleep needs 100 ticks; night is skipped when the share of
  sleeping players reaches game rule `players_sleeping_percentage` (default 100). The clock then jumps to the `wake_up_from_sleep` marker (tick 0).
- Monster spawn light (overworld, `dimension_type`): `monster_spawn_block_light_limit` = 0 (any block light above 0 blocks spawns)
  and `monster_spawn_light_level` = uniform integer 0 to 7. The check in code (`Monster.isDarkEnoughToSpawn`): fail if raw sky light at the
  spot is greater than `random(0..31)`; fail if block light exceeds the limit; then spawn if the sky-darkened brightness (thunder uses
  a darkening of 10) is at most a random draw from 0..7. Passive animals need grass below and raw brightness above 8.

### 2.2 Furnace, fuel and smelting

- Smelting time is 200 ticks (10 s) per item in a furnace, and for blasting and smoking recipes in the 26.3 data; blast furnace and smoker
  apply a speed multiplier of 2, so 100 ticks [P data, D for the resulting 100]. Campfire cooking recipes take 600 ticks (30 s).
- Fuel burn time in ticks (base value, furnace) and items smelted per fuel = ticks / 200. In a blast furnace or smoker the burn time is
  halved but the items per fuel item stay the same [D]. The item lists in the table come from the `cookingFuel` calls in `Items`; the counts
  in brackets are how many item registrations use that value (block items registered in loops may not all be counted, so the exact
  member lists are [U]).

| Fuel | Ticks | Seconds | Items |
|---|---|---|---|
| Lava bucket | 20000 | 1000 | 100 |
| Coal block | 16000 | 800 | 80 |
| Dried kelp block | 4001 | 200 | 20 |
| Blaze rod | 2400 | 120 | 12 |
| Coal, charcoal | 1600 | 80 | 8 |
| Boats, chest boats, rafts (22 items) | 1200 | 60 | 6 |
| Hanging signs (11) | 800 | 40 | 4 |
| Planks, logs, most wooden blocks (138 items), bow, crossbow, fishing rod, roots | 300 | 15 | 1.5 |
| Wooden tools, sword, spear | 200 | 10 | 1 |
| Wooden slabs | 150 | 7.5 | 0.75 |
| Stick, saplings and other dry plants (17), bowl, wool | 100 | 5 | 0.5 |
| Wool carpets | 67 | 3.35 | 0.33 |
| Wool slabs, bamboo | 50 | 2.5 | 0.25 |

- Outputs: raw iron or iron ore gives an iron ingot, raw gold or gold ore a gold ingot, cobblestone stone, sand or red sand glass, any
  burnable log charcoal, raw meat and fish their cooked version, potato a baked potato.
- Smelting recipes: 73 in the pack, all 200 ticks. XP per item (in brackets): raw or ore iron (0.7), copper (0.7), gold (1.0), coal ore (0.1),
  lapis ore (0.2), redstone ore (0.7), diamond ore and emerald ore (1.0), ancient debris (2.0), nether quartz ore (0.2), cobblestone to stone
  (0.1), stone to smooth stone (0.1), sand or red sand to glass (`#smelts_to_glass`, 0.1), any log to charcoal (`#logs_that_burn`, 0.15),
  clay ball to brick (0.3), clay to terracotta (0.35), wet sponge (0.15), cactus to green dye (1.0), kelp to dried kelp (0.1), cooked food
  (raw beef, porkchop, chicken, mutton, rabbit, cod, salmon: 0.35 each; potato to baked potato 0.35), leaves to leaf litter (0.1), cracked
  brick variants (0.1). Tools and armor of iron, gold and copper smelt to nuggets (0.1).

### 2.3 Crafting recipes needed next

- Planks: 1 log gives 4 planks (any of the log tags). Stick: 2 planks vertical gives 4. Crafting table: 4 planks in a 2x2.
- Furnace: 8 `#stone_crafting_materials` (cobblestone, blackstone, deepslate) in a ring. Blast furnace: 5 iron ingots, 1 furnace, 3 smooth
  stone. Smoker: furnace + 4 logs. Campfire: 3 logs, 3 sticks, 1 coal or charcoal. Chest: 8 planks in a ring.
- Pickaxe: 3 material over a 2-stick column (material = the `#wooden_tool_materials`, stone, copper, iron or diamond tag items). Axe: 3 material
  + 2 sticks. Hoe: 2 material + 2 sticks. Shovel: 1 material + 2 sticks. Sword: 2 material + 1 stick. Shears: 2 iron ingots diagonal. Bucket: 3 iron ingots.
- Armor: helmet 5, chestplate 8, leggings 7, boots 4 of the material (leather, copper ingot, iron ingot, gold ingot, diamond).
  Chainmail is not craftable. Shield: 6 planks and 1 iron ingot.
- Bread: 3 wheat in a row. Hay block: 9 wheat. Bone meal: 1 bone gives 3. Bowl: 3 planks gives 4. Mushroom stew: 2 mushrooms + bowl.
  Arrow: flint over stick over feather gives 4. Bow: 3 sticks and 3 string.

### 2.4 Mobs

| Mob | Health | Melee or ranged damage | Speed attr | XP | Drops (loot table) |
|---|---|---|---|---|---|
| Pig | 10 | none | 0.25 | 1 to 3 | 1 to 3 porkchop (cooked if the pig is burning) |
| Cow | 10 | none | 0.2 | 1 to 3 | 0 to 2 leather, 1 to 3 beef (cooked if burning) |
| Sheep | 8 | none | 0.23 | 1 to 3 | 1 to 2 mutton, 1 wool of its colour |
| Chicken | 4 | none | 0.25 | 1 to 3 | 0 to 2 feather, 1 chicken |
| Zombie | 20 | 3.0, follow range 35 | 0.23 | 5 (baby 12) | 0 to 2 rotten flesh; 2.5 % (killed by player) iron ingot, carrot or potato |
| Skeleton | 20 | arrow: `ceil(|velocity| * 2.0)`, fired at speed 1.6 | 0.25 | 5 | 0 to 2 arrows, 0 to 2 bones |
| Creeper | 20 | explosion radius 3, fuse 30 ticks | 0.25 | 5 | 0 to 2 gunpowder |
| Spider | 16 | 2.0 (default monster damage) | 0.3 | 5 | 0 to 2 string; spider eye -1..1 rolled, only if killed by a player |

Looting adds 0 to 1 per level on these counts. Monster base health is the living default 20; default follow range 16.

- Difficulty scaling applies to the damage the player takes from scaling sources: Peaceful 0, Easy `min(d/2 + 1, d)`, Normal `d`, Hard
  `d * 1.5`. Armor reduction comes after this. Zombie melee therefore is 2.5 / 3 / 4.5 before armor (spider 2 / 2 / 3). Skeleton aim spread
  is `14 - 4 * difficultyId` (Easy 10, Normal 6, Hard 2). Which damage types scale (`damage_type` data): `explosion` always; almost every other
  type (`mob_attack`, `arrow`, `cactus`, `lava`, `fall`...) only when a living non-player entity caused it, so falls, drowning and cactus
  from the environment do not scale. Exhaustion per hit is 0.1 for mob attacks, arrows, explosions, cactus, lava and fire, and 0 for fall,
  drowning, starvation, burning, magic and generic damage.
- Explosion damage to an entity: `dist = distance / (2 * radius)`, `pow = (1 - dist) * exposure`, damage `(pow^2 + pow) / 2 * 7 * (2 * radius) + 1`
  (up to 43 for a creeper at point-blank on Normal; Easy 22.5, Hard 64.5). A charged creeper doubles the radius. Exposure is the share of
  rays that reach the entity unobstructed.
- Creeper: starts its fuse when the target is closer than 3 blocks (distance squared below 9), stops and cools if the target is farther than
  7 (distance squared above 49); falling adds to the swell counter (`fall distance * 1.5`).
- Sun burning: undead with no helmet ignite for 8 s when the `monsters_burn` attribute is true (daytime), the mob can see the sky, is not in
  water, rain or powder snow, and a random test `random * 30 < (brightness - 0.4) * 2` passes (roughly 4 % per tick in full daylight). A helmet takes
  0 to 1 durability instead. Zombies and skeletons burn; creepers and spiders do not [U for the exact list, standard behaviour].
- Spawn caps per category (`MobCategory`): monster 70, creature 10, ambient 15, axolotl 5, underground water creature 5, water creature 5,
  water ambient 20. The live cap is `max * spawnableChunks / 289` (17x17 chunks around one player = 289). Exactly which mobs are counted
  against a cap was not read [U].
- Despawn: distance beyond 128 blocks (64 for water ambient) removes a non-persistent mob immediately; between 32 and 128, after 600
  ticks without action a mob has a 1 in 800 chance per tick to vanish; inside 32 blocks it never despawns (its action timer resets).
  Mobs flagged persistent never despawn (what sets the flag, such as a name tag or a picked-up item, was not read [U]).
- Spawn attempts: pack centre picked randomly in loaded chunks; must be at least 24 blocks from any player and within 128; pack members
  spread by `nextInt(6) - nextInt(6)` blocks. Monster categories run every tick; creature (passive) spawning runs only when `gameTime % 400 == 0`
  (every 20 s) in addition to chunk generation. Passive spawns need a grass block below and raw brightness above 8.
- Beds: every `Monster` "prevents rest" (`isPreventingPlayerRest` returns true) except a zombified piglin, which only does so while angry at
  that player. Any such monster inside the 8 horizontal and 5 vertical block box blocks sleeping [P].
- Rotten flesh gives Hunger 30 s at 80 % chance; raw chicken Hunger 30 s at 30 %; spider eye Poison 5 s; pufferfish poison, hunger and nausea.

### 2.5 Food values

Nutrition = hunger points (half drumsticks). Saturation = `nutrition * modifier * 2`. Eating takes 1.6 s (32 ticks) by default.

| Food | Nutrition | Saturation | Food | Nutrition | Saturation |
|---|---|---|---|---|---|
| Raw porkchop | 3 | 1.8 | Cooked porkchop | 8 | 12.8 |
| Raw beef | 3 | 1.8 | Cooked beef (steak) | 8 | 12.8 |
| Raw chicken | 2 | 1.2 | Cooked chicken | 6 | 7.2 |
| Raw mutton | 2 | 1.2 | Cooked mutton | 6 | 9.6 |
| Raw rabbit | 3 | 1.8 | Cooked rabbit | 5 | 6.0 |
| Raw cod / salmon | 2 / 2 | 0.4 / 0.4 | Cooked cod / salmon | 5 / 6 | 6.0 / 9.6 |
| Apple | 4 | 2.4 | Bread | 5 | 6.0 |
| Baked potato | 5 | 6.0 | Carrot / potato | 3 / 1 | 3.6 / 0.6 |
| Melon slice | 2 | 1.2 | Sweet berries | 2 | 0.4 |
| Rotten flesh | 4 | 0.8 | Spider eye | 2 | 3.2 |
| Golden apple | 4 | 9.6 | Golden carrot | 6 | 14.4 |

Also: mushroom stew 6 / 7.2, beetroot soup 6 / 7.2, rabbit stew 10 / 12.0, pumpkin pie 8 / 4.8, cookie 2 / 0.4, dried kelp 1 / 0.6, beetroot 1 / 1.2.

### 2.6 Hunger, exhaustion, regeneration

- Start: food 20, saturation 5, exhaustion 0. Saturation cannot exceed food level. Every 4.0 exhaustion: saturation -1, or if saturation
  is 0, food -1 (not in Peaceful). Exhaustion is capped at 40.
- Sources: jump 0.05, sprint-jump 0.2 total, sprinting 0.1 per metre, swimming 0.01 per metre, walking 0, sneaking 0, breaking a block 0.005,
  hitting an entity 0.1, taking damage 0.1 by default (per damage type), Hunger effect 0.005 per tick per level, healing 6.0 (below).
- Natural regeneration (game rule `natural_health_regeneration` on, player hurt): with food 20 and saturation above 0, every 10 ticks heal
  `min(saturation, 6) / 6` HP and add `min(saturation, 6)` exhaustion. Otherwise with food 18 or more, every 80 ticks heal 1 HP and add
  6.0 exhaustion. Below 18 there is no regeneration.
- Starvation at food 0: every 80 ticks 1 damage, but only while health is above 10 on Easy, above 1 on Normal, always on Hard.
- Sprinting requires food above 6. Peaceful: +1 HP per second, +1 saturation per second, +1 food every 10 ticks; no hunger loss.

### 2.7 Combat

- Attack speed attribute: fist 4.0. Delay = `20 / attack_speed` ticks. Strength scale `s = clamp((ticksSinceSwing + 0.5) / delay, 0, 1)`.
  Damage multiplier `0.2 + 0.8 * s^2` on the base damage; enchant bonus damage is scaled by `s`. Fist damage 1.0. "Full strength" means `s > 0.9`.
- Critical hit: x1.5 on base damage when full strength and falling (`fallDistance > 0`), and not on the ground, on a ladder or vine, in
  water, riding, blind (`isMobilityRestricted` is the Blindness effect) or sprinting, and the target is a living entity.
- Sprint knockback: sprinting with full strength adds 0.5 knockback and disqualifies crit and sweep. Base hit knockback is 0.4 for any
  damage; resistance scales it; ground targets get vertical velocity `min(0.4, y/2 + power)`, horizontal velocity halves then subtracts
  the push.
- Sweep: sword in main hand, full strength, no crit, no sprint knockback, on the ground, slow horizontal speed. Also hits other living
  entities in a box inflated by (1.0, 0.25, 1.0) around the target and within 3 blocks of you, for `(1 + sweeping_ratio * damage) * s`
  (the ratio is 0 without the enchantment), each with 0.4 knockback.
- Hurt cooldown: 20 ticks. During the first 10 ticks only damage above the last hit applies.
- Each attack costs 0.1 exhaustion. Shields, blocking and the axe's shield-disable time (axes 5 s) exist but were not opened.

### 2.8 Armor

- Damage after armor: `real = clamp(armor - damage / (2 + toughness / 4), 0.2 * armor, 20)`, then `damage * (1 - real / 25)`.
  Example: full iron (15 armor, toughness 0) against 7 damage: `real = 11.5`, damage 3.78. Difficulty scaling applies before this.
  Enchantment protection is a separate reduction of up to 20 points and was not opened.
- Armor points are (boots, leggings, chestplate, helmet); durability = multiplier * (13, 15, 16, 11); enchantability in brackets.

| Material | Boots | Legs | Chest | Helmet | Total | Toughness | Knockback res. | Durability multiplier | Durability (b, l, c, h) |
|---|---|---|---|---|---|---|---|---|---|
| Leather (15) | 1 | 2 | 3 | 1 | 7 | 0 | 0 | 5 | 65, 75, 80, 55 |
| Copper (8) | 1 | 3 | 4 | 2 | 10 | 0 | 0 | 11 | 143, 165, 176, 121 |
| Chainmail (12), loot only | 1 | 4 | 5 | 2 | 12 | 0 | 0 | 15 | 195, 225, 240, 165 |
| Iron (9) | 2 | 5 | 6 | 2 | 15 | 0 | 0 | 15 | 195, 225, 240, 165 |
| Gold (25) | 1 | 3 | 5 | 2 | 11 | 0 | 0 | 7 | 91, 105, 112, 77 |
| Diamond (10) | 3 | 6 | 8 | 3 | 20 | 2 | 0 | 33 | 429, 495, 528, 363 |
| Netherite (15) | 3 | 6 | 8 | 3 | 20 | 3 | 0.1 each | 37 | 481, 555, 592, 407 |

### 2.9 Tools

`ToolMaterial(incorrectBlocksForDrops, durability, speed, attackDamageBonus, enchantmentValue)`. Attack damage total = player base 1.0 +
type baseline + bonus. Mining tiers: tag `needs_stone_tool` (iron, lapis, copper ore and blocks), `needs_iron_tool` (diamond, emerald,
gold, redstone ore), `needs_diamond_tool` (obsidian, crying obsidian, netherite block, ancient debris, respawn anchor). Wood and gold
cannot drop anything from all three tags; stone and copper fail on the last two; iron fails on diamond-tier only.

| Material | Durability | Mining speed | Bonus | Enchant. | Sword dmg | Axe dmg | Pickaxe dmg | Shovel dmg | Hoe dmg |
|---|---|---|---|---|---|---|---|---|---|
| Wood | 59 | 2 | 0 | 15 | 4 | 7 | 2 | 2.5 | 1 |
| Stone | 131 | 4 | 1 | 5 | 5 | 9 | 3 | 3.5 | 1 |
| Copper | 190 | 5 | 1 | 13 | 5 | 9 | 3 | 3.5 | 1 |
| Iron | 250 | 6 | 2 | 14 | 6 | 9 | 4 | 4.5 | 1 |
| Gold | 32 | 12 | 0 | 22 | 4 | 7 | 2 | 2.5 | 1 |
| Diamond | 1561 | 8 | 3 | 10 | 7 | 9 | 5 | 5.5 | 1 |
| Netherite | 2031 | 9 | 4 | 15 | 8 | 10 | 6 | 6.5 | 1 |

- Baselines: sword 3.0 (speed -2.4, so 1.6/s), axe 6.0 for wood, gold and iron, 7.0 for stone and copper, 5.0 for diamond and
  netherite (axe speeds 0.8 wood/stone/copper, 0.9 iron, 1.0 gold/diamond/netherite), pickaxe 1.0 (speed 1.2/s), shovel 1.5 (1.0/s).
  Hoe damage baseline falls as material bonus rises so the total is 1 for every hoe; hoe attack speed 1 wood, 2 stone and copper, 3 iron,
  4 diamond and netherite, 1 gold. Sword mining rule: cobweb 15, plus instant-mine and 1.5 speed override tags. Swords have no tier limit.
- Shears: durability 238, tool rules: cobweb 15, three tag groups at 15, 5 and 2 mining speed. Flint and steel 64, bow 384, fishing rod 64, shield 336.
- Block break progress per tick = `toolSpeed / hardness / 30` with the correct tool for drops, `/ 100` without. The player speed adds
  enchant and effect modifiers and divides by 5 in the air or underwater (already in the Stage 1 acceptance checks).

### 2.10 Crops and farmland

- Random tick speed: game rule `random_tick_speed` default 3 (3 random blocks per chunk section per tick).
- Wheat has `age` 0 to 7 (8 stages). On a random tick, if the raw brightness with no sky darkening is at least 9 and age is below 7:
  growth happens with chance `1 / (floor(25 / speed) + 1)`.
  `speed = 1 + sum(blockSpeed)` over the 3x3 farmland below: the centre tile counts fully, the 8 neighbours count a quarter. A block that
  `grows_crops` gives 1, or 3 if its moisture is above 0. If the same crop stands on both axes next to it (or on a diagonal) speed is halved.
  Best case speed is 1 + 3 + 8 x 0.75 = 10, so 1 in 3 per random tick; dry farmland only gives 4, so 1 in 7 [D].
  A random tick reaches a given block with probability 3 / 4096 per game tick (one every ~1,365 ticks), so a best-case stage takes about
  4,100 ticks (3.4 minutes) and a full crop about 24 minutes of loaded time on average; dry farmland (1 in 7) takes about 9,600 ticks per
  stage (56 minutes per crop); a crop with neighbours on both axes has its speed halved [D].
- Bone meal adds 2 to 5 age stages (`nextInt(2, 5)`).
- Harvest: age 7 drops 1 wheat plus 1 seed plus a binomial 0 to 3 extra seeds (probability 0.5714); younger drops 1 seed. Tall or short
  grass drops wheat seeds with 12.5 % (fortune raises it); oak leaves drop a sapling with 5 %, a stick 2 %, an apple 0.5 %.
- Farmland: moisture 0 to 7. Random tick: if water is within 4 blocks horizontally and 0 to 1 blocks up (a 9x9x2 box, own layer and the
  layer above), or rain falls on the block above, moisture becomes 7. Otherwise it drops by 1 per random tick; at 0 without a crop or other
  `maintains_farmland` block above, it turns back to dirt. Tilling comes from the hoe on grass or dirt (`block_transformer/hoe`).
  Trampling: on landing, chance `fallDistance - 0.5` for living entities whose bounding volume exceeds 0.512 (the player qualifies);
  mobs only when `mob_griefing` is on.

### 2.11 Water and lava

- Water: source level 8; flowing levels drop by 1 per block, so water spreads 7 blocks horizontally from a source; it searches up to 4 blocks
  to find a downhill path; tick delay 5 ticks per step; falls indefinitely.
- Lava (Overworld): drop-off 2, so 3 blocks of spread; slope search 2; tick delay 30. In the Nether (`ultrawarm`) drop-off 1 (7 blocks),
  slope 4, delay 10. When lava level rises there is a 3 in 4 chance the delay is multiplied by 4.
- New source blocks: water becomes a source when at least 2 horizontal neighbours are sources and the block below is solid or a source
  (rule `water_source_conversion`, default true). Lava conversion is game rule `lava_source_conversion`, default false.
  Water or lava directly above a cell makes it a falling flow (level 8).

### 2.12 Experience

- Level thresholds: XP to go from level L to L+1 is `2L + 7` for L up to 14, `5L - 38` for 15 to 29, `9L - 158` from 30. Reaching level 30
  totals 1395 XP [D].
- Orb sizes: 1, 3, 7, 17, 37, 73, 149, 307, 617, 1237, 2477 (a mob's or block's XP splits greedily into these).
- Block XP (on mining with the right tool, not with silk touch): coal ore 0 to 2, lapis 2 to 5, redstone 1 to 5, diamond 3 to 7,
  emerald 3 to 7, nether quartz 2 to 5, nether gold 0 to 1; iron, gold, copper ore 0 (XP comes from smelting, section 2.2).
- Mob XP: hostile 5, baby zombie 12, passive animals 1 to 3 (uniform).

## 3. World generation since 1.18, as of 26.3

### 3.1 Architecture

- Vanilla separates **shape** from **label**. Terrain height and 3D density come from a noise router of density functions using three 2D
  fields (continentalness, erosion, "ridges"/peaks and valleys) through splines. **Biomes** are labels chosen by a six-parameter lookup
  (temperature, humidity, continentalness, erosion, depth, weirdness) and then drive surface rules, features and spawns [P].
- Two consequences: terrain is continuous even where the biome flips, and any new biome is a new box in the parameter table,
  not a new terrain algorithm.
- Biomes are looked up on a 4x4x4 block grid (quart positions) with a seeded jitter when read at block level (`BiomeManager`,
  zoom 4). Each climate noise is sampled at `x * 0.25` after a small domain shift (an `offset` noise with first octave -3, times 4;
  about 5 blocks at one standard deviation [D]) that roughens borders [P].
- World: min Y -64, height 384, sea level 63. Blockcraft is 80 tall with sea level 24, so every height number below needs rescaling.
- World spawn (`spawn_target` in the noise settings) is searched only where continentalness is at least -0.11 (land) and weirdness is
  outside (-0.16, 0.16), that is away from river valleys [P].
- Large Biomes preset: the same tables with noise first octaves 2 lower for continentalness, erosion, temperature and humidity
  (x4 wavelength); weirdness (ridges) is unchanged [P].
- Every overworld biome file also holds its attributes: sky, fog, water and grass/foliage colours, ambient sounds and music, spawn
  tables by category, precipitation, temperature and downfall, plus 11 lists of features, one per generation step (raw generation,
  lakes, local modifications, underground structures, surface structures, strongholds, underground ores, underground decoration,
  fluid springs, vegetal decoration, top layer modification) [P].

### 3.2 The six parameters and their noise

| Parameter | Noise (first octave, octaves, amplitude modifiers) | Std. dev. in my sim [D] | Typical feature size (blocks) [D] |
|---|---|---|---|
| continentalness | -9, 9, [1,1,2,2,2,1,1,1,1] | 0.36 | ~2000 |
| erosion | -9, 5, [1,1,0,1,1] | 0.30 | ~2000 |
| temperature | -10, 6, [1.5,0,1,0,0,0] | 0.39 | ~4000 |
| humidity (`vegetation`) | -8, 6, [1,1,0,0,0,0] | 0.24 | ~1000 |
| weirdness (`ridge`) | -7, 6, [1,2,1,0,0,0] | 0.35 | ~500 |
| depth | not noise: `gradient(y from -64 to 320: 1.5 to -1.5) + offset` | n/a | 0 at the terrain surface, 1 about 128 blocks below |

- Each is a `NormalNoise` (two Perlin layers, the second at frequency x1.0181) with the given `base_amplitude` (0.888, 1.063, 1.245, 0.949,
  0.915). Feature size = `4 * 2^(-first octave)` blocks because inputs are scaled by 0.25 [D]. "Peaks and valleys" (PV) is not a noise but
  `PV = -(| |weirdness| - 2/3 | - 1/3) * 3` (file `ridges_folded`): -1 at weirdness 0, +1 at |weirdness| 2/3, 0 at |weirdness| 1 [P].
- Values are quantised as `(long)(v * 10000)` before lookup [P].
- Humidity has the narrowest distribution (sd 0.24), so the wettest band (above 0.3) is only about 10 % of area [D].

### 3.3 Bands (indexes used by the table)

- Temperature T0..T4: [-1, -0.45], [-0.45, -0.15], [-0.15, 0.2], [0.2, 0.55], [0.55, 1].
- Humidity H0..H4: [-1, -0.35], [-0.35, -0.1], [-0.1, 0.1], [0.1, 0.3], [0.3, 1].
- Erosion E0..E6: [-1, -0.78], [-0.78, -0.375], [-0.375, -0.2225], [-0.2225, 0.05], [0.05, 0.45], [0.45, 0.55], [0.55, 1]. E0 is the most
  rugged, E6 the flattest.
- Continentalness: mushroom [-1.2, -1.05], deep ocean [-1.05, -0.455], ocean [-0.455, -0.19], coast [-0.19, -0.11], near inland [-0.11, 0.03],
  mid inland [0.03, 0.3], far inland [0.3, 1]. The code also defines an "inland" span [-0.11, 0.55], used for valley swamps and sulfur caves.
- Weirdness slices, each mapped to a terrain relief class through PV (valleys are the smallest slice):

| Weirdness (ridges) | PV | Class | Weirdness (ridges) | PV | Class |
|---|---|---|---|---|---|
| +-[0.933, 1.0] | 0.0 to 0.2 | mid | +-[0.4, 0.567] | 0.2 to 0.7 | high |
| +-[0.767, 0.933] | 0.2 to 0.7 | high | +-[0.267, 0.4] | -0.2 to 0.2 | mid |
| +-[0.567, 0.767] | 0.7 to 1.0 | **peaks** | +-[0.05, 0.267] | -0.85 to -0.2 | low |
| | | | (-0.05, 0.05) | below -0.85 | **valleys** |

- The sign of weirdness picks the variant: negative uses the base biome table, positive (or the valley slice) uses the "variant" tables.
- Depth: surface biomes are defined at depth 0 and 1 (two points), cave biomes at depth 0.2 to 0.9, and only the deep dark at depth 1.1.

### 3.4 How a biome is chosen

- Six-dimensional nearest lookup: the table is a list of parameter points, each with a min-max range per parameter plus an `offset`
  (0 for all vanilla entries). Fitness = sum of squared distances, where the distance to a range is 0 inside it and the gap outside it,
  plus offset squared; the lowest fitness wins. The 26.3 table has about 7,600 points (my port of the builder gives 7,594 with the
  surface points doubled for depth 0 and 1, and exactly the 56 Overworld biomes of the `is_overworld` tag, which is a useful cross-check),
  spatially indexed with an R-tree (`Climate.RTree`) [P/D].
- The builder code (`OverworldBiomeBuilder`) generates the table, so the "data" is code. Ranges are aligned with the band edges above,
  which means a dense lookup by band index gives the same answer in almost every cell [D, my inference; test before relying on it].

### 3.5 Surface biome tables (26.3) [P]

`MIDDLE[T][H]`, used when weirdness < 0 and as the fallback (H0 dry to H4 wet):

```
T0  snowy_plains  snowy_plains  snowy_plains  snowy_taiga        taiga
T1  plains        plains        forest        taiga              old_growth_spruce_taiga
T2  flower_forest plains        forest        birch_forest       dark_forest
T3  savanna       savanna       forest        jungle             jungle
T4  desert        desert        desert        desert             desert
```

`MIDDLE_VARIANT[T][H]`, used when weirdness >= 0 (blank = use MIDDLE):

```
T0  ice_spikes        .  snowy_taiga  .                        .
T1  dappled_forest    .  .            .                        old_growth_pine_taiga
T2  sunflower_plains  .  .            old_growth_birch_forest  .
T3  .                 .  plains       sparse_jungle            bamboo_jungle
T4  .                 .  .            .                        .
```

`PLATEAU[T][H]` (mid or far inland at moderate erosion) and its variants when weirdness >= 0:

```
PLATEAU  T0 snowy_plains x3, snowy_taiga x2 | T1 meadow, meadow, forest, taiga, old_growth_spruce_taiga
         T2 meadow x4, pale_garden          | T3 savanna_plateau x2, forest, forest, jungle
         T4 badlands x3, wooded_badlands x2
VARIANT  T0 ice_spikes (H0) | T1 cherry_grove (H0), meadow (H2,H3), old_growth_pine_taiga (H4)
         T2 cherry_grove (H0,H1), forest (H2), birch_forest (H3) | T4 eroded_badlands (H0,H1)
```

`SHATTERED` (erosion 5, windswept): T0 and T1: gravelly hills, gravelly hills, hills, forest, forest; T2: hills x3, forest x2; T3, T4 fall
back to MIDDLE. Windswept savanna replaces the shattered pick when temperature index above 1, humidity below 4 and weirdness >= 0.
Other picks: peaks are `jagged_peaks` (weirdness < 0) or `frozen_peaks` for T0 to T2, `stony_peaks` for T3, badlands for T4; slopes
are `snowy_slopes` (H0, H1) or `grove` for T0 to T2; T3 and T4 use the plateau pick. Hot columns (T4) swap in badlands: `badlands`,
`eroded_badlands` (H0, H1 with weirdness >= 0), `wooded_badlands` (H3 and above). Beach pick: T0 `snowy_beach`, T4 `desert`, else `beach`.

Which pick applies where, per relief slice (C coast, N near, M mid, F far inland; E0 to E6 erosion; `midBad` = middle biome, but
badlands in T4; `midBadSlope` = the same, but slope in T0; `shC` = shattered coast = beach for weirdness < 0, else middle; `wsav` = the
windswept savanna swap; condensed by hand from `addMidSlice`, `addLowSlice`, `addHighSlice`, `addPeaks`, `addValleys`):

```
mid slice   C E0-E2 stony_shore (all T, H)   | N..F E0 slope | N..M E1 midBadSlope, F E1 slope (T0) or plateau | E2 N mid, M midBad, F plateau
            E3 C..N mid, M..F midBad | E4 C beach (weirdness < 0) else mid, N..F mid | E5 C shC, N mid+wsav, M..F shattered
            E6 C beach (weirdness < 0) else mid; N..F mid only in T0; swamp (T1-T2) or mangrove (T3-T4) over N..F
low slice   C E0-E2 stony_shore | E0-E1 N midBad, M..F midBadSlope | E2-E3 N mid, M..F midBad | C E3-E4 beach | E4 N..F mid
            E5 C shC, N mid+wsav, M..F mid | E6 C beach; N..F mid only in T0; swamp / mangrove over N..F as above
high slice  E0-E1 C mid | E0 N slope, M..F peak | E1 N midBadSlope, M..F slope | E2-E3 C..N mid | E2 M..F plateau | E3 M midBad, F plateau
            E4 C..F mid | E5 C..N mid+wsav, M..F shattered | E6 C..F mid
peak slice  E0 C..F peak | E1 C..N midBadSlope, M..F peak | E2-E3 C..N mid | E2 M..F plateau | E3 M midBad, F plateau | E4 C..F mid
            E5 C..N shattered+wsav, M..F shattered | E6 C..F mid
valley      river (frozen_river in T0) at C..N E0-E1, C..F E2-E5, C E6 | inland E6 swamp / mangrove / frozen_river (T0) | M..F E0-E1 midBad
```

Underground biomes are separate boxes: `dripstone_caves` (continentalness 0.8 to 1.0), `lush_caves` (humidity 0.7 to 1.0), `sulfur_caves`
(coast to inland, erosion 5 or 6, weirdness -1.1 to -0.85, new in 26.2), all at depth 0.2 to 0.9; `deep_dark` (erosion 0 or 1, depth 1.1).

### 3.6 Rivers, coasts, oceans

- Oceans: temperature picks one of 5 ocean types (frozen, cold, plain, lukewarm, warm), two depth classes (deep from -1.05 to -0.455).
  Mushroom fields sit below continentalness -1.05 (islands in the deepest ocean) [P].
- Coast band (-0.19 to -0.11, only 0.08 wide): beaches on flat coast (erosion 3 to 6, mostly in the low slices or with negative weirdness),
  stony shore where erosion is 0 to 2 (cliffs), shattered coast where erosion is 5. A beach is a *biome*: T0 gets snowy beach, T4 gets a
  desert [P].
- Rivers are the valley slice (|weirdness| < 0.05). They are placed at coast, near inland and, for erosion 2 to 5, all the way to far
  inland. They do not appear in high-relief valleys (inland erosion 0 or 1 gives a land biome) or in the flattest inland zone (erosion
  6 gives swamp or mangrove instead). River channels come from the offset spline dipping below sea level in the same cells [P/D].
- My simulation: oceans (all ocean biomes + mushroom) about 27 to 30 % of area, coast band 8 %, rivers about 6 to 7 % of area, beaches
  about 2.7 % [D, section 3.9].

### 3.7 Terrain shaper (splines)

- `offset`, `factor` and `jaggedness` (density functions in `worldgen/density_function/overworld`) are cubic-Hermite splines with three nested
  coordinates: continentalness at the top level, erosion inside it, peaks-and-valleys (or ridges) inside that. `offset` breakpoints on
  continentalness: -1.1, -1.02, -0.51, -0.44, -0.18, -0.16, -0.15, -0.1, 0.25, 1.0 (the last five hold 7 to 11-point erosion splines). `factor`
  breakpoints: -0.19, -0.15, -0.1, 0.03, 0.06. `jaggedness` breakpoints: -0.11, 0.03, 0.65.
- Density at a point: `depth = gradient(y) + offset`, where the `offset` function is `-0.50375 + spline(...)` and `gradient` runs from 1.5
  at Y -64 to -1.5 at Y 320. Then `sloped = 4 * quarter_negative((depth + jaggedness * half_negative(jagged_noise)) * factor) + base_3d_noise`.
  The final density is interpolated on 4x4x8 block cells and has caves subtracted (cheese, spaghetti, noodle, entrances) [P]. Solid where
  the density is above 0. The terrain surface is where depth is about 0, so **surface Y is about 128 + 128 * offset** ignoring noise [D].
- Evaluating the shipped splines by my own code gives approximate surface heights (Y in the 384-tall world, sea level 63) [D]:

| Continentalness | Erosion E0 (rugged, -0.9) | E2 (-0.3) | E4 (0.3) | E6 (0.8) |
|---|---|---|---|---|
| -1.05 (mushroom island band) | 46 | 46 | 46 | 46 |
| -0.6 (deep ocean floor) | 35 | 35 | 35 | 35 |
| -0.3 (ocean) | 48 | 48 | 48 | 48 |
| -0.15 (coast), valley / mid / peak slice | 52 / 101 / 152 | 27 / 69 / 71 | 46 / 63 / 64 | 61 / 60 / 64 |
| 0.15 (mid inland), valley / mid / peak | 82 / 144 / 207 | 34 / 97 / 108 | 51 / 65 / 76 | 61 / 60 / 76 |
| 0.8 (far inland), valley / mid / peak | 105 / 176 / 249 | 39 / 118 / 136 | 56 / 65 / 76 | 61 / 64 / 76 |

- Overall range of the spline surface is about Y 25 to 252; plains sit near 62 to 68; oceans are 15 to 30 blocks below sea level; peaks
  are 190 to 250. `factor` ranges 0.63 to 6.3 (it scales how strongly depth pulls the density, so low values let the 3D noise dominate: rougher,
  more overhangs; my reading, U) and `jaggedness` 0 to 0.63 (spiky mountain ridges) [D].

### 3.8 Surface rules

- Rules live in `worldgen/material_rule/overworld` (older versions: `surface_rule` inside noise settings). A rule tree of `sequence`,
  `condition` and `block` nodes is evaluated per column from the top: conditions include `on_floor`, `under_floor`, `deep_under_floor`,
  `not_underwater`, `hole`, `above_preliminary_surface`, biome tests, `y_above` with a depth multiplier, `noise_threshold` on named noises
  (`surface`, `surface_secondary`, `surface_swamp`, `small_patch`, `powder_snow`, `ice`, `gravel`), and `vertical_gradient` (random
  transition). Result nodes are blocks, `bandlands` (terracotta bands from `clay_bands_offset`), and ore veins.
- Surface layer depth per column = `surface_noise * 2.75 + 3 + random * 0.25` (about 3 to 6 blocks) [P].
- Default: grass block if not underwater, else dirt. Examples: desert and beaches: sand over sandstone below `deep_under_floor`; badlands:
  terracotta bands from the `bandlands` node with red sand on top; peaks have dedicated sub-rules (stone, snow, powder snow, packed ice
  patches; details not read, U); swamp: water pools where `surface_swamp` noise is above 0 at Y 62; dappled forest: coarse dirt patches;
  deepslate replaces stone across Y 0 to 8 (vertical gradient); bedrock floor at the bottom. Ore veins are also material rules (copper
  veins with granite filler, iron with tuff) [P].

### 3.9 How many biomes, and what vanilla looks like statistically

- 67 biome files in 26.3; 56 are Overworld (52 surface + `dripstone_caves`, `lush_caves`, `deep_dark`, `sulfur_caves`); 5 Nether, 5 End,
  `the_void` [P]. About 40 of the 52 surface biomes are land (52 minus 9 ocean types, mushroom fields and 2 rivers) [D].
- I re-implemented the climate noise from the JSON parameters (own RNG, not Xoroshiro, so statistics only) and the 26.3 table, then
  sampled 30,000 random points over a 600 km square [D]. Top shares of total area: forest 11.5 %, plains 10.1 %, ocean 6.8 %, river
  6.2 %, cold ocean 4.3 %, lukewarm ocean 4.3 %, savanna 4.1 %, taiga 3.6 %, deep ocean 3.3 %, snowy plains 3.2 %. Rare: dappled forest
  0.4 %, cherry grove 0.3 %, ice spikes 0.24 %, pale garden 0.14 %, mushroom fields 0.11 %, stony peaks 0.11 %.
- On a 15,000 x 15,000 block window sampled every 50 blocks: land biome patches have a median (area-weighted) size of about 90,000 square
  blocks (equivalent diameter about 340 blocks), 10th percentile about 5,000 (80 blocks), 90th percentile about 830,000 (1000 blocks). About 34 %
  of adjacent sample pairs are biome borders. Hot next to cold biomes (desert, savanna, jungle beside snowy plains or peaks) occurs in
  about 0.012 % of borders (7 of 60,839; only cold slopes or groves beside savanna plateaus), because climate is continuous and the table
  places T-index neighbours together [D]. Ocean share of area was 27 % in that window.
- Micro-benchmark on this sandbox (Node 22, single thread) [D]: one 3D improved-Perlin eval about 50 ns; a 5-octave fBm about 215 ns.
  A full 16x16x80 chunk at vanilla's 4x4x8 cell interpolation is 275 corner samples per density function, far below the 8 ms budget.

## 4. Ideas from other games and writing for a hierarchical, data-driven biome system

### 4.1 What each source contributes

| Source | What it does | Evidence |
|---|---|---|
| **Minecraft 1.18+** | Six-parameter lookup, 3-spline terrain shaper, biome as label with surface rules, features and spawns. Variants by a weirdness sign, cave biomes on the depth axis. | [P] section 3 |
| **Terraria** | Fixed order of about 60 named generation passes (Terrain, Dunes, Tunnels, Mount Caves, Generate Ice Biome, Jungle, Full Desert, Marble, Granite, Mushroom Patches, Dungeon, Corruption, Lakes, Beaches, and so on). Five vertical layers (space, surface, underground, cavern, underworld). Global placement rules: the snow biome is on the same side as the dungeon and opposite the jungle; the evil biome sits on the jungle's side; Corruption or Crimson chosen once per world. Each surface family has an underground counterpart (ice, underground jungle, underground desert, glowing mushroom). Mini-biomes (marble, granite, bee hive, spider nest, jungle temple) are placed inside host biomes. Biomes are also *tile-count* states: the player is "in" a biome when enough of its tiles are within range (about 125 to 1500 tiles by biome). Evil biomes and the Hallow spread at runtime by converting susceptible tiles; Hallow and evil block each other; spread is 6x faster on the surface in Hardmode. | [S] tModLoader wiki (step list opened), Terraria wiki snippets |
| **Hytale** | Zones are large curated regions with their own tile biomes, caves and unique prefabs; designers decide which biomes may meet. V2 (announced 2026-01-05) moves to biome assets built as a node graph. A `WorldStructure` of type `NoiseRange` maps a 2D density value to biome ranges with a default biome, a `DefaultTransitionDistance` (32 blocks default, larger is smoother, 1 is a hard edge) and `MaxBiomeEdgeDistance` for a `DistanceToBiomeEdge` density node. Each biome asset has five parts: terrain density, material provider (block choice), props (position provider then assignments, scanner, pattern), environment provider (sky, fog, weather), tint provider (colour tint). V1 hit limits when zones and biomes multiplied. | [S] Hytale blog snippet; [P-unofficial] community decompile of the pre-release server (`HyperSystemsDev/HytaleServerDocs`); treat as [U] for retail behaviour |
| **Vintage Story** | Climate first: temperature from a latitude triangle wave plus noise, rainfall noise, "geologic activity", all packed in one climate map with a wobble pass. Landforms are chosen by weight and climate ranges (parent landform with mutations), each defined by terrain octaves and vertical key positions. Geologic provinces choose rock strata by weight and maximum thickness; each rock has pH, weathering, erosion and a group (sedimentary, metamorphic, igneous, volcanic); 22 rock types [S]. Soil layers follow climate. Deposits (ores) follow rock. Sea level is 110 of a 256-block default height [P]. Vegetation patches use continuous ranges (`MinTemp` -30..40 C, `MinRain`, `MinForest`, `MinShrub`, `MinFertility`, relative height) and 11 placement modes. Biomes are emergent, not enumerated. Pipeline order: maps, terrain, rock strata, caves, block layers, deposits, structures, ponds, vegetation, rivulets, light, snow, creatures. | [P] source in `anegostudios/vsessentialsmod` (`Systems/WorldGen`) |
| **Valheim** | Nine default biomes assigned by an ordered rule list (first match wins) using distance from centre, altitude, sector angle, noise; borders wiggle by a sine pattern. Separate `terrain` (which height algorithm) and `nature` (what grows, footsteps) for each biome. **Alternative biomes** are overlay modifiers with a chance, minimum distance, required or forbidden neighbours, incompatible modifiers, edge size, average height, and min or max count; they add spawns, vegetation, locations and weather. Vegetation is placed per 64 m zone with min and max counts and altitude, tilt, ocean depth, terrain delta and forest limits. Weather has weights per biome. | [P] mod docs `JereKuusela/valheim-expand_world_data`; [S] rule count |
| **No Man's Sky** | Voxel-based generation, then polygonisation, texturing, population; continuous and deterministic; the engine does not distinguish generated from hand-authored content (GDC 2017, Innes McKendrick). | [S] snippets only; talk not opened, so specifics are [U] |
| **Amit Patel (Red Blob Games)** | mapgen2: rank-based redistribution of elevation (`y = 1 - (1-x)^2`) and moisture (uniform) to control area shares; land biomes from an elevation x moisture table: 4 elevation bands (below 0.3, 0.3 to 0.6, 0.6 to 0.8, above 0.8) with 4, 4, 3 and 4 moisture classes, giving 15 cells and 13 distinct land biomes (subtropical desert, grassland, tropical seasonal and rain forest; temperate desert, deciduous and rain forest; shrubland, taiga; bare, scorched, tundra, snow) plus beach, marsh, lake, ice and ocean; rivers by following downslope corners to the coast; lakes when 30 % of corners are water. mapgen4: noise for coastline only, elevation from distance to coast, rainfall by a wind sweep with evaporation and orographic rain shadow, rivers by flow accumulation. | [P] `amitp/mapgen2` `Map.as`, `redblobgames/mapgen4` `map.ts` |
| **Whittaker, Holdridge, Koppen** | Biome as a function of mean temperature and precipitation. Koppen: A tropical (all months at or above 18 C), B dry (evaporation exceeds rain, BW desert or BS steppe by threshold), C temperate (coldest month 0 to 18 C, one month above 10 C), D continental (coldest at or below 0 C, warmest above 10 C), E polar (no month above 10 C). Holdridge adds a potential evapotranspiration axis. | [S] |
| **Terralith and similar packs** | About 95 new biomes on the vanilla multi-noise system, plus canyons, shattered and amplified terrain, floating islands and about 10 cave types. Shows the parameter-table approach scales past 50 labels when the table and surface rules are data. | [S] |

### 4.2 Best ideas for each layer of the pipeline

`world region -> climate -> biome family -> base biome -> variant -> terrain profile -> geology -> hydrology -> vegetation -> surface materials -> local features`

| Layer | Ideas worth using | From |
|---|---|---|
| World region | Very low-frequency region field that biases other fields (macro character) rather than placing biomes; optional global rules (Terraria's side rules, Valheim's distance bands) for authored geography; rank-based redistribution so the owner can set ocean and continent proportions exactly. | Terraria, Valheim, Patel |
| Climate | Temperature with a lapse rate from elevation and a latitude-like trend; humidity from distance to water plus rain shadow; store as continuous fields; bands only when labelling (5 x 5 in vanilla, Koppen thresholds 18, 10, 0 C). | Vintage Story, Patel mapgen4, Koppen, vanilla |
| Biome family | Whittaker-style temperature x precipitation table to a family, with relief (peaks, plateaus, shattered, coast) as a second dimension. Keep ordering along each axis so neighbours are always compatible. | Whittaker, vanilla tables |
| Base biome | A small 2D table per family selected by humidity and erosion; each entry data-defined. | vanilla `MIDDLE`, `PLATEAU`, `SHATTERED` |
| Variant | A rare axis that flips a table cell to a variant (vanilla: sign of weirdness; Valheim: chance-based alt-biome overlays with neighbour rules and minimum counts). Plateau or valley variants by relief class. | vanilla, Valheim |
| Terrain profile | Splines on 3 fields for offset, factor, jaggedness; landform library with mutations and vertical key positions; a separate `terrain` id from a `nature` id. | vanilla, Vintage Story, Valheim |
| Geology | Provinces (low-frequency region noise) x rock groups x weathering and pH; ore and cave style follow rock; soil thickness from climate and distance to sea level. | Vintage Story |
| Hydrology | Rivers as the valley slice of a folded ridge noise carved through the height spline; coast band; ponds and swamps by flatness and humidity; optional downslope flow for rivers that reach the sea. | vanilla, Patel |
| Vegetation | Weighted feature selectors per biome (dappled forest picks litter, trees, fallen logs by weight); continuous ranges (temperature, rain, forest density, fertility, relative height) with placement modes; per-zone counts. | vanilla 26.3, Vintage Story, Valheim |
| Surface materials | Ordered rule tree with `on_floor`, depth, noise-threshold patches, per-biome branches. | vanilla |
| Local features | Structures and mini-biomes placed by seeded spacing grids (abandoned camp: spacing 37, separation 8); Terraria-style mini-biomes inside hosts; boulders, fallen logs, ponds. | vanilla, Terraria |

### 4.3 Measuring distinctness (my synthesis; no source measured it)

- Give every outcome a feature vector of player-visible properties: block mix on surface and filler (histogram), tree species
  and density, ground-cover palette, water share, mean height and roughness, slope histogram, cave style, ore weights, creature table,
  weather weights, sky and fog colour. Distance = weighted mix of Jensen-Shannon divergence on histograms, normalised difference on scalars,
  a colour distance on tints, and Jaccard on sets.
- Count an outcome as distinct only if its nearest neighbour differs on at least two independent axes above a threshold (this matches the
  rule already in `BIOMES.md`). Report the pairwise matrix and the minimum.
- Verify by rendering: sample 200 random surface spots per outcome from a fixed camera height and compare small colour histograms or a
  perceptual hash; near-duplicate pairs get flagged.
- Track rarity budgets: vanilla's rarest surface biomes sit at 0.1 to 0.4 % of area. If an outcome is under about 0.05 % it will rarely be
  seen in a play session; state a target share per outcome and compare to the census.

### 4.4 Measuring transition quality (my synthesis, with vanilla-like baselines from section 3.9)

- **Compatibility**: fraction of border cells where the two outcomes are on the incompatible list (hot next to cold, desert next to swamp).
  Baseline about 0.01 % of borders in a vanilla-like table. Target at most 0.05 %.
- **Patch size distribution**: connected-component areas per outcome; report cell-weighted median, p10 and p90 and the share of tiny patches
  (under about 2 cells). Vanilla-like land median about 340 blocks equivalent diameter.
- **Border smoothness**: ratio of border length to the square root of patch area (fractal noise gives rough but not speckled borders);
  jitter amplitude a few blocks, as vanilla's shift noise.
- **Height seam**: at every border, height difference across a 4 block band; flag seams above a slope limit (for example 6 blocks per 4).
  Blend heights with a distance-to-border weight (Hytale's transition distance idea, default 32).
- **Material seam**: blend surface block probabilities over the transition band so the edge is a gradient of blocks, not a line.
- **Order check**: along a transect, continentalness must run deep ocean, ocean, coast, inland without skipping bands; a monotone-band test on
  1,000 random transects catches table errors.
- **Determinism and chunk-border test**: generate the same 32x32 area from four chunk offsets; all fields, biomes and blocks must be identical.
- **Speed**: milliseconds per chunk over 1,000 chunks, median and p99, in Node and in a browser worker.

## 5. Recommendations for Blockcraft (16x16 chunks, 80 blocks high, sea level 24, JavaScript)

1. Copy vanilla's separation of shape and label: three continuous fields (continentalness, erosion, folded ridges) drive height through splines;
   temperature and humidity plus relief class drive biome labels. This keeps terrain smooth across biome borders.
2. Sample fields on a 4x4 block grid (25 or 36 samples per chunk with a margin) and interpolate bilinearly; add a small jitter noise
   (about +-4 blocks) at lookup time. Full 16x16x80 per-block 3D noise would be about 20,000 evaluations per layer, roughly 1 ms per layer in
   V8 at 50 ns each [D]; cell interpolation with 4x4x8 cells needs about 275 [P/D].
3. Bake the biome table into a dense array indexed by band indexes (for example continentalness bands x erosion bands x relief slices x
   5 temperatures x 5 humidities, a few tens of thousands of entries in a `Uint16Array`) instead of a nearest-point search; write a test that compares
   it with a brute-force search on random samples. Use `Uint16` ids because 200+ outcomes exceed 255.
4. Rescale vertical geometry asymmetrically. Above sea level compress vanilla's 63..250 range into sea level + 0..~52 (a factor of about
   0.28; sea level 24 + 52 = 76 fits under 80); below sea level use about half of vanilla depth (vanilla ocean floors are 15 and 28 below
   sea level, so 8 and 14 here) and keep at least 6 blocks of stone above bedrock. Do not copy vanilla's absolute heights. Keep the snow
   line and tree line as fractions of the local relief.
5. Keep the world's horizontal feature scale smaller than vanilla. Vanilla's median land patch is about 340 blocks across and continents
   are about 2000 blocks; with a render distance of 8 chunks (a 256-block-wide view) a player would usually see one to three biomes at
   a time, and 200+ outcomes would almost never show up in a session. Consider a scale factor of 0.25 to 0.5 for continentalness and
   temperature and smaller for humidity and weirdness. Choose after the census tool shows candidates (per `BIOMES.md`, proportions are
   the owner's decision).
6. Use quantile mapping (precomputed CDF lookup, 256 entries) on continentalness so ocean share is a parameter, as Patel's rank
   redistribution does; noise distribution is seed-independent enough to precompute once.
7. Rivers: use the folded-ridge valley slice through the height spline, biome label `river` where the slice and band tables say so. Add a
   `river_distance` field from the same slice for banks and floodplains. Do not rely on downslope flow unless rivers must always reach the
   sea (Patel's method needs global data; avoid for infinite worlds).
8. Variant axis: use a low-frequency "weirdness" style field with a sign flip to produce variants for the same base table (as vanilla: dappled
   forest, sunflower plains, ice spikes), and a rare-overlay layer with neighbour and minimum-distance rules (as Valheim's alt biomes).
9. Keep terrain profile, geology and vegetation as separate data tables selected from the base biome id plus variant; a biome record holds
   ids and ranges, not code. Weighted feature selectors per biome (as dappled forest) give variety without new algorithms.
10. Determinism: seeds and hashes must be integer-only and independent of `Math.sin`, `Math.pow`, `Math.exp` and other transcendental calls
    whose results the ECMAScript spec allows to vary between engines [U: general knowledge]. Use a table-based fade and integer hashing; then
    a save made in one browser regenerates identically in another and in Node tests. Keep golden chunk hashes per generator version.
11. Sky and light: model day length 24000 ticks with sky light 15 by day and 4 at night, linear ramps, weather blending toward 4; sleeping
    allowed when sky darkening is at least 4 (so thunderstorms allow sleeping, rain alone does not). Block light 15 max, minus 1 per step; torch 14.
12. Spawning: use vanilla's rule shape but scale caps to Blockcraft's loaded chunk count (`cap = max * chunks / 289`) and lower the hostile
    maximum (70 vanilla) for JavaScript pathfinding cost (for example 20 to 30 near the player). Monsters: block light 0 and dark enough;
    passive: grass and light above 8, every 20 s only. Despawn beyond 128 blocks (or render distance) and randomly beyond 32 after 30 s.
13. Fuel and smelting: implement fuel as `ticks` per item from data (coal 1600, planks and logs 300, sticks 100, wooden tools 200,
    lava bucket 20000) and recipes with `cookingtime` 200; blast furnace and smoker as x2 speed with fuel burning twice as fast (same items per
    fuel). Make these data rows now because 26.3 itself moved them to data.
14. Beds: follow the data-driven rule shape (`can_sleep`, `can_set_spawn`, `destroy_on_leave`) so a straw-bed style item is one data row. The
    8 by 5 monster check and the 100-tick sleep are cheap to copy exactly.
15. Combat: implement the cooldown formula (`0.2 + 0.8 s^2`), crit only when falling and not sprinting, sweep with swords, 20-tick hurt cooldown
    with the 10-tick half rule, and armor `clamp(armor - damage / (2 + toughness/4), 0.2 armor, 20) / 25`. All are a few lines and testable
    against the numbers in section 2.
16. Farming and fluids (Stage 5): random ticks at 3 per section per tick; crop growth `1 / (floor(25 / speed) + 1)`; water 5-tick delay
    with 7 blocks of spread, lava 30-tick delay with 3; cap fluid updates per frame so a lake does not stall a tick.
17. Workers: run generation and meshing in Web Workers with `Uint8Array` or `Uint16Array` chunk buffers transferred, not copied. Sample noise
    in batched volumes per chunk into typed arrays; the 26.3 decompiled source is organised around volume sampling too [P source; U on why].
18. Census and inspector (Stage 4): reuse the same field functions so the biome map, F3 inspector and the census read one source of truth.
    Use my vanilla-like baselines (section 3.9) as the comparison point, not as targets.
19. Author outcomes as compositions, not 200 hand-written records. Vanilla reaches its 52 surface labels from 25 temperature x humidity cells,
    relief slices and a variant flag; the analogue here is about 45 base biomes plus a small set of modifier patches (wet, dry, rocky, coastal,
    old growth, and so on), each patch listing only its differences from the base (surface blocks, tree weights, plant palette, water
    pools), as Valheim's alt biomes do. A compatibility table decides which patches may combine (`BIOMES.md` already proposes this).
20. Do not treat the mirror-derived tables as licensed data. Write Blockcraft's own biome names, colours and tables; keep only the structural
    ideas (bands, slices, nearest lookup, layered rules). The roadmap already requires original names and art.

## 6. Unverified or uncertain items

- Everything tagged [S] and [U] above, especially: the 26.1 world-storage change, the SDL3 mention, per-mob details of `isPreventingPlayerRest`
  (which mobs stop sleep), the exact sun-burn mob list, skeleton arrow damage in practice, shield behaviour, enchantment effects on armor,
  and any claim that numbers are "unchanged since" older versions.
- Official minecraft.net and minecraft.wiki text was never read; 26.3 feature lists come from the shipped data plus [S] articles.
- Terraria, Hytale, Vintage Story wiki and No Man's Sky talk content is from search snippets and third-party docs; only Vintage Story
  source, Valheim mod docs, mapgen2, mapgen4 and the tModLoader step list were read directly.
- Hytale details come from a community decompile of a pre-release server jar dated 2026-02-05; retail behaviour may differ.
- My simulation used my own random generator, not Mojang's Xoroshiro-based one, and treated the target depth as 0. Shares and patch sizes
  are statistical estimates (sampling error about 0.2 percentage points on 10 % shares). The spline height table is my evaluation of the
  shipped splines and ignores 3D noise, jaggedness and terrain blending.
- The claim in 3.4 that a dense band-indexed table equals the nearest-point lookup is my inference from range alignment, not tested.
- Whether the batched-volume density engine and other 26.3 source changes are new in 26.3: the mirror has no 26.2 source, so unknown.
- The 26.3 data-format facts (feature and material_rule folders, natural_mob_spawns attribute) are [P] from JSON diffs, but I did not read
  Mojang's own explanation of them.
- No physical-hardware or browser performance test was run; the micro-benchmark is one Node 22 process on a shared sandbox.

## 7. Sources

Primary mirrors and code (GitHub, read directly):

- https://github.com/misode/mcmeta (tags `26.3-data-json`, `26.2-data-json`, `26.1-data-json`, `26.3-registries` and earlier `*-registries`, `*/version.json`)
- https://github.com/mc-dataminning/build-changes (tag `26.3`: `OverworldBiomeBuilder`, `Climate`, `NaturalSpawner`, `MobCategory`, `FoodData`,
  `FoodConstants`, `CombatRules`, `Player`, `ServerPlayer`, `LivingEntity`, `ArmorMaterials`, `ToolMaterial`, `Items`, `Blocks`, `CropBlock`,
  `FarmlandBlock`, `FlowingFluid`, `LavaFluid`, `WaterFluid`, `BedRule`, `Level`, `MaterialSystem`, `NormalNoise`, `GradientNoise`)
- https://github.com/anegostudios/vsessentialsmod and https://github.com/anegostudios/vssurvivalmod (Vintage Story world generation source)
- https://github.com/JereKuusela/valheim-expand_world_data (docs `biomes.md`, `alt-biomes.md`, `world.md`, `vegetation.md`)
- https://github.com/amitp/mapgen2 (`Map.as`) and https://github.com/redblobgames/mapgen4 (`map.ts`, `config.js`)
- https://github.com/tModLoader/tModLoader/wiki/Vanilla-World-Generation-Steps
- https://github.com/HyperSystemsDev/HytaleServerDocs (`docs/worldgen/WORLD_STRUCTURE.md`, `BIOMES.md`, `ZONES_V1.md`, `WORLDGEN_OVERVIEW.md`; unofficial)
- https://github.com/Cubitect/cubiomes (checked out for cross-reference; no data taken from it)

Search results and secondary pages (snippets only, blocked from full fetch):

- https://minecraft.wiki/w/Java_Edition_26.3 , https://minecraft.wiki/w/Wilderness_Bound , https://minecraft.wiki/w/Java_Edition_26.1 ,
  https://minecraft.wiki/w/Java_Edition_26.2 , https://minecraft.wiki/w/Chaos_Cubed , https://minecraft.wiki/w/Tiny_Takeover ,
  https://minecraft.wiki/w/Mounts_of_Mayhem , https://minecraft.wiki/w/The_Copper_Age , https://minecraft.wiki/w/Version_formats ,
  https://minecraft.wiki/w/Game_drop , https://minecraft.wiki/w/World_generation
- https://www.minecraft.net/en-us/article/minecraft-new-version-numbering-system , https://www.minecraft.net/en-us/article/minecraft-java-edition-26-3 ,
  https://feedback.minecraft.net/hc/en-us/articles/48913133328013-Minecraft-Java-Edition-26-3
- https://www.gamingonlinux.com/2026/09/minecraft-java-edition-26-3-wilderness-bound-update-released/ ,
  https://www.sportskeeda.com/minecraft/news-minecraft-26-3-wilderness-bound-drop-patch-notes-dappled-forest-poplar-trees ,
  https://allthings.how/minecraft-26-3-wilderness-bound-every-new-feature-in-the-update/ ,
  https://www.gamespot.com/articles/next-minecraft-update-release-date/1100-6530316/ ,
  https://nodecraft.com/support/games/minecraft/general/minecraft-update-1-21-11-gamerule-changes
- https://terraria.wiki.gg/wiki/Biomes , https://terraria.wiki.gg/wiki/Biome_spread , https://terraria.wiki.gg/wiki/Evil_biomes ,
  https://terraria.wiki.gg/wiki/World_generation
- https://hytale.com/news/2026/1/the-future-of-world-generation , https://hytalemodding.dev/en/docs/official-documentation/worldgen/worldgen-tutorial/README
- https://wiki.vintagestory.at/World_generation , https://wiki.vintagestory.at/Temperature , https://wiki.vintagestory.at/World_Configuration
- https://valheim.weirdgloop.org/w/Biomes , https://metabot.gg/en/valheim/map
- https://www.gdcvault.com/play/1024265/Continuous_World_Generation_in__No_Man_s_Sky_ ,
  https://procedural-generation.isaackarth.com/2017/03/20/continuous-world-generation-in-no-mans-sky-gdc.html
- http://www-cs-students.stanford.edu/~amitp/game-programming/polygon-map-generation/ , https://www.redblobgames.com/maps/mapgen4/
- https://open.oregonstate.education/permaculturedesign/back-matter/koppen-geiger-classification-descriptions/ ,
  https://en.wikipedia.org/wiki/Robert_Whittaker_(ecologist) , https://serc.carleton.edu/eslabs/weather/4a.html
- https://github.com/Stardust-Labs-MC/Terralith , https://stardustlabs.miraheze.org/wiki/Terralith
