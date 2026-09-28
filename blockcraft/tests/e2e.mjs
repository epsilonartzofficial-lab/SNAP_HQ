#!/usr/bin/env node
// Blockcraft browser end-to-end tests (Playwright + headless Chromium, software WebGL).
//
//   npm run e2e                 run every scenario
//   node tests/e2e.mjs B E      run only scenarios B and E
//   node tests/e2e.mjs --repeat=3 C   run a scenario several times (flakiness check)
//
// Environment: E2E_SHOTS=<dir> for screenshots (default: <tmp>/blockcraft-e2e),
// PLAYWRIGHT_MODULE=<path> if Playwright is not resolvable from here (defaults to the global install).
//
// The tests open index.html from file:// and drive the real UI (clicks, keys, mouse buttons, touch).
// Hooks on the global `BC.game` object are used only to set up positions, aim and inventories and to read state.
// Scenarios are independent: each one gets a fresh browser context (fresh localStorage).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright'); }
const { chromium, devices } = pw;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const SHOTS = process.env.E2E_SHOTS || path.join(os.tmpdir(), 'blockcraft-e2e');
const LAUNCH_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const VIEWPORT = { width: 960, height: 600 };
const SCENARIO_TIMEOUT = 300000;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = v => { try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return String(v); } };
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Item-count maps ({key: count}) compared independently of key order.
const sameCounts = (a, b) => fmt(Object.entries(a || {}).sort()) === fmt(Object.entries(b || {}).sort());
// Every entity in `a` has a counterpart in `b` (same item and count, within `eps` blocks horizontally), and vice versa.
function sameEntities(a, b, eps = 0.05) {
  if (a.length !== b.length) return false;
  const left = b.slice();
  for (const e of a) {
    const i = left.findIndex(o => o.key === e.key && o.count === e.count && Math.abs(o.x - e.x) <= eps && Math.abs(o.z - e.z) <= eps);
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return true;
}
class Failure extends Error {}

// ------------------------------------------------------------------ in-page helpers
// Installed with addInitScript before the game's scripts run. They only read state or set up the test
// (teleport, aim); gameplay itself goes through the real input handlers.
function pageHelpers() {
  const H = (window.__e2e = { gameTime: 0 });
  // Mirror of the game's clock: the game advances by min(0.1, frame dt) every animation frame.
  let last = null;
  const clock = t => { if (last != null) H.gameTime += Math.min(0.1, Math.max(0, (t - last) / 1000)); last = t; requestAnimationFrame(clock); };
  requestAnimationFrame(clock);
  H.frames = n => new Promise(res => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });

  const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  H.W = () => BC.game.world;
  H.block = (x, y, z) => BC.game.world.getBlock(x, y, z);
  H.solid = (x, y, z) => BC.blocks.SOLID[H.block(x, y, z)] === 1;
  H.key = id => BC.items.get(id).key;
  H.standable = (x, y, z) => H.W().hasChunk(x, z) && H.block(x, y, z) === 0 && H.block(x, y + 1, z) === 0 && H.solid(x, y - 1, z);
  const addTo = (out, s) => { if (s) { const k = H.key(s.id); out[k] = (out[k] || 0) + s.count; } return out; };
  // Item totals by key: inventory, plus cursor and crafting grid unless {all:false}, plus dropped entities with {entities:true}.
  H.totals = opts => {
    opts = opts || {};
    const st = BC.game.state, out = {};
    st.inv.forEach(s => addTo(out, s));
    if (opts.all !== false) { addTo(out, st.cursor); st.craft.slots.forEach(s => addTo(out, s)); }
    if (opts.entities) BC.game.entities.list.forEach(e => addTo(out, e));
    return out;
  };
  H.entities = () => BC.game.entities.list.map(e => ({ key: H.key(e.id), count: e.count, dmg: e.dmg || 0, x: e.x, y: e.y, z: e.z, delay: e.delay, onGround: e.onGround }));
  H.inv = () => BC.game.state.inv.map(s => (s ? { key: H.key(s.id), count: s.count, dmg: s.dmg || 0 } : null));
  H.snap = () => {
    const G = BC.game, P = G.player;
    return { screen: G.screen, mode: G.state.mode, p: [P.p.x, P.p.y, P.p.z], v: [P.v.x, P.v.y, P.v.z], yaw: P.yaw, pitch: P.pitch, onGround: P.onGround,
      fly: P.fly, dead: P.dead, sel: G.state.sel, stats: Object.assign({}, G.state.stats), locked: !!document.pointerLockElement, gameTime: H.gameTime,
      cursor: G.state.cursor && { key: H.key(G.state.cursor.id), count: G.state.cursor.count }, eating: G.state.eating };
  };
  H.teleport = (x, y, z) => { const P = BC.game.player; P.p.set(x, y, z); P.v.set(0, 0, 0); P.fallDist = 0; };
  H.eye = () => { const P = BC.game.player; return { x: P.p.x, y: P.p.y + (P.sneaking ? 1.27 : 1.62), z: P.p.z }; };
  // Camera looks along -Z at yaw 0; forward = (-sin yaw, 0, -cos yaw); positive pitch looks up.
  H.aimPoint = (x, y, z) => {
    const e = H.eye(), P = BC.game.player, dx = x - e.x, dy = y - e.y, dz = z - e.z;
    P.yaw = Math.atan2(-dx, -dz);
    P.pitch = Math.max(-1.55, Math.min(1.55, Math.atan2(dy, Math.hypot(dx, dz))));
  };
  // Aim at a block: try points on the faces that look toward the eye until the game's own raycast reports that block
  // (optionally that face). Returns {ok, hit}.
  H.aimBlock = async (bx, by, bz, normal) => {
    const e = H.eye(), c = [bx + 0.5, by + 0.5, bz + 0.5];
    const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
    const faces = N6.filter(n => !normal || same(n, normal))
      .map(n => { const v = [e.x - c[0], e.y - c[1], e.z - c[2]], len = Math.hypot(v[0], v[1], v[2]) || 1; return { n, s: (v[0] * n[0] + v[1] * n[1] + v[2] * n[2]) / len }; })
      .filter(f => f.s > 0 || normal).sort((a, b) => b.s - a.s);
    const pts = [];
    for (const { n } of faces) {
      const base = c.map((v, i) => v + n[i] * 0.45), ax = [0, 1, 2].filter(i => n[i] === 0);
      pts.push(base);
      for (const [u, w] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) { const p = base.slice(); p[ax[0]] += u; p[ax[1]] += w; pts.push(p); }
    }
    if (!normal) pts.push(c);
    let lastHit = null;
    for (const p of pts) {
      H.aimPoint(p[0], p[1], p[2]);
      await H.frames(2);
      const h = BC.game.raycast(); lastHit = h;
      if (h && h.x === bx && h.y === by && h.z === bz && (!normal || same(h.n, normal))) return { ok: true, hit: h };
    }
    return { ok: false, hit: lastHit };
  };
  // Watch block (x,y,z): __e2e.watch() records the current block synchronously and returns a handle; the handle's
  // promise resolves when the block changes (or after timeoutMs) with the game time and what was dropped.
  // Polls with short timers (between animation frames) so the caller can react before the next frame.
  H.watchBlock = (x, y, z, timeoutMs) => new Promise(res => {
    const id0 = H.block(x, y, z), t0 = performance.now();
    const f = () => {
      const id = H.block(x, y, z);
      if (id !== id0) return res({ changed: true, t: H.gameTime, from: id0, id, ents: H.entities(), totals: H.totals() });
      if (performance.now() - t0 > timeoutMs) return res({ changed: false, t: H.gameTime, from: id0, id });
      setTimeout(f, 5);
    };
    setTimeout(f, 5);
  });
  H.watches = {}; let watchId = 0;
  H.watch = (x, y, z, timeoutMs) => { const id = ++watchId; H.watches[id] = H.watchBlock(x, y, z, timeoutMs); return id; };
  H.watchResult = id => H.watches[id].then(r => { delete H.watches[id]; return r; });
  // Resolve with the game time as soon as fn() (source string) is truthy.
  H.until = (src, timeoutMs) => new Promise(res => {
    const fn = new Function('return (' + src + ')'), t0 = performance.now();
    const f = () => { let v; try { v = fn(); } catch (e) { v = false; } if (v) return res({ ok: true, t: H.gameTime, v }); if (performance.now() - t0 > timeoutMs) return res({ ok: false, t: H.gameTime }); setTimeout(f, 5); };
    f();
  });

  // Nearest oak tree whose trunk has >= 3 logs on a dirt base and a free, solid-floored cell beside it.
  H.findTree = (cx, cz, r) => {
    const W = H.W(), B = BC.blocks.B; let best = null;
    for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
      if (!W.hasChunk(x, z)) continue;
      const d = Math.hypot(x - cx, z - cz); if (best && d >= best.d) continue;
      for (let y = 2; y < 76; y++) {
        if (W.getBlock(x, y, z) !== B.LOG || W.getBlock(x, y - 1, z) !== B.DIRT || W.getBlock(x, y + 1, z) !== B.LOG || W.getBlock(x, y + 2, z) !== B.LOG) continue;
        for (const [dx, dz] of D4) {
          const sx = x + dx, sz = z + dz;
          if (H.standable(sx, y, sz) && !BC.blocks.LIQUID[W.getBlock(sx, y - 1, sz)]) { best = { x, y, z, sx, sz, d }; break; }
        }
        break;
      }
    }
    return best;
  };
  // A place to stand with a 2-deep, 2-high wall of plain stone in front (natural cliff or cave wall).
  H.findStoneSite = (cx, cz, r) => {
    const W = H.W(), S = BC.blocks.B.STONE; let best = null;
    for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
      const d = Math.hypot(x - cx, z - cz); if (best && d >= best.d) continue;
      if (!W.hasChunk(x - 2, z - 2) || !W.hasChunk(x + 2, z + 2) || !W.hasChunk(x - 2, z + 2) || !W.hasChunk(x + 2, z - 2)) continue;
      for (let y = 3; y < 74 && !(best && best.d <= d); y++) {
        if (!H.standable(x, y, z)) continue;
        for (const [dx, dz] of D4) {
          const ax = x + dx, az = z + dz, bx = x + 2 * dx, bz = z + 2 * dz;
          if (W.getBlock(ax, y, az) === S && W.getBlock(ax, y + 1, az) === S && W.getBlock(bx, y, bz) === S && W.getBlock(bx, y + 1, bz) === S &&
              H.solid(ax, y - 1, az) && H.solid(bx, y - 1, bz)) { best = { x, y, z, dx, dz, d }; break; }
        }
      }
    }
    return best;
  };
  // Flat, dry ground: a (2*flat+1)^2 patch of natural ground at one height, open to the sky.
  H.findGround = (cx, cz, rMin, rMax, flat) => {
    const W = H.W(), B = BC.blocks.B, OK = [B.GRASS_BLOCK, B.DIRT, B.SAND, B.STONE, B.SNOWY_GRASS_BLOCK];
    let best = null;
    for (let x = cx - rMax; x <= cx + rMax; x++) for (let z = cz - rMax; z <= cz + rMax; z++) {
      const d = Math.hypot(x - cx, z - cz); if (d < rMin || d > rMax || (best && d >= best.d)) continue;
      let ok = true, y0 = null;
      for (let dx = -flat; dx <= flat && ok; dx++) for (let dz = -flat; dz <= flat && ok; dz++) {
        const X = x + dx, Z = z + dz;
        if (!W.hasChunk(X, Z)) { ok = false; break; }
        const y = W.surfaceY(X, Z); if (y0 == null) y0 = y;
        if (y !== y0 || !OK.includes(W.getBlock(X, y - 1, Z)) || W.getBlock(X, y, Z) || W.getBlock(X, y + 1, Z) || W.getBlock(X, y + 2, Z)) ok = false;
      }
      if (ok) best = { x: x + 0.5, y: y0, z: z + 0.5, bx: x, bz: z, d };
    }
    return best;
  };
  // Nearest cell (within one block) where the player can stand close to a point, e.g. a dropped item.
  H.standNear = (x, y, z) => {
    const fx = Math.floor(x), fy = Math.floor(y + 0.01), fz = Math.floor(z); let best = null;
    for (let dy = 0; dy >= -1; dy--) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const X = fx + dx, Y = fy + dy, Z = fz + dz;
      if (!H.standable(X, Y, Z)) continue;
      const d = Math.hypot(X + 0.5 - x, Z + 0.5 - z) + Math.abs(Y - y) * 0.5;
      if (!best || d < best.d) best = { x: X + 0.5, y: Y, z: Z + 0.5, d };
    }
    return best;
  };
  // A straight, flat, walkable track of `len` blocks from the player's cell; returns the yaw to face along it.
  H.flatHeading = len => {
    const P = BC.game.player, x0 = Math.floor(P.p.x), y = Math.floor(P.p.y + 0.01), z0 = Math.floor(P.p.z);
    for (const [dx, dz] of D4) {
      let ok = true;
      for (let k = 1; k <= len && ok; k++) ok = H.standable(x0 + dx * k, y, z0 + dz * k) && H.block(x0 + dx * k, y + 2, z0 + dz * k) === 0;
      if (ok) return { yaw: Math.atan2(-dx, -dz), dx, dz };
    }
    return null;
  };
  // Per-frame recorder for time-based checks (drowning, eating).
  H.startSampler = () => {
    H.samples = []; H.sampling = true;
    const f = () => {
      if (!H.sampling) return;
      const st = BC.game.state.stats;
      const bub = Array.from(document.querySelectorAll('#air .hud-ico')).filter(el => el.style.backgroundImage && el.style.backgroundImage !== 'none').length;
      H.samples.push({ t: H.gameTime, air: st.air, health: st.health, food: st.food, bubbles: bub, eyeInWater: BC.game.player.eyeInWater,
        tint: !document.getElementById('water-tint').hidden, eating: BC.game.state.eating, eatBar: !document.getElementById('eat-bar').hidden });
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  };
  H.stopSampler = () => { H.sampling = false; return H.samples; };
  H.hud = () => {
    const k = id => Array.from(document.querySelectorAll('#' + id + ' .hud-ico')).map(e => e.dataset.k || '');
    return { hudHidden: document.getElementById('hud').hidden, statsVis: getComputedStyle(document.getElementById('stats')).visibility,
      hearts: k('hearts'), food: k('food'), hotSlots: document.querySelectorAll('#hotbar .slot').length, hotImgs: document.querySelectorAll('#hotbar .slot img').length,
      crosshair: !document.getElementById('crosshair').hidden, touch: !document.getElementById('touch').hidden, menuBtn: !document.getElementById('menu-btn').hidden,
      toast: document.getElementById('toast').textContent };
  };
}

