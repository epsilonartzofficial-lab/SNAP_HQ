'use strict';
// Blockcraft core: shared namespace, constants, deterministic utilities and noise.
// Every script attaches to the global `BC` object so the game runs from file:// without a bundler.
(function (root) {
  const BC = root.BC = root.BC || {};
  BC.VERSION = '0.2.0';
  BC.SAVE_VERSION = 2;

  BC.C = {
    CS: 16,            // chunk size (x/z)
    WH: 80,            // world height
    SEA: 24,
    SNOWLINE: 50,
    TICK: 0.05,        // one game tick = 1/20 s, as in the reference game
    DAY_LEN: 600,      // seconds per full day/night cycle
    REACH: 4.5,        // block interaction range in Survival, as in the reference game
    REACH_CREATIVE: 5,
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // Java-style String.hashCode, used to turn text seeds into numbers.
  function javaHash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h; }
  // Seed entry: blank → random, an integer → that number (mod 2^32), anything else → its text hash.
  function parseSeed(text, rand) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return Math.floor((rand || Math.random)() * 0x100000000) >>> 0;
    if (/^-?\d+$/.test(t)) {
      const n = BigInt(t);
      return Number(((n % 4294967296n) + 4294967296n) % 4294967296n);
    }
    return javaHash(t) >>> 0;
  }

  // Seeded simplex noise (2D + 3D).
  function makeNoise(seed) {
    const rand = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = (rand() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
    const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
    const g = [1,1,0,-1,1,0,1,-1,0,-1,-1,0,1,0,1,-1,0,1,1,0,-1,-1,0,-1,0,1,1,0,-1,1,0,1,-1,0,-1,-1];
    const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6, F3 = 1 / 3, G3 = 1 / 6;
    function n2(xin, yin) {
      const s = (xin + yin) * F2, i = Math.floor(xin + s), j = Math.floor(yin + s);
      const t = (i + j) * G2, x0 = xin - (i - t), y0 = yin - (j - t);
      const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
      const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      const ii = i & 255, jj = j & 255;
      let n = 0, tt, gi;
      tt = 0.5 - x0 * x0 - y0 * y0; if (tt > 0) { gi = pm12[ii + perm[jj]] * 3; tt *= tt; n += tt * tt * (g[gi] * x0 + g[gi + 1] * y0); }
      tt = 0.5 - x1 * x1 - y1 * y1; if (tt > 0) { gi = pm12[ii + i1 + perm[jj + j1]] * 3; tt *= tt; n += tt * tt * (g[gi] * x1 + g[gi + 1] * y1); }
      tt = 0.5 - x2 * x2 - y2 * y2; if (tt > 0) { gi = pm12[ii + 1 + perm[jj + 1]] * 3; tt *= tt; n += tt * tt * (g[gi] * x2 + g[gi + 1] * y2); }
      return 70 * n;
    }
    function n3(xin, yin, zin) {
      const s = (xin + yin + zin) * F3, i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
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
      let n = 0, tt, gi;
      tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0; if (tt > 0) { gi = pm12[ii + perm[jj + perm[kk]]] * 3; tt *= tt; n += tt * tt * (g[gi] * x0 + g[gi + 1] * y0 + g[gi + 2] * z0); }
      tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1; if (tt > 0) { gi = pm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; tt *= tt; n += tt * tt * (g[gi] * x1 + g[gi + 1] * y1 + g[gi + 2] * z1); }
      tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2; if (tt > 0) { gi = pm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; tt *= tt; n += tt * tt * (g[gi] * x2 + g[gi + 1] * y2 + g[gi + 2] * z2); }
      tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3; if (tt > 0) { gi = pm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; tt *= tt; n += tt * tt * (g[gi] * x3 + g[gi + 1] * y3 + g[gi + 2] * z3); }
      return 32 * n;
    }
    return { n2, n3 };
  }

  // Extension points shared by all modules; game.js runs them. Each entry is a list of functions.
  // tick(G) at 20 per second, frame(G, dt) every frame, worldLoaded(G) / worldUnloaded(G) around a world session.
  BC.hooks = BC.hooks || { tick: [], frame: [], worldLoaded: [], worldUnloaded: [] };

  BC.util = { mulberry32, hashStr, clamp, smooth, javaHash, parseSeed, makeNoise };
})(typeof window !== 'undefined' ? window : globalThis);
