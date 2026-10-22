// Blockcraft light engine tests. Zero dependencies: `node tests/lighting.mjs [name filter]`.
//
// The engine (js/lighting.js) is checked against a slow, independent reference (a plain FIFO relaxation over every
// loaded cell) on hand-built scenes and on real v1 terrain, after chunk loads in any order and after random edits.
// Prints PASS/FAIL per test, a timing summary, and exits non-zero on failure.
import assert from 'node:assert/strict';
import { loadBC } from './load.mjs';

const BC = loadBC();
const { B, OPAQUE, LIGHT } = BC.blocks;
const { CS, WH } = BC.C;
const L = BC.lighting;
const N = CS * CS * WH;
const IDX = (x, y, z) => x | (z << 4) | (y << 8);
const TORCH = B.TORCH, LEAVES = B.OAK_LEAVES, WATER = B.WATER, STONE = B.STONE, GLASS = B.GLASS;

// ------------------------------------------------------------------ runner
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const notes = [];

// ------------------------------------------------------------------ a tiny world of chunks
function makeWorld() {
  const chunks = new Map(), changed = new Set();
  const key = (cx, cz) => cx + ',' + cz;
  const engine = L.createEngine({ chunkAt: (cx, cz) => chunks.get(key(cx, cz)) || null, onChanged: (cx, cz) => changed.add(key(cx, cz)) });
  const W = {
    chunks, engine, changed,
    // add a chunk (data filled by fill(x, y, z) -> id in world coordinates) and light it
    load(cx, cz, fill) {
      const data = new Uint8Array(N);
      for (let y = 0; y < WH; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) data[IDX(x, y, z)] = fill(cx * CS + x, y, cz * CS + z) | 0;
      return W.loadData(cx, cz, data);
    },
    loadData(cx, cz, data) { const ch = { cx, cz, data, light: null }; chunks.set(key(cx, cz), ch); engine.initChunk(ch); return ch; },
    get(x, y, z) { if (y < 0 || y >= WH) return 0; const ch = chunks.get(key(x >> 4, z >> 4)); return ch ? ch.data[IDX(x & 15, y, z & 15)] : 0; },
    set(x, y, z, id) { const ch = chunks.get(key(x >> 4, z >> 4)); const i = IDX(x & 15, y, z & 15), old = ch.data[i]; ch.data[i] = id; engine.update(x, y, z, old, id); },
    sky: (x, y, z) => engine.getSkyLight(x, y, z),
    blk: (x, y, z) => engine.getBlockLight(x, y, z),
  };
  return W;
}

