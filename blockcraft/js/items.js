'use strict';
// Item registry. Block items share the block's numeric id (1–255); other items use fixed ids ≥ 256.
// Ids are written into saves, so existing ids must never be renumbered.
(function (root) {
  const BC = root.BC;
  const { DEFS } = BC.blocks;

  const ITEMS = [];
  const BY_KEY = {};
  function reg(id, def) { def.id = id; if (def.maxStack == null) def.maxStack = 64; ITEMS[id] = def; BY_KEY[def.key] = def; return def; }

  for (let id = 1; id < DEFS.length; id++) {
    const b = DEFS[id];
    reg(id, { key: b.key, name: b.name, kind: 'block', block: id });
  }

  reg(256, { key: 'stick', name: 'Stick', kind: 'item', sprite: 'stick', fuel: 5 });
  reg(257, { key: 'coal', name: 'Coal', kind: 'item', sprite: 'coal', fuel: 80 });
  reg(258, { key: 'raw_iron', name: 'Raw Iron', kind: 'item', sprite: 'raw_iron' });
  reg(259, { key: 'iron_ingot', name: 'Iron Ingot', kind: 'item', sprite: 'iron_ingot' });
  reg(260, { key: 'raw_gold', name: 'Raw Gold', kind: 'item', sprite: 'raw_gold' });
  reg(261, { key: 'gold_ingot', name: 'Gold Ingot', kind: 'item', sprite: 'gold_ingot' });
  reg(262, { key: 'diamond', name: 'Diamond', kind: 'item', sprite: 'diamond_gem' });
  reg(263, { key: 'apple', name: 'Apple', kind: 'food', sprite: 'apple', food: { hunger: 4, saturation: 2.4 } });

  // Tools: stats follow the reference game (durability, mining speed, harvest tier, attack damage/speed).
  const MATERIALS = [
    { key: 'wooden', name: 'Wooden', tier: 1, speed: 2, durability: 59, color: [150, 112, 62] },
    { key: 'stone', name: 'Stone', tier: 2, speed: 4, durability: 131, color: [128, 128, 130] },
    { key: 'iron', name: 'Iron', tier: 3, speed: 6, durability: 250, color: [218, 218, 214] },
    { key: 'golden', name: 'Golden', tier: 1, speed: 12, durability: 32, color: [246, 208, 62] },
    { key: 'diamond', name: 'Diamond', tier: 4, speed: 8, durability: 1561, color: [94, 222, 214] },
  ];
  const TYPES = [
    { key: 'pickaxe', name: 'Pickaxe', damage: [2, 3, 4, 2, 5], attackSpeed: [1.2, 1.2, 1.2, 1.2, 1.2] },
    { key: 'axe', name: 'Axe', damage: [7, 9, 9, 7, 9], attackSpeed: [0.8, 0.8, 0.9, 1.0, 1.0] },
    { key: 'shovel', name: 'Shovel', damage: [2.5, 3.5, 4.5, 2.5, 5.5], attackSpeed: [1, 1, 1, 1, 1] },
    { key: 'sword', name: 'Sword', damage: [4, 5, 6, 4, 7], attackSpeed: [1.6, 1.6, 1.6, 1.6, 1.6] },
  ];
  MATERIALS.forEach((m, mi) => TYPES.forEach((t, ti) => {
    reg(300 + mi * 10 + ti, {
      key: `${m.key}_${t.key}`, name: `${m.name} ${t.name}`, kind: 'tool', maxStack: 1, sprite: t.key, tint: m.color,
      tool: { type: t.key, tier: m.tier, speed: m.speed, durability: m.durability, damage: t.damage[mi], attackSpeed: t.attackSpeed[mi], material: m.key },
      fuel: m.key === 'wooden' ? 10 : 0,
    });
  }));
  // Wooden items burn in a furnace (used from Stage 2).
  ['oak_log', 'oak_planks', 'crafting_table'].forEach(k => { BY_KEY[k].fuel = 15; });

  const get = id => ITEMS[id] || null;
  const key = k => BY_KEY[k] || null;
  const idOf = k => { const d = BY_KEY[k]; if (!d) throw new Error('unknown item ' + k); return d.id; };
  const maxStack = id => (ITEMS[id] ? ITEMS[id].maxStack : 64);
  const toolOf = stack => (stack && ITEMS[stack.id] && ITEMS[stack.id].tool) || null;
  const all = () => ITEMS.filter(Boolean);

  // A stack is a plain object {id, count, dmg?}. `dmg` counts durability used on tools.
  function make(k, count) { const d = typeof k === 'number' ? ITEMS[k] : BY_KEY[k]; if (!d) return null; const s = { id: d.id, count: count || 1 }; if (d.tool) s.dmg = 0; return s; }
  function valid(s) { return !!(s && ITEMS[s.id] && Number.isInteger(s.count) && s.count > 0 && s.count <= ITEMS[s.id].maxStack); }

  BC.items = { ITEMS, BY_KEY, MATERIALS, TYPES, get, key, idOf, maxStack, toolOf, all, make, valid };
})(typeof window !== 'undefined' ? window : globalThis);
