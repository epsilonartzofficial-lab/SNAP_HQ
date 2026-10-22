#!/usr/bin/env node
// Biome census for world generator v2 (zero dependencies; loads the game modules through tests/load.mjs).
//
//   node tools/census.mjs                       all presets, seeds 1, 42 and 20260928, 4096-block windows
//   node tools/census.mjs --presets=balanced --seeds=42 --size=2048
//   node tools/census.mjs --quick               smaller windows, fewer chunks (a fast smoke run)
//   options: --step=8 (sample spacing), --out=<dir> (HTML maps; default <tmp>/blockcraft-census), --png (also PNG maps),
//            --ascii (print a coarse text map), --json=<file> (write all numbers), --chunks=200 (timing sample)
//
// Reports, per preset: land and ocean share, share per family and outcome, patch sizes per outcome (connected
// components on the sample grid), transition quality (incompatible neighbours, height steps across biome borders at
// block resolution), a distinctness check between outcomes (player-visible feature vectors measured from generated
// chunks), and chunk generation time.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadBC } from '../tests/load.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] == null ? true : m[2]] : [a, true]; }));
const QUICK = !!args.quick;
const SEEDS = String(args.seeds || (QUICK ? '42' : '1,42,20260928')).split(',').map(Number);
const PRESET_LIST = String(args.presets || 'archipelago,balanced,continental').split(',');
const SIZE = Number(args.size || (QUICK ? 2048 : 4096));
const STEP = Number(args.step || 8);
const OUT = args.out || path.join(os.tmpdir(), 'blockcraft-census');
const NCHUNKS = Number(args.chunks || (QUICK ? 60 : 200));
const SEAM_SIZE = QUICK ? 256 : 512;
const BC = loadBC();
const { SEA, WH, CS } = BC.C;
const W2 = BC.worldgen2;
const OUTS = W2.OUTCOMES, NO = OUTS.length;
const FAMS = W2.FAMILIES.map(f => f.key);
const pct = (v, d = 1) => (v * 100).toFixed(d) + '%';
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const quant = (arr, q) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]; };
// Area-weighted quantile: the patch size that a random cell belongs to.
function wquant(areas, q) {
  if (!areas.length) return 0;
  const s = areas.slice().sort((a, b) => a - b), tot = s.reduce((a, b) => a + b, 0);
  let acc = 0; for (const a of s) { acc += a; if (acc >= q * tot) return a; }
  return s[s.length - 1];
}
const diam = area => 2 * Math.sqrt(area / Math.PI);

// ---- climatic compatibility: pairs that should never touch
const THERMAL = {}; // -1 frozen, +1 hot
for (const k of ['snowy_plains', 'ice_fields', 'snowy_taiga', 'snowy_peaks', 'frozen_ocean', 'frozen_river', 'snowy_beach']) THERMAL[k] = -1;
for (const k of ['desert', 'dunes', 'rocky_desert', 'badlands', 'wooded_badlands', 'savanna', 'savanna_plateau', 'rainforest', 'rainforest_edge', 'warm_ocean']) THERMAL[k] = 1;
const ARID = new Set(['desert', 'dunes', 'rocky_desert', 'badlands', 'wooded_badlands']), WET = new Set(['swamp', 'bog', 'rainforest', 'wet_forest']);
function incompatible(a, b) {
  const ka = OUTS[a].key, kb = OUTS[b].key;
  if (THERMAL[ka] && THERMAL[kb] && THERMAL[ka] !== THERMAL[kb]) return 'hot-frozen';
  if ((ARID.has(ka) && WET.has(kb)) || (ARID.has(kb) && WET.has(ka))) return 'arid-wet';
  return null;
}

