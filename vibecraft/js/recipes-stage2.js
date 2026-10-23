'use strict';
// Stage 2 recipes: furnace, chest, torches, and the smelting table used by furnaces.
(function (root) {
  const BC = root.BC;
  const { shaped } = BC.crafting;
  const IT = BC.items;
  shaped(['###', '# #', '###'], { '#': 'cobblestone' }, 'furnace');
  shaped(['###', '# #', '###'], { '#': 'oak_planks' }, 'chest');
  // Torches arrive with the lighting workstream; add their recipes only once the torch exists.
  if (IT.key('torch')) {
    shaped(['C', '#'], { C: 'coal', '#': 'stick' }, 'torch', 4);
    shaped(['C', '#'], { C: 'charcoal', '#': 'stick' }, 'torch', 4);
  }
  // Any other species' planks make chests too.
  for (const d of IT.all()) if (d.key.endsWith('_planks') && d.key !== 'oak_planks') shaped(['###', '# #', '###'], { '#': d.key }, 'chest');

  // Smelting: input item key → output item key (reference 26.3 recipes, 200 ticks each).
  const SMELT = {
    cobblestone: 'stone', sand: 'glass', raw_iron: 'iron_ingot', iron_ore: 'iron_ingot', raw_gold: 'gold_ingot', gold_ore: 'gold_ingot',
    coal_ore: 'coal', diamond_ore: 'diamond',
  };
  const COOK_TICKS = 200;
  function result(itemId) {
    const d = IT.get(itemId); if (!d) return null;
    let out = SMELT[d.key];
    if (!out && d.key.endsWith('_log')) out = 'charcoal';   // any log burns into charcoal
    if (!out && d.smeltsTo) out = d.smeltsTo;               // items can declare their own smelting result (e.g. raw meat)
    const o = out && IT.key(out);
    return o ? { id: o.id, count: 1 } : null;
  }
  const fuelTicks = itemId => { const d = IT.get(itemId); return d && d.fuel ? Math.round(d.fuel * 20) : 0; };
  BC.smelting = { SMELT, COOK_TICKS, result, fuelTicks };
})(typeof window !== 'undefined' ? window : globalThis);
