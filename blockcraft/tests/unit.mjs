// Blockcraft unit tests. Zero dependencies: run with `node tests/unit.mjs [name filter]`.
//
// The pure-logic modules (core, blocks, items, inventory, crafting, survival, worldgen, save) are loaded
// into a Node VM context by load.mjs and checked against the reference game's rules, the v0.1 terrain
// (golden chunk hashes) and the v0.1 save format. Prints PASS/FAIL per test and exits non-zero on failure.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadBC, root } from './load.mjs';

const BC = loadBC();
const { B } = BC.blocks;
const { CS, WH, SEA, SNOWLINE } = BC.C;
const IT = BC.items, INV = BC.inv, CR = BC.crafting, SV = BC.survival, SAVE = BC.save;

// ════════════════════════════════════════════════════════════════════════════ runner

const tests = [];
let scope = '';
function suite(name, fn) { const prev = scope; scope = name; fn(); scope = prev; }
function test(name, fn) { tests.push({ name: scope ? `${scope} › ${name}` : name, fn }); }

async function run() {
  const filter = process.argv[2];
  const selected = filter ? tests.filter(t => t.name.toLowerCase().includes(filter.toLowerCase())) : tests;
  const failures = [];
  for (const t of selected) {
    try {
      await t.fn();
      console.log(`PASS  ${t.name}`);
    } catch (e) {
      failures.push(t.name);
      console.log(`FAIL  ${t.name}`);
      console.log(String((e && e.message) || e).split('\n').map(l => '        ' + l).join('\n'));
    }
  }
  console.log(`\n${selected.length} tests: ${selected.length - failures.length} passed, ${failures.length} failed`);
  if (failures.length) console.log('Failed:\n' + failures.map(n => '  - ' + n).join('\n'));
  process.exitCode = failures.length ? 1 : 0;
}

// ════════════════════════════════════════════════════════════════════════════ helpers

// Objects built inside the VM have the VM's prototypes, which deepStrictEqual treats as different from
// host literals. Round-tripping through (host) JSON compares plain data only.
const plain = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (actual, expected, msg) => assert.deepStrictEqual(plain(actual), plain(expected), msg);

function fnv1a(bytes) {
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

// A rand() that returns the given values in order and fails loudly if the code under test asks for more.
function seq(...values) {
  let i = 0;
  const rand = () => { if (i >= values.length) throw new Error(`rand() called more than ${values.length} times`); return values[i++]; };
  rand.calls = () => i;
  return rand;
}

const id = key => IT.idOf(key);
const stack = (key, count) => IT.make(key, count);
// Build a slot array from { index: [key, count] }.
function slotsOf(n, spec = {}) {
  const s = INV.empty(n);
  for (const [i, [key, count]] of Object.entries(spec)) s[i] = stack(key, count);
  return s;
}
// Plain view of a slot array: [key, count] per slot or null.
const view = slots => slots.map(s => (s ? [IT.get(s.id).key, s.count] : null));

// Run fn with Date.now() returning a controllable clock (the VM shares the host's Date).
function withClock(start, fn) {
  const real = Date.now;
  let t = start;
  Date.now = () => t;
  try { return fn({ set: v => { t = v; }, advance: d => { t += d; } }); } finally { Date.now = real; }
}

function quotaError() {
  return typeof DOMException === 'function'
    ? new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    : Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
}
// memoryStorage wrapper whose setItem throws `makeError()` for keys where failWrite(key) is true.
function failingStorage(failWrite, makeError = quotaError) {
  const inner = SAVE.memoryStorage();
  const st = {
    fail: failWrite,
    getItem: k => inner.getItem(k),
    setItem: (k, v) => { if (st.fail(k)) throw makeError(); inner.setItem(k, v); },
    removeItem: k => inner.removeItem(k),
    key: i => inner.key(i),
    get length() { return inner.length; },
  };
  return st;
}
const freshStore = () => { const storage = SAVE.memoryStorage(); return { storage, store: SAVE.createStore(storage) }; };

// ════════════════════════════════════════════════════════════════════════════ core

suite('core', () => {
  test('util.parseSeed: blank or missing text gives a random uint32', () => {
    assert.equal(BC.util.parseSeed('', () => 0.5), 2147483648);
    assert.equal(BC.util.parseSeed('   ', () => 0), 0);
    assert.equal(BC.util.parseSeed(null, () => 0.999999999), 4294967291);
    for (let i = 0; i < 50; i++) {
      const s = BC.util.parseSeed(undefined);
      assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff, `not a uint32: ${s}`);
    }
  });

  test('util.parseSeed: integers map to themselves mod 2^32', () => {
    assert.equal(BC.util.parseSeed('123'), 123);
    assert.equal(BC.util.parseSeed('  123 '), 123);
    assert.equal(BC.util.parseSeed('0'), 0);
    assert.equal(BC.util.parseSeed('-1'), 4294967295);
    assert.equal(BC.util.parseSeed('4294967296'), 0);
    assert.equal(BC.util.parseSeed('4294967297'), 1);
    assert.equal(BC.util.parseSeed('-4294967297'), 4294967295);
    assert.equal(BC.util.parseSeed('99999999999999999999'), Number(99999999999999999999n % 4294967296n));
  });

  test('util.parseSeed: text uses Java String.hashCode >>> 0', () => {
    assert.equal(BC.util.javaHash('hello'), 99162322);
    assert.equal(BC.util.parseSeed('hello'), 99162322);
    assert.equal(BC.util.parseSeed('1.5'), BC.util.javaHash('1.5') >>> 0);
    // A negative Java hash becomes its unsigned twin.
    const neg = 'Blockcraft world with a long name';
    assert.ok(BC.util.javaHash(neg) < 0);
    assert.equal(BC.util.parseSeed(neg), BC.util.javaHash(neg) + 4294967296);
  });

  test('util.hashStr is 32-bit FNV-1a', () => {
    assert.equal(BC.util.hashStr(''), 0x811c9dc5);
    assert.equal(BC.util.hashStr('a'), 0xe40c292c);
  });

  test('util.mulberry32 is deterministic and in [0, 1)', () => {
    const a = BC.util.mulberry32(42), b = BC.util.mulberry32(42);
    for (let i = 0; i < 1000; i++) { const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1); }
  });
});

// ════════════════════════════════════════════════════════════════════════════ worldgen

