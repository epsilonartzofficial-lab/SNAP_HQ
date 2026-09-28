'use strict';
// DOM interface: screens, HUD, inventory and crafting windows, recipe list, settings and world management.
// Game rules live in game.js; this module renders state and forwards player intent to `G`.
(function (root) {
  const BC = root.BC;
  const IT = BC.items, INV = BC.inv, CR = BC.crafting, T = BC.tex;
  const $ = id => document.getElementById(id);
  const U = BC.ui = {};
  let G = null;

  const SCREENS = ['title', 'worlds', 'create', 'transfer', 'loading', 'pause', 'settings', 'death', 'inventory'];
  U.show = function (name) { for (const s of SCREENS) $('scr-' + s).hidden = s !== name; hover = null; if (name !== 'inventory') { hideTooltip(); $('cursor-stack').hidden = true; } };

  // UI surfaces are painted with the game's own generated textures.
  const texCSS = document.createElement('style');
  texCSS.textContent =
    `.tex-stone{background-image:linear-gradient(rgba(14,15,19,.84),rgba(14,15,19,.9)),url(${T.tileURL('stone')})}` +
    `.tex-grass{background-image:linear-gradient(rgba(0,0,0,.08),rgba(0,0,0,.18)),url(${T.tileURL('grass_side', 3)});background-position:0 0}` +
    `.tex-planks{background-image:linear-gradient(rgba(0,0,0,.12),rgba(0,0,0,.22)),url(${T.tileURL('planks', 3)})}`;
  document.head.appendChild(texCSS);

  // ---------------------------------------------------------------- banner + toast
  U.error = function (msg) { $('banner-text').textContent = msg; $('banner').hidden = false; };
  U.clearError = () => { $('banner').hidden = true; };
  $('banner-close').addEventListener('click', U.clearError);
  let toastTimer = 0;
  U.toast = function (msg, ms) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('fade');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('fade'), ms || 1500);
  };

  // ---------------------------------------------------------------- slots
  function durColor(f) { return `hsl(${Math.round(120 * f)},80%,45%)`; }
  function fillSlot(el, s) {
    const key = s ? `${s.id}:${s.count}:${s.dmg || 0}` : '';
    if (el.dataset.k === key) return;
    el.dataset.k = key;
    el.querySelectorAll('img,.cnt,.dur').forEach(n => n.remove());
    if (!s) return;
    const d = IT.get(s.id);
    const img = document.createElement('img'); img.src = T.iconURL(s.id); img.alt = ''; el.appendChild(img);
    if (s.count > 1) { const c = document.createElement('span'); c.className = 'cnt'; c.textContent = s.count; el.appendChild(c); }
    if (d.tool && s.dmg > 0) {
      const f = Math.max(0, 1 - s.dmg / d.tool.durability);
      const bar = document.createElement('span'); bar.className = 'dur';
      const i = document.createElement('i'); i.style.width = (f * 100).toFixed(0) + '%'; i.style.background = durColor(f); bar.appendChild(i); el.appendChild(bar);
    }
  }
  function slotEl(container, index, extraClass) {
    const el = document.createElement('div');
    el.className = 'slot' + (extraClass ? ' ' + extraClass : '');
    el.dataset.c = container; el.dataset.i = index;
    return el;
  }
  const itemLabel = s => { const d = IT.get(s.id); let t = d.name; if (d.tool) t += ` · ${d.tool.durability - (s.dmg || 0)}/${d.tool.durability}`; return t; };

  // ---------------------------------------------------------------- HUD
  const hot = [];
  U.buildHotbar = function () {
    const hb = $('hotbar'); hb.textContent = '';
    for (let i = 0; i < 9; i++) {
      const el = slotEl('hotbar', i);
      const n = document.createElement('span'); n.className = 'num'; n.textContent = i + 1; el.appendChild(n);
      el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); G.selectSlot(i); });
      hb.appendChild(el); hot.push(el);
    }
    for (const id of ['hearts', 'food', 'air']) { const box = $(id); box.textContent = ''; for (let i = 0; i < 10; i++) { const s = document.createElement('span'); s.className = 'hud-ico'; box.appendChild(s); } }
  };
  let last = {};
  function iconRow(boxId, value, kind, force) {
    const box = $(boxId);
    for (let i = 0; i < 10; i++) {
      const full = value >= (i + 1) * 2, half = !full && value >= i * 2 + 1;
      const k = kind + '_' + (full ? 'full' : half ? 'half' : 'empty');
      const el = box.children[i];
      if (force || el.dataset.k !== k) { el.dataset.k = k; el.style.backgroundImage = `url(${T.HUD[k]})`; }
    }
  }
  U.updateHud = function (st) {
    for (let i = 0; i < 9; i++) { fillSlot(hot[i], st.inv[i]); hot[i].classList.toggle('sel', i === st.sel); }
    const survival = st.mode === 'survival';
    $('stats').style.visibility = survival ? 'visible' : 'hidden';
    if (survival) {
      const h = Math.ceil(st.stats.health), f = st.stats.food;
      if (last.h !== h) { iconRow('hearts', h, 'heart'); last.h = h; }
      if (last.f !== f) { iconRow('food', f, 'food'); last.f = f; }
      $('hearts').classList.toggle('low', h <= 4 && !st.reduceMotion && Math.floor(Date.now() / 150) % 2 === 0);
      $('hearts').classList.toggle('hit', st.stats.hurtTime > 5);
      const air = st.stats.air, showAir = air < BC.survival.MAX_AIR;
      const bubbles = showAir ? Math.max(0, Math.ceil(air * 10 / BC.survival.MAX_AIR)) : 0;
      if (last.air !== bubbles) {
        last.air = bubbles;
        const box = $('air');
        for (let i = 0; i < 10; i++) { const el = box.children[i]; el.style.backgroundImage = i < bubbles ? `url(${T.HUD.bubble})` : 'none'; }
      }
    }
    const eat = $('eat-bar');
    eat.hidden = !(st.eating > 0);
    if (st.eating > 0) eat.firstChild.style.width = Math.min(100, st.eating * 100).toFixed(0) + '%';
  };
  U.resetHud = () => { last = {}; for (const el of hot) delete el.dataset.k; };

  // ---------------------------------------------------------------- world list
  let selectedWorld = null, deleteArmed = null, deleteTimer = 0;
  U.renderWorlds = function (list) {
    const box = $('world-list'); box.textContent = '';
    if (!list.length) {
      const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'No worlds yet. Create one to start playing.'; box.appendChild(p);
    }
    if (!list.find(w => w.id === selectedWorld)) selectedWorld = list.length ? list[0].id : null;
    for (const w of list) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'world-row' + (w.id === selectedWorld ? ' sel' : ''); b.setAttribute('role', 'option'); b.setAttribute('aria-selected', w.id === selectedWorld);
      const name = document.createElement('b'); name.textContent = w.name;
      const tag = document.createElement('span'); tag.className = 'tag ' + w.mode; tag.textContent = w.mode === 'creative' ? 'Creative' : 'Survival';
      const meta = document.createElement('span'); meta.className = 'meta';
      meta.textContent = `${BC.survival.DIFFICULTY[w.difficulty] || 'Normal'} · seed ${w.seed} · last played ${new Date(w.lastPlayed || w.created || Date.now()).toLocaleString()}`;
      b.append(name, tag, meta);
      b.addEventListener('click', () => { selectedWorld = w.id; U.renderWorlds(list); });
      b.addEventListener('dblclick', () => { selectedWorld = w.id; G.playWorld(w.id); });
      box.appendChild(b);
    }
    for (const id of ['btn-play-world', 'btn-export-world', 'btn-delete-world']) $(id).disabled = !selectedWorld;
    $('btn-delete-world').textContent = 'Delete';
    deleteArmed = null;
  };
  U.selectedWorld = () => selectedWorld;
  $('btn-play-world').addEventListener('click', () => { if (selectedWorld) G.playWorld(selectedWorld); });
  $('btn-new-world').addEventListener('click', () => G.setScreen('create'));
  $('btn-worlds-back').addEventListener('click', () => G.setScreen('title'));
  $('btn-delete-world').addEventListener('click', () => {
    if (!selectedWorld) return;
    const btn = $('btn-delete-world');
    if (deleteArmed !== selectedWorld) {
      deleteArmed = selectedWorld; btn.textContent = 'Delete forever? Click again';
      clearTimeout(deleteTimer); deleteTimer = setTimeout(() => { deleteArmed = null; btn.textContent = 'Delete'; }, 4000);
      return;
    }
    clearTimeout(deleteTimer); deleteArmed = null; G.deleteWorld(selectedWorld);
  });
  $('btn-export-world').addEventListener('click', () => { if (selectedWorld) G.exportWorld(selectedWorld); });
  $('btn-import-world').addEventListener('click', () => U.showTransfer('import'));

  // ---------------------------------------------------------------- export / import
  let transferMode = 'export', transferBack = 'worlds';
  U.showTransfer = function (mode, text, name, back) {
    transferMode = mode; transferBack = back || 'worlds';
    $('transfer-h').textContent = mode === 'export' ? 'Export world' : 'Import world';
    $('transfer-help').textContent = mode === 'export'
      ? 'This text is a full copy of the world. Keep it somewhere safe as a backup, or import it in another browser.'
      : 'Paste world text exported from Blockcraft, or choose a saved .json file.';
    const ta = $('transfer-text'); ta.value = text || ''; ta.readOnly = mode === 'export';
    $('btn-transfer-go').textContent = mode === 'export' ? 'Copy' : 'Import';
    $('transfer-file-label').hidden = mode === 'export';
    const dl = $('transfer-download'); dl.hidden = mode !== 'export';
    if (mode === 'export') {
      try { if (dl.href.startsWith('blob:')) URL.revokeObjectURL(dl.href); dl.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); } catch (e) { dl.hidden = true; }
      dl.download = (name || 'world').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.blockcraft.json';
    }
    $('transfer-status').textContent = '';
    G.setScreen('transfer');
  };
  $('btn-transfer-go').addEventListener('click', () => {
    const ta = $('transfer-text'), status = $('transfer-status');
    if (transferMode === 'export') {
      const done = ok => { status.textContent = ok ? 'Copied.' : 'Copy was blocked. The text is selected; copy it with your keyboard.'; if (!ok) { ta.focus(); ta.select(); } };
      try { navigator.clipboard.writeText(ta.value).then(() => done(true), () => done(false)); } catch (e) { done(false); }
    } else {
      const r = G.importWorld(ta.value);
      status.textContent = r.ok ? '' : r.error;
    }
  });
  $('transfer-file').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { $('transfer-text').value = String(rd.result || ''); $('transfer-status').textContent = 'File loaded. Press Import.'; };
    rd.onerror = () => { $('transfer-status').textContent = 'That file could not be read.'; };
    rd.readAsText(f);
  });
  $('btn-transfer-back').addEventListener('click', () => G.transferBack(transferBack));

  // ---------------------------------------------------------------- create world
  const modeHelp = {
    survival: 'Gather resources, craft tools, keep yourself fed and stay alive.',
    creative: 'Unlimited blocks, instant mining and flight. No health or hunger.',
  };
  U.resetCreate = function () {
    $('cw-name').value = 'New World'; $('cw-seed').value = ''; $('cw-mode-survival').checked = true; $('cw-difficulty').value = '2';
    $('cw-cheats').checked = false; $('cw-mode-help').textContent = modeHelp.survival;
  };
  for (const id of ['cw-mode-survival', 'cw-mode-creative']) $(id).addEventListener('change', e => {
    const m = e.target.value; $('cw-mode-help').textContent = modeHelp[m]; $('cw-cheats').checked = m === 'creative';
  });
  $('create-form').addEventListener('submit', e => {
    e.preventDefault();
    G.createWorld({
      name: $('cw-name').value.trim() || 'New World',
      mode: $('cw-mode-creative').checked ? 'creative' : 'survival',
      difficulty: +$('cw-difficulty').value,
      seedText: $('cw-seed').value,
      cheats: $('cw-cheats').checked,
    });
  });
  $('btn-create-cancel').addEventListener('click', () => G.setScreen('worlds'));

  // ---------------------------------------------------------------- settings
  U.loadSettings = function (s) {
    $('set-sens').value = s.sensitivity; $('set-sens-out').textContent = (+s.sensitivity).toFixed(1) + '×';
    $('set-fov').value = s.fov; $('set-fov-out').textContent = s.fov + '°';
    $('set-rd').value = String(s.renderDistance);
    $('set-invert').checked = !!s.invertY; $('set-motion').checked = !!s.reduceMotion; $('set-tilt').checked = !!s.damageTilt; $('set-coords').checked = !!s.showCoords;
  };
  function readSettings() {
    return {
      sensitivity: +$('set-sens').value, fov: +$('set-fov').value, renderDistance: +$('set-rd').value,
      invertY: $('set-invert').checked, reduceMotion: $('set-motion').checked, damageTilt: $('set-tilt').checked, showCoords: $('set-coords').checked,
    };
  }
  for (const id of ['set-sens', 'set-fov', 'set-rd', 'set-invert', 'set-motion', 'set-tilt', 'set-coords']) {
    $(id).addEventListener('input', () => { const s = readSettings(); U.loadSettings(s); G.applySettings(s); });
  }
  $('btn-settings-done').addEventListener('click', () => G.closeSettings());

  // ---------------------------------------------------------------- title / pause / death buttons
  $('btn-singleplayer').addEventListener('click', () => G.setScreen('worlds'));
  $('btn-title-settings').addEventListener('click', () => G.openSettings());
  $('btn-resume').addEventListener('click', () => G.resume());
  $('btn-pause-settings').addEventListener('click', () => G.openSettings());
  $('btn-switch-mode').addEventListener('click', () => G.switchMode());
  $('btn-quit').addEventListener('click', () => G.quitToTitle());
  $('btn-pause-export').addEventListener('click', () => G.exportCurrent());
  $('btn-respawn').addEventListener('click', () => G.respawn());
  $('btn-death-title').addEventListener('click', () => G.quitToTitle());
  U.setPause = function (info) {
    $('pause-meta').textContent = info.meta;
    $('btn-quit').textContent = info.quitArmed ? 'Quit without saving?' : 'Save and quit to title';
    const b = $('btn-switch-mode'); b.hidden = !info.cheats; b.textContent = info.mode === 'creative' ? 'Switch to Survival' : 'Switch to Creative';
  };
  U.setDeath = msg => { $('death-msg').textContent = msg; };

  // ---------------------------------------------------------------- inventory and crafting windows
  let invKind = 'player';
  const refs = { main: [], hot: [], craft: [], result: null, palette: [] };
  U.openInventory = function (kind) {
    invKind = kind; hover = null;
    const creativePalette = kind === 'player' && G.state.mode === 'creative';
    $('inv-title').textContent = kind === 'table' ? 'Crafting Table' : creativePalette ? 'Creative inventory' : 'Inventory';
    const top = $('inv-top'); top.textContent = '';
    refs.craft = []; refs.result = null; refs.palette = [];
    if (creativePalette) {
      const pal = document.createElement('div'); pal.className = 'palette';
      IT.all().forEach(d => { const el = slotEl('palette', d.id); fillSlot(el, { id: d.id, count: 1 }); pal.appendChild(el); refs.palette.push(el); });
      const trash = slotEl('trash', 0, 'trash'); trash.textContent = 'Bin'; trash.title = 'Drop an item here to delete it';
      top.append(pal, trash);
    } else {
      const n = G.state.craft.n;
      const grid = document.createElement('div'); grid.className = 'craft-grid'; grid.style.gridTemplateColumns = `repeat(${n}, var(--islot))`;
      for (let i = 0; i < n * n; i++) { const el = slotEl('craft', i); grid.appendChild(el); refs.craft.push(el); }
      const arrow = document.createElement('span'); arrow.className = 'craft-arrow'; arrow.textContent = '→'; arrow.setAttribute('aria-hidden', 'true');
      refs.result = slotEl('result', 0, 'result');
      top.append(grid, arrow, refs.result);
    }
    const main = $('inv-main'), hotRow = $('inv-hot'); main.textContent = ''; hotRow.textContent = '';
    refs.main = []; refs.hot = [];
    for (let i = 9; i < 36; i++) { const el = slotEl('inv', i); main.appendChild(el); refs.main.push(el); }
    for (let i = 0; i < 9; i++) { const el = slotEl('inv', i); hotRow.appendChild(el); refs.hot.push(el); }
    $('inv-side').hidden = creativePalette;
    U.renderInventory();
  };
  U.renderInventory = function () {
    const st = G.state;
    refs.main.forEach((el, k) => fillSlot(el, st.inv[k + 9]));
    refs.hot.forEach((el, k) => { fillSlot(el, st.inv[k]); el.classList.toggle('sel', k === st.sel); });
    refs.craft.forEach((el, k) => fillSlot(el, st.craft.slots[k]));
    if (refs.result) { const r = G.craftResult(); fillSlot(refs.result, r ? r.stack : null); }
    renderCursor();
    if (!$('inv-side').hidden) renderRecipes();
  };
  function renderCursor() {
    const cs = $('cursor-stack'), c = G.state.cursor;
    cs.hidden = !c; cs.textContent = '';
    if (!c) return;
    const img = document.createElement('img'); img.src = T.iconURL(c.id); img.alt = ''; cs.appendChild(img);
    if (c.count > 1) { const n = document.createElement('span'); n.className = 'cnt'; n.textContent = c.count; cs.appendChild(n); }
  }
  let recipeKey = '';
  function renderRecipes() {
    const st = G.state, n = st.craft.n;
    const have = id => INV.count(st.inv, id) + INV.count(st.craft.slots, id) + (st.cursor && st.cursor.id === id ? st.cursor.count : 0);
    const list = CR.RECIPES.filter(r => CR.fits(r, n)).map(r => ({ r, miss: CR.missing(r, have) }));
    list.sort((a, b) => (a.miss.length === 0 ? 0 : 1) - (b.miss.length === 0 ? 0 : 1));
    const key = n + '|' + list.map(x => CR.RECIPES.indexOf(x.r) + ':' + x.miss.map(m => m.id + 'x' + m.need).join(',')).join(';');
    if (key === recipeKey) return; recipeKey = key;
    const box = $('recipe-list'); box.textContent = '';
    for (const { r, miss } of list) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'recipe' + (miss.length ? '' : ' ok');
      const img = document.createElement('img'); img.src = T.iconURL(r.outId); img.alt = '';
      const name = document.createElement('b'); name.textContent = IT.get(r.outId).name + (r.count > 1 ? ' ×' + r.count : '');
      const need = document.createElement('small');
      need.textContent = Object.entries(r.needs).map(([id, k]) => `${k} ${IT.get(+id).name}`).join(', ') + (miss.length ? ' · missing ' + miss.map(m => `${m.need} ${IT.get(m.id).name}`).join(', ') : '');
      b.append(img, name, need);
      b.addEventListener('click', e => { G.fillRecipe(r, e.shiftKey); });
      box.appendChild(b);
    }
  }
  U.invalidateRecipes = () => { recipeKey = ''; };

  // Pointer handling: left/right click, shift-click, long-press on touch = right click.
  const scr = $('scr-inventory');
  let press = null, hover = null;
  function slotFrom(t) { const el = t && t.closest && t.closest('.slot'); return el && scr.contains(el) ? el : null; }
  scr.addEventListener('contextmenu', e => e.preventDefault());
  scr.addEventListener('pointerdown', e => {
    const el = slotFrom(e.target);
    const inWindow = e.target.closest('.inv-window, .inv-side');
    if (!el) {
      if (!inWindow && G.state.cursor && (e.button === 0 || e.button === 2)) { e.preventDefault(); G.dropCursor(e.button === 2 ? 'one' : 'all'); }
      return;
    }
    e.preventDefault();
    if (e.pointerType === 'touch') {
      press = { el, timer: setTimeout(() => { if (press && press.el === el) { press.long = true; G.slotAction(el.dataset.c, +el.dataset.i, 'right'); } }, 420) };
      return;
    }
    G.slotAction(el.dataset.c, +el.dataset.i, e.shiftKey ? 'shift' : e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left');
  });
  scr.addEventListener('pointerup', e => {
    if (!press) return;
    clearTimeout(press.timer);
    const el = slotFrom(document.elementFromPoint(e.clientX, e.clientY));
    if (!press.long && el === press.el) G.slotAction(el.dataset.c, +el.dataset.i, 'left');
    press = null;
  });
  scr.addEventListener('pointercancel', () => { if (press) clearTimeout(press.timer); press = null; });
  document.addEventListener('pointermove', e => {
    if (scr.hidden) return;
    const cs = $('cursor-stack'); cs.style.left = e.clientX + 'px'; cs.style.top = e.clientY + 'px';
    const el = slotFrom(e.target); hover = el;
    if (el && e.pointerType === 'mouse' && !G.state.cursor) showTooltip(el, e.clientX, e.clientY); else hideTooltip();
  });
  function showTooltip(el, x, y) {
    const s = G.peekSlot(el.dataset.c, +el.dataset.i);
    const tt = $('tooltip');
    if (!s) { tt.hidden = true; return; }
    tt.textContent = IT.get(s.id).name;
    const d = IT.get(s.id);
    if (d.tool) { const sm = document.createElement('small'); sm.textContent = `Durability ${d.tool.durability - (s.dmg || 0)} / ${d.tool.durability}`; tt.appendChild(sm); }
    if (d.food) { const sm = document.createElement('small'); sm.textContent = `Restores ${d.food.hunger / 2} hunger`; tt.appendChild(sm); }
    tt.hidden = false; tt.style.left = Math.min(x + 14, innerWidth - 220) + 'px'; tt.style.top = (y + 14) + 'px';
  }
  function hideTooltip() { $('tooltip').hidden = true; }
  U.hoveredSlot = () => (hover && !scr.hidden ? { c: hover.dataset.c, i: +hover.dataset.i } : null);
  $('btn-inv-close').addEventListener('click', () => G.closeInventory());

  U.itemLabel = itemLabel;
  U.init = function (game) { G = game; U.buildHotbar(); };
})(window);
