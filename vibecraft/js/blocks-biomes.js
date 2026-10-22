'use strict';
// Biome blocks for world generator v2 (ids 40–119). Pure data: no DOM, loaded in Node by tests/load.mjs.
// Tiles are painted in tex-biomes.js. Ids are stored in saves and must never change.
(function (root) {
  const BC = root.BC;
  const { register, BY_KEY } = BC.blocks;

  // Another workstream may register a block with the same key first (for example gravel or a grass plant). In that
  // case theirs wins and ours is skipped; worldgen2 always resolves blocks by key, so it uses whichever exists.
  const skipped = [];
  function reg(id, def) {
    if (id < 40 || id > 119) throw new Error('Biome block id outside 40–119: ' + id);
    if (BY_KEY[def.key]) { skipped.push(def.key); return 0; }
    return register(id, def);
  }
  const soil = (id, key, name, tex, extra) => reg(id, Object.assign({ key, name, tex, hardness: 0.5, tool: 'shovel' }, extra));
  const rock = (id, key, name, tex, extra) => reg(id, Object.assign({ key, name, tex, hardness: 1.5, tool: 'pickaxe', tier: 1 }, extra));
  const plant = (id, key, name, tex, extra) => reg(id, Object.assign({ key, name, tex, shape: 'cross', solid: false, cutout: true, hardness: 0, tool: null, plant: true }, extra));

  // ---- ground and sediments
  soil(40, 'gravel', 'Gravel', 'bm_gravel', { hardness: 0.6, falls: true });
  soil(41, 'clay', 'Clay', 'bm_clay', { hardness: 0.6 });
  soil(42, 'coarse_dirt', 'Coarse Dirt', 'bm_coarse_dirt');
  soil(43, 'podzol', 'Podzol', { top: 'bm_podzol_top', side: 'bm_podzol_side', bottom: 'dirt' }, { drop: 'dirt' });
  soil(44, 'mud', 'Mud', 'bm_mud');
  soil(45, 'moss_block', 'Moss Block', 'bm_moss', { hardness: 0.1, tool: 'hoe' });
  soil(46, 'dry_grass_block', 'Dry Grass Block', { top: 'bm_dry_grass_top', side: 'bm_dry_grass_side', bottom: 'dirt' }, { hardness: 0.6, drop: 'dirt' });
  soil(47, 'lush_grass_block', 'Lush Grass Block', { top: 'bm_lush_grass_top', side: 'bm_lush_grass_side', bottom: 'dirt' }, { hardness: 0.6, drop: 'dirt' });
  soil(48, 'red_sand', 'Red Sand', 'bm_red_sand', { falls: true });
  rock(49, 'sandstone', 'Sandstone', { top: 'bm_sandstone_top', side: 'bm_sandstone_side', bottom: 'bm_sandstone_top' }, { hardness: 0.8 });
  rock(50, 'red_sandstone', 'Red Sandstone', { top: 'bm_red_sandstone_top', side: 'bm_red_sandstone_side', bottom: 'bm_red_sandstone_top' }, { hardness: 0.8 });

  // ---- badlands clay bands
  rock(51, 'terracotta', 'Terracotta', 'bm_terracotta', { hardness: 1.25 });
  rock(52, 'white_terracotta', 'White Terracotta', 'bm_terracotta_white', { hardness: 1.25 });
  rock(53, 'yellow_terracotta', 'Yellow Terracotta', 'bm_terracotta_yellow', { hardness: 1.25 });
  rock(54, 'orange_terracotta', 'Orange Terracotta', 'bm_terracotta_orange', { hardness: 1.25 });
  rock(55, 'red_terracotta', 'Red Terracotta', 'bm_terracotta_red', { hardness: 1.25 });
  rock(56, 'brown_terracotta', 'Brown Terracotta', 'bm_terracotta_brown', { hardness: 1.25 });

  // ---- snow and ice
  soil(57, 'snow_block', 'Snow Block', 'snow', { hardness: 0.2 });
  reg(58, { key: 'ice', name: 'Ice', tex: 'bm_ice', hardness: 0.5, tool: 'pickaxe', drop: null });
  reg(59, { key: 'packed_ice', name: 'Packed Ice', tex: 'bm_packed_ice', hardness: 0.5, tool: 'pickaxe' });

  // ---- regional rock (geology provinces)
  rock(60, 'granite', 'Granite', 'bm_granite');
  rock(61, 'limestone', 'Limestone', 'bm_limestone', { hardness: 1.2 });
  rock(62, 'slate', 'Slate', 'bm_slate', { hardness: 2.5 });
  rock(63, 'mossy_cobblestone', 'Mossy Cobblestone', 'bm_mossy_cobble', { hardness: 2 });

  // ---- tree species (log, leaves, planks)
  const WOODS = [];
  function wood(id, sp, name) {
    const log = reg(id, { key: sp + '_log', name: name + ' Log', tex: { top: 'bm_' + sp + '_log_top', side: 'bm_' + sp + '_log', bottom: 'bm_' + sp + '_log_top' }, hardness: 2, tool: 'axe', wood: sp });
    const leaves = reg(id + 1, { key: sp + '_leaves', name: name + ' Leaves', tex: 'bm_' + sp + '_leaves', cutout: true, leaves: true, hardness: 0.2, tool: 'hoe', swordFast: true, drop: 'leaves' });
    const planks = reg(id + 2, { key: sp + '_planks', name: name + ' Planks', tex: 'bm_' + sp + '_planks', hardness: 2, tool: 'axe', wood: sp });
    WOODS.push({ species: sp, log: sp + '_log', leaves: sp + '_leaves', planks: sp + '_planks', ids: [log, leaves, planks] });
  }
  wood(64, 'spruce', 'Spruce');
  wood(67, 'birch', 'Birch');
  wood(70, 'acacia', 'Acacia');
  wood(73, 'mahogany', 'Mahogany');
  wood(76, 'willow', 'Willow');

  // ---- ground plants (cross-shaped where the renderer supports it; cubes otherwise)
  plant(79, 'tall_grass', 'Tall Grass', 'bm_tall_grass', { drop: null });
  plant(80, 'fern', 'Fern', 'bm_fern', { drop: null });
  plant(81, 'dry_shrub', 'Dry Shrub', 'bm_dry_shrub', { drop: 'stick' });
  plant(82, 'poppy', 'Poppy', 'bm_poppy');
  plant(83, 'buttercup', 'Buttercup', 'bm_buttercup');
  plant(84, 'bluebell', 'Bluebell', 'bm_bluebell');
  plant(85, 'lavender', 'Lavender', 'bm_lavender');
  plant(86, 'cotton_grass', 'Cotton Grass', 'bm_cotton_grass', { drop: null });
  plant(87, 'reeds', 'Reeds', 'bm_reeds');
  plant(88, 'berry_bush', 'Berry Bush', 'bm_berry_bush', { hardness: 0.1 });

  // ---- warm-sea reef
  rock(89, 'pink_coral_block', 'Pink Coral Block', 'bm_coral_pink', { hardness: 1.5 });
  rock(90, 'blue_coral_block', 'Blue Coral Block', 'bm_coral_blue', { hardness: 1.5 });

  // Metadata for other modules: wood sets (for recipes and fuel), and any keys skipped because they already existed.
  BC.biomeBlocks = { WOODS, skipped, FIRST_ID: 40, LAST_ID: 119 };
})(typeof window !== 'undefined' ? window : globalThis);
