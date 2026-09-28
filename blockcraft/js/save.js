'use strict';
// Save system: a world index plus one record per world in localStorage (or any Storage-like object).
// Format version 2. Version 1 (the single-world v0.1 save) is migrated into a Creative world and the
// original key is left untouched as a backup.
(function (root) {
  const BC = root.BC;
  const INV = BC.inv;
  const { parseSeed } = BC.util;

  const KEY_INDEX = 'blockcraft.v2.index';
  const KEY_WORLD = id => 'blockcraft.v2.world.' + id;
  const KEY_V1 = 'blockcraft.save.v1';
  const MODES = ['survival', 'creative'];

  const DEFAULT_SETTINGS = { sensitivity: 1, invertY: false, fov: 75, renderDistance: 6, reduceMotion: false, damageTilt: true, showCoords: false };

  function freshIndex() { return { v: 2, worlds: [], settings: Object.assign({}, DEFAULT_SETTINGS), migratedV1: false }; }
  function newId() { return 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  function createStore(storage) {
    let lastError = null;
    function read(key) {
      try { const raw = storage.getItem(key); return raw == null ? { ok: true, value: null } : { ok: true, value: JSON.parse(raw), raw }; }
      catch (e) { return { ok: false, error: e }; }
    }
    function write(key, value) {
      try { storage.setItem(key, JSON.stringify(value)); lastError = null; return { ok: true }; }
      catch (e) { lastError = e; return { ok: false, error: e, quota: /quota/i.test(String(e && (e.name + e.message))) }; }
    }

    function readIndex() {
      const r = read(KEY_INDEX);
      if (!r.ok || (r.value && (typeof r.value !== 'object' || !Array.isArray(r.value.worlds)))) {
        // Keep the unreadable index for recovery, then start a fresh one. World records stay intact.
        try { const raw = storage.getItem(KEY_INDEX); if (raw != null) storage.setItem(KEY_INDEX + '.corrupt', raw); } catch (e) { /* ignore */ }
        const idx = freshIndex(); idx.recovered = true; rebuildIndex(idx);
        // Any v2 world means start-up already ran the v0.1 migration, so never repeat it.
        idx.migratedV1 = idx.worlds.length > 0;
        return idx;
      }
      let idx = r.value;
      if (!idx) {
        // No index yet (first run) or it was never written: rebuild it from any world records present.
        idx = freshIndex(); rebuildIndex(idx);
        if (idx.worlds.length) { idx.migratedV1 = true; idx.recovered = true; }
      }
      idx.worlds = idx.worlds.filter(e => e && typeof e === 'object' && typeof e.id === 'string');
      idx.settings = Object.assign({}, DEFAULT_SETTINGS, idx.settings || {});
      return idx;
    }
    // Recreate index entries from world records found in storage.
    function rebuildIndex(idx) {
      try {
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (k && k.startsWith('blockcraft.v2.world.')) {
            const w = read(k);
            if (w.ok && w.value && w.value.id) idx.worlds.push(summary(w.value));
          }
        }
      } catch (e) { /* storage not enumerable */ }
    }
    const writeIndex = idx => write(KEY_INDEX, idx);
    function summary(w) { return { id: w.id, name: w.name, mode: w.mode, seed: w.seed, difficulty: w.difficulty, created: w.created, lastPlayed: w.lastPlayed }; }
    function touchIndex(w) {
      const idx = readIndex();
      const i = idx.worlds.findIndex(e => e.id === w.id);
      if (i >= 0) idx.worlds[i] = summary(w); else idx.worlds.push(summary(w));
      return writeIndex(idx);
    }

    function newWorld(opts) {
      const now = Date.now();
      const mode = MODES.includes(opts.mode) ? opts.mode : 'survival';
      const w = {
        v: 2, gen: BC.worldgen.has(opts.gen) ? opts.gen : 1, id: newId(), name: String(opts.name || 'New World').slice(0, 40) || 'New World',
        seed: opts.seed != null && typeof opts.seed === 'number' ? opts.seed >>> 0 : parseSeed(opts.seedText),
        mode, difficulty: [0, 1, 2, 3].includes(opts.difficulty) ? opts.difficulty : 2,
        cheats: opts.cheats != null ? !!opts.cheats : mode === 'creative',
        created: now, lastPlayed: now, dayTime: 0.08, spawn: null, edits: {}, player: null, entities: [],
      };
      const r = saveWorld(w);
      return r.ok ? { ok: true, world: w } : { ok: false, error: r.error, quota: r.quota, world: w };
    }

    // Validate a loaded record, filling defaults so an older or damaged save still opens.
    function normalize(w) {
      if (!w || typeof w !== 'object') throw new Error('World data is not an object');
      if (w.v !== 2) throw new Error('Unsupported world format version ' + w.v);
      if (!BC.worldgen.has(w.gen)) throw new Error('This world needs a newer version of Blockcraft (generator ' + w.gen + ')');
      w.seed = num(w.seed, 0) >>> 0;
      w.mode = MODES.includes(w.mode) ? w.mode : 'survival';
      w.difficulty = [0, 1, 2, 3].includes(w.difficulty) ? w.difficulty : 2;
      w.cheats = !!w.cheats;
      w.dayTime = num(w.dayTime, 0.08) % 1;
      w.edits = w.edits && typeof w.edits === 'object' ? w.edits : {};
      const nb = BC.blocks.NB, vol = BC.C.CS * BC.C.CS * BC.C.WH;
      for (const [k, arr] of Object.entries(w.edits)) {
        if (!Array.isArray(arr) || !/^-?\d+,-?\d+$/.test(k)) { delete w.edits[k]; continue; }
        const clean = [];
        for (let i = 0; i + 1 < arr.length; i += 2) {
          const idx = arr[i], id = arr[i + 1];
          if (Number.isInteger(id) && id > 0 && !BC.blocks.exists(id)) throw new Error('This world contains blocks from a newer version of Blockcraft');
          if (Number.isInteger(idx) && idx >= 0 && idx < vol && Number.isInteger(id) && id >= 0) clean.push(idx, id);
        }
        w.edits[k] = clean;
      }
      const okPos = a => Array.isArray(a) && a.length === 3 && a.every(v => typeof v === 'number' && isFinite(v));
      if (!okPos(w.spawn)) w.spawn = null;
      w.entities = Array.isArray(w.entities) ? w.entities.filter(e => Array.isArray(e) && BC.items.get(e[0]) && e[1] > 0) : [];
      if (w.player) {
        const p = w.player;
        p.inventory = INV.pack(INV.unpack(p.inventory, 36));
        if (!['x', 'y', 'z'].every(k => typeof p[k] === 'number' && isFinite(p[k]))) { p.x = p.y = p.z = null; }
        p.yaw = num(p.yaw, 0); p.pitch = num(p.pitch, 0); p.fallDist = Math.max(0, num(p.fallDist, 0));
        const st = p.stats = Object.assign(BC.survival.newStats(), p.stats && typeof p.stats === 'object' ? p.stats : {});
        const fresh = BC.survival.newStats();
        for (const k of Object.keys(fresh)) st[k] = num(st[k], fresh[k]);
        st.health = Math.max(0, Math.min(20, st.health)); st.food = Math.max(0, Math.min(20, Math.round(st.food)));
        st.saturation = Math.max(0, Math.min(st.food, st.saturation)); st.air = Math.max(-20, Math.min(BC.survival.MAX_AIR, st.air));
        p.dead = !!p.dead || st.health <= 0;
        if (p.dead && !p.deathMsg) p.deathMsg = 'You died.';
        p.sel = Math.max(0, Math.min(8, p.sel | 0));
      }
      return w;
    }
    function loadWorld(id) {
      const r = read(KEY_WORLD(id));
      if (!r.ok) return { ok: false, error: 'The save data for this world could not be read (' + (r.error && r.error.message) + ').' };
      if (!r.value) return { ok: false, error: 'This world has no save data. It may have been deleted in another tab.' };
      try { return { ok: true, world: normalize(r.value) }; }
      catch (e) { return { ok: false, error: e.message }; }
    }
    function saveWorld(w) {
      w.lastPlayed = Date.now();
      const r = write(KEY_WORLD(w.id), w);
      if (!r.ok) return r;
      return touchIndex(w);
    }
    function deleteWorld(id) {
      try { storage.removeItem(KEY_WORLD(id)); } catch (e) { /* ignore */ }
      const idx = readIndex(); idx.worlds = idx.worlds.filter(e => e.id !== id); return writeIndex(idx);
    }
    function listWorlds() { return readIndex().worlds.slice().sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)); }

    function exportWorld(id) { const r = read(KEY_WORLD(id)); return r.ok && r.value ? JSON.stringify(r.value) : null; }
    function importWorld(text) {
      let w;
      try { w = normalize(JSON.parse(text)); } catch (e) { return { ok: false, error: 'That text is not a Blockcraft world: ' + e.message }; }
      w.id = newId(); w.name = (w.name || 'Imported world') + ' (imported)';
      const r = saveWorld(w);
      return r.ok ? { ok: true, world: w } : { ok: false, error: 'Could not store the world: ' + (r.error && r.error.message) };
    }

    // v0.1 kept one Creative world under a single key. Copy it into a v2 Creative world once.
    function migrateV1() {
      const idx = readIndex();
      if (idx.migratedV1) return null;
      const r = read(KEY_V1);
      idx.migratedV1 = true;
      if (!r.ok || !r.value || r.value.seed == null) { writeIndex(idx); return null; }
      const s = r.value;
      const inv = INV.empty(36);
      if (Array.isArray(s.hotbar)) s.hotbar.slice(0, 9).forEach((id, i) => { if (BC.blocks.DEFS[id]) inv[i] = { id, count: 64 }; });
      const now = Date.now();
      const w = {
        v: 2, gen: 1, fromV1: true, id: newId(), name: 'My first world', seed: num(s.seed, 0) >>> 0, mode: 'creative', difficulty: 2, cheats: true,
        created: now, lastPlayed: now, dayTime: num(s.dayTime, 0.08), spawn: null, edits: s.edits && typeof s.edits === 'object' ? s.edits : {},
        player: s.player ? {
          x: num(s.player.x, 0.5), y: num(s.player.y, 40), z: num(s.player.z, 0.5), yaw: num(s.player.yaw, 0), pitch: num(s.player.pitch, 0),
          fly: !!s.player.fly, sel: Math.max(0, Math.min(8, s.sel | 0)), inventory: INV.pack(inv), stats: BC.survival.newStats(),
        } : null,
        entities: [],
      };
      if ([4, 6, 8].includes(s.rd)) idx.settings.renderDistance = s.rd;
      const wr = write(KEY_WORLD(w.id), w);
      if (!wr.ok) return { ok: false, error: wr.error };
      idx.worlds.push(summary(w));
      const ir = writeIndex(idx);
      if (!ir.ok) return { ok: false, error: ir.error };
      return { ok: true, world: w };
    }

    function getSettings() { return readIndex().settings; }
    function setSettings(s) { const idx = readIndex(); idx.settings = Object.assign({}, DEFAULT_SETTINGS, s); return writeIndex(idx); }

    return { readIndex, writeIndex, newWorld, loadWorld, saveWorld, deleteWorld, listWorlds, exportWorld, importWorld, migrateV1, getSettings, setSettings, normalize, get lastError() { return lastError; } };
  }

  // In-memory Storage fallback for when localStorage is blocked (private windows, sandboxed previews).
  function memoryStorage() {
    const m = new Map();
    return {
      getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); },
      key: i => Array.from(m.keys())[i] || null, get length() { return m.size; },
    };
  }

  BC.save = { createStore, memoryStorage, DEFAULT_SETTINGS, KEY_INDEX, KEY_WORLD, KEY_V1 };
})(typeof window !== 'undefined' ? window : globalThis);
