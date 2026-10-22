'use strict';
// A loaded world: chunk data generated on demand, player edits layered on top, meshes streamed around the player.
// World systems live here too: light (via BC.lighting), block updates to neighbours, random ticks and falling blocks.
(function (root) {
  const BC = root.BC;
  const { CS, WH, TICK } = BC.C;
  const { B, DEFS, SOLID, LIQUID } = BC.blocks;
  const IDX = BC.worldgen.IDX;
  const ckey = (cx, cz) => cx + ',' + cz;
  const now = () => performance.now();
  const RANDOM_TICK_SPEED = 3;        // random blocks per 16x16x16 section per game tick (reference game rule default)
  const SECTIONS = Math.ceil(WH / 16);
  const UPDATE_LIMIT = 4096;          // block updates handled per call; the rest wait for the next tick

  function create(record, render) {
    const gen = BC.worldgen.create(record.gen, record.seed);
    const chunks = new Map();
    const edits = new Map();
    for (const [k, arr] of Object.entries(record.edits || {})) {
      if (!Array.isArray(arr)) continue;
      const m = new Map();
      for (let i = 0; i + 1 < arr.length; i += 2) {
        const idx = arr[i], id = arr[i + 1];
        if (Number.isInteger(idx) && idx >= 0 && idx < CS * CS * WH && (id === 0 || BC.blocks.exists(id))) m.set(idx, id);
      }
      edits.set(k, m);
    }
    let offsets = [], rd = 0;
    // One-entry cache for the chunk lookups in getBlock and the light getters (hot in physics and meshing).
    let lastCh = null;
    const chunkAt = (cx, cz) => {
      if (lastCh && lastCh.cx === cx && lastCh.cz === cz) return lastCh;
      const c = chunks.get(ckey(cx, cz)); if (c) lastCh = c; return c || null;
    };

    // ---- light
    // A light change marks the chunk (and neighbours whose meshes sample its border) for re-meshing. The edited chunk
    // is re-meshed at once; others go through stream(), nearest first, within the frame budget.
    const light = BC.lighting.createEngine({ chunkAt, onChanged: (cx, cz) => { const c = chunkAt(cx, cz); if (c && !c.dirty) c.remesh = true; } });

    function generate(cx, cz) {
      const data = gen.generateChunk(cx, cz);
      const e = edits.get(ckey(cx, cz));
      if (e) for (const [i, id] of e) if (i >= 0 && i < data.length) data[i] = id;
      const ch = { cx, cz, data, light: null, dirty: true, remesh: false, opaque: null, water: null };
      chunks.set(ckey(cx, cz), ch);
      light.initChunk(ch);
      return ch;
    }
    const dataAt = (cx, cz) => { const c = chunkAt(cx, cz); return c ? c.data : null; };
    function mesh(ch) {
      if (!render) { ch.dirty = false; ch.remesh = false; return true; }
      const ok = render.meshChunk(ch, chunkAt);
      if (ok) ch.remesh = false;
      return ok;
    }

    function getBlock(x, y, z) {
      if (y < 0) return B.BEDROCK;
      if (y >= WH) return 0;
      const ch = chunkAt(x >> 4, z >> 4);
      return ch ? ch.data[IDX(x & 15, y, z & 15)] : 0;
    }
    function chunkReady(x, z) { const ch = chunkAt(Math.floor(x) >> 4, Math.floor(z) >> 4); return !!(ch && !ch.dirty); }
    function hasChunk(x, z) { return !!chunkAt(Math.floor(x) >> 4, Math.floor(z) >> 4); }

    // ---- edits, block updates and batching
    let batchDepth = 0, processing = false;
    const meshNow = new Set();          // chunks to re-mesh when the current edit (or batch) finishes
    const upd = []; let updHead = 0;    // queued block updates: x, y, z triples
    function queueUpdate(x, y, z) { upd.push(x, y, z); }
    function setBlock(x, y, z, id) {
      if (y < 0 || y >= WH) return false;
      const cx = x >> 4, cz = z >> 4, k = ckey(cx, cz), ch = chunkAt(cx, cz);
      if (!ch) return false;
      const lx = x & 15, lz = z & 15, i = IDX(lx, y, lz), old = ch.data[i];
      ch.data[i] = id;
      let e = edits.get(k); if (!e) { e = new Map(); edits.set(k, e); }
      e.set(i, id);
      if (old !== id) {
        light.update(x, y, z, old, id);
        // this block and its six neighbours react (supports, falling, placement checks)
        queueUpdate(x, y, z);
        queueUpdate(x - 1, y, z); queueUpdate(x + 1, y, z); queueUpdate(x, y - 1, z);
        queueUpdate(x, y + 1, z); queueUpdate(x, y, z - 1); queueUpdate(x, y, z + 1);
      }
      meshNow.add(ch);
      if (lx === 0 || lx === 15 || lz === 0 || lz === 15) {
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          if ((dx === -1 && lx !== 0) || (dx === 1 && lx !== 15) || (dz === -1 && lz !== 0) || (dz === 1 && lz !== 15)) continue;
          const n = chunkAt(cx + dx, cz + dz); if (n && n !== ch && !n.dirty) meshNow.add(n);
        }
      }
      if (!batchDepth && !processing) { processUpdates(); flushMeshes(); }
      return true;
    }
    // Run fn() with meshing and block updates deferred until it returns (many setBlock calls, e.g. a growing tree).
    function batch(fn) {
      batchDepth++;
      try { return fn(); } finally { if (--batchDepth === 0 && !processing) { processUpdates(); flushMeshes(); } }
    }
    function processUpdates() {
      if (processing) return;
      processing = true;
      try {
        let n = 0;
        while (updHead < upd.length && n++ < UPDATE_LIMIT) {
          const x = upd[updHead], y = upd[updHead + 1], z = upd[updHead + 2]; updHead += 3;
          if (y < 0 || y >= WH) continue;
          const id = getBlock(x, y, z); if (!id) continue;
          const d = DEFS[id];
          if (d.falls) checkFall(x, y, z, id);
          else if (d.onNeighbor) d.onNeighbor(api, x, y, z);
        }
        if (updHead >= upd.length) { upd.length = 0; updHead = 0; }
      } finally { processing = false; }
    }
    function flushMeshes() {
      if (!meshNow.size) return;
      const list = Array.from(meshNow); meshNow.clear();
      for (const c of list) if (chunks.get(ckey(c.cx, c.cz)) === c) mesh(c);
      // light that spread into neighbouring chunks: re-mesh those right away too while it stays cheap
      const t0 = now();
      for (const c of list) {
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const n = chunkAt(c.cx + dx, c.cz + dz);
          if (n && n.remesh && !n.dirty && now() - t0 < 4) mesh(n);
        }
      }
    }

    // ---- falling blocks (sand, gravel): entities that fall with the reference game's gravity and drag
    const falling = [];
    let sinceTick = 0;
    const canFallInto = id => id === 0 || LIQUID[id] === 1;
    function checkFall(x, y, z, id) {
      if (y <= 0 || !canFallInto(getBlock(x, y - 1, z))) return;
      if (!chunkAt((x >> 4), (z >> 4))) return;
      setBlock(x, y, z, 0);
      falling.push({ id, x, z, y, py: y, vy: 0, mesh: null });
    }
    // Where a falling block would come to rest: the cell above the first solid block below it.
    function landingOf(f) {
      let cy = Math.ceil(f.y) - 1;
      while (cy >= 0 && !SOLID[getBlock(f.x, cy, f.z)]) cy--;
      return cy + 1;
    }
    function land(f, y) {
      const cur = getBlock(f.x, y, f.z);
      if (y < WH && canFallInto(cur)) setBlock(f.x, y, f.z, f.id);
      else if (api.dropItem && BC.items) api.dropItem(BC.items.make(DEFS[f.id].key, 1), f.x, Math.min(y, WH - 1), f.z);
    }
    function removeFalling(i) { const f = falling[i]; if (f.mesh && render) render.removeMesh(f.mesh); falling.splice(i, 1); }
    function stepFalling() {
      if (!falling.length) return;
      falling.sort((a, b) => a.y - b.y);   // lower blocks land first, so a column stacks up again
      for (let i = 0; i < falling.length; i++) {
        const f = falling[i];
        f.py = f.y;
        f.vy = (f.vy - 0.04) * 0.98;       // blocks per tick
        const ny = f.y + f.vy;
        let landed = null;
        for (let cy = Math.ceil(f.y) - 1; cy >= Math.floor(ny); cy--) {
          if (cy < 0) break;
          if (SOLID[getBlock(f.x, cy, f.z)]) { landed = cy + 1; break; }
        }
        if (landed != null) { removeFalling(i); i--; land(f, landed); }
        else if (ny < -8) { removeFalling(i); i--; }
        else f.y = ny;
      }
    }
    // Falling blocks in chunks about to unload come to rest at once, so they are never lost.
    function settleFalling(pred) {
      for (let i = falling.length - 1; i >= 0; i--) {
        const f = falling[i];
        if (pred && !pred(f)) continue;
        removeFalling(i); land(f, landingOf(f));
      }
    }

    // ---- random ticks
    let rs = (record.seed ^ 0x5bd1e995) >>> 0 || 1;
    const rnd32 = () => { rs ^= rs << 13; rs >>>= 0; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs; };
    const rand = () => rnd32() / 4294967296;
    let RT = null;
    const tickTable = () => { RT = []; for (let id = 1; id < DEFS.length; id++) if (DEFS[id] && DEFS[id].randomTick) RT[id] = DEFS[id].randomTick; };
    function randomTickChunk(ch, speed) {
      const bx = ch.cx * CS, bz = ch.cz * CS, data = ch.data;
      for (let s = 0; s < SECTIONS; s++) for (let k = 0; k < speed; k++) {
        const r = rnd32(), lx = r & 15, lz = (r >>> 4) & 15, y = s * 16 + ((r >>> 8) & 15);
        if (y >= WH) continue;
        const f = RT[data[IDX(lx, y, lz)]];
        if (f) f(api, bx + lx, y, bz + lz, rand);
      }
    }
    // Run one block's random tick now (tests and tools); rnd defaults to the world's generator.
    function randomTickAt(x, y, z, rnd) {
      if (!RT) tickTable();
      const f = RT[getBlock(x, y, z)];
      if (f) f(api, x, y, z, rnd || rand);
      return !!f;
    }

    // Called by the game 20 times per second (BC.hooks.tick): falling blocks, random ticks near the player, and any
    // block updates left over from a large change.
    function tick(G) {
      if (!RT) tickTable();
      sinceTick = 0;
      stepFalling();
      const p = G && G.player && G.player.p, pcx = p ? Math.floor(p.x) >> 4 : 0, pcz = p ? Math.floor(p.z) >> 4 : 0;
      const speed = api.randomTickSpeed;
      if (speed > 0) {
        batch(() => {
          for (const ch of chunks.values()) {
            if (ch.dirty || (p && (Math.abs(ch.cx - pcx) > rd || Math.abs(ch.cz - pcz) > rd))) continue;
            randomTickChunk(ch, speed);
          }
        });
      }
      if (upd.length) { processUpdates(); flushMeshes(); }
    }
    // Called every frame (BC.hooks.frame): place falling-block meshes between ticks.
    function frame(dt) {
      sinceTick += dt;
      if (!render || !falling.length) return;
      const a = Math.min(1, sinceTick / TICK);
      for (const f of falling) {
        if (!f.mesh) f.mesh = render.blockMesh(f.id);
        const y = f.py + (f.y - f.py) * a;
        f.mesh.position.set(f.x + 0.5, y + 0.5, f.z + 0.5);
        if (render.lightMesh) render.lightMesh(f.mesh, f.x + 0.5, y + 0.5, f.z + 0.5);
      }
    }

    // ---- streaming
    function setRenderDistance(r) {
      rd = r; offsets = []; const Rr = rd + 1;
      for (let dz = -Rr; dz <= Rr; dz++) for (let dx = -Rr; dx <= Rr; dx++) { const d = dx * dx + dz * dz; if (d <= Rr * Rr + 1) offsets.push([dx, dz, d]); }
      offsets.sort((a, b) => a[2] - b[2]);
    }
    function neighborsReady(cx, cz) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!chunkAt(cx + dx, cz + dz)) return false;
      return true;
    }
    // Generate and mesh chunks nearest the player first, within a time budget (ms). Chunks whose light changed
    // (remesh) are rebuilt in the same nearest-first order.
    function stream(px, pz, budget) {
      const t0 = now(), pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4, rr = rd * rd + 1;
      for (const [dx, dz, d] of offsets) {
        const cx = pcx + dx, cz = pcz + dz;
        const ch = chunkAt(cx, cz);
        if (!ch) generate(cx, cz);
        else if (d <= rr && (ch.dirty || ch.remesh) && neighborsReady(cx, cz)) mesh(ch);
        else continue;
        if (now() - t0 > budget) return;
      }
    }
    // Radius (in chunks) of the disc around (px, pz) whose chunks are all generated and meshed.
    function readyRadius(px, pz) {
      const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
      for (const [dx, dz, d] of offsets) {
        const ch = chunkAt(pcx + dx, pcz + dz);
        if (!ch || ch.dirty) return Math.max(0, Math.sqrt(d) - 1);
      }
      return rd;
    }
    function unloadFar(px, pz) {
      const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4, lim = rd + 3;
      const far = c => Math.abs(c.cx - pcx) > lim || Math.abs(c.cz - pcz) > lim;
      if (falling.length) settleFalling(f => far({ cx: f.x >> 4, cz: f.z >> 4 }));
      for (const [k, ch] of chunks) if (far(ch)) { if (render) render.disposeChunk(ch); chunks.delete(k); }
      lastCh = null;
    }
    // Synchronously prepare the 3x3 chunks around a point so the player never stands in unloaded space.
    function prime(x, z) {
      const cx = Math.floor(x) >> 4, cz = Math.floor(z) >> 4;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (!chunkAt(cx + dx, cz + dz)) generate(cx + dx, cz + dz);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const ch = chunkAt(cx + dx, cz + dz); if (ch.dirty || ch.remesh) mesh(ch); }
    }
    function surfaceY(x, z) { for (let y = WH - 1; y > 0; y--) if (SOLID[getBlock(x, y, z)]) return y + 1; return WH - 1; }
    function dispose() {
      for (const f of falling) if (f.mesh && render) render.removeMesh(f.mesh);
      falling.length = 0;
      if (render) for (const ch of chunks.values()) render.disposeChunk(ch);
      chunks.clear(); lastCh = null;
      if (render && render.detachWorld) render.detachWorld(api);
    }
    // Saved edits. A block still falling is saved where it will land (or, if it cannot be placed there, as a
    // dropped item via packFallingItems), so saving mid-fall never loses or duplicates it.
    function packEdits() {
      const out = {};
      for (const [k, m] of edits) { if (!m.size) continue; const arr = []; for (const [i, id] of m) arr.push(i, id); out[k] = arr; }
      for (const f of falling) {
        const y = landingOf(f);
        if (y >= WH || !canFallInto(getBlock(f.x, y, f.z))) continue;
        const k = ckey(f.x >> 4, f.z >> 4);
        (out[k] = out[k] || []).push(IDX(f.x & 15, y, f.z & 15), f.id);
      }
      return out;
    }
    function packFallingItems() {
      const out = [];
      if (!api.isSurvival || !api.isSurvival() || !BC.items) return out;
      for (const f of falling) {
        const y = landingOf(f);
        if (y < WH && canFallInto(getBlock(f.x, y, f.z))) continue;
        const it = BC.items.key(DEFS[f.id].key);
        if (it) out.push([it.id, 1, 0, f.x + 0.5, Math.min(y, WH - 1) + 0.25, f.z + 0.5, 0, 0]);
      }
      return out;
    }

    // ---- light queries (other systems: rendering, creature spawning)
    const getSkyLight = (x, y, z) => light.getSkyLight(Math.floor(x), Math.floor(y), Math.floor(z));
    const getBlockLight = (x, y, z) => light.getBlockLight(Math.floor(x), Math.floor(y), Math.floor(z));
    const getLight = (x, y, z, daylight) => light.getLight(Math.floor(x), Math.floor(y), Math.floor(z), daylight);

    const api = {
      record, gen, chunks, edits, getBlock, setBlock, chunkReady, hasChunk, setRenderDistance, stream, readyRadius, unloadFar, prime, surfaceY, dispose, packEdits,
      get rd() { return rd; },
      // world systems
      light, getSkyLight, getBlockLight, getLight, batch, tick, frame, falling, randomTickAt, randomTickSpeed: RANDOM_TICK_SPEED,
      packFallingItems, landingOf, settleFalling,
      dataAt,
    };
    if (render && render.attachWorld) render.attachWorld(api);
    return api;
  }

  // The game runs these every tick and every frame (see BC.hooks in core.js).
  BC.hooks.tick.push(G => { const W = G.world; if (W && W.tick) W.tick(G); });
  BC.hooks.frame.push((G, dt) => { const W = G.world; if (W && W.frame) W.frame(dt, G); });

  BC.world = { create, ckey, RANDOM_TICK_SPEED };
})(typeof window !== 'undefined' ? window : globalThis);