// Independent reference: recompute every loaded cell from scratch with a FIFO relaxation (no buckets, no arena).
function reference(W) {
  const out = new Map(), key = (cx, cz) => cx + ',' + cz;
  for (const [k, ch] of W.chunks) out.set(k, new Uint8Array(N));
  const LOSS = L.LOSS;
  const getCh = (x, z) => W.chunks.get(key(x >> 4, z >> 4));
  for (const sky of [true, false]) {
    const sh = sky ? 4 : 0, q = [];
    const lv = (x, y, z) => (out.get(key(x >> 4, z >> 4))[IDX(x & 15, y, z & 15)] >> sh) & 15;
    const setLv = (x, y, z, v) => { const a = out.get(key(x >> 4, z >> 4)), i = IDX(x & 15, y, z & 15); a[i] = (a[i] & (sky ? 0x0F : 0xF0)) | (v << sh); };
    for (const [k, ch] of W.chunks) {
      const bx = ch.cx * CS, bz = ch.cz * CS;
      for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
        if (sky) {
          // the virtual cell above the world has sky light 15
          let lvl = 15;
          for (let y = WH - 1; y >= 0; y--) {
            const id = ch.data[IDX(x, y, z)];
            if (OPAQUE[id]) break;
            lvl = LOSS[id] === 0 && lvl === 15 ? 15 : lvl - 1 - LOSS[id];
            if (lvl <= 0) break;
            setLv(bx + x, y, bz + z, lvl); q.push([bx + x, y, bz + z]);
          }
        } else {
          for (let y = 0; y < WH; y++) { const e = LIGHT[ch.data[IDX(x, y, z)]]; if (e) { setLv(bx + x, y, bz + z, e); q.push([bx + x, y, bz + z]); } }
        }
      }
    }
    const D = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
    for (let h = 0; h < q.length; h++) {
      const [x, y, z] = q[h], l = lv(x, y, z);
      for (const [dx, dy, dz] of D) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (ny < 0 || ny >= WH || !getCh(nx, nz)) continue;
        const id = W.get(nx, ny, nz);
        if (OPAQUE[id]) continue;
        const nl = sky && dy === -1 && l === 15 && LOSS[id] === 0 ? 15 : l - 1 - LOSS[id];
        if (nl > lv(nx, ny, nz)) { setLv(nx, ny, nz, nl); q.push([nx, ny, nz]); }
      }
    }
  }
  return out;
}
function assertMatchesReference(W, label) {
  const ref = reference(W);
  for (const [k, ch] of W.chunks) {
    const a = ch.light, b = ref.get(k);
    for (let i = 0; i < N; i++) if (a[i] !== b[i]) {
      const x = i & 15, z = (i >> 4) & 15, y = i >> 8;
      assert.fail(`${label}: chunk ${k} cell (${x},${y},${z}) id ${ch.data[i]}: engine sky ${a[i] >> 4} block ${a[i] & 15}, reference sky ${b[i] >> 4} block ${b[i] & 15}`);
    }
  }
}

const flat = h => (x, y) => (y < h ? STONE : 0);
// A 3x3 of chunks of solid stone with a sealed room carved at the centre chunk.
function stoneRoom(W, x0, y0, z0, sx, sy, sz) {
  for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++)
    W.load(cx, cz, (x, y, z) => (x >= x0 && x < x0 + sx && y >= y0 && y < y0 + sy && z >= z0 && z < z0 + sz ? 0 : STONE));
}

// ------------------------------------------------------------------ tests
test('open sky: sky light 15 above flat ground, 0 inside it, no block light', () => {
  const W = makeWorld();
  W.load(0, 0, flat(20));
  for (let y = 20; y < WH; y++) assert.equal(W.sky(5, y, 5), 15, 'y=' + y);
  assert.equal(W.sky(5, 19, 5), 0);
  assert.equal(W.sky(5, 90, 5), 15, 'above the world');
  assert.equal(W.blk(5, 30, 5), 0);
});

test('sky light spreads sideways under an overhang (-1 per block)', () => {
  const W = makeWorld();
  // roof at y=30 over x<8 (all z), open for x>=8
  W.load(0, 0, (x, y) => (y < 20 ? STONE : y === 30 && x < 8 ? STONE : 0));
  assert.equal(W.sky(8, 25, 5), 15);
  assert.equal(W.sky(7, 25, 5), 14);
  assert.equal(W.sky(3, 25, 5), 10);
  assert.equal(W.sky(0, 25, 5), 7);
  assertMatchesReference(W, 'overhang');
});

test('torch in a sealed room: 14 at the torch, -1 per block (Manhattan), 0 beyond', () => {
  const W = makeWorld();
  stoneRoom(W, -8, 10, -8, 32, 10, 32);   // big room spanning all 9 chunks; the roof keeps the sky out
  assert.equal(W.sky(0, 15, 0), 0, 'sealed room has no sky light');
  W.set(0, 11, 0, TORCH);
  assert.equal(W.blk(0, 11, 0), 14);
  assert.equal(W.blk(1, 11, 0), 13);
  assert.equal(W.blk(3, 13, 2), 14 - 7);
  assert.equal(W.blk(-5, 11, -5), 4);
  assert.equal(W.blk(13, 11, 0), 1);
  assert.equal(W.blk(14, 11, 0), 0);
  assert.equal(W.blk(0, 9, 0), 0, 'stone floor is dark');
  assertMatchesReference(W, 'torch room');
});

