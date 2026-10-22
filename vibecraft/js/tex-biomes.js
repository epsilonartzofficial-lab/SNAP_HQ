'use strict';
// Textures for biome blocks (blocks-biomes.js). 16x16 pixel art drawn from code in the style of textures.js:
// a base colour with subtle per-pixel noise and a few darker or lighter details. All art is original.
(function (root) {
  const BC = root.BC;
  const T = BC.tex;
  const { jit, each, dirtTex } = T;

  // Tile names are prefixed bm_ so they cannot collide with other workstreams; skip any that already exist.
  const paint = (name, fn) => { if (T.TILE[name] == null) T.paint(name, fn); };
  const shade = (c, k) => [c[0] + k, c[1] + k, c[2] + k];

  // ---- generic painters
  // Speckled fill: base colour with noise, plus [colour, probability] speckles.
  const speckle = (base, v, spots) => (px, r) => each((x, y) => {
    let c = jit(base, r, v);
    const q = r(); let acc = 0;
    for (const [sc, p] of spots || []) { acc += p; if (q < acc) { c = jit(sc, r, v * 0.5); break; } }
    px(x, y, c);
  });
  // Grass-like top: base colour with darker tufts.
  const grassTop = (base, dark) => (px, r) => each((x, y) => {
    let c = jit(base, r, 28);
    const q = r();
    if (q < 0.14) c = jit(dark, r, 12); else if (q < 0.2) c = shade(c, 14);
    px(x, y, c);
  });
  // Side of a soil block with a coloured top fringe (grass, podzol).
  const fringeSide = (top, v) => (px, r) => {
    dirtTex(px, r);
    for (let x = 0; x < 16; x++) {
      const d = 3 + (r() < 0.5 ? 1 : 0) + (r() < 0.25 ? 1 : 0);
      for (let y = 0; y < d; y++) px(x, y, jit(top, r, v));
    }
  };
  // Voronoi cobble with an optional moss overlay.
  const cobble = (moss) => (px, r) => {
    const pts = []; for (let i = 0; i < 10; i++) pts.push([r() * 16, r() * 16, 94 + r() * 46]);
    const mossMask = []; for (let i = 0; i < 5; i++) mossMask.push([r() * 16, r() * 16, 2.5 + r() * 3.5]);
    each((x, y) => {
      let d1 = 1e9, d2 = 1e9, s = 0;
      for (const p of pts) {
        let dx = Math.abs(x + 0.5 - p[0]), dy = Math.abs(y + 0.5 - p[1]);
        dx = Math.min(dx, 16 - dx); dy = Math.min(dy, 16 - dy);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) { d2 = d1; d1 = d; s = p[2]; } else if (d < d2) d2 = d;
      }
      let c = d2 - d1 < 1.1 ? jit([64, 64, 68], r, 10) : jit([s, s, s + 3], r, 14);
      if (moss) {
        let m = 0;
        for (const [mx, my, mr] of mossMask) { let dx = Math.abs(x + 0.5 - mx), dy = Math.abs(y + 0.5 - my); dx = Math.min(dx, 16 - dx); dy = Math.min(dy, 16 - dy); if (dx * dx + dy * dy < mr * mr) m = 1; }
        if (m && r() < 0.85) c = jit(r() < 0.3 ? [58, 96, 38] : [84, 124, 50], r, 18);
      }
      px(x, y, c);
    });
  };
  // Layered stone (sandstone sides): horizontal strata with a lighter top band.
  const strata = (base) => (px, r) => each((x, y) => {
    let c = jit(base, r, 10);
    if (y < 3) c = shade(c, 12);
    else if (y === 3 || y === 11) c = shade(c, -18);
    else if (y > 11) c = shade(c, -6);
    if (r() < 0.06) c = shade(c, -12);
    px(x, y, c);
  });
  const smoothTop = (base) => (px, r) => each((x, y) => {
    let c = jit(base, r, 9);
    if (x === 0 || y === 0) c = shade(c, 8); else if (x === 15 || y === 15) c = shade(c, -10);
    if (r() < 0.05) c = shade(c, -12);
    px(x, y, c);
  });
  // Log side: vertical bark with per-column tone and grooves.
  const barkSide = (base, groove, extra) => (px, r) => {
    const cols = []; for (let x = 0; x < 16; x++) cols.push((r() - 0.5) * 20);
    each((x, y) => {
      const k = cols[x];
      let c = jit([base[0] + k, base[1] + k, base[2] + k], r, 10);
      if ((x + (y >> 2)) % 5 === 0) c = jit(groove, r, 8);
      px(x, y, c);
    });
    if (extra) extra(px, r);
  };
  // Log top: growth rings inside a bark rim.
  const ringTop = (bark, a, b) => (px, r) => each((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    px(x, y, d > 6.5 ? jit(bark, r, 12) : jit(Math.floor(d) % 2 ? a : b, r, 9));
  });
  // Leaves: clumps with holes (cutout), a dark shade and a light shade.
  const leaves = (base, dark, holes, light) => (px, r) => each((x, y) => {
    if (r() < holes) return;
    let c = jit(base, r, 30);
    const q = r();
    if (q < 0.18) c = jit(dark, r, 10); else if (light && q < 0.26) c = jit(light, r, 10);
    px(x, y, c);
  });
  // Planks: four boards with seams, in a species colour.
  const planks = (base) => (px, r) => {
    const seams = [3, 11, 6, 14], sh = [0, -10, 6, -4];
    each((x, y) => {
      const b = y >> 2;
      if ((y & 3) === 3) return px(x, y, shade(base, -46));
      if (x === seams[b]) return px(x, y, shade(base, -36));
      let c = jit(shade(base, sh[b]), r, 14);
      if (r() < 0.07) c = shade(c, -16);
      px(x, y, c);
    });
  };

  // ---- ground and sediments
  paint('bm_gravel', (px, r) => each((x, y) => {
    const q = r();
    const c = q < 0.3 ? [132, 128, 126] : q < 0.55 ? [104, 100, 98] : q < 0.72 ? [152, 148, 144] : q < 0.86 ? [118, 106, 96] : [82, 78, 78];
    px(x, y, jit(c, r, 12));
  }));
  paint('bm_clay', (px, r) => each((x, y) => {
    let c = jit([158, 164, 178], r, 10);
    if ((x * 3 + y * 7) % 13 === 0 && r() < 0.6) c = shade(c, 10);
    if (r() < 0.05) c = shade(c, -14);
    px(x, y, c);
  }));
  paint('bm_coarse_dirt', (px, r) => {
    dirtTex(px, r);
    each((x, y) => { const q = r(); if (q < 0.16) px(x, y, jit([118, 108, 98], r, 16)); else if (q < 0.22) px(x, y, jit([84, 60, 42], r, 10)); });
  });
  paint('bm_podzol_top', (px, r) => {
    each((x, y) => px(x, y, jit([122, 86, 46], r, 20)));
    for (let k = 0; k < 40; k++) {
      const x0 = (r() * 16) | 0, y0 = (r() * 16) | 0, dx = r() < 0.5 ? 1 : -1, c = r() < 0.5 ? [88, 58, 30] : [156, 114, 62];
      for (let i = 0; i < 3; i++) px((x0 + i * dx) & 15, (y0 + i) & 15, jit(c, r, 12));
    }
  });
  paint('bm_podzol_side', fringeSide([118, 82, 44], 22));
  paint('bm_mud', speckle([76, 64, 60], 14, [[[58, 50, 48], 0.18], [[102, 92, 88], 0.06]]));
  paint('bm_moss', (px, r) => each((x, y) => {
    let c = jit([86, 128, 44], r, 26);
    const q = r();
    if (q < 0.2) c = jit([60, 98, 34], r, 10); else if (q < 0.3) c = jit([112, 152, 58], r, 10);
    if (((x >> 1) + (y >> 1)) % 3 === 0 && r() < 0.3) c = shade(c, -12);
    px(x, y, c);
  }));
  paint('bm_dry_grass_top', grassTop([170, 162, 86], [138, 126, 62]));
  paint('bm_dry_grass_side', fringeSide([168, 158, 84], 26));
  paint('bm_lush_grass_top', grassTop([58, 150, 50], [36, 114, 34]));
  paint('bm_lush_grass_side', fringeSide([58, 148, 50], 26));
  paint('bm_red_sand', (px, r) => each((x, y) => px(x, y, r() < 0.09 ? jit([158, 82, 40], r, 10) : jit([192, 106, 54], r, 16))));
  paint('bm_sandstone_top', smoothTop([216, 202, 150]));
  paint('bm_sandstone_side', strata([208, 192, 140]));
  paint('bm_red_sandstone_top', smoothTop([184, 100, 50]));
  paint('bm_red_sandstone_side', strata([176, 94, 46]));

  // ---- terracotta bands: flat fired clay with faint speckles
  const terracotta = base => (px, r) => each((x, y) => {
    let c = jit(base, r, 8);
    if (r() < 0.06) c = shade(c, r() < 0.5 ? -12 : 10);
    px(x, y, c);
  });
  paint('bm_terracotta', terracotta([154, 94, 68]));
  paint('bm_terracotta_white', terracotta([212, 182, 164]));
  paint('bm_terracotta_yellow', terracotta([188, 136, 56]));
  paint('bm_terracotta_orange', terracotta([164, 86, 40]));
  paint('bm_terracotta_red', terracotta([144, 62, 48]));
  paint('bm_terracotta_brown', terracotta([98, 66, 48]));

  // ---- ice
  paint('bm_ice', (px, r) => each((x, y) => {
    let c = jit([146, 186, 238], r, 10);
    if ((x + y) % 9 === 0 || (x - y + 16) % 13 === 0) c = [206, 226, 252];
    px(x, y, c);
  }));
  paint('bm_packed_ice', (px, r) => {
    each((x, y) => px(x, y, jit([164, 194, 234], r, 8)));
    for (let k = 0; k < 5; k++) { let x = r() * 16, y = r() * 16; const a = r() * 6.28, dx = Math.cos(a), dy = Math.sin(a); for (let i = 0; i < 6; i++) { px(x | 0, y | 0, [214, 232, 252]); x += dx; y += dy; } }
  });

  // ---- regional rock
  paint('bm_granite', speckle([152, 104, 86], 18, [[[192, 152, 132], 0.12], [[108, 74, 62], 0.1], [[206, 196, 196], 0.04]]));
  paint('bm_limestone', (px, r) => {
    each((x, y) => { let c = jit([198, 190, 162], r, 12); if (r() < 0.08) c = jit([170, 160, 132], r, 8); px(x, y, c); });
    // a small fossil shell
    const cx = 4 + ((r() * 8) | 0), cy = 4 + ((r() * 8) | 0);
    [[0, 0], [1, 0], [2, 1], [2, 2], [1, 3], [0, 3], [-1, 2], [-1, 1]].forEach(([dx, dy]) => px(cx + dx, cy + dy, [164, 152, 122]));
  });
  paint('bm_slate', (px, r) => each((x, y) => {
    let c = jit([72, 76, 86], r, 10);
    if (y % 4 === 0) c = shade(c, -10); else if (y % 4 === 1 && r() < 0.4) c = shade(c, 12);
    if (r() < 0.04) c = jit([104, 108, 118], r, 8);
    px(x, y, c);
  }));
  paint('bm_mossy_cobble', cobble(true));

  // ---- woods
  paint('bm_spruce_log', barkSide([72, 52, 34], [50, 36, 24]));
  paint('bm_spruce_log_top', ringTop([66, 48, 30], [150, 112, 70], [126, 92, 56]));
  paint('bm_spruce_leaves', leaves([46, 90, 62], [30, 64, 44], 0.14, [66, 112, 78]));
  paint('bm_spruce_planks', planks([120, 88, 54]));
  paint('bm_birch_log', (px, r) => {
    each((x, y) => px(x, y, jit([214, 212, 202], r, 10)));
    for (let k = 0; k < 9; k++) {
      const y = (r() * 16) | 0, x0 = (r() * 16) | 0, len = 2 + ((r() * 4) | 0);
      for (let i = 0; i < len; i++) px((x0 + i) & 15, y, jit([44, 42, 38], r, 10));
    }
    each((x, y) => { if (r() < 0.03) px(x, y, [170, 166, 156]); });
  });
  paint('bm_birch_log_top', ringTop([214, 212, 202], [198, 174, 122], [180, 154, 104]));
  paint('bm_birch_leaves', leaves([112, 162, 72], [84, 130, 52], 0.18, [140, 184, 92]));
  paint('bm_birch_planks', planks([208, 188, 134]));
  paint('bm_acacia_log', barkSide([110, 102, 92], [80, 74, 66]));
  paint('bm_acacia_log_top', ringTop([104, 96, 86], [190, 100, 54], [168, 84, 44]));
  paint('bm_acacia_leaves', leaves([106, 130, 48], [80, 102, 36], 0.22, [132, 152, 62]));
  paint('bm_acacia_planks', planks([180, 98, 58]));
  paint('bm_mahogany_log', barkSide([100, 62, 42], [74, 44, 30], (px, r) => {
    for (let k = 0; k < 6; k++) { const x = (r() * 16) | 0, y = (r() * 16) | 0; px(x, y, [78, 104, 46]); px(x, (y + 1) & 15, [66, 94, 40]); }
  }));
  paint('bm_mahogany_log_top', ringTop([96, 58, 40], [172, 96, 66], [150, 80, 54]));
  paint('bm_mahogany_leaves', (px, r) => {
    // broad leaves: 2x2 clumps with a darker vein
    for (let by = 0; by < 16; by += 2) for (let bx = 0; bx < 16; bx += 2) {
      if (r() < 0.12) continue;
      const c = jit(r() < 0.25 ? [26, 98, 28] : [40, 132, 36], r, 26);
      px(bx, by, c); px(bx + 1, by, shade(c, 10)); px(bx, by + 1, shade(c, -8)); px(bx + 1, by + 1, shade(c, -18));
    }
  });
  paint('bm_mahogany_planks', planks([140, 72, 52]));
  paint('bm_willow_log', barkSide([98, 90, 72], [70, 64, 50]));
  paint('bm_willow_log_top', ringTop([92, 84, 66], [178, 162, 112], [156, 140, 94]));
  paint('bm_willow_leaves', (px, r) => {
    // hanging strands: vertical runs with gaps between them
    for (let x = 0; x < 16; x++) {
      const gap = r() < 0.3;
      for (let y = 0; y < 16; y++) {
        if (gap && r() < 0.7) continue;
        if (r() < 0.1) continue;
        let c = jit([118, 150, 88], r, 24);
        if (r() < 0.2) c = jit([92, 122, 68], r, 10);
        px(x, y, c);
      }
    }
  });
  paint('bm_willow_planks', planks([170, 152, 110]));

  // ---- plants (transparent background)
  const blade = (px, r, x, h, c, lean) => { let fx = x; for (let i = 0; i < h; i++) { px(Math.round(fx), 15 - i, jit(c, r, 18)); fx += lean * (i / h); } };
  paint('bm_tall_grass', (px, r) => {
    for (let k = 0; k < 9; k++) blade(px, r, 1 + ((r() * 14) | 0), 6 + ((r() * 9) | 0), r() < 0.3 ? [72, 128, 48] : [96, 158, 62], (r() - 0.5) * 3);
  });
  paint('bm_fern', (px, r) => {
    for (const [x0, lean] of [[4, -2], [8, 0], [11, 2]]) {
      let fx = x0;
      for (let i = 0; i < 13; i++) {
        const y = 15 - i, x = Math.round(fx);
        px(x, y, [50, 110, 48]);
        if (i > 2 && i % 2 === 0) { px(x - 1, y, jit([64, 136, 58], r, 16)); px(x + 1, y, jit([64, 136, 58], r, 16)); if (i < 10) { px(x - 2, y + 1, jit([74, 146, 64], r, 16)); px(x + 2, y + 1, jit([74, 146, 64], r, 16)); } }
        fx += lean / 13;
      }
    }
  });
  paint('bm_dry_shrub', (px, r) => {
    const twig = (x, y, dx, n) => { for (let i = 0; i < n; i++) { px(x, y, jit([128, 94, 56], r, 16)); x += dx; y -= 1; if (r() < 0.35) dx = -dx; } };
    twig(8, 15, 0, 4); twig(8, 11, -1, 5); twig(8, 11, 1, 5); twig(7, 9, -1, 4); twig(9, 8, 1, 4); twig(6, 13, -1, 3); twig(10, 13, 1, 3);
  });
  const flower = (head, center, stemH) => (px, r) => {
    for (let i = 0; i < stemH; i++) px(8, 15 - i, jit([62, 120, 44], r, 12));
    px(7, 12, [70, 134, 50]); px(6, 11, [70, 134, 50]); px(9, 13, [70, 134, 50]); px(10, 12, [70, 134, 50]);
    const ty = 15 - stemH;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1], [-2, 0], [2, 0], [0, -2]]) px(8 + dx, ty + dy, jit(head, r, 20));
    px(8, ty, center);
  };
  paint('bm_poppy', flower([214, 40, 36], [40, 24, 20], 8));
  paint('bm_buttercup', flower([242, 212, 48], [200, 150, 30], 7));
  paint('bm_bluebell', (px, r) => {
    for (let i = 0; i < 9; i++) px(7 + (i > 5 ? 1 : 0), 15 - i, jit([62, 120, 44], r, 12));
    for (const [x, y] of [[9, 6], [10, 8], [6, 8], [8, 10], [5, 11]]) { px(x, y, jit([84, 112, 222], r, 18)); px(x, y + 1, jit([70, 92, 200], r, 18)); px(x - 1, y + 1, jit([96, 126, 232], r, 14)); }
  });
  paint('bm_lavender', (px, r) => {
    for (const x of [5, 8, 11]) {
      const h = 9 + ((r() * 4) | 0);
      for (let i = 0; i < h; i++) px(x, 15 - i, i < h - 5 ? jit([80, 124, 64], r, 12) : jit(r() < 0.5 ? [150, 108, 204] : [124, 86, 184], r, 16));
      for (let i = h - 5; i < h; i += 2) { px(x - 1, 15 - i, jit([160, 122, 214], r, 14)); px(x + 1, 15 - i, jit([160, 122, 214], r, 14)); }
    }
  });
  paint('bm_cotton_grass', (px, r) => {
    for (const x of [3, 6, 9, 12]) {
      const h = 8 + ((r() * 5) | 0);
      for (let i = 0; i < h; i++) px(x + (i > h - 3 ? 1 : 0), 15 - i, jit([110, 140, 70], r, 14));
      const tx = x + 1, ty = 15 - h;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, -1], [1, -1], [-1, 0], [0, 1]]) px(tx + dx, ty + dy, jit([242, 242, 236], r, 8));
    }
  });
  paint('bm_reeds', (px, r) => {
    for (const x of [3, 7, 10, 13]) {
      const h = 11 + ((r() * 5) | 0);
      for (let i = 0; i < h; i++) px(x, 15 - i, jit([118, 150, 68], r, 16));
      if (r() < 0.75) for (let i = h - 5; i < h - 1; i++) { px(x, 15 - i, jit([112, 70, 40], r, 10)); px(x + 1, 15 - i, jit([96, 60, 34], r, 10)); }
      px(x - 1, 15 - ((r() * 6) | 0) - 2, [132, 168, 80]);
    }
  });
  paint('bm_berry_bush', (px, r) => {
    each((x, y) => {
      const dx = x - 7.5, dy = (y - 9.5) * 1.3;
      if (dx * dx + dy * dy > 44 || r() < 0.12) return;
      let c = jit([58, 108, 48], r, 24);
      if (r() < 0.2) c = jit([40, 84, 36], r, 10);
      px(x, y, c);
    });
    for (let k = 0; k < 7; k++) { const x = 3 + ((r() * 10) | 0), y = 5 + ((r() * 8) | 0); px(x, y, [204, 36, 58]); px(x + 1, y, [160, 24, 44]); }
  });

  // ---- coral blocks: porous, with lighter rims around the pores
  const coralTex = (base) => (px, r) => {
    each((x, y) => px(x, y, jit(base, r, 16)));
    for (let k = 0; k < 14; k++) {
      const x = (r() * 16) | 0, y = (r() * 16) | 0;
      px(x, y, shade(base, -60)); px(x + 1, y, shade(base, 26)); px(x, y + 1, shade(base, 18));
    }
  };
  paint('bm_coral_pink', coralTex([222, 110, 150]));
  paint('bm_coral_blue', coralTex([72, 122, 212]));
})(window);
