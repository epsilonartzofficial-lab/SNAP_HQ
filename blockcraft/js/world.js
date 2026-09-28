'use strict';
// A loaded world: chunk data generated on demand, player edits layered on top, meshes streamed around the player.
(function (root) {
  const BC = root.BC;
  const { CS, WH } = BC.C;
  const { B, SOLID } = BC.blocks;
  const IDX = BC.worldgen.IDX;
  const ckey = (cx, cz) => cx + ',' + cz;

  function create(record, render) {
    const gen = BC.worldgen.create(record.gen, record.seed);
    const chunks = new Map();
    const edits = new Map();
    for (const [k, arr] of Object.entries(record.edits || {})) {
      if (!Array.isArray(arr)) continue;
      const m = new Map();
      for (let i = 0; i + 1 < arr.length; i += 2) {
        const idx = arr[i], id = arr[i + 1];
        if (Number.isInteger(idx) && idx >= 0 && idx < CS * CS * WH && Number.isInteger(id) && id >= 0 && id < BC.blocks.NB) m.set(idx, id);
      }
      edits.set(k, m);
    }
    let offsets = [], rd = 0;

    function generate(cx, cz) {
      const data = gen.generateChunk(cx, cz);
      const e = edits.get(ckey(cx, cz));
      if (e) for (const [i, id] of e) if (i >= 0 && i < data.length) data[i] = id;
      const ch = { cx, cz, data, dirty: true, opaque: null, water: null };
      chunks.set(ckey(cx, cz), ch);
      return ch;
    }
    const dataAt = (cx, cz) => { const c = chunks.get(ckey(cx, cz)); return c ? c.data : null; };
    function mesh(ch) { return render ? render.meshChunk(ch, dataAt) : (ch.dirty = false, true); }

    function getBlock(x, y, z) {
      if (y < 0) return B.BEDROCK;
      if (y >= WH) return 0;
      const ch = chunks.get(ckey(x >> 4, z >> 4));
      return ch ? ch.data[IDX(x & 15, y, z & 15)] : 0;
    }
    function chunkReady(x, z) { const ch = chunks.get(ckey(Math.floor(x) >> 4, Math.floor(z) >> 4)); return !!(ch && !ch.dirty); }
    function hasChunk(x, z) { return chunks.has(ckey(Math.floor(x) >> 4, Math.floor(z) >> 4)); }

    function setBlock(x, y, z, id) {
      if (y < 0 || y >= WH) return false;
      const cx = x >> 4, cz = z >> 4, k = ckey(cx, cz), ch = chunks.get(k);
      if (!ch) return false;
      const lx = x & 15, lz = z & 15, i = IDX(lx, y, lz);
      ch.data[i] = id;
      let e = edits.get(k); if (!e) { e = new Map(); edits.set(k, e); }
      e.set(i, id);
      const xs = [0], zs = [0];
      if (lx === 0) xs.push(-1); if (lx === 15) xs.push(1);
      if (lz === 0) zs.push(-1); if (lz === 15) zs.push(1);
      for (const dx of xs) for (const dz of zs) { const n = chunks.get(ckey(cx + dx, cz + dz)); if (n && (n === ch || !n.dirty)) mesh(n); }
      return true;
    }

    function setRenderDistance(r) {
      rd = r; offsets = []; const Rr = rd + 1;
      for (let dz = -Rr; dz <= Rr; dz++) for (let dx = -Rr; dx <= Rr; dx++) { const d = dx * dx + dz * dz; if (d <= Rr * Rr + 1) offsets.push([dx, dz, d]); }
      offsets.sort((a, b) => a[2] - b[2]);
    }
    function neighborsReady(cx, cz) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!chunks.has(ckey(cx + dx, cz + dz))) return false;
      return true;
    }
    // Generate and mesh chunks nearest the player first, within a time budget (ms).
    function stream(px, pz, budget) {
      const t0 = performance.now(), pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4, rr = rd * rd + 1;
      for (const [dx, dz, d] of offsets) {
        const cx = pcx + dx, cz = pcz + dz;
        const ch = chunks.get(ckey(cx, cz));
        if (!ch) generate(cx, cz);
        else if (d <= rr && ch.dirty && neighborsReady(cx, cz)) mesh(ch);
        else continue;
        if (performance.now() - t0 > budget) return;
      }
    }
    function unloadFar(px, pz) {
      const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4, lim = rd + 3;
      for (const [k, ch] of chunks) if (Math.abs(ch.cx - pcx) > lim || Math.abs(ch.cz - pcz) > lim) { if (render) render.disposeChunk(ch); chunks.delete(k); }
    }
    // Synchronously prepare the 3x3 chunks around a point so the player never stands in unloaded space.
    function prime(x, z) {
      const cx = Math.floor(x) >> 4, cz = Math.floor(z) >> 4;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (!chunks.has(ckey(cx + dx, cz + dz))) generate(cx + dx, cz + dz);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const ch = chunks.get(ckey(cx + dx, cz + dz)); if (ch.dirty) mesh(ch); }
    }
    function surfaceY(x, z) { for (let y = WH - 1; y > 0; y--) if (SOLID[getBlock(x, y, z)]) return y + 1; return WH - 1; }
    function dispose() { if (render) for (const ch of chunks.values()) render.disposeChunk(ch); chunks.clear(); }
    function packEdits() {
      const out = {};
      for (const [k, m] of edits) { if (!m.size) continue; const arr = []; for (const [i, id] of m) arr.push(i, id); out[k] = arr; }
      return out;
    }

    return { record, gen, chunks, edits, getBlock, setBlock, chunkReady, hasChunk, setRenderDistance, stream, unloadFar, prime, surfaceY, dispose, packEdits, get rd() { return rd; } };
  }

  BC.world = { create, ckey };
})(typeof window !== 'undefined' ? window : globalThis);