// ------------------------------------------------------------------ one browser context driving the game
class Game {
  constructor(t, ctx, opts) { this.t = t; this.ctx = ctx; this.lock = opts.lock !== false && !opts.device; this.label = opts.label || t.sc.id; }

  static async open(t, opts = {}) {
    const base = opts.device ? { ...opts.device } : { viewport: VIEWPORT };
    const ctx = await t.browser.newContext({ ...base, ...(opts.contextOptions || {}) });
    await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx.addInitScript(pageHelpers);
    for (const s of opts.initScripts || []) await ctx.addInitScript(s.fn, s.arg);
    const g = new Game(t, ctx, opts);
    g.page = await ctx.newPage();
    g.page.on('pageerror', e => t.errors.push(`[${g.label}] pageerror: ${e.message}`));
    g.page.on('console', m => { if (m.type() === 'error') t.errors.push(`[${g.label}] console.error: ${m.text()}`); });
    g.page.on('crash', () => t.errors.push(`[${g.label}] page crashed`));
    return g;
  }

  ev(fn, arg) { return this.page.evaluate(fn, arg); }
  snap() { return this.ev(() => __e2e.snap()); }
  frames(n) { return this.ev(n => __e2e.frames(n), n); }
  // Resolve when `src` (an expression evaluated in the page every frame) is truthy; returns game time.
  async until(src, timeoutMs, msg) {
    const r = await this.ev(([s, ms]) => __e2e.until(s, ms), [src, timeoutMs]);
    if (!r.ok) throw new Failure(`${msg || 'timed out waiting for ' + src} (after ${timeoutMs} ms); state ${fmt(await this.snap())}`);
    return r;
  }
  async waitFor(fn, arg, { timeout = 15000, msg } = {}) {
    try { await this.page.waitForFunction(fn, arg, { timeout, polling: 100 }); }
    catch (e) { throw new Failure(`${msg || 'condition not met'} (after ${timeout} ms); state ${fmt(await this.snap().catch(() => null))}`); }
  }
  async shot(name) {
    try { fs.mkdirSync(SHOTS, { recursive: true }); await this.page.screenshot({ path: path.join(SHOTS, `${this.t.sc.id}-${name}.png`) }); } catch { /* best effort */ }
  }

  async boot() {
    await this.page.goto(GAME_URL);
    await this.waitFor(() => window.BC && BC.game && BC.game.screen === 'title', null, { timeout: 30000, msg: 'title screen did not appear' });
  }
  async reload() {
    await this.page.reload();
    await this.waitFor(() => window.BC && BC.game && BC.game.screen === 'title', null, { timeout: 30000, msg: 'title screen did not appear after reload' });
  }
  tapOrClick(sel, opts) { return this.touch ? this.page.tap(sel, opts) : this.page.click(sel, opts); }

  // Title → Singleplayer → Create new world → form → Create world, entirely through the UI.
  async createWorld({ name = 'Test World', mode = 'survival', difficulty = 2, seed = '12345', cheats = null } = {}) {
    await this.tapOrClick('#btn-singleplayer');
    await this.page.waitForSelector('#scr-worlds:not([hidden])');
    await this.tapOrClick('#btn-new-world');
    await this.page.waitForSelector('#scr-create:not([hidden])');
    await this.page.fill('#cw-name', name);
    await this.tapOrClick(`label:has(#cw-mode-${mode}) span`);
    await this.page.selectOption('#cw-difficulty', String(difficulty));
    await this.page.fill('#cw-seed', String(seed));
    if (cheats != null) await this.page.setChecked('#cw-cheats', cheats);
    await this.tapOrClick('#btn-create');
    await this.waitPlaying();
  }

  // Wait for the play screen with the world around the player meshed (and the pointer locked in lock mode).
  // If the browser refused to re-lock, the game shows the pause screen: click "Back to game" like a player would.
  async waitPlaying({ timeout = 30000 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const s = await this.ev(() => ({ screen: BC.game.screen, locked: !!document.pointerLockElement,
        ready: !!(BC.game.world && BC.game.record && BC.game.world.chunkReady(BC.game.player.p.x, BC.game.player.p.z)) }));
      if (s.screen === 'play' && s.ready && (!this.lock || s.locked)) return;
      if (s.screen === 'pause') { await sleep(1100); await this.page.click('#btn-resume'); }
      await sleep(100);
    }
    throw new Failure(`game did not reach the play screen; state ${fmt(await this.snap())}`);
  }

  async teleport(x, y, z, { yaw, pitch, ground = true } = {}) {
    await this.ev(([x, y, z, yaw, pitch]) => { __e2e.teleport(x, y, z); if (yaw != null) BC.game.player.yaw = yaw; if (pitch != null) BC.game.player.pitch = pitch; }, [x, y, z, yaw, pitch]);
    await this.waitFor(([x, z]) => BC.game.world.chunkReady(x, z), [x, z], { timeout: 30000, msg: `chunk at ${x},${z} never became ready` });
    if (ground) await this.waitFor(() => BC.game.player.onGround, null, { timeout: 10000, msg: 'player did not settle on the ground after teleport' });
    await this.frames(2);
  }

  // Start watching a block before acting on it; `await w.result()` afterwards.
  async watch(x, y, z, timeoutMs) {
    const id = await this.ev(([x, y, z, ms]) => __e2e.watch(x, y, z, ms), [x, y, z, timeoutMs]);
    return { result: () => this.ev(id => __e2e.watchResult(id), id) };
  }

  // Damage is ignored for a few seconds after joining or respawning (player.protect); wait it out before hurting.
  async waitUnprotected() { await this.until('!(BC.game.player.protect > 0)', 10000, 'post-spawn damage protection never ended'); }

  async aim(x, y, z, normal) {
    const r = await this.ev(([x, y, z, n]) => __e2e.aimBlock(x, y, z, n), [x, y, z, normal || null]);
    if (!r.ok) throw new Failure(`cannot aim at block ${x},${y},${z}${normal ? ' face ' + normal : ''}: ray hits ${fmt(r.hit)}`);
    return r.hit;
  }

  // Hold the left mouse button on a block until it breaks. Returns the game time it took and what dropped.
  async mine(x, y, z, { timeout = 25000 } = {}) {
    const hit = await this.aim(x, y, z);
    const w = await this.watch(x, y, z, timeout);
    const t0 = await this.ev(() => __e2e.gameTime);
    await this.page.mouse.down({ button: 'left' });
    let r;
    try { r = await w.result(); } finally { await this.page.mouse.up({ button: 'left' }); }
    if (!r.changed) throw new Failure(`block ${x},${y},${z} (id ${hit.id}) did not break within ${timeout} ms; state ${fmt(await this.snap())}`);
    return { ...r, target: hit.id, seconds: r.t - t0 };
  }

  // Right-click the given face of a block (default: top) to place the held block against it.
  async placeOn(x, y, z, normal = [0, 1, 0]) {
    await this.aim(x, y, z, normal);
    const [px, py, pz] = [x + normal[0], y + normal[1], z + normal[2]];
    const w = await this.watch(px, py, pz, 3000);
    await this.page.mouse.down({ button: 'right' });
    let r;
    try { r = await w.result(); } finally { await this.page.mouse.up({ button: 'right' }); }
    return { ...r, at: [px, py, pz] };
  }

