'use strict';
// Textures for Stage 2 blocks and items (original pixel art).
(function (root) {
  const BC = root.BC;
  const { paint, jit, each, stoneTex, planksTex, sprite, SPRITES } = BC.tex;

  // Furnace: smooth stone body, darker frame, a firebox opening on the front.
  const body = (px, r) => each((x, y) => px(x, y, jit([118, 118, 120], r, 18)));
  const frame = (px, r) => each((x, y) => { if (x === 0 || y === 0 || x === 15 || y === 15) px(x, y, jit([78, 78, 82], r, 8)); });
  paint('furnace_side', (px, r) => { body(px, r); frame(px, r); for (let x = 1; x < 15; x++) px(x, 4, jit([96, 96, 100], r, 8)); });
  paint('furnace_top', (px, r) => { stoneTex(px, r); frame(px, r); each((x, y) => { if (x > 3 && x < 12 && y > 3 && y < 12 && (x === 4 || y === 4 || x === 11 || y === 11)) px(x, y, [88, 88, 92]); }); });
  function front(lit) {
    return (px, r) => {
      body(px, r); frame(px, r);
      for (let x = 3; x <= 12; x++) px(x, 3, [70, 70, 74]);                       // mantel
      each((x, y) => {
        if (x >= 4 && x <= 11 && y >= 8 && y <= 13) {                             // firebox
          if (!lit) px(x, y, jit([22, 20, 20], r, 8));
          else { const heat = (13 - y) / 5 + r() * 0.35; px(x, y, heat > 0.75 ? [255, 214, 92] : heat > 0.4 ? [246, 140, 40] : [178, 60, 24]); }
        }
        if ((y === 7 || y === 14) && x >= 3 && x <= 12) px(x, y, [60, 60, 64]);
        if ((x === 3 || x === 12) && y >= 7 && y <= 14) px(x, y, [60, 60, 64]);
      });
      for (let x = 5; x <= 10; x += 2) px(x, 5, lit ? [120, 84, 60] : [86, 86, 90]);   // vents
    };
  }
  paint('furnace_front', front(false));
  paint('furnace_front_lit', front(true));

  // Chest: planked box with dark bands and an iron latch on the front.
  const band = (px, r) => each((x, y) => { if (x === 0 || x === 15 || y === 0 || y === 15) px(x, y, jit([88, 60, 32], r, 8)); });
  paint('chest_side', (px, r) => { planksTex(px, r); band(px, r); for (let x = 0; x < 16; x++) px(x, 5, jit([88, 60, 32], r, 6)); });
  paint('chest_top', (px, r) => { planksTex(px, r); band(px, r); });
  paint('chest_front', (px, r) => {
    planksTex(px, r); band(px, r);
    for (let x = 0; x < 16; x++) px(x, 5, jit([88, 60, 32], r, 6));
    for (let y = 4; y <= 8; y++) for (let x = 7; x <= 8; x++) px(x, y, y === 4 || y === 8 ? [120, 120, 126] : [196, 196, 204]);
  });

  sprite('charcoal', SPRITES.lump, [62, 48, 40]);
})(window);
