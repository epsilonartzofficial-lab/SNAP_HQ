#!/usr/bin/env node
// Blockcraft world-systems end-to-end tests (Playwright + headless Chromium, software WebGL): light, torches,
// saplings, grass, falling blocks, day and night.
//
//   node tests/e2e-world.mjs            run every scenario
//   node tests/e2e-world.mjs A C        run only scenarios A and C
//
// Environment: E2E_SHOTS=<dir> for screenshots (default: <tmp>/blockcraft-e2e-world),
// PLAYWRIGHT_MODULE=<path> if Playwright is not resolvable from here (defaults to the global install).
// Worlds are created with BC.game.createWorld(); placing and breaking go through the game's own mouse handling
// (right-click places the held block with its placement rules, left-click breaks). Hooks on BC.game are used to set
// up positions, aim and inventories, and to read state.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const SHOTS = process.env.E2E_SHOTS || path.join(os.tmpdir(), 'blockcraft-e2e-world');
const LAUNCH_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const VIEWPORT = { width: 960, height: 600 };
const SCENARIO_TIMEOUT = 300000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = v => { try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return String(v); } };
class Failure extends Error {}

// ------------------------------------------------------------------ in-page helpers
function pageHelpers() {
  const H = (window.__w = {});
  H.frames = n => new Promise(res => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  H.eye = () => { const P = BC.game.player; return { x: P.p.x, y: P.p.y + (P.sneaking ? 1.27 : 1.62), z: P.p.z }; };
  H.aimPoint = (x, y, z) => {
    const e = H.eye(), P = BC.game.player, dx = x - e.x, dy = y - e.y, dz = z - e.z;
    P.yaw = Math.atan2(-dx, -dz);
    P.pitch = Math.max(-1.55, Math.min(1.55, Math.atan2(dy, Math.hypot(dx, dz))));
  };
  // Aim until the game's own raycast reports block (bx,by,bz), optionally on the given face.
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
  // Resolve when block (x,y,z) changes or after timeoutMs; with `release`, let that mouse button go at once.
  H.watchBlock = (x, y, z, timeoutMs, release) => new Promise(res => {
    const W = BC.game.world, id0 = W.getBlock(x, y, z), t0 = performance.now();
    const f = () => {
      const id = W.getBlock(x, y, z);
      if (id !== id0) { if (release != null) window.dispatchEvent(new MouseEvent('mouseup', { button: release })); return res({ changed: true, from: id0, id }); }
      if (performance.now() - t0 > timeoutMs) return res({ changed: false, from: id0, id });
      setTimeout(f, 5);
    };
    setTimeout(f, 5);
  });
  // Resolve when the expression (source) becomes true, or after timeoutMs; with `release`, let that button go at once.
  H.watchExpr = (src, timeoutMs, release) => new Promise(res => {
    const fn = new Function('return (' + src + ')'), t0 = performance.now();
    const f = () => {
      let v = false; try { v = fn(); } catch (e) { v = false; }
      if (v) { if (release != null) window.dispatchEvent(new MouseEvent('mouseup', { button: release })); return res({ changed: true }); }
      if (performance.now() - t0 > timeoutMs) return res({ changed: false });
      setTimeout(f, 5);
    };
    setTimeout(f, 5);
  });
  H.watches = {}; let wid = 0;
  H.watchE = (src, ms, rel) => { const id = ++wid; H.watches[id] = H.watchExpr(src, ms, rel); return id; };
  H.watch = (x, y, z, ms, rel) => { const id = ++wid; H.watches[id] = H.watchBlock(x, y, z, ms, rel); return id; };
  H.watchResult = id => H.watches[id].then(r => { delete H.watches[id]; return r; });
  H.hold = (key, n) => { const st = BC.game.state; st.inv[st.sel] = BC.items.make(key, n || 64); };
  // Mean colour of the rendered frame (centre region), read straight after rendering in this task.
  H.frameColor = () => {
    const R = BC.render, gl = R.renderer.getContext();
    R.render(false);
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, x0 = Math.floor(w * 0.2), y0 = Math.floor(h * 0.25), cw = Math.floor(w * 0.6), ch = Math.floor(h * 0.5);
    const px = new Uint8Array(cw * ch * 4);
    gl.readPixels(x0, y0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let r = 0, g = 0, b = 0; const n = cw * ch;
    for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
    r /= n; g /= n; b /= n;
    return { r, g, b, lum: 0.2126 * r + 0.7152 * g + 0.0722 * b };
  };
  // Average light baked into a chunk mesh's vertices inside a box (world coordinates): {sky, block} 0-15, vertex count.
  H.meshLight = (x0, y0, z0, x1, y1, z1) => {
    const W = BC.game.world; let n = 0, sky = 0, blk = 0;
    for (const ch of W.chunks.values()) {
      const m = ch.opaque; if (!m) continue;
      const P = m.geometry.attributes.position.array, L = m.geometry.attributes.aLight.array, ox = ch.cx * 16, oz = ch.cz * 16;
      for (let i = 0, v = 0; i < P.length; i += 3, v += 2) {
        const x = P[i] + ox, y = P[i + 1], z = P[i + 2] + oz;
        if (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) continue;
        n++; sky += L[v] / 17; blk += L[v + 1] / 17;
      }
    }
    return { n, sky: n ? sky / n : 0, block: n ? blk / n : 0 };
  };
  // A sealed stone room (interior x0..x0+sx-1 etc.) with a stone floor under y0.
  H.room = (x0, y0, z0, sx, sy, sz) => {
    const W = BC.game.world, S = BC.blocks.B.STONE;
    W.batch(() => {
      for (let x = -1; x <= sx; x++) for (let z = -1; z <= sz; z++) for (let y = -1; y <= sy; y++) {
        const inside = x >= 0 && x < sx && z >= 0 && z < sz && y >= 0 && y < sy;
        W.setBlock(x0 + x, y0 + y, z0 + z, inside ? 0 : S);
      }
    });
  };
  H.items = () => BC.game.entities.list.map(e => ({ key: BC.items.get(e.id).key, count: e.count, x: e.x, y: e.y, z: e.z }));
}

// ------------------------------------------------------------------ one browser context
class Game {
  constructor(t) { this.t = t; }
  static async open(t) {
    const ctx = await t.browser.newContext({ viewport: VIEWPORT });
    await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx.addInitScript(pageHelpers);
    const g = new Game(t); g.ctx = ctx;
    g.page = await ctx.newPage();
    g.page.on('pageerror', e => t.errors.push(`pageerror: ${e.message}`));
    g.page.on('console', m => { if (m.type() === 'error') t.errors.push(`console.error: ${m.text()}`); });
    return g;
  }
  ev(fn, arg) { return this.page.evaluate(fn, arg); }
  frames(n) { return this.ev(n => __w.frames(n), n); }
  async waitFor(fn, arg, { timeout = 20000, msg } = {}) {
    try { await this.page.waitForFunction(fn, arg, { timeout, polling: 50 }); }
    catch (e) { throw new Failure(`${msg || 'condition not met'} (after ${timeout} ms)`); }
  }
  async shot(name) { try { fs.mkdirSync(SHOTS, { recursive: true }); await this.page.screenshot({ path: path.join(SHOTS, `${this.t.sc.id}-${name}.png`) }); } catch { /* best effort */ } }
  async start(mode) {
    await this.page.goto(GAME_URL);
    await this.waitFor(() => window.BC && BC.game && BC.game.screen === 'title', null, { timeout: 30000, msg: 'title screen did not appear' });
    await this.ev(m => BC.game.createWorld({ name: 't', mode: m, seedText: '7' }), mode);
    await this.waitFor(() => BC.game.screen === 'play' && BC.game.world && BC.game.world.chunkReady(BC.game.player.p.x, BC.game.player.p.z), null, { timeout: 60000, msg: 'world did not start' });
    await this.page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    await this.frames(5);
  }
  // Put the player at (x, y, z) standing (or flying) and wait for the chunks there to be meshed.
  async teleport(x, y, z, { fly = false } = {}) {
    await this.ev(([x, y, z, fly]) => { const P = BC.game.player; P.p.set(x, y, z); P.v.set(0, 0, 0); P.fallDist = 0; P.fly = fly; }, [x, y, z, fly]);
    await this.waitFor(([x, z]) => [-16, 0, 16].every(d => BC.game.world.chunkReady(x + d, z) && BC.game.world.chunkReady(x, z + d)), [x, z], { timeout: 40000, msg: `chunks at ${x},${z} not ready` });
    await this.frames(3);
  }
  async aim(x, y, z, normal) {
    const r = await this.ev(([x, y, z, n]) => __w.aimBlock(x, y, z, n), [x, y, z, normal || null]);
    if (!r.ok) throw new Failure(`cannot aim at ${x},${y},${z}${normal ? ' face ' + normal : ''}: ray hits ${fmt(r.hit)}`);
    return r.hit;
  }
  // Right-click a face; resolves with what happened to the cell in front of it.
  async placeOn(x, y, z, normal) {
    await this.aim(x, y, z, normal);
    const [px, py, pz] = [x + normal[0], y + normal[1], z + normal[2]];
    const id = await this.ev(([x, y, z]) => __w.watch(x, y, z, 2500, 2), [px, py, pz]);
    await this.page.mouse.down({ button: 'right' });
    let r; try { r = await this.ev(id => __w.watchResult(id), id); } finally { await this.page.mouse.up({ button: 'right' }); }
    return { ...r, at: [px, py, pz] };
  }
  // Right-click a face and resolve when the expression (page source) holds.
  async useOn(x, y, z, normal, src) {
    await this.aim(x, y, z, normal);
    const id = await this.ev(([s]) => __w.watchE(s, 2500, 2), [src]);
    await this.page.mouse.down({ button: 'right' });
    let r; try { r = await this.ev(id => __w.watchResult(id), id); } finally { await this.page.mouse.up({ button: 'right' }); }
    return r;
  }
  // Hold the left button on a block until it breaks.
  async mine(x, y, z, timeout = 20000) {
    await this.aim(x, y, z);
    const id = await this.ev(([x, y, z, ms]) => __w.watch(x, y, z, ms, 0), [x, y, z, timeout]);
    await this.page.mouse.down({ button: 'left' });
    let r; try { r = await this.ev(id => __w.watchResult(id), id); } finally { await this.page.mouse.up({ button: 'left' }); }
    return r;
  }
  block(x, y, z) { return this.ev(([x, y, z]) => BC.game.world.getBlock(x, y, z), [x, y, z]); }
}

// ------------------------------------------------------------------ runner
const SCENARIOS = [];
const scenario = (id, title, fn) => SCENARIOS.push({ id, title, fn });
class Run {
  constructor(browser, sc) { this.browser = browser; this.sc = sc; this.fails = []; this.notes = []; this.errors = []; this.games = []; }
  check(cond, msg, detail) { if (!cond) this.fails.push(msg + (detail !== undefined ? ` [got ${fmt(detail)}]` : '')); return !!cond; }
  assert(cond, msg, detail) { if (!cond) throw new Failure(msg + (detail !== undefined ? ` [got ${fmt(detail)}]` : '')); }
  note(msg) { this.notes.push(msg); }
  async open() { const g = await Game.open(this); this.games.push(g); return g; }
}
async function runScenario(browser, sc) {
  const t = new Run(browser, sc), t0 = Date.now();
  let timer;
  try {
    const body = sc.fn(t); body.catch(() => {});
    await Promise.race([body, new Promise((_, rej) => { timer = setTimeout(() => rej(new Failure(`scenario timed out after ${SCENARIO_TIMEOUT / 1000} s`)), SCENARIO_TIMEOUT); })]);
  } catch (e) {
    t.fails.push((e instanceof Failure ? '' : 'exception: ') + (e && e.stack && !(e instanceof Failure) ? e.stack.split('\n').slice(0, 3).join(' | ') : e.message));
  } finally { clearTimeout(timer); }
  for (const g of t.games) {
    try {
      const banner = await g.page.evaluate(() => { const b = document.getElementById('banner'); return b && !b.hidden ? document.getElementById('banner-text').textContent : null; });
      if (banner) t.fails.push(`game error banner shown: ${banner}`);
    } catch { /* page gone */ }
    if (t.fails.length) await g.shot('FAIL');
  }
  if (t.errors.length) t.fails.push('page/console errors: ' + t.errors.slice(0, 8).join(' || '));
  for (const g of t.games) await g.ctx.close().catch(() => {});
  return { sc, ok: t.fails.length === 0, fails: t.fails, notes: t.notes, secs: (Date.now() - t0) / 1000 };
}
async function main() {
  const only = process.argv.slice(2).filter(a => !a.startsWith('--')).map(a => a.toUpperCase());
  const list = SCENARIOS.filter(s => !only.length || only.includes(s.id));
  console.log(`Blockcraft world-systems e2e: ${GAME_URL}\nScreenshots: ${SHOTS}\n`);
  let browser = await chromium.launch({ args: LAUNCH_ARGS });
  const results = [], T0 = Date.now();
  for (const sc of list) {
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

scenario('A', 'Torch in a dark cave: lights it across a chunk border, brightens the meshes; breaking it removes the light', async t => {
  const g = await t.open();
  await g.start('creative');
  // A sealed room underground whose interior straddles a chunk border (x = 16k).
  const R = await g.ev(() => {
    const W = BC.game.world, p = BC.game.player.p, bx = (Math.floor(p.x) >> 4) * 16 + 16, z0 = Math.floor(p.z) - 3;
    const y0 = Math.max(6, W.surfaceY(bx, z0 + 3) - 14), x0 = bx - 4;
    __w.room(x0, y0, z0, 9, 4, 7);
    return { x0, y0, z0, border: bx };
  });
  await g.teleport(R.x0 + 1.5, R.y0, R.z0 + 1.5);
  await g.ev(r => { __w.aimPoint(r.x0 + 6, r.y0 + 0.5, r.z0 + 5); }, R);
  await g.frames(4);
  const dark = await g.ev(r => ({ sky: BC.game.world.getSkyLight(r.x0 + 4, r.y0 + 1, r.z0 + 3), block: BC.game.world.getBlockLight(r.x0 + 4, r.y0 + 1, r.z0 + 3), frame: __w.frameColor(),
    mesh: __w.meshLight(r.x0, r.y0, r.z0, r.x0 + 9, r.y0 + 4, r.z0 + 7) }), R);
  t.check(dark.sky === 0 && dark.block === 0, 'the sealed room is dark (sky 0, block 0)', dark);
  await g.shot('dark-room');

  // Place a torch on the floor right at the chunk border (first cell of the next chunk).
  await g.ev(() => __w.hold('torch'));
  const tx = R.border, tz = R.z0 + 3;
  const placed = await g.placeOn(tx, R.y0 - 1, tz, [0, 1, 0]);
  t.assert(placed.changed && placed.id === (await g.ev(() => BC.blocks.B.TORCH)), 'right-click on the floor places a standing torch', placed);
  const lit = await g.ev(([x, y, z]) => { const W = BC.game.world; return { at: W.getBlockLight(x, y, z), w1: W.getBlockLight(x - 1, y, z), e1: W.getBlockLight(x + 1, y, z), w3: W.getBlockLight(x - 3, y, z), up2: W.getBlockLight(x, y + 2, z), d: W.getBlockLight(x - 3, y + 1, z + 2) }; }, [tx, R.y0, tz]);
  t.check(lit.at === 14 && lit.w1 === 13 && lit.e1 === 13 && lit.w3 === 11 && lit.up2 === 12 && lit.d === 8, 'block light 14 at the torch, -1 per block, the same on both sides of the chunk border', lit);
  // Both chunks' meshes pick up the light (the neighbour's through the deferred re-mesh), without a seam.
  await g.waitFor(r => { const W = BC.game.world; return [...W.chunks.values()].every(c => !c.remesh || Math.abs(c.cx * 16 - r.border) > 40); }, R, { msg: 'light re-mesh never finished' });
  await g.frames(3);
  const bright = await g.ev(r => ({ frame: __w.frameColor(), west: __w.meshLight(r.x0, r.y0, r.z0, r.border - 0.01, r.y0 + 4, r.z0 + 7), east: __w.meshLight(r.border + 0.01, r.y0, r.z0, r.x0 + 9, r.y0 + 4, r.z0 + 7) }), R);
  t.check(bright.west.block > 5 && bright.east.block > 5, 'vertices on both sides of the border carry the torch light', bright);
  t.check(Math.abs(bright.west.block - bright.east.block) < 2.5, 'light is continuous across the border (similar averages on both sides)', bright);
  t.check(bright.frame.lum > dark.frame.lum * 2 + 8, 'the rendered room is clearly brighter with the torch', { dark: dark.frame, lit: bright.frame });
  t.check(bright.frame.r > bright.frame.b * 1.15, 'torch light is warm (more red than blue)', bright.frame);
  await g.shot('torch-lit');

  // A wall torch: right-click the side of the west wall.
  const wall = await g.placeOn(R.x0 - 1, R.y0 + 1, R.z0 + 5, [1, 0, 0]);
  t.check(wall.changed && wall.id === (await g.ev(() => BC.blocks.B.WALL_TORCH_EAST)), 'right-click on a wall places a wall torch facing away from it', wall);
  t.check(await g.ev(r => BC.game.world.getBlockLight(r.x0, r.y0 + 1, r.z0 + 5) === 14, R), 'the wall torch gives light 14');
  // Clicking the ceiling puts the torch on the floor below instead, as in the reference game... unless there is none.
  await g.frames(3);
  await g.shot('wall-torch');

  // Break both torches: every bit of block light goes away and the room is dark again.
  for (const [x, y, z] of [[tx, R.y0, tz], [R.x0, R.y0 + 1, R.z0 + 5]]) {
    await g.ev(() => { const st = BC.game.state; st.inv[st.sel] = null; });
    const r = await g.mine(x, y, z, 8000);
    t.check(r.changed && r.id === 0, `left-click breaks the torch at ${x},${y},${z}`, r);
  }
  const after = await g.ev(r => {
    const W = BC.game.world; let max = 0;
    for (let x = r.x0 - 1; x <= r.x0 + 9; x++) for (let y = r.y0 - 1; y <= r.y0 + 4; y++) for (let z = r.z0 - 1; z <= r.z0 + 7; z++) max = Math.max(max, W.getBlockLight(x, y, z));
    return { max };
  }, R);
  t.check(after.max === 0, 'breaking the torches removes all block light', after);
  await g.waitFor(() => [...BC.game.world.chunks.values()].every(c => !c.remesh || c.dirty), null, { msg: 'dark re-mesh never finished' });
  await g.frames(3);
  const dark2 = await g.ev(r => ({ frame: __w.frameColor(), mesh: __w.meshLight(r.x0, r.y0, r.z0, r.x0 + 9, r.y0 + 4, r.z0 + 7) }), R);
  t.check(dark2.mesh.block === 0 && dark2.frame.lum < dark.frame.lum + 6, 'meshes and the rendered room are dark again', { before: dark.frame, after: dark2.frame, mesh: dark2.mesh });
  const perf = await g.ev(() => ({ light: BC.game.world.light.stats, mesh: BC.render.stats }));
  t.note(`light ${(perf.light.chunkMs / perf.light.chunks).toFixed(2)} ms/chunk over ${perf.light.chunks} chunks, ${(perf.light.updateMs / Math.max(1, perf.light.updates)).toFixed(3)} ms/edit; mesh ${(perf.mesh.meshMs / perf.mesh.meshes).toFixed(2)} ms/chunk`);
});

scenario('B', 'Survival: a torch drops when its support is mined or removed; sand landing on a torch drops as an item', async t => {
  const g = await t.open();
  await g.start('survival');
  // A dirt block standing on the ground next to the player; a wall torch goes on its east face.
  const S = await g.ev(() => {
    const W = BC.game.world, p = BC.game.player.p, x = Math.floor(p.x) + 2, z = Math.floor(p.z);
    const y = W.surfaceY(x, z);
    W.batch(() => {
      for (let dx = -3; dx <= 5; dx++) for (let dz = -3; dz <= 3; dz++) {
        for (let h = 0; h < 6; h++) W.setBlock(x + dx, y + h, z + dz, 0);
        W.setBlock(x + dx, y - 1, z + dz, BC.blocks.B.STONE);
      }
      W.setBlock(x, y, z, BC.blocks.B.DIRT);
    });
    return { x, y, z };
  });
  await g.teleport(S.x - 1.5, S.y, S.z + 2.5);
  await g.ev(() => __w.hold('torch', 8));
  const w = await g.placeOn(S.x, S.y, S.z, [0, 0, 1]);
  t.assert(w.changed && w.id === (await g.ev(() => BC.blocks.B.WALL_TORCH_SOUTH)), 'a wall torch is placed on the side of the dirt block', w);
  const invAfter = await g.ev(() => BC.game.state.inv[BC.game.state.sel].count);
  t.check(invAfter === 7, 'placing used one torch from the stack', invAfter);
  // Mine the dirt by hand: the torch loses its support and pops off as an item.
  await g.ev(() => { const st = BC.game.state; st.sel = 1; st.inv[1] = null; });
  const m = await g.mine(S.x, S.y, S.z);
  t.check(m.changed && m.id === 0, 'the supporting dirt is mined', m);
  await g.frames(3);
  const pop = await g.ev(s => ({ torch: BC.game.world.getBlock(s.x, s.y, s.z + 1), items: __w.items() }), S);
  t.check(pop.torch === 0, 'the wall torch is gone once its support is mined', pop);
  t.check(pop.items.some(e => e.key === 'torch' && Math.abs(e.x - (S.x + 0.5)) < 2.5) && pop.items.some(e => e.key === 'dirt'), 'the torch and the dirt drop as items', pop.items);

  // A standing torch on a block that is removed by world logic (not the player) also drops.
  const s2 = { x: S.x + 3, y: S.y, z: S.z };
  await g.ev(s => { const W = BC.game.world; W.setBlock(s.x, s.y, s.z, BC.blocks.B.DIRT); W.setBlock(s.x, s.y + 1, s.z, BC.blocks.B.TORCH); W.setBlock(s.x, s.y, s.z, 0); }, s2);
  const pop2 = await g.ev(s => ({ torch: BC.game.world.getBlock(s.x, s.y + 1, s.z), n: __w.items().filter(e => e.key === 'torch').length }), s2);
  t.check(pop2.torch === 0 && pop2.n >= 2, 'a standing torch drops when the block under it disappears', pop2);

  // Sand falling onto a torch breaks into an item and leaves the torch in place.
  const s3 = { x: S.x + 4, y: S.y, z: S.z - 2 };
  await g.ev(s => { const W = BC.game.world; W.setBlock(s.x, s.y, s.z, BC.blocks.B.TORCH); W.setBlock(s.x, s.y + 4, s.z, BC.blocks.B.SAND); }, s3);
  t.check(await g.ev(() => BC.game.world.falling.length === 1), 'sand placed in the air starts falling');
  await g.waitFor(() => BC.game.world.falling.length === 0, null, { msg: 'sand never landed' });
  const hit = await g.ev(s => ({ torch: BC.game.world.getBlock(s.x, s.y, s.z), above: BC.game.world.getBlock(s.x, s.y + 1, s.z), sand: __w.items().filter(e => e.key === 'sand').length }), s3);
  t.check(hit.torch === (await g.ev(() => BC.blocks.B.TORCH)) && hit.above === 0 && hit.sand === 1, 'sand that lands on a torch drops as an item; the torch stays', hit);
  await g.shot('drops');
});

scenario('C', 'Saplings: placement rules, growth into an oak with enough light (not in the dark); grass spreads and dies', async t => {
  const g = await t.open();
  await g.start('creative');
  const S = await g.ev(() => {
    const W = BC.game.world, B = BC.blocks.B, p = BC.game.player.p, x = Math.floor(p.x) + 3, z = Math.floor(p.z);
    const y = W.surfaceY(x, z);
    W.batch(() => {
      for (let dx = -4; dx <= 6; dx++) for (let dz = -5; dz <= 5; dz++) {
        for (let h = 0; h < 12; h++) W.setBlock(x + dx, y + h, z + dz, 0);
        W.setBlock(x + dx, y - 1, z + dz, B.GRASS_BLOCK); W.setBlock(x + dx, y - 2, z + dz, B.DIRT);
      }
      W.setBlock(x + 2, y - 1, z, B.STONE);
    });
    return { x, y, z };
  });
  await g.teleport(S.x - 0.5, S.y, S.z + 2.5);
  await g.ev(() => __w.hold('oak_sapling'));
  const onStone = await g.placeOn(S.x + 2, S.y - 1, S.z, [0, 1, 0]);
  t.check(!onStone.changed, 'a sapling cannot be planted on stone', onStone);
  const onGrass = await g.placeOn(S.x, S.y - 1, S.z, [0, 1, 0]);
  t.assert(onGrass.changed && onGrass.id === (await g.ev(() => BC.blocks.B.OAK_SAPLING)), 'a sapling is planted on grass', onGrass);
  t.check(await g.ev(s => BC.game.world.getLight(s.x, s.y + 1, s.z) >= 9, S), 'the sapling stands in daylight (light >= 9)');
  await g.frames(3);
  await g.shot('sapling');
  await g.teleport(S.x - 3.5, S.y, S.z + 4.5);
  // Random ticks: with a roll of 0 the growth chance passes and the tree takes the shortest (4-log) shape.
  const grown = await g.ev(s => { const W = BC.game.world; W.randomTickAt(s.x, s.y, s.z, () => 0); const col = []; for (let y = s.y - 1; y <= s.y + 5; y++) col.push(W.getBlock(s.x, y, s.z)); return { col, leaf: W.getBlock(s.x + 1, s.y + 3, s.z), top: W.getBlock(s.x, s.y + 4, s.z) }; }, S);
  const B = await g.ev(() => BC.blocks.B);
  t.check(grown.col[0] === B.DIRT && grown.col.slice(1, 5).every(id => id === B.OAK_LOG) && grown.leaf === B.OAK_LEAVES && grown.top === B.OAK_LEAVES, 'the sapling grows into an oak: dirt, 4 logs, leaf crown', grown);
  await g.frames(4);
  await g.shot('tree');
  // In a sealed dark room a sapling never grows, however lucky the roll.
  const dark = await g.ev(s => {
    const W = BC.game.world, B = BC.blocks.B, x0 = s.x - 10, y0 = Math.max(6, s.y - 16), z0 = s.z;
    __w.room(x0, y0, z0, 3, 3, 3);
    W.setBlock(x0 + 1, y0 - 1, z0 + 1, B.DIRT); W.setBlock(x0 + 1, y0, z0 + 1, B.OAK_SAPLING);
    for (let k = 0; k < 50; k++) W.randomTickAt(x0 + 1, y0, z0 + 1, () => 0);
    return { id: W.getBlock(x0 + 1, y0, z0 + 1), light: W.getLight(x0 + 1, y0 + 1, z0 + 1) };
  }, S);
  t.check(dark.id === B.OAK_SAPLING && dark.light < 9, 'a sapling in the dark does not grow', dark);
  // Leaves drop saplings (1/20 in the reference game).
  const drops = await g.ev(() => { const B = BC.blocks.B, v = [0.9, 0.9, 0.01]; let i = 0; return BC.blocks.drops(B.OAK_LEAVES, true, () => v[i++]); });
  t.check(drops.some(d => d.key === 'oak_sapling'), 'leaves can drop a sapling', drops);
  // Grass: dirt next to lit grass turns green; grass under a stone block turns to dirt.
  const grass = await g.ev(s => {
    const W = BC.game.world, B = BC.blocks.B, gx = s.x + 4, gy = s.y - 1, gz = s.z + 3;
    W.setBlock(gx + 1, gy, gz, B.DIRT);
    const seq = [0.9, 0.7, 0.5]; let i = 0;
    W.randomTickAt(gx, gy, gz, () => seq[i++ % 3]);
    const spread = W.getBlock(gx + 1, gy, gz);
    W.setBlock(gx, gy + 1, gz, B.STONE);
    W.randomTickAt(gx, gy, gz, () => 0.5);
    return { spread, covered: W.getBlock(gx, gy, gz) };
  }, S);
  t.check(grass.spread === B.GRASS_BLOCK, 'grass spreads to dirt beside it in daylight', grass);
  t.check(grass.covered === B.DIRT, 'grass covered by an opaque block turns to dirt', grass);
});

scenario('D', 'Falling sand: falls when unsupported, lands and re-places itself; a column stacks up; saving mid-fall keeps it', async t => {
  const g = await t.open();
  await g.start('creative');
  const S = await g.ev(() => {
    const W = BC.game.world, B = BC.blocks.B, p = BC.game.player.p, x = Math.floor(p.x) + 3, z = Math.floor(p.z);
    const y = W.surfaceY(x, z);
    W.batch(() => {
      for (let dx = -3; dx <= 6; dx++) for (let dz = -3; dz <= 3; dz++) {
        for (let h = 0; h < 10; h++) W.setBlock(x + dx, y + h, z + dz, 0);
        W.setBlock(x + dx, y - 1, z + dz, B.STONE);
      }
      for (let h = 0; h < 4; h++) W.setBlock(x, y + h, z, B.STONE);                 // a pillar
      for (let h = 0; h < 2; h++) W.setBlock(x + 3, y + h, z, B.STONE);             // a short one holding a sand column
      for (let h = 2; h < 5; h++) W.setBlock(x + 3, y + h, z, B.SAND);
    });
    return { x, y, z };
  });
  t.check(await g.ev(s => BC.game.world.getBlock(s.x + 3, s.y + 4, s.z) === BC.blocks.B.SAND && BC.game.world.falling.length === 0, S), 'supported sand stays put');
  await g.teleport(S.x + 2.5, S.y, S.z + 3.5);
  await g.ev(() => __w.hold('sand'));
  // Right-click the side of the pillar top: the sand has nothing under it and falls at once.
  const p = await g.useOn(S.x, S.y + 3, S.z, [1, 0, 0], 'BC.game.world.falling.length > 0');
  const cell = [S.x + 1, S.y + 3, S.z];
  const mid = await g.ev(([x, y, z]) => {
    const W = BC.game.world, f = W.falling[0], packed = W.packEdits(), k = (x >> 4) + ',' + (z >> 4), land = BC.worldgen.IDX(x & 15, y - 3, z & 15);
    const arr = packed[k] || []; let saved = null; for (let i = 0; i + 1 < arr.length; i += 2) if (arr[i] === land) saved = arr[i + 1];
    return { falling: W.falling.length, id: f && f.id, at: W.getBlock(x, y, z), saved };
  }, cell);
  const SAND = await g.ev(() => BC.blocks.B.SAND);
  t.check(p.changed && mid.falling === 1 && mid.id === SAND && mid.at === 0, 'placed sand with air below turns into a falling block', { p, mid });
  t.check(mid.saved === SAND, 'saving while it falls stores the sand where it will land (never lost or duplicated)', mid);
  await g.frames(2);
  await g.shot('falling');
  await g.waitFor(() => BC.game.world.falling.length === 0, null, { msg: 'sand never landed' });
  const landed = await g.ev(([x, y, z]) => [BC.game.world.getBlock(x, y - 3, z), BC.game.world.getBlock(x, y, z)], cell);
  t.check(landed[0] === SAND && landed[1] === 0, 'the sand lands on the ground and becomes a block again', landed);
  // Remove the short pillar under the sand column: all three fall and stack up again.
  await g.ev(s => { const W = BC.game.world; W.setBlock(s.x + 3, s.y + 1, s.z, 0); W.setBlock(s.x + 3, s.y, s.z, 0); }, S);
  t.check(await g.ev(() => BC.game.world.falling.length === 3), 'removing the support makes the whole column fall');
  await g.waitFor(() => BC.game.world.falling.length === 0, null, { msg: 'sand column never landed' });
  const col = await g.ev(s => [0, 1, 2, 3, 4].map(h => BC.game.world.getBlock(s.x + 3, s.y + h, s.z)), S);
  t.check(col.join() === [SAND, SAND, SAND, 0, 0].join(), 'the column stacks up on the ground (3 sand, nothing lost)', col);
  await g.shot('landed');
});

scenario('E', 'Day and night: the same meshes render darker and bluer at night (no re-mesh); items and the held block take local light', async t => {
  const g = await t.open();
  await g.start('creative');
  const pos = await g.ev(() => { const [x, z] = BC.game.world.gen.findSpawn(); return { x, z, y: BC.game.world.surfaceY(x, z) }; });
  await g.teleport(pos.x + 0.5, pos.y + 5, pos.z + 0.5, { fly: true });
  await g.ev(() => { BC.game.player.yaw = 0.6; BC.game.player.pitch = -0.3; });
  await g.frames(10);
  const r = await g.ev(() => {
    const R = BC.render, W = BC.game.world, cam = R.camera.position;
    const ids = () => [...W.chunks.values()].map(c => c.opaque ? c.opaque.geometry.id : 0).join();
    const before = ids();
    R.updateSky(0.25, 0, false, W.rd); const day = __w.frameColor();
    R.updateSky(0.75, 0, false, W.rd); const night = __w.frameColor();
    R.updateSky(0.25, 0, false, W.rd);
    return { day, night, same: before === ids(), cam: [cam.x, cam.y, cam.z] };
  });
  t.check(r.night.lum < r.day.lum * 0.6, 'the world is much darker at night', r);
  t.check(r.night.lum > 6, 'night is dark but readable (not black)', r.night);
  t.check(r.night.b > r.night.r, 'moonlight is blue-ish', r.night);
  t.check(r.same, 'day and night need no re-mesh (same geometry)');
  t.check(await g.ev(() => Math.abs(BC.lighting.skyLevel(0.25) - 15) + Math.abs(BC.lighting.skyLevel(0.75) - 4)) === 0, 'sky light level for spawning rules: 15 at noon, 4 at midnight');
  // Items: one dropped under the open sky and one in a sealed dark room; the held block follows the player.
  const it = await g.ev(p => {
    const W = BC.game.world, E = BC.game.entities, x0 = p.x + 6, y0 = Math.max(6, p.y - 16), z0 = p.z;
    __w.room(x0, y0, z0, 3, 3, 3);
    E.spawn(BC.items.make('cobblestone', 1), x0 + 1.5, y0 + 0.2, z0 + 1.5, 0, 0, 0, 5);
    E.spawn(BC.items.make('cobblestone', 1), p.x + 2.5, p.y + 0.2, p.z + 0.5, 0, 0, 0, 5);
    return { x0, y0, z0 };
  }, pos);
  await g.frames(4);
  const cols = await g.ev(() => BC.game.entities.list.map(e => e.mesh ? e.mesh.material.color.r : null));
  t.check(cols.length === 2 && cols[0] < 0.2 && cols[1] > 0.8, 'a dropped item is dark in a sealed room and bright in daylight', cols);
  await g.ev(() => { const st = BC.game.state; st.inv[st.sel] = BC.items.make('stone', 1); });
  await g.teleport(it.x0 + 1.5, it.y0, it.z0 + 1.5);
  await g.frames(40);
  const held = await g.ev(() => BC.render.heldLight.slice());
  t.check(held[0] < 0.2, 'the held block is dark in a dark room', held);
  await g.teleport(pos.x + 0.5, pos.y + 5, pos.z + 0.5, { fly: true });
  await g.shot('day');
});

main().catch(e => { console.error(e); process.exit(1); });