  // Right-click a usable block (crafting table) and wait for its screen.
  async useBlock(x, y, z) {
    await this.aim(x, y, z);
    await this.page.mouse.down({ button: 'right' });
    try { await this.waitFor(() => BC.game.screen === 'inventory', null, { timeout: 5000, msg: 'right-click on the block did not open a screen' }); }
    finally { await this.page.mouse.up({ button: 'right' }); }
  }

  press(key) { return this.page.keyboard.press(key); }
  async openInventory() { await this.press('KeyE'); await this.waitFor(() => BC.game.screen === 'inventory', null, { msg: 'E did not open the inventory' }); }
  async closeInventory() {
    await this.page.mouse.move(VIEWPORT.width / 2, 40);   // park the pointer off the slots before the lock comes back
    await this.press('KeyE');
    await this.waitPlaying();
  }
  async pauseLikeEsc() {
    // Pressing Esc makes the browser release pointer lock; the game pauses on pointerlockchange.
    await this.ev(() => document.exitPointerLock());
    await this.waitFor(() => BC.game.screen === 'pause', null, { msg: 'losing pointer lock did not pause the game' });
  }

  slotSel(c, i) {
    if (c === 'inv') return i < 9 ? `#inv-hot .slot[data-i="${i}"]` : `#inv-main .slot[data-i="${i}"]`;
    if (c === 'craft') return `#inv-top .slot[data-c="craft"][data-i="${i}"]`;
    if (c === 'result') return '#inv-top .slot.result';
    if (c === 'palette') return `#inv-top .slot[data-c="palette"][data-i="${i}"]`;
    if (c === 'trash') return '#inv-top .slot.trash';
    throw new Error('bad slot container ' + c);
  }
  clickSlot(c, i, { button = 'left', shift = false } = {}) { return this.page.click(this.slotSel(c, i), { button, modifiers: shift ? ['Shift'] : [] }); }
  recipe(label) { return this.page.locator('#recipe-list .recipe').filter({ has: this.page.locator('b', { hasText: new RegExp('^' + escRe(label) + '$') }) }).first(); }
  async slotIndex(key) { return this.ev(k => BC.game.state.inv.findIndex(s => s && s.id === BC.items.idOf(k)), key); }
  async emptySlot(from = 0) { return this.ev(f => BC.game.state.inv.findIndex((s, i) => i >= f && !s), from); }
  totals(opts) { return this.ev(o => __e2e.totals(o), opts || {}); }

  // Wait until every dropped `key` item has been picked up and the inventory holds at least `want`.
  // If an item settles out of pickup range, step onto it (teleport to the nearest free cell) like a player walking over.
  async collect(key, want, { timeout = 15000 } = {}) {
    const t0 = Date.now(); let walked = 0;
    while (Date.now() - t0 < timeout) {
      const s = await this.ev(k => ({ have: __e2e.totals({ all: false })[k] || 0, ents: __e2e.entities().filter(e => e.key === k) }), key);
      if (s.have >= want && !s.ents.length) return { have: s.have, walked };
      const e = s.ents[0];
      if (e && Date.now() - t0 > 2500 && e.delay <= 0 && e.onGround) {
        const moved = await this.ev(e => { const sp = __e2e.standNear(e.x, e.y, e.z); if (sp) __e2e.teleport(sp.x, sp.y, sp.z); return !!sp; }, e);
        if (moved) walked++;
        await sleep(600);
      }
      await sleep(150);
    }
    const s = await this.ev(k => ({ inv: __e2e.totals({ all: false }), ents: __e2e.entities().filter(e => e.key === k), snap: __e2e.snap() }), key);
    throw new Failure(`dropped ${key} was not picked up (want ${want}): ${fmt(s)}`);
  }
}

// ------------------------------------------------------------------ runner
const SCENARIOS = [];
const scenario = (id, title, fn) => SCENARIOS.push({ id, title, fn });

class Run {
  constructor(browser, sc) { this.browser = browser; this.sc = sc; this.fails = []; this.notes = []; this.errors = []; this.games = []; }
  check(cond, msg, detail) { if (!cond) this.fails.push(msg + (detail !== undefined ? ` [got ${fmt(detail)}]` : '')); return !!cond; }
  assert(cond, msg, detail) { if (!cond) throw new Failure(msg + (detail !== undefined ? ` [got ${fmt(detail)}]` : '')); }
  note(msg) { this.notes.push(msg); }
  async open(opts) { const g = await Game.open(this, opts); this.games.push(g); return g; }
}

async function runScenario(browser, sc) {
  const t = new Run(browser, sc), t0 = Date.now();
  let timer;
  try {
    await Promise.race([sc.fn(t), new Promise((_, rej) => { timer = setTimeout(() => rej(new Failure(`scenario timed out after ${SCENARIO_TIMEOUT / 1000} s`)), SCENARIO_TIMEOUT); })]);
  } catch (e) {
    t.fails.push((e instanceof Failure ? '' : 'exception: ') + (e && e.stack && !(e instanceof Failure) ? e.stack.split('\n').slice(0, 3).join(' | ') : e.message));
  } finally { clearTimeout(timer); }
  for (const g of t.games) {
    try {
      const banner = await g.page.evaluate(() => { const b = document.getElementById('banner'); return b && !b.hidden ? document.getElementById('banner-text').textContent : null; });
      if (banner) t.fails.push(`[${g.label}] game error banner shown: ${banner}`);
    } catch { /* page gone */ }
    if (t.fails.length) await g.shot(`${g.label === sc.id ? '' : g.label + '-'}FAIL`);
  }
  if (t.errors.length) t.fails.push('page/console errors: ' + t.errors.slice(0, 8).join(' || '));
  for (const g of t.games) await g.ctx.close().catch(() => {});
  return { sc, ok: t.fails.length === 0, fails: t.fails, notes: t.notes, secs: (Date.now() - t0) / 1000 };
}

async function main() {
  const args = process.argv.slice(2);
  const repeat = +((args.find(a => a.startsWith('--repeat=')) || '--repeat=1').split('=')[1]) || 1;
  const only = args.filter(a => !a.startsWith('--')).map(a => a.toUpperCase());
  const list = SCENARIOS.filter(s => !only.length || only.includes(s.id));
  if (!list.length) { console.error('No scenarios match ' + only.join(' ') + '. Available: ' + SCENARIOS.map(s => s.id).join(' ')); process.exit(2); }
  console.log(`Blockcraft e2e: ${GAME_URL}\nScreenshots: ${SHOTS}\n`);
  let browser = await chromium.launch({ args: LAUNCH_ARGS });
  const results = [], T0 = Date.now();
  for (let k = 0; k < repeat; k++) for (const sc of list) {
    if (!browser.isConnected()) browser = await chromium.launch({ args: LAUNCH_ARGS });
    const r = await runScenario(browser, sc);
    results.push(r);
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${sc.id}  ${sc.title}  (${r.secs.toFixed(1)} s)`);
    for (const n of r.notes) console.log(`        - ${n}`);
    for (const f of r.fails) console.log(`        x ${f}`);
  }
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed in ${((Date.now() - T0) / 1000).toFixed(0)} s`);
  process.exit(failed.length ? 1 : 0);
}

// ------------------------------------------------------------------ scenarios
const ITEM_KEYS = { log: 'oak_log', planks: 'oak_planks', stick: 'stick', table: 'crafting_table', cobble: 'cobblestone' };

scenario('A', 'Menu → Singleplayer → create Survival world (Normal, seed 12345) → HUD', async t => {
  const g = await t.open();
  await g.boot();
  t.check(await g.page.isVisible('#scr-title'), 'title screen is visible on load');
  await g.page.click('#btn-singleplayer');
  await g.page.waitForSelector('#scr-worlds:not([hidden])');
  t.check((await g.page.textContent('#world-list')).includes('No worlds yet'), 'world list starts empty');
  await g.page.click('#btn-new-world');
  await g.page.waitForSelector('#scr-create:not([hidden])');
  // Game-mode toggle updates its help text and the cheats default.
  await g.page.click('label:has(#cw-mode-creative) span');
  t.check((await g.page.textContent('#cw-mode-help')).includes('Unlimited blocks') && await g.page.isChecked('#cw-cheats'), 'Creative radio shows Creative help and ticks cheats');
  await g.page.click('label:has(#cw-mode-survival) span');
  t.check((await g.page.textContent('#cw-mode-help')).includes('Gather resources') && !(await g.page.isChecked('#cw-cheats')), 'Survival radio shows Survival help and clears cheats');
  await g.page.fill('#cw-name', 'Alpha');
  await g.page.selectOption('#cw-difficulty', '2');
  await g.page.fill('#cw-seed', '12345');
  await g.page.click('#btn-create');
  await g.waitPlaying();
  const s = await g.ev(() => ({ snap: __e2e.snap(), hud: __e2e.hud(), inv: BC.game.state.inv.filter(Boolean).length,
    rec: { name: BC.game.record.name, seed: BC.game.record.seed, mode: BC.game.record.mode, difficulty: BC.game.record.difficulty } }));
  t.check(s.snap.screen === 'play', "screen === 'play'", s.snap.screen);
  t.check(s.snap.locked, 'pointer lock engaged after Create world');
  t.check(s.rec.name === 'Alpha' && s.rec.seed === 12345 && s.rec.mode === 'survival' && s.rec.difficulty === 2, 'world record matches the form (Alpha, seed 12345, survival, Normal)', s.rec);
  t.check(!s.hud.hudHidden && s.hud.statsVis === 'visible' && s.hud.crosshair, 'HUD, stats and crosshair visible', s.hud);
  t.check(s.hud.hearts.length === 10 && s.hud.hearts.every(k => k === 'heart_full'), 'HUD shows 10 full hearts', s.hud.hearts);
  t.check(s.hud.food.length === 10 && s.hud.food.every(k => k === 'food_full'), 'HUD shows 10 full hunger icons', s.hud.food);
  t.check(s.hud.hotSlots === 9 && s.hud.hotImgs === 0 && s.inv === 0, 'hotbar has 9 empty slots and the inventory is empty', s.hud);
  t.check(s.snap.stats.health === 20 && s.snap.stats.food === 20, 'starts with 20 health and 20 food', s.snap.stats);
  await g.shot('in-game');
});

