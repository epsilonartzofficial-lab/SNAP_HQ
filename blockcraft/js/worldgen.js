'use strict';
// World generator, version 1. This is the v0.1 terrain algorithm, kept byte-for-byte compatible:
// tests/golden-v1.json holds chunk hashes captured from v0.1 and the unit tests compare against them.
// Any change to terrain must be added as a new generator version so existing worlds keep their land.
(function (root) {
  const BC = root.BC;
  const { CS, WH, SEA, SNOWLINE } = BC.C;
  const { B } = BC.blocks;
  const { makeNoise, clamp } = BC.util;
  const IDX = (x, y, z) => x + z * CS + y * CS * CS;

  function createV1(seedIn) {
    const seed = seedIn >>> 0;
    const noiseA = makeNoise(seed), noiseB = makeNoise(seed ^ 0x9e3779b9), noiseC = makeNoise((seed + 1337) >>> 0);
    function hash2(x, z, salt) {
      let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul((seed + salt) | 0, 1442695041);
      h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    }
    const hash3 = (x, y, z, salt) => hash2(x + Math.imul(y, 7919), z - Math.imul(y, 3571), salt + y * 31);

    function terrainAt(x, z) {
      const cont = noiseA.n2(x / 320, z / 320);
      const hills = noiseA.n2(x / 90 + 100, z / 90);
      const detail = noiseB.n2(x / 26, z / 26 + 50);
      const m = Math.max(0, noiseB.n2(x / 170 - 200, z / 170 + 300));
      const h = 27 + cont * 9 + hills * 6 + detail * 2 + m * m * 44;
      const desert = noiseC.n2(x / 240 + 500, z / 240 - 500) > 0.38 && h < SNOWLINE - 6;
      return [Math.floor(clamp(h, 4, WH - 10)), desert];
    }

    function generateChunk(cx, cz) {
      const data = new Uint8Array(CS * CS * WH);
      const R = 3, W = CS + 2 * R;
      const hts = new Int16Array(W * W), des = new Uint8Array(W * W);
      for (let dz = 0; dz < W; dz++) for (let dx = 0; dx < W; dx++) {
        const t = terrainAt(cx * CS + dx - R, cz * CS + dz - R); hts[dx + dz * W] = t[0]; des[dx + dz * W] = t[1] ? 1 : 0;
      }
      for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
        const x = cx * CS + lx, z = cz * CS + lz, ci = (lx + R) + (lz + R) * W;
        const h = hts[ci], desert = des[ci], beach = h <= SEA + 1;
        const top = Math.max(h, SEA);
        for (let y = 0; y <= top; y++) {
          let id = 0;
          if (y === 0 || (y <= 2 && hash3(x, y, z, 7) < 0.5)) id = B.BEDROCK;
          else if (y <= h) {
            const depth = h - y;
            if (h >= SNOWLINE) id = depth === 0 ? B.SNOW : depth < 3 ? B.DIRT : B.STONE;
            else if (desert || beach) id = depth < 4 ? (h < SEA - 4 && !desert ? B.DIRT : B.SAND) : B.STONE;
            else id = depth === 0 ? B.GRASS : depth < 4 ? B.DIRT : B.STONE;
            if (id === B.STONE) {
              const q = hash3(x, y, z, 11);
              if (q < 0.011) id = B.COAL;
              else if (q < 0.017 && y < 40) id = B.IRON;
              else if (q < 0.0195 && y < 24) id = B.GOLD;
              else if (q < 0.0207 && y < 15) id = B.DIAMOND;
            }
            if (y > 3 && (h > SEA + 1 || depth > 4)) {
              const a = noiseA.n3(x / 34, y / 20, z / 34), b = noiseB.n3(x / 34, y / 20, z / 34);
              if (a * a + b * b < 0.011 || (depth > 6 && noiseC.n3(x / 56, y / 28, z / 56) > 0.64)) id = 0;
            }
          } else if (y <= SEA) id = B.WATER;
          data[IDX(lx, y, lz)] = id;
        }
      }
      const put = (wx, y, wz, id, force) => {
        const lx = wx - cx * CS, lz = wz - cz * CS;
        if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || y < 0 || y >= WH) return;
        const i = IDX(lx, y, lz);
        if (force || data[i] === 0) data[i] = id;
      };
      for (let dz = 0; dz < W; dz++) for (let dx = 0; dx < W; dx++) {
        const x = cx * CS + dx - R, z = cz * CS + dz - R, h = hts[dx + dz * W];
        if (h <= SEA + 1) continue;
        if (des[dx + dz * W]) {
          if (hash2(x, z, 3) < 0.006) { const n = 1 + ((hash2(x, z, 4) * 3) | 0); for (let i = 1; i <= n; i++) put(x, h + i, z, B.CACTUS, true); }
          continue;
        }
        if (h >= SNOWLINE - 3) continue;
        const forest = noiseB.n2(x / 90 + 40, z / 90 - 40);
        if (hash2(x, z, 5) >= 0.004 + Math.max(0, forest) * 0.045) continue;
        const th = 4 + ((hash2(x, z, 9) * 3) | 0), ty = h + th;
        for (let ly = ty - 2; ly <= ty + 1; ly++) {
          const rad = ly <= ty - 1 ? 2 : 1;
          for (let oz = -rad; oz <= rad; oz++) for (let ox = -rad; ox <= rad; ox++) {
            const corner = Math.abs(ox) === rad && Math.abs(oz) === rad;
            if (corner && (ly === ty + 1 || rad === 1 || hash3(x + ox, ly, z + oz, 13) < 0.5)) continue;
            put(x + ox, ly, z + oz, B.LEAVES, false);
          }
        }
        for (let y = h + 1; y <= ty; y++) put(x, y, z, B.LOG, true);
        put(x, h, z, B.DIRT, true);
      }
      return data;
    }

    // Spawn search: nearest dry, non-desert, non-mountain column along a widening ring.
    function findSpawn() {
      for (let r = 0; r < 2000; r += 12) for (let a = 0; a < 8; a++) {
        const x = Math.round(Math.cos(a * Math.PI / 4) * r), z = Math.round(Math.sin(a * Math.PI / 4) * r);
        const [h, desert] = terrainAt(x, z);
        if (h > SEA + 2 && h < SNOWLINE - 4 && !desert) return [x, z];
        if (r === 0) break;
      }
      return [0, 0];
    }

    return { version: 1, seed, terrainAt, generateChunk, findSpawn };
  }

  BC.worldgen = { IDX, create(version, seed) { if (version !== 1) throw new Error('Unknown world generator version ' + version); return createV1(seed); } };
})(typeof window !== 'undefined' ? window : globalThis);
