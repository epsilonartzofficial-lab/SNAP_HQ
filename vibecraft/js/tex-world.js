'use strict';
// Textures for world-systems blocks: torch and oak sapling (original pixel art), and flat inventory icons for
// shaped blocks. Runs after textures.js and before BC.tex.finalize().
(function (root) {
  const BC = root.BC;
  const T = BC.tex;

  // Torch: a 2-pixel stick (columns 7-8, rows 8-15) with a flame on top (rows 6-7). The 3D torch uses exactly those
  // pixels; the soft glow around them only shows in the flat item picture.
  T.paint('torch', (px, r) => {
    for (let y = 9; y <= 15; y++) {
      const k = (r() - 0.5) * 14;
      px(7, y, [138 + k, 102 + k, 58 + k]);
      px(8, y, [100 + k, 72 + k, 40 + k]);
    }
    px(7, 8, [150, 72, 28]); px(8, 8, [120, 52, 22]);           // charred tip
    px(7, 7, [255, 190, 72]); px(8, 7, [244, 150, 46]);         // flame
    px(7, 6, [255, 246, 196]); px(8, 6, [255, 222, 128]);
    px(7, 5, [255, 214, 110], 0.6); px(8, 5, [255, 190, 80], 0.5); // glow (icon only)
    px(7, 4, [255, 226, 140], 0.25); px(8, 4, [255, 210, 120], 0.2);
    for (const y of [6, 7]) { px(6, y, [255, 176, 64], 0.4); px(9, y, [255, 170, 60], 0.35); }
  });

  // Oak sapling: a thin stem with a small fork and three leafy clumps, on a transparent background.
  T.paint('oak_sapling', (px, r) => {
    const stem = [110, 80, 46], stemD = [86, 62, 36];
    for (let y = 9; y <= 15; y++) { px(7, y, stem); px(8, y, stemD); }
    px(6, 11, stem); px(5, 10, stem); px(9, 12, stemD); px(10, 11, stemD);
    const clumps = [[7.5, 4.6, 3.3], [4.2, 8.2, 2.4], [11.2, 8.8, 2.5], [9.6, 2.2, 1.6]];
    for (let y = 0; y < 14; y++) for (let x = 0; x < 16; x++) {
      let best = 0;
      for (const [cx, cy, rad] of clumps) { const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / rad; if (d < 1) best = Math.max(best, 1 - d); }
      if (!best || r() < 0.12) continue;
      let c = T.jit([74, 146, 50], r, 26);
      if (best < 0.28) c = T.jit([46, 104, 34], r, 16);             // darker rim
      else if (best > 0.7 && r() < 0.5) c = T.jit([118, 184, 76], r, 16); // highlights
      px(x, y, c);
    }
  });

  // Inventory icons: shaped blocks (torches, plants) are shown as their flat picture, not as a cube.
  const baseIcon = T.iconURL, flatIcons = new Map();
  T.iconURL = function (itemId) {
    const d = BC.items.get(itemId);
    if (!d || d.kind !== 'block' || ['cube', 'slab', 'stairs'].includes(BC.blocks.SHAPE[d.block])) return baseIcon(itemId);
    if (flatIcons.has(itemId)) return flatIcons.get(itemId);
    const tile = T.TILE[BC.blocks.faceTiles(d.block)[0]];
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    x.drawImage(T.atlas, (tile % T.ATW) * T.TS, Math.floor(tile / T.ATW) * T.TS, T.TS, T.TS, 0, 0, 32, 32);
    const url = c.toDataURL();
    flatIcons.set(itemId, url);
    return url;
  };
})(window);