scenario('B', 'Survival first day: logs → planks/sticks/table → wooden pickaxe → stone → stone pickaxe', async t => {
  const g = await t.open();
  await g.boot();
  await g.createWorld({ name: 'First Day', seed: '12345' });
  const LOG = 'oak_log';

  // ---- punch a tree
  const tree = await g.ev(() => { const p = BC.game.player.p; return __e2e.findTree(Math.floor(p.x), Math.floor(p.z), 48); });
  t.assert(tree, 'no reachable oak tree near spawn');
  t.note(`tree trunk at ${tree.x},${tree.y},${tree.z}; standing at ${tree.sx},${tree.y},${tree.sz}`);
  const stand = [tree.sx + 0.5, tree.y, tree.sz + 0.5];
  await g.teleport(...stand);

  const r1 = await g.mine(tree.x, tree.y + 1, tree.z);
  t.check(r1.from === (await g.ev(() => BC.blocks.B.LOG)) && r1.id === 0, 'first log block broke', r1);
  t.check(r1.seconds >= 2.8 && r1.seconds <= 3.8, 'breaking a log by hand takes ~3 s of game time', +r1.seconds.toFixed(2));
  t.note(`log by hand: ${r1.seconds.toFixed(2)} s game time`);
  t.check(r1.ents.some(e => e.key === LOG && e.count === 1), 'an oak_log item entity spawned when the log broke', r1.ents);
  let c = await g.collect(LOG, 1);
  t.note(`log 1 picked up${c.walked ? ' after walking over to it' : ' automatically'}`);

  await g.teleport(...stand);
  const r2 = await g.mine(tree.x, tree.y, tree.z);
  t.check(r2.ents.some(e => e.key === LOG), 'second log dropped an item', r2.ents);
  c = await g.collect(LOG, 2);
  // Third log: step into the now-empty trunk column and mine the log overhead.
  await g.teleport(tree.x + 0.5, tree.y, tree.z + 0.5);
  const r3 = await g.mine(tree.x, tree.y + 2, tree.z);
  t.check(r3.ents.some(e => e.key === LOG), 'third log dropped an item', r3.ents);
  c = await g.collect(LOG, 3);
  const afterLogs = await g.totals();
  t.check(afterLogs[LOG] === 3 && Object.keys(afterLogs).length === 1, 'inventory holds exactly 3 oak logs', afterLogs);

  // ---- 2x2 crafting in the player inventory, by hand
  await g.teleport(...stand);
  await g.openInventory();
  const inv0 = await g.ev(() => ({ n: BC.game.state.craft.n, title: document.getElementById('inv-title').textContent, cells: document.querySelectorAll('#inv-top .slot[data-c="craft"]').length }));
  t.check(inv0.n === 2 && inv0.title === 'Inventory' && inv0.cells === 4, 'E opens the inventory with a 2x2 crafting grid', inv0);
  const logSlot = await g.slotIndex(LOG);
  await g.clickSlot('inv', logSlot);
  t.check((await g.snap()).cursor?.count === 3 && await g.page.isVisible('#cursor-stack'), 'clicking the log slot picks up the stack onto the cursor');
  await g.clickSlot('craft', 0);
  const res = await g.ev(() => { const r = BC.game.craftResult(); return { key: r && __e2e.key(r.stack.id), count: r && r.stack.count, shown: !!document.querySelector('#inv-top .slot.result img'), cnt: (document.querySelector('#inv-top .slot.result .cnt') || {}).textContent }; });
  t.check(res.key === 'oak_planks' && res.count === 4 && res.shown && res.cnt === '4', 'logs in the grid show 4 planks in the result slot', res);
  for (let k = 0; k < 3; k++) await g.clickSlot('result', 0);
  let s = await g.ev(() => ({ cursor: __e2e.snap().cursor, grid: BC.game.state.craft.slots.filter(Boolean).length }));
  t.check(s.cursor && s.cursor.key === 'oak_planks' && s.cursor.count === 12 && s.grid === 0, 'three result clicks craft 12 planks from 3 logs (4 per log)', s);
  await g.clickSlot('inv', 9);
  // Sticks and a crafting table through the recipe list.
  t.check(await g.recipe('Stick ×4').evaluate(el => el.classList.contains('ok')), 'Stick recipe is listed as craftable');
  await g.recipe('Stick ×4').click();
  s = await g.ev(() => ({ grid: BC.game.state.craft.slots.map(x => x && __e2e.key(x.id)), result: BC.game.craftResult() && __e2e.key(BC.game.craftResult().stack.id) }));
  t.check(s.result === 'stick', 'clicking the Stick recipe fills the grid so the result is sticks', s);
  await g.clickSlot('result', 0);
  t.check((await g.snap()).cursor?.key === 'stick' && (await g.snap()).cursor?.count === 4, 'result click gives 4 sticks');
  await g.clickSlot('inv', 10);
  await g.recipe('Crafting Table').click();
  await g.clickSlot('result', 0);
  t.check((await g.snap()).cursor?.key === 'crafting_table', 'Crafting Table recipe crafts a table onto the cursor');
  await g.clickSlot('inv', 1);
  s = await g.totals();
  t.check(s.oak_planks === 6 && s.stick === 4 && s.crafting_table === 1 && !s.oak_log, 'after crafting: 6 planks, 4 sticks, 1 crafting table', s);
  // Leave items in the grid and on the cursor, then close: everything must come back to the inventory.
  const plankSlot = await g.slotIndex('oak_planks');
  await g.clickSlot('inv', plankSlot);
  await g.clickSlot('craft', 0, { button: 'right' });
  await g.clickSlot('craft', 3, { button: 'right' });
  const before = await g.totals();
  const entsBefore = await g.ev(() => BC.game.entities.count());
  s = await g.ev(() => ({ cursor: __e2e.snap().cursor, grid: BC.game.state.craft.slots.filter(Boolean).length }));
  t.check(s.cursor?.count === 4 && s.grid === 2, 'right-click places one plank per grid cell (cursor 4, two cells filled)', s);
  await g.shot('crafting-2x2');
  await g.closeInventory();
  const after = await g.ev(() => ({ inv: __e2e.totals({ all: false }), cursor: BC.game.state.cursor, grid: BC.game.state.craft.slots.filter(Boolean).length, ents: BC.game.entities.count() }));
  t.check(sameCounts(after.inv, before), 'closing with E returns grid and cursor items to the inventory (nothing lost)', { before, after });
  t.check(!after.cursor && after.grid === 0 && after.ents === entsBefore, 'cursor and grid are empty after closing and nothing was dropped', after);

  // ---- place the crafting table
  const tableSlot = await g.slotIndex('crafting_table');
  await g.press(`Digit${tableSlot + 1}`);
  t.check((await g.snap()).sel === tableSlot, 'number key selects the crafting table hotbar slot');
  const spots = await g.ev(([tr]) => {
    const out = [], B = BC.blocks.B, y = tr.y;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const X = tr.sx + dx, Z = tr.sz + dz;
      if (Math.max(Math.abs(dx), Math.abs(dz)) < 1 || (X === tr.x && Z === tr.z)) continue;
      const gnd = __e2e.block(X, y - 1, Z);
      if (__e2e.solid(X, y - 1, Z) && gnd !== B.LOG && gnd !== B.OAK_LEAVES && !__e2e.block(X, y, Z) && !__e2e.block(X, y + 1, Z)) out.push({ X, Z, d: Math.hypot(dx, dz) });
    }
    return out.sort((a, b) => b.d - a.d);
  }, [tree]);
  let table = null; const tried = [];
  for (const sp of spots) {
    try {
      const r = await g.placeOn(sp.X, tree.y - 1, sp.Z);
      if (r.changed) { table = { x: sp.X, y: tree.y, z: sp.Z, r }; break; }
      tried.push(`${sp.X},${sp.Z}: no block placed (${fmt(await g.snap())})`);
    } catch (e) { if (!(e instanceof Failure)) throw e; tried.push(`${sp.X},${sp.Z}: ${e.message}`); }
  }
  t.assert(table, 'could not place the crafting table on the ground next to the tree', tried.slice(0, 4));
  t.check(table.r.id === (await g.ev(() => BC.blocks.B.CRAFTING_TABLE)), 'right-click on the ground places a crafting table', table.r);
  t.check(!(await g.ev(i => BC.game.state.inv[i], tableSlot)), 'placing the table consumed it from the hotbar');

  // ---- use it: 3x3 grid, wooden pickaxe
  await g.useBlock(table.x, table.y, table.z);
  s = await g.ev(() => ({ screen: BC.game.screen, n: BC.game.state.craft.n, title: document.getElementById('inv-title').textContent, cells: document.querySelectorAll('#inv-top .slot[data-c="craft"]').length }));
  t.check(s.screen === 'inventory' && s.n === 3 && s.cells === 9 && s.title === 'Crafting Table', 'right-clicking the table opens a 3x3 crafting grid', s);
  await g.recipe('Wooden Pickaxe').click();
  await g.clickSlot('result', 0);
  s = await g.snap();
  t.check(s.cursor?.key === 'wooden_pickaxe', 'table crafts a wooden pickaxe', s.cursor);
  await g.clickSlot('inv', 2);
  await g.shot('crafting-table');
  await g.closeInventory();
  s = await g.totals();
  t.check(s.wooden_pickaxe === 1 && s.oak_planks === 3 && s.stick === 2, 'pickaxe used 3 planks and 2 sticks', s);

  // ---- stone: bare hand drops nothing, wooden pickaxe drops cobblestone and wears
  const site = await g.ev(([x, z]) => __e2e.findStoneSite(x, z, 70), [tree.x, tree.z]);
  t.assert(site, 'no exposed stone wall found within 70 blocks');
  t.note(`stone wall: stand ${site.x},${site.y},${site.z} facing ${site.dx},${site.dz}`);
  const A = [site.x + site.dx, site.z + site.dz], Bw = [site.x + 2 * site.dx, site.z + 2 * site.dz];
  await g.teleport(site.x + 0.5, site.y, site.z + 0.5);
  const handSlot = await g.emptySlot(0);
  await g.press(`Digit${handSlot + 1}`);
  const beforeHand = await g.totals();
  const hand = await g.mine(A[0], site.y + 1, A[1], { timeout: 20000 });
  await g.frames(20);
  const afterHand = await g.ev(() => ({ totals: __e2e.totals(), ents: __e2e.entities() }));
  t.check(hand.ents.length === 0 && afterHand.ents.length === 0, 'stone mined with a bare hand drops nothing', afterHand.ents);
  t.check(sameCounts(afterHand.totals, beforeHand), 'inventory unchanged after hand-mining stone', afterHand.totals);
  t.check(hand.seconds >= 7.0 && hand.seconds <= 8.6, 'stone by hand takes ~7.5 s of game time', +hand.seconds.toFixed(2));
  const pick = await g.slotIndex('wooden_pickaxe');
  await g.press(`Digit${pick + 1}`);
  const dmgOf = () => g.ev(i => BC.game.state.inv[i] && BC.game.state.inv[i].dmg, pick);
  const cobbleRuns = [[A[0], site.y, A[1]], null, [Bw[0], site.y + 1, Bw[1]], [Bw[0], site.y, Bw[1]]];
  let want = 0;
  for (const b of cobbleRuns) {
    if (!b) { await g.teleport(A[0] + 0.5, site.y, A[1] + 0.5); continue; }   // step into the hole
    const d0 = await dmgOf();
    const r = await g.mine(...b);
    want++;
    t.check(r.ents.some(e => e.key === 'cobblestone' && e.count === 1), `stone at ${b} dropped cobblestone with the wooden pickaxe`, r.ents);
    t.check(r.seconds <= 1.6, 'wooden pickaxe mines stone in ~1.15 s', +r.seconds.toFixed(2));
    await g.collect('cobblestone', want);
    t.check((await dmgOf()) === d0 + 1, 'wooden pickaxe loses 1 durability per stone block', { before: d0, after: await dmgOf() });
  }
  s = await g.totals();
  t.check(s.cobblestone === 3, '3 cobblestone collected', s);

  // ---- back to the table for a stone pickaxe
  await g.teleport(...stand);
  await g.useBlock(table.x, table.y, table.z);
  t.check(await g.recipe('Stone Pickaxe').evaluate(el => el.classList.contains('ok')), 'Stone Pickaxe recipe is craftable with 3 cobblestone + 2 sticks');
  await g.recipe('Stone Pickaxe').click();
  await g.clickSlot('result', 0);
  t.check((await g.snap()).cursor?.key === 'stone_pickaxe', 'stone pickaxe crafted onto the cursor');
  await g.clickSlot('inv', await g.emptySlot(0));
  await g.closeInventory();
  s = await g.ev(() => ({ totals: __e2e.totals(), inv: __e2e.inv().filter(Boolean) }));
  t.check(s.totals.stone_pickaxe === 1 && !s.totals.cobblestone && !s.totals.stick && s.totals.oak_planks === 3 && s.totals.wooden_pickaxe === 1,
    'final inventory: stone pickaxe, worn wooden pickaxe, 3 planks; cobblestone and sticks used up', s.totals);
  t.check(s.inv.find(x => x.key === 'wooden_pickaxe')?.dmg === 3 && s.inv.find(x => x.key === 'stone_pickaxe')?.dmg === 0, 'tool wear: wooden 3, stone 0', s.inv);
  await g.shot('done');
});