test('removing the torch removes all its light', () => {
  const W = makeWorld();
  stoneRoom(W, -8, 10, -8, 32, 10, 32);
  W.set(0, 11, 0, TORCH);
  W.set(0, 11, 0, 0);
  for (const ch of W.chunks.values()) for (let i = 0; i < N; i++) assert.equal(ch.light[i] & 15, 0, 'block light left at ' + i);
  assertMatchesReference(W, 'torch removed');
});

test('two torches: removing one keeps the other one\'s light (relight from the edge)', () => {
  const W = makeWorld();
  stoneRoom(W, -8, 10, -8, 32, 10, 32);
  W.set(0, 11, 0, TORCH); W.set(6, 11, 0, TORCH);
  assert.equal(W.blk(3, 11, 0), 11);
  W.set(0, 11, 0, 0);
  assert.equal(W.blk(0, 11, 0), 8, 'lit by the torch 6 blocks away');
  assert.equal(W.blk(-4, 11, 0), 4);
  assertMatchesReference(W, 'two torches');
});

test('opaque blocks stop light, and removing them lets it back in', () => {
  const W = makeWorld();
  stoneRoom(W, -8, 10, -8, 32, 10, 32);
  W.set(0, 11, 0, TORCH);
  for (let y = 10; y < 20; y++) for (let z = -8; z < 24; z++) W.set(2, y, z, STONE);   // wall at x=2
  assert.equal(W.blk(1, 11, 0), 13);
  assert.equal(W.blk(3, 11, 0), 0, 'the wall blocks all light');
  assertMatchesReference(W, 'wall');
  W.set(2, 11, 0, 0);   // open a hole
  assert.equal(W.blk(2, 11, 0), 12);
  assert.equal(W.blk(3, 11, 0), 11);
  assert.equal(W.blk(3, 12, 0), 10);
  assertMatchesReference(W, 'hole in wall');
});

test('block light crosses chunk borders both ways', () => {
  const W = makeWorld();
  stoneRoom(W, -16, 10, -16, 48, 10, 48);
  W.set(15, 11, 3, TORCH);   // last column of chunk (0,0)
  assert.equal(W.blk(16, 11, 3), 13, 'first cell of chunk (1,0)');
  assert.equal(W.blk(20, 11, 3), 9);
  assert.equal(W.blk(15, 11, -1), 10, 'into chunk (0,-1)');
  assert.equal(W.blk(17, 11, -2), 7, 'diagonal chunk (1,-1): 2 + 5 blocks away');
  W.set(15, 11, 3, 0);
  assert.equal(W.blk(20, 11, 3), 0);
  assertMatchesReference(W, 'seam');
});

test('a chunk loaded next to lit neighbours takes their light, and theirs spreads into it (both load orders)', () => {
  const fill = (x, y, z) => (y < 10 || y >= 20 ? STONE : x === 3 && y === 11 && z === 5 ? TORCH : x === 20 && y === 12 && z === 9 ? TORCH : 0);
  const a = makeWorld(); a.load(0, 0, fill); a.load(1, 0, fill);
  const b = makeWorld(); b.load(1, 0, fill); b.load(0, 0, fill);
  assert.equal(a.blk(16, 11, 5), 14 - 9, 'the nearer torch (9 blocks) wins over the far one (13)');
  assert.equal(a.blk(15, 12, 9), 14 - 5);
  for (const k of ['0,0', '1,0']) assert.deepEqual(Array.from(a.chunks.get(k).light), Array.from(b.chunks.get(k).light), 'chunk ' + k);
  assertMatchesReference(a, 'load order a'); assertMatchesReference(b, 'load order b');
});

