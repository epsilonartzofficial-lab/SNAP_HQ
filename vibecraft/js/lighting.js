'use strict';
// Block light and sky light: storage, propagation and updates. Pure logic (no DOM, no three.js), tested in Node.
//
// Every chunk gets `ch.light`, a Uint8Array parallel to `ch.data`: sky light in the high nibble, block light in the
// low nibble (0-15 each). Light is derived data: it is never saved and is recomputed whenever a chunk is generated.
//
// Rules (reference game): light loses 1 per step, plus the block's extra loss when it enters water or leaves (1);
// opaque blocks stop it; sky light 15 travels straight down through clear blocks without loss; emitters
// (BC.blocks.LIGHT, torch 14) start at their own level. Light crosses chunk borders: when a chunk is generated its
// light is spread into loaded neighbours and theirs into it. Block edits add and remove light incrementally with the
// usual two-queue method (remove everything that may have come from the old value, then relight from the edges).
(function (root) {
  const BC = root.BC;
  const { CS, WH } = BC.C;
  const { DEFS, OPAQUE, LIGHT } = BC.blocks;
  const N = CS * CS * WH;
  const IDX = (x, y, z) => x | (z << 4) | (y << 8);   // same layout as BC.worldgen.IDX for 16x16 chunks

  // Extra light loss when light enters a block (on top of the 1 per step). Blocks may set `lightLoss` themselves;
  // otherwise liquids and leaves lose 1, as in the reference game.
  const LOSS = new Uint8Array(256);
  function refreshTables() {
    for (let id = 0; id < 256; id++) {
      const d = DEFS[id];
      LOSS[id] = !d ? 0 : d.lightLoss != null ? Math.max(0, Math.min(15, d.lightLoss | 0)) : (d.liquid || /leaves/.test(d.key)) ? 1 : 0;
    }
  }
  refreshTables();

  // ---- scratch queues shared by all engines (JavaScript is single-threaded)
  // Positions are packed relative to a 3x3-chunk arena: ax (0..47) | az << 6 | y << 12 (19 bits); removal entries add
  // the old level << 19. Light never travels more than 15 blocks, so an edit or a chunk load stays inside the arena.
  const bk = [], bn = new Int32Array(16);                 // add queue: one bucket per light level (highest first)
  for (let l = 0; l < 16; l++) bk.push(new Int32Array(256));
  let rq = new Int32Array(4096), rn = 0;                  // removal queue (FIFO)
  function pushAdd(p, l) {
    let a = bk[l];
    if (bn[l] >= a.length) { const b = new Int32Array(a.length * 2); b.set(a); bk[l] = a = b; }
    a[bn[l]++] = p;
  }
  function pushRem(e) {
    if (rn >= rq.length) { const b = new Int32Array(rq.length * 2); b.set(rq); rq = b; }
    rq[rn++] = e;
  }

  let AROUND = 0;   // dirty bits for the centre chunk and its 8 neighbours
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) AROUND |= 1 << ((dz + 2) * 5 + dx + 2);
  // Sky light a clear block in the top layer gets from above the world.
  const topSky = id => (OPAQUE[id] ? 0 : LOSS[id] ? Math.max(0, 14 - LOSS[id]) : 15);

  // chunkAt(cx, cz) -> chunk {cx, cz, data, light} or null; onChanged(cx, cz) is called for every chunk whose light
  // (or a neighbour's light next to its border, which its mesh samples) changed.
  function createEngine(opts) {
    refreshTables();
    const chunkAt = opts.chunkAt, onChanged = opts.onChanged || (() => {});
    const arena = new Array(9).fill(null);
    let acx = 0, acz = 0, dirty = 0;
    const stats = { chunks: 0, chunkMs: 0, updates: 0, updateMs: 0 };
    const now = () => (root.performance ? root.performance.now() : Date.now());

    function setArena(cx, cz) {
      acx = cx; acz = cz;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const c = chunkAt(cx + dx, cz + dz);
        arena[(dz + 1) * 3 + dx + 1] = c && c.light ? c : null;
      }
    }
    // Remember which chunks need re-meshing: the chunk of a changed cell, plus neighbours when the cell is on a border
    // (their meshes sample one cell into this chunk). Bits of a 5x5 grid of chunk offsets -2..2 around the arena centre.
    function mark(ax, az) {
      const bit = ((az >> 4) + 1) * 5 + (ax >> 4) + 1, lx = ax & 15, lz = az & 15;
      let m = 1 << bit;
      const w = lx === 0, e = lx === 15;
      if (w) m |= 1 << (bit - 1); else if (e) m |= 1 << (bit + 1);
      if (lz === 0) { m |= 1 << (bit - 5); if (w) m |= 1 << (bit - 6); else if (e) m |= 1 << (bit - 4); }
      else if (lz === 15) { m |= 1 << (bit + 5); if (w) m |= 1 << (bit + 4); else if (e) m |= 1 << (bit + 6); }
      dirty |= m;
    }
    function flushDirty() {
      const d = dirty; dirty = 0;
      for (let b = 0; b < 25; b++) if (d & (1 << b)) onChanged(acx + (b % 5) - 2, acz + Math.floor(b / 5) - 2);
    }

    // Spread light from the queued cells (bucket per level, highest first, so each cell is settled once).
    function runAdd(sky) {
      const sh = sky ? 4 : 0, keep = sky ? 0x0F : 0xF0;
      for (let L = 15; L >= 2; L--) {
        for (let i = 0; i < bn[L]; i++) {
          const p = bk[L][i], ax = p & 63, az = (p >> 6) & 63, y = p >>> 12;
          const ch = arena[(az >> 4) * 3 + (ax >> 4)];
          if (!ch || ((ch.light[(ax & 15) | ((az & 15) << 4) | (y << 8)] >> sh) & 15) !== L) continue;
          for (let d = 0; d < 6; d++) {
            let nx = ax, ny = y, nz = az;
            if (d === 0) { if (ax === 47) continue; nx++; }
            else if (d === 1) { if (ax === 0) continue; nx--; }
            else if (d === 2) { if (az === 47) continue; nz++; }
            else if (d === 3) { if (az === 0) continue; nz--; }
            else if (d === 4) { if (y === WH - 1) continue; ny++; }
            else { if (y === 0) continue; ny--; }
            const nch = arena[(nz >> 4) * 3 + (nx >> 4)];
            if (!nch) continue;
            const ni = (nx & 15) | ((nz & 15) << 4) | (ny << 8), id = nch.data[ni];
            if (OPAQUE[id]) continue;
            const loss = LOSS[id];
            const nl = sky && d === 5 && L === 15 && loss === 0 ? 15 : L - 1 - loss;
            if (nl <= 0) continue;
            const v = nch.light[ni];
            if (nl <= ((v >> sh) & 15)) continue;
            nch.light[ni] = (v & keep) | (nl << sh);
            mark(nx, nz);
            if (nl > 1) pushAdd(nx | (nz << 6) | (ny << 12), nl);
          }
        }
        bn[L] = 0;
      }
      bn[1] = 0; bn[0] = 0;
    }

    // Darken everything that may have been lit through the queued cells; brighter cells at the edge become relight seeds.
    function runRemove(sky) {
      const sh = sky ? 4 : 0, keep = sky ? 0x0F : 0xF0;
      for (let i = 0; i < rn; i++) {
        const e = rq[i], L = e >>> 19, ax = e & 63, az = (e >> 6) & 63, y = (e >>> 12) & 127;
        for (let d = 0; d < 6; d++) {
          let nx = ax, ny = y, nz = az;
          if (d === 0) { if (ax === 47) continue; nx++; }
          else if (d === 1) { if (ax === 0) continue; nx--; }
          else if (d === 2) { if (az === 47) continue; nz++; }
          else if (d === 3) { if (az === 0) continue; nz--; }
          else if (d === 4) { if (y === WH - 1) continue; ny++; }
          else { if (y === 0) continue; ny--; }
          const nch = arena[(nz >> 4) * 3 + (nx >> 4)];
          if (!nch) continue;
          const ni = (nx & 15) | ((nz & 15) << 4) | (ny << 8), v = nch.light[ni], cur = (v >> sh) & 15;
          if (!cur) continue;
          const np = nx | (nz << 6) | (ny << 12);
          if (cur < L || (sky && d === 5 && L === 15 && cur === 15)) {
            nch.light[ni] = v & keep; mark(nx, nz);
            pushRem(np | (cur << 19));
            // cells that make their own light keep it: emitters, and the top layer under the open sky
            const own = sky ? (ny === WH - 1 ? topSky(nch.data[ni]) : 0) : LIGHT[nch.data[ni]];
            if (own) { nch.light[ni] = (v & keep) | (own << sh); pushAdd(np, own); }
          } else if (cur > 1) pushAdd(np, cur);
        }
      }
      rn = 0;
    }

    // Light for a freshly generated chunk: sky columns, emitters, then spread inside it and across its borders.
    function initChunk(ch) {
      const t0 = now();
      const data = ch.data, light = ch.light = new Uint8Array(N);
      setArena(ch.cx, ch.cz);
      dirty = 0;
      // sky light straight down each column
      for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
        let L = 15;
        for (let y = WH - 1; y >= 0; y--) {
          const i = x | (z << 4) | (y << 8), id = data[i];
          if (OPAQUE[id]) break;
          const loss = LOSS[id];
          if (loss || L < 15) { L -= 1 + loss; if (L <= 0) break; }
          light[i] = L << 4;
        }
      }
      // seeds: column-lit cells next to a clear cell (here or in a loaded neighbour) that they would light further,
      // and neighbour border cells that would light this chunk
      for (let pass = 0; pass < 2; pass++) {
        const sky = pass === 0, sh = sky ? 4 : 0;
        if (sky) {
          for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
            for (let y = WH - 1; y >= 0; y--) {
              const i = x | (z << 4) | (y << 8), L = light[i] >> 4;
              if (!L) break;
              if (L < 2) continue;
              if (sideWants(x + 17, y, z + 16, L, true) || sideWants(x + 15, y, z + 16, L, true) ||
                  sideWants(x + 16, y, z + 17, L, true) || sideWants(x + 16, y, z + 15, L, true)) pushAdd((x + 16) | ((z + 16) << 6) | (y << 12), L);
            }
          }
        } else {
          for (let i = 0; i < N; i++) {
            const em = LIGHT[data[i]];
            if (em) { light[i] |= em; pushAdd(((i & 15) + 16) | ((((i >> 4) & 15) + 16) << 6) | ((i >> 8) << 12), em); }
          }
        }
        pullBorder(-1, 0, sh); pullBorder(1, 0, sh); pullBorder(0, -1, sh); pullBorder(0, 1, sh);
        runAdd(sky);
      }
      // the new chunk's border cells feed its neighbours' meshes
      dirty |= AROUND;
      flushDirty();
      stats.chunks++; stats.chunkMs += now() - t0;
    }
    // Would the clear cell at arena position (ax, y, az) get more light from a neighbour at level L?
    function sideWants(ax, y, az, L, sky) {
      const nch = arena[(az >> 4) * 3 + (ax >> 4)];
      if (!nch) return false;
      const ni = (ax & 15) | ((az & 15) << 4) | (y << 8), id = nch.data[ni];
      if (OPAQUE[id]) return false;
      return L - 1 - LOSS[id] > ((nch.light[ni] >> (sky ? 4 : 0)) & 15);
    }
    // Queue the loaded neighbour's border cells (on side dx/dz) whose light would spread into the centre chunk.
    function pullBorder(dx, dz, sh) {
      const nch = arena[(dz + 1) * 3 + dx + 1];
      if (!nch) return;
      const c = arena[4];
      for (let k = 0; k < CS; k++) {
        const lx = dx < 0 ? 15 : dx > 0 ? 0 : k, lz = dz < 0 ? 15 : dz > 0 ? 0 : k;   // cell in the neighbour
        const cx = dx < 0 ? 0 : dx > 0 ? 15 : k, cz = dz < 0 ? 0 : dz > 0 ? 15 : k;   // adjacent cell in the centre chunk
        const ax = lx + 16 + dx * 16, az = lz + 16 + dz * 16;
        for (let y = 0; y < WH; y++) {
          const L = (nch.light[lx | (lz << 4) | (y << 8)] >> sh) & 15;
          if (L < 2) continue;
          const ci = cx | (cz << 4) | (y << 8), id = c.data[ci];
          if (OPAQUE[id] || L - 1 - LOSS[id] <= ((c.light[ci] >> sh) & 15)) continue;
          pushAdd(ax | (az << 6) | (y << 12), L);
        }
      }
    }

    // A block changed at (x, y, z): fix block light and sky light around it.
    function update(x, y, z, oldId, newId) {
      if (y < 0 || y >= WH || oldId === newId) return;
      const t0 = now();
      setArena(x >> 4, z >> 4);
      const ch = arena[4];
      if (!ch) return;
      dirty = 0;
      const ax = (x & 15) + 16, az = (z & 15) + 16, p = ax | (az << 6) | (y << 12), li = IDX(x & 15, y, z & 15);
      for (let pass = 0; pass < 2; pass++) {
        const sky = pass === 1, sh = sky ? 4 : 0, keep = sky ? 0x0F : 0xF0;
        const old = (ch.light[li] >> sh) & 15;
        if (old) { ch.light[li] &= keep; mark(ax, az); pushRem(p | (old << 19)); runRemove(sky); }
        const em = sky ? 0 : LIGHT[newId];
        if (em) { ch.light[li] = (ch.light[li] & keep) | em; mark(ax, az); pushAdd(p, em); }
        if (!OPAQUE[newId]) {
          // neighbours light the cell again (the sky one above included, straight down)
          for (let d = 0; d < 6; d++) {
            const nx = ax + (d === 0 ? 1 : d === 1 ? -1 : 0), nz = az + (d === 2 ? 1 : d === 3 ? -1 : 0), ny = y + (d === 4 ? 1 : d === 5 ? -1 : 0);
            if (ny < 0) continue;
            if (ny >= WH) { if (sky) relightTop(ch, li, topSky(newId), p); continue; }
            const nch = arena[(nz >> 4) * 3 + (nx >> 4)];
            if (!nch) continue;
            const L = (nch.light[(nx & 15) | ((nz & 15) << 4) | (ny << 8)] >> sh) & 15;
            if (L > 1) pushAdd(nx | (nz << 6) | (ny << 12), L);
          }
        }
        runAdd(sky);
      }
      flushDirty();
      stats.updates++; stats.updateMs += now() - t0;
    }
    // The top layer takes sky light from above the world.
    function relightTop(ch, li, nl, p) {
      if (nl <= 0 || nl <= ch.light[li] >> 4) return;
      ch.light[li] = (ch.light[li] & 0x0F) | (nl << 4);
      mark(p & 63, (p >> 6) & 63);
      pushAdd(p, nl);
    }

    function cell(x, y, z) {
      const ch = chunkAt(x >> 4, z >> 4);
      return ch && ch.light ? ch.light[IDX(x & 15, y, z & 15)] : -1;
    }
    // Sky light 0-15 (15 above the world; 0 below it or in unloaded chunks).
    function getSkyLight(x, y, z) { if (y >= WH) return 15; if (y < 0) return 0; const v = cell(x, y, z); return v < 0 ? 0 : v >> 4; }
    function getBlockLight(x, y, z) { if (y >= WH || y < 0) return 0; const v = cell(x, y, z); return v < 0 ? 0 : v & 15; }
    // Brightness level 0-15 with sky light scaled by `daylight` (1 = noon, skyLevel(t)/15 for a time of day).
    function getLight(x, y, z, daylight) {
      const d = daylight == null ? 1 : daylight;
      return Math.max(Math.round(getSkyLight(x, y, z) * d), getBlockLight(x, y, z));
    }

    return { initChunk, update, getSkyLight, getBlockLight, getLight, stats, refreshTables };
  }

  // Reference sky light level (4 at night … 15 by day) for a time of day in [0, 1): the same day curve the renderer
  // uses (sunrise at 0, noon 0.25, sunset 0.5, midnight 0.75). Creature spawning uses max(sky - (15 - level), block).
  function skyLevel(dayTime) {
    const sy = Math.sin(dayTime * Math.PI * 2), t = Math.max(0, Math.min(1, (sy + 0.15) / 0.45));
    return Math.round(4 + 11 * t * t * (3 - 2 * t));
  }

  // Convenience accessors for other systems: the light of the world being played (BC.game.world), if any.
  const current = () => (root.BC && root.BC.game && root.BC.game.world) || null;
  const getSkyLight = (x, y, z) => { const w = current(); return w && w.getSkyLight ? w.getSkyLight(x, y, z) : 0; };
  const getBlockLight = (x, y, z) => { const w = current(); return w && w.getBlockLight ? w.getBlockLight(x, y, z) : 0; };
  const getLight = (x, y, z, daylight) => { const w = current(); return w && w.getLight ? w.getLight(x, y, z, daylight) : 0; };

  BC.lighting = { createEngine, LOSS, refreshTables, skyLevel, getSkyLight, getBlockLight, getLight, N };
})(typeof window !== 'undefined' ? window : globalThis);