scenario('C', 'Survival rules: fall damage, drowning, hunger, eating, no flying; Creative has no fall damage', async t => {
  const g = await t.open();
  await g.boot();
  await g.createWorld({ name: 'Rules', seed: '12345' });
  const spawn = await g.ev(() => BC.game.record.spawn);
  const ground = await g.ev(([x, z]) => __e2e.findGround(Math.floor(x), Math.floor(z), 0, 40, 1), [spawn[0], spawn[2]]);
  t.assert(ground, 'no flat dry ground near spawn');

  // ---- fall damage: 10 blocks → ceil(10 - 3) = 7
  await g.teleport(ground.x, ground.y, ground.z);
  await g.waitUnprotected();
  await g.teleport(ground.x, ground.y + 10, ground.z, { ground: false });
  const land = await g.until(`BC.game.player.onGround && BC.game.player.p.y < ${ground.y + 0.01} ? { health: BC.game.state.stats.health, y: BC.game.player.p.y } : null`, 15000, 'player never landed');
  const fallDmg = 20 - land.v.health;
  t.note(`fall of 10 blocks dealt ${fallDmg} damage (reference: 7)`);
  t.check(fallDmg >= 6 && fallDmg <= 8, 'a 10-block fall deals 7 (±1) damage', fallDmg);
  t.check(Math.abs(land.v.y - ground.y) < 0.01, 'landed on the ground block', land.v);
  let s;

  // ---- hunger: exhaustion over 4 with no saturation costs one food point
  await g.ev(() => Object.assign(BC.game.state.stats, { health: 20, invuln: 0, food: 20, saturation: 0, exhaustion: 4.1 }));
  await g.frames(4);
  s = await g.ev(() => ({ st: __e2e.snap().stats, hud: __e2e.hud() }));
  t.check(s.st.food === 19 && s.st.exhaustion < 1, 'exhaustion 4.1 with 0 saturation drops food 20 → 19', s.st);
  t.check(s.hud.food.filter(k => k === 'food_full').length === 9 && s.hud.food.filter(k => k === 'food_half').length === 1, 'hunger bar shows 9.5 icons', s.hud.food);

  // ---- eating an apple: hold right mouse ~1.6 s
  await g.ev(() => { const st = BC.game.state; st.inv[st.sel] = BC.items.make('apple', 1); Object.assign(st.stats, { food: 10, saturation: 0, exhaustion: 0 }); BC.game.player.pitch = 0.9; });
  await g.frames(2);
  await g.ev(() => __e2e.startSampler());
  const tEat0 = await g.ev(() => __e2e.gameTime);
  await g.page.mouse.down({ button: 'right' });
  let eaten;
  try { eaten = await g.until('BC.game.state.stats.food !== 10', 6000, 'holding right mouse with an apple never finished eating'); }
  finally { await g.page.mouse.up({ button: 'right' }); }
  const eatSamples = await g.ev(() => __e2e.stopSampler());
  s = await g.snap();
  const eatSecs = eaten.t - tEat0;
  t.note(`eating took ${eatSecs.toFixed(2)} s game time`);
  t.check(s.stats.food === 14 && near(s.stats.saturation, 2.4, 1e-6), 'apple restores 4 food (10 → 14) and 2.4 saturation', s.stats);
  t.check(!(await g.ev(() => BC.game.state.inv[BC.game.state.sel])), 'the apple was consumed');
  t.check(eatSecs >= 1.5 && eatSecs <= 2.0, 'eating takes ~1.6 s of game time', +eatSecs.toFixed(2));
  t.check(eatSamples.some(x => x.eatBar), 'eating progress bar is shown while eating');
  // A full player cannot eat.
  await g.ev(() => { const st = BC.game.state; st.inv[st.sel] = BC.items.make('apple', 1); st.stats.food = 20; });
  await g.page.mouse.down({ button: 'right' });
  await sleep(2500);
  await g.page.mouse.up({ button: 'right' });
  t.check((await g.ev(() => BC.game.state.inv[BC.game.state.sel]?.count)) === 1, 'cannot eat with a full hunger bar (apple kept)');

  // ---- no flying in Survival
  await g.teleport(ground.x, ground.y, ground.z);
  await g.press('KeyF');
  await g.frames(3);
  s = await g.ev(() => ({ fly: BC.game.player.fly, toast: document.getElementById('toast').textContent }));
  t.check(!s.fly && /only available in Creative/.test(s.toast), 'F in Survival does not fly and explains why', s);
  await g.press('Space'); await sleep(120); await g.press('Space');
  await g.frames(3);
  const flyAfterDouble = await g.ev(() => BC.game.player.fly);
  await g.until('BC.game.player.onGround', 5000, 'did not land after jumping');
  t.check(!flyAfterDouble && !(await g.ev(() => BC.game.player.fly)), 'double-tapping Space in Survival does not start flying');

  // ---- drowning: head under water in a stone-lined 1x1x3 shaft
  const col = { x: ground.bx + 3, y: ground.y + 4, z: ground.bz };
  const built = await g.ev(c => {
    const W = BC.game.world, B = BC.blocks.B; let ok = true;
    for (let dy = -1; dy <= 3; dy++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) ok = W.setBlock(c.x + dx, c.y + dy, c.z + dz, B.STONE) && ok;
    for (let dy = 0; dy < 3; dy++) ok = W.setBlock(c.x, c.y + dy, c.z, B.WATER) && ok;
    return ok;
  }, col);
  t.assert(built, 'could not build the water shaft');
  // Food 17 and no saturation so natural regeneration does not mask drowning damage.
  await g.ev(() => Object.assign(BC.game.state.stats, { health: 20, invuln: 0, food: 17, saturation: 0, exhaustion: 0, air: 300 }));
  await g.ev(() => __e2e.startSampler());
  await g.teleport(col.x + 0.5, col.y, col.z + 0.5, { ground: false });
  await g.until('BC.game.state.stats.health <= 14', 45000, 'drowning did not reach 3 damage events');
  const smp = await g.ev(() => __e2e.stopSampler());
  const tIn = (smp.find(x => x.eyeInWater) || smp[0]).t;
  const drops = [];
  for (let i = 1; i < smp.length; i++) if (smp[i].health < smp[i - 1].health) drops.push({ t: smp[i].t - tIn, from: smp[i - 1].health, to: smp[i].health });
  t.note(`drowning damage at ${drops.map(d => d.t.toFixed(2) + 's').join(', ')} after submersion`);
  const at5 = smp.find(x => x.t - tIn >= 5);
  t.check(at5 && at5.air <= 205 && at5.air >= 195, 'air drops by 20 per second under water (≈200 after 5 s)', at5 && at5.air);
  t.check(smp.some(x => x.tint), 'water tint shown with the head under water');
  t.check(smp.some(x => x.bubbles > 0 && x.bubbles < 10) && smp.some(x => x.bubbles === 0 && x.air < 300), 'air bubbles appear and run out on the HUD');
  t.check(drops.length >= 3 && drops.slice(0, 3).every(d => near(d.from - d.to, 2, 1e-9)), 'each drowning hit deals 2 damage', drops);
  t.check(drops[0] && drops[0].t >= 15.5 && drops[0].t <= 17.0, 'first drowning damage after ~16 s (15 s of air + 1 s)', drops[0]);
  const gaps = drops.slice(1, 3).map((d, i) => d.t - drops[i].t);
  t.check(gaps.length === 2 && gaps.every(x => x >= 0.85 && x <= 1.2), 'drowning damage repeats every ~1 s', gaps);
  await g.teleport(ground.x, ground.y, ground.z);
  await g.shot('survival');

  // ---- Creative: no fall damage (new Creative world through the menus)
  await g.pauseLikeEsc();
  await g.page.click('#btn-quit');
  await g.waitFor(() => BC.game.screen === 'title', null, { msg: 'Save and quit did not return to the title' });
  await g.createWorld({ name: 'Rules Creative', mode: 'creative', seed: '12345' });
  const cg = await g.ev(([x, z]) => __e2e.findGround(Math.floor(x), Math.floor(z), 0, 40, 1), [spawn[0], spawn[2]]);
  await g.teleport(cg.x, cg.y, cg.z);
  await g.teleport(cg.x, cg.y + 10, cg.z, { ground: false });
  await g.until(`BC.game.player.onGround && BC.game.player.p.y < ${cg.y + 0.01}`, 15000, 'creative player never landed');
  await g.frames(3);
  s = await g.ev(() => ({ st: __e2e.snap().stats, mode: BC.game.state.mode, statsVis: __e2e.hud().statsVis }));
  t.check(s.mode === 'creative' && s.st.health === 20, 'no fall damage in Creative', s);
  t.check(s.statsVis === 'hidden', 'health and hunger are hidden in Creative', s.statsVis);
});

