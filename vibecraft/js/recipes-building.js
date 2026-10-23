'use strict';
// Building-block recipes (reference shapes): three in a row make 6 slabs, the staircase pattern makes 4 stairs.
(function (root) {
  const BC = root.BC;
  const { shaped } = BC.crafting;
  for (const m of BC.building.MATERIALS) {
    shaped(['###'], { '#': m.material }, m.slab, 6);
    shaped(['#  ', '## ', '###'], { '#': m.material }, m.stairs, 4);
  }
})(typeof window !== 'undefined' ? window : globalThis);
