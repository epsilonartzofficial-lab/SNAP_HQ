'use strict';
// Procedural textures: block atlas, item sprite atlas, block/item icons and HUD icons.
// All art is generated here from code; nothing is copied from the reference game.
(function (root) {
  const BC = root.BC;
  const { mulberry32, hashStr, clamp } = BC.util;
  const { DEFS, NB, LIQUID, faceTiles } = BC.blocks;

  const TS = 16, ATW = 8, ATH = 8;
  const atlas = document.createElement('canvas');
  atlas.width = ATW * TS; atlas.height = ATH * TS;
  const actx = atlas.getContext('2d');
  const TILE = {};
  let tileN = 0;
  function paint(name, fn) {
    const i = tileN++; TILE[name] = i;
    const ox = (i % ATW) * TS, oy = Math.floor(i / ATW) * TS;
    const r = mulberry32(hashStr(name));
    const px = (x, y, c, a = 1) => {
      if (x < 0 || y < 0 || x > 15 || y > 15) return;
      actx.fillStyle = `rgba(${clamp(c[0] | 0, 0, 255)},${clamp(c[1] | 0, 0, 255)},${clamp(c[2] | 0, 0, 255)},${a})`;
      actx.fillRect(ox + x, oy + y, 1, 1);
    };
    fn(px, r);
  }
  const jit = (c, r, v) => { const k = (r() - 0.5) * v; return [c[0] + k, c[1] + k, c[2] + k]; };
  const each = fn => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) fn(x, y); };
  const GRASS_C = [98, 164, 58];

  function dirtTex(px, r) {
    each((x, y) => { let c = jit([128, 90, 62], r, 28); const q = r(); if (q < 0.1) c = [98, 70, 48]; else if (q < 0.14) c = [152, 116, 84]; px(x, y, c); });
  }
  function stoneTex(px, r) {
    each((x, y) => px(x, y, jit([124, 124, 126], r, 22)));
    for (let k = 0; k < 7; k++) { const x0 = (r() * 16) | 0, y0 = (r() * 16) | 0, len = 2 + ((r() * 3) | 0); for (let i = 0; i < len; i++) px((x0 + i) & 15, y0, jit([100, 100, 103], r, 10)); }
  }
  function oreTex(color) {
    return (px, r) => {
      stoneTex(px, r);
      for (let k = 0; k < 4; k++) {
        const cx = 2 + ((r() * 11) | 0), cy = 2 + ((r() * 11) | 0);
        [[0,0],[1,0],[0,1],[1,1],[-1,0],[0,-1],[2,1]].forEach(([dx, dy]) => { if (r() < 0.75) px(cx + dx, cy + dy, jit(color, r, 26)); });
      }
    };
  }
  function planksTex(px, r) {
    const seams = [3, 11, 6, 14], shade = [0, -10, 6, -4];
    each((x, y) => {
      const b = y >> 2;
      if ((y & 3) === 3) return px(x, y, [118, 88, 52]);
      if (x === seams[b]) return px(x, y, [128, 96, 58]);
      let c = jit([168 + shade[b], 132 + shade[b], 80 + shade[b]], r, 14);
      if (r() < 0.07) c = [c[0] - 18, c[1] - 16, c[2] - 10];
      px(x, y, c);
    });
  }

  // ---- v0.1 block tiles (painted in the same order with the same names, so they look identical)
  paint('grass_top', (px, r) => each((x, y) => { let c = jit(GRASS_C, r, 30); if (r() < 0.14) c = [c[0] - 22, c[1] - 28, c[2] - 12]; px(x, y, c); }));
  paint('grass_side', (px, r) => { dirtTex(px, r); for (let x = 0; x < 16; x++) { const d = 3 + (r() < 0.5 ? 1 : 0) + (r() < 0.25 ? 1 : 0); for (let y = 0; y < d; y++) px(x, y, jit(GRASS_C, r, 30)); } });
  paint('dirt', dirtTex);
  paint('stone', stoneTex);
  paint('cobble', (px, r) => {
    const pts = []; for (let i = 0; i < 9; i++) pts.push([r() * 16, r() * 16, 92 + r() * 52]);
    each((x, y) => {
      let d1 = 1e9, d2 = 1e9, s = 0;
      for (const p of pts) {
        let dx = Math.abs(x + 0.5 - p[0]), dy = Math.abs(y + 0.5 - p[1]);
        dx = Math.min(dx, 16 - dx); dy = Math.min(dy, 16 - dy);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) { d2 = d1; d1 = d; s = p[2]; } else if (d < d2) d2 = d;
      }
      px(x, y, d2 - d1 < 1.1 ? jit([66, 66, 70], r, 10) : jit([s, s, s + 3], r, 14));
    });
  });
  paint('sand', (px, r) => each((x, y) => px(x, y, r() < 0.08 ? [194, 178, 128] : jit([220, 208, 160], r, 16))));
  paint('log_side', (px, r) => {
    const cols = []; for (let x = 0; x < 16; x++) cols.push((r() - 0.5) * 22);
    each((x, y) => { const k = cols[x]; let c = jit([104 + k, 80 + k, 50 + k], r, 12); if ((x + (y >> 2)) % 5 === 0) c = [c[0] - 20, c[1] - 16, c[2] - 10]; px(x, y, c); });
  });
  paint('log_top', (px, r) => each((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    px(x, y, d > 6.5 ? jit([96, 74, 46], r, 14) : jit(Math.floor(d) % 2 ? [182, 146, 92] : [158, 124, 76], r, 10));
  }));
  paint('leaves', (px, r) => each((x, y) => { if (r() < 0.17) return; let c = jit([58, 128, 40], r, 36); if (r() < 0.16) c = [36, 92, 28]; px(x, y, c); }));
  paint('planks', planksTex);
  paint('glass', (px) => each((x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) px(x, y, [212, 234, 242]);
    else if ((x + y === 11 && x > 2 && x < 9) || (x + y === 15 && x > 7 && x < 11)) px(x, y, [244, 250, 255], 0.9);
  }));
  paint('water', (px, r) => each((x, y) => px(x, y, (x + y * 3) % 11 < 2 ? jit([74, 124, 222], r, 10) : jit([44, 92, 196], r, 14))));
  paint('bedrock', (px, r) => each((x, y) => { const q = r(); px(x, y, jit(q < 0.33 ? [40, 40, 42] : q < 0.66 ? [82, 82, 84] : [122, 122, 124], r, 10)); }));
  paint('snow', (px, r) => each((x, y) => px(x, y, jit([238, 244, 250], r, 10))));
  paint('snow_side', (px, r) => { dirtTex(px, r); for (let x = 0; x < 16; x++) { const d = 3 + (r() < 0.5 ? 1 : 0) + (r() < 0.3 ? 1 : 0); for (let y = 0; y < d; y++) px(x, y, jit([238, 244, 250], r, 10)); } });
  paint('brick', (px, r) => each((x, y) => {
    const off = ((y >> 2) & 1) * 4;
    if ((y & 3) === 3 || ((x + off) & 7) === 7) px(x, y, jit([178, 170, 158], r, 10));
    else px(x, y, jit([152, 66, 48], r, 22));
  }));
  paint('coal', oreTex([30, 30, 32]));
  paint('iron', oreTex([216, 174, 138]));
  paint('gold', oreTex([250, 214, 70]));
  paint('diamond', oreTex([92, 228, 224]));
  paint('cactus_side', (px, r) => each((x, y) => {
    let c = jit([64, 134, 48], r, 14);
    if (x === 2 || x === 7 || x === 12) c = [44, 104, 34];
    if (x === 0 || x === 15) c = [38, 88, 30];
    if (x % 5 === 1 && (y * 7 + x) % 4 === 0) c = [214, 222, 176];
    px(x, y, c);
  }));
  paint('cactus_top', (px, r) => each((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    px(x, y, d > 6.5 ? [40, 92, 30] : d < 2 ? jit([120, 180, 90], r, 10) : jit([82, 152, 62], r, 14));
  }));
  paint('stone_bricks', (px, r) => each((x, y) => {
    const top = y < 8, lx = top ? x : (x + 8) & 15, ly = y & 7;
    if (ly === 7 || lx === 15) return px(x, y, jit([84, 84, 88], r, 8));
    let c = jit([128, 128, 131], r, 14);
    if (ly === 0 || lx === 0) c = [c[0] + 18, c[1] + 18, c[2] + 18];
    if (ly === 6 || lx === 14) c = [c[0] - 16, c[1] - 16, c[2] - 16];
    px(x, y, c);
  }));

  // ---- new tiles
  paint('table_top', (px, r) => {
    planksTex(px, r);
    each((x, y) => {
      if (x === 0 || y === 0 || x === 15 || y === 15) px(x, y, [92, 64, 34]);
      else if (x === 1 || y === 1 || x === 14 || y === 14) px(x, y, [132, 98, 56]);
      else if ((x === 5 || x === 10 || y === 5 || y === 10)) px(x, y, [104, 76, 42]);
    });
  });
  paint('table_side', (px, r) => {
    planksTex(px, r);
    each((x, y) => {
      if (y <= 2) px(x, y, y === 2 ? [92, 64, 34] : jit([146, 110, 64], r, 10));
      if ((x === 2 || x === 13) && y > 2) px(x, y, jit([110, 80, 44], r, 8));
    });
    // a hanging saw
    for (let x = 5; x <= 10; x++) px(x, 6, [196, 196, 200]);
    for (let x = 5; x <= 10; x += 2) px(x, 7, [150, 150, 156]);
    px(11, 6, [96, 70, 40]); px(12, 6, [96, 70, 40]);
  });
  paint('table_front', (px, r) => {
    planksTex(px, r);
    each((x, y) => {
      if (y <= 2) px(x, y, y === 2 ? [92, 64, 34] : jit([146, 110, 64], r, 10));
      if ((x === 2 || x === 13) && y > 2) px(x, y, jit([110, 80, 44], r, 8));
    });
    // hammer and tongs
    for (let y = 5; y <= 12; y++) px(6, y, [100, 72, 40]);
    for (let x = 4; x <= 8; x++) { px(x, 4, [120, 120, 126]); px(x, 5, [150, 150, 156]); }
    for (let i = 0; i < 6; i++) { px(9 + (i >> 1), 6 + i, [70, 70, 76]); px(12 - (i >> 1), 6 + i, [70, 70, 76]); }
  });
  // mining cracks: 10 stages drawn from the same set of crack paths, each stage extending them
  {
    const r = mulberry32(777), paths = [];
    for (let k = 0; k < 9; k++) {
      let x = 5 + r() * 6, y = 5 + r() * 6; const pts = [];
      const a0 = r() * Math.PI * 2;
      for (let s = 0; s < 14; s++) { pts.push([x | 0, y | 0]); const a = a0 + (r() - 0.5) * 1.6; x += Math.cos(a); y += Math.sin(a); }
      paths.push(pts);
    }
    for (let st = 0; st < 10; st++) paint('crack_' + st, (px) => {
      const nPaths = 2 + Math.floor(st * 0.8), len = 3 + st;
      for (let k = 0; k < Math.min(paths.length, nPaths); k++) for (let s = 0; s < Math.min(len, 14); s++) {
        const [x, y] = paths[k][s]; px(x, y, [20, 20, 20], 0.72); if (st > 5) px(x + 1, y, [40, 40, 40], 0.4);
      }
    });
  }

  const BTEX = [];
  for (let id = 1; id < NB; id++) BTEX[id] = faceTiles(id).map(n => { if (TILE[n] == null) throw new Error('missing tile ' + n); return TILE[n]; });

  // ---- item sprites (16x16 pixel art from character maps)
  const SPRITES = {
    stick: [
      '................', '................', '................', '...........kk...', '..........kwk...', '.........kwk....', '........kwk.....', '.......kwk......',
      '......kwk.......', '.....kwk........', '....kwk.........', '...kwk..........', '...kk...........', '................', '................', '................'],
    pickaxe: [
      '................', '.....kkkkk......', '....kmmmmmkk....', '....klllkkmmk...', '.....kkkkwlmmk..', '.......kwk.kmk..', '......kwk..kmk..', '.....kwk....kmk.',
      '....kwk.....kmk.', '...kwk.......kk.', '..kwk...........', '.kwk............', '.kk.............', '................', '................', '................'],
    axe: [
      '................', '........kkk.....', '.......kmmmk....', '......kmllmmk...', '......kmlmmwk...', '.......kmmwk....', '........kwk.....', '.......kwk......',
      '......kwk.......', '.....kwk........', '....kwk.........', '...kwk..........', '..kwk...........', '..kk............', '................', '................'],
    shovel: [
      '................', '...........kk...', '..........kmmk..', '.........kmllmk.', '.........kmlmmk.', '..........kmmk..', '.........kwkk...', '........kwk.....',
      '.......kwk......', '......kwk.......', '.....kwk........', '..kkkwk.........', '..kwwk..........', '..kwk...........', '..kk............', '................'],
    sword: [
      '................', '............kkk.', '...........kllk.', '..........klmk..', '.........klmk...', '........klmk....', '.......klmk.....', '..kk..klmk......',
      '..kmkklmk.......', '...kmlmk........', '....kmk.........', '...kwkmk........', '..kwk.kk........', '.kwk............', '.kk.............', '................'],
    lump: [
      '................', '................', '................', '................', '......kkkk......', '....kkmmmmkk....', '...kmmlmmmmmk...', '...kmlmmmMmmk...',
      '..kmmmmMmmmmmk..', '..kmmMmmmmlmmk..', '...kmmmmmMmmk...', '...kkmmmmmmkk...', '.....kkkkkk.....', '................', '................', '................'],
    ingot: [
      '................', '................', '................', '................', '................', '................', '.....kkkkkkkk...', '....kllllllllk..',
      '...klmmmmmmmlk..', '..kmmmmmmmmmk...', '..kMMMMMMMMk....', '..kkkkkkkkk.....', '................', '................', '................', '................'],
    gem: [
      '................', '................', '................', '......kkkk......', '.....kllmmk.....', '....klmlmmmk....', '...klmmmmmmmk...', '...kmmmmmmmMk...',
      '....kmmmmmMk....', '.....kmmmMk.....', '......kmMk......', '.......kk.......', '................', '................', '................', '................'],
    apple: [
      '................', '................', '........d.......', '.......d.gg.....', '....kkkdkggk....', '...kmmmmmmmk....', '..kmllmmmmmmk...', '..kmlmmmmmmmk...',
      '..kmmmmmmmmMk...', '..kmmmmmmmmMk...', '...kmmmmmmMk....', '...kmmMMmmMk....', '....kkk.kkk.....', '................', '................', '................'],
  };
  const SIW = 16, SIH = 4;
  const itemAtlas = document.createElement('canvas');
  itemAtlas.width = SIW * TS; itemAtlas.height = SIH * TS;
  const ictx = itemAtlas.getContext('2d');
  const SPRITE = {};
  let spriteN = 0;
  const shade = (c, k) => c.map(v => clamp(Math.round(v + k), 0, 255));
  function drawSprite(name, map, mat) {
    const i = spriteN++; SPRITE[name] = i;
    const ox = (i % SIW) * TS, oy = Math.floor(i / SIW) * TS;
    const pal = { k: [34, 26, 22], w: [140, 104, 58], d: [98, 70, 38], g: [70, 150, 50], m: mat, l: shade(mat, 48), M: shade(mat, -42) };
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const ch = map[y][x]; if (ch === '.' || !pal[ch]) continue;
      const c = pal[ch]; ictx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ictx.fillRect(ox + x, oy + y, 1, 1);
    }
  }
  drawSprite('stick', SPRITES.stick, [140, 104, 58]);
  drawSprite('coal', SPRITES.lump, [48, 48, 52]);
  drawSprite('raw_iron', SPRITES.lump, [206, 170, 140]);
  drawSprite('iron_ingot', SPRITES.ingot, [214, 214, 210]);
  drawSprite('raw_gold', SPRITES.lump, [232, 186, 52]);
  drawSprite('gold_ingot', SPRITES.ingot, [246, 206, 62]);
  drawSprite('diamond_gem', SPRITES.gem, [86, 214, 206]);
  drawSprite('apple', SPRITES.apple, [212, 40, 40]);
  const IT = BC.items;
  for (const d of IT.all()) if (d.tool) drawSprite(d.key, SPRITES[d.tool.type], d.tint);
  function spriteIndex(itemId) { const d = IT.get(itemId); if (!d || d.kind === 'block') return -1; const k = d.tool ? d.key : d.sprite; return SPRITE[k]; }

  // ---- icons
  function blockIconCanvas(id) {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    const t = BTEX[id];
    const face = (tile, m, dark) => {
      x.setTransform(...m);
      x.globalCompositeOperation = 'source-over';
      x.drawImage(atlas, (tile % ATW) * TS, Math.floor(tile / ATW) * TS, TS, TS, 0, 0, 16, 16);
      if (dark) { x.globalCompositeOperation = 'source-atop'; x.fillStyle = `rgba(0,0,0,${dark})`; x.fillRect(0, 0, 16, 16); }
    };
    x.globalAlpha = LIQUID[id] ? 0.85 : 1;
    face(t[0], [14 / 16, 7 / 16, 0, 14 / 16, 2, 9], 0.28);
    face(t[5], [14 / 16, -7 / 16, 0, 14 / 16, 16, 16], 0.42);
    face(t[3], [14 / 16, 7 / 16, -14 / 16, 7 / 16, 16, 2], 0);
    return c;
  }
  function spriteCanvas(i, size) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    x.drawImage(itemAtlas, (i % SIW) * TS, Math.floor(i / SIW) * TS, TS, TS, 0, 0, size, size);
    return c;
  }
  const iconCache = new Map();
  function iconURL(itemId) {
    if (iconCache.has(itemId)) return iconCache.get(itemId);
    const d = IT.get(itemId); let url = '';
    if (d) url = (d.kind === 'block' ? blockIconCanvas(d.block) : spriteCanvas(spriteIndex(itemId), 32)).toDataURL();
    iconCache.set(itemId, url);
    return url;
  }
  function tileURL(name, scale = 4) {
    const c = document.createElement('canvas'); c.width = c.height = TS * scale;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    const i = TILE[name];
    x.drawImage(atlas, (i % ATW) * TS, Math.floor(i / ATW) * TS, TS, TS, 0, 0, TS * scale, TS * scale);
    return c.toDataURL();
  }

  // HUD icons (9x9 maps, drawn at 2x). Full, half and empty variants.
  const HUD_MAPS = {
    heart: ['.kk...kk.', 'kRRk.kRRk', 'kRlRkRRRk', 'kRRRRRRRk', 'kRRRRRRRk', '.kRRRRRk.', '..kRRRk..', '...kRk...', '....k....'],
    food: ['....kkk..', '...kbbbk.', '..kbbbbbk', '..kblbbbk', '..kbbbbk.', '.kwkkkk..', 'kwk......', 'kk.......', '.........'],
    bubble: ['..kkkkk..', '.kllcccck', 'klcccccck', 'klcccccck', 'kccccccck', 'kccccccck', '.kcccccck', '..kkkkkk.', '.........'],
  };
  function hudIcon(kind, fill) {
    const map = HUD_MAPS[kind], c = document.createElement('canvas'); c.width = c.height = 18;
    const x = c.getContext('2d');
    const pal = { k: [28, 12, 12], R: [214, 36, 36], l: [255, 170, 170], b: [170, 104, 52], w: [236, 228, 210], c: [70, 150, 240] };
    const empty = [58, 40, 40];
    for (let yy = 0; yy < 9; yy++) for (let xx = 0; xx < 9; xx++) {
      const ch = map[yy][xx]; if (ch === '.') continue;
      let col = pal[ch];
      const filledPart = fill === 'full' || (fill === 'half' && (kind === 'food' ? xx >= 4 : xx <= 4));
      if (ch !== 'k' && !filledPart) col = empty;
      x.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`; x.fillRect(xx * 2, yy * 2, 2, 2);
    }
    return c.toDataURL();
  }
  const HUD = {};
  for (const k of ['heart', 'food']) for (const f of ['full', 'half', 'empty']) HUD[k + '_' + f] = hudIcon(k, f);
  HUD.bubble = hudIcon('bubble', 'full');

  // Average colour per atlas tile, for break particles.
  const TILE_AVG = [];
  {
    const img = actx.getImageData(0, 0, atlas.width, atlas.height).data;
    for (let i = 0; i < tileN; i++) {
      const ox = (i % ATW) * TS, oy = Math.floor(i / ATW) * TS; let r = 0, g = 0, b = 0, n = 0;
      for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) { const o = ((oy + y) * atlas.width + ox + x) * 4; if (img[o + 3] > 128) { r += img[o]; g += img[o + 1]; b += img[o + 2]; n++; } }
      TILE_AVG[i] = n ? [r / n / 255, g / n / 255, b / n / 255] : [1, 1, 1];
    }
  }

  BC.tex = { TS, ATW, ATH, SIW, SIH, atlas, itemAtlas, TILE, BTEX, SPRITE, spriteIndex, iconURL, tileURL, HUD, TILE_AVG };
})(window);