scenario('D', 'Death drops everything; respawn; walk back and pick it all up', async t => {
  const g = await t.open();
  await g.boot();
  await g.createWorld({ name: 'Mortal', seed: '12345' });
  const spawn = await g.ev(() => BC.game.record.spawn);
  const spot = await g.ev(([x, z]) => __e2e.findGround(Math.floor(x), Math.floor(z), 14, 40, 2), [spawn[0], spawn[2]]);
  t.assert(spot, 'no flat ground 14-40 blocks from spawn');
  await g.teleport(spot.x, spot.y, spot.z);
  const held = await g.ev(() => {
    const st = BC.game.state, mk = BC.items.make;
    st.inv[0] = mk('dirt', 12); st.inv[1] = mk('wooden_pickaxe', 1); st.inv[1].dmg = 7; st.inv[5] = mk('apple', 3);
    st.inv[20] = mk('cobblestone', 64); st.inv[35] = mk('stick', 5);
    return __e2e.totals();
  });
  await g.waitUnprotected();
  // Die the way a long fall kills you, and look at the drops the instant they spawn.
  const died = await g.ev(() => { const p = BC.game.player.p.clone(); BC.game.hurt(100, 'fall'); return { at: [p.x, p.y, p.z], ents: __e2e.entities(), inv: BC.game.state.inv.filter(Boolean).length }; });
  await g.waitFor(() => BC.game.screen === 'death', null, { msg: 'death screen did not appear' });
  const ds = await g.ev(() => ({ visible: !document.getElementById('scr-death').hidden, msg: document.getElementById('death-msg').textContent, dead: BC.game.player.dead, hud: __e2e.hud() }));
  t.check(ds.visible && ds.dead, 'death screen shown', ds);
  t.check(ds.msg === 'You hit the ground too hard.', 'death message names the cause', ds.msg);
  t.check(died.inv === 0, 'inventory emptied on death', died.inv);
  const dropped = {}; for (const e of died.ents) dropped[e.key] = (dropped[e.key] || 0) + e.count;
  t.check(sameCounts(dropped, held), 'dropped entities hold exactly what the player carried', { held, dropped });
  t.check(died.ents.every(e => Math.hypot(e.x - died.at[0], e.z - died.at[2]) < 0.01 && near(e.y, died.at[1] + 0.6, 0.01)), 'items spawn at the death spot', died.ents);
  t.check(died.ents.find(e => e.key === 'wooden_pickaxe')?.dmg === 7, 'dropped pickaxe keeps its wear');
  await g.shot('death');
  await sleep(2500);   // let the drops settle
  await g.page.click('#btn-respawn');
  await g.waitPlaying();
  let s = await g.snap();
  t.check(Math.hypot(s.p[0] - spawn[0], s.p[2] - spawn[2]) < 0.01 && s.stats.health === 20 && s.stats.food === 20 && !s.dead, 'respawned at spawn with full health and food', s);
  t.check((await g.ev(() => BC.game.state.inv.filter(Boolean).length)) === 0, 'still empty-handed after respawn');
  const settled = await g.ev(() => ({ ents: __e2e.entities(), total: BC.game.entities.totalItems() }));
  t.check(settled.total === Object.values(held).reduce((a, b) => a + b, 0), 'entities.totalItems() equals everything that was held', settled.total);
  // Go back and pick everything up.
  await g.teleport(spot.x, spot.y, spot.z);
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const left = await g.ev(() => __e2e.entities());
    if (!left.length) break;
    const e = left[0];
    await g.ev(e => { const sp = __e2e.standNear(e.x, e.y, e.z); if (sp) __e2e.teleport(sp.x, sp.y, sp.z); }, e);
    await sleep(700);
  }
  s = await g.ev(() => ({ totals: __e2e.totals({ entities: true }), inv: __e2e.totals({ all: false }), ents: __e2e.entities(), pick: __e2e.inv().find(x => x && x.key === 'wooden_pickaxe') }));
  t.check(s.ents.length === 0, 'all dropped items picked up again', s.ents);
  t.check(sameCounts(s.inv, held), 'inventory after pickup equals what was held: nothing lost or duplicated', { held, now: s.inv });
  t.check(s.pick && s.pick.dmg === 7, 'recovered pickaxe still has 7 wear', s.pick);
});

// v0.1 single-world save, as written by releases/0.1 (serialize()).
const V1_SAVE = {
  seed: 4242,
  edits: { '0,0': [1 + 2 * 16 + 60 * 256, 13, 2 + 2 * 16 + 60 * 256, 9], '-1,0': [15 + 2 * 16 + 60 * 256, 19] },
  player: { x: 1.5, y: 70, z: 2.5, yaw: 0.5, pitch: -0.2, fly: true },
  dayTime: 0.3, hotbar: [1, 2, 3, 4, 8, 6, 9, 13, 19], sel: 2, rd: 4,
};

scenario('E', 'Save/reload keeps blocks, inventory (grid + cursor), stats, position, drops; v0.1 save migrates', async t => {
  const g = await t.open();
  await g.boot();
  await g.createWorld({ name: 'Persist Test', seed: '777' });
  const spawn = await g.ev(() => BC.game.record.spawn);
  const gr = await g.ev(([x, z]) => __e2e.findGround(Math.floor(x), Math.floor(z), 0, 40, 2), [spawn[0], spawn[2]]);
  t.assert(gr, 'no flat ground near spawn');
  await g.teleport(gr.x, gr.y, gr.z);
  await g.ev(() => {
    const st = BC.game.state, mk = BC.items.make;
    st.inv.fill(null);
    st.inv[0] = mk('cobblestone', 20); st.inv[1] = mk('oak_planks', 10); st.inv[2] = mk('wooden_pickaxe', 1); st.inv[2].dmg = 5;
    st.inv[3] = mk('apple', 3); st.inv[9] = mk('dirt', 30); st.sel = 0;
    Object.assign(st.stats, { health: 15, food: 17, saturation: 0, exhaustion: 0 });
  });
  const y = gr.y, bx = gr.bx, bz = gr.bz;
  // Place two cobblestone blocks, then mine one back with the pickaxe.
  await g.press('Digit1');
  const p1 = await g.placeOn(bx + 2, y - 1, bz);
  const p2 = await g.placeOn(bx, y - 1, bz + 2);
  t.check(p1.changed && p2.changed, 'placed two cobblestone blocks', [p1.id, p2.id]);
  await g.press('Digit3');
  const cobInv = await g.totals();
  const mined = await g.mine(bx, y, bz + 2);
  t.check(mined.from === 4 && mined.ents.some(e => e.key === 'cobblestone'), 'mining placed cobblestone with the pickaxe drops it', { mined: { from: mined.from, id: mined.id, ents: mined.ents, totals: mined.totals }, before: cobInv });
  await g.collect('cobblestone', 19);
  await g.teleport(gr.x, gr.y, gr.z);
  // Dig a ground block with a bare hand: its dirt stays in the hole as a dropped item entity.
  await g.press('Digit5');
  const dug = await g.mine(bx - 2, y - 1, bz);
  t.check(dug.ents.some(e => e.key === 'dirt'), 'digging dropped a dirt item', dug.ents);
  // Toss one apple with Q (facing +z); if it lands within reach, step back to -z so it stays on the ground.
  await g.press('Digit4');
  await g.ev(() => { BC.game.player.pitch = 0.1; BC.game.player.yaw = Math.PI; });
  await g.frames(2);
  await g.press('KeyQ');
  await g.until('BC.game.entities.list.some(e => e.id === BC.items.idOf("apple") && e.onGround)', 5000, 'tossed apple never landed');
  const apple = await g.ev(() => __e2e.entities().find(e => e.key === 'apple'));
  if (Math.hypot(apple.x - gr.x, apple.z - gr.z) < 2.2) await g.teleport(gr.x, gr.y, gr.z - 2);
  await sleep(2500);   // past the toss pickup delay
  t.check((await g.ev(() => __e2e.entities().filter(e => e.key === 'apple').length)) === 1, 'tossed apple lies on the ground (not picked up)');
  // Inventory: 31 dirt into the grid, then 1 plank into the grid with 9 left on the cursor.
  await g.openInventory();
  await g.clickSlot('inv', 9);
  await g.clickSlot('craft', 3);
  await g.clickSlot('inv', 1);
  await g.clickSlot('craft', 0, { button: 'right' });
  const pre = await g.ev(() => ({
    totals: __e2e.totals(), invOnly: __e2e.totals({ all: false }), grid: BC.game.state.craft.slots.map(s => s && [__e2e.key(s.id), s.count]).filter(Boolean),
    cursor: __e2e.snap().cursor, ents: __e2e.entities(), stats: Object.assign({}, BC.game.state.stats), p: BC.game.player.p.toArray(), yaw: BC.game.player.yaw,
    pick: __e2e.inv().find(x => x && x.key === 'wooden_pickaxe'), id: BC.game.record.id,
  }));
  t.check(pre.cursor?.key === 'oak_planks' && pre.cursor.count === 9 && pre.grid.length === 2, 'grid holds dirt + 1 plank, cursor holds 9 planks', pre);
  const blocks = { p1: p1.at, p2: [bx, y, bz + 2], hole: [bx - 2, y - 1, bz] };
  t.check(await g.ev(() => BC.game.saveNow()), 'saveNow() succeeds');
  await g.shot('before-reload');

  await g.reload();
  await g.page.click('#btn-singleplayer');
  await g.page.waitForSelector('#scr-worlds:not([hidden])');
  const row = g.page.locator('.world-row', { hasText: 'Persist Test' });
  t.check(await row.count() === 1 && (await row.textContent()).includes('seed 777'), 'world list shows the saved world with its seed');
  await row.click();
  await g.page.click('#btn-play-world');
  await g.waitPlaying();
  const post = await g.ev(b => ({
    totals: __e2e.totals(), cursor: BC.game.state.cursor, grid: BC.game.state.craft.slots.filter(Boolean).length, ents: __e2e.entities(), stats: Object.assign({}, BC.game.state.stats),
    p: BC.game.player.p.toArray(), yaw: BC.game.player.yaw, pick: __e2e.inv().find(x => x && x.key === 'wooden_pickaxe'), id: BC.game.record.id,
    blocks: { p1: __e2e.block(...b.p1), p2: __e2e.block(...b.p2), hole: __e2e.block(...b.hole) }, COBBLE: BC.blocks.B.COBBLESTONE, hud: __e2e.hud(),
  }), blocks);
  t.check(post.id === pre.id, 'the same world was opened');
  t.check(post.blocks.p1 === post.COBBLE && post.blocks.p2 === 0 && post.blocks.hole === 0, 'placed and broken blocks persisted', post.blocks);
  t.check(!post.cursor && post.grid === 0, 'reloaded with an empty cursor and grid');
  t.check(sameCounts(post.totals, pre.totals), 'grid and cursor items are back in the inventory: nothing lost or duplicated', { before: pre.totals, after: post.totals });
  t.check(post.pick && post.pick.dmg === 6, 'tool wear persisted (pickaxe dmg 6)', post.pick);
  t.check(post.stats.health === 15 && post.stats.food === 17, 'health and food persisted', post.stats);
  t.check(post.hud.hearts.filter(k => k === 'heart_full').length === 7 && post.hud.hearts.filter(k => k === 'heart_half').length === 1, 'HUD shows 7.5 hearts after reload', post.hud.hearts);
  t.check(post.p.every((v, i) => near(v, pre.p[i], 0.01)), 'position persisted', { before: pre.p, after: post.p });
  t.check(near(post.yaw, pre.yaw, 1e-6), 'facing (yaw) persisted', { before: pre.yaw, after: post.yaw });
  const sig = es => es.map(e => `${e.key}:${e.count}@${e.x.toFixed(2)},${e.y.toFixed(2)},${e.z.toFixed(2)}`);
  t.check(sameEntities(pre.ents, post.ents), 'dropped item entities persisted in place', { before: sig(pre.ents), after: sig(post.ents) });

  // Round 2: a full inventory, so grid and cursor items cannot be merged into it on save; they must be dropped nearby.
  await g.openInventory();
  await g.ev(() => {
    const st = BC.game.state, mk = BC.items.make;
    for (let i = 0; i < 36; i++) st.inv[i] = mk('stone', 64);
    st.craft.slots[0] = mk('dirt', 5); st.craft.slots[1] = mk('apple', 3); st.cursor = mk('stone', 10);
    BC.ui.renderInventory();
  });
  const pre2 = await g.ev(() => ({ all: __e2e.totals({ entities: true }), n: BC.game.entities.count() }));
  t.check(await g.ev(() => BC.game.saveNow()), 'saveNow() succeeds with a full inventory');
  await g.reload();
  await g.page.click('#btn-singleplayer');
  await g.page.click('#btn-play-world');
  await g.waitPlaying();
  await sleep(1500);   // past the pickup delay of the re-dropped stacks
  const post2 = await g.ev(() => ({ all: __e2e.totals({ entities: true }), inv: __e2e.totals({ all: false }), ents: __e2e.entities(), p: BC.game.player.p.toArray() }));
  t.check(sameCounts(post2.all, pre2.all), 'full inventory: grid/cursor items survive the reload (inventory + drops), nothing lost or duplicated', { before: pre2.all, after: post2.all });
  const extra = post2.ents.filter(e => ['dirt', 'apple', 'stone'].includes(e.key) && Math.hypot(e.x - post2.p[0], e.z - post2.p[2]) < 1.5);
  t.check(extra.some(e => e.key === 'dirt' && e.count === 5) && extra.some(e => e.key === 'apple' && e.count === 3) && extra.some(e => e.key === 'stone' && e.count === 10),
    'overflow from grid and cursor is dropped next to the player', extra);

  // ---- v0.1 migration (fresh browser profile with only the old key)
  const m = await t.open({ label: 'E-migrate', initScripts: [{ fn: save => { if (!localStorage.getItem('blockcraft.v2.index') && !localStorage.getItem('blockcraft.save.v1')) localStorage.setItem('blockcraft.save.v1', JSON.stringify(save)); }, arg: V1_SAVE }] });
  await m.boot();
  t.check((await m.page.textContent('#title-meta')).includes('My first world'), 'title screen mentions the migrated world');
  await m.page.click('#btn-singleplayer');
  await m.page.waitForSelector('#scr-worlds:not([hidden])');
  const mrow = m.page.locator('.world-row', { hasText: 'My first world' });
  t.check(await mrow.count() === 1, 'migrated world "My first world" appears in the world list');
  t.check((await mrow.textContent()).includes('Creative') && (await mrow.textContent()).includes('seed 4242'), 'migrated world is Creative with the v0.1 seed', await mrow.textContent());
  await mrow.click();
  await m.page.click('#btn-play-world');
  await m.waitPlaying();
  const mig = await m.ev(() => {
    const W = BC.game.world, gen = BC.worldgen.create(1, 4242), IDX = BC.worldgen.IDX, d00 = gen.generateChunk(0, 0);
    let same = 0, diff = 0;
    for (let y = 0; y < 80; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      if (y === 60 && z === 2 && (x === 1 || x === 2)) continue;
      if (W.getBlock(x, y, z) === d00[IDX(x, y, z)]) same++; else diff++;
    }
    return { seed: BC.game.record.seed, mode: BC.game.state.mode, name: BC.game.record.name, b1: W.getBlock(1, 60, 2), b2: W.getBlock(2, 60, 2), b3: W.getBlock(-1, 60, 2),
      same, diff, p: BC.game.player.p.toArray(), fly: BC.game.player.fly, sel: BC.game.state.sel, hot: BC.game.state.inv.slice(0, 9).map(s => s && [s.id, s.count]),
      rd: W.rd, storedRd: BC.game.store.getSettings().renderDistance, v1kept: !!localStorage.getItem('blockcraft.save.v1') };
  });
  t.check(mig.seed === 4242 && mig.mode === 'creative' && mig.name === 'My first world', 'migrated world loads as Creative with seed 4242', mig);
  t.check(mig.b1 === 13 && mig.b2 === 9 && mig.b3 === 19, 'v0.1 block edits are present (bricks, glass, stone bricks)', [mig.b1, mig.b2, mig.b3]);
  t.check(mig.diff === 0, 'untouched terrain matches the v0.1 generator for the same seed', { same: mig.same, diff: mig.diff });
  t.check(near(mig.p[0], 1.5, 1e-6) && near(mig.p[1], 70, 1e-6) && near(mig.p[2], 2.5, 1e-6) && mig.fly, 'player position and flight carried over', mig.p);
  t.check(fmt(mig.hot) === fmt(V1_SAVE.hotbar.map(id => [id, 64])) && mig.sel === 2, 'v0.1 hotbar becomes 64 of each block, selection kept', mig.hot);
  t.check(mig.v1kept, 'original v0.1 key is kept as a backup');
  t.check(mig.storedRd === 4, 'v0.1 render distance (4) migrated into settings', mig.storedRd);
  t.check(mig.rd === 4, 'migrated render distance is used in the first session after migration', { worldRd: mig.rd, stored: mig.storedRd });
  // Settings screen in that first session: it should show the migrated value, and changing another setting must not overwrite it.
  await m.pauseLikeEsc();
  await m.page.click('#btn-pause-settings');
  await m.page.waitForSelector('#scr-settings:not([hidden])');
  t.check((await m.page.inputValue('#set-rd')) === '4', 'Settings screen shows the migrated render distance (4)', await m.page.inputValue('#set-rd'));
  await m.page.focus('#set-fov');
  await m.page.keyboard.press('ArrowRight');
  const afterFov = await m.ev(() => BC.game.store.getSettings());
  t.check(afterFov.fov === 76, 'FOV slider change is saved', afterFov.fov);
  t.check(afterFov.renderDistance === 4, 'changing FOV does not overwrite the migrated render distance', afterFov.renderDistance);
  await m.page.click('#btn-settings-done');
  await m.shot('migrated');
});

