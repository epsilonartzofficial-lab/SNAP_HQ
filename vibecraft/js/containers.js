'use strict';
// Block containers (chests and furnaces): their slots, the furnace's burn/cook cycle, and save format.
// Pure logic, unit-tested in Node. The furnace follows the reference game's AbstractFurnaceBlockEntity tick.
(function (root) {
  const BC = root.BC;
  const INV = BC.inv, IT = BC.items;
  const SIZE = { chest: 27, furnace: 3 };
  const IN = 0, FUEL = 1, OUT = 2;

  function create(type) { return { type, slots: INV.empty(SIZE[type]), burn: 0, burnMax: 0, cook: 0 }; }

  // One game tick. Returns { changed, lit } where lit says whether the furnace is burning after the tick.
  function furnaceTick(f) {
    const S = BC.smelting;
    const input = f.slots[IN], fuel = f.slots[FUEL], out = f.slots[OUT];
    const res = input ? S.result(input.id) : null;
    const canSmelt = !!res && (!out || (out.id === res.id && !out.dmg && out.count + res.count <= IT.maxStack(out.id)));
    const wasLit = f.burn > 0;
    let changed = false;
    if (f.burn > 0) f.burn--;
    if (f.burn > 0 || (fuel && input)) {
      if (f.burn <= 0 && canSmelt && fuel && S.fuelTicks(fuel.id) > 0) {
        f.burn = f.burnMax = S.fuelTicks(fuel.id);
        fuel.count--; if (fuel.count <= 0) f.slots[FUEL] = null;
        changed = true;
      }
      if (f.burn > 0 && canSmelt) {
        f.cook++;
        if (f.cook >= S.COOK_TICKS) {
          f.cook = 0;
          if (out) out.count += res.count; else f.slots[OUT] = { id: res.id, count: res.count };
          input.count--; if (input.count <= 0) f.slots[IN] = null;
          changed = true;
        }
      } else f.cook = 0;
    } else if (f.cook > 0) f.cook = Math.max(0, f.cook - 2);
    const lit = f.burn > 0;
    return { changed: changed || lit !== wasLit, lit };
  }
  // Which slot a shift-clicked item should go to in a furnace: smeltable → input, fuel → fuel slot.
  function furnaceTarget(stack) {
    if (BC.smelting.result(stack.id)) return IN;
    if (BC.smelting.fuelTicks(stack.id) > 0) return FUEL;
    return -1;
  }

  const pack = c => ({ t: c.type, s: INV.pack(c.slots), b: c.burn | 0, bm: c.burnMax | 0, c: c.cook | 0 });
  function unpack(o) {
    if (!o || !SIZE[o.t]) return null;
    const c = create(o.t);
    c.slots = INV.unpack(o.s, SIZE[o.t]);
    c.burn = Math.max(0, o.b | 0); c.burnMax = Math.max(c.burn, o.bm | 0); c.cook = Math.max(0, Math.min(BC.smelting.COOK_TICKS, o.c | 0));
    return c;
  }
  const key = (x, y, z) => x + ',' + y + ',' + z;

  BC.containers = { SIZE, IN, FUEL, OUT, create, furnaceTick, furnaceTarget, pack, unpack, key };
})(typeof window !== 'undefined' ? window : globalThis);
