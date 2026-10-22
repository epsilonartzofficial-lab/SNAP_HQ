'use strict';
// Inventory and slot rules. Pure data logic with no DOM, so it can be unit-tested in Node.
// Player inventory layout follows the reference game: slots 0–8 hotbar, 9–35 main.
(function (root) {
  const BC = root.BC;
  const IT = BC.items;

  const HOTBAR = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const MAIN = []; for (let i = 9; i < 36; i++) MAIN.push(i);
  const ALL = HOTBAR.concat(MAIN);

  const clone = s => (s ? Object.assign({}, s) : null);
  const max = s => IT.maxStack(s.id);
  // Two stacks can merge when they are the same item and neither carries wear.
  const stackable = (a, b) => !!(a && b && a.id === b.id && max(a) > 1 && !a.dmg && !b.dmg);

  function empty(n) { return new Array(n).fill(null); }

  // Add as much of `stack` as fits into `slots` at `indices` (existing stacks first, then empty slots).
  // Mutates `stack.count` and returns what is left over (0 when everything fitted).
  function addTo(slots, stack, indices) {
    if (!stack || stack.count <= 0) return 0;
    const m = max(stack);
    if (m > 1) {
      for (const i of indices) {
        const s = slots[i];
        if (stackable(s, stack) && s.count < m) {
          const n = Math.min(m - s.count, stack.count); s.count += n; stack.count -= n;
          if (!stack.count) return 0;
        }
      }
    }
    for (const i of indices) {
      if (!slots[i]) {
        const n = Math.min(m, stack.count);
        slots[i] = Object.assign({}, stack, { count: n }); stack.count -= n;
        if (!stack.count) return 0;
      }
    }
    return stack.count;
  }
  // Picking up items, as in the reference game: top up a matching stack (the selected slot first, then 0–35),
  // then use the first empty slot in 0–35.
  function addPlayer(slots, stack, selected) {
    if (!stack || stack.count <= 0) return 0;
    const m = max(stack);
    if (m > 1) {
      const order = selected != null ? [selected].concat(ALL.filter(i => i !== selected)) : ALL;
      for (const i of order) {
        const s = slots[i];
        if (stackable(s, stack) && s.count < m) {
          const n = Math.min(m - s.count, stack.count); s.count += n; stack.count -= n;
          if (!stack.count) return 0;
        }
      }
    }
    return addTo(slots, stack, ALL);
  }

  // Mouse-style slot click. button 0 = left, 2 = right. Returns the new cursor stack.
  // `accept(stack)` lets special slots refuse items.
  function click(slots, i, button, cursor, accept) {
    const s = slots[i];
    if (cursor && accept && !accept(cursor)) return cursor;
    if (button === 0) {
      if (!cursor) { slots[i] = null; return s; }
      if (!s) {
        const n = Math.min(cursor.count, max(cursor));
        slots[i] = Object.assign({}, cursor, { count: n });
        return cursor.count - n > 0 ? Object.assign({}, cursor, { count: cursor.count - n }) : null;
      }
      if (stackable(s, cursor)) {
        const n = Math.min(max(s) - s.count, cursor.count);
        s.count += n;
        return cursor.count - n > 0 ? Object.assign({}, cursor, { count: cursor.count - n }) : null;
      }
      slots[i] = cursor; return s;
    }
    if (button === 2) {
      if (!cursor) {
        if (!s) return null;
        const take = Math.ceil(s.count / 2);
        const left = s.count - take;
        slots[i] = left > 0 ? Object.assign({}, s, { count: left }) : null;
        return Object.assign({}, s, { count: take });
      }
      if (!s) {
        slots[i] = Object.assign({}, cursor, { count: 1 });
        return cursor.count > 1 ? Object.assign({}, cursor, { count: cursor.count - 1 }) : null;
      }
      if (stackable(s, cursor)) {
        if (s.count >= max(s)) return cursor;
        s.count += 1;
        return cursor.count > 1 ? Object.assign({}, cursor, { count: cursor.count - 1 }) : null;
      }
      slots[i] = cursor; return s;
    }
    return cursor;
  }

  // Shift-click: move a whole stack into the target slot groups (in order). Leftovers stay put.
  function quickMove(from, i, targets) {
    const s = from[i]; if (!s) return;
    const moving = clone(s);
    from[i] = null;   // the source slot never receives its own stack
    for (const [slots, indices] of targets) {
      const idx = slots === from ? indices.filter(k => k !== i) : indices;
      if (addTo(slots, moving, idx) === 0) break;
    }
    if (moving.count > 0) from[i] = moving;
  }

  function count(slots, id) { let n = 0; for (const s of slots) if (s && s.id === id) n += s.count; return n; }
  // Remove up to n of an item; returns how many were removed.
  function remove(slots, id, n, indices) {
    let left = n;
    for (const i of (indices || slots.map((_, k) => k))) {
      const s = slots[i];
      if (s && s.id === id && left > 0) { const k = Math.min(s.count, left); s.count -= k; left -= k; if (!s.count) slots[i] = null; }
    }
    return n - left;
  }
  function total(slots) { let n = 0; for (const s of slots) if (s) n += s.count; return n; }

  // Compact save format: [id, count, dmg] or null. Invalid entries are dropped rather than crashing a load.
  const pack = slots => slots.map(s => (s ? (s.dmg ? [s.id, s.count, s.dmg] : [s.id, s.count]) : null));
  function unpack(arr, size) {
    const out = empty(size);
    if (!Array.isArray(arr)) return out;
    for (let i = 0; i < Math.min(size, arr.length); i++) {
      const a = arr[i]; if (!Array.isArray(a)) continue;
      const s = { id: a[0] | 0, count: a[1] | 0 };
      const d = IT.get(s.id); if (!d) continue;
      if (d.tool) s.dmg = Math.max(0, a[2] | 0);
      s.count = Math.min(s.count, d.maxStack);
      if (s.count > 0) out[i] = s;
    }
    return out;
  }

  BC.inv = { HOTBAR, MAIN, ALL, clone, stackable, empty, addTo, addPlayer, click, quickMove, count, remove, total, pack, unpack };
})(typeof window !== 'undefined' ? window : globalThis);