scenario('F', 'Creative: instant break, no drops, infinite placing, item palette, flying', async t => {
  const g = await t.open();
  await g.boot();
  await g.createWorld({ name: 'Builder', mode: 'creative', seed: '12345' });
  let s = await g.ev(() => ({ hud: __e2e.hud(), inv: __e2e.inv().slice(0, 9) }));
  t.check(s.hud.statsVis === 'hidden', 'no health or hunger in Creative', s.hud.statsVis);
  t.check(s.inv.every(x => x && x.count === 64) && s.hud.hotImgs === 9, 'hotbar starts with 9 full block stacks', s.inv);
  const spawn = await g.ev(() => BC.game.record.spawn);
  const gr = await g.ev(([x, z]) => __e2e.findGround(Math.floor(x), Math.floor(z), 0, 40, 2), [spawn[0], spawn[2]]);
  await g.teleport(gr.x, gr.y, gr.z);
  await g.press('Digit1');
  const inv0 = await g.totals();
  const br = await g.mine(gr.bx + 2, gr.y - 1, gr.bz);
  t.check(br.seconds <= 0.3, 'Creative breaks a block instantly', +br.seconds.toFixed(3));
  await sleep(1000);
  s = await g.ev(() => ({ n: BC.game.entities.count(), totals: __e2e.totals() }));
  t.check(s.n === 0, 'breaking in Creative drops nothing', s.n);
  t.check(sameCounts(s.totals, inv0), 'inventory unchanged by breaking');
  const pl = await g.placeOn(gr.bx, gr.y - 1, gr.bz + 2);
  s = await g.ev(() => BC.game.state.inv[0].count);
  t.check(pl.changed && pl.id === 1, 'right-click places the held grass block', pl.id);
  t.check(s === 64, 'placing in Creative does not consume the stack', s);
  // Creative inventory: item palette instead of crafting.
  await g.openInventory();
  s = await g.ev(() => ({ title: document.getElementById('inv-title').textContent, palette: document.querySelectorAll('#inv-top .palette .slot').length, items: BC.items.all().length, side: document.getElementById('inv-side').hidden, craft: document.querySelectorAll('#inv-top .slot[data-c="craft"]').length }));
  t.check(s.title === 'Creative inventory' && s.palette === s.items && s.side && s.craft === 0, 'E shows the Creative item palette (every item, no crafting)', s);
  const dp = await g.ev(() => BC.items.idOf('diamond_pickaxe'));
  await g.clickSlot('palette', dp);
  t.check((await g.snap()).cursor?.key === 'diamond_pickaxe', 'clicking a palette item puts it on the cursor');
  await g.clickSlot('inv', 9);
  t.check((await g.ev(() => __e2e.inv()[9]))?.key === 'diamond_pickaxe', 'palette item placed into the inventory');
  await g.clickSlot('palette', await g.ev(() => BC.items.idOf('apple')));
  await g.clickSlot('trash', 0);
  t.check(!(await g.snap()).cursor, 'Bin deletes the cursor stack');
  await g.shot('palette');
  await g.closeInventory();
  // Flying: F toggles, Space rises, double-tap Space also toggles.
  await g.press('KeyF');
  await g.frames(2);
  t.check(await g.ev(() => BC.game.player.fly), 'F starts flying');
  const y0 = (await g.snap()).p[1];
  await g.page.keyboard.down('Space'); await sleep(700); await g.page.keyboard.up('Space');
  const y1 = (await g.snap()).p[1];
  t.check(y1 > y0 + 1, 'holding Space while flying rises', { y0, y1 });
  await g.press('KeyF');
  await g.frames(2);
  t.check(!(await g.ev(() => BC.game.player.fly)), 'F again stops flying');
  await g.until('BC.game.player.onGround', 8000, 'did not land after flying');
  t.check((await g.ev(() => BC.game.state.stats.health)) === 20, 'no fall damage after dropping from flight');
  await g.press('Space'); await sleep(100); await g.press('Space');
  await g.frames(2);
  t.check(await g.ev(() => BC.game.player.fly), 'double-tapping Space starts flying in Creative');
});

