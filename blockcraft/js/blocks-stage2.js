'use strict';
// Stage 2 utility blocks (ids 30–39): furnace (with a lit variant) and chest.
// Blocks with a front face come in two ids: front on the z axis or on the x axis, chosen when placed so the
// front faces the player. (The front texture shows on both opposite sides of that axis.)
(function (root) {
  const BC = root.BC;
  const { register } = BC.blocks;
  // Front towards the player: the axis the player is looking along.
  function facingAxis(player) { const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw); return Math.abs(fx) > Math.abs(fz) ? 'x' : 'z'; }
  const furnaceTex = { top: 'furnace_top', side: 'furnace_side', bottom: 'furnace_top', front: 'furnace_front' };
  const litTex = { top: 'furnace_top', side: 'furnace_side', bottom: 'furnace_top', front: 'furnace_front_lit' };
  const base = { hardness: 3.5, tool: 'pickaxe', tier: 1, use: 'furnace', container: 'furnace' };
  register(30, Object.assign({ key: 'furnace', name: 'Furnace', tex: furnaceTex, placeAs: (w, x, y, z, n, p) => (facingAxis(p) === 'x' ? 31 : 30) }, base));
  register(31, Object.assign({ key: 'furnace_x', name: 'Furnace', tex: furnaceTex, frontAxis: 'x', item: false, drop: 'furnace' }, base));
  register(32, Object.assign({ key: 'lit_furnace', name: 'Lit Furnace', tex: litTex, light: 13, item: false, drop: 'furnace' }, base));
  register(33, Object.assign({ key: 'lit_furnace_x', name: 'Lit Furnace', tex: litTex, frontAxis: 'x', light: 13, item: false, drop: 'furnace' }, base));
  const chestTex = { top: 'chest_top', side: 'chest_side', bottom: 'chest_top', front: 'chest_front' };
  const chest = { hardness: 2.5, tool: 'axe', use: 'chest', container: 'chest' };
  register(34, Object.assign({ key: 'chest', name: 'Chest', tex: chestTex, placeAs: (w, x, y, z, n, p) => (facingAxis(p) === 'x' ? 35 : 34) }, chest));
  register(35, Object.assign({ key: 'chest_x', name: 'Chest', tex: chestTex, frontAxis: 'x', item: false, drop: 'chest' }, chest));
  // Lit/unlit pairs, so the furnace can switch its block when it starts or stops burning.
  BC.blocks.FURNACE_LIT = { 30: 32, 31: 33 };
  BC.blocks.FURNACE_UNLIT = { 32: 30, 33: 31 };
})(typeof window !== 'undefined' ? window : globalThis);
