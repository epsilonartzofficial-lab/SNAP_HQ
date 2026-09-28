'use strict';
// Block registry and mining rules. Numeric block ids are stored in saves and must never change.
(function (root) {
  const BC = root.BC;

  // hardness < 0 = unbreakable in Survival. tool = the tool type that speeds mining.
  // tier = minimum tool tier needed for the block to drop anything (1 wood/gold, 2 stone, 3 iron, 4 diamond).
  const DEFS = [
    null,
    { key: 'grass_block', name: 'Grass Block', tex: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, hardness: 0.6, tool: 'shovel', drop: 'dirt' },
    { key: 'dirt', name: 'Dirt', tex: 'dirt', hardness: 0.5, tool: 'shovel' },
    { key: 'stone', name: 'Stone', tex: 'stone', hardness: 1.5, tool: 'pickaxe', tier: 1, drop: 'cobblestone' },
    { key: 'cobblestone', name: 'Cobblestone', tex: 'cobble', hardness: 2, tool: 'pickaxe', tier: 1 },
    { key: 'sand', name: 'Sand', tex: 'sand', hardness: 0.5, tool: 'shovel' },
    { key: 'oak_log', name: 'Oak Log', tex: { top: 'log_top', side: 'log_side', bottom: 'log_top' }, hardness: 2, tool: 'axe' },
    { key: 'oak_leaves', name: 'Oak Leaves', tex: 'leaves', cutout: true, hardness: 0.2, tool: 'hoe', swordFast: true, drop: 'leaves' },
    { key: 'oak_planks', name: 'Oak Planks', tex: 'planks', hardness: 2, tool: 'axe' },
    { key: 'glass', name: 'Glass', tex: 'glass', cutout: true, hardness: 0.3, drop: null },
    { key: 'water', name: 'Water', tex: 'water', liquid: true, hardness: -1, drop: null },
    { key: 'bedrock', name: 'Bedrock', tex: 'bedrock', hardness: -1, drop: null },
    { key: 'snowy_grass_block', name: 'Snowy Grass Block', tex: { top: 'snow', side: 'snow_side', bottom: 'dirt' }, hardness: 0.6, tool: 'shovel', drop: 'dirt' },
    { key: 'bricks', name: 'Bricks', tex: 'brick', hardness: 2, tool: 'pickaxe', tier: 1 },
    { key: 'coal_ore', name: 'Coal Ore', tex: 'coal', hardness: 3, tool: 'pickaxe', tier: 1, drop: 'coal' },
    { key: 'iron_ore', name: 'Iron Ore', tex: 'iron', hardness: 3, tool: 'pickaxe', tier: 2, drop: 'raw_iron' },
    { key: 'gold_ore', name: 'Gold Ore', tex: 'gold', hardness: 3, tool: 'pickaxe', tier: 3, drop: 'raw_gold' },
    { key: 'diamond_ore', name: 'Diamond Ore', tex: 'diamond', hardness: 3, tool: 'pickaxe', tier: 3, drop: 'diamond' },
    { key: 'cactus', name: 'Cactus', tex: { top: 'cactus_top', side: 'cactus_side', bottom: 'cactus_top' }, hardness: 0.4, hurts: 1 },
    { key: 'stone_bricks', name: 'Stone Bricks', tex: 'stone_bricks', hardness: 1.5, tool: 'pickaxe', tier: 1 },
    { key: 'crafting_table', name: 'Crafting Table', tex: { top: 'table_top', side: 'table_side', bottom: 'planks', front: 'table_front' }, hardness: 2.5, tool: 'axe', use: 'crafting' },
  ];

  const B = { AIR: 0 };
  const BY_KEY = {};
  // Per-id lookup tables used in hot loops (meshing, physics, lighting).
  const SOLID = new Uint8Array(256), OPAQUE = new Uint8Array(256), LIQUID = new Uint8Array(256), LIGHT = new Uint8Array(256);
  const SHAPE = [];   // 'cube' (default), 'cross' (plants), 'torch'
  function applyProps(id, d) {
    const shaped = d.shape && d.shape !== 'cube';
    SOLID[id] = d.liquid || d.solid === false ? 0 : 1;
    OPAQUE[id] = d.liquid || d.cutout || shaped ? 0 : 1;
    LIQUID[id] = d.liquid ? 1 : 0;
    LIGHT[id] = Math.max(0, Math.min(15, d.light | 0));
    SHAPE[id] = d.shape || 'cube';
  }
  // Add a block. Id ranges are reserved per workstream (see docs/ROADMAP.md, "Id ranges").
  function register(id, def) {
    if (!Number.isInteger(id) || id < 1 || id > 255) throw new Error('Block id out of range: ' + id);
    if (DEFS[id]) throw new Error('Block id ' + id + ' is already used by ' + DEFS[id].key);
    if (BY_KEY[def.key]) throw new Error('Block key already registered: ' + def.key);
    def.id = id; DEFS[id] = def; B[def.key.toUpperCase()] = id; BY_KEY[def.key] = def; applyProps(id, def);
    return id;
  }
  DEFS.forEach((d, id) => { if (!d) return; d.id = id; B[d.key.toUpperCase()] = id; BY_KEY[d.key] = d; applyProps(id, d); });
  const ids = () => DEFS.map((d, id) => (d ? id : 0)).filter(Boolean);
  const exists = id => Number.isInteger(id) && id > 0 && !!DEFS[id];
  // Short aliases used by the v1 world generator.
  Object.assign(B, { GRASS: B.GRASS_BLOCK, COBBLE: B.COBBLESTONE, LOG: B.OAK_LOG, LEAVES: B.OAK_LEAVES, PLANKS: B.OAK_PLANKS,
    SNOW: B.SNOWY_GRASS_BLOCK, BRICK: B.BRICKS, COAL: B.COAL_ORE, IRON: B.IRON_ORE, GOLD: B.GOLD_ORE, DIAMOND: B.DIAMOND_ORE });

  // per block: tile names for [left(-x), right(+x), bottom, top, back(-z), front(+z)]
  function faceTiles(id) {
    const d = DEFS[id];
    const t = typeof d.tex === 'string' ? { top: d.tex, side: d.tex, bottom: d.tex } : d.tex;
    if (!t.side) t.side = t.top;
    if (!t.bottom) t.bottom = t.top;
    const s = t.side, f = t.front || s;
    return d.frontAxis === 'x' ? [f, f, t.bottom, t.top, s, s] : [s, s, t.bottom, t.top, f, f];
  }

  // Mining time, following the reference game's formula:
  // damage per tick = speed / hardness / (30 if the block can drop, else 100); time = ceil(1 / damage) ticks.
  // `tool` is an item's tool stats ({type, tier, speed}) or null for an empty hand / non-tool item.
  function breakInfo(id, tool, env) {
    const d = DEFS[id];
    if (!d || d.hardness < 0) return { ticks: Infinity, seconds: Infinity, canHarvest: false, correctTool: false };
    const correct = !!(tool && d.tool && tool.type === d.tool);
    const canHarvest = !d.tier || (correct && tool.tier >= d.tier);
    let speed = 1;
    if (correct) speed = tool.speed;
    else if (tool && tool.type === 'sword' && d.swordFast) speed = 1.5;
    if (env && env.inWater) speed /= 5;
    if (env && env.airborne) speed /= 5;
    if (d.hardness === 0) return { ticks: 0, seconds: 0, canHarvest, correctTool: correct };
    const dmg = speed / d.hardness / (canHarvest ? 30 : 100);
    const ticks = dmg >= 1 ? 0 : Math.ceil(1 / dmg);
    return { ticks, seconds: ticks * BC.C.TICK, canHarvest, correctTool: correct };
  }

  // What a block drops when broken in Survival. Returns [{key, count}].
  function drops(id, canHarvest, rand) {
    const d = DEFS[id];
    if (!d || !canHarvest) return [];
    if (d.drop === null) return [];
    if (d.drop === 'leaves') {
      const out = [];
      // Reference: apple 1/200, stick 1/50 (1–2). Apples are raised to 1/20 until animals exist as a food source.
      if (rand() < 1 / 20) out.push({ key: 'apple', count: 1 });
      if (rand() < 1 / 50) out.push({ key: 'stick', count: 1 + (rand() < 0.5 ? 1 : 0) });
      return out;
    }
    return [{ key: d.drop || d.key, count: 1 }];
  }

  BC.blocks = { DEFS, B, BY_KEY, SOLID, OPAQUE, LIQUID, LIGHT, SHAPE, register, ids, exists, faceTiles, breakInfo, drops, get NB() { return DEFS.length; } };
})(typeof window !== 'undefined' ? window : globalThis);