// ---- maps
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const v of b) c = T[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function htmlMap(title, N, L, H, shares, meta) {
  const bytes = Buffer.alloc(N * N * 2); for (let i = 0; i < N * N; i++) { bytes[i * 2] = L[i]; bytes[i * 2 + 1] = H[i]; }
  const legend = OUTS.map((o, i) => ({ k: o.key, n: o.name, f: o.family, c: o.color, s: shares[i] })).filter(o => o.s > 0).sort((a, b) => b.s - a.s);
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font:13px system-ui,sans-serif;background:#15181c;color:#dde;margin:16px}canvas{image-rendering:pixelated;width:${Math.min(900, N * 2)}px;border:1px solid #444}
.lg{columns:3;max-width:900px}.lg div{break-inside:avoid;margin:1px 0}.sw{display:inline-block;width:12px;height:12px;margin-right:6px;vertical-align:-2px;border:1px solid #0006}</style>
<h2>${title}</h2><p>${meta}</p><canvas id="c" width="${N}" height="${N}"></canvas><p>Shading shows height. Legend (share of area):</p><div class="lg">${legend.map(o => `<div><span class="sw" style="background:${o.c}"></span>${o.n} <small>(${o.f})</small> ${(o.s * 100).toFixed(2)}%</div>`).join('')}</div>
<script>const d=Uint8Array.from(atob("${bytes.toString('base64')}"),c=>c.charCodeAt(0)),C=${JSON.stringify(OUTS.map(o => o.color))},N=${N};
const x=document.getElementById('c').getContext('2d'),im=x.createImageData(N,N);for(let i=0;i<N*N;i++){const h=C[d[i*2]],k=.7+.3*Math.min(1,Math.max(0,(d[i*2+1]-10)/60));im.data[i*4]=parseInt(h.slice(1,3),16)*k;im.data[i*4+1]=parseInt(h.slice(3,5),16)*k;im.data[i*4+2]=parseInt(h.slice(5,7),16)*k;im.data[i*4+3]=255}x.putImageData(im,0,0)</script>`;
}

// ---- one preset x seed: shares, patches, transitions on the coarse grid
function scanWorld(g, seed, preset) {
  const N = Math.floor(SIZE / STEP), x0 = -SIZE / 2, z0 = -SIZE / 2;
  const L = new Uint8Array(N * N), H = new Uint8Array(N * N);
  g.scan(x0, z0, x0 + (N - 1) * STEP, z0 + (N - 1) * STEP, STEP, (x, z, h, l) => { const i = (x - x0) / STEP + (z - z0) / STEP * N; L[i] = l; H[i] = h; });
  const count = new Float64Array(NO);
  let water = 0;
  for (let i = 0; i < N * N; i++) { count[L[i]]++; if (H[i] < SEA) water++; }
  // Connected components (4-neighbourhood).
  const seen = new Uint8Array(N * N), patches = OUTS.map(() => []), stack = new Int32Array(N * N);
  for (let s = 0; s < N * N; s++) {
    if (seen[s]) continue;
    const l = L[s]; let sp = 0, area = 0; stack[sp++] = s; seen[s] = 1;
    while (sp) {
      const i = stack[--sp]; area++;
      const x = i % N, z = (i / N) | 0;
      if (x > 0 && !seen[i - 1] && L[i - 1] === l) { seen[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < N - 1 && !seen[i + 1] && L[i + 1] === l) { seen[i + 1] = 1; stack[sp++] = i + 1; }
      if (z > 0 && !seen[i - N] && L[i - N] === l) { seen[i - N] = 1; stack[sp++] = i - N; }
      if (z < N - 1 && !seen[i + N] && L[i + N] === l) { seen[i + N] = 1; stack[sp++] = i + N; }
    }
    patches[l].push(area * STEP * STEP);
  }
  // Borders on the coarse grid.
  let borders = 0, pairs = 0; const bad = {};
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = x + z * N;
    for (const j of [x < N - 1 ? i + 1 : -1, z < N - 1 ? i + N : -1]) {
      if (j < 0) continue; pairs++;
      if (L[i] === L[j]) continue;
      borders++;
      const why = incompatible(L[i], L[j]);
      if (why) { const k = why + ': ' + [OUTS[L[i]].key, OUTS[L[j]].key].sort().join(' / '); bad[k] = (bad[k] || 0) + 1; }
    }
  }
  if (args.png) fs.writeFileSync(path.join(OUT, `${preset}-${seed}.png`), png(N, N, Buffer.from((() => { const b = new Uint8Array(N * N * 3); for (let i = 0; i < N * N; i++) { const c = OUTS[L[i]].color, k = 0.7 + 0.3 * Math.min(1, Math.max(0, (H[i] - 10) / 60)); b[i * 3] = parseInt(c.slice(1, 3), 16) * k; b[i * 3 + 1] = parseInt(c.slice(3, 5), 16) * k; b[i * 3 + 2] = parseInt(c.slice(5, 7), 16) * k; } return b; })())));
  const shares = Array.from(count, c => c / (N * N));
  fs.writeFileSync(path.join(OUT, `${preset}-${seed}.html`), htmlMap(`Blockcraft v2 · ${preset} · seed ${seed}`, N, L, H, shares, `${SIZE}×${SIZE} blocks around the origin, one pixel per ${STEP} blocks.`));
  if (args.ascii) asciiMap(L, N);
  return { N, count, water: water / (N * N), patches, borders, pairs, bad };
}
function asciiMap(L, N) {
  const CH = { ocean: '~', coast: '.', river: '=', grassland: '"', temperate_forest: 'T', birch_forest: 'b', taiga: 'A', snowy: '*', savanna: ';', desert: ':', badlands: '%', rainforest: 'J', wetland: 'w', mountains: '^' };
  const k = Math.max(1, Math.floor(N / 96));
  for (let z = 0; z < N; z += k * 2) { let s = ''; for (let x = 0; x < N; x += k) s += CH[OUTS[L[x + z * N]].family] || '?'; console.log(s); }
}

// ---- height steps at block resolution: every adjacent column pair in a window, split into border and interior pairs
function seams(g) {
  const S = SEAM_SIZE, x0 = -S / 2, z0 = -S / 2, H = new Int16Array(S * S), L = new Int16Array(S * S);
  g.scan(x0, z0, x0 + S - 1, z0 + S - 1, 1, (x, z, h, l) => { H[(x - x0) + (z - z0) * S] = h; L[(x - x0) + (z - z0) * S] = l; });
  const r = { border: 0, borderSum: 0, borderSteep: 0, inner: 0, innerSum: 0, innerSteep: 0, max: 0 };
  for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
    const i = x + z * S;
    for (const j of [x < S - 1 ? i + 1 : -1, z < S - 1 ? i + S : -1]) {
      if (j < 0) continue;
      if (H[i] < SEA && H[j] < SEA) continue;   // under water: not visible as a step
      const d = Math.abs(H[i] - H[j]); r.max = Math.max(r.max, d);
      if (L[i] !== L[j]) { r.border++; r.borderSum += d; if (d >= 4) r.borderSteep++; } else { r.inner++; r.innerSum += d; if (d >= 4) r.innerSteep++; }
    }
  }
  return r;
}

// ---- measured feature vectors per outcome from generated chunks
const K = key => BC.blocks.BY_KEY[key] ? BC.blocks.BY_KEY[key].id : -1;
const DEFS = BC.blocks.DEFS;
const isLog = id => DEFS[id] && (/_log$/.test(DEFS[id].key));
const isLeaf = id => DEFS[id] && DEFS[id].key.endsWith('_leaves');
const isPlant = id => DEFS[id] && DEFS[id].plant;
const WATER_ID = K('water'), ICE_ID = K('ice');
// Local features a player notices, found just above the ground (or floating at sea level for icebergs).
const SPECIAL = new Set([K('cactus'), K('packed_ice'), K('pink_coral_block'), K('blue_coral_block'), K('mossy_cobblestone'), K('cobblestone'), K('granite'), K('sandstone'), K('snow_block')]);
function features(g, seed, perOutcome) {
  const N = Math.floor(SIZE / STEP), x0 = -SIZE / 2, z0 = -SIZE / 2, picks = OUTS.map(() => []);
  // Candidates on a coarse grid; a deterministic, spread-out subsample per outcome is measured.
  g.scan(x0, z0, x0 + (N - 1) * STEP, z0 + (N - 1) * STEP, STEP * 2, (x, z, h, l) => { if (picks[l].length < perOutcome * 50) picks[l].push([x, z]); });
  const cache = new Map();
  const chunk = (cx, cz) => { const key = cx + ',' + cz; let d = cache.get(key); if (!d) { d = g.generateChunk(cx, cz); cache.set(key, d); if (cache.size > 400) cache.delete(cache.keys().next().value); } return d; };
  const block = (x, y, z) => (y < 0 || y >= WH ? 0 : chunk(x >> 4, z >> 4)[BC.worldgen.IDX(x & 15, y, z & 15)]);
  const F = OUTS.map(() => ({ n: 0, top: {}, sub: {}, cols: 0, trees: 0, species: {}, plants: 0, palette: {}, water: 0, snow: 0, special: 0, specialKinds: {}, hs: [], slope: 0, around: 0, aroundN: 0, trunkH: 0 }));
  const SNOWY = new Set([K('snow_block'), K('snowy_grass_block'), ICE_ID, K('packed_ice')]);
  const R = 4;
  OUTS.forEach((o, l) => {
    const list = picks[l]; const step = Math.max(1, Math.floor(list.length / perOutcome));
    for (let p = 0; p < list.length; p += step) {
      const [x, z] = list[p], f = F[l];
      // Exact column heights and labels for a 9x9 neighbourhood; only columns of this outcome count.
      g.scan(x - R, z - R, x + R, z + R, 1, (X, Z, gh, lab, Cc, oi) => {
        f.aroundN++; if (gh >= SEA) f.around++;   // dry land in view around the pick, whatever its outcome
        if (lab !== l) return;
        if (X === x && Z === z) { f.n++; f.hs.push(gh); }
        const top = block(X, gh, Z), sub = block(X, Math.max(1, gh - 2), Z), above = block(X, gh + 1, Z), sea = block(X, SEA, Z);
        f.cols++;
        f.top[top] = (f.top[top] || 0) + 1; f.sub[sub] = (f.sub[sub] || 0) + 1;
        f.slope += Math.max(Math.abs(Cc.H[oi + 1] - gh), Math.abs(Cc.H[oi - 1] - gh)) || 0;
        const trunk = isLog(above) && isLog(block(X, gh + 2, Z));
        if (trunk) { f.trees++; f.species[above] = (f.species[above] || 0) + 1; let t = 1; while (isLog(block(X, gh + 1 + t, Z))) t++; f.trunkH += t; }
        if (isPlant(above)) { f.plants++; f.palette[above] = (f.palette[above] || 0) + 1; }
        if (gh < SEA || sea === WATER_ID || sea === ICE_ID) f.water++;
        if (SNOWY.has(top) || sea === ICE_ID) f.snow++;
        let sp = 0;
        if (gh >= SEA && SPECIAL.has(above) && above !== K('snow_block')) sp = above;                    // cactus, spikes, boulders
        else if (isLog(above) && !trunk && !isLeaf(block(X, gh + 2, Z))) sp = 'fallen_log';               // fallen log
        else if (gh < SEA && (above === K('pink_coral_block') || above === K('blue_coral_block'))) sp = above; // reef
        else if (gh < SEA - 1 && (block(X, SEA + 1, Z) === K('packed_ice') || block(X, SEA + 1, Z) === K('snow_block'))) sp = 'iceberg';
        if (sp) { f.special++; f.specialKinds[sp] = (f.specialKinds[sp] || 0) + 1; }
      });
    }
  });
  return F;
}
function mergeF(A, B) {
  if (!A) return B;
  return A.map((a, i) => {
    const b = B[i], m = (x, y) => { const o = Object.assign({}, x); for (const k in y) o[k] = (o[k] || 0) + y[k]; return o; };
    return { n: a.n + b.n, top: m(a.top, b.top), sub: m(a.sub, b.sub), cols: a.cols + b.cols, trees: a.trees + b.trees, species: m(a.species, b.species), plants: a.plants + b.plants, palette: m(a.palette, b.palette), water: a.water + b.water, snow: a.snow + b.snow, special: a.special + b.special, specialKinds: m(a.specialKinds, b.specialKinds), hs: a.hs.concat(b.hs), slope: a.slope + b.slope, around: a.around + b.around, aroundN: a.aroundN + b.aroundN, trunkH: a.trunkH + b.trunkH };
  });
}
function norm(h) { const s = Object.values(h).reduce((a, b) => a + b, 0) || 1; const o = {}; for (const k in h) o[k] = h[k] / s; return o; }
function jsd(p, q) {
  p = norm(p); q = norm(q); let d = 0;
  const keys = new Set([...Object.keys(p), ...Object.keys(q)]);
  for (const k of keys) { const a = p[k] || 0, b = q[k] || 0, m = (a + b) / 2; if (a) d += 0.5 * a * Math.log2(a / m); if (b) d += 0.5 * b * Math.log2(b / m); }
  return d;
}
function vector(f, o) {
  const c = f.cols || 1, hs = f.hs, mean = hs.reduce((a, b) => a + b, 0) / (hs.length || 1);
  const sd = Math.sqrt(hs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (hs.length || 1));
  const ores = Object.assign({ coal: 1, iron: 1, gold: 1, diamond: 1 }, o.ores || {});
  return { n: hs.length, top: f.top, sub: f.sub, tree: f.trees / c, species: f.species, plant: f.plants / c, palette: f.palette, water: f.water / c, snow: f.snow / c,
    special: f.special / c, kinds: f.specialKinds, mean, sd, slope: f.slope / c, ores, caves: o.caves, land: f.around / (f.aroundN || 1), trunk: f.trees ? f.trunkH / f.trees : 0 };
}
// Axes a player can see or use. Two outcomes differ on an axis when the measured difference passes its threshold.
const AXES = {
  surface: (a, b) => jsd(a.top, b.top) > 0.2,
  subsurface: (a, b) => jsd(a.sub, b.sub) > 0.2,
  trees: (a, b) => Math.abs(a.tree - b.tree) > Math.max(0.006, 0.45 * Math.max(a.tree, b.tree)) || (a.tree > 0.004 && b.tree > 0.004 && (jsd(a.species, b.species) > 0.3 || Math.abs(a.trunk - b.trunk) > 2.5)),
  plants: (a, b) => Math.abs(a.plant - b.plant) > Math.max(0.02, 0.45 * Math.max(a.plant, b.plant)) || (a.plant > 0.01 && b.plant > 0.01 && jsd(a.palette, b.palette) > 0.3),
  water: (a, b) => Math.abs(a.water - b.water) > 0.2 || Math.abs(a.land - b.land) > 0.2,   // own water, or dry land in view (narrow river vs open sea)
  relief: (a, b) => Math.abs(a.mean - b.mean) > 4 || Math.abs(a.sd - b.sd) > 2.5 || Math.abs(a.slope - b.slope) > 0.5,
  snow: (a, b) => Math.abs(a.snow - b.snow) > 0.25,
  features: (a, b) => Math.abs(a.special - b.special) > 0.004 || (a.special > 0.002 && b.special > 0.002 && jsd(a.kinds, b.kinds) > 0.5),
  resources: (a, b) => Object.keys(a.ores).some(k => Math.abs(a.ores[k] - b.ores[k]) >= 0.3) || Math.abs(a.caves - b.caves) >= 0.3,
};
function distinctness(V) {
  const res = [];
  for (let i = 0; i < NO; i++) {
    if (!V[i] || V[i].n < 3) { res.push({ key: OUTS[i].key, measured: false }); continue; }
    let best = null;
    for (let j = 0; j < NO; j++) {
      if (i === j || !V[j] || V[j].n < 3) continue;
      const diff = Object.keys(AXES).filter(a => AXES[a](V[i], V[j]));
      if (!best || diff.length < best.diff.length) best = { other: OUTS[j].key, diff };
    }
    res.push({ key: OUTS[i].key, measured: true, nearest: best.other, axes: best.diff, distinct: best.diff.length >= 2 });
  }
  return res;
}

// ---- chunk timing
function timing(g) {
  const t = [], [sx, sz] = g.findSpawn(), c0x = sx >> 4, c0z = sz >> 4;
  for (let i = 0; i < 8; i++) g.generateChunk(c0x + 50 + i, c0z);   // warm-up
  const R = Math.ceil(Math.sqrt(NCHUNKS) / 2);
  for (let dz = -R; dz < R; dz++) for (let dx = -R; dx < R; dx++) {
    if (t.length >= NCHUNKS) break;
    const a = performance.now(); g.generateChunk(c0x + dx, c0z + dz); t.push(performance.now() - a);
  }
  return { mean: t.reduce((a, b) => a + b, 0) / t.length, median: quant(t, 0.5), p90: quant(t, 0.9), p99: quant(t, 0.99), n: t.length };
}

// ================================================================ main
fs.mkdirSync(OUT, { recursive: true });
const report = { size: SIZE, step: STEP, seeds: SEEDS, presets: {} };
console.log(`Blockcraft world generator v2 census · ${SIZE}x${SIZE} blocks per seed, sample every ${STEP} blocks · seeds ${SEEDS.join(', ')}`);
console.log(`(${NO} outcomes in ${FAMS.length} families; maps in ${OUT})\n`);
let Vbal = null;
for (const preset of PRESET_LIST) {
  const t0 = Date.now();
  const tot = new Float64Array(NO); let water = 0, cells = 0, borders = 0, pairs = 0; const bad = {}, patches = OUTS.map(() => []);
  const seam = { border: 0, borderSum: 0, borderSteep: 0, inner: 0, innerSum: 0, innerSteep: 0, max: 0 };
  let F = null, time = null, factoryMs = 0;
  for (const seed of SEEDS) {
    const tf = performance.now(); const g = W2.create(seed, preset); factoryMs += performance.now() - tf;
    const r = scanWorld(g, seed, preset);
    r.count.forEach((c, i) => { tot[i] += c; }); cells += r.N * r.N; water += r.water * r.N * r.N; borders += r.borders; pairs += r.pairs;
    for (const k in r.bad) bad[k] = (bad[k] || 0) + r.bad[k];
    r.patches.forEach((p, i) => patches[i].push(...p));
    const s = seams(g); for (const k in seam) seam[k] = k === 'max' ? Math.max(seam[k], s[k]) : seam[k] + s[k];
    if (preset === 'balanced' || PRESET_LIST.length === 1 || args.features) F = mergeF(F, features(g, seed, QUICK ? 8 : 16));
    if (!time) time = timing(g);
  }
  const share = Array.from(tot, c => c / cells);
  const fam = {}; OUTS.forEach((o, i) => { fam[o.family] = (fam[o.family] || 0) + share[i]; });
  const land = 1 - water / cells;
  const nbad = Object.values(bad).reduce((a, b) => a + b, 0);
  const P = W2.PRESETS[preset];
  console.log(`════ preset ${preset} (${P.label}): ocean target ${pct(P.ocean, 0)}, continent wavelength ${P.contScale}, climate scale x${P.climate}, river wavelength ${P.river}`);
  console.log(`land ${pct(land)} · water ${pct(1 - land)} (ocean family ${pct(fam.ocean)}, rivers ${pct(fam.river)}) · coast ${pct(fam.coast)}`);
  console.log('families: ' + FAMS.map(f => `${f} ${pct(fam[f] || 0)}`).join(', '));
  console.log(`\n${pad('outcome', 18)}${lpad('share', 7)}${lpad('patches', 9)}${lpad('median⌀', 9)}${lpad('p10⌀', 7)}${lpad('p90⌀', 7)}${lpad('tiny', 7)}`);
  const rows = [];
  OUTS.forEach((o, i) => {
    const p = patches[i], areas = p.length ? p : [0];
    const tiny = p.filter(a => a <= 2 * STEP * STEP).reduce((a, b) => a + b, 0) / Math.max(1, p.reduce((a, b) => a + b, 0));
    const row = { key: o.key, family: o.family, share: share[i], patches: p.length, median: diam(wquant(areas, 0.5)), p10: diam(wquant(areas, 0.1)), p90: diam(wquant(areas, 0.9)), tiny };
    rows.push(row);
    console.log(`${pad(o.key, 18)}${lpad(pct(share[i], 2), 7)}${lpad(p.length, 9)}${lpad(row.median.toFixed(0), 9)}${lpad(row.p10.toFixed(0), 7)}${lpad(row.p90.toFixed(0), 7)}${lpad(pct(tiny, 0), 7)}`);
  });
  const landRows = rows.filter(r => !['ocean', 'river'].includes(r.family) && r.share > 0);
  const landMedian = quant(landRows.map(r => r.median), 0.5);
  const landAreas = []; OUTS.forEach((o, i) => { if (!['ocean', 'river'].includes(o.family)) landAreas.push(...patches[i]); });
  const landCellMedian = diam(wquant(landAreas, 0.5));
  console.log(`(⌀ = equivalent diameter in blocks of the area-weighted patch size; tiny = share of an outcome's area in patches of ≤ 2 samples)`);
  console.log(`land patch diameter: median over outcomes ${landMedian.toFixed(0)} blocks, area-weighted over all land ${landCellMedian.toFixed(0)} blocks; outcomes present: ${rows.filter(r => r.share > 0).length}/${NO}; under 0.05 %: ${rows.filter(r => r.share < 0.0005).map(r => r.key).join(', ') || 'none'}`);
  console.log(`\ntransitions: ${pct(borders / pairs)} of adjacent samples are biome borders; incompatible neighbours ${nbad} of ${borders} borders (${pct(nbad / Math.max(1, borders), 3)})`);
  for (const [k, v] of Object.entries(bad).sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`   ${v} × ${k}`);
  console.log(`height steps (block resolution, ${SEAM_SIZE}² per seed, dry pairs): mean |Δh| ${(seam.borderSum / seam.border).toFixed(2)} across borders vs ${(seam.innerSum / seam.inner).toFixed(2)} inside; steps ≥ 4: ${pct(seam.borderSteep / seam.border, 2)} of border pairs vs ${pct(seam.innerSteep / seam.inner, 2)} inside; max step ${seam.max}`);
  console.log(`chunk generation (Node vm context, ${time.n} chunks): mean ${time.mean.toFixed(2)} ms, median ${time.median.toFixed(2)}, p90 ${time.p90.toFixed(2)}, p99 ${time.p99.toFixed(2)}; factory ${(factoryMs / SEEDS.length).toFixed(0)} ms`);
  let dist = null;
  if (F) {
    const V = F.map((f, i) => vector(f, OUTS[i]));
    if (preset === 'balanced') Vbal = V;
    dist = distinctness(V);
    const ok = dist.filter(d => d.distinct).length, measured = dist.filter(d => d.measured).length;
    console.log(`\ndistinctness (feature vectors measured from generated chunks; distinct = nearest neighbour differs on ≥ 2 axes of ${Object.keys(AXES).join(', ')}):`);
    console.log(`distinct outcomes: ${ok} of ${measured} measured (${NO} defined)`);
    for (const d of dist) {
      if (!d.measured) { console.log(`   ${pad(d.key, 18)} not measured (too rare in this sample)`); continue; }
      if (args.verbose || !d.distinct) console.log(`   ${pad(d.key, 18)} nearest ${pad(d.nearest, 18)} differs on ${d.axes.length}: ${d.axes.join(', ') || '-'}${d.distinct ? '' : '   ← NOT DISTINCT'}`);
    }
    if (args.verbose) V.forEach((v, i) => console.log(`   ${pad(OUTS[i].key, 18)} n=${v.n} tree ${v.tree.toFixed(3)} plant ${v.plant.toFixed(3)} water ${v.water.toFixed(2)} snow ${v.snow.toFixed(2)} special ${v.special.toFixed(3)} h ${v.mean.toFixed(1)}±${v.sd.toFixed(1)} slope ${v.slope.toFixed(2)} trunk ${v.trunk.toFixed(1)} top ${Object.entries(norm(v.top)).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, s]) => (DEFS[k] ? DEFS[k].key : 'air') + ' ' + (s * 100).toFixed(0)).join(' ')} land-around ${v.land.toFixed(2)}`));
  }
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)\n`);
  report.presets[preset] = { land, water: 1 - land, families: fam, outcomes: rows, landMedianDiameter: landMedian, landCellMedianDiameter: landCellMedian, borderShare: borders / pairs, incompatible: nbad / Math.max(1, borders), incompatiblePairs: bad,
    seams: { borderMean: seam.borderSum / seam.border, innerMean: seam.innerSum / seam.inner, borderSteep: seam.borderSteep / seam.border, innerSteep: seam.innerSteep / seam.inner, max: seam.max },
    timing: time, distinct: dist ? dist.filter(d => d.distinct).length : null, distinctness: dist };
}
if (args.json) fs.writeFileSync(args.json, JSON.stringify(report, null, 1));
void Vbal; void CS;
