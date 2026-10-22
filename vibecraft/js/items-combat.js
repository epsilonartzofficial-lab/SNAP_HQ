'use strict';
// Creatures-and-combat items (ids 350–399): meats, creature drops, the bed item and armor.
// Food values and armor stats follow the reference game (docs/research/REFERENCE-NOTES.md sections 2.5 and 2.8).
(function (root) {
  const BC = root.BC;
  const IT = BC.items;
  const reg = (id, def) => IT.register(id, Object.assign({ kind: 'item' }, def));

  // ---------------------------------------------------------------- food (nutrition, saturation), cooked in a furnace
  reg(350, { key: 'raw_pork', name: 'Raw Pork', kind: 'food', sprite: 'raw_pork', food: { hunger: 3, saturation: 1.8 }, smeltsTo: 'roast_pork' });
  reg(351, { key: 'roast_pork', name: 'Roast Pork', kind: 'food', sprite: 'roast_pork', food: { hunger: 8, saturation: 12.8 } });
  reg(352, { key: 'raw_beef', name: 'Raw Beef', kind: 'food', sprite: 'raw_beef', food: { hunger: 3, saturation: 1.8 }, smeltsTo: 'steak' });
  reg(353, { key: 'steak', name: 'Steak', kind: 'food', sprite: 'steak', food: { hunger: 8, saturation: 12.8 } });
  reg(354, { key: 'raw_mutton', name: 'Raw Mutton', kind: 'food', sprite: 'raw_mutton', food: { hunger: 2, saturation: 1.2 }, smeltsTo: 'cooked_mutton' });
  reg(355, { key: 'cooked_mutton', name: 'Cooked Mutton', kind: 'food', sprite: 'cooked_mutton', food: { hunger: 6, saturation: 9.6 } });
  reg(356, { key: 'raw_chicken', name: 'Raw Chicken', kind: 'food', sprite: 'raw_chicken', food: { hunger: 2, saturation: 1.2, effect: { type: 'hunger', seconds: 30, chance: 0.3 } }, smeltsTo: 'cooked_chicken' });
  reg(357, { key: 'cooked_chicken', name: 'Cooked Chicken', kind: 'food', sprite: 'cooked_chicken', food: { hunger: 6, saturation: 7.2 } });
  // Dropped by the Mirewalker; like the reference game's rotten flesh (4 / 0.8, Hunger 30 s at 80 %).
  reg(360, { key: 'mire_flesh', name: 'Mire Flesh', kind: 'food', sprite: 'mire_flesh', food: { hunger: 4, saturation: 0.8, effect: { type: 'hunger', seconds: 30, chance: 0.8 } } });

  // ---------------------------------------------------------------- materials
  reg(358, { key: 'leather', name: 'Leather', sprite: 'leather' });
  reg(359, { key: 'feather', name: 'Feather', sprite: 'feather' });
  reg(361, { key: 'bone', name: 'Bone', sprite: 'bone' });
  reg(362, { key: 'arrow', name: 'Arrow', sprite: 'arrow' });
  reg(363, { key: 'silk', name: 'Silk Thread', sprite: 'silk' });
  // The bed item places a two-block bed (blocks-combat.js). Beds do not stack, as in the reference game.
  reg(364, { key: 'bed', name: 'Bed', sprite: 'bed', maxStack: 1, placesBed: true });
  // Wool burns for 5 s (100 ticks) in a furnace.
  if (IT.key('wool')) IT.key('wool').fuel = 5;

  // ---------------------------------------------------------------- armor
  // Slots: 0 head, 1 chest, 2 legs, 3 feet. Points (helmet, chest, legs, boots), toughness and durability
  // = multiplier * (11, 16, 15, 13) come from the reference materials table.
  const SLOTS = ['head', 'chest', 'legs', 'feet'];
  const DUR = [11, 16, 15, 13];
  const ARMOR_MATERIALS = [
    { key: 'leather', name: 'Leather', points: [1, 3, 2, 1], toughness: 0, mult: 5, color: [150, 96, 58], names: ['Cap', 'Tunic', 'Trousers', 'Boots'] },
    { key: 'iron', name: 'Iron', points: [2, 6, 5, 2], toughness: 0, mult: 15, color: [206, 208, 210] },
    { key: 'golden', name: 'Golden', points: [2, 5, 3, 1], toughness: 0, mult: 7, color: [244, 204, 64] },
    { key: 'diamond', name: 'Diamond', points: [3, 8, 6, 3], toughness: 2, mult: 33, color: [96, 220, 212] },
  ];
  const PIECES = [{ key: 'helmet', name: 'Helmet' }, { key: 'chestplate', name: 'Chestplate' }, { key: 'leggings', name: 'Leggings' }, { key: 'boots', name: 'Boots' }];
  ARMOR_MATERIALS.forEach((m, mi) => PIECES.forEach((p, si) => {
    const durability = m.mult * DUR[si];
    reg(370 + mi * 4 + si, {
      key: `${m.key}_${p.key}`, name: `${m.name} ${m.names ? m.names[si] : p.name}`, kind: 'armor', maxStack: 1, tint: m.color,
      armor: { slot: si, points: m.points[si], toughness: m.toughness, material: m.key },
      // Durability is tracked like a tool's (stack.dmg), so saving, dropping and the durability bar work unchanged.
      // An armor "tool" never speeds up mining and does no extra damage: it behaves like an empty hand.
      tool: { type: 'armor', durability, damage: 1, attackSpeed: 4 },
    });
  }));

  const armorOf = stack => (stack && IT.get(stack.id) && IT.get(stack.id).armor) || null;
  // Total armor points and toughness of the worn pieces (an array of 4 stacks or nulls).
  function totals(worn) {
    let points = 0, toughness = 0;
    for (const s of worn || []) { const a = armorOf(s); if (a) { points += a.points; toughness += a.toughness; } }
    return { points, toughness };
  }
  // Wear every worn piece by n; returns the names of pieces that broke (and removes them).
  function wear(worn, n) {
    const broke = [];
    for (let i = 0; i < worn.length; i++) {
      const s = worn[i], d = s && IT.get(s.id);
      if (!d || !d.armor || n <= 0) continue;
      s.dmg = (s.dmg || 0) + n;
      if (s.dmg >= d.tool.durability) { broke.push(d.name); worn[i] = null; }
    }
    return broke;
  }
  const fits = (stack, slot) => { const a = armorOf(stack); return !!a && a.slot === slot; };

  BC.armor = { SLOTS, MATERIALS: ARMOR_MATERIALS, PIECES, armorOf, totals, wear, fits };
})(typeof window !== 'undefined' ? window : globalThis);