test('sky light enters a cave through a neighbour chunk\'s opening', () => {
  const fill = (x, y, z) => {
    if (y < 10) return STONE;
    if (x >= 20 && x < 24 && z >= 4 && z < 8) return 0;       // shaft to the sky in chunk (1,0)
    if (y >= 12 && y < 15 && z >= 4 && z < 8 && x < 24) return 0;  // tunnel along x under the ground, into chunk (0,0)
    return y < 40 ? STONE : 0;
  };
  const W = makeWorld(); W.load(0, 0, fill); W.load(1, 0, fill);
  assert.equal(W.sky(22, 13, 5), 15, 'straight down the shaft');
  assert.equal(W.sky(16, 13, 5), 11);
  assert.equal(W.sky(12, 13, 5), 7, 'lit through the seam');
  assertMatchesReference(W, 'cave via seam');
  const V = makeWorld(); V.load(1, 0, fill); V.load(0, 0, fill);
  assert.deepEqual(Array.from(V.chunks.get('0,0').light), Array.from(W.chunks.get('0,0').light));
});

test('water and leaves cost one extra level; sky light loses its free fall under them', () => {
  const W = makeWorld();
  W.load(0, 0, (x, y, z) => (y < 10 ? STONE : y < 20 && x < 8 ? WATER : y === 30 && x >= 8 ? LEAVES : 0));
  assert.equal(W.sky(2, 19, 5), 13, 'top water cell (15 - 1 - 1)');
  assert.equal(W.sky(2, 18, 5), 11);
  assert.equal(W.sky(2, 14, 5), 3);
  assert.equal(W.sky(2, 12, 5), 0);
  assert.equal(W.sky(12, 30, 5), 13, 'leaves');
  assert.equal(W.sky(12, 29, 5), 12, 'air under the leaves, lit from above at 13 - 1');
  assertMatchesReference(W, 'water/leaves');
  // block light through water
  const T = makeWorld();
  stoneRoom(T, -8, 10, -8, 32, 10, 32);
  T.set(0, 11, 0, TORCH);
  // a water-filled tunnel: 1x1, walled in, so light can only travel through the water
  for (let x = 1; x <= 6; x++) { for (const [dy, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) T.set(x, 11 + dy, dz, STONE); T.set(x, 11, 0, WATER); }
  assert.equal(T.blk(1, 11, 0), 12);
  assert.equal(T.blk(4, 11, 0), 6);
  assert.equal(T.blk(6, 11, 0), 2);
  T.set(0, 11, 1, GLASS);
  assert.equal(T.blk(0, 11, 1), 13, 'glass lets light through with no extra loss');
  assertMatchesReference(T, 'torch through water');
});

test('covering an open column darkens it; uncovering restores 15 all the way down', () => {
  const W = makeWorld();
  W.load(0, 0, flat(20)); W.load(1, 0, flat(20)); W.load(0, 1, flat(20));
  W.set(5, 60, 5, STONE);
  assert.equal(W.sky(5, 59, 5), 14);
  assert.equal(W.sky(5, 20, 5), 14);
  assertMatchesReference(W, 'covered');
  // a 3x3 roof makes the centre column 13
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) W.set(5 + dx, 60, 5 + dz, STONE);
  assert.equal(W.sky(5, 40, 5), 13);
  assertMatchesReference(W, 'roof');
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) W.set(5 + dx, 60, 5 + dz, 0);
  for (let y = 20; y < WH; y++) assert.equal(W.sky(5, y, 5), 15);
  assertMatchesReference(W, 'uncovered');
  W.set(5, WH - 1, 5, LEAVES);
  assert.equal(W.sky(5, WH - 1, 5), 13, 'leaves in the top layer');
  W.set(5, WH - 1, 5, 0);
  assert.equal(W.sky(5, WH - 1, 5), 15);
  assertMatchesReference(W, 'top layer');
});

test('determinism: the same terrain lit twice gives identical light', () => {
  const gen = BC.worldgen.create(1, 12345);
  const run = order => { const W = makeWorld(); for (const [cx, cz] of order) W.loadData(cx, cz, gen.generateChunk(cx, cz)); return W; };
  const order = []; for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) order.push([cx, cz]);
  const a = run(order), b = run(order.slice().reverse()), c = run(order.slice().sort((p, q) => (p[0] * 7 + p[1] * 3) % 5 - (q[0] * 7 + q[1] * 3) % 5));
  for (const k of a.chunks.keys()) {
    assert.deepEqual(Array.from(a.chunks.get(k).light), Array.from(b.chunks.get(k).light), 'reverse order, chunk ' + k);
    assert.deepEqual(Array.from(a.chunks.get(k).light), Array.from(c.chunks.get(k).light), 'mixed order, chunk ' + k);
  }
  assertMatchesReference(a, 'terrain');
});

