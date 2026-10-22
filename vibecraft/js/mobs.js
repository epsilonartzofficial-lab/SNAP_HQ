'use strict';
// Creatures: species data, spawn tables, light adapter, physics, pathfinding, AI, spawning, despawning, combat
// against creatures, arrows and persistence. Pure logic with no DOM or three.js, so it runs in Node for tests.
// Rendering lives in mob-models.js, which the game hands to create() as `view`.
//
// Units follow the reference game: positions in blocks, velocities in blocks per tick, one tick = 1/20 s.
// Numbers come from docs/research/REFERENCE-NOTES.md section 2.4 unless a comment says otherwise.
(function (root) {
  const BC = root.BC;
  const { SOLID, LIQUID, OPAQUE, LIGHT, DEFS, B } = BC.blocks;
  const { WH } = BC.C;
  const SV = BC.survival;

  // ════════════════════════════════════════════════════════════════ time of day (tick 0 = sunrise, 24000 per day)
  // Sky light level track (timeline/day.json): 15 from tick 133 to 11867, linear down to 4 by 13670, 4 until 22330,
  // linear back to 15 at 24133 (tick 133 of the next day).
  function skyLevel(tick) {
    const t = ((tick % 24000) + 24000) % 24000;
    if (t >= 133 && t <= 11867) return 15;
    if (t > 11867 && t < 13670) return 15 - 11 * (t - 11867) / (13670 - 11867);
    if (t >= 13670 && t <= 22330) return 4;
    const u = t > 22330 ? t - 22330 : t + 24000 - 22330;   // 0 .. 1803
    return 4 + 11 * u / 1803;
  }
  const skyDarken = tick => Math.floor(15 - skyLevel(tick) + 1e-9);
  // Undead burn from tick 23460 to 12542 (the `monsters_burn` attribute).
  const monstersBurn = tick => { const t = ((tick % 24000) + 24000) % 24000; return t >= 23460 || t < 12542; };
  // Beds work when the sky is darkened by 4 or more (about ticks 12523 to 23477 in clear weather).
  const canSleepAt = tick => skyDarken(tick) >= 4;
  // Brightness 0..1 of a light level, as LightTexture.getBrightness with no ambient light: f / (4 - 3f).
  const brightness = level => { const f = Math.max(0, Math.min(15, level)) / 15; return f / (4 - 3 * f); };

  // ════════════════════════════════════════════════════════════════ light adapter
  // Worlds with the lighting engine expose getSkyLight / getBlockLight(x, y, z). Without it (a bare Node test world)
  // this falls back to a heuristic: a column open to the sky has sky light 15 (minus 1 per leaf, glass or water block
  // above), light spreads sideways under overhangs losing 1 per block (up to 4), anything else is dark; block light
  // is the brightest emitting block within 7 blocks minus the Manhattan distance, ignoring walls.
  function createLight(world) {
    const cache = new Map();
    let stamp = 0;
    const L = () => typeof world.getSkyLight === 'function' && typeof world.getBlockLight === 'function' ? world : null;   // the world's light engine
    function colSky(x, y, z) {
      const k = 'c' + x + ',' + y + ',' + z; const c = cache.get(k); if (c != null) return c;
      let s = 15;
      for (let yy = WH - 1; yy > y && s > 0; yy--) {
        const id = world.getBlock(x, yy, z);
        if (!id) continue;
        if (OPAQUE[id]) { s = 0; break; }
        s -= 1;
      }
      cache.set(k, s);
      return s;
    }
    function heurSky(x, y, z) {
      let best = colSky(x, y, z);
      if (best >= 15) return best;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (let k = 1; k <= 4; k++) {
          const cx = x + dx * k, cz = z + dz * k, id = world.getBlock(cx, y, cz);
          if (SOLID[id] && OPAQUE[id]) break;
          const s = colSky(cx, y, cz) - k;
          if (s > best) best = s;
          if (s >= 14) break;
        }
      }
      return Math.max(0, best);
    }
    function heurBlock(x, y, z) {
      const k = 'b' + x + ',' + y + ',' + z; const c = cache.get(k); if (c != null) return c;
      let best = 0;
      const own = LIGHT[world.getBlock(x, y, z)]; if (own) best = own;
      for (let dy = -7; dy <= 7; dy++) for (let dz = -7; dz <= 7; dz++) {
        const r = 7 - Math.abs(dy) - Math.abs(dz); if (r < 0) continue;
        for (let dx = -r; dx <= r; dx++) {
          const e = LIGHT[world.getBlock(x + dx, y + dy, z + dz)];
          if (!e) continue;
          const v = e - Math.abs(dx) - Math.abs(dy) - Math.abs(dz);
          if (v > best) best = v;
        }
      }
      cache.set(k, best);
      return best;
    }
    // Nothing solid (leaves and glass included) between this cell and the top of the world.
    function open(x, y, z) {
      const k = 'o' + x + ',' + y + ',' + z; const c = cache.get(k); if (c != null) return c;
      let v = true;
      for (let yy = WH - 1; yy > y; yy--) if (SOLID[world.getBlock(x, yy, z)]) { v = false; break; }
      cache.set(k, v);
      return v;
    }
    return {
      get usingLighting() { return !!L(); },
      sky(x, y, z) { const l = L(); return l ? l.getSkyLight(x, y, z) : heurSky(x, y, z); },
      block(x, y, z) { const l = L(); return l ? l.getBlockLight(x, y, z) : heurBlock(x, y, z); },
      // Straight up to the sky with nothing opaque above (used for daylight burning).
      seesSky(x, y, z) { return open(x, y, z); },
      // Call every tick; cached values expire after 2 s so block edits are picked up.
      tick() { if (++stamp % 40 === 0) cache.clear(); },
      clear() { cache.clear(); },
    };
  }

  // ════════════════════════════════════════════════════════════════ species
  // speed: movement speed attribute. Walking speed in blocks/s = 4.317 * (attribute * goal modifier)^2 / 0.098, derived
  // from the player's 4.317 m/s at attribute 0.1 with input 0.98 (Mob.setSpeed also sets the forward input) [D].
  // drops: {key, min, max} uniform counts; `chance` rolls once; `player` only when a player dealt the killing blow.
  const SPECIES = {
    pig: { name: 'Pig', cat: 'passive', health: 10, w: 0.9, h: 0.9, speed: 0.25, panic: 1.25, wander: 1.0,
      drops: [{ key: 'raw_pork', min: 1, max: 3 }] },
    cow: { name: 'Cow', cat: 'passive', health: 10, w: 0.9, h: 1.4, speed: 0.2, panic: 2.0, wander: 1.0, variants: 3,
      drops: [{ key: 'leather', min: 0, max: 2 }, { key: 'raw_beef', min: 1, max: 3 }] },
    sheep: { name: 'Sheep', cat: 'passive', health: 8, w: 0.9, h: 1.3, speed: 0.23, panic: 1.25, wander: 1.0, variants: 6,
      drops: [{ key: 'raw_mutton', min: 1, max: 2 }, { key: 'wool', min: 1, max: 1 }] },
    chicken: { name: 'Chicken', cat: 'passive', health: 4, w: 0.4, h: 0.7, speed: 0.25, panic: 1.4, wander: 1.0, slowFall: true,
      drops: [{ key: 'feather', min: 0, max: 2 }, { key: 'raw_chicken', min: 1, max: 1 }] },
    // Original hostiles. Mirewalker: a bog-born undead brawler (reference role: zombie).
    mirewalker: { name: 'Mirewalker', article: 'a', cat: 'hostile', health: 20, w: 0.6, h: 1.95, speed: 0.23, wander: 1.0, chase: 1.0,
      attack: 3, follow: 35, burns: true, ai: 'melee',
      drops: [{ key: 'mire_flesh', min: 0, max: 2 }, { key: 'iron_ingot', min: 1, max: 1, chance: 0.025, player: true }] },
    // Hollow Archer: a hooded, masked archer that shoots arrows (reference role: skeleton).
    hollow_archer: { name: 'Hollow Archer', article: 'a', cat: 'hostile', health: 20, w: 0.6, h: 1.99, speed: 0.25, wander: 1.0, chase: 1.0,
      follow: 16, burns: true, ai: 'ranged', range: 15,
      drops: [{ key: 'arrow', min: 0, max: 2 }, { key: 'bone', min: 0, max: 2 }] },
    // Cragskitter: a six-legged stone crawler that climbs walls and leaps; neutral in bright light (reference role: spider).
    cragskitter: { name: 'Cragskitter', article: 'a', cat: 'hostile', health: 16, w: 1.4, h: 0.9, speed: 0.3, wander: 0.8, chase: 1.0,
      attack: 2, follow: 16, climbs: true, leaps: true, neutralInLight: true, ai: 'melee',
      drops: [{ key: 'silk', min: 0, max: 2 }] },
  };
  const TYPES = Object.keys(SPECIES);
  const blocksPerTick = (attr, mod) => 4.317 * Math.pow(attr * (mod == null ? 1 : mod), 2) / 0.098 / 20;

  // ════════════════════════════════════════════════════════════════ spawn tables
  // A biome key maps to its own weights (weight, pack size min..max). World generator v2 reports the biome through
  // world.gen.sample(x, z).biome.key; the classic generator and unknown biomes use `default`, which follows the
  // reference plains table (sheep 12, pig 10, chicken 10, cow 8; monsters 100 each, packs of 4).
  const SPAWN_TABLES = {
    default: {
      passive: [{ type: 'sheep', weight: 12, min: 4, max: 4 }, { type: 'pig', weight: 10, min: 4, max: 4 }, { type: 'chicken', weight: 10, min: 4, max: 4 }, { type: 'cow', weight: 8, min: 4, max: 4 }],
      hostile: [{ type: 'mirewalker', weight: 100, min: 4, max: 4 }, { type: 'hollow_archer', weight: 100, min: 4, max: 4 }, { type: 'cragskitter', weight: 100, min: 4, max: 4 }],
    },
    desert: { passive: [], hostile: [{ type: 'mirewalker', weight: 60, min: 4, max: 4 }, { type: 'hollow_archer', weight: 100, min: 4, max: 4 }, { type: 'cragskitter', weight: 100, min: 4, max: 4 }] },
    swamp: {
      passive: [{ type: 'pig', weight: 6, min: 2, max: 4 }, { type: 'chicken', weight: 10, min: 2, max: 4 }],
      hostile: [{ type: 'mirewalker', weight: 200, min: 4, max: 4 }, { type: 'hollow_archer', weight: 60, min: 4, max: 4 }, { type: 'cragskitter', weight: 60, min: 4, max: 4 }],
    },
    forest: {
      passive: [{ type: 'pig', weight: 10, min: 4, max: 4 }, { type: 'chicken', weight: 10, min: 4, max: 4 }, { type: 'sheep', weight: 8, min: 4, max: 4 }, { type: 'cow', weight: 6, min: 4, max: 4 }],
      hostile: [{ type: 'mirewalker', weight: 100, min: 4, max: 4 }, { type: 'hollow_archer', weight: 100, min: 4, max: 4 }, { type: 'cragskitter', weight: 140, min: 4, max: 4 }],
    },
    mountains: {
      passive: [{ type: 'sheep', weight: 20, min: 4, max: 4 }, { type: 'cow', weight: 6, min: 2, max: 4 }],
      hostile: [{ type: 'mirewalker', weight: 60, min: 4, max: 4 }, { type: 'hollow_archer', weight: 100, min: 4, max: 4 }, { type: 'cragskitter', weight: 200, min: 4, max: 4 }],
    },
    ocean: { passive: [], hostile: [{ type: 'mirewalker', weight: 100, min: 4, max: 4 }, { type: 'hollow_archer', weight: 100, min: 4, max: 4 }, { type: 'cragskitter', weight: 100, min: 4, max: 4 }] },
  };
  // Aliases so common v2 biome names find a sensible table.
  const TABLE_ALIASES = { plains: 'default', meadow: 'default', savanna: 'default', beach: 'ocean', river: 'default', mangrove_swamp: 'swamp', marsh: 'swamp', badlands: 'desert',
    dark_forest: 'forest', birch_forest: 'forest', taiga: 'forest', jungle: 'forest', dappled_forest: 'forest', stony_peaks: 'mountains', windswept_hills: 'mountains', deep_ocean: 'ocean' };
  // Biomes without a table of their own use their family's (the biomes generator groups its biomes in families).
  const FAMILY_TABLES = { ocean: 'ocean', coast: 'ocean', river: 'default', grassland: 'default', savanna: 'default', temperate_forest: 'forest',
    birch_forest: 'forest', taiga: 'forest', rainforest: 'forest', snowy: 'mountains', mountains: 'mountains', desert: 'desert', badlands: 'desert', wetland: 'swamp' };
  function biomeKey(world, x, z) {
    try {
      const s = world.gen && world.gen.sample ? world.gen.sample(Math.floor(x), Math.floor(z)) : null, b = s && s.biome;
      if (!b) return null;
      return SPAWN_TABLES[b.key] || TABLE_ALIASES[b.key] || !FAMILY_TABLES[b.family] ? b.key : FAMILY_TABLES[b.family];
    } catch (e) { return null; }
  }
  function tableFor(key, tables) {
    const T = tables || SPAWN_TABLES;
    if (key && T[key]) return T[key];
    if (key && TABLE_ALIASES[key] && T[TABLE_ALIASES[key]]) return T[TABLE_ALIASES[key]];
    return T.default;
  }
  function pickWeighted(list, rand) {
    let total = 0; for (const e of list) total += Math.max(0, e.weight);
    if (total <= 0) return null;
    let r = rand() * total;
    for (const e of list) { r -= Math.max(0, e.weight); if (r < 0) return e; }
    return list[list.length - 1];
  }

  // ════════════════════════════════════════════════════════════════ spawn rules (pure predicates)
  // Monster.isDarkEnoughToSpawn: fail if raw sky light > rand(0..31); fail if block light > 0 (the overworld limit);
  // otherwise spawn if max(sky - darkening, block) <= rand(0..7). `rand` returns [0, 1).
  function darkEnough(sky, block, darken, rand) {
    if (sky > Math.floor(rand() * 32)) return false;
    if (block > 0) return false;
    return Math.max(sky - darken, block) <= Math.floor(rand() * 8);
  }
  // Animals need a grass block below and raw brightness (no time-of-day darkening) above 8.
  const passiveLightOk = (sky, block) => Math.max(sky, block) > 8;
  // A hostile may stand on a full opaque block other than bedrock (glass, leaves and liquids never qualify).
  const hostileFloorOk = id => !!(id && SOLID[id] && OPAQUE[id] && id !== B.BEDROCK && id !== B.CACTUS && !(DEFS[id] && DEFS[id].bed));
  const passiveFloorOk = id => id === B.GRASS_BLOCK || id === B.SNOWY_GRASS_BLOCK;
  // Spawn distance: at least 24 blocks from the player and no farther than the 128-block despawn distance.
  const spawnDistanceOk = d => d >= 24 && d <= 128;
  // Despawn rule for non-persistent monsters: beyond 128 blocks at once; between 32 and 128, after 600 idle ticks a
  // 1-in-800 chance per tick; within 32 never (and the idle timer resets). Returns 'remove', 'reset' or 'keep'.
  function despawnCheck(dist, noAction, rand) {
    if (dist > 128) return 'remove';
    if (dist < 32) return 'reset';
    if (noAction > 600 && rand() < 1 / 800) return 'remove';
    return 'keep';
  }
  // Scaled mob cap: the base cap is for the 17x17 chunks around a player (reference MobCategory, 289 chunks).
  const scaledCap = (base, chunks) => Math.floor(base * Math.min(289, chunks) / 289);

  // ════════════════════════════════════════════════════════════════ world queries
  const blockAt = (world, x, y, z) => world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  // Can a body `hc` cells tall stand with its feet in cell (x, y, z)? Returns 'ground', 'water' or ''.
  function standKind(world, x, y, z, hc, avoidWater) {
    if (y < 1 || y + hc > WH) return '';
    if (world.hasChunk && !world.hasChunk(x, z)) return '';
    for (let k = 0; k < hc; k++) if (SOLID[world.getBlock(x, y + k, z)]) return '';
    const feet = world.getBlock(x, y, z);
    if (LIQUID[feet]) return avoidWater ? '' : 'water';
    const below = world.getBlock(x, y - 1, z);
    if (!SOLID[below] || below === B.CACTUS) return '';
    return 'ground';
  }
  // Line of sight between two points: no solid block on the segment (voxel walk).
  function lineOfSight(world, x0, y0, z0, x1, y1, z1) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return true;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    let x = Math.floor(x0), y = Math.floor(y0), z = Math.floor(z0);
    const tx = Math.floor(x1), ty = Math.floor(y1), tz = Math.floor(z1);
    const sx = Math.sign(ux), sy = Math.sign(uy), sz = Math.sign(uz);
    const tdx = sx ? Math.abs(1 / ux) : Infinity, tdy = sy ? Math.abs(1 / uy) : Infinity, tdz = sz ? Math.abs(1 / uz) : Infinity;
    let mx = sx > 0 ? (x + 1 - x0) * tdx : sx < 0 ? (x0 - x) * tdx : Infinity;
    let my = sy > 0 ? (y + 1 - y0) * tdy : sy < 0 ? (y0 - y) * tdy : Infinity;
    let mz = sz > 0 ? (z + 1 - z0) * tdz : sz < 0 ? (z0 - z) * tdz : Infinity;
    for (let n = 0; n < 400; n++) {
      if (x === tx && y === ty && z === tz) return true;
      if (mx < my && mx < mz) { if (mx > len) return true; x += sx; mx += tdx; }
      else if (my < mz) { if (my > len) return true; y += sy; my += tdy; }
      else { if (mz > len) return true; z += sz; mz += tdz; }
      if (SOLID[world.getBlock(x, y, z)]) return false;
    }
    return false;
  }

  // ════════════════════════════════════════════════════════════════ pathfinding (A* on the voxel grid)
  // Nodes are feet cells. Moves: 8 directions (diagonals only when both side cells are open), step up 1 block
  // (a jump, with headroom), or drop up to `maxDrop` blocks (3 unless chasing, like the reference's max fall
  // distance). Water can be crossed unless `avoidWater`. The search is bounded by `maxNodes`; when the goal is not
  // reached it returns the path to the explored node closest to the goal (so a mob still heads the right way).
  function heapPush(h, n) { h.push(n); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (h[p].f <= n.f) break; h[i] = h[p]; i = p; } h[i] = n; }
  function heapPop(h) {
    const top = h[0], last = h.pop();
    if (!h.length) return top;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = -1, f = last.f;
      if (l < h.length && h[l].f < f) { m = l; f = h[l].f; }
      if (r < h.length && h[r].f < f) m = r;
      if (m < 0) break;
      h[i] = h[m]; i = m;
    }
    h[i] = last;
    return top;
  }
  const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  function findPath(world, start, goal, opts) {
    const o = Object.assign({ hc: 2, maxDrop: 3, maxNodes: 300, avoidWater: false, range: 48 }, opts);
    const sx = start.x, sz = start.z, key = (x, y, z) => ((x - sx + 128) * 256 + (z - sz + 128)) * 128 + y;
    const h = (x, y, z) => { const dx = Math.abs(x - goal.x), dz = Math.abs(z - goal.z); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz) + Math.abs(y - goal.y) * 0.5; };
    const startN = { x: start.x, y: start.y, z: start.z, g: 0, f: h(start.x, start.y, start.z), parent: null };
    const open = [startN], seen = new Map([[key(start.x, start.y, start.z), startN]]);
    let best = startN, bestH = startN.f, expanded = 0;
    while (open.length && expanded < o.maxNodes) {
      const n = heapPop(open);
      if (n.closed) continue;
      n.closed = true; expanded++;
      const hn = n.f - n.g;
      if (hn < bestH) { bestH = hn; best = n; }
      if (n.x === goal.x && n.z === goal.z && Math.abs(n.y - goal.y) <= 1) { best = n; break; }
      const hereWater = LIQUID[world.getBlock(n.x, n.y, n.z)] === 1;
      for (const [dx, dz] of DIRS8) {
        const nx = n.x + dx, nz = n.z + dz;
        if (Math.abs(nx - sx) > o.range || Math.abs(nz - sz) > o.range) continue;
        const diag = dx !== 0 && dz !== 0;
        if (diag && (!clearColumn(world, n.x + dx, n.y, n.z, o.hc) || !clearColumn(world, n.x, n.y, n.z + dz, o.hc))) continue;
        let ny = null, cost = diag ? 1.414 : 1, kind = standKind(world, nx, n.y, nz, o.hc, o.avoidWater);
        if (kind) ny = n.y;
        else if (!diag && clearColumn(world, n.x, n.y + o.hc, n.z, 1) && (kind = standKind(world, nx, n.y + 1, nz, o.hc, o.avoidWater))) { ny = n.y + 1; cost += 0.6; }
        else if (clearColumn(world, nx, n.y, nz, o.hc)) {
          for (let d = 1; d <= o.maxDrop; d++) {
            const y = n.y - d;
            if (y < 1) break;
            if (SOLID[world.getBlock(nx, y, nz)]) break;
            kind = standKind(world, nx, y, nz, o.hc, o.avoidWater);
            if (kind) { ny = y; cost += d * 0.35; break; }
            if (LIQUID[world.getBlock(nx, y, nz)]) break;
          }
        }
        if (ny == null) continue;
        if (kind === 'water' || hereWater) cost += o.avoidWater ? 50 : 1.5;
        const k = key(nx, ny, nz), g = n.g + cost, prev = seen.get(k);
        if (prev && (prev.closed || prev.g <= g)) continue;
        const node = { x: nx, y: ny, z: nz, g, f: g + h(nx, ny, nz), parent: n };
        seen.set(k, node); heapPush(open, node);
      }
    }
    if (best === startN) return null;
    const path = [];
    for (let n = best; n && n !== startN; n = n.parent) path.push({ x: n.x, y: n.y, z: n.z });
    path.reverse();
    return path;
  }
  function clearColumn(world, x, y, z, hc) { for (let k = 0; k < hc; k++) if (SOLID[world.getBlock(x, y + k, z)]) return false; return true; }
  // Find a standing cell near (x, y, z), searching up and down a few blocks.
  function groundNear(world, x, y, z, hc, avoidWater, span) {
    for (let d = 0; d <= (span || 4); d++) for (const s of d ? [-1, 1] : [0]) {
      const yy = y + s * d;
      const k = standKind(world, x, yy, z, hc, avoidWater);
      if (k) return { x, y: yy, z, kind: k };
    }
    return null;
  }

  // ════════════════════════════════════════════════════════════════ the creature manager
  // opts: { view, rand, dropItem(stack, x, y, z), tables }
  function create(world, opts) {
    const o = opts || {};
    const rand = o.rand || Math.random;
    const view = o.view || null;
    const light = createLight(world);
    const list = [], arrows = [];
    const populated = new Set(), seenChunks = new Set();
    const tables = o.tables || JSON.parse(JSON.stringify(SPAWN_TABLES));
    const config = { spawning: true, passiveMul: 1, hostileMul: 1, passiveCap: 10, hostileCap: 40, maxActive: 60, ai: true, genChance: 0.25 };   // reference 0.1 per new chunk; higher here since fewer chunks are in view
    const stats = { spawned: 0, despawned: 0, killed: 0 };
    let nextUid = 1, ticks = 0, chunkList = [], chunkListAt = -999;
    const irand = (a, b) => a + Math.floor(rand() * (b - a + 1));
    const tri = s => (rand() - rand()) * s;

    // ------------------------------------------------------------ lifecycle
    function spawn(type, x, y, z, extra) {
      const sp = SPECIES[type]; if (!sp) return null;
      const m = {
        uid: nextUid++, type, sp, x, y, z, px: x, py: y, pz: z, vx: 0, vy: 0, vz: 0, yaw: rand() * Math.PI * 2, pyaw: 0, headYaw: 0, headPitch: 0,
        onGround: false, inWater: false, hc: false, health: sp.health, hurtTime: 0, invuln: 0, lastHurt: 0, deathTime: -1, fire: 0, fallDist: 0,
        noAction: 0, persistent: sp.cat === 'passive', variant: sp.variants ? pickVariant(type) : 0, attackCd: 0, swing: 0, draw: 0,
        target: false, provoked: false, unseen: 0, path: null, pathI: 0, repath: 0, goal: null, state: 'idle', stateT: 0, lookT: 0, lookAtPlayer: false,
        walk: 0, walkAmt: 0, stuckT: 0, lastX: x, lastZ: z, light: 1, lightT: 0, paused: false, frozen: false, killer: null, hpShowT: 0,
      };
      m.pyaw = m.yaw;
      if (extra) Object.assign(m, extra);
      list.push(m); stats.spawned++;
      return m;
    }
    function pickVariant(type) {
      if (type === 'sheep') {   // reference fleece colours: white 81.836 %, black, grey, light grey 5 % each, brown 3 %, pink 0.164 %
        const r = rand() * 100;
        return r < 81.836 ? 0 : r < 86.836 ? 1 : r < 91.836 ? 2 : r < 96.836 ? 3 : r < 99.836 ? 4 : 5;
      }
      return Math.floor(rand() * (SPECIES[type].variants || 1));
    }
    function remove(m) { const i = list.indexOf(m); if (i >= 0) list.splice(i, 1); if (view) view.removeMob(m); }
    function clear() { for (const m of list.slice()) remove(m); for (const a of arrows.slice()) removeArrow(a); populated.clear(); seenChunks.clear(); }
    const count = cat => list.filter(m => m.deathTime < 0 && (!cat || m.sp.cat === cat || m.type === cat)).length;

    // ------------------------------------------------------------ physics
    function ready(x, z) { return world.chunkReady ? world.chunkReady(x, z) : true; }
    function boxHitsBlocks(m, x, y, z) {
      const hw = m.sp.w / 2;
      const x0 = Math.floor(x - hw), x1 = Math.floor(x + hw - 1e-6), y0 = Math.floor(y), y1 = Math.floor(y + m.sp.h - 1e-6), z0 = Math.floor(z - hw), z1 = Math.floor(z + hw - 1e-6);
      for (let yy = y0; yy <= y1; yy++) for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) if (SOLID[world.getBlock(xx, yy, zz)]) return true;
      return false;
    }
    const overlapsPlayer = (m, x, y, z, P) => !!P && P.alive && Math.abs(x - P.x) < m.sp.w / 2 + 0.3 && Math.abs(z - P.z) < m.sp.w / 2 + 0.3 && y < P.y + P.h && y + m.sp.h > P.y;
    function moveAxis(m, axis, d, P) {
      if (!d) return false;
      const nx = axis === 0 ? m.x + d : m.x, ny = axis === 1 ? m.y + d : m.y, nz = axis === 2 ? m.z + d : m.z;
      if (axis !== 1 && !ready(nx, nz)) return true;   // the edge of loaded terrain acts as a wall
      if (boxHitsBlocks(m, nx, ny, nz)) {
        if (axis === 1) { if (d < 0) m.y = Math.floor(ny) + 1; else m.y = Math.floor(ny + m.sp.h) - m.sp.h - 1e-4; }
        return true;
      }
      if (axis !== 1 && overlapsPlayer(m, nx, ny, nz, P) && !overlapsPlayer(m, m.x, m.y, m.z, P)) return true;   // don't walk into the player
      m.x = nx; m.y = ny; m.z = nz;
      return false;
    }
    // One tick. `inp` = {mx, mz, jump}: desired horizontal velocity (blocks/tick) and a jump request.
    function physics(m, inp, P) {
      const sp = m.sp;
      const feet = world.getBlock(Math.floor(m.x), Math.floor(m.y + 0.1), Math.floor(m.z));
      const mid = world.getBlock(Math.floor(m.x), Math.floor(m.y + sp.h * 0.6), Math.floor(m.z));
      m.inWater = LIQUID[feet] === 1 || LIQUID[mid] === 1;
      const mx = inp ? inp.mx : 0, mz = inp ? inp.mz : 0;
      if (m.inWater) {
        m.vx = m.vx * 0.8 + mx * 0.12; m.vz = m.vz * 0.8 + mz * 0.12;
        m.vy = m.vy * 0.8 - 0.02;
        if (LIQUID[mid] === 1 || (LIQUID[feet] === 1 && m.vy < 0)) m.vy = Math.min(0.1, m.vy + 0.06);   // float to the surface (FloatGoal)
        if (m.hc && (mx || mz)) m.vy = 0.3;   // climb out onto a bank
        m.fallDist = 0; m.fire = 0;
      } else {
        // Ground friction 0.6 * 0.91 and air drag 0.91 per tick; the input is scaled so the terminal speed is the target.
        const f = m.onGround ? 0.546 : 0.91;
        m.vx = m.vx * f + mx * (1 - f);
        m.vz = m.vz * f + mz * (1 - f);
        m.vy = (m.vy - 0.08) * 0.98;
        if (sp.slowFall && m.vy < 0) m.vy *= 0.6;
        if (sp.climbs && m.hc && (mx || mz)) { m.vy = 0.2; m.fallDist = 0; }
        if (inp && inp.jump && m.onGround) m.vy = 0.42;
      }
      const y0 = m.y;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(m.vx), Math.abs(m.vy), Math.abs(m.vz)) / 0.35));
      let hc = false, landed = false;
      for (let i = 0; i < steps; i++) {
        if (moveAxis(m, 0, m.vx / steps, P)) { hc = true; m.vx = 0; }
        if (moveAxis(m, 2, m.vz / steps, P)) { hc = true; m.vz = 0; }
        if (moveAxis(m, 1, m.vy / steps, P)) { if (m.vy < 0) landed = true; m.vy = 0; }
      }
      m.hc = hc; m.onGround = landed;
      // Pushed out when a block ends up inside the body.
      if (boxHitsBlocks(m, m.x, m.y, m.z) && !boxHitsBlocks(m, m.x, Math.floor(m.y) + 1, m.z)) { m.y = Math.floor(m.y) + 1; m.vy = 0; }
      if (!m.inWater && m.y < y0) m.fallDist += y0 - m.y;
      if (m.onGround) {
        if (m.fallDist > 0 && !sp.slowFall) { const d = SV.fallDamage(m.fallDist); if (d > 0) hurt(m, d, { cause: 'fall' }); }
        m.fallDist = 0;
      }
      if (m.y < -40) { m.health = 0; m.deathTime = 20; }
    }
    // Soft push between overlapping creatures (reference pushEntities), cheap enough for a few dozen.
    function separate(active) {
      for (let i = 0; i < active.length; i++) {
        const a = active[i]; if (a.deathTime >= 0) continue;
        for (let j = i + 1; j < active.length; j++) {
          const b = active[j]; if (b.deathTime >= 0) continue;
          const dx = b.x - a.x, dz = b.z - a.z, r = (a.sp.w + b.sp.w) / 2;
          if (Math.abs(dx) >= r || Math.abs(dz) >= r || a.y >= b.y + b.sp.h || b.y >= a.y + a.sp.h) continue;
          const d = Math.hypot(dx, dz) || 0.01, push = 0.05 * (1 - d / (r * 1.42));
          if (push <= 0) continue;
          const ux = (d > 0.01 ? dx / d : rand() - 0.5), uz = (d > 0.01 ? dz / d : rand() - 0.5);
          a.vx -= ux * push; a.vz -= uz * push; b.vx += ux * push; b.vz += uz * push;
        }
      }
    }

    // ------------------------------------------------------------ damage and death
    // info: { cause, attacker: 'player' | mob, dx, dz (knockback direction), knock (strength), crit }
    function hurt(m, amount, info) {
      if (m.deathTime >= 0 || amount <= 0) return 0;
      const inf = info || {};
      let dealt;
      if (m.invuln > 10) {
        if (amount <= m.lastHurt) return 0;
        dealt = amount - m.lastHurt; m.lastHurt = amount;
      } else { dealt = amount; m.lastHurt = amount; m.invuln = 20; m.hurtTime = 10; }
      m.health = Math.max(0, m.health - dealt);
      m.hpShowT = 60; m.noAction = 0;
      const k = inf.knock == null ? (inf.cause === 'fire' || inf.cause === 'fall' ? 0 : 0.4) : inf.knock;
      if (k > 0 && (inf.dx || inf.dz)) { const v = SV.knockback({ x: m.vx, y: m.vy, z: m.vz }, k, inf.dx, inf.dz, m.onGround); m.vx = v.x; m.vy = v.y; m.vz = v.z; }
      if (inf.attacker === 'player') {
        if (m.sp.cat === 'passive') { m.state = 'panic'; m.stateT = 60 + irand(0, 40); m.path = null; m.panicFrom = { x: m.x - (inf.dx || 0), z: m.z - (inf.dz || 0) }; }
        else { m.target = true; m.provoked = true; m.unseen = 0; }
      }
      if (view && view.effect) view.effect(inf.crit ? 'crit' : 'hit', m.x, m.y + m.sp.h * 0.6, m.z, { mob: m });
      if (m.health <= 0) die(m, inf);
      return dealt;
    }
    function die(m, inf) {
      m.deathTime = 0; m.path = null; m.fire = 0; m.killer = inf && inf.attacker === 'player' ? 'player' : null;
      stats.killed++;
      for (const st of rollDrops(m.sp, m.killer === 'player', rand)) if (o.dropItem) o.dropItem(st, m.x - 0.5, m.y + 0.2, m.z - 0.5);
    }

    // ------------------------------------------------------------ AI
    const speedOf = (m, mod) => blocksPerTick(m.sp.speed, mod);
    function followPath(m, mod) {
      if (!m.path || m.pathI >= m.path.length) return null;
      const n = m.path[m.pathI], tx = n.x + 0.5, tz = n.z + 0.5, dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz);
      const reach = m.sp.w > 1 ? 0.6 : 0.35;
      if (d < reach && Math.abs(m.y - n.y) < 1.1) { m.pathI++; return followPath(m, mod); }
      const sp = speedOf(m, mod), s = d > 0.001 ? Math.min(sp, d) / d : 0;
      const up = n.y > Math.floor(m.y + 0.05);
      m.yaw = turn(m.yaw, Math.atan2(-dx, -dz), 0.5);
      return { mx: dx * s, mz: dz * s, jump: (up && d < 1.6) || (m.hc && m.onGround) };
    }
    function turn(a, b, max) { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; if (d > max) d = max; if (d < -max) d = -max; return a + d; }
    function setPath(m, gx, gy, gz, chasing) {
      const start = { x: Math.floor(m.x), y: Math.floor(m.y + 0.05), z: Math.floor(m.z) };
      const hc = Math.ceil(m.sp.h - 0.05);
      if (!standKind(world, start.x, start.y, start.z, hc, false)) { const g = groundNear(world, start.x, start.y, start.z, hc, false, 2); if (g) start.y = g.y; }
      const p = findPath(world, start, { x: gx, y: gy, z: gz }, { hc, maxDrop: chasing ? 4 : 3, maxNodes: chasing ? 400 : 220, avoidWater: !chasing });
      m.path = p; m.pathI = 0; m.goal = { x: gx, y: gy, z: gz }; m.stuckT = 0; m.lastX = m.x; m.lastZ = m.z;
      return !!p;
    }
    function randomTarget(m, radius, vert, avoidWater, awayFrom) {
      const hc = Math.ceil(m.sp.h - 0.05);
      for (let k = 0; k < 10; k++) {
        let dx = irand(-radius, radius), dz = irand(-radius, radius);
        if (awayFrom) { const ax = m.x - awayFrom.x, az = m.z - awayFrom.z; if (dx * ax + dz * az < 0) { dx = -dx; dz = -dz; } }
        const x = Math.floor(m.x) + dx, z = Math.floor(m.z) + dz, y = Math.floor(m.y) + irand(-vert, vert);
        if (world.hasChunk && !world.hasChunk(x, z)) continue;
        const g = groundNear(world, x, y, z, hc, avoidWater, vert);
        if (g) return g;
      }
      return null;
    }
    const eyeY = m => m.y + m.sp.h * 0.85;
    function canSee(m, P) { return lineOfSight(world, m.x, eyeY(m), m.z, P.x, P.y + P.eye, P.z); }
    function lightAtMob(m) {
      const x = Math.floor(m.x), y = Math.floor(m.y + m.sp.h * 0.5), z = Math.floor(m.z);
      return { sky: light.sky(x, y, z), block: light.block(x, y, z) };
    }
    function mobBrightness(m, tick) { const l = lightAtMob(m); return brightness(Math.max(l.sky - skyDarken(tick), l.block)); }
    function inMeleeReach(m, P) {
      // Attack box: the creature's box grown by 0.828 horizontally (reference DEFAULT_ATTACK_REACH).
      const r = m.sp.w / 2 + 0.828 + 0.3;
      return Math.abs(P.x - m.x) < r && Math.abs(P.z - m.z) < r && P.y < m.y + m.sp.h && P.y + P.h > m.y;
    }

    function aiPassive(m, P, ctx) {
      if (m.state === 'panic') {
        if (--m.stateT <= 0) { m.state = 'idle'; m.path = null; }
        else if (!m.path || m.pathI >= m.path.length) {
          const g = randomTarget(m, 5, 4, false, m.panicFrom);
          if (g) setPath(m, g.x, g.y, g.z, false);
        }
        return followPath(m, m.sp.panic);
      }
      if (m.state === 'wander') {
        const inp = followPath(m, m.sp.wander);
        if (!inp) { m.state = 'idle'; m.path = null; }
        return inp;
      }
      if (rand() < 1 / 120) {
        const g = randomTarget(m, 10, 7, true);
        if (g && setPath(m, g.x, g.y, g.z, false)) m.state = 'wander';
      }
      lookAround(m, P);
      return null;
    }
    function lookAround(m, P) {
      if (m.lookT > 0) { m.lookT--; if (m.lookAtPlayer && P) { const dx = P.x - m.x, dz = P.z - m.z; m.headYaw = clampHead(Math.atan2(-dx, -dz) - m.yaw); m.headPitch = Math.max(-0.6, Math.min(0.6, Math.atan2(P.y + P.eye - eyeY(m), Math.hypot(dx, dz)))); } return; }
      m.lookAtPlayer = false;
      if (P && P.alive && Math.hypot(P.x - m.x, P.z - m.z) < 8 && rand() < 0.02) { m.lookAtPlayer = true; m.lookT = 40 + irand(0, 40); }
      else if (rand() < 0.01) { m.headYaw = (rand() - 0.5) * 1.6; m.headPitch = (rand() - 0.5) * 0.4; m.lookT = 20 + irand(0, 20); }
      else { m.headYaw *= 0.9; m.headPitch *= 0.9; }
    }
    const clampHead = a => { const d = ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return Math.max(-1.2, Math.min(1.2, d)); };

    function aiHostile(m, P, ctx) {
      const sp = m.sp, dist = P ? Math.hypot(P.x - m.x, P.y - m.y, P.z - m.z) : Infinity;
      // targeting (every 10 ticks), reference NearestAttackableTargetGoal with must-see
      if ((ticks + m.uid) % 10 === 0) {
        if (!m.target && P && P.targetable && dist <= sp.follow && canSee(m, P)) {
          const bright = sp.neutralInLight && !m.provoked && mobBrightness(m, ctx.tick) >= 0.5;
          if (!bright) { m.target = true; m.unseen = 0; }
        }
      }
      if (m.target) {
        if (!P || !P.targetable || dist > sp.follow * 1.1) { m.target = false; m.provoked = false; m.path = null; }
        else if (sp.neutralInLight && !m.provoked && rand() < 0.01 && mobBrightness(m, ctx.tick) >= 0.5) { m.target = false; m.path = null; }
      }
      if (m.attackCd > 0) m.attackCd--;
      if (!m.target) {
        m.draw = 0;
        // Burning undead look for shade (FleeSunGoal).
        if (m.fire > 0 && sp.burns && m.state !== 'shade') {
          const g = findShade(m); if (g && setPath(m, g.x, g.y, g.z, false)) m.state = 'shade';
        }
        if (m.state === 'shade' || m.state === 'wander') { const inp = followPath(m, sp.wander); if (!inp) { m.state = 'idle'; m.path = null; } return inp; }
        if (rand() < 1 / 120) { const g = randomTarget(m, 10, 7, true); if (g && setPath(m, g.x, g.y, g.z, false)) m.state = 'wander'; }
        lookAround(m, P);
        return null;
      }
      m.state = 'chase';
      const seen = canSee(m, P);
      m.unseen = seen ? 0 : m.unseen + 1;
      if (m.unseen > 100) { m.target = false; m.path = null; return null; }
      const dx = P.x - m.x, dz = P.z - m.z, hd = Math.hypot(dx, dz);
      m.headYaw = 0; m.headPitch = Math.max(-0.6, Math.min(0.6, Math.atan2(P.y + P.eye - eyeY(m), hd)));
      if (sp.ai === 'ranged') return aiArcher(m, P, ctx, dist, hd, seen);
      // melee: path to the player, strike when in reach with line of sight, leap if a leaper
      if (sp.leaps && m.onGround && hd > 2 && hd < 4 && rand() < 0.2) {
        const s = 0.4 / (hd || 1);
        m.vx = dx * s + m.vx * 0.2; m.vz = dz * s + m.vz * 0.2; m.vy = 0.4; m.yaw = Math.atan2(-dx, -dz);
        return null;
      }
      if (inMeleeReach(m, P) && seen) {
        m.yaw = turn(m.yaw, Math.atan2(-dx, -dz), 0.6);
        if (m.attackCd <= 0) {
          m.attackCd = 20; m.swing = 8;
          if (ctx.hurtPlayer) ctx.hurtPlayer(sp.attack, 'mob', m, { dx, dz });
        }
        return hd > 0.9 ? { mx: dx / hd * speedOf(m, sp.chase) * 0.5, mz: dz / hd * speedOf(m, sp.chase) * 0.5, jump: false } : null;
      }
      chaseRepath(m, P);
      const inp = followPath(m, sp.chase);
      if (inp) return inp;
      // Direct approach when the path ran out but the player is right there.
      if (hd < 3 && Math.abs(P.y - m.y) < 1.5) { m.yaw = turn(m.yaw, Math.atan2(-dx, -dz), 0.5); const s = speedOf(m, sp.chase) / (hd || 1); return { mx: dx * s, mz: dz * s, jump: m.hc && m.onGround }; }
      return null;
    }
    function chaseRepath(m, P) {
      const gx = Math.floor(P.x), gy = Math.floor(P.y + 0.05), gz = Math.floor(P.z);
      const moved = !m.goal || Math.abs(m.goal.x - gx) + Math.abs(m.goal.z - gz) + Math.abs(m.goal.y - gy) > 1;
      if (--m.repath <= 0 && (moved || !m.path || m.pathI >= m.path.length)) {
        setPath(m, gx, gy, gz, true);
        const d = Math.hypot(P.x - m.x, P.z - m.z);
        m.repath = d < 12 ? 8 + irand(0, 4) : 16 + irand(0, 10);
      }
    }
    function aiArcher(m, P, ctx, dist, hd, seen) {
      const dx = P.x - m.x, dz = P.z - m.z;
      if (seen && dist <= m.sp.range) {
        m.yaw = turn(m.yaw, Math.atan2(-dx, -dz), 0.5);
        m.path = null;
        m.draw++;
        const interval = ctx.difficulty >= 3 ? 20 : 40;
        if (m.draw >= 20 && m.attackCd <= 0) { shootArrow(m, P, ctx); m.attackCd = interval; m.draw = 0; }
        // keep some distance, strafe a little
        const sp = speedOf(m, 0.5);
        if (hd < 5) return { mx: -dx / hd * sp, mz: -dz / hd * sp, jump: m.hc && m.onGround };
        if (m.strafeT == null || --m.strafeT <= 0) { m.strafeDir = rand() < 0.5 ? 1 : -1; m.strafeT = 20 + irand(0, 40); }
        return { mx: (-dz / hd) * sp * 0.5 * m.strafeDir, mz: (dx / hd) * sp * 0.5 * m.strafeDir, jump: false };
      }
      m.draw = 0;
      chaseRepath(m, P);
      return followPath(m, m.sp.chase);
    }
    function findShade(m) {
      const hc = Math.ceil(m.sp.h - 0.05);
      for (let k = 0; k < 10; k++) {
        const x = Math.floor(m.x) + irand(-10, 10), z = Math.floor(m.z) + irand(-10, 10), y = Math.floor(m.y) + irand(-3, 3);
        const g = groundNear(world, x, y, z, hc, true, 3);
        if (g && !light.seesSky(g.x, g.y + 1, g.z)) return g;
      }
      return null;
    }

    // ------------------------------------------------------------ arrows
    // Fired at 1.6 blocks/tick toward the target's body with an upward lead of 0.2 per block of distance and a
    // spread of 14 - 4 * difficulty (reference AbstractSkeleton.performRangedAttack, Projectile.shoot).
    function shootArrow(m, P, ctx) {
      const sx = m.x, sy = eyeY(m) - 0.1, sz = m.z;
      const tx = P.x - sx, ty = P.y + P.h / 3 - sy, tz = P.z - sz, hd = Math.hypot(tx, tz);
      let vx = tx, vy = ty + hd * 0.2, vz = tz;
      const len = Math.hypot(vx, vy, vz) || 1, inacc = 14 - 4 * Math.max(1, Math.min(3, ctx.difficulty || 2));
      vx = vx / len + tri(0.0172275 * inacc); vy = vy / len + tri(0.0172275 * inacc); vz = vz / len + tri(0.0172275 * inacc);
      const l2 = Math.hypot(vx, vy, vz) || 1;
      const a = { uid: nextUid++, owner: m.uid, ownerType: m.type, x: sx + vx / l2 * 0.4, y: sy, z: sz + vz / l2 * 0.4, vx: vx / l2 * 1.6, vy: vy / l2 * 1.6, vz: vz / l2 * 1.6, age: 0, stuck: false, base: 2 };
      a.px = a.x; a.py = a.y; a.pz = a.z;
      arrows.push(a);
      m.swing = 6;
      if (view && view.effect) view.effect('shoot', sx, sy, sz, { mob: m });
      return a;
    }
    function removeArrow(a) { const i = arrows.indexOf(a); if (i >= 0) arrows.splice(i, 1); if (view && view.removeArrow) view.removeArrow(a); }
    function segBox(x0, y0, z0, dx, dy, dz, bx0, by0, bz0, bx1, by1, bz1) {
      let t0 = 0, t1 = 1;
      for (const [o, d, lo, hi] of [[x0, dx, bx0, bx1], [y0, dy, by0, by1], [z0, dz, bz0, bz1]]) {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return -1; continue; }
        let a = (lo - o) / d, b = (hi - o) / d; if (a > b) { const t = a; a = b; b = t; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return -1;
      }
      return t0;
    }
    function tickArrow(a, P, ctx) {
      a.px = a.x; a.py = a.y; a.pz = a.z;
      a.age++;
      if (a.stuck) {
        if (SOLID[blockAt(world, a.x, a.y, a.z)]) { if (a.age > 1200) removeArrow(a); return; }
        a.stuck = false; a.vx = a.vy = a.vz = 0;   // its block was removed: fall
      }
      if (a.age > 1200 || a.y < -40 || !ready(a.x, a.z)) { removeArrow(a); return; }
      const n = Math.max(1, Math.ceil(Math.hypot(a.vx, a.vy, a.vz) / 0.3));
      for (let i = 0; i < n; i++) {
        const sx = a.vx / n, sy = a.vy / n, sz = a.vz / n;
        // creatures and the player first
        if (P && P.alive && P.hittable) {
          const t = segBox(a.x, a.y, a.z, sx, sy, sz, P.x - 0.3, P.y, P.z - 0.3, P.x + 0.3, P.y + P.h, P.z + 0.3);
          if (t >= 0) { hitWithArrow(a, null, ctx); return; }
        }
        for (const m of list) {
          if (m.uid === a.owner || m.deathTime >= 0 || m.paused) continue;
          const hw = m.sp.w / 2;
          if (Math.abs(m.x - a.x) > 3 || Math.abs(m.z - a.z) > 3) continue;
          const t = segBox(a.x, a.y, a.z, sx, sy, sz, m.x - hw, m.y, m.z - hw, m.x + hw, m.y + m.sp.h, m.z + hw);
          if (t >= 0) { hitWithArrow(a, m, ctx); return; }
        }
        const nx = a.x + sx, ny = a.y + sy, nz = a.z + sz;
        if (SOLID[blockAt(world, nx, ny, nz)]) { a.x = nx; a.y = ny; a.z = nz; a.stuck = true; a.age = 0; if (view && view.effect) view.effect('thunk', nx, ny, nz, {}); return; }
        a.x = nx; a.y = ny; a.z = nz;
      }
      const water = LIQUID[blockAt(world, a.x, a.y, a.z)] === 1, drag = water ? 0.6 : 0.99;
      a.vx *= drag; a.vy = a.vy * drag - 0.05; a.vz *= drag;
    }
    function hitWithArrow(a, m, ctx) {
      const speed = Math.hypot(a.vx, a.vy, a.vz), dmg = Math.ceil(Math.max(0, speed * a.base));
      const owner = list.find(x => x.uid === a.owner) || { type: a.ownerType, sp: SPECIES[a.ownerType] };
      if (m) hurt(m, dmg, { cause: 'arrow', attacker: owner, dx: a.vx, dz: a.vz });
      else if (ctx.hurtPlayer) ctx.hurtPlayer(dmg, 'arrow', owner, { dx: a.vx, dz: a.vz });
      removeArrow(a);
    }

    // ------------------------------------------------------------ spawning
    function refreshChunks(P) {
      if (ticks - chunkListAt < 20) return;
      chunkListAt = ticks; chunkList = [];
      if (!world.chunks || !P) return;
      const pcx = Math.floor(P.x) >> 4, pcz = Math.floor(P.z) >> 4;
      for (const ch of world.chunks.values()) if (Math.abs(ch.cx - pcx) <= 8 && Math.abs(ch.cz - pcz) <= 8 && !ch.dirty) chunkList.push(ch);
    }
    function bodyFree(type, x, y, z) {
      const sp = SPECIES[type], hw = sp.w / 2;
      const x0 = Math.floor(x - hw), x1 = Math.floor(x + hw - 1e-6), y1 = Math.floor(y + sp.h - 1e-6), z0 = Math.floor(z - hw), z1 = Math.floor(z + hw - 1e-6);
      for (let yy = Math.floor(y); yy <= y1; yy++) for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) {
        const id = world.getBlock(xx, yy, zz); if (SOLID[id] || LIQUID[id]) return false;
      }
      return true;
    }
    // Check one spawn position (block coordinates of the feet cell). `mode`: 'hostile', 'passive', 'gen'.
    function canSpawnAt(type, x, y, z, mode, P, ctx) {
      if (y < 1 || y >= WH - 2) return false;
      if (!ready(x, z)) return false;
      const floor = world.getBlock(x, y - 1, z);
      const cx = x + 0.5, cz = z + 0.5;
      if (mode !== 'gen' && P) { const d = Math.hypot(cx - P.x, y - P.y, cz - P.z); if (!spawnDistanceOk(d)) return false; }
      if (mode === 'hostile') {
        if (!hostileFloorOk(floor) || !bodyFree(type, cx, y, cz)) return false;
        return darkEnough(light.sky(x, y, z), light.block(x, y, z), skyDarken(ctx.tick), rand);
      }
      if (!passiveFloorOk(floor) || !bodyFree(type, cx, y, cz)) return false;
      return passiveLightOk(light.sky(x, y, z), light.block(x, y, z));
    }
    // Spawn a pack around a start column (members spread by nextInt(6) - nextInt(6), as in NaturalSpawner).
    function spawnPack(entry, x, y, z, mode, P, ctx, fixedY) {
      let n = 0;
      const size = irand(entry.min, entry.max);
      let px = x, pz = z;
      for (let i = 0; i < size; i++) {
        px += irand(0, 5) - irand(0, 5); pz += irand(0, 5) - irand(0, 5);
        let py = y;
        if (fixedY == null) { py = world.surfaceY ? world.surfaceY(px, pz) : y; }
        if (!canSpawnAt(entry.type, px, py, pz, mode, P, ctx)) continue;
        const m = spawn(entry.type, px + 0.5, py, pz + 0.5);
        if (m) { m.persistent = mode !== 'hostile'; n++; }
      }
      return n;
    }
    function populateChunks(P, ctx) {
      if (!world.chunks || ticks % 10 !== 0) return;
      for (const ch of world.chunks.values()) {
        const k = ch.cx + ',' + ch.cz;
        if (seenChunks.has(k)) continue;
        if (ch.dirty) continue;   // wait until its neighbours exist and it is meshed
        seenChunks.add(k);
        if (populated.has(k)) continue;
        populated.add(k);
        if (!config.spawning || rand() >= config.genChance * config.passiveMul) continue;
        const x = ch.cx * 16 + irand(0, 15), z = ch.cz * 16 + irand(0, 15);
        const entry = pickWeighted(tableFor(biomeKey(world, x, z), tables).passive, rand);
        if (entry) spawnPack(entry, x, 0, z, 'gen', P, ctx, null);
      }
    }
    function spawnPassive(P, ctx) {
      // Every 400 ticks (20 s), as the reference's creature category.
      if (ticks % 400 !== 0 || !chunkList.length) return;
      const cap = scaledCap(config.passiveCap * config.passiveMul, chunkList.length);
      let have = list.filter(m => m.sp.cat === 'passive' && !m.paused && m.deathTime < 0).length;
      for (let tries = 0; tries < 8 && have < cap; tries++) {
        const ch = chunkList[Math.floor(rand() * chunkList.length)];
        const x = ch.cx * 16 + irand(0, 15), z = ch.cz * 16 + irand(0, 15);
        const entry = pickWeighted(tableFor(biomeKey(world, x, z), tables).passive, rand);
        if (entry) have += spawnPack(entry, x, 0, z, 'passive', P, ctx, null);
      }
    }
    function spawnHostile(P, ctx) {
      if (!chunkList.length || ctx.difficulty === 0) return;
      const cap = scaledCap(config.hostileCap, chunkList.length);
      let have = list.filter(m => m.sp.cat === 'hostile' && m.deathTime < 0).length;
      if (have >= cap) return;
      let attempts = 2 * config.hostileMul;
      while (attempts > 0 && have < cap) {
        if (attempts < 1 && rand() >= attempts) break;
        attempts--;
        const ch = chunkList[Math.floor(rand() * chunkList.length)];
        const x = ch.cx * 16 + irand(0, 15), z = ch.cz * 16 + irand(0, 15);
        const top = world.surfaceY ? world.surfaceY(x, z) : WH - 1;
        const y = irand(1, top);
        const floor = world.getBlock(x, y - 1, z);
        if (!hostileFloorOk(floor) || SOLID[world.getBlock(x, y, z)]) continue;
        const entry = pickWeighted(tableFor(biomeKey(world, x, z), tables).hostile, rand);
        if (entry) have += spawnPack(entry, x, y, z, 'hostile', P, ctx, y);
      }
    }

    // ------------------------------------------------------------ main tick
    // ctx: { tick (time of day in ticks), difficulty, player: {x, y, z, h, eye, alive, targetable, hittable} | null,
    //        hurtPlayer(amount, cause, mob, {dx, dz}) }
    function tick(ctx) {
      ticks++;
      light.tick();
      const P = ctx.player;
      refreshChunks(P);
      // Peaceful removes monsters.
      if (ctx.difficulty === 0) for (const m of list.slice()) if (m.sp.cat === 'hostile') { remove(m); stats.despawned++; }
      if (config.spawning) {
        populateChunks(P, ctx);
        if (P) { spawnPassive(P, ctx); spawnHostile(P, ctx); }
      } else populateChunks(P, ctx);
      // Choose the active set: loaded creatures, nearest first, at most maxActive.
      if (ticks % 20 === 1) {
        const cand = [];
        for (const m of list) { m.paused = !ready(m.x, m.z); if (!m.paused) cand.push(m); else m.frozen = false; }
        if (P) cand.sort((a, b) => ((a.x - P.x) ** 2 + (a.z - P.z) ** 2) - ((b.x - P.x) ** 2 + (b.z - P.z) ** 2));
        cand.forEach((m, i) => { m.frozen = i >= config.maxActive; });
      }
      const active = [];
      for (const m of list.slice()) {
        if (!ready(m.x, m.z)) m.paused = true;
        // despawning (monsters only; animals are persistent)
        const dist = P ? Math.hypot(m.x - P.x, m.y - P.y, m.z - P.z) : 0;
        if (P && m.sp.cat === 'hostile' && !m.persistent && m.deathTime < 0) {
          const r = despawnCheck(dist, m.noAction, rand);
          if (r === 'remove') { remove(m); stats.despawned++; continue; }
          if (r === 'reset') m.noAction = 0; else m.noAction++;
        }
        if (m.paused || m.frozen) continue;
        m.px = m.x; m.py = m.y; m.pz = m.z; m.pyaw = m.yaw;
        if (m.hurtTime > 0) m.hurtTime--;
        if (m.invuln > 0) m.invuln--;
        if (m.swing > 0) m.swing--;
        if (m.hpShowT > 0) m.hpShowT--;
        if (m.deathTime >= 0) {
          m.deathTime++;
          physics(m, null, null);
          if (m.deathTime >= 20) { if (view && view.effect) view.effect('poof', m.x, m.y + m.sp.h / 2, m.z, { mob: m }); remove(m); }
          continue;
        }
        active.push(m);
        m.age = (m.age || 0) + 1;
        // environment: daylight burning, fire, cactus
        // Sun burning (Mob.isSunBurnTick): brightness above 0.5, random * 30 < (brightness - 0.4) * 2, sky visible
        // from the eyes, not in water; burns for 8 s.
        if (m.sp.burns && monstersBurn(ctx.tick) && !m.inWater) {
          const x = Math.floor(m.x), y = Math.floor(eyeY(m)), z = Math.floor(m.z);
          if (light.seesSky(x, y, z)) {
            const br = brightness(Math.max(light.sky(x, y, z) - skyDarken(ctx.tick), light.block(x, y, z)));
            if (br > 0.5 && rand() * 30 < (br - 0.4) * 2) m.fire = Math.max(m.fire, 160);
          }
        }
        if (m.fire > 0) { m.fire--; if (m.fire % 20 === 0) hurt(m, 1, { cause: 'fire', knock: 0 }); if (m.deathTime >= 0) continue; }
        if (touchingCactus(m)) hurt(m, 1, { cause: 'cactus', knock: 0 });
        if (m.deathTime >= 0) continue;
        // AI at a reduced rate when far away
        let inp = m.lastInp || null;
        const every = dist < 32 ? 1 : dist < 64 ? 2 : 4;
        if (config.ai && (ticks + m.uid) % every === 0) {
          inp = m.sp.cat === 'hostile' ? aiHostile(m, P, ctx) : aiPassive(m, P, ctx);
          m.lastInp = inp;
          // stuck while following a path: give up and choose again
          if (m.path && inp) {
            if (++m.stuckT >= 40) {
              if (Math.hypot(m.x - m.lastX, m.z - m.lastZ) < 0.6) { m.path = null; if (m.state !== 'chase' && m.state !== 'panic') m.state = 'idle'; }
              m.stuckT = 0; m.lastX = m.x; m.lastZ = m.z;
            }
          }
        } else if (!config.ai) inp = null;
        physics(m, inp, P);
        const moved = Math.hypot(m.x - m.px, m.z - m.pz);
        m.walkAmt += (Math.min(1, moved * 8) - m.walkAmt) * 0.4;
        m.walk += moved * 2.4;
        // body turns toward movement even when pushed
        if (moved > 0.02 && !m.target && inp) m.yaw = turn(m.yaw, Math.atan2(-(m.x - m.px), -(m.z - m.pz)), 0.3);
        if ((ticks + m.uid) % 10 === 0) { const l = lightAtMob(m); m.light = Math.max(brightness(Math.max(l.sky - skyDarken(ctx.tick), l.block)), 0) ; m.skyL = l.sky; m.blockL = l.block; }
      }
      separate(active);
      for (const a of arrows.slice()) tickArrow(a, P, ctx);
    }
    function touchingCactus(m) {
      const hw = m.sp.w / 2 + 0.02;
      const x0 = Math.floor(m.x - hw), x1 = Math.floor(m.x + hw), z0 = Math.floor(m.z - hw), z1 = Math.floor(m.z + hw), y0 = Math.floor(m.y - 0.02), y1 = Math.floor(m.y + m.sp.h);
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (world.getBlock(x, y, z) === B.CACTUS) return true;
      return false;
    }

    // ------------------------------------------------------------ queries used by the game
    // Nearest living creature whose box the ray (origin o, unit direction d) enters within maxDist.
    function raycast(ox, oy, oz, dx, dy, dz, maxDist) {
      let best = null, bestT = Infinity;
      for (const m of list) {
        if (m.deathTime >= 0 || m.paused) continue;
        const hw = m.sp.w / 2;
        if (Math.abs(m.x - ox) > maxDist + 2 || Math.abs(m.z - oz) > maxDist + 2) continue;
        const t = segBox(ox, oy, oz, dx * maxDist, dy * maxDist, dz * maxDist, m.x - hw, m.y, m.z - hw, m.x + hw, m.y + m.sp.h, m.z + hw);
        if (t >= 0 && t * maxDist < bestT) { bestT = t * maxDist; best = m; }
      }
      return best ? { mob: best, dist: bestT } : null;
    }
    // Monsters that stop a player from sleeping: within 8 blocks horizontally and 5 vertically of the bed.
    function hostilesNear(x, y, z, rh, rv) { return list.filter(m => m.sp.cat === 'hostile' && m.deathTime < 0 && Math.abs(m.x - x) <= rh && Math.abs(m.z - z) <= rh && Math.abs(m.y - y) <= rv); }
    function boxIntersects(x0, y0, z0, x1, y1, z1) {
      return list.some(m => m.deathTime < 0 && !m.paused && m.x + m.sp.w / 2 > x0 && m.x - m.sp.w / 2 < x1 && m.y + m.sp.h > y0 && m.y < y1 && m.z + m.sp.w / 2 > z0 && m.z - m.sp.w / 2 < z1);
    }
    function frame(alpha, info) { if (view) view.frame(list, arrows, alpha, info || {}); }

    // ------------------------------------------------------------ persistence
    const r2 = v => Math.round(v * 100) / 100;
    function pack() {
      return {
        v: 1,
        list: list.filter(m => m.deathTime < 0).map(m => {
          const e = { t: m.type, x: r2(m.x), y: r2(m.y), z: r2(m.z), r: r2(m.yaw), h: r2(m.health) };
          if (m.variant) e.v = m.variant;
          if (m.fire > 0) e.f = m.fire;
          if (m.sp.cat === 'hostile' && m.persistent) e.p = 1;
          if (m.sp.cat === 'passive' && !m.persistent) e.p = 0;
          return e;
        }),
        populated: Array.from(populated).join(';'),
        cfg: Object.assign({}, config),
        tables,
      };
    }
    function load(data) {
      if (!data || typeof data !== 'object') return;
      if (data.cfg && typeof data.cfg === 'object') for (const k of Object.keys(config)) if (typeof data.cfg[k] === typeof config[k]) config[k] = data.cfg[k];
      if (data.tables && typeof data.tables === 'object' && data.tables.default) for (const k of Object.keys(data.tables)) tables[k] = data.tables[k];
      if (typeof data.populated === 'string' && data.populated) for (const k of data.populated.split(';')) if (/^-?\d+,-?\d+$/.test(k)) populated.add(k);
      for (const e of Array.isArray(data.list) ? data.list : []) {
        if (!e || !SPECIES[e.t] || ![e.x, e.y, e.z].every(v => typeof v === 'number' && isFinite(v))) continue;
        const m = spawn(e.t, e.x, e.y, e.z, { yaw: +e.r || 0, variant: e.v | 0, fire: Math.max(0, e.f | 0) });
        m.pyaw = m.yaw;
        m.health = Math.max(0.5, Math.min(m.sp.health, typeof e.h === 'number' && isFinite(e.h) ? e.h : m.sp.health));
        if (e.p === 1) m.persistent = true;
        if (e.p === 0) m.persistent = false;
        stats.spawned--;
      }
    }

    return {
      list, arrows, config, stats, tables, populated, light,
      spawn, remove, clear, count, tick, frame, hurt, raycast, hostilesNear, boxIntersects, pack, load, shootArrow,
      canSpawnAt, get ticks() { return ticks; },
    };
  }

  // Loot: each entry rolls a uniform count (min..max); `chance` entries roll once; `player` entries need a player kill.
  function rollDrops(sp, byPlayer, rand) {
    const out = [];
    for (const d of sp.drops || []) {
      if (d.player && !byPlayer) continue;
      if (d.chance != null && rand() >= d.chance) continue;
      const n = d.min + Math.floor(rand() * (d.max - d.min + 1));
      if (n > 0 && BC.items.key(d.key)) out.push(BC.items.make(d.key, n));
    }
    return out;
  }

  BC.mobs = {
    SPECIES, TYPES, SPAWN_TABLES, TABLE_ALIASES, create, createLight, rollDrops, tableFor, pickWeighted, biomeKey,
    skyLevel, skyDarken, monstersBurn, canSleepAt, brightness, blocksPerTick,
    darkEnough, passiveLightOk, hostileFloorOk, passiveFloorOk, spawnDistanceOk, despawnCheck, scaledCap,
    standKind, lineOfSight, findPath, groundNear,
  };
})(typeof window !== 'undefined' ? window : globalThis);
