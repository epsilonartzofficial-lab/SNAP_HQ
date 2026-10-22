# Biome system design (200+ outcomes)

**Status: design only. None of this is implemented yet.** Blockcraft currently uses generator version 1, the v0.1
terrain: one height function with plains, forest density, deserts, beaches, sea floor and snowy peaks, and no
biome data at all. The target of 200 or more outcomes is a design goal from the project owner's world-generation
notes. It is separate from Minecraft's own biome count.

## Principles

1. **Geography first.** Continents, oceans, mountain ranges, rivers and climate bands come before any variants.
   Without them, 200 biomes turn into 200 repetitive blobs.
2. **Layers, not lists.** A biome is the result of resolving shared layers, not one of 200 hand-written
   generators:
   `world region → climate → biome family → base biome → variant → terrain profile → geology → hydrology →
   vegetation → surface materials → local features`.
3. **Continuous inputs.** Every layer reads deterministic fields computed from the seed and world position, so
   generation is reproducible and identical on both sides of a chunk border.
4. **Distinct means usable.** An outcome counts toward 200 only if a player can see or use the difference:
   terrain shape, materials, trees and plants, water, caves, resources, creatures, structures, weather or survival
   conditions. Name-only variants do not count.
5. **Families and transitions.** Related variants form families, for example forest, forest edge, forest hills,
   wet forest and highland forest. Neighbouring outcomes blend terrain height, materials and vegetation density
   over a transition band instead of switching at a hard line.
6. **Measured, not guessed.** Tools report distribution, patch sizes, transition quality and distinctness.
   Proportions of ocean, continent and individual biome sizes are the owner's decision. Candidates are measured
   and presented, not chosen silently.

## Fields (inputs)

All fields are seeded noise or derived values, sampled per column (x, z). Heavy fields are sampled on a
4×4 block grid and interpolated to keep generation fast.

| Field | Range | Source | Drives |
|---|---|---|---|
| Continentalness | −1 (deep ocean) to 1 (far inland) | very low-frequency noise plus domain warp | ocean or coast or inland, base height |
| Erosion | 0 (jagged) to 1 (flat) | low-frequency noise | terrain roughness, plateaus, plains |
| Peaks and valleys | −1 to 1 | ridged noise (folded) | ridges, valleys, river channels |
| Temperature | °C-like scale | latitude-free noise, lapse rate with height (−6 °C per 1000 blocks scaled) | climate band |
| Humidity | 0 to 1 | noise plus distance to ocean and rain shadow behind ranges | vegetation density, wet or dry variants |
| Precipitation | derived | humidity × temperature curve | snow or rain, deserts |
| River distance | blocks | distance to river network (valleys, flow to lower continentalness) | rivers, banks, floodplains |
| Coast distance | blocks | from continentalness contour | beaches, cliffs, mangroves |
| Elevation and slope | blocks, degrees | from the terrain function | cliffs, scree, snow line, tree line |
| Groundwater | 0 to 1 | humidity plus low elevation plus river proximity | swamps, springs, lakes |
| Snow cover | 0 to 1 | temperature at surface height | snowy variants |

## Resolution pipeline

1. **World region.** Macro-scale cells (for example 2,000 to 4,000 blocks) give each area a character: an
   archipelago, a continental interior, a mountain belt or a lake district. They bias the fields rather than
   placing biomes directly.
2. **Climate.** Temperature × precipitation classifies into about 12 climate classes in the spirit of
   Whittaker and Köppen: polar, subpolar, cold continental, temperate oceanic, temperate continental,
   Mediterranean, humid subtropical, semi-arid, arid, tropical savanna, tropical monsoon and tropical rainforest.
3. **Biome family.** Climate plus landform selects a family, such as temperate forest, grassland, desert,
   taiga, tundra, jungle, savanna, wetland, mountains, coast, ocean or river.
4. **Base biome.** Each family has 2 to 5 base biomes chosen by humidity, erosion and region, such as
   broadleaf forest, birch forest, mixed forest or autumn forest.
5. **Variant or sub-biome.** Modifiers that combine with base biomes: hills, plateau, valley, edge, wet, dry,
   highland, lowland, coastal, riverside, old growth, burned or flooded. Not every modifier is valid for every base
   biome. A compatibility table decides.
6. **Terrain profile.** Height splines per landform: flat, rolling, hilly, plateau, mesa steps, alpine, canyon or
   karst. Chosen by erosion, peaks and valleys and the variant.
7. **Geology.** Regional rock strata (for example granite belts, limestone karst, sandstone basins, volcanic
   basalt), ore distribution by stratum and depth, and cave style (tunnels, caverns, flooded or lush).
8. **Hydrology.** Rivers, lakes, swamps, springs, waterfalls and frozen water.
9. **Vegetation.** Tree species mix and density, understory, grass and flower palettes, crops that grow wild.
10. **Surface materials.** Top and filler blocks, snow, sand, gravel, mud, moss and clay.
11. **Local features.** Boulders, fallen logs, ponds, ice spikes, structures, creature spawn tables and weather
    weights.

## Counting outcomes

An outcome is a tuple of (base biome, variant, terrain profile, geology class) that passes the compatibility
table. Every outcome gets a feature vector of player-facing properties: surface block mix, tree species and
density, plant palette, water coverage, height statistics, cave style, ore weights, creature table and weather
weights. The census tool computes pairwise distances between outcome vectors. An outcome counts toward the 200
target only if its nearest neighbour differs by at least a set threshold on at least two player-facing axes.

A rough budget, to be adjusted by measurement: about 14 families, 45 base biomes, and on average about five valid
variant and terrain combinations each gives roughly 225 outcomes before the distinctness filter.

## Measurement tools (planned for stage 4)

- **Biome map screen** in game, rendering the fields and the resolved outcome around the player.
- **F3 inspector** showing every field value and each layer's decision at the block you look at.
- **Census script** (Node, headless) sampling many seeds on a grid:
  - share of land, ocean, each family and each outcome;
  - patch size distribution (connected components), flagging patches that are too small (noise specks) or too
    large (monotony);
  - transition quality: the share of borders between incompatible neighbours (for example desert next to
    snowy taiga) and height discontinuities across biome borders;
  - distinctness matrix and the counted-outcome total;
  - generation time per chunk.
- **Candidate reports** showing measured proportions for alternative parameter sets (for example ocean coverage
  of 45 %, 55 % or 65 %) for the owner to choose from.

## Saves and versions

- Worlds record the generator version (`gen`). Version 1 worlds keep using the v0.1 terrain forever.
- Version 2 is opt-in when a world is created. Existing worlds are never regenerated.
- Chunk data is regenerated from seed plus version plus player edits, so generator code for older versions must
  stay in the codebase and keep passing its golden-hash tests.
- A future "upgrade world" option could apply the new generator only to chunks the player has never edited, but
  only with a backup and explicit confirmation.

## Performance budget

- Target under 8 ms to generate a 16×16×80 chunk on a mid-range laptop. Fields are sampled at a coarse grid and
  interpolated, and caches are kept per chunk region.
- Biome decisions are made per column, not per block. Per-block work is limited to caves and strata.
- Generation moves into a Web Worker in the performance track, so generator code must stay free of DOM access
  (it already is).