test('random edits on real terrain (torches, stone, water, leaves, digging) always match a full recompute', () => {
  const gen = BC.worldgen.create(1, 4051750246);
  const W = makeWorld();
  for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) W.loadData(cx, cz, gen.generateChunk(cx, cz));
  let s = 99;
  const rnd = n => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s >>> 8) % n; };
  const ids = [TORCH, TORCH, 0, 0, 0, STONE, WATER, LEAVES, GLASS];
  for (let k = 0; k < 400; k++) {
    const x = rnd(40) - 12, z = rnd(40) - 12, y = 10 + rnd(50);
    W.set(x, y, z, ids[rnd(ids.length)]);
    if (k % 50 === 49) assertMatchesReference(W, 'after ' + (k + 1) + ' edits');
  }
  assertMatchesReference(W, 'after all edits');
});

test('onChanged reports the edited chunk and neighbours whose meshes sample the changed border', () => {
  const W = makeWorld();
  stoneRoom(W, -16, 10, -16, 48, 10, 48);
  W.changed.clear();
  W.set(8, 11, 8, TORCH);   // light reaches x 0..15+ ... from the middle of chunk (0,0): 14 - 8 = 6 at the borders
  for (const k of ['0,0', '-1,0', '1,0', '0,-1', '0,1']) assert.ok(W.changed.has(k), 'missing ' + k);
  W.changed.clear();
  W.set(8, 11, 8, 0);
  assert.ok(W.changed.has('0,0'));
});

test('skyLevel follows the day: 15 at noon, 4 at midnight', () => {
  assert.equal(L.skyLevel(0.25), 15);
  assert.equal(L.skyLevel(0.75), 4);
  assert.ok(L.skyLevel(0.02) > 4 && L.skyLevel(0.02) < 15);
});

test('performance: light for v1 terrain chunks (ms per chunk) and a torch edit', () => {
  const gen = BC.worldgen.create(1, 12345);
  const W = makeWorld(), R = 5, datas = [];
  for (let cz = -R; cz <= R; cz++) for (let cx = -R; cx <= R; cx++) datas.push([cx, cz, gen.generateChunk(cx, cz)]);
  const t0 = performance.now();
  for (const [cx, cz, d] of datas) W.loadData(cx, cz, d);
  const per = (performance.now() - t0) / datas.length;
  // a torch placed and removed in the open, and a block placed on the surface
  const t1 = performance.now(); let n = 0;
  for (let k = 0; k < 40; k++) {
    const x = k * 3 - 60, z = (k * 7) % 50 - 25, y = 60;
    W.set(x, y, z, TORCH); W.set(x, y, z, 0); n += 2;
  }
  const upd = (performance.now() - t1) / n;
  notes.push(`light: ${per.toFixed(2)} ms per chunk (${datas.length} v1 chunks), torch place/remove ${upd.toFixed(3)} ms per edit`);
  assert.ok(per < 50, 'chunk light too slow: ' + per);
});

// ------------------------------------------------------------------ run
const filter = process.argv[2];
const selected = filter ? tests.filter(t => t.name.toLowerCase().includes(filter.toLowerCase())) : tests;
let failed = 0;
for (const t of selected) {
  try { await t.fn(); console.log(`PASS  ${t.name}`); }
  catch (e) { failed++; console.log(`FAIL  ${t.name}`); console.log(String((e && e.message) || e).split('\n').map(l => '        ' + l).join('\n')); }
}
for (const n of notes) console.log('note  ' + n);
console.log(`\n${selected.length} tests: ${selected.length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
