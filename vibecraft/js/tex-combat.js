'use strict';
// Textures for creatures-and-combat content (original pixel art): wool and bed tiles, item sprites for meats, creature
// drops, the bed and armor, and the armor icons of the HUD. Creature skins are painted in mob-models.js.
(function (root) {
  const BC = root.BC;
  const T = BC.tex;
  const { paint, jit, each, planksTex } = T;
  const { clamp } = BC.util;

  // ---------------------------------------------------------------- wool
  function woolTex(px, r) {
    each((x, y) => {
      const curl = ((x + (y >> 1) * 3) % 5 === 0) ? -20 : ((x * 3 + y) % 7 === 0 ? 10 : 0);
      px(x, y, jit([234 + curl, 229 + curl, 214 + curl], r, 12));
    });
  }
  paint('wool', woolTex);

  // ---------------------------------------------------------------- beds (a full block each for the foot and the head)
  const BLANKET = [172, 58, 46], BLANKET_D = [128, 40, 34], STITCH = [228, 196, 150], SHEET = [236, 232, 222], FRAME = [132, 94, 54], FRAME_D = [90, 62, 34];
  // Top of the foot: a quilted blanket; wooden rims along the two long edges (axis z: left/right columns).
  function footTop(axis) {
    return (px, r) => each((x, y) => {
      const a = axis === 'z' ? x : y, b = axis === 'z' ? y : x;
      if (a === 0 || a === 15) return px(x, y, jit(FRAME_D, r, 8));
      let c = jit(BLANKET, r, 14);
      if ((a + b) % 6 === 0 || (a - b + 60) % 6 === 0) c = jit(STITCH, r, 10);
      if (a === 1 || a === 14) c = jit(BLANKET_D, r, 8);
      px(x, y, c);
    });
  }
  // Top of the head: sheet with a plump pillow across the bed.
  function headTop(axis) {
    return (px, r) => each((x, y) => {
      const a = axis === 'z' ? x : y, b = axis === 'z' ? y : x;
      if (a === 0 || a === 15) return px(x, y, jit(FRAME_D, r, 8));
      let c = jit(SHEET, r, 8);
      const inPillow = a >= 2 && a <= 13 && b >= 4 && b <= 11;
      if (inPillow) {
        c = jit([250, 248, 242], r, 6);
        if (a === 2 || a === 13 || b === 4 || b === 11) c = [206, 202, 196];
        if (b === 7 && a > 3 && a < 12) c = [232, 228, 220];
      }
      px(x, y, c);
    });
  }
  // Long side: blanket (foot) or sheet with a pillow bump (head) over a wooden rail and two corner legs.
  function side(part) {
    return (px, r) => each((x, y) => {
      let c;
      if (y >= 13) c = (x <= 2 || x >= 13) ? jit(FRAME_D, r, 8) : [34, 26, 22];
      else if (y >= 10) c = y === 10 ? jit(FRAME, r, 8) : jit(mix(FRAME, FRAME_D, 0.3), r, 8);
      else if (part === 'foot') c = y === 0 ? jit(mix(BLANKET, [255, 255, 255], 0.2), r, 8) : y === 9 ? jit(BLANKET_D, r, 6) : jit(BLANKET, r, 12);
      else c = y <= 3 && x >= 3 && x <= 12 ? jit([248, 246, 240], r, 6) : y === 9 ? [200, 196, 188] : jit(SHEET, r, 8);
      px(x, y, c);
    });
  }
  // Ends: a low footboard with the blanket above it, or a tall carved headboard.
  function end(part) {
    return (px, r) => {
      planksTex(px, r);
      each((x, y) => {
        if (part === 'foot' && y <= 3) return px(x, y, y === 0 ? jit(mix(BLANKET, [255, 255, 255], 0.2), r, 8) : jit(BLANKET, r, 12));
        if (x === 0 || x === 15 || y === 15 || (part === 'foot' && y === 4) || (part === 'head' && y === 0)) px(x, y, jit(FRAME_D, r, 8));
        if (part === 'head' && y >= 3 && y <= 10 && x >= 3 && x <= 12 && (x === 3 || x === 12 || y === 3 || y === 10)) px(x, y, jit(FRAME_D, r, 6));
        if (part === 'head' && y === 6 && x >= 6 && x <= 9) px(x, y, [196, 160, 100]);
      });
    };
  }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  paint('bed_foot_top_z', footTop('z')); paint('bed_foot_top_x', footTop('x'));
  paint('bed_head_top_z', headTop('z')); paint('bed_head_top_x', headTop('x'));
  paint('bed_foot_side', side('foot')); paint('bed_head_side', side('head'));
  paint('bed_foot_end', end('foot')); paint('bed_head_end', end('head'));

  // ---------------------------------------------------------------- item sprites
  // Multi-colour sprites: the slot is reserved through BC.tex.sprite (so the item atlas bookkeeping stays in textures.js),
  // then the pixels are drawn straight into the atlas cell with a free palette.
  const BLANK = new Array(16).fill('................');
  function sprite(name, rows, pal) {
    T.sprite(name, BLANK, [0, 0, 0]);
    const i = T.SPRITE[name], ctx = T.itemAtlas.getContext('2d'), ox = (i % T.SIW) * T.TS, oy = Math.floor(i / T.SIW) * T.TS;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const ch = rows[y][x], c = pal[ch]; if (ch === '.' || !c) continue;
      ctx.fillStyle = `rgb(${clamp(c[0] | 0, 0, 255)},${clamp(c[1] | 0, 0, 255)},${clamp(c[2] | 0, 0, 255)})`; ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  }
  const K = [34, 26, 22];
  // Meat cut with a fat rim and a bone end (pork and beef share the shape; mutton has a rib bone).
  const CHOP = [
    '................', '................', '.....kkkkk......', '....kffffk......', '...kfmmmmfkk....', '..kfmmMmmmmfk...', '..kfmmmmMmmmfk..', '..kfmmMmmmmmfk..',
    '...kfmmmmmMmfk..', '....kfmmmmmfk...', '.....kffffffkk..', '......kkkkkbbk..', '...........kbbk.', '............kk..', '................', '................'];
  const DRUM = [
    '................', '................', '......kkkk......', '.....kmmmmk.....', '....kmlmmmMk....', '....kmmmmmMk....', '....kmmmmMMk....', '.....kmmMMk.....',
    '......kmMk......', '.......kbk......', '.......kbbk.....', '......kbkkbk....', '.......k..k.....', '................', '................', '................'];
  const MUTTON = [
    '................', '................', '................', '...kkkkkkk......', '..kffmmmmfk.....', '..kfmmMmmmfk....', '..kfmmmmMmmfkkk.', '..kfmmMmmmmmbbbk',
    '...kfmmmmmmfkkk.', '....kffffffk....', '.....kkkkkk.....', '................', '................', '................', '................', '................'];
  const meat = (raw, fat) => ({ k: K, m: raw, M: raw.map(v => v * 0.75), l: raw.map(v => Math.min(255, v + 40)), f: fat, b: [236, 228, 208] });
  sprite('raw_pork', CHOP, meat([232, 128, 128], [248, 206, 196]));
  sprite('roast_pork', CHOP, meat([186, 116, 70], [226, 178, 120]));
  sprite('raw_beef', CHOP, meat([200, 50, 50], [240, 200, 190]));
  sprite('steak', CHOP, meat([120, 70, 44], [176, 124, 76]));
  sprite('raw_mutton', MUTTON, meat([214, 84, 84], [242, 214, 204]));
  sprite('cooked_mutton', MUTTON, meat([150, 92, 56], [206, 154, 104]));
  sprite('raw_chicken', DRUM, meat([244, 204, 180], [252, 232, 214]));
  sprite('cooked_chicken', DRUM, meat([200, 132, 64], [230, 176, 104]));
  sprite('mire_flesh', CHOP, { k: K, m: [112, 124, 78], M: [70, 84, 50], l: [150, 160, 110], f: [86, 112, 58], b: [196, 190, 150] });
  sprite('leather', [
    '................', '................', '...kk.....kk....', '..kmmk...kmmk...', '..kmmmkkkmmmk...', '...kmmmmmmmmk...', '...kmlmmmmmMk...', '..kmmmmmmmmmMk..',
    '..kmmmmMmmmmMk..', '..kmlmmmmmmmMk..', '...kmmmmmmmMk...', '...kmmMmmmmMk...', '..kmmmkkkkmmmk..', '..kkkk....kkkk..', '................', '................'],
    { k: K, m: [150, 94, 56], M: [112, 66, 36], l: [184, 124, 80] });
  sprite('feather', [
    '................', '...........kk...', '..........kwwk...'.slice(0, 16), '.........kwwlk...'.slice(0, 16), '........kwwlwk..', '.......kwwlwwk..', '......kwwlwwk...', '.....kwwlwwk....',
    '....kwwlwwk.....', '....kwlwwk......', '...kwlwwk.......', '...kslkk........', '..ks.k..........', '.ks.............', '.k..............', '................'],
    { k: [60, 60, 64], w: [244, 244, 240], l: [200, 200, 204], s: [150, 140, 120] });
  sprite('bone', [
    '................', '................', '.............kk.', '...........kkwwk', '..........kwwwwk', '.........kwwwkk.', '........kwwwk...', '.......kwwwk....',
    '......kwwwk.....', '.....kwwwk......', '....kwwwk.......', '..kkwwwk........', '.kwwwwk.........', '.kwwkk..........', '..kk............', '................'],
    { k: [90, 84, 70], w: [236, 230, 212] });
  sprite('arrow', [
    '................', '..........kkkk..', '...........hhk..', '..........hhhk..', '.........shhkk..', '........s...k...', '.......s........', '......s.........',
    '.....s..........', '....s...........', '..fs............', '.ffs............', '.ff.f...........', '..f.............', '................', '................'],
    { k: [40, 40, 44], h: [150, 150, 158], s: [140, 104, 58], f: [236, 234, 226] });
  sprite('silk', [
    '................', '................', '.....kkkkkk.....', '....kwwwwwwk....', '...kwwlwwwwwk...', '...kwlwwllwwk...', '...kwwwlwwlwk...', '...kwllwwwlwk...',
    '...kwwwlwwwwk...', '...kwwlwwlwwk...', '....kwwwwwwk.s..', '.....kkkkkkss...', '...........s....', '................', '................', '................'],
    { k: [110, 110, 118], w: [240, 238, 232], l: [204, 202, 212], s: [224, 222, 216] });
  sprite('bed', [
    '................', '................', '................', '................', '.kk.............', '.kwk............', '.kwk..........k.', '.kwppkbbbbbbbbk.',
    '.kwppbbbbbbbbbk.', '.kwwwwwwwwwwwwk.', '.kwdddddddddddk.', '.kdk.........kk.', '.kk..........kk.', '................', '................', '................'],
    { k: [40, 28, 20], w: [150, 108, 62], d: [110, 78, 44], p: [248, 246, 238], b: [176, 60, 46] });

  // Armor: four shapes, tinted per material, with an outline and a highlight.
  const ARMOR_SHAPES = {
    helmet: [
      '................', '................', '................', '....kkkkkkkk....', '...kmmllmmmmk...', '..kmllmmmmmmMk..', '..kmlmmmmmmmMk..', '..kmmkkkkkkmMk..',
      '..kmk......kMk..', '..kmk......kMk..', '..kkk......kkk..', '................', '................', '................', '................', '................'],
    chestplate: [
      '................', '..kkk......kkk..', '.kmmmkkkkkkmmMk.', '.kmlmmmmmmmmmMk.', '.kmlmmmmmmmmmMk.', '.kkkmlmmmmmmkkk.', '...kmlmmmmmMk...', '...kmmmmmmmMk...',
      '...kmlmmmmmMk...', '...kmmmmmmmMk...', '...kmmmmmmmMk...', '...kmmMMMMmMk...', '...kkkkkkkkkk...', '................', '................', '................'],
    leggings: [
      '................', '....kkkkkkkkk...', '....kmllmmmmMk..'.slice(0, 16), '....kmlmmmmmMk..', '....kmlmkkmmMk..', '....kmlk..kmMk..', '....kmlk..kmMk..', '....kmlk..kmMk..',
      '....kmmk..kmMk..', '....kmmk..kmMk..', '....kmmk..kmMk..', '....kmMk..kmMk..', '....kkkk..kkkk..', '................', '................', '................'],
    boots: [
      '................', '................', '................', '................', '................', '...kkk....kkk...', '...kmk....kmk...', '...kmk....kmk...',
      '...kmk....kmk...', '..kmlk...kmlk...', '.kmlmk..kmlmk...', '.kmmMk..kmmMk...', '.kkkkk..kkkkk...', '................', '................', '................'],
  };
  for (const mat of BC.armor.MATERIALS) {
    const c = mat.color, pal = { k: [28, 24, 22], m: c, l: c.map(v => Math.min(255, v + 44)), M: c.map(v => v * 0.62) };
    for (const piece of BC.armor.PIECES) sprite(`${mat.key}_${piece.key}`, ARMOR_SHAPES[piece.key], pal);
  }

  // ---------------------------------------------------------------- HUD armor icons (9x9 drawn at 2x, like the hearts)
  const ARMOR_ICON = ['k.kkkkk.k', 'kkllllMkk', 'kllmmmMMk', '.klmmmMk.', '.kmmmmMk.', '.kmmmmMk.', '.kmmmmMk.', '.kkkkkkk.', '.........'];
  function armorIcon(fill) {
    const c = document.createElement('canvas'); c.width = c.height = 18;
    const x = c.getContext('2d');
    const pal = { k: [26, 26, 30], m: [196, 200, 206], l: [236, 240, 244], M: [140, 144, 152] }, empty = [60, 60, 66];
    for (let yy = 0; yy < 9; yy++) for (let xx = 0; xx < 9; xx++) {
      const ch = ARMOR_ICON[yy][xx]; if (ch === '.') continue;
      let col = pal[ch];
      const on = fill === 'full' || (fill === 'half' && xx <= 4);
      if (ch !== 'k' && !on) col = empty;
      x.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`; x.fillRect(xx * 2, yy * 2, 2, 2);
    }
    return c.toDataURL();
  }
  for (const f of ['full', 'half', 'empty']) T.HUD['armor_' + f] = armorIcon(f);
  // Empty armor slot placeholders in the inventory: faint outlines of each piece.
  T.ARMOR_SLOT_ICONS = {};
  for (const piece of BC.armor.PIECES) {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d'), rows = ARMOR_SHAPES[piece.key];
    for (let yy = 0; yy < 16; yy++) for (let xx = 0; xx < 16; xx++) if (rows[yy][xx] === 'k') { x.fillStyle = 'rgba(210,214,224,0.28)'; x.fillRect(xx * 2, yy * 2, 2, 2); }
    T.ARMOR_SLOT_ICONS[piece.key] = c.toDataURL();
  }
})(window);
