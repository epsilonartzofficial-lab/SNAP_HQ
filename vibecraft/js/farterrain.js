'use strict';
// Distant terrain: simplified land and water beyond the fully loaded chunks, so the view can reach 64 chunks
// without holding block data for thousands of chunks. Tiles of 64x64 blocks are built straight from the world
// generator (surface height and colour per column), nearest first and within a per-frame time budget.
// Player edits are not shown out there (only generated terrain); everything near the player is real blocks.
(function (root) {
  const BC = root.BC;
  const { SEA, SNOWLINE } = BC.C;
  const TILE = 64;
  const WATER = [0.17, 0.34, 0.72], WATER_DEEP = [0.1, 0.22, 0.52];

  function create(R, gen) {
    const scene = R.scene;
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const tiles = new Map();       // "tx,tz" → { mesh, hole }
    let center = null, want = [], viewR = 0, holeR = 0;
    const colorCache = new Map();

    function surfaceColor(key) {
      if (colorCache.has(key)) return colorCache.get(key);
      const d = BC.blocks.BY_KEY[key];
      let c = [0.4, 0.6, 0.3];
      if (d && BC.tex.BTEX[d.id]) c = BC.tex.TILE_AVG[BC.tex.BTEX[d.id][3]] || c;
      colorCache.set(key, c);
      return c;
    }
    // Height and colour of one column from whichever generator the world uses.
    function column(x, z) {
      if (gen.sample) {
        const s = gen.sample(x, z);
        return { h: s.height, c: surfaceColor(s.surface || 'grass_block'), trees: s.biome && /forest|taiga|jungle|grove|wood/.test(s.biome.key) };
      }
      const [h, desert] = gen.terrainAt(x, z);
      const key = h >= SNOWLINE ? 'snowy_grass_block' : desert || h <= SEA + 1 ? 'sand' : 'grass_block';
      return { h, c: surfaceColor(key), trees: false };
    }

    function buildTile(tx, tz, hole) {
      const step = Math.hypot(tx * TILE + TILE / 2 - center.x, tz * TILE + TILE / 2 - center.z) > 512 ? 8 : 4;
      const n = TILE / step + 1, x0 = tx * TILE, z0 = tz * TILE;
      const H = new Float32Array(n * n), C = new Array(n * n), T = new Uint8Array(n * n);
      if (gen.surfaceScan) {   // the biomes generator computes a whole grid at once (far cheaper than per column)
        gen.surfaceScan(x0, z0, x0 + TILE, z0 + TILE, step, (x, z, h, key, biome, tree) => {
          const k = ((z - z0) / step) * n + (x - x0) / step;
          H[k] = h; C[k] = surfaceColor(key); T[k] = tree > 0.04 ? 1 : 0;
        });
      } else for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const c = column(x0 + i * step, z0 + j * step);
        H[j * n + i] = c.h; C[j * n + i] = c.c; T[j * n + i] = c.trees ? 1 : 0;
      }
      const pos = [], col = [], idx = [];
      const push = (x, y, z, c, k) => { pos.push(x, y, z); col.push(c[0] * k, c[1] * k, c[2] * k); return pos.length / 3 - 1; };
      for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
        const cx = x0 + (i + 0.5) * step, cz = z0 + (j + 0.5) * step;
        if (Math.hypot(cx - center.x, cz - center.z) < hole) continue;   // real chunks cover this part
        const k00 = j * n + i, k10 = k00 + 1, k01 = k00 + n, k11 = k01 + 1;
        const hs = [H[k00], H[k10], H[k01], H[k11]];
        const wet = hs.map(h => h < SEA);
        const ys = hs.map((h, q) => (wet[q] ? SEA + 0.85 : h + (T[[k00, k10, k01, k11][q]] ? 3 : 1)) - 1.2);
        // simple slope shading: steeper quads darker, facing "sun" (−x) a little brighter
        const sx = (hs[1] + hs[3] - hs[0] - hs[2]) / (2 * step), sz = (hs[2] + hs[3] - hs[0] - hs[1]) / (2 * step);
        const shade = Math.max(0.55, Math.min(1.05, 1 - Math.hypot(sx, sz) * 0.35 - sx * 0.12));
        const cs = [k00, k10, k01, k11].map((k, q) => {
          if (wet[q]) return SEA - hs[q] > 6 ? WATER_DEEP : WATER;
          const c = C[k]; return T[k] ? [c[0] * 0.55, c[1] * 0.75, c[2] * 0.5] : c;
        });
        const a = push(x0 + i * step, ys[0], z0 + j * step, cs[0], shade);
        const b = push(x0 + (i + 1) * step, ys[1], z0 + j * step, cs[1], shade);
        const c = push(x0 + i * step, ys[2], z0 + (j + 1) * step, cs[2], shade);
        const d = push(x0 + (i + 1) * step, ys[3], z0 + (j + 1) * step, cs[3], shade);
        idx.push(a, c, b, b, c, d);
      }
      if (!idx.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.matrixAutoUpdate = false; m.updateMatrix();
      scene.add(m);
      return m;
    }
    function dropTile(k) { const t = tiles.get(k); if (t && t.mesh) { scene.remove(t.mesh); t.mesh.geometry.dispose(); } tiles.delete(k); }

    // viewRD: total view distance in chunks; nearRD: radius of full chunks; readyRD: how much of that has loaded
    // so far (the hole follows it in steps of two chunks, so nothing shows sky while chunks stream in).
    // budget: ms per call.
    function update(px, pz, viewRD, nearRD, budget, readyRD) {
      const ready = Math.min(nearRD, readyRD == null ? nearRD : readyRD);
      const vR = viewRD * 16, hR = Math.max(0, Math.floor((ready - 2) / 2) * 2 * 16);
      if (viewRD <= nearRD) { if (tiles.size) dispose(); center = null; return; }
      const moved = !center || Math.hypot(px - center.x, pz - center.z) > 16 || vR !== viewR || hR !== holeR;
      if (moved) {
        center = { x: px, z: pz }; viewR = vR; holeR = hR;
        want = [];
        const r = Math.ceil(vR / TILE) + 1, ctx = Math.floor(px / TILE), ctz = Math.floor(pz / TILE);
        const keep = new Set();
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          const tx = ctx + dx, tz = ctz + dz;
          // nearest and farthest point of the tile from the centre
          const nx = Math.max(tx * TILE, Math.min(px, tx * TILE + TILE)), nz = Math.max(tz * TILE, Math.min(pz, tz * TILE + TILE));
          const near = Math.hypot(nx - px, nz - pz);
          const far = Math.max(...[[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => Math.hypot(tx * TILE + a * TILE - px, tz * TILE + b * TILE - pz)));
          if (near > vR || far < hR) continue;
          const k = tx + ',' + tz; keep.add(k);
          const t = tiles.get(k);
          const touchesHole = near < hR + 48;
          if (!t || (touchesHole || t.hole > 0)) want.push({ k, tx, tz, d: near });
        }
        for (const k of Array.from(tiles.keys())) if (!keep.has(k)) dropTile(k);
        want.sort((a, b) => a.d - b.d);
      }
      const t0 = performance.now();
      while (want.length && performance.now() - t0 < budget) {
        const w = want.shift();
        const old = tiles.get(w.k);
        const mesh = buildTile(w.tx, w.tz, holeR);
        if (old && old.mesh) { scene.remove(old.mesh); old.mesh.geometry.dispose(); }
        tiles.set(w.k, { mesh, hole: w.d < holeR + 48 ? holeR : 0 });
      }
    }
    function setLight(l) { mat.color.setScalar(l); }
    function dispose() { for (const k of Array.from(tiles.keys())) dropTile(k); want = []; center = null; }
    return { update, setLight, dispose, get count() { return tiles.size; }, get pending() { return want.length; } };
  }

  BC.farTerrain = { create, TILE };
})(window);
