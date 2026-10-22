'use strict';
// Crafting recipes and grid matching. Shaped recipes may be mirrored left-to-right, as in the reference game.
(function (root) {
  const BC = root.BC;
  const IT = BC.items;

  const RECIPES = [];
  // Recipes are resolved to item ids as they are added, so an unknown item name fails loudly at load time.
  function resolve(r) {
    r.outId = IT.idOf(r.out);
    if (r.type === 'shaped') {
      r.w = Math.max(...r.pattern.map(p => p.length)); r.h = r.pattern.length;
      r.cells = [];
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { const ch = r.pattern[y][x] || ' '; r.cells.push(ch === ' ' ? 0 : IT.idOf(r.key[ch])); }
    } else r.ids = r.ingredients.map(IT.idOf).sort((a, b) => a - b);
    r.needs = {};
    for (const id of (r.cells || r.ids)) if (id) r.needs[id] = (r.needs[id] || 0) + 1;
    RECIPES.push(r);
    return r;
  }
  function shaped(pattern, key, out, count) { return resolve({ type: 'shaped', pattern, key, out, count: count || 1 }); }
  function shapeless(ingredients, out, count) { return resolve({ type: 'shapeless', ingredients, out, count: count || 1 }); }

  shapeless(['oak_log'], 'oak_planks', 4);
  shaped(['#', '#'], { '#': 'oak_planks' }, 'stick', 4);
  shaped(['##', '##'], { '#': 'oak_planks' }, 'crafting_table');
  shaped(['##', '##'], { '#': 'stone' }, 'stone_bricks', 4);

  const HEADS = { wooden: 'oak_planks', stone: 'cobblestone', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
  for (const [mat, head] of Object.entries(HEADS)) {
    shaped(['XXX', ' # ', ' # '], { X: head, '#': 'stick' }, `${mat}_pickaxe`);
    shaped(['XX', 'X#', ' #'], { X: head, '#': 'stick' }, `${mat}_axe`);
    shaped(['X', '#', '#'], { X: head, '#': 'stick' }, `${mat}_shovel`);
    shaped(['X', 'X', '#'], { X: head, '#': 'stick' }, `${mat}_sword`);
  }


  // grid: array of n*n item ids (0 = empty). Returns the matching recipe or null.
  function match(grid, n) {
    let minX = n, minY = n, maxX = -1, maxY = -1;
    const present = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const id = grid[y * n + x];
      if (id) { present.push(id); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    }
    if (!present.length) return null;
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const sorted = present.slice().sort((a, b) => a - b);
    for (const r of RECIPES) {
      if (r.type === 'shapeless') {
        if (r.ids.length === sorted.length && r.ids.every((v, i) => v === sorted[i])) return r;
        continue;
      }
      if (r.w !== w || r.h !== h) continue;
      for (const mirror of [false, true]) {
        let ok = true;
        for (let y = 0; y < h && ok; y++) for (let x = 0; x < w; x++) {
          const want = r.cells[y * w + (mirror ? w - 1 - x : x)];
          if ((grid[(minY + y) * n + minX + x] || 0) !== want) { ok = false; break; }
        }
        if (ok) return r;
      }
    }
    return null;
  }
  const gridIds = slots => slots.map(s => (s ? s.id : 0));
  function result(slots, n) { const r = match(gridIds(slots), n); return r ? { recipe: r, stack: IT.make(r.outId, r.count) } : null; }
  // Use one item from every filled grid cell.
  function consume(slots) { for (let i = 0; i < slots.length; i++) if (slots[i]) { slots[i].count--; if (slots[i].count <= 0) slots[i] = null; } }
  const fits = (r, n) => (r.type === 'shaped' ? r.w <= n && r.h <= n : r.ids.length <= n * n);

  // How many of each ingredient the player is missing for one craft.
  function missing(r, have) {
    const out = [];
    for (const [id, n] of Object.entries(r.needs)) { const h = have(+id); if (h < n) out.push({ id: +id, need: n - h }); }
    return out;
  }
  // Lay a recipe out in an n*n grid (top-left aligned). Returns an array of ids or null if it does not fit.
  function layout(r, n) {
    if (!fits(r, n)) return null;
    const g = new Array(n * n).fill(0);
    if (r.type === 'shaped') { for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) g[y * n + x] = r.cells[y * r.w + x]; }
    else r.ids.forEach((id, i) => { g[i] = id; });
    return g;
  }

  BC.crafting = { RECIPES, shaped, shapeless, match, result, consume, fits, missing, layout, gridIds };
})(typeof window !== 'undefined' ? window : globalThis);
