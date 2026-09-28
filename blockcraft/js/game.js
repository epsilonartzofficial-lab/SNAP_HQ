'use strict';
// Game controller: world lifecycle, player movement, survival rules, mining/placing/using, inventory actions,
// saving, screens and input. Rules come from blocks/items/inventory/crafting/survival; rendering from render.js.
(function (root) {
  const BC = root.BC;
  const { CS, WH, TICK, DAY_LEN, REACH, REACH_CREATIVE } = BC.C;
  const { B, DEFS, SOLID, LIQUID, breakInfo, drops } = BC.blocks;
  const IT = BC.items, INV = BC.inv, CR = BC.crafting, S = BC.survival, R = BC.render, U = BC.ui;
  const { clamp } = BC.util;
  const $ = id => document.getElementById(id);

  const HW = 0.3, STAND_H = 1.8, SNEAK_H = 1.5, EYE = 1.62, SNEAK_EYE = 1.27;
  const PANORAMA = { v: 2, gen: 1, seed: 2026, edits: {} };
  const CREATIVE_START = ['grass_block', 'dirt', 'stone', 'cobblestone', 'oak_planks', 'oak_log', 'glass', 'bricks', 'stone_bricks'];

  // ---------------------------------------------------------------- storage
  let storage = null;
  try { storage = window.localStorage; storage.getItem('blockcraft.probe'); } catch (e) { storage = null; }
  const memoryOnly = !storage;
  const store = BC.save.createStore(storage || BC.save.memoryStorage());
  let settings = store.getSettings();

  // ---------------------------------------------------------------- state
  const state = { mode: 'survival', inv: INV.empty(36), sel: 0, cursor: null, craft: { n: 2, slots: INV.empty(9) }, stats: S.newStats(), eating: 0, open: null };
  const CT = BC.containers;
  let containers = new Map();   // "x,y,z" → chest or furnace contents (block entities)
  const player = {
    p: new THREE.Vector3(), v: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: false, fly: false, sneaking: false, sprinting: false,
    inWater: false, eyeInWater: false, fallDist: 0, dead: false, deathMsg: '', height: STAND_H, protect: 0,
    god: false, noclip: false, speedMul: 1, flyMul: 1,   // developer toolkit switches (not saved)
  };
  let W = null, E = null, rec = null;          // rec === null means the title-screen backdrop world
  let screen = 'title', settingsReturn = 'title';
  let dayTime = 0.12;
  const orbitCenter = new THREE.Vector3();
  let hudHidden = false, debugOn = false;

  // Extension points for other modules (devtools, lighting, creatures...). Each is a list of functions.
  const hooks = BC.hooks;
  const run = (list, ...a) => { for (const f of list) { try { f(...a); } catch (e) { reportError(e); } } };
  const G = BC.game = { state, player, store, hooks, get world() { return W; }, get entities() { return E; }, get record() { return rec; }, get screen() { return screen; } };

  // ---------------------------------------------------------------- screens
  let control = (('ontouchstart' in window) && window.matchMedia('(pointer: coarse)').matches) ? 'touch' : 'lock';
  let everLocked = false, lockFail = null, skipLockMove = false;
  const locked = () => document.pointerLockElement === $('view');

  function setScreen(name) {
    screen = name;
    U.show(name === 'play' ? null : name);
    const playing = !!rec && name === 'play';
    $('hud').hidden = !playing || hudHidden;
    $('crosshair').hidden = !playing || hudHidden;
    $('touch').hidden = !(playing && control === 'touch');
    $('touch').classList.toggle('creative', state.mode === 'creative');
    $('menu-btn').hidden = !(playing && control !== 'lock');
    $('coords').hidden = !(playing && settings.showCoords);
    $('debug').hidden = !(playing && debugOn);
    if (name !== 'play' && locked()) document.exitPointerLock();
    U.menu(!rec && ['title', 'worlds', 'create', 'transfer', 'settings', 'loading'].includes(name), name);
    if (name === 'worlds') U.renderWorlds(store.listWorlds());
    if (name === 'create') U.resetCreate();
    if (name !== 'pause') $('pause-hint').hidden = true;
  }
  G.setScreen = setScreen;

  function requestLock(onFail) {
    const cv = $('view');
    lockFail = onFail; skipLockMove = true;
    if (!cv.requestPointerLock) { lockFail = null; onFail(); return; }
    try { const r = cv.requestPointerLock(); if (r && r.catch) r.catch(() => { if (lockFail) { const f = lockFail; lockFail = null; f(); } }); }
    catch (e) { lockFail = null; onFail(); }
  }
  function startPlaying() {
    setScreen('play');
    if (control !== 'lock') return;
    requestLock(() => {
      if (!everLocked) { control = 'drag'; setScreen('play'); }
      else { setScreen('pause'); U.setPause(pauseInfo()); $('pause-hint').hidden = false; }
    });
  }
  document.addEventListener('pointerlockchange', () => {
    if (locked()) { everLocked = true; lockFail = null; lockedAt = performance.now(); skipLockMove = true; if (screen === 'pause' && rec && !player.dead) setScreen('play'); }
    else if (screen === 'play' && control === 'lock') pause();
  });
  document.addEventListener('pointerlockerror', () => { if (lockFail) { const f = lockFail; lockFail = null; f(); } });

  function pauseInfo() {
    return { cheats: rec && (rec.cheats || settings.devMode), mode: state.mode, quitArmed, meta: rec ? `${rec.name} · ${state.mode === 'creative' ? 'Creative' : 'Survival'} · ${S.DIFFICULTY[rec.difficulty]} · seed ${rec.seed}` : '' };
  }
  function pause() {
    if (screen !== 'play') return;
    releaseInputs();
    setScreen('pause'); U.setPause(pauseInfo());
    saveNow();
  }
  G.resume = () => startPlaying();
  G.openSettings = () => { settingsReturn = screen; U.loadSettings(settings); setScreen('settings'); };
  G.closeSettings = () => { setScreen(settingsReturn); if (settingsReturn === 'pause') U.setPause(pauseInfo()); };
  G.applySettings = function (s) {
    settings = Object.assign({}, settings, s);
    const r = store.setSettings(settings); if (!r.ok) saveFailed(r);
    if (W) W.setRenderDistance(settings.renderDistance);
    R.camera.fov = settings.fov; R.camera.updateProjectionMatrix();
  };

  // ---------------------------------------------------------------- errors and saving
  let lastSaveAt = 0, lastSaveError = 0, errorShown = false;
  function saveFailed(r) {
    if (performance.now() - lastSaveError < 60000) return;
    lastSaveError = performance.now();
    U.error(r.quota
      ? 'Couldn’t save: this browser’s storage for Blockcraft is full. Export your world from the world list to keep a copy, or delete old worlds.'
      : 'Couldn’t save the world (' + ((r.error && r.error.message) || 'storage error') + '). Your progress stays in this tab until you close it.');
  }
  function reportError(e) {
    console.error(e);
    if (errorShown) return; errorShown = true;
    const when = lastSaveAt ? 'at ' + new Date(lastSaveAt).toLocaleTimeString() : 'not yet';
    U.error('Something went wrong: ' + ((e && e.message) || e) + '. The game keeps running; your world was last saved ' + when + '.');
  }
  window.addEventListener('error', e => reportError(e.error || e.message));
  window.addEventListener('unhandledrejection', e => reportError(e.reason));

  // Everything a save needs, including items parked in the cursor or crafting grid (never lost).
  function snapshot() {
    if (!rec || !W) return null;
    const inv = state.inv.map(INV.clone), extra = [], p = player.p;
    for (const s of [state.cursor].concat(state.craft.slots).filter(Boolean)) {
      const c = INV.clone(s), left = INV.addPlayer(inv, c);
      if (left > 0) extra.push([s.id, left, s.dmg || 0, +p.x.toFixed(2), +(p.y + 0.5).toFixed(2), +p.z.toFixed(2), 0, 0.5]);
    }
    rec.dayTime = dayTime; rec.mode = state.mode; rec.edits = W.packEdits();
    rec.player = {
      x: p.x, y: p.y, z: p.z, yaw: player.yaw, pitch: player.pitch, fly: player.fly, sel: state.sel,
      inventory: INV.pack(inv), stats: Object.assign({}, state.stats), dead: player.dead, deathMsg: player.deathMsg, fallDist: +player.fallDist.toFixed(2),
    };
    rec.entities = E.pack().concat(extra);
    rec.containers = {};
    for (const [k, c] of containers) rec.containers[k] = CT.pack(c);
    return rec;
  }
  let lastSaveFailed = false, quitArmed = false;
  function saveNow() {
    const r = snapshot(); if (!r) return true;
    const res = store.saveWorld(r);
    if (!res.ok) { lastSaveFailed = true; saveFailed(res); return false; }
    lastSaveFailed = false; quitArmed = false;
    lastSaveAt = Date.now();
    return true;
  }
  // Export straight from the live game, so a world can be rescued even when browser storage is full.
  G.exportCurrent = function () {
    const r = snapshot(); if (!r) return;
    U.showTransfer('export', JSON.stringify(r), r.name, 'pause');
  };
  G.transferBack = function (to) { setScreen(to); if (to === 'pause') U.setPause(pauseInfo()); };
  G.saveNow = saveNow;
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

  // ---------------------------------------------------------------- world lifecycle
  function disposeWorld() { if (rec) run(hooks.worldUnloaded, G); if (E) E.clear(); if (W) W.dispose(); R.clearParticles(); W = null; E = null; }
  G.listWorlds = () => store.listWorlds();
  G.createWorld = function (opts) {
    const r = store.newWorld(opts);
    if (!r.ok) saveFailed(r);
    playRecord(r.world);
  };
  G.playWorld = function (id) {
    const r = store.loadWorld(id);
    if (!r.ok) { U.error('This world could not be opened: ' + r.error + ' You can still export or delete it from the world list.'); return; }
    playRecord(r.world);
  };
  G.deleteWorld = function (id) { const r = store.deleteWorld(id); if (!r.ok) saveFailed(r); U.renderWorlds(store.listWorlds()); };
  G.exportWorld = function (id) {
    if (rec && rec.id === id) saveNow();
    const text = store.exportWorld(id);
    if (!text) { U.error('That world’s data could not be read for export.'); return; }
    const w = store.listWorlds().find(e => e.id === id);
    U.showTransfer('export', text, w ? w.name : 'world');
  };
  G.importWorld = function (text) {
    const r = store.importWorld(text);
    if (r.ok) setScreen('worlds');
    return r;
  };
  function playRecord(w) {
    setScreen('loading');
    setTimeout(() => {
      try { enterWorld(w); }
      catch (e) { console.error(e); rec = null; disposeWorld(); makeBackdrop(); U.error('This world could not be opened: ' + e.message); setScreen('worlds'); }
    }, 30);
  }
  function enterWorld(w) {
    disposeWorld();
    rec = w;
    W = BC.world.create(w, R); W.setRenderDistance(settings.renderDistance);
    E = BC.entities.create(W, R); E.load(w.entities);
    containers = new Map();
    for (const [k, o] of Object.entries(w.containers || {})) { const c = CT.unpack(o); if (c && /^-?\d+,\d+,-?\d+$/.test(k)) containers.set(k, c); }
    state.open = null;
    // Services the world offers to block logic (torches dropping when their support breaks, saplings, etc.).
    W.dropItem = (stack, x, y, z) => { if (stack && state.mode === 'survival') E.drop(stack, x, y, z); };
    W.isSurvival = () => state.mode === 'survival';
    dayTime = w.dayTime; state.mode = w.mode;
    state.cursor = null; state.craft = { n: 2, slots: INV.empty(9) }; state.eating = 0;
    if (!w.spawn) {
      const [sx, sz] = W.gen.findSpawn();
      W.prime(sx + 0.5, sz + 0.5);
      w.spawn = [sx + 0.5, W.surfaceY(sx, sz), sz + 0.5];
    }
    const p = w.player;
    if (p) {
      if (p.x == null) player.p.set(w.spawn[0], w.spawn[1], w.spawn[2]); else player.p.set(p.x, p.y, p.z); player.yaw = p.yaw || 0; player.pitch = p.pitch || 0;
      player.fly = !!p.fly && state.mode === 'creative';
      state.inv = INV.unpack(p.inventory, 36); state.sel = p.sel | 0;
      state.stats = Object.assign(S.newStats(), p.stats);
      player.dead = !!p.dead; player.deathMsg = p.deathMsg || '';
    } else {
      player.p.set(w.spawn[0], w.spawn[1], w.spawn[2]); player.yaw = Math.PI * 0.25; player.pitch = -0.1; player.fly = false;
      state.inv = INV.empty(36); state.sel = 0; state.stats = S.newStats(); player.dead = false; player.deathMsg = '';
      if (state.mode === 'creative') CREATIVE_START.forEach((k, i) => { state.inv[i] = IT.make(k, 64); });
    }
    player.v.set(0, 0, 0); player.sneaking = false; player.sprinting = false; player.protect = 3;
    player.fallDist = p && typeof p.fallDist === 'number' ? p.fallDist : 0;
    W.prime(player.p.x, player.p.z);
    if (collides(player.p.x, player.p.y, player.p.z, STAND_H)) player.p.y = W.surfaceY(Math.floor(player.p.x), Math.floor(player.p.z));
    U.resetHud(); U.invalidateRecipes();
    equipT = 0; heldKey = null;
    run(hooks.worldLoaded, G);
    saveNow();
    if (player.dead) { U.setDeath(player.deathMsg); setScreen('death'); }
    else startPlaying();
  }
  function makeBackdrop() {
    W = BC.world.create(PANORAMA, R); W.setRenderDistance(Math.min(settings.renderDistance, 6));
    const [x, z] = W.gen.findSpawn(); W.prime(x + 0.5, z + 0.5);
    orbitCenter.set(x + 0.5, W.surfaceY(x, z), z + 0.5);
  }
  G.quitToTitle = function () {
    if (screen === 'inventory') closeInventory(true);
    if (!saveNow() && !quitArmed) {
      // Saving failed: don't throw away unsaved progress without a second, deliberate click.
      quitArmed = true;
      U.error('Saving failed, so quitting now loses everything since the last successful save. Use Export world to keep a copy, or press the quit button again to leave anyway.');
      if (screen === 'pause') U.setPause(pauseInfo());
      return;
    }
    quitArmed = false;
    orbitCenter.copy(player.p);
    run(hooks.worldUnloaded, G);
    if (E) E.clear(); E = null; rec = null;
    releaseInputs();
    setScreen('title');
  };
  G.switchMode = function () {
    if (!rec || !(rec.cheats || settings.devMode)) return;
    G.setMode(state.mode === 'creative' ? 'survival' : 'creative');
  };
  G.setMode = function (mode) {
    if (!rec || (mode !== 'creative' && mode !== 'survival')) return;
    state.mode = mode;
    rec.mode = state.mode;
    if (state.mode === 'survival') player.fly = false;
    player.fallDist = 0;
    U.setPause(pauseInfo()); U.resetHud();
    $('touch').classList.toggle('creative', state.mode === 'creative');
    saveNow();
  };

  // ---------------------------------------------------------------- damage, death, respawn
  let hurtTilt = 0;
  function hurt(amount, cause) {
    if (player.dead || !rec) return;
    const forced = cause === 'kill' || cause === 'void';
    if (state.mode === 'creative' && !forced) return;
    if ((player.protect > 0 || player.god) && !forced) return;   // spawn protection (3 s) or dev god mode
    const dealt = S.applyDamage(state.stats, amount, S.DAMAGE_EXHAUSTION[cause] != null ? S.DAMAGE_EXHAUSTION[cause] : S.EXHAUST.damage);
    if (dealt <= 0) return;
    hurtTilt = 0.35;
    const f = $('hurt-flash'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 60);
    if (state.stats.health <= 0) die(cause);
  }
  G.hurt = hurt;
  function die(cause) {
    player.dead = true;
    player.deathMsg = 'You ' + (S.DEATH_MESSAGES[cause] || S.DEATH_MESSAGES.generic) + '.';
    if (screen === 'inventory') closeInventory(true);
    releaseInputs();
    const p = player.p;
    for (let i = 0; i < 36; i++) if (state.inv[i]) { E.scatter(state.inv[i], p.x, p.y, p.z); state.inv[i] = null; }
    state.eating = 0; mining = null;
    U.setDeath(player.deathMsg);
    setScreen('death');
    saveNow();
  }
  G.respawn = function () {
    if (!rec) return;
    const [sx, , sz] = rec.spawn;
    W.prime(sx, sz);
    // Respawn on the current top block of the spawn column, so digging or building there can't trap you.
    const y = W.surfaceY(Math.floor(sx), Math.floor(sz));
    player.p.set(sx, y, sz); player.v.set(0, 0, 0); player.fallDist = 0; player.fly = false; player.protect = 3;
    state.stats = S.newStats(); player.dead = false; player.deathMsg = '';
    U.resetHud();
    saveNow();
    startPlaying();
  };

  // ---------------------------------------------------------------- physics
  function collides(x, y, z, h) {
    const x0 = Math.floor(x - HW), x1 = Math.floor(x + HW - 1e-6), y0 = Math.floor(y), y1 = Math.floor(y + h - 1e-6), z0 = Math.floor(z - HW), z1 = Math.floor(z + HW - 1e-6);
    for (let yy = y0; yy <= y1; yy++) for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) if (SOLID[W.getBlock(xx, yy, zz)]) return true;
    return false;
  }
  const AX = ['x', 'y', 'z'];
  function moveAxis(a, d) {
    if (!d) return false;
    const p = player.p, h = player.height; p[AX[a]] += d;
    if (player.noclip) return false;   // dev: pass through blocks
    const x0 = Math.floor(p.x - HW), x1 = Math.floor(p.x + HW - 1e-6);
    const y0 = Math.floor(p.y), y1 = Math.floor(p.y + h - 1e-6);
    const z0 = Math.floor(p.z - HW), z1 = Math.floor(p.z + HW - 1e-6);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if (!SOLID[W.getBlock(x, y, z)]) continue;
      if (a === 0) p.x = d > 0 ? x - HW - 1e-4 : x + 1 + HW + 1e-4;
      else if (a === 1) p.y = d > 0 ? y - h - 1e-4 : y + 1;
      else p.z = d > 0 ? z - HW - 1e-4 : z + 1 + HW + 1e-4;
      return true;
    }
    return false;
  }
  // Is there a solid block under any part of the player's footprint at (x, z)?
  function groundUnder(x, z) {
    const y = Math.floor(player.p.y - 0.01);
    for (const ox of [-HW, HW - 1e-6]) for (const oz of [-HW, HW - 1e-6]) if (SOLID[W.getBlock(Math.floor(x + ox), y, Math.floor(z + oz))]) return true;
    return false;
  }
  function touching(id) {
    const p = player.p, e = 0.02;
    const x0 = Math.floor(p.x - HW - e), x1 = Math.floor(p.x + HW + e), y0 = Math.floor(p.y - e), y1 = Math.floor(p.y + player.height), z0 = Math.floor(p.z - HW - e), z1 = Math.floor(p.z + HW + e);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (W.getBlock(x, y, z) === id) return true;
    return false;
  }

  const keys = new Set();
  let sprintTap = false, lastW = 0, lastSpace = 0;
  const joy = { id: null, x: 0, y: 0 }, lookT = { id: null, x: 0, y: 0 };
  let touchJump = false, touchDown = false, touchSneak = false;
  function readInput() {
    const k = c => keys.has(c);
    let fwd = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    let str = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    let touchSprint = false;
    if (control === 'touch') { fwd -= joy.y; str += joy.x; touchSprint = Math.hypot(joy.x, joy.y) > 0.92 && joy.y < -0.5; }
    const shift = k('ShiftLeft') || k('ShiftRight');
    return { fwd, str, jump: k('Space') || touchJump, shift: shift || touchSneak, down: shift || touchDown, sprint: sprintTap || touchSprint };
  }

  let bob = 0, bobAmp = 0;
  function step(dt, allowInput) {
    const p = player.p, v = player.v, creative = state.mode === 'creative';
    if (!W.chunkReady(p.x, p.z)) { v.set(0, 0, 0); return; }
    const inp = allowInput ? readInput() : { fwd: 0, str: 0, jump: false, shift: false, down: false, sprint: false };
    if (!creative && !player.noclip) player.fly = false;
    if (player.noclip) player.fly = true;
    let fwd = inp.fwd, str = inp.str;
    const len = Math.hypot(fwd, str); if (len > 1) { fwd /= len; str /= len; }

    let sneak = inp.shift && !player.fly;
    if (!sneak && player.sneaking && collides(p.x, p.y, p.z, STAND_H)) sneak = true;   // no room to stand up
    player.sneaking = sneak; player.height = sneak ? SNEAK_H : STAND_H;
    player.inWater = LIQUID[W.getBlock(Math.floor(p.x), Math.floor(p.y + 0.4), Math.floor(p.z))] === 1;
    if (fwd <= 0 || sneak || state.eating > 0 || !S.canSprint(state.stats, creative) || (player.inWater && !player.fly)) player.sprinting = false;
    else if (inp.sprint) player.sprinting = true;

    const s = Math.sin(player.yaw), c = Math.cos(player.yaw);
    const wx = -s * fwd + c * str, wz = -c * fwd - s * str;
    let jumped = false;
    if (player.fly) {
      const sp = (player.sprinting ? 21.6 : 10.9) * player.flyMul, e = Math.min(1, dt * 10);
      v.x += (wx * sp - v.x) * e; v.z += (wz * sp - v.z) * e;
      v.y += (((inp.jump ? 1 : 0) - (inp.down ? 1 : 0)) * 7.5 - v.y) * e;
    } else {
      let sp = (player.inWater ? 2.6 : player.sprinting ? 5.612 : 4.317) * player.speedMul;
      if (sneak) sp *= 0.3;
      if (state.eating > 0) sp *= 0.2;
      const acc = player.onGround ? 14 : player.inWater ? 6 : 3.5, e = Math.min(1, acc * dt);
      v.x += (wx * sp - v.x) * e; v.z += (wz * sp - v.z) * e;
      if (player.inWater) {
        v.y -= 9 * dt; v.y *= 1 - Math.min(1, 2.5 * dt);
        if (inp.jump) v.y = Math.min(v.y + 24 * dt, 3.4);
        v.y = Math.max(v.y, -4);
      } else {
        v.y = Math.max(v.y - 28 * dt, -54);
        if (inp.jump && player.onGround) { v.y = 8.6; jumped = true; }
      }
    }
    const x0 = p.x, y0 = p.y, z0 = p.z;
    let dx = v.x * dt, dz = v.z * dt; const dy = v.y * dt;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.35));
    const wasOnGround = player.onGround;
    player.onGround = false; let wall = false;
    for (let i = 0; i < n; i++) {
      let sx = dx / n, sz = dz / n;
      // Sneaking keeps you on the block you stand on.
      if (sneak && wasOnGround && !player.fly) {
        if (sx && !groundUnder(p.x + sx, p.z)) { sx = 0; v.x = 0; }
        if (sz && !groundUnder(p.x, p.z + sz)) { sz = 0; v.z = 0; }
      }
      if (moveAxis(0, sx)) { v.x = 0; wall = true; }
      if (moveAxis(2, sz)) { v.z = 0; wall = true; }
      if (moveAxis(1, dy / n)) { if (dy < 0) player.onGround = true; v.y = 0; }
    }
    if (wall) player.sprinting = false;
    if (player.inWater && inp.jump && wall) v.y = 5.2;
    if (player.fly && player.onGround && !inp.jump && !player.noclip) player.fly = false;

    // fall damage (landing in water cancels it, checked after the move)
    if (LIQUID[W.getBlock(Math.floor(p.x), Math.floor(p.y + 0.1), Math.floor(p.z))]) player.inWater = true;
    if (player.inWater || player.fly) player.fallDist = 0;
    else if (p.y < y0) player.fallDist += y0 - p.y;   // includes the step that lands
    if (player.onGround) {
      if (player.fallDist > 0 && !creative) { const d = S.fallDamage(player.fallDist); if (d > 0) hurt(d, 'fall'); }
      player.fallDist = 0;
    }
    // hunger cost of movement
    if (!creative) {
      const moved = Math.hypot(p.x - x0, p.z - z0);
      if (player.sprinting && player.onGround) S.addExhaustion(state.stats, S.EXHAUST.sprintPerBlock * moved);
      else if (player.inWater) S.addExhaustion(state.stats, S.EXHAUST.swimPerBlock * moved);
      if (jumped) S.addExhaustion(state.stats, player.sprinting ? S.EXHAUST.sprintJump : S.EXHAUST.jump);
    }
    const hs = Math.hypot(v.x, v.z);
    if (player.onGround && !player.fly && hs > 0.5) { bob += hs * dt * 1.9; bobAmp = Math.min(1, bobAmp + dt * 4); } else bobAmp = Math.max(0, bobAmp - dt * 4);
  }

  // Furnaces burn and smelt while their chunk is loaded (as in the reference game). Every second, containers whose
  // block was replaced by other means (commands, future pistons) spill their contents instead of vanishing.
  let containerCheck = 0;
  function tickContainers() {
    const validate = ++containerCheck % 20 === 0;
    for (const [k, c] of containers) {
      const [x, y, z] = k.split(',').map(Number);
      if (!W.chunkReady(x, z)) continue;
      const id = W.getBlock(x, y, z);
      if (validate && (!DEFS[id] || DEFS[id].container !== c.type)) { spillContainer(k, x, y, z); continue; }
      if (c.type !== 'furnace') continue;
      const r = CT.furnaceTick(c);
      if (!r.changed) continue;
      const swap = r.lit ? BC.blocks.FURNACE_LIT[id] : BC.blocks.FURNACE_UNLIT[id];
      if (swap) W.setBlock(x, y, z, swap);
      if (state.open && state.open.key === k && screen === 'inventory') U.renderInventory();
    }
    if (state.open && screen === 'inventory' && state.open.c.type === 'furnace') U.renderInventory();
  }
  function gameTick() {
    const st = state.stats;
    S.tickTimers(st);
    if (player.dead) return;
    const eye = eyePos();
    player.eyeInWater = LIQUID[W.getBlock(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z))] === 1;
    if (state.mode === 'survival') {
      S.foodTick(st, rec.difficulty, hurt);
      S.airTick(st, player.eyeInWater, hurt);
      if (touching(B.CACTUS)) hurt(1, 'cactus');
    } else st.air = S.MAX_AIR;
    if (player.p.y < -32) hurt(4, 'void');
    tickContainers();
    run(hooks.tick, G);
  }

  // ---------------------------------------------------------------- targeting, mining, placing, using
  const tmpV = new THREE.Vector3();
  function eyePos() { return tmpV.set(player.p.x, player.p.y + (player.sneaking ? SNEAK_EYE : EYE), player.p.z); }
  function lookDir() { return new THREE.Vector3(0, 0, -1).applyQuaternion(R.camera.quaternion); }
  function raycast() {
    const o = R.camera.position, d = lookDir(), reach = state.mode === 'creative' ? REACH_CREATIVE : REACH;
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
    const tdx = sx ? Math.abs(1 / d.x) : Infinity, tdy = sy ? Math.abs(1 / d.y) : Infinity, tdz = sz ? Math.abs(1 / d.z) : Infinity;
    let tx = sx > 0 ? (x + 1 - o.x) * tdx : sx < 0 ? (o.x - x) * tdx : Infinity;
    let ty = sy > 0 ? (y + 1 - o.y) * tdy : sy < 0 ? (o.y - y) * tdy : Infinity;
    let tz = sz > 0 ? (z + 1 - o.z) * tdz : sz < 0 ? (o.z - z) * tdz : Infinity;
    let n = [0, 0, 0], t = 0;
    while (t <= reach) {
      const id = W.getBlock(x, y, z);
      if (id && !LIQUID[id]) return { x, y, z, id, n };
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; n = [-sx, 0, 0]; }
      else if (ty < tz) { y += sy; t = ty; ty += tdy; n = [0, -sy, 0]; }
      else { z += sz; t = tz; tz += tdz; n = [0, 0, -sz]; }
    }
    return null;
  }
  G.raycast = raycast;

  let attackHeld = false, attackFresh = false, useHeld = false, useFresh = false;
  let mining = null, breakCooldown = 0, useCooldown = 0, swingT = -1;
  const swing = () => { if (swingT < 0 || swingT > 0.6) swingT = 0; };
  function releaseInputs() { attackHeld = useHeld = attackFresh = useFresh = false; mining = null; state.eating = 0; keys.clear(); sprintTap = false; touchJump = touchDown = false; }
  const held = () => state.inv[state.sel];
  const env = () => ({ inWater: player.eyeInWater, airborne: !player.onGround && !player.fly });

  // Drop a container's contents at its block and forget it (both game modes, as in the reference game).
  function spillContainer(key, x, y, z) {
    const c = containers.get(key); if (!c) return;
    for (const st of c.slots) if (st) E.drop(st, x, y, z);
    containers.delete(key);
    if (state.open && state.open.key === key) { closeInventory(true); setScreen('play'); }
  }
  function breakBlock(h) {
    const id = h.id;
    if (DEFS[id].container) spillContainer(CT.key(h.x, h.y, h.z), h.x, h.y, h.z);
    W.setBlock(h.x, h.y, h.z, 0);
    R.burst(h.x, h.y, h.z, id);
    if (state.mode === 'survival') {
      const tool = IT.toolOf(held());
      const info = breakInfo(id, tool, env());
      for (const d of drops(id, info.canHarvest, Math.random)) E.drop(IT.make(d.key, d.count), h.x, h.y, h.z);
      if (tool && DEFS[id].hardness > 0) damageHeld(tool.type === 'sword' ? 2 : 1);
      S.addExhaustion(state.stats, S.EXHAUST.mine);
    }
  }
  function damageHeld(n) {
    const s = held(); const d = s && IT.get(s.id);
    if (!d || !d.tool) return;
    s.dmg = (s.dmg || 0) + n;
    if (s.dmg >= d.tool.durability) { state.inv[state.sel] = null; U.toast(d.name + ' broke!'); }
  }
  function place(h) {
    const x = h.x + h.n[0], y = h.y + h.n[1], z = h.z + h.n[2];
    if (y < 0 || y >= WH) return false;
    const cur = W.getBlock(x, y, z); if (cur && !LIQUID[cur]) return false;
    const s = held(); const d = s && IT.get(s.id);
    if (!d || d.kind !== 'block') return false;
    // Block-specific placement rules: canPlace(world, x, y, z, face) and placeAs(...) for oriented variants.
    const bd = DEFS[d.block];
    if (bd.canPlace && !bd.canPlace(W, x, y, z, h.n)) return false;
    const placeId = bd.placeAs ? bd.placeAs(W, x, y, z, h.n, player) : d.block;
    if (SOLID[placeId] && x + 1 > player.p.x - HW && x < player.p.x + HW && y + 1 > player.p.y && y < player.p.y + player.height && z + 1 > player.p.z - HW && z < player.p.z + HW) return false;
    W.setBlock(x, y, z, placeId);
    if (state.mode === 'survival') { s.count--; if (s.count <= 0) state.inv[state.sel] = null; }
    swing();
    return true;
  }
  function pickBlock() {
    const h = raycast(); if (!h) return;
    // variant blocks (lit furnace, wall torch...) pick the item they drop
    const id = IT.get(h.id) ? h.id : (DEFS[h.id].drop && IT.key(DEFS[h.id].drop) ? IT.key(DEFS[h.id].drop).id : 0);
    if (!id) return;
    const at = state.inv.findIndex((s, i) => i < 9 && s && s.id === id);
    if (at >= 0) { G.selectSlot(at); return; }
    if (state.mode === 'creative') {
      let slot = state.inv[state.sel] ? state.inv.findIndex((s, i) => i < 9 && !s) : state.sel;
      if (slot < 0) slot = state.sel;
      state.sel = slot; state.inv[slot] = IT.make(id, 64);
      U.toast(IT.get(id).name);
      return;
    }
    const inMain = state.inv.findIndex((s, i) => i >= 9 && s && s.id === id);
    if (inMain >= 0) {
      let slot = state.inv[state.sel] ? state.inv.findIndex((s, i) => i < 9 && !s) : state.sel;
      if (slot < 0) slot = state.sel;
      const t = state.inv[slot]; state.inv[slot] = state.inv[inMain]; state.inv[inMain] = t; state.sel = slot;
      U.toast(IT.get(id).name);
    }
  }
  function dropHeld(all) {
    const s = held(); if (!s) return;
    const n = all ? s.count : 1;
    E.toss(Object.assign({}, s, { count: n }), eyePos().clone(), lookDir(), 2);
    s.count -= n; if (s.count <= 0) state.inv[state.sel] = null;
    swing();
  }

  function interact(dt) {
    const h = raycast();
    R.setHighlight(h);
    breakCooldown -= dt; useCooldown -= dt;
    const creative = state.mode === 'creative';
    const s = held(), d = s && IT.get(s.id);
    // attack / mine
    if (attackHeld) {
      if (!h) { if (attackFresh) swing(); mining = null; }
      else if (creative) {
        if (breakCooldown <= 0 && !(d && d.tool && d.tool.type === 'sword')) { breakBlock(h); breakCooldown = 0.25; swing(); }
        mining = null;
      } else {
        // progress restarts when the target or the held item changes, as in the reference game
        const k = h.x + ',' + h.y + ',' + h.z + ':' + state.sel + ':' + (s ? s.id : 0);
        if (!mining || mining.k !== k) mining = { k, progress: 0 };
        if (breakCooldown <= 0) {
          const info = breakInfo(h.id, IT.toolOf(s), env());
          if (info.ticks === Infinity) mining.unbreakable = true;
          else mining.progress += info.ticks === 0 ? 1 : dt / info.seconds;
          if (swingT < 0) swing();
          if (mining.progress >= 1) { breakBlock(h); mining = null; breakCooldown = 0.25; }
        }
      }
    } else mining = null;
    attackFresh = false;
    const stage = mining && !mining.unbreakable ? Math.min(9, Math.floor(mining.progress * 10) - 1) : -1;   // nothing shown below 10 %
    R.setCrack(stage >= 0 ? h : null, stage);

    // use: crafting table, eat, place
    if (useHeld) {
      const usable = h && DEFS[h.id].use && !(player.sneaking && s);   // sneaking with an item in hand places instead
      if (useFresh && usable) {
        useFresh = false; useHeld = false;
        if (DEFS[h.id].use === 'crafting') openInventory('table');
        else if (DEFS[h.id].container) openContainer(h);
        return;
      }
      if (d && d.food && S.canEat(state.stats, d.food, creative) && !usable) {
        state.eating += dt / 1.6;
        if (Math.random() < dt * 6) R.burst(Math.floor(eyePos().x), Math.floor(eyePos().y - 0.6), Math.floor(eyePos().z), B.LEAVES, 2);
        if (state.eating >= 1) {
          S.eat(state.stats, d.food); state.eating = 0;
          if (!creative) { s.count--; if (s.count <= 0) state.inv[state.sel] = null; }
        }
      } else {
        state.eating = 0;
        if ((useCooldown <= 0 || useFresh) && h && d && d.kind === 'block') { if (place(h)) useCooldown = 0.2; }
      }
      useFresh = false;
    } else state.eating = 0;
  }

  // ---------------------------------------------------------------- inventory actions
  function openInventory(kind) {
    if (screen !== 'play' || player.dead) return;
    releaseInputs();
    const leftovers = [state.cursor].concat(state.craft.slots).filter(Boolean);
    state.cursor = null;
    state.craft = { n: kind === 'table' ? 3 : 2, slots: INV.empty(9) };
    returnToInventory(leftovers);
    setScreen('inventory');
    U.openInventory(kind);
  }
  function openContainer(h) {
    if (screen !== 'play' || player.dead) return;
    const key = CT.key(h.x, h.y, h.z), type = DEFS[h.id].container;
    let c = containers.get(key);
    if (!c || c.type !== type) { c = CT.create(type); containers.set(key, c); }
    openInventory(type);
    state.open = { key, x: h.x, y: h.y, z: h.z, c };
    U.openInventory(type);
  }
  function returnToInventory(stacks) {
    for (const s of stacks) {
      const c = INV.clone(s), left = INV.addPlayer(state.inv, c, state.sel);
      if (left > 0) E.toss(Object.assign({}, s, { count: left }), eyePos().clone(), lookDir(), 0.5);
    }
  }
  function closeInventory(silent) {
    const back = [state.cursor].concat(state.craft.slots).filter(Boolean);
    state.cursor = null; state.craft.slots = INV.empty(9); state.open = null;
    returnToInventory(back);
    if (!silent) startPlaying();
  }
  G.closeInventory = () => { if (screen === 'inventory') closeInventory(false); };
  const craftSlots = () => state.craft.slots.slice(0, state.craft.n * state.craft.n);
  G.craftResult = () => CR.result(craftSlots(), state.craft.n);
  function consumeCraft() { const n = state.craft.n * state.craft.n; for (let i = 0; i < n; i++) { const c = state.craft.slots[i]; if (c) { c.count--; if (c.count <= 0) state.craft.slots[i] = null; } } }
  G.peekSlot = function (c, i) {
    if (c === 'inv') return state.inv[i];
    if (c === 'craft') return state.craft.slots[i];
    if (c === 'result') { const r = G.craftResult(); return r && r.stack; }
    if (c === 'palette') return IT.make(i, 1);
    if ((c === 'chest' || c === 'furnace') && state.open) return state.open.c.slots[i];
    return null;
  };
  const boxSlots = c => ((c === 'chest' || c === 'furnace') && state.open ? state.open.c.slots : null);
  G.slotAction = function (c, i, action) {
    const btn = action === 'right' ? 2 : 0;
    const creative = state.mode === 'creative';
    const MAIN = INV.MAIN, HOT = INV.HOTBAR;
    const box = state.open && state.open.c;
    if (c === 'inv') {
      if (action === 'shift' && box && box.type === 'chest') INV.quickMove(state.inv, i, [[box.slots, box.slots.map((_, k) => k)]]);
      else if (action === 'shift' && box && box.type === 'furnace' && state.inv[i] && CT.furnaceTarget(state.inv[i]) >= 0) INV.quickMove(state.inv, i, [[box.slots, [CT.furnaceTarget(state.inv[i])]]]);
      else if (action === 'shift') INV.quickMove(state.inv, i, [[state.inv, i < 9 ? MAIN : HOT]]);
      else if (action === 'middle') { if (creative && state.inv[i] && !state.cursor) state.cursor = IT.make(state.inv[i].id, IT.maxStack(state.inv[i].id)); }
      else state.cursor = INV.click(state.inv, i, btn, state.cursor);
    } else if (c === 'craft') {
      if (action === 'shift') INV.quickMove(state.craft.slots, i, [[state.inv, MAIN], [state.inv, HOT]]);
      else if (action !== 'middle') state.cursor = INV.click(state.craft.slots, i, btn, state.cursor);
    } else if (c === 'result') {
      if (action === 'middle') { /* no-op */ }
      else if (action === 'shift') {
        for (let k = 0; k < 64; k++) {
          const r = G.craftResult(); if (!r) break;
          const test = state.inv.map(INV.clone);
          if (INV.addTo(test, INV.clone(r.stack), MAIN.concat(HOT)) > 0) { U.toast('Your inventory is full'); break; }
          state.inv = test; consumeCraft();
        }
      } else {
        const r = G.craftResult();
        if (r) {
          if (!state.cursor) { state.cursor = r.stack; consumeCraft(); }
          else if (INV.stackable(state.cursor, r.stack) && state.cursor.count + r.stack.count <= IT.maxStack(r.stack.id)) { state.cursor.count += r.stack.count; consumeCraft(); }
        }
      }
    } else if (c === 'palette' && creative) {
      const m = IT.maxStack(i);
      if (action === 'shift') INV.addTo(state.inv, IT.make(i, m), HOT.concat(MAIN));
      else if (action === 'right' && state.cursor && state.cursor.id === i && state.cursor.count < m) state.cursor.count++;
      else state.cursor = IT.make(i, action === 'right' ? 1 : m);
    } else if (c === 'trash' && creative) {
      state.cursor = null;
    } else if (box && (c === 'chest' || c === 'furnace')) {
      if (action === 'shift') INV.quickMove(box.slots, i, [[state.inv, HOT.slice().reverse()], [state.inv, MAIN.slice().reverse()]]);
      else if (action === 'middle') { /* no-op */ }
      else if (c === 'furnace' && i === CT.OUT) {
        // output slot: take only
        const o = box.slots[i];
        if (o && !state.cursor) { state.cursor = o; box.slots[i] = null; }
        else if (o && INV.stackable(state.cursor, o) && state.cursor.count + o.count <= IT.maxStack(o.id)) { state.cursor.count += o.count; box.slots[i] = null; }
      } else {
        const accept = c === 'furnace' && i === CT.FUEL ? st => BC.smelting.fuelTicks(st.id) > 0 : null;
        state.cursor = INV.click(box.slots, i, btn, state.cursor, accept);
      }
    }
    U.renderInventory();
  };
  G.swapWithHotbar = function (c, i, n) {
    const src = c === 'inv' ? state.inv : c === 'craft' ? state.craft.slots : boxSlots(c);
    if (c === 'furnace' && (i === CT.OUT || (i === CT.FUEL && state.inv[n] && !BC.smelting.fuelTicks(state.inv[n].id)))) return;
    if (!src || (c === 'inv' && i === n)) return;
    const t = src[i]; src[i] = state.inv[n]; state.inv[n] = t;
    U.renderInventory();
  };
  G.dropFromSlot = function (c, i, all) {
    const src = c === 'inv' ? state.inv : c === 'craft' ? state.craft.slots : boxSlots(c);
    if (!src || !src[i]) return;
    const s = src[i], n = all ? s.count : 1;
    E.toss(Object.assign({}, s, { count: n }), eyePos().clone(), lookDir(), 2);
    s.count -= n; if (s.count <= 0) src[i] = null;
    U.renderInventory();
  };
  G.dropCursor = function (kind) {
    const s = state.cursor; if (!s) return;
    const n = kind === 'one' ? 1 : s.count;
    E.toss(Object.assign({}, s, { count: n }), eyePos().clone(), lookDir(), 2);
    s.count -= n; if (s.count <= 0) state.cursor = null;
    U.renderInventory();
  };
  // Recipe list: move ingredients from the inventory into the grid.
  G.fillRecipe = function (r, many) {
    const n = state.craft.n, layout = CR.layout(r, n);
    if (!layout) return;
    const test = state.inv.map(INV.clone);
    for (const s of state.craft.slots.concat([state.cursor])) if (s && INV.addPlayer(test, INV.clone(s)) > 0) { U.toast('Make room in your inventory first'); return; }
    let times = Infinity;
    for (const [id, k] of Object.entries(r.needs)) times = Math.min(times, Math.floor(INV.count(test, +id) / k), IT.maxStack(+id));
    if (!many) times = Math.min(times, 1);
    if (!(times >= 1)) {
      const miss = CR.missing(r, id => INV.count(test, id));
      U.toast('Missing ' + miss.map(m => `${m.need} ${IT.get(m.id).name}`).join(', '));
      return;
    }
    state.inv = test; state.cursor = null; state.craft.slots = INV.empty(9);
    layout.forEach((id, k) => { if (id) { INV.remove(state.inv, id, times); state.craft.slots[k] = { id, count: times }; } });
    U.renderInventory();
  };
  G.selectSlot = function (i) {
    state.sel = ((i % 9) + 9) % 9;
    const s = held(); if (s) U.toast(IT.get(s.id).name);
  };
  function pickup(stack) {
    const before = stack.count;
    const left = INV.addPlayer(state.inv, stack, state.sel);
    if (left !== before && screen === 'inventory') U.renderInventory();
    return left;
  }

  // ---------------------------------------------------------------- developer API (devtools.js)
  const devAllowed = () => !!rec && (rec.cheats || settings.devMode);
  G.dev = {
    allowed: devAllowed,
    timeScale: 1, freezeTime: false,
    get time() { return dayTime; }, set time(t) { dayTime = ((t % 1) + 1) % 1; },
    get settings() { return settings; },
    teleport(x, y, z) {
      if (!rec) return false;
      W.prime(x, z);
      player.p.set(x, y, z); player.v.set(0, 0, 0); player.fallDist = 0;
      return true;
    },
    give(stack) {
      if (!rec || !stack) return 0;
      const n = stack.count, left = INV.addPlayer(state.inv, stack, state.sel);
      if (left > 0) E.toss(Object.assign({}, stack, { count: left }), eyePos().clone(), lookDir(), 0.5);
      if (screen === 'inventory') U.renderInventory();
      return n;
    },
    heal() { state.stats.health = 20; state.stats.air = S.MAX_AIR; },
    feed() { state.stats.food = 20; state.stats.saturation = 20; state.stats.exhaustion = 0; },
    kill() { hurt(1e6, 'kill'); },
    clearInventory() { state.inv = INV.empty(36); state.cursor = null; },
    setSpawn(x, y, z) { if (rec) rec.spawn = [x, y, z]; },
    surfaceY: (x, z) => W.surfaceY(Math.floor(x), Math.floor(z)),
    eye: () => eyePos().clone(), lookDir,
    releaseInputs: () => releaseInputs(),
    resume: () => startPlaying(),
    pauseInfo: () => pauseInfo(),
    save: () => saveNow(),
  };

  // ---------------------------------------------------------------- input
  const SENS = 0.0024;
  let lockedAt = 0;
  function look(dx, dy, s) {
    player.yaw -= dx * s * settings.sensitivity;
    player.pitch = clamp(player.pitch - dy * s * settings.sensitivity * (settings.invertY ? -1 : 1), -1.55, 1.55);
  }
  const GAME_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'F3', 'Tab'];
  window.addEventListener('keydown', e => {
    const tag = e.target && e.target.tagName;
    if ((tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') && e.code !== 'Escape') return;
    if (screen === 'play' && GAME_KEYS.includes(e.code)) e.preventDefault();
    if (screen === 'inventory') {
      if (e.repeat) return;
      if (e.code === 'KeyE') { closeInventory(false); return; }
      if (e.code === 'Escape') { closeInventory(true); setScreen('pause'); U.setPause(pauseInfo()); saveNow(); return; }
      const h = U.hoveredSlot();
      if (h && e.code.startsWith('Digit')) { const n = +e.code.slice(5); if (n >= 1) G.swapWithHotbar(h.c, h.i, n - 1); }
      if (h && e.code === 'KeyQ') G.dropFromSlot(h.c, h.i, e.shiftKey);
      return;
    }
    if (e.code === 'Escape') {
      if (screen === 'pause' && control !== 'lock') { startPlaying(); return; }
      if (screen === 'settings') { G.closeSettings(); return; }
      if (screen === 'worlds') { setScreen('title'); return; }
      if (screen === 'create' || screen === 'transfer') { setScreen('worlds'); return; }
      if (screen === 'play' && control !== 'lock') { pause(); return; }
    }
    if (screen !== 'play') return;
    if (e.repeat) { keys.add(e.code); return; }
    keys.add(e.code);
    if (e.code.startsWith('Digit')) { const n = +e.code.slice(5); if (n >= 1) G.selectSlot(n - 1); }
    else if (e.code === 'KeyE') openInventory('player');
    else if (e.code === 'KeyQ') dropHeld(e.shiftKey);
    else if (e.code === 'KeyF') toggleFly();
    else if (e.code === 'F1') { hudHidden = !hudHidden; setScreen('play'); }
    else if (e.code === 'F3' || e.code === 'Backquote') { debugOn = !debugOn; $('debug').hidden = !debugOn; }
    else if (e.code === 'KeyW') { const now = performance.now(); if (now - lastW < 300) sprintTap = true; lastW = now; }
    else if (e.code === 'Space') { const now = performance.now(); if (now - lastSpace < 280 && state.mode === 'creative') toggleFly(); lastSpace = now; }
  });
  window.addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'KeyW') sprintTap = false; });
  window.addEventListener('blur', () => releaseInputs());
  function toggleFly() {
    if (state.mode !== 'creative') { U.toast('Flying is only available in Creative'); return; }
    player.fly = !player.fly; player.v.y = 0; U.toast(player.fly ? 'Flying' : 'Walking');
    $('t-fly').classList.toggle('on', player.fly);
  }

  const cv = $('view');
  let drag = null, tapToken = 0;
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('mousedown', e => {
    if (screen !== 'play' || control === 'touch' || player.dead) return;
    e.preventDefault();
    if (control === 'lock' && !locked()) return;
    if (e.button === 1) { pickBlock(); return; }
    if (e.button === 2) { useHeld = true; useFresh = true; return; }
    if (e.button !== 0) return;
    if (control === 'lock') { attackHeld = true; attackFresh = true; }
    else { tapToken++; drag = { moved: 0, t: performance.now() }; }   // drag mode: hold still to mine, drag to look
  });
  window.addEventListener('mouseup', e => {
    if (e.button === 0) {
      const tap = drag && !attackHeld && drag.moved < 6 && screen === 'play';
      drag = null;
      if (tap) {
        // a quick click in drag mode is one attack press, released a few frames later
        attackHeld = true; attackFresh = true;
        const token = ++tapToken; setTimeout(() => { if (token === tapToken && !drag) attackHeld = false; }, 80);
      } else attackHeld = false;
    }
    if (e.button === 2) useHeld = false;
  });
  window.addEventListener('mousemove', e => {
    if (screen !== 'play') return;
    if (control === 'lock' && locked()) {
      // Chrome sends one bogus move (minus the cursor position) right after granting the lock; drop it.
      if (skipLockMove) { skipLockMove = false; return; }
      if (performance.now() - lockedAt < 120 || Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      look(e.movementX, e.movementY, SENS);
    } else if (control === 'drag' && drag) {
      drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (drag.moved >= 6) { attackHeld = false; look(e.movementX, e.movementY, SENS * 1.6); }
    }
  });
  // drag mode: a still press held for 200 ms starts mining
  setInterval(() => { if (drag && drag.moved < 6 && performance.now() - drag.t > 200 && screen === 'play') attackHeld = true; }, 50);
  window.addEventListener('wheel', e => { if (screen === 'play') { e.preventDefault(); if (e.deltaY) G.selectSlot(state.sel + (e.deltaY > 0 ? 1 : -1)); } }, { passive: false });

  // touch
  const joyEl = $('joy'), knob = $('knob');
  function joyUpdate(t) {
    const r = joyEl.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, max = r.width / 2;
    let dx = t.clientX - cx, dy = t.clientY - cy; const l = Math.hypot(dx, dy); if (l > max) { dx *= max / l; dy *= max / l; }
    joy.x = dx / max; joy.y = dy / max; knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  joyEl.addEventListener('touchstart', e => { e.preventDefault(); const t = e.changedTouches[0]; joy.id = t.identifier; joyUpdate(t); }, { passive: false });
  cv.addEventListener('touchstart', e => { if (screen !== 'play') return; e.preventDefault(); const t = e.changedTouches[0]; lookT.id = t.identifier; lookT.x = t.clientX; lookT.y = t.clientY; }, { passive: false });
  window.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) joyUpdate(t);
      else if (t.identifier === lookT.id) { look(t.clientX - lookT.x, t.clientY - lookT.y, 0.0055); lookT.x = t.clientX; lookT.y = t.clientY; }
    }
    if (screen === 'play') e.preventDefault();
  }, { passive: false });
  function touchEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) { joy.id = null; joy.x = joy.y = 0; knob.style.transform = ''; }
      if (t.identifier === lookT.id) lookT.id = null;
    }
  }
  window.addEventListener('touchend', touchEnd); window.addEventListener('touchcancel', touchEnd);
  function tbtn(id, down, up) {
    const el = $(id);
    el.addEventListener('touchstart', e => { e.preventDefault(); if (screen === 'play') down(); }, { passive: false });
    el.addEventListener('touchend', e => { e.preventDefault(); if (up) up(); }, { passive: false });
    el.addEventListener('touchcancel', () => { if (up) up(); });
  }
  tbtn('t-jump', () => { touchJump = true; }, () => { touchJump = false; });
  tbtn('t-down', () => { touchDown = true; }, () => { touchDown = false; });
  tbtn('t-mine', () => { attackHeld = true; attackFresh = true; }, () => { attackHeld = false; });
  tbtn('t-use', () => { useHeld = true; useFresh = true; }, () => { useHeld = false; });
  tbtn('t-sneak', () => { touchSneak = !touchSneak; $('t-sneak').classList.toggle('on', touchSneak); });
  tbtn('t-fly', toggleFly);
  tbtn('t-inv', () => openInventory('player'));
  tbtn('t-drop', () => dropHeld(false));
  $('menu-btn').addEventListener('click', () => pause());

  // ---------------------------------------------------------------- frame loop
  const PHYS_DT = 1 / 60;
  let physAcc = 0;
  let last = performance.now(), acc = 0, frames = 0, fpsT = 0, fps = 0, unloadT = 0, saveT = 0, orbit = 0;
  let equipT = 1, heldKey = null;
  const reduceMotionOS = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reduceMotion = () => settings.reduceMotion || reduceMotionOS;

  function update(dt) {
    const center = rec ? player.p : orbitCenter;
    try { W.stream(center.x, center.z, screen === 'play' ? 6 : 12); } catch (e) { reportError(e); }
    const cam = R.camera;
    if (!rec) {
      if (!reduceMotion()) orbit += dt * 0.05;
      cam.position.set(orbitCenter.x + Math.cos(orbit) * 30, orbitCenter.y + 20, orbitCenter.z + Math.sin(orbit) * 30);
      cam.lookAt(orbitCenter.x, orbitCenter.y + 2, orbitCenter.z);
      cam.rotation.z = 0;
      R.setHighlight(null); R.setCrack(null, -1);
      R.updateParticles(dt);
      dayTime = (dayTime + dt / DAY_LEN * 0.3) % 1;
      R.updateSky(dayTime, dt, false, W.rd);
      R.render(false);
      return;
    }
    const paused = screen === 'pause' || screen === 'loading' || (screen === 'settings' && settingsReturn === 'pause');
    if (!paused) {
      acc += dt; let n = 0;
      while (acc >= TICK && n < 10) { gameTick(); acc -= TICK; n++; }
      if (n >= 10) acc = 0;
      // Fixed 1/60 s physics steps keep fall damage and collisions independent of frame rate.
      physAcc += dt; let k = 0;
      while (physAcc >= PHYS_DT && k < 8) { if (!player.dead) step(PHYS_DT, screen === 'play'); physAcc -= PHYS_DT; k++; }
      if (k >= 8) physAcc = 0;
      if (screen === 'play' && !player.dead) interact(dt);
      else { mining = null; R.setCrack(null, -1); R.setHighlight(null); }
      E.update(dt, { x: player.p.x, y: player.p.y, z: player.p.z, alive: !player.dead }, pickup);
      if (!G.dev.freezeTime) dayTime = (dayTime + dt / DAY_LEN * G.dev.timeScale) % 1;
      if (player.protect > 0) player.protect -= dt;
      if (swingT >= 0) { swingT += dt / 0.3; if (swingT >= 1) swingT = -1; }
      hurtTilt = Math.max(0, hurtTilt - dt);
    }
    // camera
    const eyeH = player.sneaking ? SNEAK_EYE : EYE;
    cam.rotation.set(player.pitch, player.yaw, 0);
    let bobY = 0;
    if (!reduceMotion() && bobAmp > 0) bobY = -Math.abs(Math.cos(bob)) * 0.045 * bobAmp;
    cam.position.set(player.p.x, player.p.y + eyeH + bobY, player.p.z);
    if (settings.damageTilt && !reduceMotion() && hurtTilt > 0) cam.rotation.z = -0.14 * (hurtTilt / 0.35);
    if (player.dead) { cam.rotation.z = 0.5; cam.position.y = player.p.y + 0.3; }
    const targetFov = settings.fov * (player.sprinting && !reduceMotion() ? 1.12 : 1);
    if (Math.abs(cam.fov - targetFov) > 0.05) { cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 8); cam.updateProjectionMatrix(); }
    R.updateSky(dayTime, paused ? 0 : dt, player.eyeInWater, W.rd);
    R.updateParticles(paused ? 0 : dt);
    run(hooks.frame, G, paused ? 0 : dt);
    $('t-fly').classList.toggle('on', player.fly);
    $('water-tint').hidden = !player.eyeInWater;
    // held item
    const hs = held(), hk = hs ? String(hs.id) : 'hand';
    if (hk !== heldKey) { heldKey = hk; equipT = 0; R.setHeld(hs); }
    equipT = Math.min(1, equipT + dt / 0.2);
    R.animateHeld({ swing: swingT, equip: equipT, eating: state.eating > 0, time: performance.now() / 1000, bob, bobAmp, reduceMotion: reduceMotion() });
    if (screen === 'play') U.updateHud({ inv: state.inv, sel: state.sel, mode: state.mode, stats: state.stats, eating: state.eating, reduceMotion: reduceMotion() });
    R.render(screen === 'play' && !hudHidden && !player.dead);

    unloadT += dt; if (unloadT > 1) { unloadT = 0; W.unloadFar(player.p.x, player.p.z); }
    saveT += dt; if (saveT > 10 && !paused) { saveT = 0; saveNow(); }
    frames++; fpsT += dt;
    if (fpsT >= 0.5) {
      fps = Math.round(frames / fpsT); frames = 0; fpsT = 0;
      const p = player.p, dir = ['south', 'west', 'north', 'east'][((Math.round(-player.yaw / (Math.PI / 2)) % 4) + 6) % 4];
      if (settings.showCoords) { $('coords').textContent = `X ${p.x.toFixed(1)}  Y ${p.y.toFixed(1)}  Z ${p.z.toFixed(1)} · facing ${dir}`; }
      if (debugOn) {
        const h = raycast(), st = state.stats;
        $('debug').textContent =
          `${fps} fps · ${W.chunks.size} chunks · ${E.count()} items\n` +
          `XYZ ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)} · facing ${dir}\n` +
          `${state.mode} · ${player.fly ? 'flying' : player.onGround ? 'on ground' : 'airborne'}${player.sneaking ? ' · sneaking' : ''}${player.sprinting ? ' · sprinting' : ''}\n` +
          `health ${st.health.toFixed(1)} food ${st.food} sat ${st.saturation.toFixed(1)} exh ${st.exhaustion.toFixed(2)} air ${st.air}\n` +
          `Time ${String(Math.floor((dayTime * 24 + 6) % 24)).padStart(2, '0')}:00\n` +
          (h ? `Looking at ${DEFS[h.id].name} (${h.x}, ${h.y}, ${h.z})` : 'Looking at nothing');
      }
    }
  }
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
    try { update(dt); } catch (e) { reportError(e); }
  }
  function resize() { R.resize(window.innerWidth, window.innerHeight); }
  window.addEventListener('resize', resize);

  // ---------------------------------------------------------------- boot
  function boot(hotData) {
    BC.tex.finalize();
    R.init(cv);
    U.init(G);
    R.camera.fov = settings.fov; resize();
    const m = store.migrateV1();
    settings = store.getSettings();
    R.camera.fov = settings.fov; R.camera.updateProjectionMatrix();
    let meta = `Version ${BC.VERSION}`;
    if (m && m.ok) meta += ' · your earlier world was moved to “My first world”';
    $('title-meta').textContent = meta;
    if (memoryOnly) U.error('This browser is blocking storage, so worlds are lost when the page closes. Use Export in the world list to keep a copy.');
    makeBackdrop();
    setScreen('title');
    if (hotData && hotData.worldId) G.playWorld(hotData.worldId);
    requestAnimationFrame(t => { last = t; frame(t); });
  }
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(() => { saveNow(); return { worldId: rec ? rec.id : null }; });
  if (hot && hot.ready) hot.ready(boot); else boot(hot && hot.data);
})(window);