scenario('G', 'No pointer lock: drag-to-look, hold still to mine, menu button', async t => {
  const g = await t.open({ lock: false, initScripts: [{ fn: () => { HTMLCanvasElement.prototype.requestPointerLock = undefined; } }] });
  await g.boot();
  await g.createWorld({ name: 'Dragger', seed: '12345', cheats: true });
  let s = await g.ev(() => ({ hud: __e2e.hud(), locked: !!document.pointerLockElement, screen: BC.game.screen }));
  t.check(s.screen === 'play' && !s.locked, 'game plays without pointer lock', s);
  t.check(s.hud.menuBtn && s.hud.crosshair, 'drag-look mode shows the Menu button', s.hud);
  const spawn = await g.ev(() => BC.game.record.spawn);
  const gr = await g.ev(([x, z]) => __e2e.findGround(Math.floor(x), Math.floor(z), 0, 40, 2), [spawn[0], spawn[2]]);
  await g.teleport(gr.x, gr.y, gr.z, { yaw: 0, pitch: 0 });
  // Drag right: look turns right (yaw decreases).
  await g.page.mouse.move(400, 250);
  await g.page.mouse.down();
  await g.page.mouse.move(520, 250, { steps: 10 });
  await g.page.mouse.up();
  s = await g.snap();
  t.check(s.yaw < -0.2, 'dragging the mouse turns the camera', s.yaw);
  // Hold still on a block: after 200 ms the press becomes mining.
  const target = [gr.bx + 1, gr.y - 1, gr.bz];
  await g.aim(...target);
  const watch = await g.watch(...target, 8000);
  const t0 = await g.ev(() => __e2e.gameTime);
  await g.page.mouse.down();
  const r = await watch.result();
  await g.page.mouse.up();
  t.check(r.changed, 'holding the button still mines the block', r);
  if (r.changed) t.note(`hold-still mining of grass took ${(r.t - t0).toFixed(2)} s game time (0.2 s delay + 0.9 s)`);
  // Menu button → pause → switch to Creative (cheats) → back to game.
  await g.page.click('#menu-btn');
  await g.waitFor(() => BC.game.screen === 'pause', null, { msg: 'Menu button did not pause' });
  t.check(await g.page.isVisible('#btn-switch-mode') && (await g.page.textContent('#btn-switch-mode')) === 'Switch to Creative', 'pause menu offers Switch to Creative when cheats are on');
  await g.page.click('#btn-switch-mode');
  t.check((await g.ev(() => BC.game.state.mode)) === 'creative' && (await g.page.textContent('#btn-switch-mode')) === 'Switch to Survival', 'switched to Creative');
  await g.page.click('#btn-resume');
  await g.waitPlaying();
  // A short click (no drag) should attack once: in Creative that breaks the block instantly.
  const target2 = [gr.bx - 1, gr.y - 1, gr.bz];
  await g.aim(...target2);
  await g.page.mouse.move(400, 250);
  const watch2 = await g.watch(...target2, 1500);
  await g.page.mouse.down();
  await sleep(100);
  await g.page.mouse.up();
  const r2 = await watch2.result();
  t.check(r2.changed, 'a quick click (no drag) breaks the targeted block in Creative drag-look mode', r2);
  await g.shot('drag-mode');
});

scenario('H', 'Touch (Pixel 7): tap through menus, touch controls, inventory long-press split, joystick', async t => {
  const g = await t.open({ device: devices['Pixel 7'] });
  g.touch = true;
  await g.boot();
  await g.createWorld({ name: 'Pocket', seed: '12345' });
  let s = await g.ev(() => ({ hud: __e2e.hud(), fly: getComputedStyle(document.getElementById('t-fly')).display, screen: BC.game.screen }));
  t.check(s.screen === 'play' && s.hud.touch, 'touch controls are visible (#touch not hidden)', s);
  t.check(s.hud.menuBtn && s.fly === 'none', 'Menu button shown; Creative-only Fly button hidden in Survival', s);
  await g.shot('touch-hud');
  const cdp = await g.ctx.newCDPSession(g.page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const centre = async sel => { const b = await g.page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

  // Touch look: drag on the view.
  const yaw0 = (await g.snap()).yaw;
  await touch('touchStart', [{ x: 200, y: 300, id: 7 }]);
  for (let k = 1; k <= 6; k++) { await touch('touchMove', [{ x: 200 + k * 10, y: 300, id: 7 }]); await sleep(30); }
  await touch('touchEnd', []);
  t.check((await g.snap()).yaw < yaw0 - 0.2, 'swiping on the view turns the camera', { yaw0, yaw: (await g.snap()).yaw });

  // Items button opens the inventory; long-press splits a stack; tap places it.
  await g.ev(() => { BC.game.state.inv[0] = BC.items.make('dirt', 10); });
  await g.page.tap('#t-inv');
  await g.waitFor(() => BC.game.screen === 'inventory', null, { msg: 'tapping Items did not open the inventory' });
  const slot0 = await centre(g.slotSel('inv', 0));
  await touch('touchStart', [{ x: slot0.x, y: slot0.y, id: 1 }]);
  await sleep(700);
  await touch('touchEnd', []);
  s = await g.ev(() => ({ cursor: __e2e.snap().cursor, slot: __e2e.inv()[0] }));
  t.check(s.cursor?.count === 5 && s.slot?.count === 5, 'long-press on a slot picks up half the stack (right-click semantics)', s);
  await g.page.tap(g.slotSel('inv', 9));
  s = await g.ev(() => ({ cursor: __e2e.snap().cursor, slot: __e2e.inv()[9] }));
  t.check(!s.cursor && s.slot?.key === 'dirt' && s.slot.count === 5, 'tapping an empty slot puts the stack down', s);
  await g.shot('touch-inventory');
  await g.page.tap('#btn-inv-close');
  await g.waitPlaying();

  // Joystick: push up to walk forward along a flat track.
  const spawn = await g.ev(() => BC.game.record.spawn);
  const gr = await g.ev(([x, z]) => __e2e.findGround(Math.floor(x), Math.floor(z), 0, 40, 3), [spawn[0], spawn[2]]);
  await g.teleport(gr.x, gr.y, gr.z);
  const head = await g.ev(() => __e2e.flatHeading(3));
  t.assert(head, 'no flat track for the joystick test');
  await g.ev(h => { BC.game.player.yaw = h.yaw; BC.game.player.pitch = 0; }, head);
  const p0 = (await g.snap()).p;
  const joy = await centre('#joy');
  await touch('touchStart', [{ x: joy.x, y: joy.y, id: 3 }]);
  await touch('touchMove', [{ x: joy.x, y: joy.y - 60, id: 3 }]);
  await sleep(500);
  const knob = await g.ev(() => document.getElementById('knob').style.transform);
  await touch('touchEnd', []);
  const p1 = (await g.snap()).p;
  const fwd = (p1[0] - p0[0]) * head.dx + (p1[2] - p0[2]) * head.dz;
  t.check(/translate\(0px, -60px\)/.test(knob), 'joystick knob follows the finger', knob);
  t.check(fwd > 1, 'pushing the joystick forward walks the player forward', { moved: +fwd.toFixed(2) });

  // Mine button: hold to break the block in front.
  await g.teleport(gr.x, gr.y, gr.z);
  const tgt = [gr.bx + head.dx, gr.y - 1, gr.bz + head.dz];
  await g.aim(...tgt);
  const mine = await centre('#t-mine');
  const w = await g.watch(...tgt, 6000);
  await touch('touchStart', [{ x: mine.x, y: mine.y, id: 4 }]);
  const r = await w.result();
  await touch('touchEnd', []);
  t.check(r.changed, 'holding the Mine button breaks the block', r);
});

scenario('I', 'World generation across chunk borders: streaming, meshing, determinism, edits after unload', async t => {
  const g = await t.open();
  await g.boot();
  await g.createWorld({ name: 'Borders', mode: 'creative', seed: '12345' });
  await g.ev(() => { BC.game.player.fly = true; });
  const Y = 76;
  for (let x = -40; x <= 40; x += 8) {
    await g.teleport(x + 0.5, Y, 0.5, { ground: false });
    const ok = await g.ev(x => [-16, 0, 16].every(dx => [-16, 0, 16].every(dz => BC.game.world.chunkReady(x + dx, dz))), x);
    if (!ok) await g.waitFor(x => [-16, 0, 16].every(dx => [-16, 0, 16].every(dz => BC.game.world.chunkReady(x + dx, dz))), x, { timeout: 20000, msg: `chunks around x=${x} not meshed` });
  }
  t.check(await g.ev(() => BC.game.player.fly && BC.game.player.p.y > 70), 'still flying high after the teleport sweep');
  // Fly east across chunk borders with the keyboard.
  await g.teleport(-20.5, Y, 8.5, { yaw: -Math.PI / 2, pitch: 0, ground: false });
  const x0 = (await g.snap()).p[0];
  await g.page.keyboard.down('KeyW'); await sleep(3000); await g.page.keyboard.up('KeyW');
  const x1 = (await g.snap()).p[0];
  t.check(x1 - x0 > 16, 'flew across at least one chunk border with W', { x0, x1 });
  await g.waitFor(() => BC.game.world.chunkReady(BC.game.player.p.x, BC.game.player.p.z), null, { msg: 'chunk under the player never meshed after flying' });
  await g.shot('borders');
  // Terrain equals a fresh generator run, block for block, for untouched chunks on both sides of the borders.
  const CHUNKS = [[-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [-1, -1], [0, -1]];
  const cmp = chunks => {
    const W = BC.game.world, gen = BC.worldgen.create(1, BC.game.record.seed), IDX = BC.worldgen.IDX, out = { compared: 0, mism: [], skipped: [] };
    for (const [cx, cz] of chunks) {
      if (!W.hasChunk(cx * 16, cz * 16)) { out.skipped.push(cx + ',' + cz); continue; }
      const ed = W.edits.get(cx + ',' + cz), data = gen.generateChunk(cx, cz);
      for (let y = 0; y < 80; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const i = IDX(x, y, z); if (ed && ed.has(i)) continue;
        const a = W.getBlock(cx * 16 + x, y, cz * 16 + z); out.compared++;
        if (a !== data[i] && out.mism.length < 5) out.mism.push([cx * 16 + x, y, cz * 16 + z, a, data[i]]);
      }
    }
    return out;
  };
  let c = await g.ev(cmp, CHUNKS);
  t.check(c.skipped.length === 0 && c.compared === CHUNKS.length * 16 * 16 * 80 && c.mism.length === 0, 'getBlock matches worldgen.generateChunk across chunk borders', c);
  // Border edits re-mesh both neighbours and survive unloading.
  const edits = [[15, Y - 2, 3, 9], [16, Y - 2, 3, 13], [-1, Y - 2, -1, 19], [0, Y - 2, 0, 4]];
  const setOk = await g.ev(e => e.map(([x, y, z, id]) => BC.game.world.setBlock(x, y, z, id)), edits);
  t.check(setOk.every(Boolean), 'setBlock works on both sides of chunk borders', setOk);
  await g.frames(3);
  t.check(await g.ev(() => [[15, 3], [16, 3], [-1, -1], [0, 0], [-1, 0], [0, -1]].every(([x, z]) => BC.game.world.chunkReady(x, z))), 'chunks next to a border edit are re-meshed (ready)');
  await g.teleport(300.5, Y, 0.5, { ground: false });
  await g.waitFor(() => !BC.game.world.hasChunk(0, 0), null, { timeout: 20000, msg: 'far chunks were never unloaded' });
  await g.teleport(0.5, Y, 8.5, { ground: false });
  const back = await g.ev(e => e.map(([x, y, z]) => BC.game.world.getBlock(x, y, z)), edits);
  t.check(fmt(back) === fmt(edits.map(e => e[3])), 'border edits survive chunk unload and regeneration', back);
  c = await g.ev(cmp, CHUNKS);
  t.check(c.mism.length === 0 && c.skipped.length === 0, 'regenerated chunks still match the generator (apart from edits)', c);
});

main().catch(e => { console.error(e); process.exit(1); });