suite('worldgen', () => {
  const golden = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'golden-v1.json'), 'utf8'));
  const bySeed = new Map();
  for (const [k, hash] of Object.entries(golden)) {
    const [seed, coords] = k.split(':');
    const [cx, cz] = coords.split(',').map(Number);
    if (!bySeed.has(seed)) bySeed.set(seed, []);
    bySeed.get(seed).push({ cx, cz, hash });
  }

  test('golden file covers 4 seeds x 7 chunks', () => {
    assert.equal(Object.keys(golden).length, 28);
    assert.equal(bySeed.size, 4);
  });

  for (const [seed, chunks] of bySeed) {
    test(`golden v1 chunk hashes match for seed ${seed}`, () => {
      const gen = BC.worldgen.create(1, Number(seed));
      const bad = [];
      for (const { cx, cz, hash } of chunks) {
        const got = fnv1a(gen.generateChunk(cx, cz));
        if (got !== hash) bad.push(`${seed}:${cx},${cz} got ${got}, want ${hash}`);
      }
      assert.equal(bad.length, 0, 'terrain changed:\n' + bad.join('\n'));
    });
  }

  test('generateChunk returns a CS*CS*WH Uint8Array with bedrock at y=0', () => {
    const data = BC.worldgen.create(1, 1).generateChunk(0, 0);
    assert.ok(data instanceof Uint8Array);
    assert.equal(data.length, CS * CS * WH);
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) assert.equal(data[BC.worldgen.IDX(x, 0, z)], B.BEDROCK);
  });

  test('IDX layout matches the v0.1 edit format (x + z*16 + y*256)', () => {
    assert.equal(BC.worldgen.IDX(0, 0, 0), 0);
    assert.equal(BC.worldgen.IDX(5, 0, 0), 5);
    assert.equal(BC.worldgen.IDX(0, 0, 1), 16);
    assert.equal(BC.worldgen.IDX(0, 1, 0), 256);
    assert.equal(BC.worldgen.IDX(15, WH - 1, 15), CS * CS * WH - 1);
  });

  test('chunk generation is deterministic (repeat, new instance, any order)', () => {
    const a = BC.worldgen.create(1, 12345);
    const first = fnv1a(a.generateChunk(3, -7));
    assert.equal(fnv1a(a.generateChunk(3, -7)), first, 'same instance, second call');
    const b = BC.worldgen.create(1, 12345);
    b.generateChunk(40, 40); b.generateChunk(-100, -3);
    assert.equal(fnv1a(b.generateChunk(3, -7)), first, 'fresh instance after other chunks');
    assert.notEqual(fnv1a(BC.worldgen.create(1, 12346).generateChunk(3, -7)), first, 'different seed');
  });

  test('terrainAt is deterministic and returns [integer height in range, boolean desert]', () => {
    const a = BC.worldgen.create(1, 4051750246), b = BC.worldgen.create(1, 4051750246);
    for (let i = 0; i < 400; i++) {
      const x = (i * 37) % 997 - 500, z = (i * 91) % 883 - 440;
      const t = a.terrainAt(x, z);
      same(t, b.terrainAt(x, z), `terrainAt(${x}, ${z})`);
      same(t, a.terrainAt(x, z), `terrainAt(${x}, ${z}) repeat`);
      assert.ok(Number.isInteger(t[0]) && t[0] >= 4 && t[0] <= WH - 10, `height ${t[0]}`);
      assert.equal(typeof t[1], 'boolean');
    }
  });

  test('seed is coerced to uint32', () => {
    const neg = BC.worldgen.create(1, -1);
    assert.equal(neg.seed, 4294967295);
    assert.equal(fnv1a(neg.generateChunk(0, 0)), fnv1a(BC.worldgen.create(1, 4294967295).generateChunk(0, 0)));
  });

  test('unknown generator versions are rejected', () => {
    assert.throws(() => BC.worldgen.create(2, 1), /Unknown world generator version 2/);
    assert.throws(() => BC.worldgen.create(0, 1));
  });

  // Blocks the terrain pass produces (trees add logs/leaves/cactus and a dirt block at the trunk base).
  const TERRAIN = new Set([B.GRASS, B.DIRT, B.STONE, B.SAND, B.SNOW, B.COAL, B.IRON, B.GOLD, B.DIAMOND, B.BEDROCK]);
  const DECOR = new Set([B.AIR, B.LOG, B.LEAVES, B.CACTUS]);
  const topTerrain = (data, lx, lz) => { for (let y = WH - 1; y >= 0; y--) if (TERRAIN.has(data[BC.worldgen.IDX(lx, y, lz)])) return y; return -1; };

  test('every column of neighbouring chunks (0,0) and (1,0) agrees with terrainAt', () => {
    for (const seed of [1, 12345, 4051750246, 1171903558]) {
      const gen = BC.worldgen.create(1, seed);
      for (const cx of [0, 1]) {
        const data = gen.generateChunk(cx, 0);
        for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
          const where = `seed ${seed} x=${cx * CS + lx} z=${lz}`;
          const [h] = gen.terrainAt(cx * CS + lx, lz);
          assert.ok(topTerrain(data, lx, lz) <= h, `${where}: terrain above terrainAt height ${h}`);
          const atH = data[BC.worldgen.IDX(lx, h, lz)];
          // The surface block exists unless a cave opened it (caves only reach the surface above the beach).
          assert.ok(TERRAIN.has(atH) || (atH === B.AIR && h > SEA + 1), `${where}: block ${atH} at surface y=${h}`);
          for (let y = h + 1; y < WH; y++) {
            const b = data[BC.worldgen.IDX(lx, y, lz)];
            assert.ok(DECOR.has(b) || (b === B.WATER && y <= SEA), `${where}: block ${b} at y=${y} above surface ${h}`);
          }
        }
      }
    }
  });

  test('surface heights are continuous across the x=15 | x=16 chunk border', () => {
    for (const seed of [1, 12345, 4051750246, 1171903558]) {
      const gen = BC.worldgen.create(1, seed);
      const left = gen.generateChunk(0, 0), right = gen.generateChunk(1, 0);
      let interiorStep = 0;
      for (let z = 0; z < CS; z++) for (let x = 0; x < 2 * CS - 1; x++) {
        if (x !== 15) interiorStep = Math.max(interiorStep, Math.abs(gen.terrainAt(x, z)[0] - gen.terrainAt(x + 1, z)[0]));
      }
      for (let z = 0; z < CS; z++) {
        const h15 = gen.terrainAt(15, z)[0], h16 = gen.terrainAt(16, z)[0];
        for (const [data, lx, h] of [[left, 15, h15], [right, 0, h16]]) {
          const top = topTerrain(data, lx, z);
          if (top !== h) assert.equal(data[BC.worldgen.IDX(lx, h, z)], B.AIR, `seed ${seed} z=${z}: surface ${top} != terrainAt ${h} without a cave`);
        }
        assert.ok(Math.abs(h15 - h16) <= Math.max(1, interiorStep), `seed ${seed} z=${z}: seam ${h15} -> ${h16}`);
      }
    }
  });

  test('findSpawn is deterministic and lands on dry, non-desert, non-mountain ground', () => {
    for (const seed of [1, 12345, 4051750246, 1171903558]) {
      const gen = BC.worldgen.create(1, seed);
      const [x, z] = gen.findSpawn();
      same(BC.worldgen.create(1, seed).findSpawn(), [x, z]);
      const [h, desert] = gen.terrainAt(x, z);
      assert.ok(h > SEA + 2 && h < SNOWLINE - 4 && !desert, `seed ${seed}: spawn (${x}, ${z}) h=${h} desert=${desert}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════ blocks

suite('blocks', () => {
  const WOOD_PICK = { type: 'pickaxe', tier: 1, speed: 2 };
  const STONE_PICK = { type: 'pickaxe', tier: 2, speed: 4 };
  const IRON_PICK = { type: 'pickaxe', tier: 3, speed: 6 };
  const bi = (key, tool, env) => BC.blocks.breakInfo(B[key.toUpperCase()], tool, env);

  test('block ids 1..20 are stable (saved in worlds; 1..19 identical to v0.1)', () => {
    const keys = ['grass_block', 'dirt', 'stone', 'cobblestone', 'sand', 'oak_log', 'oak_leaves', 'oak_planks', 'glass', 'water',
      'bedrock', 'snowy_grass_block', 'bricks', 'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'cactus', 'stone_bricks', 'crafting_table'];
    assert.equal(BC.blocks.NB, keys.length + 1);
    keys.forEach((k, i) => assert.equal(BC.blocks.DEFS[i + 1].key, k, `id ${i + 1}`));
    assert.equal(B.AIR, 0);
  });

  test('breakInfo: stone by hand = 150 ticks (7.5 s), no drop', () => {
    const r = bi('stone', null);
    assert.equal(r.ticks, 150);
    assert.equal(r.seconds, 7.5);
    assert.equal(r.canHarvest, false);
    assert.equal(r.correctTool, false);
  });

  test('breakInfo: stone with a wooden pickaxe = 23 ticks, harvestable', () => {
    const r = bi('stone', WOOD_PICK);
    assert.equal(r.ticks, 23);
    assert.equal(r.canHarvest, true);
    assert.equal(r.correctTool, true);
  });

  test('breakInfo: hand-mineable blocks (log 60, dirt 15, leaves 6 ticks)', () => {
    assert.equal(bi('oak_log', null).ticks, 60);
    assert.equal(bi('oak_log', null).canHarvest, true);
    assert.equal(bi('dirt', null).ticks, 15);
    assert.equal(bi('dirt', null).seconds, 0.75);
    assert.equal(bi('oak_leaves', null).ticks, 6);
    assert.equal(bi('grass_block', null).ticks, 18);
  });

  test('breakInfo: harvest tiers (iron needs stone, diamond/gold need iron)', () => {
    assert.equal(bi('iron_ore', WOOD_PICK).canHarvest, false);
    assert.equal(bi('iron_ore', WOOD_PICK).correctTool, true);
    assert.equal(bi('iron_ore', STONE_PICK).canHarvest, true);
    assert.equal(bi('diamond_ore', STONE_PICK).canHarvest, false);
    assert.equal(bi('diamond_ore', IRON_PICK).canHarvest, true);
    assert.equal(bi('gold_ore', STONE_PICK).canHarvest, false);
    assert.equal(bi('gold_ore', IRON_PICK).canHarvest, true);
    assert.equal(bi('coal_ore', WOOD_PICK).canHarvest, true);
    // Wrong tool type never harvests a tiered block.
    assert.equal(bi('stone', { type: 'axe', tier: 4, speed: 8 }).canHarvest, false);
  });

  test('breakInfo: a correct tool that cannot harvest still mines at tool speed (/100)', () => {
    // iron ore, wooden pickaxe: 2 / 3 / 100 per tick
    assert.equal(bi('iron_ore', WOOD_PICK).ticks, Math.ceil(1 / (2 / 3 / 100)));
  });

  test('breakInfo: bedrock and water are unbreakable', () => {
    for (const key of ['bedrock', 'water']) {
      const r = bi(key, IRON_PICK);
      assert.equal(r.ticks, Infinity);
      assert.equal(r.seconds, Infinity);
      assert.equal(r.canHarvest, false);
    }
    assert.equal(BC.blocks.breakInfo(0, null).ticks, Infinity, 'air');
  });

  test('breakInfo: airborne and in-water each divide speed by 5', () => {
    assert.equal(bi('stone', WOOD_PICK, { airborne: true }).ticks, Math.ceil(1 / (0.4 / 1.5 / 30)));
    assert.equal(bi('stone', WOOD_PICK, { airborne: true }).ticks, 113);
    assert.equal(bi('stone', WOOD_PICK, { inWater: true }).ticks, 113);
    assert.equal(bi('stone', WOOD_PICK, { inWater: true, airborne: true }).ticks, Math.ceil(1 / (0.08 / 1.5 / 30)));
    assert.equal(bi('dirt', null, { airborne: true }).ticks, 75);
  });

  test('breakInfo: swords are faster on leaves only (cactus unverified, so not sped up)', () => {
    const sword = { type: 'sword', tier: 1, speed: 2 };
    assert.equal(bi('oak_leaves', sword).ticks, Math.ceil(1 / (1.5 / 0.2 / 30)));
    assert.equal(bi('cactus', sword).ticks, Math.ceil(1 / (1 / 0.4 / 30)));
    assert.equal(bi('dirt', sword).ticks, 15);
  });

  test('drops: grass and snowy grass drop dirt, most blocks drop themselves', () => {
    const d = BC.blocks.drops;
    same(d(B.GRASS_BLOCK, true), [{ key: 'dirt', count: 1 }]);
    same(d(B.SNOWY_GRASS_BLOCK, true), [{ key: 'dirt', count: 1 }]);
    same(d(B.DIRT, true), [{ key: 'dirt', count: 1 }]);
    same(d(B.OAK_LOG, true), [{ key: 'oak_log', count: 1 }]);
    same(d(B.CRAFTING_TABLE, true), [{ key: 'crafting_table', count: 1 }]);
  });

  test('drops: stone gives cobblestone only when harvestable; ores give their item', () => {
    const d = BC.blocks.drops;
    same(d(B.STONE, true), [{ key: 'cobblestone', count: 1 }]);
    same(d(B.STONE, false), []);
    same(d(B.STONE, bi('stone', null).canHarvest), []);
    same(d(B.COAL_ORE, true), [{ key: 'coal', count: 1 }]);
    same(d(B.IRON_ORE, true), [{ key: 'raw_iron', count: 1 }]);
    same(d(B.DIAMOND_ORE, true), [{ key: 'diamond', count: 1 }]);
  });

  test('drops: glass, water and bedrock drop nothing', () => {
    for (const b of [B.GLASS, B.WATER, B.BEDROCK]) same(BC.blocks.drops(b, true, seq()), []);
  });

  test('drops: leaves roll apple (1/20) then stick (1/50, 1-2) with the injected rand', () => {
    const d = (...r) => BC.blocks.drops(B.OAK_LEAVES, true, seq(...r));
    same(d(0.9, 0.9), []);
    same(d(0.01, 0.9), [{ key: 'apple', count: 1 }]);
    same(d(0.9, 0.01, 0.3), [{ key: 'stick', count: 2 }]);
    same(d(0.9, 0.01, 0.7), [{ key: 'stick', count: 1 }]);
    same(d(0, 0, 0), [{ key: 'apple', count: 1 }, { key: 'stick', count: 2 }]);
    same(d(0.05, 0.02), [], 'thresholds are strict');
  });

  test('every block drop names a registered item', () => {
    for (let b = 1; b < BC.blocks.NB; b++) {
      for (const drop of BC.blocks.drops(b, true, () => 0)) assert.ok(IT.key(drop.key), `block ${b} drops unknown item ${drop.key}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════ items

suite('items', () => {
  test('block items share the block id (1..20)', () => {
    for (let b = 1; b < BC.blocks.NB; b++) {
      const it = IT.get(b);
      assert.ok(it, `no item for block ${b}`);
      assert.equal(it.id, b);
      assert.equal(it.block, b);
      assert.equal(it.kind, 'block');
      assert.equal(it.key, BC.blocks.DEFS[b].key);
      assert.equal(it.maxStack, 64);
    }
    assert.equal(IT.get(0), null);
  });

  test('non-block item ids are fixed (stored in saves)', () => {
    const expect = { stick: 256, coal: 257, raw_iron: 258, iron_ingot: 259, raw_gold: 260, gold_ingot: 261, diamond: 262, apple: 263 };
    for (const [k, v] of Object.entries(expect)) { assert.equal(id(k), v, k); assert.equal(IT.maxStack(v), 64, k); }
    same(IT.key('apple').food, { hunger: 4, saturation: 2.4 });
  });

  test('tools: 20 tools with ids 300 + material*10 + type, never stacking', () => {
    const tools = IT.all().filter(i => i.kind === 'tool');
    assert.equal(tools.length, 20);
    IT.MATERIALS.forEach((m, mi) => IT.TYPES.forEach((t, ti) => {
      const it = IT.key(`${m.key}_${t.key}`);
      assert.ok(it, `${m.key}_${t.key}`);
      assert.equal(it.id, 300 + mi * 10 + ti);
      assert.equal(it.maxStack, 1, it.key);
      assert.equal(it.tool.type, t.key);
    }));
    assert.equal(id('wooden_pickaxe'), 300);
    assert.equal(id('diamond_sword'), 343);
  });

  test('tools: durability, tier and speed per material', () => {
    const expect = {
      wooden: { durability: 59, tier: 1, speed: 2 }, stone: { durability: 131, tier: 2, speed: 4 },
      iron: { durability: 250, tier: 3, speed: 6 }, golden: { durability: 32, tier: 1, speed: 12 },
      diamond: { durability: 1561, tier: 4, speed: 8 },
    };
    for (const [mat, e] of Object.entries(expect)) for (const type of ['pickaxe', 'axe', 'shovel', 'sword']) {
      const t = IT.key(`${mat}_${type}`).tool;
      assert.equal(t.durability, e.durability, `${mat}_${type} durability`);
      assert.equal(t.tier, e.tier, `${mat}_${type} tier`);
      assert.equal(t.speed, e.speed, `${mat}_${type} speed`);
    }
  });

  test('make(): by key or id, default count 1, tools get dmg 0, unknown gives null', () => {
    same(IT.make('cobblestone', 5), { id: B.COBBLESTONE, count: 5 });
    same(IT.make('stick'), { id: 256, count: 1 });
    same(IT.make(B.DIRT, 3), { id: B.DIRT, count: 3 });
    same(IT.make('wooden_pickaxe'), { id: 300, count: 1, dmg: 0 });
    assert.equal(IT.make('no_such_item'), null);
    assert.equal(IT.make(9999), null);
  });

  test('valid(): known id, integer count within 1..maxStack', () => {
    assert.equal(IT.valid(IT.make('dirt', 64)), true);
    assert.equal(IT.valid(IT.make('wooden_pickaxe')), true);
    assert.equal(IT.valid({ id: B.DIRT, count: 65 }), false);
    assert.equal(IT.valid({ id: B.DIRT, count: 0 }), false);
    assert.equal(IT.valid({ id: B.DIRT, count: 1.5 }), false);
    assert.equal(IT.valid({ id: 300, count: 2 }), false);
    assert.equal(IT.valid({ id: 9999, count: 1 }), false);
    assert.equal(IT.valid(null), false);
  });

  test('toolOf() feeds breakInfo', () => {
    const t = IT.toolOf(IT.make('wooden_pickaxe'));
    assert.equal(BC.blocks.breakInfo(B.STONE, t).ticks, 23);
    assert.equal(IT.toolOf(IT.make('stick')), null);
    assert.equal(IT.toolOf(null), null);
  });
});

// ════════════════════════════════════════════════════════════════════════════ inventory

suite('inventory', () => {
  test('addTo merges into existing stacks before using empty slots', () => {
    const s = slotsOf(5, { 3: ['cobblestone', 60], 4: ['cobblestone', 10] });
    const left = INV.addTo(s, stack('cobblestone', 10), [0, 1, 2, 3, 4]);
    assert.equal(left, 0);
    same(view(s), [null, null, null, ['cobblestone', 64], ['cobblestone', 16]]);
  });

  test('addTo respects maxStack 64 and returns the leftover', () => {
    const s = INV.empty(2);
    const st = stack('dirt', 150);
    assert.equal(INV.addTo(s, st, [0, 1]), 22);
    assert.equal(st.count, 22);
    same(view(s), [['dirt', 64], ['dirt', 64]]);
  });

  test('addTo never stacks tools', () => {
    const s = slotsOf(3, { 0: ['wooden_pickaxe', 1] });
    assert.equal(INV.addTo(s, stack('wooden_pickaxe'), [0, 1, 2]), 0);
    same(view(s), [['wooden_pickaxe', 1], ['wooden_pickaxe', 1], null]);
    // Even a (malformed) multi-count tool stack is spread one per slot.
    const t = INV.empty(3);
    assert.equal(INV.addTo(t, { id: 300, count: 2, dmg: 0 }, [0, 1, 2]), 0);
    same(view(t), [['wooden_pickaxe', 1], ['wooden_pickaxe', 1], null]);
  });

  test('addTo keeps different items and worn tools apart', () => {
    const s = slotsOf(2, { 0: ['dirt', 10] });
    INV.addTo(s, stack('sand', 5), [0, 1]);
    same(view(s), [['dirt', 10], ['sand', 5]]);
    assert.equal(INV.stackable({ id: 300, count: 1, dmg: 3 }, { id: 300, count: 1, dmg: 3 }), false);
  });

  test('addPlayer: tops up the selected stack first, then 0..35; empty slots from 0 (reference order)', () => {
    const s = INV.empty(36);
    INV.addPlayer(s, stack('dirt', 5), 4);
    assert.equal(s[0].count, 5, 'an empty selected slot is not preferred: first free slot from 0');
    INV.addPlayer(s, stack('sand', 5), 4);
    assert.equal(s[1].id, B.SAND, 'next free slot');
    const t = slotsOf(36, { 0: ['dirt', 10], 6: ['dirt', 10] });
    INV.addPlayer(t, stack('dirt', 60), 6);
    same([t[6].count, t[0].count], [64, 16], 'merges into the selected stack before slot 0');
    const u = slotsOf(36, { 20: ['dirt', 10] });
    INV.addPlayer(u, stack('dirt', 5));
    assert.equal(u[20].count, 15, 'no selection: existing stack in 0..35 order');
  });

  test('quickMove never merges a stack into its own slot (no item loss)', () => {
    const s = slotsOf(36, { 9: ['cobblestone', 10] });
    INV.quickMove(s, 9, [[s, INV.MAIN]]);
    assert.equal(INV.total(s), 10, 'items conserved (moves to another free slot, never onto itself)');
    const t = slotsOf(36, { 9: ['cobblestone', 10], 12: ['cobblestone', 60] });
    INV.quickMove(t, 9, [[t, INV.MAIN]]);
    assert.equal(INV.total(t), 70);
    assert.equal(t[12].count, 64, 'tops up the other stack first');
  });

  test('addPlayer returns what does not fit in a full inventory', () => {
    const s = INV.empty(36).map(() => stack('stone', 64));
    s[35] = stack('dirt', 60);
    const st = stack('dirt', 10);
    assert.equal(INV.addPlayer(s, st, 0), 6);
    assert.equal(s[35].count, 64);
  });

  suite('inventory › left click', () => {
    test('empty cursor picks up the whole stack', () => {
      const s = slotsOf(2, { 0: ['dirt', 12] });
      const cur = INV.click(s, 0, 0, null);
      same(cur, { id: B.DIRT, count: 12 });
      assert.equal(s[0], null);
      assert.equal(INV.click(s, 1, 0, null), null, 'empty slot, empty cursor');
    });

    test('places the cursor into an empty slot', () => {
      const s = INV.empty(1);
      assert.equal(INV.click(s, 0, 0, stack('dirt', 12)), null);
      same(view(s), [['dirt', 12]]);
    });

    test('merges into the same item, leftover stays on the cursor', () => {
      const s = slotsOf(1, { 0: ['dirt', 60] });
      same(INV.click(s, 0, 0, stack('dirt', 10)), { id: B.DIRT, count: 6 });
      assert.equal(s[0].count, 64);
      same(INV.click(s, 0, 0, stack('dirt', 3)), { id: B.DIRT, count: 3 }, 'full stack: nothing moves');
      assert.equal(s[0].count, 64);
    });

    test('swaps different items (and tools)', () => {
      const s = slotsOf(1, { 0: ['dirt', 5] });
      same(INV.click(s, 0, 0, stack('sand', 7)), { id: B.DIRT, count: 5 });
      same(view(s), [['sand', 7]]);
      const t = slotsOf(1, { 0: ['wooden_pickaxe', 1] });
      const cur = INV.click(t, 0, 0, { id: 300, count: 1, dmg: 9 });
      same(cur, { id: 300, count: 1, dmg: 0 });
      same(t[0], { id: 300, count: 1, dmg: 9 });
    });
  });

  suite('inventory › right click', () => {
    test('empty cursor takes half, rounded up', () => {
      const s = slotsOf(3, { 0: ['dirt', 7], 1: ['dirt', 1], 2: ['dirt', 64] });
      same(INV.click(s, 0, 2, null), { id: B.DIRT, count: 4 });
      assert.equal(s[0].count, 3);
      same(INV.click(s, 1, 2, null), { id: B.DIRT, count: 1 });
      assert.equal(s[1], null);
      same(INV.click(s, 2, 2, null), { id: B.DIRT, count: 32 });
      assert.equal(s[2].count, 32);
      assert.equal(INV.click(INV.empty(1), 0, 2, null), null);
    });

    test('places one item into an empty slot or matching stack', () => {
      const s = INV.empty(1);
      same(INV.click(s, 0, 2, stack('dirt', 5)), { id: B.DIRT, count: 4 });
      same(view(s), [['dirt', 1]]);
      same(INV.click(s, 0, 2, stack('dirt', 4)), { id: B.DIRT, count: 3 });
      assert.equal(s[0].count, 2);
      assert.equal(INV.click(s, 0, 2, stack('dirt', 1)), null, 'last item leaves an empty cursor');
      assert.equal(s[0].count, 3);
    });

    test('swaps when the items differ', () => {
      const s = slotsOf(1, { 0: ['dirt', 5] });
      same(INV.click(s, 0, 2, stack('sand', 7)), { id: B.DIRT, count: 5 });
      same(view(s), [['sand', 7]]);
    });

    // BUG (js/inventory.js click, right-button branch): a full stack of the same item falls through to
    // the swap. Reference game (and this module's own left-click) leave both stacks unchanged.
    test('same item onto a full stack does nothing (no swap)', () => {
      const s = slotsOf(1, { 0: ['cobblestone', 64] });
      const cur = INV.click(s, 0, 2, stack('cobblestone', 10));
      same({ slot: view(s)[0], cursor: cur }, { slot: ['cobblestone', 64], cursor: { id: B.COBBLESTONE, count: 10 } });
    });
  });

  test('click: accept() can refuse the cursor item', () => {
    const s = slotsOf(1, { 0: ['dirt', 5] });
    const onlyTools = st => IT.get(st.id).kind === 'tool';
    same(INV.click(s, 0, 0, stack('sand', 3), onlyTools), { id: B.SAND, count: 3 });
    same(view(s), [['dirt', 5]]);
    same(INV.click(s, 0, 0, null, onlyTools), { id: B.DIRT, count: 5 }, 'taking out is always allowed');
  });

  test('quickMove: merges first, then empty slots; leftovers stay put', () => {
    const s = INV.empty(36);
    for (const i of INV.MAIN) s[i] = stack('stone', 64);
    s[20] = stack('dirt', 60);
    s[0] = stack('dirt', 10);
    INV.quickMove(s, 0, [[s, INV.MAIN]]);
    assert.equal(s[20].count, 64);
    same(s[0], { id: B.DIRT, count: 6 });
    s[20] = null;
    INV.quickMove(s, 0, [[s, INV.MAIN]]);
    assert.equal(s[0], null);
    same(s[20], { id: B.DIRT, count: 6 });
  });

  test('quickMove: target groups are tried in order across containers', () => {
    const chest = slotsOf(2, { 0: ['dirt', 60], 1: ['stone', 64] });
    const inv = slotsOf(36, { 9: ['dirt', 30] });
    INV.quickMove(inv, 9, [[chest, [0, 1]], [inv, INV.HOTBAR]]);
    same(view(chest), [['dirt', 64], ['stone', 64]]);
    assert.equal(inv[9], null);
    same(inv[0], { id: B.DIRT, count: 26 });
    INV.quickMove(inv, 5, [[chest, [0, 1]]]); // empty source: no-op
    assert.equal(INV.total(inv), 26);
  });

  test('count / remove / total', () => {
    const s = slotsOf(4, { 0: ['dirt', 10], 1: ['sand', 3], 3: ['dirt', 5] });
    assert.equal(INV.count(s, B.DIRT), 15);
    assert.equal(INV.total(s), 18);
    assert.equal(INV.remove(s, B.DIRT, 12), 12);
    same(view(s), [null, ['sand', 3], null, ['dirt', 3]]);
    assert.equal(INV.remove(s, B.DIRT, 10), 3, 'removes only what exists');
    assert.equal(INV.count(s, B.DIRT), 0);
    assert.equal(INV.remove(s, B.SAND, 2, [0, 2]), 0, 'restricted to the given indices');
  });

  test('pack / unpack round-trip', () => {
    const s = slotsOf(36, { 0: ['dirt', 64], 5: ['stick', 3], 35: ['apple', 1] });
    s[8] = { id: 310, count: 1, dmg: 17 };
    s[9] = stack('wooden_axe');
    const packed = INV.pack(s);
    same(packed[8], [310, 1, 17]);
    same(packed[9], [301, 1]);
    same(INV.unpack(packed, 36), s);
    same(INV.unpack(JSON.parse(JSON.stringify(packed)), 36), s, 'through JSON');
  });

  test('unpack drops invalid entries and clamps counts to maxStack', () => {
    const out = INV.unpack([[9999, 5], [B.DIRT, 0], [B.DIRT, 100], 'junk', [300, 5, -4], [B.SAND, -2], null, [0, 3], [B.GLASS, 2]], 8);
    same(out, [null, null, { id: B.DIRT, count: 64 }, null, { id: 300, count: 1, dmg: 0 }, null, null, null]);
    same(INV.unpack('not an array', 3), [null, null, null]);
    same(INV.unpack(undefined, 2), [null, null]);
  });

  test('conservation: random clicks and shift-clicks never create or destroy items', () => {
    const keys = ['cobblestone', 'oak_planks', 'stick', 'dirt', 'wooden_pickaxe', 'stone_sword', 'apple'];
    for (let seed = 1; seed <= 40; seed++) {
      const rand = BC.util.mulberry32(seed);
      const pick = n => Math.floor(rand() * n);
      const slots = INV.empty(36);
      for (let i = 0; i < 36; i++) if (rand() < 0.6) {
        const k = keys[pick(keys.length)];
        slots[i] = stack(k, 1 + pick(IT.maxStack(id(k))));
      }
      const before = INV.total(slots);
      let cursor = null;
      for (let step = 0; step < 400; step++) {
        const r = rand();
        if (r < 0.1 && !cursor) {
          const i = pick(36);
          INV.quickMove(slots, i, [[slots, i < 9 ? INV.MAIN : INV.HOTBAR]]);
        } else {
          cursor = INV.click(slots, pick(36), r < 0.55 ? 0 : 2, cursor);
        }
        const now = INV.total(slots) + (cursor ? cursor.count : 0);
        const where = `seed ${seed} step ${step}`;
        assert.equal(now, before, `${where}: item count changed`);
        const live = slots.filter(Boolean);
        for (const s of live) assert.ok(IT.valid(s), `${where}: invalid stack ${JSON.stringify(s)}`);
        if (cursor) assert.ok(IT.valid(cursor) && !live.includes(cursor), `${where}: bad cursor ${JSON.stringify(cursor)}`);
        assert.equal(new Set(live).size, live.length, `${where}: two slots share one stack object`);
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════ crafting

suite('crafting', () => {
  const P = id('oak_planks'), L = id('oak_log'), S = id('stick'), C = id('cobblestone'), _ = 0;
  const out = (grid, n) => { const r = CR.match(grid, n); return r ? [IT.get(r.outId).key, r.count] : null; };
  // Place a w*h pattern (row-major ids) into an n*n grid at (ox, oy).
  function place(pattern, w, n, ox = 0, oy = 0) {
    const g = new Array(n * n).fill(0);
    pattern.forEach((v, i) => { g[(oy + Math.floor(i / w)) * n + ox + (i % w)] = v; });
    return g;
  }
  const recipe = key => CR.RECIPES.find(r => IT.get(r.outId).key === key);

  test('a log makes 4 planks in any cell of a 2x2 or 3x3 grid', () => {
    for (const n of [2, 3]) for (let i = 0; i < n * n; i++) {
      const g = new Array(n * n).fill(0); g[i] = L;
      same(out(g, n), ['oak_planks', 4], `n=${n} cell ${i}`);
    }
    assert.equal(CR.match([L, L, 0, 0], 2), null, 'two logs are not a recipe');
  });

  test('two planks stacked vertically make 4 sticks; horizontally nothing', () => {
    for (const n of [2, 3]) for (let oy = 0; oy <= n - 2; oy++) for (let ox = 0; ox < n; ox++) {
      same(out(place([P, P], 1, n, ox, oy), n), ['stick', 4], `n=${n} at ${ox},${oy}`);
    }
    assert.equal(CR.match([P, P, 0, 0], 2), null);
    assert.equal(CR.match([P, 0, 0, P], 2), null, 'diagonal');
  });

  test('2x2 planks make a crafting table in either grid size', () => {
    same(out([P, P, P, P], 2), ['crafting_table', 1]);
    for (let oy = 0; oy <= 1; oy++) for (let ox = 0; ox <= 1; ox++) same(out(place([P, P, P, P], 2, 3, ox, oy), 3), ['crafting_table', 1]);
    assert.equal(CR.match([P, P, P, 0], 2), null, 'three planks');
    same(out([id('stone'), id('stone'), id('stone'), id('stone')], 2), ['stone_bricks', 4]);
  });

  test('wooden pickaxe needs the 3x3 grid', () => {
    const r = recipe('wooden_pickaxe');
    same(out([P, P, P, _, S, _, _, S, _], 3), ['wooden_pickaxe', 1]);
    assert.equal(CR.fits(r, 2), false);
    assert.equal(CR.fits(r, 3), true);
    assert.equal(CR.layout(r, 2), null);
    same(out([C, C, C, _, S, _, _, S, _], 3), ['stone_pickaxe', 1]);
  });

  test('axe matches its mirror image, at any column', () => {
    same(out([P, P, _, P, S, _, _, S, _], 3), ['wooden_axe', 1]);
    same(out([P, P, _, S, P, _, S, _, _], 3), ['wooden_axe', 1], 'mirrored');
    same(out([_, P, P, _, P, S, _, _, S], 3), ['wooden_axe', 1], 'shifted right');
    same(out([_, P, P, _, S, P, _, S, _], 3), ['wooden_axe', 1], 'mirrored, shifted right');
    assert.equal(CR.fits(recipe('wooden_axe'), 2), false);
  });

  test('shovel and sword are distinct vertical recipes', () => {
    same(out(place([P, S, S], 1, 3, 2), 3), ['wooden_shovel', 1]);
    same(out(place([P, P, S], 1, 3, 0), 3), ['wooden_sword', 1]);
  });

  test('wrong shapes and mixed ingredients return null', () => {
    const bad = [
      [P, P, P, _, S, _, _, _, _],   // pickaxe missing a stick
      [P, P, P, S, _, _, S, _, _],   // handle off-centre
      [_, S, _, _, S, _, P, P, P],   // upside-down pickaxe
      [P, P, P, _, S, _, _, S, S],   // extra stick
      [P, C, P, _, S, _, _, S, _],   // mixed head materials
      [L, P, _, _, _, _, _, _, _],   // log + plank
      [S, S, _, _, _, _, _, _, _],   // two sticks
      new Array(9).fill(0),          // empty
    ];
    bad.forEach((g, i) => assert.equal(CR.match(g, 3), null, `shape ${i}`));
  });

  test('result() builds the output stack', () => {
    const slots = [stack('oak_planks', 3), null, stack('oak_planks', 1), null];
    const r = CR.result(slots, 2);
    same(r.stack, { id: S, count: 4 });
    assert.equal(r.recipe, recipe('stick'));
    same(CR.result([stack('wooden_pickaxe'), null, null, null], 2), null);
  });

  test('consume() uses one item from every filled cell', () => {
    const slots = [stack('oak_planks', 3), null, stack('oak_planks', 1), null];
    CR.consume(slots);
    same(slots, [{ id: P, count: 2 }, null, null, null]);
  });

  test('layout() places recipes top-left; missing() lists shortfalls', () => {
    same(CR.layout(recipe('wooden_axe'), 3), [P, P, _, P, S, _, _, S, _]);
    same(CR.layout(recipe('stick'), 2), [P, 0, P, 0]);
    same(CR.layout(recipe('oak_planks'), 3), [L, 0, 0, 0, 0, 0, 0, 0, 0]);
    const have = inv => k => inv[k] || 0;
    same(CR.missing(recipe('wooden_pickaxe'), have({ [P]: 2, [S]: 2 })), [{ id: P, need: 1 }]);
    same(CR.missing(recipe('wooden_pickaxe'), have({})), [{ id: P, need: 3 }, { id: S, need: 2 }].sort((a, b) => a.id - b.id));
    same(CR.missing(recipe('crafting_table'), have({ [P]: 9 })), []);
  });

  test('every recipe matches its own layout (and mirror) and no other recipe', () => {
    for (const r of CR.RECIPES) for (const n of [2, 3]) {
      if (!CR.fits(r, n)) continue;
      const g = CR.layout(r, n);
      assert.equal(CR.match(g, n), r, `${r.out} in ${n}x${n}`);
      if (r.type === 'shaped') {
        const m = g.slice();
        for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) m[y * n + x] = g[y * n + (r.w - 1 - x)];
        assert.equal(CR.match(m, n), r, `${r.out} mirrored in ${n}x${n}`);
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════ survival

suite('survival', () => {
  const stats = over => Object.assign(SV.newStats(), over);
  const ticks = (s, n, difficulty, hurt = () => { throw new Error('unexpected hurt'); }) => { for (let i = 0; i < n; i++) SV.foodTick(s, difficulty, hurt); };
  const damage = s => amount => { s.health = Math.max(0, s.health - amount); };

  test('new stats start full', () => {
    same(SV.newStats(), { health: 20, food: 20, saturation: 5, exhaustion: 0, foodTimer: 0, air: 300, hurtTime: 0, invuln: 0, lastHurt: 0, peacefulTimer: 0 });
  });

  test('exhaustion above 4 drains saturation first, then food', () => {
    const s = stats({ exhaustion: 4.5 });
    SV.foodTick(s, 2);
    assert.ok(Math.abs(s.exhaustion - 0.5) < 1e-9);
    same([s.saturation, s.food], [4, 20]);
    s.saturation = 0; s.exhaustion = 4.5;
    SV.foodTick(s, 2);
    same([s.saturation, s.food], [0, 19]);
    s.exhaustion = 4; SV.foodTick(s, 2);
    assert.equal(s.food, 19, 'exactly 4 is not enough');
    const p = stats({ saturation: 0, exhaustion: 10 });
    SV.foodTick(p, 0);
    assert.equal(p.food, 20, 'peaceful never drains food');
  });

  test('addExhaustion caps at 40; EXHAUST matches the reference costs', () => {
    const s = stats(); SV.addExhaustion(s, 100); assert.equal(s.exhaustion, 40);
    same(SV.EXHAUST, { sprintPerBlock: 0.1, swimPerBlock: 0.01, jump: 0.05, sprintJump: 0.2, mine: 0.005, attack: 0.1, damage: 0.1, heal: 6 });
  });

  test('food >= 18 heals 1 HP every 80 ticks at a cost of 6 exhaustion', () => {
    const s = stats({ health: 15, food: 18, saturation: 0 });
    ticks(s, 79, 2);
    assert.equal(s.health, 15);
    SV.foodTick(s, 2);
    same([s.health, s.exhaustion, s.foodTimer], [16, 6, 0]);
    const low = stats({ health: 15, food: 17, saturation: 0 });
    ticks(low, 200, 2);
    assert.equal(low.health, 15, 'no regeneration below 18 food');
  });

  test('full food with saturation heals fast: min(sat,6)/6 HP every 10 ticks', () => {
    const s = stats({ health: 10, food: 20, saturation: 5 });
    ticks(s, 9, 2);
    assert.equal(s.health, 10);
    SV.foodTick(s, 2);
    assert.ok(Math.abs(s.health - (10 + 5 / 6)) < 1e-9, `health ${s.health}`);
    assert.equal(s.exhaustion, 5);
    const big = stats({ health: 10, food: 20, saturation: 20 });
    ticks(big, 10, 2);
    assert.equal(big.health, 11, 'capped at 6 saturation per heal');
  });

  test('starvation: easy stops at 10 HP, normal at 1 HP, hard kills', () => {
    for (const [difficulty, floor] of [[1, 10], [2, 1], [3, 0]]) {
      const s = stats({ food: 0, saturation: 0 });
      ticks(s, 79, difficulty, damage(s));
      assert.equal(s.health, 20);
      SV.foodTick(s, difficulty, damage(s));
      assert.equal(s.health, 19, `difficulty ${difficulty}: 1 damage per 80 ticks`);
      ticks(s, 80 * 30, difficulty, damage(s));
      assert.equal(s.health, floor, `difficulty ${difficulty}`);
    }
  });

  test('peaceful: +1 HP every 20 ticks and +1 food every 10 ticks', () => {
    const s = stats({ health: 10, food: 10, saturation: 0 });
    ticks(s, 20, 0);
    same([s.health, s.food], [11, 12]);
    ticks(s, 200, 0);
    same([s.health, s.food], [20, 20]);
  });

  test('applyDamage: a second hit within 10 ticks only applies the difference', () => {
    const s = stats();
    assert.equal(SV.applyDamage(s, 4), 4);
    same([s.health, s.invuln, s.hurtTime], [16, 20, 10]);
    for (let i = 0; i < 5; i++) SV.tickTimers(s);
    assert.equal(SV.applyDamage(s, 6), 2);
    assert.equal(s.health, 14);
    assert.equal(SV.applyDamage(s, 5), 0, 'weaker hit ignored');
    assert.equal(SV.applyDamage(s, 6), 0, 'equal hit ignored');
    for (let i = 0; i < 5; i++) SV.tickTimers(s);
    assert.equal(s.invuln, 10);
    assert.equal(SV.applyDamage(s, 3), 3, 'window over: full damage');
    same([s.health, s.invuln], [11, 20]);
    assert.ok(Math.abs(s.exhaustion - 0.3) < 1e-9, 'each applied hit costs 0.1 exhaustion');
  });

  test('applyDamage ignores zero damage and dead players', () => {
    const s = stats();
    assert.equal(SV.applyDamage(s, 0), 0);
    assert.equal(SV.applyDamage(s, -3), 0);
    assert.equal(s.health, 20);
    SV.applyDamage(s, 25);
    assert.equal(s.health, 0, 'health never goes negative');
    for (let i = 0; i < 20; i++) SV.tickTimers(s);
    assert.equal(SV.applyDamage(s, 5), 0);
  });

  test('airTick: drowning deals 2 damage each time air reaches -20; surfacing refills 4/tick', () => {
    const s = stats();
    const hits = [];
    const hurt = (n, cause) => hits.push([n, cause]);
    for (let i = 0; i < 319; i++) SV.airTick(s, true, hurt);
    assert.equal(s.air, -19);
    assert.equal(hits.length, 0);
    SV.airTick(s, true, hurt);
    same(hits, [[2, 'drown']]);
    assert.equal(s.air, 0);
    for (let i = 0; i < 20; i++) SV.airTick(s, true, hurt);
    assert.equal(hits.length, 2, 'again 20 ticks later');
    SV.airTick(s, false, hurt);
    assert.equal(s.air, 4);
    for (let i = 0; i < 100; i++) SV.airTick(s, false, hurt);
    assert.equal(s.air, SV.MAX_AIR);
  });

  test('fallDamage = max(0, floor(distance - 3)) (26.3 rule)', () => {
    for (const [d, dmg] of [[0, 0], [-4, 0], [3, 0], [3.01, 0], [3.99, 0], [4, 1], [4.5, 1], [10, 7], [23, 20]]) assert.equal(SV.fallDamage(d), dmg, `dist ${d}`);
  });

  test('eat() adds food (max 20) and caps saturation at the new food level', () => {
    const apple = IT.key('apple').food;
    const a = stats({ food: 2, saturation: 0 });
    SV.eat(a, apple);
    same([a.food, a.saturation], [6, 2.4]);
    const b = stats({ food: 1, saturation: 0 });
    SV.eat(b, { hunger: 1, saturation: 5 });
    same([b.food, b.saturation], [2, 2]);
    const c = stats({ food: 19, saturation: 19 });
    SV.eat(c, apple);
    same([c.food, c.saturation], [20, 20]);
  });

  test('canEat / canSprint', () => {
    assert.equal(SV.canEat(stats({ food: 20 }), IT.key('apple').food, false), false);
    assert.equal(SV.canEat(stats({ food: 20 }), IT.key('apple').food, true), true);
    assert.equal(SV.canEat(stats({ food: 19 }), IT.key('apple').food, false), true);
    assert.equal(SV.canEat(stats(), null, true), false);
    assert.equal(SV.canSprint(stats({ food: 6 }), false), false);
    assert.equal(SV.canSprint(stats({ food: 7 }), false), true);
    assert.equal(SV.canSprint(stats({ food: 0 }), true), true);
  });
});

// ════════════════════════════════════════════════════════════════════════════ save

suite('save', () => {
  const V1_SAVE = {
    seed: 4051750246, edits: { '0,0': [5, 3] },
    player: { x: 10.5, y: 41, z: -3.5, yaw: 1.25, pitch: -0.3, fly: true },
    dayTime: 0.3, hotbar: [1, 2, 3, 4, 8, 6, 9, 13, 19], sel: 2, rd: 8,
  };

  test('newWorld → loadWorld round trip', () => {
    const { store } = freshStore();
    const r = store.newWorld({ name: 'Alpha', seedText: 'hello', mode: 'survival', difficulty: 3 });
    assert.equal(r.ok, true);
    const w = r.world;
    same([w.v, w.gen, w.name, w.seed, w.mode, w.difficulty, w.cheats], [2, 1, 'Alpha', 99162322, 'survival', 3, false]);
    const loaded = store.loadWorld(w.id);
    assert.equal(loaded.ok, true);
    same(loaded.world, w);
  });

  test('newWorld fills defaults and coerces bad options', () => {
    const { store } = freshStore();
    const w = store.newWorld({ seed: -1, mode: 'hardcore', difficulty: 7, name: '' }).world;
    same([w.seed, w.mode, w.difficulty, w.name, w.cheats], [4294967295, 'survival', 2, 'New World', false]);
    const c = store.newWorld({ seed: 5, mode: 'creative', name: 'x'.repeat(60) }).world;
    same([c.cheats, c.name.length], [true, 40]);
  });

  test('saveWorld persists player data; loadWorld normalizes damaged records', () => {
    const { storage, store } = freshStore();
    const w = store.newWorld({ name: 'P', seed: 1 }).world;
    w.player = { x: 1, y: 2, z: 3, sel: 12, inventory: [[B.DIRT, 99], [9999, 1], null, [300, 1, 4]], stats: { health: 7 } };
    assert.equal(store.saveWorld(w).ok, true);
    const p = store.loadWorld(w.id).world.player;
    assert.equal(p.sel, 8);
    same(p.inventory.slice(0, 4), [[B.DIRT, 64], null, null, [300, 1, 4]]);
    assert.equal(p.inventory.length, 36);
    same([p.stats.health, p.stats.food, p.stats.air], [7, 20, 300]);
    storage.setItem(SAVE.KEY_WORLD(w.id), JSON.stringify(Object.assign({}, w, { gen: 2 })));
    const r = store.loadWorld(w.id);
    assert.equal(r.ok, false);
    assert.match(r.error, /newer version/);
    assert.equal(store.loadWorld('nope').ok, false);
  });

  test('listWorlds is sorted by lastPlayed, newest first', () => {
    withClock(1_000_000, clock => {
      const { store } = freshStore();
      const a = store.newWorld({ name: 'A', seed: 1 }).world;
      clock.advance(1000);
      const b = store.newWorld({ name: 'B', seed: 2 }).world;
      clock.advance(1000);
      const c = store.newWorld({ name: 'C', seed: 3 }).world;
      same(store.listWorlds().map(e => e.name), ['C', 'B', 'A']);
      clock.advance(1000);
      store.saveWorld(a);
      same(store.listWorlds().map(e => e.name), ['A', 'C', 'B']);
      same(store.listWorlds().map(e => e.id), [a.id, c.id, b.id]);
    });
  });

  test('deleteWorld removes the record and its index entry', () => {
    const { storage, store } = freshStore();
    const a = store.newWorld({ name: 'A', seed: 1 }).world;
    const b = store.newWorld({ name: 'B', seed: 2 }).world;
    assert.equal(store.deleteWorld(a.id).ok, true);
    same(store.listWorlds().map(e => e.id), [b.id]);
    assert.equal(storage.getItem(SAVE.KEY_WORLD(a.id)), null);
    assert.equal(store.loadWorld(a.id).ok, false);
    assert.equal(store.loadWorld(b.id).ok, true);
  });

  test('exportWorld / importWorld round trip under a new id and suffixed name', () => {
    const { store } = freshStore();
    const w = store.newWorld({ name: 'Home', seed: 77, mode: 'creative' }).world;
    w.edits = { '1,-2': [10, 4, 300, 8] };
    store.saveWorld(w);
    const text = store.exportWorld(w.id);
    assert.equal(typeof text, 'string');
    const r = store.importWorld(text);
    assert.equal(r.ok, true);
    assert.notEqual(r.world.id, w.id);
    assert.equal(r.world.name, 'Home (imported)');
    same([r.world.seed, r.world.mode, r.world.edits], [77, 'creative', w.edits]);
    same(store.loadWorld(r.world.id).world.edits, w.edits);
    assert.equal(store.listWorlds().length, 2);
    assert.equal(store.exportWorld('missing'), null);
  });

  test('importWorld rejects garbage with ok:false', () => {
    const { store } = freshStore();
    for (const text of ['', 'not json', 'null', '42', '[]', '{}', '{"v":1}', JSON.stringify({ v: 2, gen: 9 })]) {
      const r = store.importWorld(text);
      assert.equal(r.ok, false, `accepted ${JSON.stringify(text)}`);
      assert.match(r.error, /not a Blockcraft world/);
    }
    assert.equal(store.listWorlds().length, 0);
  });

  test('corrupt index JSON is recovered from world records; raw kept under .corrupt', () => {
    const { storage, store } = freshStore();
    const a = store.newWorld({ name: 'A', seed: 1 }).world;
    const b = store.newWorld({ name: 'B', seed: 2 }).world;
    const junk = '{"v":2,"worlds":[{"id":';
    storage.setItem(SAVE.KEY_INDEX, junk);
    const idx = store.readIndex();
    assert.equal(idx.recovered, true);
    same(idx.worlds.map(e => e.id).sort(), [a.id, b.id].sort());
    same(idx.settings, SAVE.DEFAULT_SETTINGS);
    assert.equal(storage.getItem(SAVE.KEY_INDEX + '.corrupt'), junk);
    assert.equal(store.loadWorld(a.id).ok, true);
    // The next write stores a clean index.
    store.newWorld({ name: 'C', seed: 3 });
    assert.equal(JSON.parse(storage.getItem(SAVE.KEY_INDEX)).worlds.length, 3);
  });

  test('a structurally wrong index is recovered too', () => {
    const { storage, store } = freshStore();
    store.newWorld({ name: 'A', seed: 1 });
    storage.setItem(SAVE.KEY_INDEX, JSON.stringify({ v: 2, worlds: 'nope' }));
    assert.equal(store.readIndex().recovered, true);
    assert.equal(store.listWorlds().length, 1);
  });

  test('settings merge over defaults', () => {
    const { store } = freshStore();
    same(store.getSettings(), SAVE.DEFAULT_SETTINGS);
    assert.equal(store.setSettings({ fov: 90 }).ok, true);
    same(store.getSettings(), Object.assign({}, SAVE.DEFAULT_SETTINGS, { fov: 90 }));
  });

  test('migrateV1 turns the v0.1 save into a Creative world, once', () => {
    const { storage, store } = freshStore();
    const raw = JSON.stringify(V1_SAVE);
    storage.setItem(SAVE.KEY_V1, raw);
    const r = store.migrateV1();
    assert.equal(r.ok, true);
    const w = store.loadWorld(r.world.id).world;
    same([w.v, w.gen, w.mode, w.cheats, w.seed, w.dayTime], [2, 1, 'creative', true, 4051750246, 0.3]);
    same(w.edits, { '0,0': [5, 3] });
    same([w.player.x, w.player.y, w.player.z, w.player.yaw, w.player.pitch, w.player.fly, w.player.sel], [10.5, 41, -3.5, 1.25, -0.3, true, 2]);
    same(w.player.inventory.slice(0, 9), V1_SAVE.hotbar.map(b => [b, 64]));
    assert.ok(w.player.inventory.slice(9).every(s => s === null));
    assert.equal(w.player.inventory.length, 36);
    assert.equal(store.getSettings().renderDistance, 8);
    // Only once, and the v0.1 key is left as a backup.
    assert.equal(store.migrateV1(), null);
    assert.equal(store.listWorlds().length, 1);
    assert.equal(storage.getItem(SAVE.KEY_V1), raw);
  });

  test('migrateV1 without a v0.1 save does nothing', () => {
    const { store } = freshStore();
    assert.equal(store.migrateV1(), null);
    assert.equal(store.readIndex().migratedV1, true);
    assert.equal(store.listWorlds().length, 0);
  });

  // BUG (js/save.js readIndex/rebuildIndex): a recovered index starts with migratedV1:false, so the next
  // start-up migrates the v0.1 save again and the player gets a second "My first world".
  test('migrateV1 does not run again after the index is recovered', () => {
    const { storage, store } = freshStore();
    storage.setItem(SAVE.KEY_V1, JSON.stringify(V1_SAVE));
    assert.equal(store.migrateV1().ok, true);
    storage.setItem(SAVE.KEY_INDEX, '{corrupt');
    const again = store.migrateV1();
    same({ migratedAgain: again !== null, worlds: store.listWorlds().map(e => e.name) }, { migratedAgain: false, worlds: ['My first world'] });
  });

  test('quota errors return ok:false with quota:true instead of throwing', () => {
    const storage = failingStorage(() => true);
    const store = SAVE.createStore(storage);
    const r = store.newWorld({ name: 'Full', seed: 1 });
    same([r.ok, r.quota], [false, true]);
    assert.equal(r.error.name, 'QuotaExceededError');
    assert.equal(store.lastError.name, 'QuotaExceededError');
    assert.equal(store.listWorlds().length, 0);
    const imp = store.importWorld(JSON.stringify({ v: 2, gen: 1, name: 'X', seed: 1 }));
    assert.equal(imp.ok, false);
    assert.match(imp.error, /Could not store/);
  });

  test('saveWorld reports quota once storage fills up; the last good save survives', () => {
    const storage = failingStorage(() => false);
    const store = SAVE.createStore(storage);
    const w = store.newWorld({ name: 'W', seed: 9 }).world;
    w.edits = { '0,0': [1, 2] };
    storage.fail = () => true;
    same(plain(store.saveWorld(w)).quota, true);
    assert.equal(store.saveWorld(w).ok, false);
    same(store.loadWorld(w.id).world.edits, {});
    storage.fail = () => false;
    assert.equal(store.saveWorld(w).ok, true);
    assert.equal(store.lastError, null);
  });

  test('non-quota storage errors are not reported as quota', () => {
    const store = SAVE.createStore(failingStorage(() => true, () => Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' })));
    const r = store.newWorld({ seed: 1 });
    same([r.ok, r.quota], [false, false]);
  });

  test('migrateV1 hitting the quota is retried on the next start', () => {
    const storage = failingStorage(k => k.startsWith('blockcraft.v2.world.'));
    storage.setItem(SAVE.KEY_V1, JSON.stringify(V1_SAVE));
    const store = SAVE.createStore(storage);
    assert.equal(store.migrateV1().ok, false);
    storage.fail = () => false;
    const r = store.migrateV1();
    assert.equal(r && r.ok, true);
    assert.equal(store.listWorlds().length, 1);
  });

  test('memoryStorage behaves like Storage', () => {
    const m = SAVE.memoryStorage();
    assert.equal(m.getItem('a'), null);
    m.setItem('a', 5);
    assert.equal(m.getItem('a'), '5');
    assert.equal(m.length, 1);
    assert.equal(m.key(0), 'a');
    assert.equal(m.key(1), null);
    m.removeItem('a');
    assert.equal(m.length, 0);
  });
});

await run();
