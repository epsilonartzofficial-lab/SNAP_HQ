'use strict';
// Stage 2 items (ids 264–279).
(function (root) {
  const BC = root.BC;
  BC.items.register(264, { key: 'charcoal', name: 'Charcoal', kind: 'item', sprite: 'charcoal', fuel: 80 });
  // Fuel values in seconds (reference ticks / 20): chests and other wooden blocks burn like planks.
  for (const k of ['chest']) if (BC.items.key(k)) BC.items.key(k).fuel = 15;
})(typeof window !== 'undefined' ? window : globalThis);
