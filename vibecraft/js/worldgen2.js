'use strict';
// World generator version 2: climate fields and the hierarchical biome system (see docs/BIOMES.md).
//
// Shape and label are separate, as in the reference game since 1.18:
//   * continuous fields per column (continentalness, erosion, peaks and valleys, temperature, humidity, river and
//     coast distance) come from seeded noise, sampled on a 4-block grid and interpolated;
//   * terrain height is a continuous function of those fields, so it never jumps at a biome border;
//   * the biome label is resolved from the same fields through data tables:
//       region → landform → climate class → family / base biome → variant → terrain profile → surface → vegetation;
//   * biome-specific terrain (terraces, dunes, plateaus, flattened wetlands) and vegetation density are blended across
//     borders with a tent kernel over the label grid, and surface materials are dithered with a jittered lookup.
// Everything is a pure function of (seed, x, z): chunks are identical whatever order they are generated in.
// No Math.sin/exp/pow: only + - * / sqrt floor, so results match across JavaScript engines.
(function (root) {
  const BC = root.BC;
  const { CS, WH, SEA } = BC.C;
  const { mulberry32 } = BC.util;
  const IDX = BC.worldgen.IDX;
  const BB = BC.blocks;
  // Local references: hot code must not look globals up per call (slow inside Node's vm contexts used by the tests).
  const { floor, abs, sqrt, max, min, round, imul } = Math;

  // ================================================================ small deterministic helpers
  function mix32(h) {
    h = imul(h ^ (h >>> 16), 0x7feb352d);
    h = imul(h ^ (h >>> 15), 0x846ca68b);
    return (h ^ (h >>> 16)) >>> 0;
  }
  const subSeed = (seed, salt) => mix32((seed ^ imul(salt + 1, 0x9e3779b1)) >>> 0);
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  // Piecewise-linear curve through (xs[i], ys[i]).
  function curve(xs, ys) {
    const n = xs.length;
    return v => {
      if (v <= xs[0]) return ys[0];
      if (v >= xs[n - 1]) return ys[n - 1];
      let i = 1; while (v > xs[i]) i++;
      return ys[i - 1] + (ys[i] - ys[i - 1]) * (v - xs[i - 1]) / (xs[i] - xs[i - 1]);
    };
  }
  // Seeded simplex noise (2D and 3D). Same algorithm as core.js makeNoise, with local lookups for speed.
  const GRAD = new Float64Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);
  const F2 = 0.5 * (sqrt(3) - 1), G2 = (3 - sqrt(3)) / 6, F3 = 1 / 3, G3 = 1 / 6;
  function simplex(seedN) {
    const rand = mulberry32(seedN), p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = (rand() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
    const perm = new Uint8Array(512), gi3 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; gi3[i] = (perm[i] % 12) * 3; }
    const g = GRAD;
    function n2(xin, yin) {
      const s = (xin + yin) * F2, i = floor(xin + s), j = floor(yin + s);
      const t = (i + j) * G2, x0 = xin - (i - t), y0 = yin - (j - t);
      const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
      const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      const ii = i & 255, jj = j & 255;
      let n = 0, tt, k;
      tt = 0.5 - x0 * x0 - y0 * y0; if (tt > 0) { k = gi3[ii + perm[jj]]; tt *= tt; n += tt * tt * (g[k] * x0 + g[k + 1] * y0); }
      tt = 0.5 - x1 * x1 - y1 * y1; if (tt > 0) { k = gi3[ii + i1 + perm[jj + j1]]; tt *= tt; n += tt * tt * (g[k] * x1 + g[k + 1] * y1); }
      tt = 0.5 - x2 * x2 - y2 * y2; if (tt > 0) { k = gi3[ii + 1 + perm[jj + 1]]; tt *= tt; n += tt * tt * (g[k] * x2 + g[k + 1] * y2); }
      return 70 * n;
    }
    function n3(xin, yin, zin) {
      const s = (xin + yin + zin) * F3, i = floor(xin + s), j = floor(yin + s), k = floor(zin + s);
      const t = (i + j + k) * G3, x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
      let i1, j1, k1, i2, j2, k2;
      if (x0 >= y0) {
        if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
        else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
        else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
      } else {
        if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
        else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
        else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      }
      const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
      const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
      const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
      const ii = i & 255, jj = j & 255, kk = k & 255;
      let n = 0, tt, q;
      tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0; if (tt > 0) { q = gi3[ii + perm[jj + perm[kk]]]; tt *= tt; n += tt * tt * (g[q] * x0 + g[q + 1] * y0 + g[q + 2] * z0); }
      tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1; if (tt > 0) { q = gi3[ii + i1 + perm[jj + j1 + perm[kk + k1]]]; tt *= tt; n += tt * tt * (g[q] * x1 + g[q + 1] * y1 + g[q + 2] * z1); }
      tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2; if (tt > 0) { q = gi3[ii + i2 + perm[jj + j2 + perm[kk + k2]]]; tt *= tt; n += tt * tt * (g[q] * x2 + g[q + 1] * y2 + g[q + 2] * z2); }
      tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3; if (tt > 0) { q = gi3[ii + 1 + perm[jj + 1 + perm[kk + 1]]]; tt *= tt; n += tt * tt * (g[q] * x3 + g[q + 1] * y3 + g[q + 2] * z3); }
      return 32 * n;
    }
    return { n2, n3 };
  }
  // Triangle wave in [-1, 1] with tri(0) = 0 (a latitude-like trend along z).
  const tri = u => { const f = u - 0.25 - floor(u - 0.25); return 4 * abs(f - 0.5) - 1; };

  // ================================================================ parameter presets (owner's choice, see BIOMES.md)
  // ocean: target share of area below sea level (quantile-mapped, so it is exact over the calibration window).
  // contScale: wavelength of the continent noise in blocks. climate: multiplier for temperature, humidity, erosion and
  // variant wavelengths (bigger = larger biomes). river: wavelength of the river/ridge noise (bigger = fewer rivers).
  const PRESETS = {
    archipelago: { label: 'Archipelago', ocean: 0.60, contScale: 620, contGain: 0.58, warp: 120, climate: 0.9, river: 460 },
    balanced: { label: 'Balanced', ocean: 0.42, contScale: 1050, contGain: 0.5, warp: 170, climate: 1.3, river: 560 },
    continental: { label: 'Continental', ocean: 0.28, contScale: 1700, contGain: 0.47, warp: 260, climate: 1.7, river: 640 },
  };
  const DEFAULT_PRESET = 'balanced';

  // ================================================================ outcome table (data)
  // Every outcome the generator can produce. Families group related outcomes; `base` + `variant` name the layer
  // decisions. Surface, vegetation and terrain-profile fields override DEF. Tile colours are only for maps.
  const DEF = {
    top: 'grass_block', filler: 'dirt', depth: 3, under: null, underDepth: 0, bands: false,
    patches: [],                     // [block, threshold 0..1, noise 0|1]: the top becomes `block` where patch noise > threshold
    steep: 'stone', steepAt: 3,      // top block on slopes of `steepAt` blocks or more
    floor: 'sand', floorDeep: 'gravel', floorPatches: [['clay', 0.8, 0]],
    snow: 'auto',                    // 'auto' by surface temperature, 'always', or 'never'
    freeze: false,                   // water surface freezes
    tree: 0, species: [], plant: 0, plants: [],
    hAdd: 0, flat: 0, flatTo: 0, terrace: 0, plateau: 0, dune: 0, rough: 0,
    boulder: 0, boulderBlock: 'cobblestone', cactus: 0, spike: 0, coral: 0, fallen: 0, iceberg: 0,
    caves: 1, ores: null,            // cave-size multiplier; ore multipliers {coal, iron, gold, diamond}
  };
  const O = (key, name, family, base, variant, color, o) => Object.assign({}, DEF, { key, name, family, base, variant, color }, o);
  const FLOWERS = [['tall_grass', 0.75], ['poppy', 0.1], ['buttercup', 0.15]];
  const OUTCOMES = [
    // ---- ocean
    O('ocean', 'Ocean', 'ocean', 'ocean', null, '#2e5cb8', { floor: 'sand', floorDeep: 'gravel', floorPatches: [['sand', 0.5, 1], ['clay', 0.72, 0]] }),
    O('deep_ocean', 'Deep Ocean', 'ocean', 'ocean', 'deep', '#1b3778', { floor: 'gravel', floorDeep: 'gravel', floorPatches: [['clay', 0.6, 0], ['slate', 0.64, 1]], hAdd: -1.5 }),
    O('frozen_ocean', 'Frozen Ocean', 'ocean', 'ocean', 'frozen', '#9bb9da', { floor: 'gravel', floorDeep: 'gravel', floorPatches: [['clay', 0.66, 0]], freeze: true, snow: 'always', iceberg: 0.0025 }),
    O('warm_ocean', 'Warm Ocean', 'ocean', 'ocean', 'warm', '#2aa7c6', { floor: 'sand', floorDeep: 'sand', floorPatches: [['clay', 0.84, 0]], coral: 0.035, hAdd: 1.5, snow: 'never' }),
    // ---- coast
    O('beach', 'Beach', 'coast', 'beach', null, '#e7d89a', { top: 'sand', filler: 'sand', depth: 3, under: 'sandstone', underDepth: 3, steep: 'sand', floor: 'sand', floorDeep: 'sand', flat: 0.45, flatTo: 0.9, snow: 'never' }),
    O('snowy_beach', 'Snowy Beach', 'coast', 'beach', 'snowy', '#d8e3e6', { top: 'gravel', patches: [['sand', 0.55, 0], ['snow_block', 0.52, 1]], filler: 'gravel', steep: 'gravel', floor: 'gravel', floorDeep: 'gravel', flat: 0.4, flatTo: 0.9, snow: 'never', freeze: true }),
    O('stony_shore', 'Stony Shore', 'coast', 'shore', 'stony', '#83898e', { top: 'stone', patches: [['gravel', 0.55, 0], ['granite', 0.62, 1]], filler: 'stone', steepAt: 1, floor: 'gravel', floorDeep: 'gravel', rough: 1.5, boulder: 0.006 }),
    // ---- river
    O('river', 'River', 'river', 'river', null, '#3c7fe2', { floor: 'sand', floorDeep: 'sand', floorPatches: [['clay', 0.64, 0], ['gravel', 0.62, 1]] }),
    O('frozen_river', 'Frozen River', 'river', 'river', 'frozen', '#aac9ef', { floor: 'gravel', floorDeep: 'gravel', floorPatches: [['clay', 0.6, 0]], freeze: true, snow: 'always' }),
    // ---- grassland
    O('plains', 'Plains', 'grassland', 'plains', null, '#8cbb5b', { tree: 0.0025, species: [['oak', 0.85], ['bush', 0.15]], plant: 0.22, plants: FLOWERS }),
    O('meadow', 'Meadow', 'grassland', 'plains', 'meadow', '#b7d66f', { hAdd: 3, rough: 2, tree: 0.0006, species: [['birch', 1]], plant: 0.3, plants: [['tall_grass', 0.15], ['buttercup', 0.25], ['bluebell', 0.2], ['lavender', 0.25], ['poppy', 0.15]] }),
    O('steppe', 'Steppe', 'grassland', 'plains', 'dry', '#beb26e', { top: 'dry_grass_block', patches: [['coarse_dirt', 0.62, 0], ['gravel', 0.72, 1]], plant: 0.07, plants: [['dry_shrub', 0.45], ['tall_grass', 0.55]], boulder: 0.0025, rough: 0.5 }),
    // ---- temperate forest
    O('forest', 'Forest', 'temperate_forest', 'forest', null, '#3a7a2c', { tree: 0.05, species: [['oak', 0.8], ['oak_tall', 0.12], ['birch', 0.08]], plant: 0.07, plants: [['fern', 0.45], ['tall_grass', 0.4], ['poppy', 0.15]], patches: [['coarse_dirt', 0.62, 0], ['moss_block', 0.7, 1]], fallen: 0.002 }),
    O('forest_edge', 'Forest Edge', 'temperate_forest', 'forest', 'edge', '#6aa344', { tree: 0.022, species: [['oak', 0.45], ['bush', 0.5], ['birch', 0.05]], plant: 0.13, plants: [['berry_bush', 0.35], ['tall_grass', 0.35], ['poppy', 0.15], ['bluebell', 0.15]] }),
    O('forest_hills', 'Forest Hills', 'temperate_forest', 'forest', 'hills', '#2c6536', { hAdd: 3, rough: 3, tree: 0.04, species: [['oak', 0.6], ['spruce', 0.25], ['birch', 0.15]], plant: 0.05, plants: [['fern', 0.5], ['tall_grass', 0.5]], patches: [['coarse_dirt', 0.6, 0], ['stone', 0.7, 1]], steepAt: 2, boulder: 0.01, boulderBlock: 'mossy_cobblestone' }),
    O('wet_forest', 'Wet Forest', 'temperate_forest', 'forest', 'wet', '#245a3a', { top: 'moss_block', patches: [['grass_block', 0.68, 0], ['podzol', 0.7, 1]], tree: 0.065, species: [['oak_tall', 0.5], ['spruce', 0.3], ['willow', 0.2]], plant: 0.2, plants: [['fern', 0.75], ['tall_grass', 0.15], ['bluebell', 0.1]], boulder: 0.003, boulderBlock: 'mossy_cobblestone', fallen: 0.004, floor: 'mud', floorDeep: 'clay' }),
    O('highland_forest', 'Highland Forest', 'temperate_forest', 'forest', 'highland', '#4b7e5b', { top: 'podzol', hAdd: 2, rough: 1.5, tree: 0.04, species: [['spruce', 0.7], ['birch', 0.3]], plant: 0.08, plants: [['fern', 0.5], ['bluebell', 0.3], ['tall_grass', 0.2]], patches: [['grass_block', 0.52, 0], ['coarse_dirt', 0.66, 1]], steepAt: 2 }),
    // ---- birch forest
    O('birch_forest', 'Birch Forest', 'birch_forest', 'birch_forest', null, '#82b55b', { tree: 0.05, species: [['birch', 0.95], ['oak', 0.05]], plant: 0.14, plants: [['tall_grass', 0.5], ['buttercup', 0.25], ['bluebell', 0.25]] }),
    O('old_birch_forest', 'Old Birch Forest', 'birch_forest', 'birch_forest', 'old_growth', '#a7cb80', { tree: 0.05, species: [['birch_tall', 1]], plant: 0.14, plants: [['fern', 0.5], ['bluebell', 0.35], ['tall_grass', 0.15]], patches: [['podzol', 0.7, 0]], fallen: 0.003 }),
    // ---- taiga
    O('taiga', 'Taiga', 'taiga', 'taiga', null, '#39695a', { top: 'podzol', patches: [['grass_block', 0.56, 0], ['coarse_dirt', 0.7, 1]], tree: 0.05, species: [['spruce', 0.88], ['spruce_small', 0.12]], plant: 0.08, plants: [['fern', 0.6], ['berry_bush', 0.25], ['tall_grass', 0.15]], boulder: 0.002, boulderBlock: 'mossy_cobblestone', fallen: 0.002 }),
    O('snowy_taiga', 'Snowy Taiga', 'taiga', 'taiga', 'snowy', '#5e8b82', { snow: 'always', freeze: true, tree: 0.045, species: [['spruce', 0.85], ['spruce_small', 0.15]], plant: 0.05, plants: [['berry_bush', 0.6], ['fern', 0.4]], boulder: 0.002, boulderBlock: 'mossy_cobblestone' }),
    // ---- snowy lands
    O('snowy_plains', 'Snowy Plains', 'snowy', 'snowy_plains', null, '#edf2f5', { snow: 'always', freeze: true, top: 'snowy_grass_block', patches: [['snow_block', 0.52, 0]], tree: 0.0015, species: [['spruce_small', 1]] }),
    O('ice_fields', 'Ice Fields', 'snowy', 'snowy_plains', 'ice_spikes', '#b3dcee', { snow: 'always', freeze: true, top: 'snow_block', patches: [['packed_ice', 0.64, 0]], spike: 0.01 }),
    O('tundra', 'Tundra', 'snowy', 'tundra', null, '#8fa588', { patches: [['moss_block', 0.6, 0], ['gravel', 0.7, 1], ['coarse_dirt', 0.6, 1]], plant: 0.07, plants: [['cotton_grass', 0.6], ['tall_grass', 0.3], ['berry_bush', 0.1]], boulder: 0.003, boulderBlock: 'granite', tree: 0.0006, species: [['spruce_small', 1]] }),
    // ---- savanna
    O('savanna', 'Savanna', 'savanna', 'savanna', null, '#bda94e', { top: 'dry_grass_block', patches: [['coarse_dirt', 0.7, 0]], snow: 'never', tree: 0.015, species: [['acacia', 0.8], ['bush', 0.2]], plant: 0.16, plants: [['tall_grass', 0.5], ['dry_shrub', 0.5]] }),
    O('savanna_plateau', 'Savanna Plateau', 'savanna', 'savanna', 'plateau', '#a08e44', { top: 'coarse_dirt', patches: [['dry_grass_block', 0.46, 0], ['red_sand', 0.6, 1]], hAdd: 5, plateau: 0.85, snow: 'never', tree: 0.025, species: [['acacia', 0.85], ['bush', 0.15]], plant: 0.1, plants: [['tall_grass', 0.7], ['dry_shrub', 0.3]], steep: 'red_sandstone', steepAt: 3 }),
    // ---- desert
    O('desert', 'Desert', 'desert', 'desert', null, '#e1d088', { top: 'sand', patches: [['sandstone', 0.74, 1]], filler: 'sand', depth: 4, under: 'sandstone', underDepth: 6, steep: 'sandstone', snow: 'never', dune: 1.5, cactus: 0.007, boulder: 0.0015, boulderBlock: 'sandstone', plant: 0.008, plants: [['dry_shrub', 1]], floorPatches: [], caves: 0.8 }),
    O('dunes', 'Dunes', 'desert', 'desert', 'dunes', '#f3de98', { top: 'sand', filler: 'sand', depth: 6, under: 'sandstone', underDepth: 6, steep: 'sand', steepAt: 99, snow: 'never', dune: 8, plant: 0.0008, plants: [['dry_shrub', 1]], floorPatches: [], caves: 0.6 }),
    O('rocky_desert', 'Rocky Desert', 'desert', 'desert', 'rocky', '#c29f66', { top: 'sand', patches: [['gravel', 0.62, 0], ['red_sand', 0.62, 1], ['sandstone', 0.74, 0]], filler: 'sandstone', depth: 3, steep: 'stone', steepAt: 2, rough: 2, snow: 'never', cactus: 0.0012, plant: 0.004, plants: [['dry_shrub', 1]], boulder: 0.004, boulderBlock: 'sandstone' }),
    // ---- badlands
    O('badlands', 'Badlands', 'badlands', 'badlands', null, '#c5643a', { top: 'red_sand', filler: 'red_sand', depth: 2, bands: true, steep: 'bands', steepAt: 2, terrace: 0.85, rough: 1.5, snow: 'never', cactus: 0.0008, plant: 0.003, plants: [['dry_shrub', 1]], floor: 'red_sand', floorDeep: 'red_sand', floorPatches: [], ores: { gold: 3 } }),
    O('wooded_badlands', 'Wooded Badlands', 'badlands', 'badlands', 'wooded', '#93693c', { top: 'coarse_dirt', patches: [['dry_grass_block', 0.5, 0], ['red_sand', 0.66, 1]], depth: 2, bands: true, steep: 'bands', steepAt: 2, terrace: 0.55, plateau: 0.4, hAdd: 3, snow: 'never', tree: 0.012, species: [['oak', 0.5], ['bush', 0.5]], plant: 0.04, plants: [['dry_shrub', 0.5], ['tall_grass', 0.5]], floor: 'red_sand', floorDeep: 'red_sand', floorPatches: [], ores: { gold: 2 } }),
    // ---- rainforest
    O('rainforest', 'Rainforest', 'rainforest', 'rainforest', null, '#1d8a2b', { top: 'lush_grass_block', patches: [['podzol', 0.7, 0], ['moss_block', 0.7, 1]], snow: 'never', tree: 0.085, species: [['mahogany', 0.55], ['jungle_bush', 0.35], ['oak_tall', 0.1]], plant: 0.22, plants: [['fern', 0.55], ['tall_grass', 0.45]], floor: 'mud', floorDeep: 'clay' }),
    O('rainforest_edge', 'Rainforest Edge', 'rainforest', 'rainforest', 'edge', '#4ba63b', { top: 'lush_grass_block', patches: [['grass_block', 0.6, 0]], snow: 'never', tree: 0.025, species: [['mahogany', 0.3], ['jungle_bush', 0.6], ['oak', 0.1]], plant: 0.18, plants: [['tall_grass', 0.7], ['fern', 0.2], ['poppy', 0.1]] }),
    // ---- wetland
    O('swamp', 'Swamp', 'wetland', 'swamp', null, '#4b6a37', { patches: [['mud', 0.55, 0], ['moss_block', 0.68, 1]], flat: 0.9, flatTo: -0.3, tree: 0.022, species: [['willow', 1]], plant: 0.1, plants: [['reeds', 0.6], ['fern', 0.2], ['tall_grass', 0.2]], floor: 'mud', floorDeep: 'clay', floorPatches: [['clay', 0.66, 0]] }),
    O('bog', 'Bog', 'wetland', 'swamp', 'bog', '#6d7b4b', { top: 'moss_block', patches: [['mud', 0.56, 0], ['grass_block', 0.66, 1]], flat: 0.9, flatTo: -0.1, tree: 0.0012, species: [['spruce_small', 1]], plant: 0.12, plants: [['cotton_grass', 0.6], ['reeds', 0.4]], floor: 'mud', floorDeep: 'mud', floorPatches: [] }),
    // ---- mountains
    O('mountain_forest', 'Mountain Forest', 'mountains', 'mountains', 'forest', '#4a6a4b', { patches: [['coarse_dirt', 0.6, 0], ['podzol', 0.68, 1]], steepAt: 2, tree: 0.035, species: [['spruce', 0.85], ['birch', 0.15]], plant: 0.04, plants: [['fern', 0.7], ['tall_grass', 0.3]], boulder: 0.003, ores: { iron: 1.3, coal: 1.2 }, caves: 1.2 }),
    O('alpine_meadow', 'Alpine Meadow', 'mountains', 'mountains', 'alpine', '#a0c48d', { patches: [['stone', 0.72, 1], ['gravel', 0.76, 0]], steepAt: 3, plant: 0.18, plants: [['bluebell', 0.3], ['lavender', 0.25], ['cotton_grass', 0.2], ['tall_grass', 0.25]], boulder: 0.003, boulderBlock: 'granite', ores: { iron: 1.3, coal: 1.2 }, caves: 1.2 }),
    O('rocky_peaks', 'Rocky Peaks', 'mountains', 'mountains', 'rocky', '#9a9a9c', { top: 'stone', patches: [['gravel', 0.6, 0], ['granite', 0.62, 1]], filler: 'stone', steepAt: 1, ores: { iron: 1.5, coal: 1.3, gold: 1.2 }, caves: 1.3 }),
    O('snowy_peaks', 'Snowy Peaks', 'mountains', 'mountains', 'snowy', '#f8fbff', { top: 'snow_block', patches: [['packed_ice', 0.68, 0]], filler: 'snow_block', depth: 2, steepAt: 3, snow: 'always', freeze: true, ores: { iron: 1.5, coal: 1.2 }, caves: 1.2 }),
  ];
  const FAMILIES = [
    { key: 'ocean', name: 'Ocean' }, { key: 'coast', name: 'Coast' }, { key: 'river', name: 'River' },
    { key: 'grassland', name: 'Grassland' }, { key: 'temperate_forest', name: 'Temperate Forest' }, { key: 'birch_forest', name: 'Birch Forest' },
    { key: 'taiga', name: 'Taiga' }, { key: 'snowy', name: 'Snowy Lands' }, { key: 'savanna', name: 'Savanna' },
    { key: 'desert', name: 'Desert' }, { key: 'badlands', name: 'Badlands' }, { key: 'rainforest', name: 'Rainforest' },
    { key: 'wetland', name: 'Wetland' }, { key: 'mountains', name: 'Mountains' },
  ];
  const OI = {}; OUTCOMES.forEach((o, i) => { o.index = i; OI[o.key] = i; });

  // ================================================================ resolution tables (data)
  // Climate classes. Temperature in °C-like units (base value from noise, minus a lapse rate with height).
  const T_EDGES = [-1, 7, 16, 22];            // T0 frozen | T1 cold | T2 temperate | T3 warm | T4 hot
  const H_EDGES = [0.22, 0.4, 0.6, 0.78];    // H0 arid | H1 dry | H2 moderate | H3 humid | H4 wet
  const LAPSE = 0.32;                          // °C per block above SEA + 4
  const T_NAMES = ['frozen', 'cold', 'temperate', 'warm', 'hot'], H_NAMES = ['arid', 'dry', 'moderate', 'humid', 'wet'];
  // Base biome by climate class for ordinary land [T][H]. Neighbouring cells are climatically compatible.
  const MID = [
    ['snowy_plains', 'snowy_plains', 'snowy_taiga', 'snowy_taiga', 'snowy_taiga'],
    ['tundra', 'tundra', 'taiga', 'taiga', 'taiga'],
    ['steppe', 'plains', 'forest', 'birch_forest', 'wet_forest'],
    ['savanna', 'savanna', 'forest', 'rainforest_edge', 'rainforest'],
    ['desert', 'desert', 'savanna', 'rainforest_edge', 'rainforest'],
  ];
  // Rules are ordered; the first whose ranges all match wins. Range keys are resolution-context fields:
  // c (continentalness −1..1), e (erosion −1 rugged..1 flat), pv (peaks and valleys), elev (base height above sea),
  // relief (local relief potential, blocks), upland (large-scale elevation without ridges and valleys, blocks),
  // t (base temperature), tH (temperature at height), m (humidity 0..1),
  // v (variant noise 0..1), dcoast (blocks from the coastline), hEdge (humidity above the lower edge of its band).
  // `out: null` falls through to the next landform.
  const LANDFORMS = [
    { key: 'ocean', when: { c: [-9, 0] }, rules: [
      { when: { t: [-99, -2] }, out: 'frozen_ocean' },
      { when: { c: [-9, -0.6] }, out: 'deep_ocean' },
      { when: { t: [21, 99] }, out: 'warm_ocean' },
      { out: 'ocean' }] },
    { key: 'coast', when: { dcoast: [-99, 7], elev: [-99, 3] }, rules: [
      { when: { relief: [12, 999] }, out: 'stony_shore' },
      { when: { t: [-99, -1] }, out: 'snowy_beach' },
      { out: 'beach' }] },
    { key: 'mountain', when: { relief: [15, 999], elev: [16, 999] }, rules: [
      { when: { t: [21, 99], m: [-9, 0.3] }, out: 'badlands' },
      { when: { t: [21, 99], m: [-9, 0.4] }, out: 'wooded_badlands' },
      { when: { tH: [-99, -1.5], elev: [22, 999] }, out: 'snowy_peaks' },
      { when: { elev: [32, 999] }, out: 'rocky_peaks' },
      { when: { t: [19, 99] }, out: null },
      { when: { elev: [24, 999], m: [0.3, 9] }, out: 'alpine_meadow' },
      { when: { elev: [24, 999] }, out: 'rocky_peaks' },
      { when: { m: [-9, 0.22] }, out: null },
      { out: 'mountain_forest' }] },
    { key: 'wetland', when: { e: [0.3, 9], elev: [-99, 4.5], m: [0.6, 9], t: [-1, 99], c: [-9, 0.75] }, rules: [
      { when: { t: [-99, 6] }, out: 'bog' },
      { out: 'swamp' }] },
    { key: 'land', rules: 'climate' },
  ];
  // Variants: [base, outcome, ranges]; first match per base wins.
  const VARIANTS = [
    ['snowy_plains', 'ice_fields', { v: [0.74, 9] }],
    ['plains', 'meadow', { upland: [8, 999] }],
    ['plains', 'meadow', { v: [0.82, 9] }],
    ['forest', 'highland_forest', { upland: [10, 999] }],
    ['forest', 'forest_hills', { relief: [9.5, 999] }],
    ['forest', 'forest_edge', { hEdge: [-9, 0.045] }],
    ['birch_forest', 'old_birch_forest', { v: [0.68, 9] }],
    ['desert', 'wooded_badlands', { e: [-9, -0.32], m: [0.3, 9] }],
    ['desert', 'badlands', { e: [-9, -0.32] }],
    ['desert', 'dunes', { e: [0.32, 9] }],
    ['desert', 'rocky_desert', { e: [-9, -0.08] }],
    ['savanna', 'savanna_plateau', { upland: [8, 999] }],
  ];
  const matches = (when, ctx) => { if (!when) return true; for (const k in when) { const v = ctx[k], r = when[k]; if (!(v >= r[0] && v < r[1])) return false; } return true; };
  const bandOf = (v, edges) => { let i = 0; while (i < edges.length && v >= edges[i]) i++; return i; };
  const FOR_BASE = {};
  for (const [b, o, w] of VARIANTS) (FOR_BASE[b] = FOR_BASE[b] || []).push({ out: o, when: w });
  // Resolve an outcome index from a context. Also reports the layer decisions when `trace` is an object.
  function resolve(ctx, trace) {
    for (const L of LANDFORMS) {
      if (!matches(L.when, ctx)) continue;
      if (L.rules === 'climate') {
        const ti = bandOf(ctx.tH, T_EDGES), hi = bandOf(ctx.m, H_EDGES);
        const base = MID[ti][hi];
        ctx.hEdge = ctx.m - (hi > 0 ? H_EDGES[hi - 1] : -1);
        let out = base;
        for (const V of FOR_BASE[base] || []) if (matches(V.when, ctx)) { out = V.out; break; }
        if (trace) { trace.landform = L.key; trace.climate = T_NAMES[ti] + ' / ' + H_NAMES[hi]; trace.base = base; }
        return OI[out];
      }
      for (const R of L.rules) {
        if (!matches(R.when, ctx)) continue;
        if (R.out === null) break;
        if (trace) { trace.landform = L.key; trace.climate = T_NAMES[bandOf(ctx.tH, T_EDGES)] + ' / ' + H_NAMES[bandOf(ctx.m, H_EDGES)]; trace.base = OUTCOMES[OI[R.out]].base; }
        return OI[R.out];
      }
    }
    return OI.plains;
  }

  // Terrain-profile parameters blended across borders (tent kernel over the 4-block label grid).
  const BLEND = ['hAdd', 'flat', 'flatT', 'terrace', 'plateau', 'dune', 'rough', 'tree', 'plant'];
  const NB = BLEND.length;
  const PROFILE = OUTCOMES.map(o => BLEND.map(k => (k === 'flatT' ? o.flat * o.flatTo : o[k])));
  const KR = 3, KW = [1, 2, 3, 4, 3, 2, 1].map(v => v / 16);   // tent kernel, radius 3 cells (12 blocks)

  // Height splines (blocks). Continentalness sets the base, erosion the relief amplitude, peaks-and-valleys its shape.
  const H_CONT = curve([-1, -0.6, -0.35, -0.15, -0.05, 0, 0.05, 0.2, 0.5, 1], [9, 10.5, 14, 18.5, 21.5, 23.6, 25, 27.2, 29.5, 32]);
  const A_ERO = curve([-1, -0.75, -0.5, -0.25, 0, 0.35, 1], [44, 34, 22, 12, 6, 3, 1.5]);
  const PV_OF = curve([0, 0.1, 0.3, 0.5, 0.62, 0.8, 1], [-1, -0.55, 0.05, 0.75, 1, 0.55, 0.25]);
  const T_OF = curve([0, 0.12, 0.3, 0.6, 0.8, 1], [-14, -1, 7, 16, 22, 32]);
  const pvShape = pv => (pv >= 0 ? 0.3 + 0.7 * pv * pv : 0.3 + 0.45 * pv);

  // Quantile tables: rank-map a raw noise value to [0, 1] so area shares follow the thresholds exactly.
  function quantiles(vals) {
    const s = Float64Array.from(vals).sort(), Q = new Float64Array(129);
    for (let k = 0; k <= 128; k++) Q[k] = s[round(k * (s.length - 1) / 128)];
    return Q;
  }
  function rank(Q, v) {
    if (v <= Q[0]) return 0;
    if (v >= Q[128]) return 1;
    let lo = 0, hi = 128;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (Q[mid] <= v) lo = mid; else hi = mid; }
    const d = Q[hi] - Q[lo];
    return (lo + (d > 0 ? (v - Q[lo]) / d : 0)) / 128;
  }
  function unrank(Q, u) { const f = clamp(u, 0, 1) * 128, k = min(127, floor(f)); return Q[k] + (Q[k + 1] - Q[k]) * (f - k); }

  // ================================================================ generator factory
  function createV2(seedIn, presetName) {
    const seed = seedIn >>> 0;
    const pkey = PRESETS[presetName] ? presetName : DEFAULT_PRESET;
    const P = PRESETS[pkey];
    const K = key => { const d = BB.BY_KEY[key]; if (!d) throw new Error('worldgen2: block "' + key + '" is not registered'); return d.id; };
    const B = BB.B;
    const AIR = 0, WATER = B.WATER, BEDROCK = B.BEDROCK, STONE = B.STONE;
    const ID = {};
    for (const k of ['grass_block', 'dirt', 'stone', 'sand', 'cobblestone', 'snowy_grass_block', 'cactus', 'oak_log', 'oak_leaves', 'water', 'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore',
      'gravel', 'clay', 'coarse_dirt', 'podzol', 'mud', 'moss_block', 'dry_grass_block', 'lush_grass_block', 'red_sand', 'sandstone', 'red_sandstone',
      'terracotta', 'white_terracotta', 'yellow_terracotta', 'orange_terracotta', 'red_terracotta', 'brown_terracotta', 'snow_block', 'ice', 'packed_ice',
      'granite', 'limestone', 'slate', 'mossy_cobblestone', 'spruce_log', 'spruce_leaves', 'birch_log', 'birch_leaves', 'acacia_log', 'acacia_leaves',
      'mahogany_log', 'mahogany_leaves', 'willow_log', 'willow_leaves', 'tall_grass', 'fern', 'dry_shrub', 'poppy', 'buttercup', 'bluebell', 'lavender',
      'cotton_grass', 'reeds', 'berry_bush', 'pink_coral_block', 'blue_coral_block']) ID[k] = K(k);
    const BANDS_ID = -2;   // marker: use the badlands band block for this y
    const bid = k => (k === 'bands' ? BANDS_ID : ID[k] || K(k));
    // Per-outcome resolved block ids and weighted pickers.
    const OB = OUTCOMES.map(o => ({
      top: bid(o.top), filler: bid(o.filler), under: o.under ? bid(o.under) : 0, steep: bid(o.steep),
      floor: bid(o.floor), floorDeep: bid(o.floorDeep),
      patches: o.patches.map(([b, t, n]) => [bid(b), t, n]), floorPatches: o.floorPatches.map(([b, t, n]) => [bid(b), t, n]),
      species: cumul(o.species), plants: cumul(o.plants.map(([k, w]) => [ID[k] || K(k), w])),
      boulder: bid(o.boulderBlock),
      ores: Object.assign({ coal: 1, iron: 1, gold: 1, diamond: 1 }, o.ores || {}),
    }));
    function cumul(list) { let s = 0; for (const [, w] of list) s += w; let a = 0; return list.map(([k, w]) => { a += w / s; return [k, a]; }); }
    const pick = (list, u) => { for (const [k, a] of list) if (u < a) return k; return list.length ? list[list.length - 1][0] : null; };
    // Soft ground that snow covers; blocks that are "soil" for plants.
    const GRASSY = new Set([ID.grass_block, ID.dry_grass_block, ID.lush_grass_block, ID.podzol, ID.coarse_dirt, ID.moss_block, ID.mud, ID.dirt]);
    const SNOWABLE_ROCK = new Set([STONE, ID.gravel, ID.granite, ID.coarse_dirt, ID.cobblestone, ID.sand]);
    const ROCKY = new Set([STONE, ID.granite, ID.limestone, ID.slate]);
    const LOOSE = new Set([ID.sand, ID.red_sand, ID.gravel, ID.sandstone, ID.red_sandstone, ID.snow_block]);

    // ---- noises (each an independent seeded simplex field)
    let salt = 0;
    const nz = () => simplex(subSeed(seed, ++salt));
    const Nc = nz(), Nwx = nz(), Nwz = nz(), Ne = nz(), Nw = nz(), Nww = nz(), Nt = nz(), Nm = nz(), Nv = nz(), Ng = nz(), Nr = nz();
    const Nd = nz(), Nj = nz(), Ndu = nz(), Np = nz(), Nx = nz(), Nb = nz(), Nk1 = nz(), Nk2 = nz(), Nk3 = nz(), Ns = nz();
    function fbm(n, x, z, oct, gain) {
      let s = 0, a = 1, f = 1, norm = 0;
      for (let i = 0; i < oct; i++) { s += a * n.n2(x * f + i * 31.7, z * f - i * 17.3); norm += a; a *= gain; f *= 2; }
      return s / norm;
    }
    const seedMix = mix32(seed ^ 0x5bd1e995);
    const hash2 = (x, z, s) => mix32(imul(x | 0, 0x27d4eb2d) ^ imul(z | 0, 0x165667b1) ^ imul(s, 0x9e3779b1) ^ seedMix) / 4294967296;
    const hash3 = (x, y, z, s) => mix32(imul(x | 0, 0x27d4eb2d) ^ imul(y | 0, 0x6c8e9cf5) ^ imul(z | 0, 0x165667b1) ^ imul(s, 0x9e3779b1) ^ seedMix) / 4294967296;
    const hashInt3 = (x, y, z, s) => mix32(imul(x | 0, 0x27d4eb2d) ^ imul(y | 0, 0x6c8e9cf5) ^ imul(z | 0, 0x165667b1) ^ imul(s, 0x9e3779b1) ^ seedMix);
    const hashInt = (x, z, s) => mix32(imul(x | 0, 0x27d4eb2d) ^ imul(z | 0, 0x165667b1) ^ imul(s, 0x9e3779b1) ^ seedMix);

    // ---- field scales
    const CL = P.climate;
    const WS = P.contScale * 0.4, ES = 560 * CL, TS = 1900 * CL, MS = 1000 * CL, VS = 230 * CL, GS = 700, RS = 3200, LATP = 9000;
    const rawRegion = (x, z) => fbm(Nr, x / RS, z / RS, 2, 0.5);
    const warpX = (x, z) => x + P.warp * fbm(Nwx, x / WS, z / WS, 2, 0.5);
    const warpZ = (x, z) => z + P.warp * fbm(Nwz, x / WS, z / WS, 2, 0.5);
    const rawCont = (wx, wz, oct) => fbm(Nc, wx / P.contScale, wz / P.contScale, oct, P.contGain);
    const regionBias = u => { const basin = sstep(0.28, 0.12, u), belt = sstep(0.72, 0.88, u); return [0.13 * (basin - belt), 0.07 * basin]; };
    const rawEro = (x, z, oct) => fbm(Ne, x / ES, z / ES, oct, 0.5);
    const rawWeird = (x, z, oct) => {
      const mx = x + 34 * Nww.n2(x / 150, z / 150), mz = z + 34 * Nww.n2(x / 150 + 91.7, z / 150 - 47.3);
      return fbm(Nw, mx / P.river, mz / P.river, oct, 0.45);
    };
    const rawTemp = (x, z) => fbm(Nt, x / TS, z / TS, 2, 0.3) + 0.3 * tri(z / LATP);
    const rawHum = (x, z) => fbm(Nm, x / MS, z / MS, 3, 0.4);
    const rawVar = (x, z) => fbm(Nv, x / VS, z / VS, 2, 0.5);
    const rawGeo = (x, z) => fbm(Ng, x / GS, z / GS, 2, 0.5);

    // ---- calibration: per-seed quantile tables from a 48 x 48 sample grid (deterministic)
    const Q = {};
    {
      const n = 48, sp = 611, R = [], C = [], E = [], Wv = [], T = [], M = [], V = [], G = [];
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) R.push(rawRegion((i - n / 2) * sp + 0.5, (j - n / 2) * sp + 0.5));
      Q.r = quantiles(R);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = (i - n / 2) * sp + 0.5, z = (j - n / 2) * sp + 0.5, k = i + j * n, rb = regionBias(rank(Q.r, R[k]));
        C.push(rawCont(warpX(x, z), warpZ(x, z), 5));
        E.push(rawEro(x, z, 3) + rb[0]);
        Wv.push(abs(rawWeird(x, z, 3)));
        T.push(rawTemp(x, z)); M.push(rawHum(x, z) + rb[1]); V.push(rawVar(x, z)); G.push(rawGeo(x, z));
      }
      Q.c = quantiles(C); Q.e = quantiles(E); Q.w = quantiles(Wv); Q.t = quantiles(T); Q.m = quantiles(M); Q.v = quantiles(V); Q.g = quantiles(G);
    }
    const OCEAN = P.ocean;
    const RC0 = unrank(Q.c, OCEAN);               // raw continentalness at the coastline
    const mapCont = rc => { const u = rank(Q.c, rc); return u < OCEAN ? (u - OCEAN) / OCEAN : (u - OCEAN) / (1 - OCEAN); };
    // Cheap elevation estimate (fewer octaves) for the rain shadow.
    function elevEstimate(x, z) {
      const c = mapCont(rawCont(warpX(x, z), warpZ(x, z), 3));
      const e = 2 * rank(Q.e, rawEro(x, z, 2)) - 1;
      const pv = PV_OF(rank(Q.w, abs(fbm(Nw, x / P.river, z / P.river, 2, 0.45))));
      return H_CONT(c) - SEA + A_ERO(e) * sstep(0, 0.25, c) * pvShape(pv);
    }

    // ================================================================ coarse window (4-block grid)
    // A window covers grid points [gx0 .. gx0+fw-1] x [gz0 .. gz0+fh-1]. Point fields are computed everywhere;
    // derived values (gradients, height, label) one cell in; blurred profile parameters where columns need them.
    function makeWindow(cxa, cza, cxb, czb) {
      const gx0 = cxa - KR - 2, gz0 = cza - KR - 2, fw = cxb - cxa + 2 * KR + 5, fh = czb - cza + 2 * KR + 5, n = fw * fh;
      const F64 = () => new Float64Array(n);
      const Wn = { gx0, gz0, fw, fh, RC: F64(), CM: F64(), E: F64(), W: F64(), PV: F64(), T0: F64(), M0: F64(), V: F64(), G: F64(), REG: F64(), UP: F64(),
        DC: F64(), GW: F64(), REL: F64(), H0: F64(), TH: F64(), M: F64(), LBL: new Int16Array(n).fill(-1), BP: [] };
      for (let k = 0; k < NB; k++) Wn.BP.push(F64());
      for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) pointFields(Wn, i + j * fw, (gx0 + i) * 4, (gz0 + j) * 4);
      for (let j = 1; j < fh - 1; j++) for (let i = 1; i < fw - 1; i++) derive(Wn, i + j * fw);
      // Tent blur of the profile parameters, separable: rows first (over the z span that the second pass reads).
      const tmp = []; for (let k = 0; k < NB; k++) tmp.push(F64());
      const ia = cxa - gx0, ib = cxb - gx0, ja = cza - gz0, jb = czb - gz0;
      for (let j = ja - KR; j <= jb + KR; j++) for (let i = ia; i <= ib; i++) {
        for (let d = -KR; d <= KR; d++) {
          const pr = PROFILE[Wn.LBL[i + d + j * fw]], w = KW[d + KR];
          for (let k = 0; k < NB; k++) tmp[k][i + j * fw] += pr[k] * w;
        }
      }
      for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
        for (let d = -KR; d <= KR; d++) { const w = KW[d + KR], s = i + (j + d) * fw; for (let k = 0; k < NB; k++) Wn.BP[k][i + j * fw] += tmp[k][s] * w; }
      }
      return Wn;
    }
    function pointFields(Wn, i, x, z) {
      const reg = rank(Q.r, rawRegion(x, z)), rb = regionBias(reg);
      const rc = rawCont(warpX(x, z), warpZ(x, z), 5);
      Wn.RC[i] = rc; Wn.CM[i] = mapCont(rc); Wn.REG[i] = reg;
      Wn.E[i] = 2 * rank(Q.e, rawEro(x, z, 3) + rb[0]) - 1;
      const w = rawWeird(x, z, 3); Wn.W[i] = w; Wn.PV[i] = PV_OF(rank(Q.w, abs(w)));
      Wn.T0[i] = T_OF(rank(Q.t, rawTemp(x, z)));
      Wn.M0[i] = rank(Q.m, rawHum(x, z) + rb[1]);
      Wn.V[i] = rank(Q.v, rawVar(x, z));
      Wn.G[i] = rank(Q.g, rawGeo(x, z));
      // Rain shadow: prevailing wind blows toward +x; high ground upwind dries the air.
      Wn.UP[i] = max(elevEstimate(x - 64, z), elevEstimate(x - 144, z));
    }
    const ctx = {};
    function derive(Wn, i) {
      const fw = Wn.fw;
      const gx = (Wn.RC[i + 1] - Wn.RC[i - 1]) / 8, gz = (Wn.RC[i + fw] - Wn.RC[i - fw]) / 8;
      const g = sqrt(gx * gx + gz * gz);
      const dcoast = clamp((Wn.RC[i] - RC0) / (g > 1e-9 ? g : 1e-9), -999, 999);
      const wx = (Wn.W[i + 1] - Wn.W[i - 1]) / 8, wz = (Wn.W[i + fw] - Wn.W[i - fw]) / 8;
      Wn.GW[i] = sqrt(wx * wx + wz * wz) + 1e-9;
      Wn.DC[i] = dcoast;
      const e = Wn.E[i], c = Wn.CM[i], pv = Wn.PV[i];
      const land = sstep(-2, lerp(8, 70, sstep(-0.7, 0.4, e)), dcoast);
      const relief = A_ERO(e) * land;
      const h0 = H_CONT(c) + relief * pvShape(pv);
      const elev = h0 - SEA;
      const shadow = clamp((Wn.UP[i] - max(elev, 0) - 5) * 0.012, 0, 0.3);
      const m = clamp01(Wn.M0[i] + 0.06 * (1 - sstep(0, 0.45, c)) - 0.14 * sstep(0.45, 1, c) - shadow);
      const tH = Wn.T0[i] - LAPSE * max(0, elev - 4);
      Wn.REL[i] = relief; Wn.H0[i] = h0; Wn.M[i] = m; Wn.TH[i] = tH;
      ctx.c = c; ctx.e = e; ctx.pv = pv; ctx.elev = elev; ctx.relief = relief; ctx.t = Wn.T0[i]; ctx.tH = tH; ctx.m = m; ctx.v = Wn.V[i]; ctx.dcoast = dcoast;
      ctx.upland = H_CONT(c) - SEA + relief * 0.45;
      Wn.LBL[i] = resolve(ctx, null);
    }
    // The land outcome a coast point would have (used when a jittered coast label lands on a column that is not shore).
    function landLabelAt(Wn, i) {
      ctx.c = max(0.02, Wn.CM[i]); ctx.e = Wn.E[i]; ctx.pv = Wn.PV[i]; ctx.elev = max(3, Wn.H0[i] - SEA); ctx.relief = Wn.REL[i];
      ctx.t = Wn.T0[i]; ctx.tH = Wn.TH[i]; ctx.m = Wn.M[i]; ctx.v = Wn.V[i]; ctx.dcoast = 999; ctx.upland = H_CONT(ctx.c) - SEA + Wn.REL[i] * 0.45;
      return resolve(ctx, null);
    }

    // ================================================================ columns
    // Column results for a rectangle, stored in flat arrays indexed (x - xa) + (z - za) * cw.
    const FAM = OUTCOMES.map(o => o.family);
    const IS_OCEAN = OUTCOMES.map(o => o.family === 'ocean'), IS_COAST = OUTCOMES.map(o => o.family === 'coast');
    // With step > 1 only every step-th column is computed (index (x - xa) / step + (z - za) / step * cw).
    function makeColumns(xa, za, xb, zb, step) {
      step = step || 1;
      const cxa = floor(xa / 4), cza = floor(za / 4), cxb = floor(xb / 4) + 1, czb = floor(zb / 4) + 1;
      const Wn = makeWindow(cxa, cza, cxb, czb);
      const cw = floor((xb - xa) / step) + 1, ch = floor((zb - za) / step) + 1, n = cw * ch;
      const Cc = { xa, za, xb, zb, cw, ch, step, Wn, H: new Int16Array(n), L: new Int16Array(n), HF: new Float64Array(n), T0: new Float64Array(n), M: new Float64Array(n),
        CM: new Float64Array(n), E: new Float64Array(n), PV: new Float64Array(n), REL: new Float64Array(n), RD: new Float64Array(n), HW: new Float64Array(n),
        DC: new Float64Array(n), G: new Float64Array(n), TREE: new Float64Array(n), PLANT: new Float64Array(n), V: new Float64Array(n), W: new Float64Array(n) };
      for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) column(Cc, Wn, xa + i * step, za + j * step, i + j * cw);
      return Cc;
    }
    function column(Cc, Wn, x, z, o) {
      const gx = floor(x / 4), gz = floor(z / 4), fx = (x - gx * 4) / 4, fz = (z - gz * 4) / 4;
      const fw = Wn.fw, i00 = (gx - Wn.gx0) + (gz - Wn.gz0) * fw, i10 = i00 + 1, i01 = i00 + fw, i11 = i01 + 1;
      const w00 = (1 - fx) * (1 - fz), w10 = fx * (1 - fz), w01 = (1 - fx) * fz, w11 = fx * fz;
      const bil = A => A[i00] * w00 + A[i10] * w10 + A[i01] * w01 + A[i11] * w11;
      const h0 = bil(Wn.H0), rel = bil(Wn.REL), c = bil(Wn.CM), pv = bil(Wn.PV), t0 = bil(Wn.T0), m = bil(Wn.M), e = bil(Wn.E);
      const wv = bil(Wn.W), gw = bil(Wn.GW), dc = bil(Wn.DC);
      const BP = Wn.BP, bp = k => BP[k][i00] * w00 + BP[k][i10] * w10 + BP[k][i01] * w01 + BP[k][i11] * w11;
      const hAdd = bp(0), flat = bp(1), flatT = bp(2), terrace = bp(3), plateau = bp(4), dune = bp(5), rough = bp(6);

      // ---- height: base + detail + blended profile, then soft cap and river carving
      const d1 = Nd.n2(x / 53, z / 53), d2 = Nd.n2(x / 21 + 40.3, z / 21 - 12.9);
      let h = h0 + (d1 * 0.68 + d2 * 0.32) * (1.2 + 0.1 * rel + rough) * (c < 0 ? 0.7 : 1);
      if (rel > 10) { const j = 1 - abs(Nj.n2(x / 27, z / 27)); h += (j - 0.45) * (rel - 10) * 0.35 * sstep(0.1, 0.9, pv); }
      h += hAdd;
      if (dune > 0.01) {
        const q = Ndu.n2(x / 30 + 0.4 * Ndu.n2(x / 97, z / 97 + 9.1), z / 70);
        const r = 1 - abs(q);
        h += dune * (r * r * 1.25 - 0.45);
      }
      if (terrace > 0.01 && h > SEA + 2) {
        const s = 6, f = (h - SEA) / s, k = floor(f), r = f - k;
        h = lerp(h, SEA + (k + sstep(0.7, 1, r)) * s, terrace);
      }
      if (plateau > 0.01) {
        const cap = SEA + 15 + 2 * Nd.n2(x / 70 + 13.3, z / 70);
        if (h > cap) h = lerp(h, cap + (h - cap) * 0.15, plateau);
      }
      if (flat > 0.01) {
        const tgt = SEA + flatT / flat + 1.3 * Np.n2(x / 11 + 5.5, z / 11);
        h = lerp(h, tgt, flat);
      }
      if (h > 58) h = 58 + 16 * (h - 58) / (h - 58 + 16);
      // Rivers follow the zero line of the weirdness field (valleys); banks widen into valleys in high ground.
      const rd = abs(wv) / gw;
      const hw = 2.2 + 2.6 * (1 - sstep(0.05, 0.7, c)) + 0.8 * Nb.n2(x / 61, z / 61);
      if (c > -0.08) {
        const s = clamp((h0 - SEA) / 26, 0.3, 1.25);
        const q = rd / hw;
        const prof = rd < hw ? SEA - 1.2 - 2.3 * (1 - q * q) : SEA + 0.35 + (rd - hw) * s;
        if (prof < h) h = prof;
      }
      if (h < 6) h = 6;
      const H = floor(h);

      // ---- label: jittered nearest grid label (dithered borders), then hydrology and shore overrides
      const jx = 4.5 * Nx.n2(x / 13, z / 13) + (hash2(x, z, 91) - 0.5) * 2.5;
      const jz = 4.5 * Nx.n2(x / 13 + 57.1, z / 13 - 21.7) + (hash2(x, z, 92) - 0.5) * 2.5;
      const lx = round((x + jx) / 4) - Wn.gx0, lz = round((z + jz) / 4) - Wn.gz0, li = lx + lz * fw;
      let L = Wn.LBL[li];
      const bw = 5 + 3 * Nb.n2(x / 90 + 7.7, z / 90);
      const coastCol = dc < bw + 4 && H >= SEA - 4 && H <= SEA + 2;
      if (IS_OCEAN[L]) {
        if (H >= SEA) L = coastOutcome(rel, t0);
      } else if (coastCol && rel < 20) {
        L = coastOutcome(rel, t0);
      } else if (IS_COAST[L]) {
        L = H < SEA - 1 ? (t0 < -2 ? OI.frozen_ocean : OI.ocean) : landLabelAt(Wn, li);
      }
      if (rd < hw + 0.8 && H < SEA && c > -0.05 && !IS_OCEAN[L]) L = t0 < -1 ? OI.frozen_river : OI.river;

      Cc.H[o] = H; Cc.HF[o] = h; Cc.L[o] = L; Cc.T0[o] = t0; Cc.M[o] = m; Cc.CM[o] = c; Cc.E[o] = e; Cc.PV[o] = pv; Cc.REL[o] = rel;
      Cc.RD[o] = rd; Cc.HW[o] = hw; Cc.DC[o] = dc; Cc.G[o] = bil(Wn.G); Cc.V[o] = bil(Wn.V); Cc.W[o] = wv;
      Cc.TREE[o] = bp(7); Cc.PLANT[o] = bp(8);
    }
    function coastOutcome(rel, t0) { return rel >= 12 ? OI.stony_shore : t0 < -1 ? OI.snowy_beach : OI.beach; }

    // ---- surface materials for one column (needs its slope). Writes into S.
    const S = { top: 0, filler: 0, depth: 3, under: 0, underDepth: 0, bands: false, snow: false, freeze: false, bank: false };
    const patchNoise = (x, z, k) => (k === 0 ? 0.5 + 0.5 * Np.n2(x / 9.3, z / 9.3) : 0.5 + 0.5 * Np.n2(x / 23.7 + 101.1, z / 23.7 - 44.4)) + (hash2(x, z, 31 + k) - 0.5) * 0.08;
    function surface(Cc, o, x, z, slope) {
      const L = Cc.L[o], out = OUTCOMES[L], ob = OB[L], H = Cc.H[o];
      const tSurf = Cc.T0[o] - LAPSE * max(0, H - SEA - 4) + (hash2(x, z, 41) - 0.5) * 2.5;
      S.bands = out.bands; S.under = ob.under; S.underDepth = out.underDepth; S.depth = out.depth; S.bank = false;
      S.freeze = out.freeze || (Cc.T0[o] < -1.5 && out.snow !== 'never');
      if (H < SEA) {   // underwater floor
        let top = SEA - H <= 3 ? ob.floor : ob.floorDeep;
        for (const [b, t, k] of ob.floorPatches) if (patchNoise(x, z, k) > t) { top = b; break; }
        S.top = top; S.filler = top === ID.mud || top === ID.clay ? ID.dirt : top; S.depth = 3; S.snow = false;
        if (S.bands) { S.bands = false; }
        return;
      }
      let top = ob.top, filler = ob.filler;
      for (const [b, t, k] of ob.patches) if (patchNoise(x, z, k) > t) { top = b; break; }
      if (slope >= out.steepAt) { top = ob.steep; filler = top === BANDS_ID || LOOSE.has(top) ? top : STONE; S.depth = 2; }
      // River banks: sand and gravel along the water's edge.
      if (Cc.RD[o] < Cc.HW[o] + 2.2 && H <= SEA + 1 && GRASSY.has(top) && !IS_COAST[L]) {
        top = patchNoise(x, z, 1) > 0.6 ? ID.gravel : ID.sand; filler = top; S.bank = true;
      }
      let snow = out.snow === 'always' || (out.snow === 'auto' && tSurf < 0);
      if (snow) {
        if (GRASSY.has(top)) top = ID.snowy_grass_block;
        else if (SNOWABLE_ROCK.has(top) && slope < 3 && (out.snow === 'always' || tSurf < -3)) top = ID.snow_block;
      }
      S.top = top; S.filler = filler; S.snow = snow;
    }

    // ---- geology: regional rock strata and ore weights
    const PROVINCES = ['stone', 'limestone', 'granite', 'slate'];
    const provinceOf = g => (g < 0.4 ? 0 : g < 0.62 ? 1 : g < 0.82 ? 2 : 3);
    const PROV_ORES = [{ coal: 1, iron: 1, gold: 1, diamond: 1 }, { coal: 1.5, iron: 0.7, gold: 0.6, diamond: 0.8 },
      { coal: 0.7, iron: 1.5, gold: 1.6, diamond: 1 }, { coal: 1, iron: 1.2, gold: 1, diamond: 1.4 }];
    function rockAt(prov, y, off) {
      const yy = y + off;
      if (yy < 9) return ID.slate;
      if (prov === 1) return yy > 15 && floor(yy / 5) % 3 !== 0 ? ID.limestone : STONE;
      if (prov === 2) return floor((yy + 3) / 8) % 2 === 0 ? ID.granite : STONE;
      if (prov === 3) return yy < 30 ? ID.slate : STONE;
      return yy > 20 && floor(yy / 11) % 4 === 1 ? ID.granite : STONE;
    }
    // Badlands bands: a seeded palette repeating every 16 blocks, offset per column so bands wave gently.
    const BAND_PAL = (() => {
      const r = mulberry32(subSeed(seed, 500)), cols = [ID.terracotta, ID.orange_terracotta, ID.terracotta, ID.yellow_terracotta, ID.red_terracotta, ID.terracotta, ID.white_terracotta, ID.brown_terracotta];
      const out = []; for (let i = 0; i < 16; i++) out.push(cols[(r() * cols.length) | 0]);
      out[3] = ID.white_terracotta; out[9] = ID.red_terracotta; out[12] = ID.orange_terracotta;
      return out;
    })();
    const bandAt = (y, off) => BAND_PAL[((y + off) % 16 + 16) % 16];

    // ================================================================ chunk generation
    const M = 6;   // feature margin: trees and boulders up to 6 blocks from their trunk column
    function generateChunk(cx, cz) {
      const x0 = cx * CS, z0 = cz * CS;
      const data = new Uint8Array(CS * CS * WH);
      // Columns for the chunk plus margin (features) plus one ring (slopes).
      const Cc = makeColumns(x0 - M - 1, z0 - M - 1, x0 + CS + M, z0 + CS + M);
      const cw = Cc.cw, at = (x, z) => (x - Cc.xa) + (z - Cc.za) * cw;
      // Surface per column of the feature window (slope from integer heights of 4 neighbours).
      const nW = (CS + 2 * M) * (CS + 2 * M);
      const TOP = new Int16Array(nW), FIL = new Int16Array(nW), DEP = new Int8Array(nW), UND = new Int16Array(nW), UDEP = new Int8Array(nW);
      const FLG = new Uint8Array(nW), SLP = new Int8Array(nW);
      const WW = CS + 2 * M, wi = (x, z) => (x - x0 + M) + (z - z0 + M) * WW;
      for (let z = z0 - M; z < z0 + CS + M; z++) for (let x = x0 - M; x < x0 + CS + M; x++) {
        const o = at(x, z), H = Cc.H[o];
        const slope = max(abs(Cc.H[o - 1] - H), abs(Cc.H[o + 1] - H), abs(Cc.H[o - cw] - H), abs(Cc.H[o + cw] - H));
        surface(Cc, o, x, z, slope);
        const k = wi(x, z);
        TOP[k] = S.top; FIL[k] = S.filler; DEP[k] = S.depth; UND[k] = S.under; UDEP[k] = S.underDepth; SLP[k] = slope;
        FLG[k] = (S.bands ? 1 : 0) | (S.snow ? 2 : 0) | (S.freeze ? 4 : 0) | (S.bank ? 8 : 0);
      }

      // ---- caves: two noise lattices (tunnels and caverns) on a 4x4x4 grid, trilinear
      const LY = WH / 4 + 1, LN = 5 * 5 * LY;
      const CA = new Float64Array(LN), CB = new Float64Array(LN), CC = new Float64Array(LN);
      for (let ly = 0; ly < LY; ly++) for (let lz = 0; lz < 5; lz++) for (let lx = 0; lx < 5; lx++) {
        const X = x0 + lx * 4, Y = ly * 4, Z = z0 + lz * 4, k = lx + lz * 5 + ly * 25;
        CA[k] = Nk1.n3(X / 32, Y / 19, Z / 32); CB[k] = Nk2.n3(X / 32, Y / 19, Z / 32 + 100); CC[k] = Nk3.n3(X / 60, Y / 26, Z / 60);
      }
      const tri3 = (A, lx, y, lz) => {
        const ix = lx >> 2, iz = lz >> 2, iy = y >> 2, fx = (lx & 3) / 4, fz = (lz & 3) / 4, fy = (y & 3) / 4;
        const k = ix + iz * 5 + iy * 25;
        const a = A[k] + (A[k + 1] - A[k]) * fx, b = A[k + 5] + (A[k + 6] - A[k + 5]) * fx;
        const c = A[k + 25] + (A[k + 26] - A[k + 25]) * fx, d = A[k + 30] + (A[k + 31] - A[k + 30]) * fx;
        const p = a + (b - a) * fz, q = c + (d - c) * fz;
        return p + (q - p) * fy;
      };

      // ---- terrain voxels
      for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
        const x = x0 + lx, z = z0 + lz, o = at(x, z), k = wi(x, z), H = Cc.H[o], L = Cc.L[o], out = OUTCOMES[L], ob = OB[L];
        const prov = provinceOf(Cc.G[o]), off = round(2.5 * Ns.n2(x / 60, z / 60)), boff = round(1.6 * Nb.n2(x / 80 + 3.3, z / 80));
        const flg = FLG[k], top = TOP[k], fil = FIL[k], dep = DEP[k], und = UND[k], udep = UDEP[k];
        const PO = PROV_ORES[prov], OR = ob.ores;
        const rCoal = 0.011 * PO.coal * OR.coal, rIron = 0.006 * PO.iron * OR.iron, rGold = 0.0025 * PO.gold * OR.gold, rDia = 0.0012 * PO.diamond * OR.diamond;
        const caveMul = out.caves * (prov === 1 ? 1.35 : 1), cavern = prov === 1 ? 0.56 : 0.64;
        const sealed = H <= SEA + 1;
        const topY = max(H, SEA);
        for (let y = 0; y <= topY; y++) {
          let id = AIR;
          if (y === 0 || (y <= 2 && hash3(x, y, z, 7) < 0.5)) id = BEDROCK;
          else if (y <= H) {
            const d = H - y;
            if (d === 0) id = top === BANDS_ID ? bandAt(y, boff) : top;
            else if (d < dep) id = fil === BANDS_ID ? bandAt(y, boff) : fil;
            else if ((flg & 1) && y >= SEA - 6) id = bandAt(y, boff);
            else if (d < dep + udep) id = und;
            else id = rockAt(prov, y, off);
            if (ROCKY.has(id)) {
              // Ores in 2x2x2 clusters: one hash per cell picks the ore (top 24 bits) and which of its 8 voxels take
              // it (low 8 bits as a mask), so the mean rate per voxel stays r.
              const hc = hashInt3(x >> 1, y >> 1, z >> 1, 11);
              if ((hc >>> ((x & 1) | ((y & 1) << 1) | ((z & 1) << 2))) & 1) {
                const q = (hc >>> 8) * (0.5 / 16777216);
                if (q < rCoal) id = ID.coal_ore;
                else if (y < 40 && q < rCoal + rIron) id = ID.iron_ore;
                else if (y < 24 && q < rCoal + rIron + rGold) id = ID.gold_ore;
                else if (y < 15 && q < rCoal + rIron + rGold + rDia) id = ID.diamond_ore;
              }
            }
            if (y > 3 && (!sealed || d > 5)) {
              const a = tri3(CA, lx, y, lz), b = tri3(CB, lx, y, lz);
              const t2 = a * a + b * b;
              if (t2 < (d < 3 ? 0.0012 : 0.011) * caveMul || (d > 6 && tri3(CC, lx, y, lz) > cavern)) id = AIR;
            }
          } else if (y <= SEA) id = y === SEA && (flg & 4) && !(IS_OCEAN[L] && Np.n2(x / 17, z / 17) > 0.55) ? ID.ice : WATER;
          data[IDX(lx, y, lz)] = id;
        }
      }

      // ---- features: trees, plants, boulders, spikes, coral, fallen logs (window order is world order)
      const put = (wx, y, wz, id, force) => {
        const lx = wx - x0, lz = wz - z0;
        if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || y < 1 || y >= WH) return;
        const i = IDX(lx, y, lz), cur = data[i];
        if (force || cur === AIR || (cur !== WATER && BB.DEFS[cur] && BB.DEFS[cur].plant)) data[i] = id;
      };
      const T = { put, log: (x, y, z, id) => put(x, y, z, id, true), leaf: (x, y, z, id) => put(x, y, z, id, false),
        // ice and reef blocks: replace air, water and ice only
        ice: (wx, y, wz, id) => { const lx = wx - x0, lz = wz - z0; if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || y < 1 || y >= WH) return; const i = IDX(lx, y, lz), c = data[i]; if (c === AIR || c === WATER || c === ID.ice) data[i] = id; } };
      for (let z = z0 - M; z < z0 + CS + M; z++) for (let x = x0 - M; x < x0 + CS + M; x++) {
        const o = at(x, z), k = wi(x, z), H = Cc.H[o], L = Cc.L[o], out = OUTCOMES[L], ob = OB[L], top = TOP[k];
        const inside = x >= x0 && x < x0 + CS && z >= z0 && z < z0 + CS;
        const dry = H >= SEA + 1 && !(FLG[k] & 8);
        if (!dry) {
          if (out.coral && H < SEA - 2 && hash2(x, z, 61) < out.coral) coral(T, x, H, z, mulberry32(hashInt(x, z, 62)));
          else if (out.iceberg && H < SEA - 3 && hash2(x, z, 68) < out.iceberg) iceberg(T, x, z, mulberry32(hashInt(x, z, 69)));
          continue;
        }
        const soil = GRASSY.has(top) || top === ID.snowy_grass_block;
        const u = hash2(x, z, 51);
        let dens = Cc.TREE[o]; if (SLP[k] >= 3) dens *= 0.25;
        if (soil && u < dens && ob.species.length) { tree(T, pick(ob.species, hash2(x, z, 52)), x, H, z, mulberry32(hashInt(x, z, 53))); continue; }
        if (out.cactus && (top === ID.sand || top === ID.red_sand) && hash2(x, z, 54) < out.cactus) {
          const n = 1 + ((hash2(x, z, 55) * 3) | 0); for (let i = 1; i <= n; i++) T.log(x, H + i, z, ID.cactus); continue;
        }
        if (out.spike && hash2(x, z, 56) < out.spike) { iceSpike(T, x, H, z, mulberry32(hashInt(x, z, 57))); continue; }
        if (out.boulder && hash2(x, z, 58) < out.boulder && SLP[k] < 3) { boulder(T, x, H, z, ob.boulder, mulberry32(hashInt(x, z, 59))); continue; }
        if (out.fallen && soil && hash2(x, z, 63) < out.fallen) {
          // A fallen log is at most 5 long in +x or +z, so only origins that can reach this chunk are built (their
          // height checks then stay inside the column window).
          if (x >= x0 - 5 && x < x0 + CS && z >= z0 - 5 && z < z0 + CS) fallenLog(T, Cc, at, x, H, z, mulberry32(hashInt(x, z, 64)), speciesLog(pick(ob.species, hash2(x, z, 65))));
          continue;
        }
        if (inside && hash2(x, z, 66) < Cc.PLANT[o] && ob.plants.length) {
          const p = pick(ob.plants, hash2(x, z, 67));
          const onSand = top === ID.sand || top === ID.red_sand || top === ID.coarse_dirt || top === ID.dry_grass_block;
          const snowy = top === ID.snowy_grass_block;
          if (p === ID.dry_shrub ? (onSand || soil) : soil && (!snowy || p === ID.berry_bush || p === ID.fern)) T.leaf(x, H + 1, z, p);
        }
      }
      return data;
    }

    // ---- trees and local features. Every builder draws the same random numbers whatever chunk it is clipped to.
    const LOG = { oak: B.OAK_LOG, spruce: 0, birch: 0, acacia: 0, mahogany: 0, willow: 0 };
    const LEAF = { oak: B.OAK_LEAVES };
    for (const s of ['spruce', 'birch', 'acacia', 'mahogany', 'willow']) { LOG[s] = ID[s + '_log']; LEAF[s] = ID[s + '_leaves']; }
    const speciesLog = sp => (sp === 'birch' || sp === 'birch_tall' ? LOG.birch : sp === 'spruce' || sp === 'spruce_small' ? LOG.spruce : sp === 'willow' ? LOG.willow : sp === 'mahogany' ? LOG.mahogany : LOG.oak);
    function tree(T, sp, x, h, z, r) {
      switch (sp) {
        case 'oak': return roundTree(T, x, h, z, r, 4, 3, LOG.oak, LEAF.oak, false);
        case 'oak_tall': return roundTree(T, x, h, z, r, 6, 3, LOG.oak, LEAF.oak, true);
        case 'birch': return roundTree(T, x, h, z, r, 5, 3, LOG.birch, LEAF.birch, false, true);
        case 'birch_tall': return roundTree(T, x, h, z, r, 9, 4, LOG.birch, LEAF.birch, true, true);
        case 'spruce': return spruce(T, x, h, z, r, false);
        case 'spruce_small': return spruce(T, x, h, z, r, true);
        case 'acacia': return acacia(T, x, h, z, r);
        case 'mahogany': return mahogany(T, x, h, z, r);
        case 'willow': return willow(T, x, h, z, r);
        case 'bush': return bush(T, x, h, z, r, LOG.oak, LEAF.oak);
        case 'jungle_bush': return bush(T, x, h, z, r, LOG.mahogany, LEAF.mahogany);
      }
    }
    function roundTree(T, x, h, z, r, minH, varH, log, leaf, tall, narrow) {
      const th = minH + ((r() * varH) | 0); let ty = h + th;
      if (ty + 2 >= WH) ty = WH - 3;
      const low = tall ? ty - 3 : ty - 2;
      for (let ly = low; ly <= ty + 1; ly++) {
        const rad = ly <= ty - 1 ? 2 : 1;
        for (let oz = -rad; oz <= rad; oz++) for (let ox = -rad; ox <= rad; ox++) {
          const corner = abs(ox) === rad && abs(oz) === rad;
          const cut = r() < 0.5;
          if (corner && (ly === ty + 1 || rad === 1 || narrow || cut)) continue;
          T.leaf(x + ox, ly, z + oz, leaf);
        }
      }
      for (let y = h + 1; y <= ty; y++) T.log(x, y, z, log);
    }
    const SPRUCE_R = [1, 1, 2, 1, 2, 2, 1, 2, 3, 2, 2, 3];
    function spruce(T, x, h, z, r, small) {
      const th = small ? 3 + ((r() * 2) | 0) : 7 + ((r() * 4) | 0);
      let ty = h + th; if (ty + 2 >= WH) ty = WH - 3;
      const bottom = h + (small ? 1 : 2 + ((r() * 2) | 0)), maxR = small ? 1 : 3;
      T.leaf(x, ty + 1, z, LEAF.spruce);
      for (let ly = ty, k = 0; ly >= bottom; ly--, k++) {
        const rad = min(SPRUCE_R[min(k, SPRUCE_R.length - 1)], maxR);
        for (let oz = -rad; oz <= rad; oz++) for (let ox = -rad; ox <= rad; ox++) {
          const ax = abs(ox), az = abs(oz);
          if (rad >= 2 && ax === rad && az === rad) continue;
          if (rad === 3 && ax + az > 4) continue;
          if (k === 0 && ax + az > 1) continue;
          T.leaf(x + ox, ly, z + oz, LEAF.spruce);
        }
      }
      for (let y = h + 1; y <= ty; y++) T.log(x, y, z, LOG.spruce);
    }
    function acacia(T, x, h, z, r) {
      const straight = 2 + ((r() * 2) | 0), dir = (r() * 4) | 0, lean = 1 + ((r() * 2) | 0);
      const dx = [1, -1, 0, 0][dir], dz = [0, 0, 1, -1][dir];
      let cx = x, cz = z, y = h + 1;
      for (let i = 0; i < straight; i++) T.log(cx, y++, cz, LOG.acacia);
      for (let i = 0; i < lean; i++) { cx += dx; cz += dz; T.log(cx, y++, cz, LOG.acacia); }
      const top = min(y, WH - 3);
      for (let oz = -3; oz <= 3; oz++) for (let ox = -3; ox <= 3; ox++) {
        const d = abs(ox) + abs(oz);
        if (d <= 4 && !(abs(ox) === 3 && abs(oz) === 3) && !(d === 4 && r() < 0.4)) T.leaf(cx + ox, top, cz + oz, LEAF.acacia);
        if (d <= 1 || (d === 2 && abs(ox) !== 2 && abs(oz) !== 2)) T.leaf(cx + ox, top + 1, cz + oz, LEAF.acacia);
      }
      T.log(cx, top - 1, cz, LOG.acacia);
      // A second, shorter branch on the opposite side.
      if (r() < 0.5) {
        const bx = x - dx, bz = z - dz, by = h + straight;
        T.log(bx, by, bz, LOG.acacia); T.log(bx - dx, by + 1, bz - dz, LOG.acacia);
        for (let oz = -2; oz <= 2; oz++) for (let ox = -2; ox <= 2; ox++) if (abs(ox) + abs(oz) <= 3) T.leaf(bx - dx + ox, by + 2, bz - dz + oz, LEAF.acacia);
      }
    }
    function mahogany(T, x, h, z, r) {
      const th = 9 + ((r() * 5) | 0);
      let ty = h + th; if (ty + 3 >= WH) ty = WH - 4;
      if (ty - h < 5) return bush(T, x, h, z, r, LOG.mahogany, LEAF.mahogany);
      const layers = [[ty - 1, 3], [ty, 3], [ty + 1, 2], [ty + 2, 1]];
      for (const [ly, rad] of layers) for (let oz = -rad; oz <= rad; oz++) for (let ox = -rad; ox <= rad; ox++) {
        const d2 = ox * ox + oz * oz;
        if (d2 > rad * rad + 1) continue;
        if (d2 === rad * rad + 1 && r() < 0.5) continue;
        T.leaf(x + ox, ly, z + oz, LEAF.mahogany);
      }
      // hanging leaves under the canopy edge
      for (let oz = -3; oz <= 3; oz++) for (let ox = -3; ox <= 3; ox++) {
        const d2 = ox * ox + oz * oz, len = r() < 0.3 ? 1 + ((r() * 3) | 0) : 0;
        if (d2 < 7 || d2 > 10) continue;
        for (let i = 1; i <= len; i++) T.leaf(x + ox, ty - 1 - i, z + oz, LEAF.mahogany);
      }
      // side tufts along the trunk
      for (let k = 0; k < 3; k++) {
        const ly = h + 3 + ((r() * max(1, th - 6)) | 0), d = (r() * 4) | 0, dx = [1, -1, 0, 0][d], dz = [0, 0, 1, -1][d];
        T.leaf(x + dx, ly, z + dz, LEAF.mahogany); T.leaf(x + dx * 2, ly, z + dz * 2, LEAF.mahogany); T.leaf(x + dx, ly + 1, z + dz, LEAF.mahogany);
      }
      for (let y = h + 1; y <= ty; y++) T.log(x, y, z, LOG.mahogany);
    }
    function willow(T, x, h, z, r) {
      const th = 4 + ((r() * 3) | 0);
      let ty = h + th; if (ty + 3 >= WH) ty = WH - 4;
      for (const [ly, rad] of [[ty, 3], [ty + 1, 2], [ty + 2, 1]]) for (let oz = -rad; oz <= rad; oz++) for (let ox = -rad; ox <= rad; ox++) {
        const d2 = ox * ox + oz * oz; if (d2 > rad * rad + 1) continue;
        T.leaf(x + ox, ly, z + oz, LEAF.willow);
      }
      for (let oz = -3; oz <= 3; oz++) for (let ox = -3; ox <= 3; ox++) {
        const d2 = ox * ox + oz * oz, len = r() < 0.55 ? 1 + ((r() * 3) | 0) : 0;
        if (d2 < 5 || d2 > 10) continue;
        for (let i = 1; i <= len && ty - i > h; i++) T.leaf(x + ox, ty - i, z + oz, LEAF.willow);
      }
      for (let y = h + 1; y <= ty; y++) T.log(x, y, z, LOG.willow);
    }
    function bush(T, x, h, z, r, log, leaf) {
      T.log(x, h + 1, z, log);
      for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
        if (ox || oz) { if (!(abs(ox) === 1 && abs(oz) === 1 && r() < 0.5)) T.leaf(x + ox, h + 1, z + oz, leaf); }
        if (!(ox && oz)) T.leaf(x + ox, h + 2, z + oz, leaf);
      }
    }
    function boulder(T, x, h, z, id, r) {
      const rad = 1 + (r() < 0.35 ? 1 : 0);
      for (let dy = -1; dy <= rad; dy++) for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
        const d = dx * dx + dy * dy * 1.4 + dz * dz, cut = r();
        if (d <= rad * rad + 0.6 && !(d > rad * rad - 0.6 && cut < 0.35)) T.put(x + dx, h + 1 + dy, z + dz, id, false);
      }
    }
    function iceSpike(T, x, h, z, r) {
      const len = 4 + ((r() * 11) | 0), thick = len > 9 ? 1 : 0;
      for (let i = 1; i <= len && h + i < WH - 1; i++) {
        T.put(x, h + i, z, ID.packed_ice, true);
        if (thick && i < len * 0.55) { T.put(x + 1, h + i, z, ID.packed_ice, false); T.put(x - 1, h + i, z, ID.packed_ice, false); T.put(x, h + i, z + 1, ID.packed_ice, false); T.put(x, h + i, z - 1, ID.packed_ice, false); }
      }
    }
    function iceberg(T, x, z, r) {
      const rad = 2 + ((r() * 3) | 0), up = 2 + ((r() * 5) | 0), down = 2 + ((r() * 3) | 0);
      for (let dy = -down; dy <= up; dy++) {
        const k = dy > 0 ? 1 - dy / (up + 1) : 1 - (-dy) / (down + 2), rr = rad * k + 0.5;
        for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
          const cut = r();
          if (dx * dx + dz * dz > rr * rr || (dx * dx + dz * dz > (rr - 1) * (rr - 1) && cut < 0.3)) continue;
          T.ice(x + dx, SEA + dy, z + dz, dy === up || (dy > 0 && cut > 0.85) ? ID.snow_block : ID.packed_ice);
        }
      }
    }
    function coral(T, x, h, z, r) {
      const id = r() < 0.5 ? ID.pink_coral_block : ID.blue_coral_block, n = 1 + ((r() * 3) | 0);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const up = (dx === 0 && dz === 0) ? n : (r() < 0.45 ? 1 : 0);
        for (let i = 1; i <= up && h + i < SEA - 1; i++) T.ice(x + dx, h + i, z + dz, id);
      }
    }
    function fallenLog(T, Cc, at, x, h, z, r, log) {
      const len = 3 + ((r() * 3) | 0), alongX = r() < 0.5;
      for (let i = 0; i < len; i++) { const px = alongX ? x + i : x, pz = alongX ? z : z + i; if (Cc.H[at(px, pz)] !== h) return; }
      for (let i = 0; i < len; i++) T.put(alongX ? x + i : x, h + 1, alongX ? z : z + i, log, false);
    }

    // ================================================================ inspection API
    function sampleFrom(Cc, x, z) {
      const o = (x - Cc.xa) + (z - Cc.za) * Cc.cw, H = Cc.H[o];
      const slope = max(abs(Cc.H[o - 1] - H), abs(Cc.H[o + 1] - H), abs(Cc.H[o - Cc.cw] - H), abs(Cc.H[o + Cc.cw] - H));
      surface(Cc, o, x, z, slope);
      const L = Cc.L[o], out = OUTCOMES[L];
      const tSurf = Cc.T0[o] - LAPSE * max(0, H - SEA - 4);
      const trace = {};
      ctx.c = Cc.CM[o]; ctx.e = Cc.E[o]; ctx.pv = Cc.PV[o]; ctx.elev = H - SEA; ctx.relief = Cc.REL[o]; ctx.t = Cc.T0[o]; ctx.tH = tSurf; ctx.m = Cc.M[o]; ctx.v = Cc.V[o]; ctx.dcoast = Cc.DC[o];
      ctx.upland = H_CONT(ctx.c) - SEA + ctx.relief * 0.45;
      resolve(ctx, trace);
      const topKey = S.top === BANDS_ID ? BB.DEFS[bandAt(H, round(1.6 * Nb.n2(x / 80 + 3.3, z / 80)))].key : BB.DEFS[S.top].key;
      return {
        x, z, height: H, water: H < SEA ? (S.freeze ? 'ice' : 'water') : null, waterDepth: max(0, SEA - H),
        biome: { key: out.key, name: out.name, family: out.family, base: out.base, variant: out.variant, color: out.color },
        surface: topKey, filler: S.filler === BANDS_ID ? 'terracotta' : BB.DEFS[S.filler].key,
        fields: {
          continentalness: Cc.CM[o], erosion: Cc.E[o], peaksValleys: Cc.PV[o], weirdness: Cc.W[o], temperature: Cc.T0[o], surfaceTemperature: tSurf,
          humidity: Cc.M[o], river: Cc.RD[o], riverHalfWidth: Cc.HW[o], coast: Cc.DC[o], elevation: H - SEA, slope, relief: Cc.REL[o], variant: Cc.V[o],
          treeDensity: Cc.TREE[o], plantDensity: Cc.PLANT[o], geology: PROVINCES[provinceOf(Cc.G[o])],
        },
        layers: { preset: pkey, landform: out.family === 'river' ? 'river' : out.family === 'coast' ? 'coast' : out.family === 'ocean' ? 'ocean' : trace.landform, climate: trace.climate,
          family: out.family, base: out.base, variant: out.variant, profile: profileName(out), geology: PROVINCES[provinceOf(Cc.G[o])], snow: S.snow, frozenWater: S.freeze },
      };
    }
    function profileName(o) {
      if (o.terrace) return 'terraced'; if (o.plateau) return 'plateau'; if (o.dune > 2) return 'dunes'; if (o.flat) return 'flat';
      if (o.family === 'mountains') return 'alpine'; if (o.rough >= 2) return 'hilly'; if (o.family === 'ocean') return 'sea floor'; return 'rolling';
    }
    function sample(x, z) {
      x = floor(x); z = floor(z);
      return sampleFrom(makeColumns(x - 1, z - 1, x + 1, z + 1), x, z);
    }
    // Bulk sampling for tools: calls fn(x, z, height, outcomeIndex, Cc, o) for columns on a grid of `step` blocks
    // starting at (xa, za), computed in tiles of about 256 blocks.
    function scan(xa, za, xb, zb, step, fn) {
      const TILE = max(step, floor(256 / step) * step);
      for (let tz = za; tz <= zb; tz += TILE) for (let tx = xa; tx <= xb; tx += TILE) {
        const ex = min(xb, tx + TILE - 1), ez = min(zb, tz + TILE - 1);
        const Cc = makeColumns(tx, tz, ex, ez, step);
        for (let j = 0; j < Cc.ch; j++) for (let i = 0; i < Cc.cw; i++) { const o = i + j * Cc.cw; fn(tx + i * step, tz + j * step, Cc.H[o], Cc.L[o], Cc, o); }
      }
    }
    const biomes = OUTCOMES.map(o => ({ key: o.key, name: o.name, family: o.family, base: o.base, variant: o.variant, color: o.color }));
    // Nearest column of an outcome: scan square rings of 128-block tiles outward, on a grid of `step` blocks.
    function locate(key, x, z, maxRadius) {
      const want = OI[key];
      if (want == null) return null;
      x = floor(x); z = floor(z);
      const R = maxRadius == null ? 2048 : maxRadius, TS2 = 128, step = 4;
      let best = null, bestD = Infinity;
      for (let ring = 0; ring * TS2 <= R + TS2; ring++) {
        if (best && (ring - 1) * TS2 > sqrt(bestD)) break;
        for (let tj = -ring; tj <= ring; tj++) for (let ti = -ring; ti <= ring; ti++) {
          if (max(abs(ti), abs(tj)) !== ring) continue;
          const xa = x + ti * TS2 - TS2 / 2, za = z + tj * TS2 - TS2 / 2;
          const Cc = makeColumns(xa, za, xa + TS2 - 1, za + TS2 - 1, step);
          for (let zz = za; zz < za + TS2; zz += step) for (let xx = xa; xx < xa + TS2; xx += step) {
            const o = (xx - xa) / step + (zz - za) / step * Cc.cw;
            if (Cc.L[o] !== want) continue;
            const d = (xx - x) * (xx - x) + (zz - z) * (zz - z);
            if (d < bestD && d <= R * R) { bestD = d; best = [xx, zz]; }
          }
        }
      }
      return best;
    }
    // Spawn: nearest dry, gentle column in a welcoming biome (with oak nearby for Survival), searching outward.
    const SPAWN_PREF = [['plains', 'forest_edge', 'meadow'], ['forest', 'birch_forest', 'savanna', 'steppe', 'taiga', 'highland_forest', 'forest_hills', 'rainforest_edge']];
    function findSpawn() {
      for (const pref of SPAWN_PREF) {
        const want = new Set(pref.map(k => OI[k]));
        for (let ring = 0; ring <= 12; ring++) {
          let best = null, bestD = Infinity;
          for (let tj = -ring; tj <= ring; tj++) for (let ti = -ring; ti <= ring; ti++) {
            if (max(abs(ti), abs(tj)) !== ring) continue;
            const xa = ti * 128 - 64, za = tj * 128 - 64;
            const Cc = makeColumns(xa, za, xa + 129, za + 129, 2);
            for (let j = 0; j < 64; j += 2) for (let i = 0; i < 64; i += 2) {
              const xx = xa + i * 2, zz = za + j * 2, o = i + j * Cc.cw, H = Cc.H[o];
              if (!want.has(Cc.L[o]) || H < SEA + 2 || H > SEA + 18 || Cc.TREE[o] > 0.03) continue;
              if (abs(Cc.H[o + 1] - H) > 1 || abs(Cc.H[o + Cc.cw] - H) > 1 || Cc.RD[o] < Cc.HW[o] + 4) continue;
              if (hash2(xx, zz, 51) < Cc.TREE[o]) continue;
              const d = xx * xx + zz * zz;
              if (d < bestD) { bestD = d; best = [xx, zz]; }
            }
          }
          if (best) return best;
        }
      }
      // Fallback: any dry column that is not a mountain, along eight directions.
      const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
      for (let r = 0; r < 4000; r += 16) for (const [dx, dz] of DIRS) {
        const s = sample(r * dx, r * dz);
        if (s.height >= SEA + 1 && !s.water && s.biome.family !== 'mountains') return [r * dx, r * dz];
        if (r === 0) break;
      }
      return [0, 0];
    }
    function terrainAt(x, z) { const s = sample(x, z); return [s.height, s.biome.key]; }

    return {
      version: 2, seed, preset: pkey, presetParams: Object.assign({}, P), generateChunk, findSpawn, sample, terrainAt, biomes, locate, scan,
      outcomeIndex: key => OI[key], families: FAMILIES.map(f => Object.assign({}, f)), quantiles: Q,
    };
  }

  BC.worldgen2 = { PRESETS, DEFAULT_PRESET, OUTCOMES, FAMILIES, LANDFORMS, MID, VARIANTS, T_EDGES, H_EDGES, create: createV2 };
  BC.worldgen.register(2, 'Biomes', seed => createV2(seed, DEFAULT_PRESET));
})(typeof window !== 'undefined' ? window : globalThis);
