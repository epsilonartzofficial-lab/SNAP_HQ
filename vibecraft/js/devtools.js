'use strict';
// Developer toolkit: a command console (/ or T), a dev panel (F4), an inspector overlay and chunk borders.
// Commands are a registry (BC.dev.command) so later stages can add their own, e.g. /summon for creatures.
// Everything here works only in worlds with cheats on, or everywhere when Developer mode is on in Settings.
(function (root) {
  const BC = root.BC, G = BC.game, U = BC.ui, IT = BC.items, R = BC.render;
  const { DEFS, SOLID, LIQUID } = BC.blocks;
  const { CS, WH } = BC.C;
  const $ = id => document.getElementById(id);

  // ---------------------------------------------------------------- DOM
  const app = $('app');
  app.insertAdjacentHTML('beforeend', `
    <div id="dev-chat" aria-live="polite"></div>
    <section id="scr-console" class="dev-console" hidden aria-label="Command console">
      <div id="dev-log" role="log"></div>
      <div id="dev-suggest"></div>
      <div class="dev-input-row"><span aria-hidden="true">&gt;</span><input id="dev-input" autocomplete="off" spellcheck="false" aria-label="Command"></div>
    </section>
    <section id="scr-devpanel" class="dev-panel" hidden aria-labelledby="devpanel-h">
      <div class="dev-head"><h2 id="devpanel-h">Dev toolkit</h2><button class="btn small" id="dev-close" type="button">Close</button></div>
      <div class="dev-tabs" role="tablist" id="dev-tabs"></div>
      <div id="dev-body"></div>
      <p class="meta">Every button runs a console command, shown in the log. Press / or T in game to type commands, F4 for this panel.</p>
    </section>
    <div id="dev-inspector" hidden></div>`);
  const chat = $('dev-chat'), logBox = $('dev-log'), input = $('dev-input'), suggest = $('dev-suggest');

  // ---------------------------------------------------------------- log
  const lines = [];
  function log(text, kind) {
    for (const t of String(text).split('\n')) lines.push({ t, kind: kind || 'out', at: performance.now() });
    while (lines.length > 200) lines.shift();
    renderLog();
  }
  function renderLog() {
    const mk = l => { const d = document.createElement('div'); d.className = 'dev-line ' + l.kind; d.textContent = l.t; return d; };
    logBox.replaceChildren(...lines.slice(-60).map(mk));
    logBox.scrollTop = logBox.scrollHeight;
    const recent = lines.filter(l => performance.now() - l.at < 7000).slice(-8);
    chat.replaceChildren(...recent.map(mk));
  }
  setInterval(() => { if (chat.childElementCount) renderLog(); }, 1000);

  // ---------------------------------------------------------------- command registry
  const CMDS = {};
  // spec: { usage, help, args: [completer...], run(args) → string | string[] | void, noWorld }
  function command(name, spec) { CMDS[name] = spec; }
  const W = () => G.world;
  const P = () => G.player;
  class CmdError extends Error {}
  const fail = msg => { throw new CmdError(msg); };
  function coord(tok, base, name) {
    if (tok == null) fail(`Missing ${name} coordinate`);
    if (tok.startsWith('~')) { const r = tok.slice(1); const v = r ? Number(r) : 0; if (!isFinite(v)) fail(`Bad ${name}: ${tok}`); return base + v; }
    const v = Number(tok); if (!isFinite(v)) fail(`Bad ${name}: ${tok}`); return v;
  }
  const onOff = (tok, cur) => (tok == null ? !cur : tok === 'on' || tok === 'true' || tok === '1' ? true : tok === 'off' || tok === 'false' || tok === '0' ? false : fail('Use on or off'));
  const blockByName = k => { const d = BC.blocks.BY_KEY[k]; if (!d && k !== 'air') fail(`Unknown block "${k}". Press Tab for names.`); return d ? d.id : 0; };
  const fmt = n => (Math.round(n * 10) / 10).toString();

  function exec(line) {
    const text = line.trim().replace(/^\//, '');
    if (!text) return;
    log('> /' + text, 'cmd');
    remember('/' + text);
    const [name, ...args] = text.split(/\s+/);
    const spec = CMDS[name.toLowerCase()];
    if (!spec) { log(`Unknown command "${name}". Type /help for the list.`, 'err'); return; }
    if (!spec.noWorld && !G.record) { log('Open a world first.', 'err'); return; }
    if (!spec.noWorld && !G.dev.allowed()) { log('Commands need cheats enabled for this world, or Developer mode in Settings.', 'err'); return; }
    try {
      const out = spec.run(args);
      if (out) log(Array.isArray(out) ? out.join('\n') : out, 'ok');
    } catch (e) {
      if (e instanceof CmdError) log(e.message + (spec.usage ? `\nUsage: /${name} ${spec.usage}` : ''), 'err');
      else { log('Command failed: ' + e.message, 'err'); console.error(e); }
    }
  }

  // ---------------------------------------------------------------- commands
  const itemKeys = () => IT.all().map(d => d.key);
  const blockKeys = () => ['air'].concat(BC.blocks.ids().map(id => DEFS[id].key));
  const biomeKeys = () => (W() && W().gen.biomes ? W().gen.biomes.map(b => b.key) : []);

  command('help', { usage: '[command]', noWorld: true, args: [() => Object.keys(CMDS)], help: 'List commands or show one command.',
    run([n]) {
      if (n) { const c = CMDS[n.replace(/^\//, '')]; if (!c) fail('No such command: ' + n); return `/${n} ${c.usage || ''}\n  ${c.help}`; }
      return ['Commands (Tab completes names and arguments):'].concat(Object.keys(CMDS).sort().map(k => `/${k} ${CMDS[k].usage || ''} · ${CMDS[k].help}`));
    } });
  command('gamemode', { usage: '<survival|creative>', args: [() => ['survival', 'creative']], help: 'Switch game mode.',
    run([m]) {
      const mode = { s: 'survival', survival: 'survival', 0: 'survival', c: 'creative', creative: 'creative', 1: 'creative' }[m];
      if (!mode) fail('Choose survival or creative');
      G.setMode(mode); return 'Game mode set to ' + mode;
    } });
  const TIME_WORDS = { sunrise: 0, day: 1000 / 24000, noon: 0.25, sunset: 0.5, night: 13000 / 24000, midnight: 0.75 };
  const clock = t => { const h = (t * 24 + 6) % 24; return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`; };
  command('time', { usage: '<set|add|query|speed|freeze|unfreeze> [value]', help: 'Time of day: /time set noon, /time set 18:30, /time set 6000 (ticks), /time speed 4.',
    args: [() => ['set', 'add', 'query', 'speed', 'freeze', 'unfreeze'], () => Object.keys(TIME_WORDS)],
    run([op, v]) {
      if (op === 'query' || !op) return `It is ${clock(G.dev.time)} (tick ${Math.round(G.dev.time * 24000)}). Day length ${fmt(10 / G.dev.timeScale)} min${G.dev.freezeTime ? ', frozen' : ''}.`;
      if (op === 'freeze' || op === 'unfreeze') { G.dev.freezeTime = op === 'freeze'; return op === 'freeze' ? 'Time frozen' : 'Time runs again'; }
      if (op === 'speed') { const x = Number(v); if (!(x > 0 && x <= 100)) fail('Speed must be between 0.01 and 100'); G.dev.timeScale = x; return `Time runs ${x}× (a day lasts ${fmt(10 / x)} min)`; }
      let t;
      if (v in TIME_WORDS) t = TIME_WORDS[v];
      else if (/^\d{1,2}:\d{2}$/.test(v || '')) { const [h, m] = v.split(':').map(Number); t = (((h + m / 60 - 6) / 24) % 1 + 1) % 1; }
      else if (v != null && isFinite(Number(v))) t = Number(v) / 24000;
      else fail('Give a time: sunrise, day, noon, sunset, night, midnight, HH:MM or ticks (0–24000)');
      if (op === 'set') G.dev.time = t; else if (op === 'add') G.dev.time = G.dev.time + t; else fail('Unknown time action ' + op);
      return 'Time is now ' + clock(G.dev.time);
    } });
  command('daylength', { usage: '<minutes>', help: 'Length of a full day and night (default 10).',
    run([m]) { const x = Number(m); if (!(x >= 0.1 && x <= 600)) fail('Minutes between 0.1 and 600'); G.dev.timeScale = 10 / x; return `A day now lasts ${fmt(x)} min`; } });

  function findCave(radius) {
    const w = W(), p = P().p, px = Math.floor(p.x), pz = Math.floor(p.z);
    let best = null, bestD = Infinity;
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      const x = px + dx, z = pz + dz;
      if (!w.hasChunk(x, z)) continue;
      const top = w.surfaceY(x, z);
      for (let y = top - 6; y > 3; y--) {
        if (w.getBlock(x, y, z) === 0 && w.getBlock(x, y + 1, z) === 0 && SOLID[w.getBlock(x, y - 1, z)] && !LIQUID[w.getBlock(x, y, z)]) {
          const d = dx * dx + dz * dz + (y - p.y) * (y - p.y) * 0.25;
          if (d < bestD) { bestD = d; best = [x + 0.5, y, z + 0.5]; }
          break;
        }
      }
    }
    return best;
  }
  function doLocate(kind, key) {
    const w = W(), p = P().p;
    if (kind === 'cave') { const c = findCave(64); if (!c) fail('No cave found within 64 blocks of loaded terrain'); return c; }
    if (kind === 'biome') {
      if (!w.gen.locate) fail('This world uses the Classic generator, which has no biomes. Create a world with the Biomes generator.');
      if (!key) fail('Name a biome. Press Tab for the list.');
      if (!biomeKeys().includes(key)) fail(`Unknown biome "${key}"`);
      const r = w.gen.locate(key, Math.floor(p.x), Math.floor(p.z), 4000);
      if (!r) fail(`No ${key} found within 4000 blocks`);
      return [r[0] + 0.5, null, r[1] + 0.5];
    }
    if (kind === 'spawn') { const s = G.record.spawn; return [s[0], null, s[2]]; }
    fail('Locate what? cave, biome <name> or spawn');
  }
  function place(x, y, z) {
    const w = W();
    if (y == null) { G.dev.teleport(x, 70, z); y = G.dev.surfaceY(x, z); }
    G.dev.teleport(x, y, z);
    return `Teleported to ${fmt(x)} ${fmt(y)} ${fmt(z)}${w.gen.sample ? ' · ' + biomeName(x, z) : ''}`;
  }
  command('locate', { usage: '<cave|biome <name>|spawn>', args: [() => ['cave', 'biome', 'spawn'], biomeKeys], help: 'Find the nearest cave, biome or the world spawn (does not move you).',
    run([kind, key]) { const r = doLocate(kind, key); const d = Math.hypot(r[0] - P().p.x, r[2] - P().p.z); return `Found at ${fmt(r[0])} ${r[1] == null ? '~' : fmt(r[1])} ${fmt(r[2])} (${Math.round(d)} blocks away). Use /tp ${kind}${key ? ' ' + key : ''} to go.`; } });
  command('tp', { usage: '<x> <y> <z> | spawn | cave | surface | biome <name>', args: [() => ['spawn', 'cave', 'surface', 'biome'], biomeKeys],
    help: 'Teleport. ~ means relative, e.g. /tp ~ ~10 ~.',
    run(a) {
      const p = P().p;
      if (a[0] === 'surface') return place(p.x, null, p.z);
      if (a[0] === 'spawn' || a[0] === 'cave' || a[0] === 'biome') { const r = doLocate(a[0], a[1]); return place(r[0], r[1], r[2]); }
      if (a.length < 3) fail('Give x y z, or spawn / cave / surface / biome <name>');
      return place(coord(a[0], p.x, 'x'), coord(a[1], p.y, 'y'), coord(a[2], p.z, 'z'));
    } });
  command('give', { usage: '<item> [count]', args: [itemKeys], help: 'Give yourself items. /give torch 64',
    run([k, n]) {
      const d = IT.key(k); if (!d) fail(`Unknown item "${k}". Press Tab for names.`);
      let count = n == null ? (d.maxStack > 1 ? d.maxStack : 1) : Number(n);
      if (!Number.isInteger(count) || count < 1 || count > 64 * 36) fail('Count must be 1–2304');
      let given = 0;
      while (count > 0) { const c = Math.min(count, d.maxStack); G.dev.give(IT.make(d.id, c)); given += c; count -= c; }
      return `Gave ${given} ${d.name}`;
    } });
  command('clear', { usage: '[item]', args: [itemKeys], help: 'Empty your inventory, or remove one item type.',
    run([k]) {
      if (!k) { G.dev.clearInventory(); return 'Inventory cleared'; }
      const d = IT.key(k); if (!d) fail(`Unknown item "${k}"`);
      const n = BC.inv.remove(G.state.inv, d.id, 1e9); return `Removed ${n} ${d.name}`;
    } });
  command('heal', { help: 'Restore health and air.', run() { G.dev.heal(); return 'Healed'; } });
  command('feed', { help: 'Fill hunger and saturation.', run() { G.dev.feed(); return 'Fed'; } });
  command('kill', { help: 'Kill yourself (drops items in Survival).', run() { G.dev.kill(); return 'Killed'; } });
  command('god', { usage: '[on|off]', args: [() => ['on', 'off']], help: 'Take no damage.', run([v]) { P().god = onOff(v, P().god); return 'God mode ' + (P().god ? 'on' : 'off'); } });
  command('noclip', { usage: '[on|off]', args: [() => ['on', 'off']], help: 'Fly through blocks.', run([v]) { P().noclip = onOff(v, P().noclip); P().fly = P().noclip || P().fly; return 'No-clip ' + (P().noclip ? 'on' : 'off'); } });
  command('fly', { usage: '[on|off]', args: [() => ['on', 'off']], help: 'Toggle flying (any game mode while developing).',
    run([v]) { const on = onOff(v, P().fly); if (on && G.state.mode !== 'creative' && !P().noclip) fail('Flying in Survival needs /noclip or /gamemode creative'); P().fly = on; return 'Flying ' + (on ? 'on' : 'off'); } });
  command('speed', { usage: '<walk multiplier> [fly multiplier]', help: 'Movement speed multipliers (1 = normal, up to 10).',
    run([a, b]) {
      const w = Number(a), f = b == null ? w : Number(b);
      if (!(w > 0 && w <= 10 && f > 0 && f <= 10)) fail('Multipliers between 0.1 and 10');
      P().speedMul = w; P().flyMul = f; return `Walk ×${w}, fly ×${f}`;
    } });
  function setCells(cells) {
    // Batch edit: write chunk data and edits directly, then let streaming re-mesh the touched chunks once.
    const w = W(), touched = new Set();
    for (const [x, y, z, id] of cells) {
      if (y < 0 || y >= WH) continue;
      const k = BC.world.ckey(x >> 4, z >> 4), ch = w.chunks.get(k);
      if (!ch) continue;
      const i = BC.worldgen.IDX(x & 15, y, z & 15);
      ch.data[i] = id;
      let e = w.edits.get(k); if (!e) { e = new Map(); w.edits.set(k, e); } e.set(i, id);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) touched.add(BC.world.ckey((x >> 4) + dx, (z >> 4) + dz));
    }
    for (const k of touched) { const ch = w.chunks.get(k); if (ch) ch.dirty = true; }
    if (w.onBatchEdit) w.onBatchEdit(cells);   // lets the lighting engine catch up when present
  }
  command('setblock', { usage: '<x> <y> <z> <block>', args: [null, null, null, blockKeys], help: 'Place one block.',
    run(a) {
      const p = P().p, x = Math.floor(coord(a[0], p.x, 'x')), y = Math.floor(coord(a[1], p.y, 'y')), z = Math.floor(coord(a[2], p.z, 'z'));
      const id = blockByName(a[3]);
      if (!W().hasChunk(x, z)) fail('That position is not loaded');
      W().setBlock(x, y, z, id); return `Set ${x} ${y} ${z} to ${a[3]}`;
    } });
  command('fill', { usage: '<x1> <y1> <z1> <x2> <y2> <z2> <block>', args: [null, null, null, null, null, null, blockKeys], help: 'Fill a box (up to 32768 blocks).',
    run(a) {
      const p = P().p;
      const c = [coord(a[0], p.x, 'x1'), coord(a[1], p.y, 'y1'), coord(a[2], p.z, 'z1'), coord(a[3], p.x, 'x2'), coord(a[4], p.y, 'y2'), coord(a[5], p.z, 'z2')].map(Math.floor);
      const id = blockByName(a[6]);
      const [x0, x1] = [Math.min(c[0], c[3]), Math.max(c[0], c[3])], [y0, y1] = [Math.max(0, Math.min(c[1], c[4])), Math.min(WH - 1, Math.max(c[1], c[4]))], [z0, z1] = [Math.min(c[2], c[5]), Math.max(c[2], c[5])];
      const n = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
      if (n > 32768) fail(`That is ${n} blocks; the limit is 32768`);
      const cells = [];
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) cells.push([x, y, z, id]);
      setCells(cells); return `Filled ${n} blocks with ${a[6]}`;
    } });
  command('spawnpoint', { help: 'Set the world spawn to where you stand.', run() { const p = P().p; G.dev.setSpawn(p.x, p.y, p.z); return `Spawn set to ${fmt(p.x)} ${fmt(p.y)} ${fmt(p.z)}`; } });
  command('seed', { help: 'Show the world seed.', run() { return `Seed: ${G.record.seed} · generator ${G.record.gen} (${(BC.worldgen.list().find(v => v.version === G.record.gen) || {}).name || '?'})`; } });
  command('pos', { help: 'Show your position, chunk and biome.', run() { const p = P().p; return `${fmt(p.x)} ${fmt(p.y)} ${fmt(p.z)} · chunk ${Math.floor(p.x) >> 4}, ${Math.floor(p.z) >> 4}${W().gen.sample ? ' · ' + biomeName(p.x, p.z) : ''}`; } });
  command('difficulty', { usage: '<peaceful|easy|normal|hard>', args: [() => ['peaceful', 'easy', 'normal', 'hard']], help: 'Change difficulty.',
    run([d]) { const i = ['peaceful', 'easy', 'normal', 'hard'].indexOf(d); if (i < 0) fail('peaceful, easy, normal or hard'); G.record.difficulty = i; return 'Difficulty set to ' + d; } });
  command('rd', { usage: '<2-12>', help: 'Render distance in chunks.', run([n]) { const v = Number(n); if (!(Number.isInteger(v) && v >= 2 && v <= 12)) fail('Whole number 2–12'); G.applySettings({ renderDistance: v }); return 'Render distance ' + v; } });
  command('chunks', { usage: '[on|off]', args: [() => ['on', 'off']], help: 'Show chunk borders.', run([v]) { view.chunks = onOff(v, view.chunks); updateBorders(true); return 'Chunk borders ' + (view.chunks ? 'on' : 'off'); } });
  command('inspect', { usage: '[on|off]', args: [() => ['on', 'off']], help: 'Show what you are looking at: block, position, light, biome and climate fields.', run([v]) { view.inspect = onOff(v, view.inspect); $('dev-inspector').hidden = !view.inspect; return 'Inspector ' + (view.inspect ? 'on' : 'off'); } });
  command('biome', { help: 'Show the biome and climate fields where you stand.',
    run() {
      if (!W().gen.sample) return 'This world uses the Classic generator (no biome data).';
      const p = P().p, s = W().gen.sample(Math.floor(p.x), Math.floor(p.z));
      return [biomeName(p.x, p.z)].concat(Object.entries(s.fields || {}).map(([k, v]) => `  ${k}: ${typeof v === 'number' ? v.toFixed(3) : v}`));
    } });
  command('biomes', { help: 'List every biome this world can generate.',
    run() { if (!W().gen.biomes) return 'This world uses the Classic generator (no biomes).'; return W().gen.biomes.map(b => `${b.key} · ${b.name} (${b.family})`); } });
  command('clearlog', { noWorld: true, help: 'Clear the console.', run() { lines.length = 0; renderLog(); } });
  function biomeName(x, z) { const s = W().gen.sample(Math.floor(x), Math.floor(z)); return s && s.biome ? `${s.biome.name}${s.biome.variant ? ' (' + s.biome.variant + ')' : ''}` : 'unknown biome'; }

  // ---------------------------------------------------------------- console UI
  let history = [], histPos = -1, completions = [], compIdx = 0;
  function remember(cmdText) {
    history = (G.dev.settings.consoleHistory || []).filter(h => h !== cmdText).concat([cmdText]).slice(-50);
    G.applySettings({ consoleHistory: history });
  }
  function openConsole(prefill) {
    if (G.screen !== 'play') return;
    G.dev.releaseInputs();
    G.setScreen('console');
    history = (G.dev.settings.consoleHistory || []).slice();
    histPos = history.length;
    input.value = prefill || ''; updateSuggest();
    renderLog();
    input.focus();   // synchronously, so keys typed right after opening land in the input
  }
  function closeConsole(toPause) {
    input.blur();
    if (toPause) { G.setScreen('pause'); U.setPause(G.dev.pauseInfo()); } else G.dev.resume();
  }
  function tokens() { return input.value.replace(/^\//, '').split(' '); }
  function candidates() {
    const t = tokens(), last = t[t.length - 1].toLowerCase();
    let pool;
    if (t.length === 1) pool = Object.keys(CMDS);
    else { const spec = CMDS[t[0].toLowerCase()]; const f = spec && spec.args && spec.args[t.length - 2]; pool = f ? f() : []; }
    return pool.filter(c => c.toLowerCase().startsWith(last)).sort().slice(0, 40);
  }
  function updateSuggest() {
    completions = candidates(); compIdx = 0;
    const t = tokens(), spec = CMDS[t[0].toLowerCase()];
    suggest.textContent = completions.length && tokens()[tokens().length - 1] !== completions[0]
      ? completions.slice(0, 12).join('  ') + (completions.length > 12 ? '  …' : '')
      : spec ? `/${t[0]} ${spec.usage || ''} · ${spec.help}` : '';
  }
  input.addEventListener('input', updateSuggest);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); const v = input.value; input.value = ''; exec(v); closeConsole(false); return; }
    if (e.key === 'Escape') { e.preventDefault(); closeConsole(true); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (!completions.length) return;
      const t = tokens(); t[t.length - 1] = completions[compIdx % completions.length]; compIdx++;
      const lead = input.value.startsWith('/') ? '/' : '';
      input.value = lead + t.join(' ') + (completions.length === 1 ? ' ' : '');
      if (completions.length === 1) updateSuggest();
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      histPos = Math.max(0, Math.min(history.length, histPos + (e.key === 'ArrowUp' ? -1 : 1)));
      input.value = history[histPos] || ''; updateSuggest();
    }
    e.stopPropagation();
  });

  // ---------------------------------------------------------------- dev panel
  const TABS = {
    Player: () => [
      row([btn('Survival', '/gamemode survival'), btn('Creative', '/gamemode creative')]),
      row([btn('God mode', '/god'), btn('No-clip', '/noclip'), btn('Fly', '/fly')]),
      row([btn('Heal', '/heal'), btn('Feed', '/feed'), btn('Clear inventory', '/clear'), btn('Kill', '/kill')]),
      slider('Walk speed', 0.5, 5, 0.5, () => P().speedMul, v => `/speed ${v} ${P().flyMul}`),
      slider('Fly speed', 0.5, 10, 0.5, () => P().flyMul, v => `/speed ${P().speedMul} ${v}`),
    ],
    World: () => [
      slider('Time of day (hour)', 0, 23.75, 0.25, () => ((G.dev.time * 24 + 6) % 24), v => `/time set ${String(Math.floor(v)).padStart(2, '0')}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`),
      row([btn('Sunrise', '/time set sunrise'), btn('Noon', '/time set noon'), btn('Sunset', '/time set sunset'), btn('Midnight', '/time set midnight')]),
      row([btn('Freeze time', '/time freeze'), btn('Unfreeze', '/time unfreeze')]),
      row([label('Day length'), btn('2 min', '/daylength 2'), btn('10 min', '/daylength 10'), btn('20 min', '/daylength 20'), btn('60 min', '/daylength 60')]),
      row([label('Difficulty'), btn('Peaceful', '/difficulty peaceful'), btn('Easy', '/difficulty easy'), btn('Normal', '/difficulty normal'), btn('Hard', '/difficulty hard')]),
      row([btn('Set spawn here', '/spawnpoint'), btn('Seed', '/seed')]),
    ],
    Travel: () => {
      const out = [row([btn('World spawn', '/tp spawn'), btn('Nearest cave', '/tp cave'), btn('Surface', '/tp surface'), btn('Up 30', '/tp ~ ~30 ~')])];
      const f = document.createElement('form'); f.className = 'dev-row';
      f.innerHTML = '<label>X <input id="dev-tx" size="6"></label><label>Y <input id="dev-ty" size="4"></label><label>Z <input id="dev-tz" size="6"></label><button class="btn small" type="submit">Go</button>';
      f.addEventListener('submit', e => { e.preventDefault(); run(`/tp ${$('dev-tx').value || '~'} ${$('dev-ty').value || '~'} ${$('dev-tz').value || '~'}`); });
      out.push(f);
      const keys = biomeKeys();
      if (keys.length) {
        const sel = document.createElement('div'); sel.className = 'dev-biomes';
        for (const b of W().gen.biomes) {
          const bt = btn(b.name, '/tp biome ' + b.key);
          bt.style.borderLeft = `6px solid ${b.color || '#888'}`; bt.title = b.family;
          sel.appendChild(bt);
        }
        out.push(label('Go to biome (nearest)'), sel);
      } else out.push(label('This world uses the Classic generator: no biomes to search.'));
      return out;
    },
    Items: () => {
      const wrap = document.createElement('div');
      const q = document.createElement('input'); q.placeholder = 'Search items'; q.className = 'dev-search'; q.setAttribute('aria-label', 'Search items');
      const grid = document.createElement('div'); grid.className = 'dev-items';
      const draw = () => {
        grid.replaceChildren();
        for (const d of IT.all().filter(d => d.name.toLowerCase().includes(q.value.toLowerCase()) || d.key.includes(q.value.toLowerCase()))) {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'dev-item'; b.title = `${d.name} (${d.key}) · click for a stack`;
          const img = document.createElement('img'); img.src = BC.tex.iconURL(d.id); img.alt = ''; b.append(img);
          b.addEventListener('click', () => run('/give ' + d.key));
          grid.appendChild(b);
        }
      };
      q.addEventListener('input', draw); q.addEventListener('keydown', e => e.stopPropagation());
      draw(); wrap.append(q, grid); return [wrap];
    },
    View: () => [
      row([btn('Chunk borders', '/chunks'), btn('Inspector', '/inspect'), btn('Biome here', '/biome'), btn('Position', '/pos')]),
      row([label('Render distance'), btn('4', '/rd 4'), btn('6', '/rd 6'), btn('8', '/rd 8'), btn('10', '/rd 10')]),
    ],
  };
  const Extra = BC.devTabs = {};   // later stages add tabs here, e.g. Creatures → spawn rates per biome
  let tab = 'Player';
  function run(cmdText) { exec(cmdText); renderPanel(); }
  function btn(text, cmdText) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small dev-btn'; b.textContent = text; b.addEventListener('click', () => run(cmdText)); return b; }
  function row(children) { const r = document.createElement('div'); r.className = 'dev-row'; r.append(...children); return r; }
  function label(t) { const s = document.createElement('span'); s.className = 'dev-label'; s.textContent = t; return s; }
  function slider(name, min, max, step, get, toCmd) {
    const l = document.createElement('label'); l.className = 'dev-slider';
    const o = document.createElement('output'); const r = document.createElement('input');
    r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = get(); o.textContent = (+r.value).toFixed(2);
    r.addEventListener('input', () => { o.textContent = (+r.value).toFixed(2); exec(toCmd(+r.value)); });
    l.append(name + ' ', o, r); return l;
  }
  function renderPanel() {
    const tabs = $('dev-tabs'); tabs.replaceChildren();
    const all = Object.assign({}, TABS, Extra);
    for (const name of Object.keys(all)) {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', name === tab);
      b.className = 'dev-tab' + (name === tab ? ' on' : ''); b.textContent = name;
      b.addEventListener('click', () => { tab = name; renderPanel(); });
      tabs.appendChild(b);
    }
    const body = $('dev-body'); body.replaceChildren(...(G.record ? all[tab]() : [label('Open a world to use the toolkit.')]));
    body.appendChild(logBox);
  }
  function openPanel() {
    if (G.screen !== 'play') return;
    if (!G.dev.allowed()) { log('The dev toolkit needs cheats enabled for this world, or Developer mode in Settings.', 'err'); return; }
    G.dev.releaseInputs(); G.setScreen('devpanel'); renderPanel();
  }
  function closePanel(toPause) {
    $('scr-console').insertBefore(logBox, suggest);
    if (toPause) { G.setScreen('pause'); U.setPause(G.dev.pauseInfo()); } else G.dev.resume();
  }
  $('dev-close').addEventListener('click', () => closePanel(false));

  // ---------------------------------------------------------------- keys
  window.addEventListener('keydown', e => {
    const tag = e.target && e.target.tagName;
    if (G.screen === 'devpanel') {
      if (e.code === 'F4') { e.preventDefault(); closePanel(false); }
      else if (e.code === 'Escape' && tag !== 'INPUT') { e.preventDefault(); closePanel(true); }
      return;
    }
    if (G.screen !== 'play' || tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.code === 'Slash' || e.code === 'KeyT') { e.preventDefault(); openConsole(e.code === 'Slash' ? '/' : ''); }
    else if (e.code === 'F4') { e.preventDefault(); openPanel(); }
  });
  // touch: a Dev button next to Menu
  const tdev = document.createElement('button');
  tdev.className = 'btn small'; tdev.id = 'dev-touch-btn'; tdev.type = 'button'; tdev.textContent = 'Dev';
  tdev.addEventListener('click', openPanel);
  $('touch').appendChild(tdev);

  // ---------------------------------------------------------------- inspector + chunk borders
  const view = { chunks: false, inspect: false };
  let borders = null, borderKey = '';
  function updateBorders(force) {
    const p = P().p, cx = Math.floor(p.x) >> 4, cz = Math.floor(p.z) >> 4, key = cx + ',' + cz + ':' + view.chunks;
    if (!force && key === borderKey) return;
    borderKey = key;
    if (borders) { R.scene.remove(borders); borders.geometry.dispose(); borders = null; }
    if (!view.chunks || !G.record) return;
    // Current chunk: a vertical post every 2 blocks along its edges and a ring every 16 blocks of height.
    // Neighbouring chunks: corner posts only.
    const pts = [], x0 = cx * CS, z0 = cz * CS;
    for (let i = 0; i <= CS; i += 2) for (const [x, z] of [[x0 + i, z0], [x0 + i, z0 + CS], [x0, z0 + i], [x0 + CS, z0 + i]]) pts.push(x, 0, z, x, WH, z);
    for (let y = 0; y <= WH; y += 16) pts.push(x0, y, z0, x0 + CS, y, z0, x0 + CS, y, z0, x0 + CS, y, z0 + CS, x0 + CS, y, z0 + CS, x0, y, z0 + CS, x0, y, z0 + CS, x0, y, z0);
    for (let dz = -1; dz <= 2; dz++) for (let dx = -1; dx <= 2; dx++) if (dx < 0 || dx > 1 || dz < 0 || dz > 1) pts.push(x0 + dx * CS, 0, z0 + dz * CS, x0 + dx * CS, WH, z0 + dz * CS);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    borders = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xf5b544, transparent: true, opacity: 0.55 }));
    R.scene.add(borders);
  }
  let inspT = 0;
  BC.hooks.frame.push((g, dt) => {
    if (!G.record) { if (borders) updateBorders(true); return; }
    if (view.chunks) updateBorders(false);
    inspT += dt || 0.016;
    if (view.inspect && inspT > 0.2) {
      inspT = 0;
      const h = G.raycast(), p = P().p, w = W(), L = BC.lighting;
      const rows = [`${G.state.mode} · ${fmt(p.x)} ${fmt(p.y)} ${fmt(p.z)} · chunk ${Math.floor(p.x) >> 4},${Math.floor(p.z) >> 4}`];
      if (h) {
        rows.push(`Looking at ${DEFS[h.id].name} (${DEFS[h.id].key}, id ${h.id}) at ${h.x} ${h.y} ${h.z}`);
        const ax = h.x + h.n[0], ay = h.y + h.n[1], az = h.z + h.n[2];
        if (L && L.getSkyLight) rows.push(`Light on that face: sky ${L.getSkyLight(w, ax, ay, az)} · block ${L.getBlockLight(w, ax, ay, az)}`);
      } else rows.push('Looking at nothing within reach');
      if (w.gen.sample) {
        const s = w.gen.sample(Math.floor(p.x), Math.floor(p.z));
        rows.push(`Biome: ${biomeName(p.x, p.z)} · family ${s.biome.family}`);
        rows.push(Object.entries(s.fields || {}).map(([k, v]) => `${k} ${typeof v === 'number' ? v.toFixed(2) : v}`).join(' · '));
      } else rows.push('Classic generator (no biome data)');
      rows.push(`Time ${clock(G.dev.time)} · day ${fmt(10 / G.dev.timeScale)} min${G.dev.freezeTime ? ' (frozen)' : ''}${P().god ? ' · god' : ''}${P().noclip ? ' · no-clip' : ''}`);
      $('dev-inspector').textContent = rows.join('\n');
    }
  });
  BC.hooks.worldUnloaded.push(() => { view.chunks = false; updateBorders(true); P().god = false; P().noclip = false; P().speedMul = 1; P().flyMul = 1; G.dev.timeScale = 1; G.dev.freezeTime = false; });
  BC.hooks.worldLoaded.push(() => { $('dev-touch-btn').hidden = !G.dev.allowed(); if (G.dev.allowed()) log('Dev toolkit ready: press / or T for commands, F4 for the panel. /help lists commands.', 'ok'); });

  BC.dev = { command, exec, log, CmdError, fail, setCells, view };
})(window);
