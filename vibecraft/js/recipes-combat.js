'use strict';
// Creatures-and-combat recipes: armor, beds and wool. Cooking raw meat is declared on the items (`smeltsTo`).
(function (root) {
  const BC = root.BC;
  const { shaped } = BC.crafting;
  const IT = BC.items;

  // Armor: helmet 5, chestplate 8, leggings 7, boots 4 of the material (reference shapes).
  const HEADS = { leather: 'leather', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
  for (const [mat, x] of Object.entries(HEADS)) {
    shaped(['XXX', 'X X'], { X: x }, `${mat}_helmet`);
    shaped(['X X', 'XXX', 'XXX'], { X: x }, `${mat}_chestplate`);
    shaped(['XXX', 'X X', 'X X'], { X: x }, `${mat}_leggings`);
    shaped(['X X', 'X X'], { X: x }, `${mat}_boots`);
  }
  // Bed: 3 wool over 3 planks of any wood.
  for (const d of IT.all()) if (d.kind === 'block' && d.key.endsWith('_planks')) shaped(['WWW', 'PPP'], { W: 'wool', P: d.key }, 'bed');
  // Wool from 4 silk thread, as the reference game makes wool from string.
  shaped(['SS', 'SS'], { S: 'silk' }, 'wool');
})(typeof window !== 'undefined' ? window : globalThis);
