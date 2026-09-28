'use strict';
// Dropped item stacks: physics, merging, pickup, despawn and persistence.
(function (root) {
  const BC = root.BC;
  const { SOLID, LIQUID } = BC.blocks;
  const IT = BC.items;
  const INV = BC.inv;
  const DESPAWN = 300;      // seconds, as in the reference game (6000 ticks)
  const CAP = 2000;   // safety limit; the oldest stack is removed beyond it (the reference game has no cap)

  function create(world, render) {
    const list = [];
    let mergeT = 0;
    const solidAt = (x, y, z) => SOLID[world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))] === 1;

    function spawn(stack, x, y, z, vx, vy, vz, delay, age) {
      if (!stack || !IT.get(stack.id) || stack.count <= 0) return null;
      const e = { id: stack.id, count: stack.count, dmg: stack.dmg || 0, x, y, z, vx: vx || 0, vy: vy || 0, vz: vz || 0, age: age || 0, delay: delay == null ? 0.5 : delay, phase: Math.random() * 6.28, mesh: null, onGround: false };
      list.push(e);
      if (list.length > CAP) remove(list[0]);
      return e;
    }
    // Pop an item out of a broken block, like the reference game.
    function drop(stack, bx, by, bz) {
      const r = Math.random;
      return spawn(stack, bx + 0.25 + r() * 0.5, by + 0.25 + r() * 0.5, bz + 0.25 + r() * 0.5, (r() - 0.5) * 2, 2 + r() * 1.5, (r() - 0.5) * 2, 0.5);
    }
    // Throw an item from the player in the look direction.
    function toss(stack, eye, dir, delay) {
      const r = Math.random;
      return spawn(stack, eye.x + dir.x * 0.3, eye.y - 0.3, eye.z + dir.z * 0.3, dir.x * 6 + (r() - 0.5) * 0.4, dir.y * 6 + 2, dir.z * 6 + (r() - 0.5) * 0.4, delay == null ? 2 : delay);
    }
    // Scatter a stack around a point (death drops).
    function scatter(stack, x, y, z) {
      const r = Math.random, a = r() * Math.PI * 2, s = r() * 2.5;
      return spawn(stack, x, y + 0.6, z, Math.cos(a) * s, 3 + r() * 2, Math.sin(a) * s, 2);
    }
    function remove(e) {
      const i = list.indexOf(e); if (i >= 0) list.splice(i, 1);
      if (e.mesh && render) render.removeMesh(e.mesh); e.mesh = null;
    }
    function clear() { for (const e of list.slice()) remove(e); }

    function physics(e, dt) {
      const inWater = LIQUID[world.getBlock(Math.floor(e.x), Math.floor(e.y + 0.1), Math.floor(e.z))] === 1;
      if (solidAt(e.x, e.y + 0.05, e.z)) { e.y = Math.floor(e.y + 0.05) + 1; e.vy = 0; }   // pushed out when a block is placed on it
      if (inWater) { e.vy += (4 - e.vy) * Math.min(1, dt * 2) * 0.5; e.vx *= Math.exp(-3 * dt); e.vz *= Math.exp(-3 * dt); }
      else e.vy = Math.max(e.vy - 16 * dt, -40);
      // substep so fast items never skip through a one-block floor or wall
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(e.vx), Math.abs(e.vy), Math.abs(e.vz)) * dt / 0.4));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const ny = e.y + e.vy * h;
        if (e.vy < 0 && solidAt(e.x, ny, e.z)) { e.y = Math.floor(ny) + 1; e.vy = 0; e.onGround = true; }
        else if (e.vy > 0 && solidAt(e.x, ny + 0.25, e.z)) { e.vy = 0; }
        else { e.y = ny; if (e.vy !== 0) e.onGround = false; }
        const nx = e.x + e.vx * h; if (solidAt(nx, e.y + 0.1, e.z)) e.vx = 0; else e.x = nx;
        const nz = e.z + e.vz * h; if (solidAt(e.x, e.y + 0.1, nz)) e.vz = 0; else e.z = nz;
      }
      const damp = Math.exp((e.onGround ? -10 : -0.4) * dt); e.vx *= damp; e.vz *= damp;
    }
    function mergeNearby() {
      for (let i = 0; i < list.length; i++) {
        const a = list[i]; if (!a.active) continue;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          if (!b.active || a.id !== b.id || a.dmg || b.dmg) continue;
          const m = IT.maxStack(a.id);
          if (m <= 1 || a.count + b.count > m) continue;
          if (Math.abs(a.x - b.x) > 0.5 || Math.abs(a.z - b.z) > 0.5 || Math.abs(a.y - b.y) > 0.5) continue;
          a.count += b.count; a.age = Math.min(a.age, b.age); a.delay = Math.max(a.delay, b.delay); remove(b); j--;
        }
      }
    }

    // `player` = {x,y,z, alive}; `pickup(stack)` returns the count that did not fit.
    function update(dt, player, pickup) {
      mergeT += dt;
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        e.active = world.chunkReady(e.x, e.z);
        if (!e.active) { if (e.mesh && render) { render.removeMesh(e.mesh); e.mesh = null; } continue; }
        e.age += dt; if (e.delay > 0) e.delay -= dt;
        if (e.age > DESPAWN || e.y < -64) { remove(e); continue; }
        physics(e, dt);
        if (player && player.alive && e.delay <= 0 && Math.abs(e.x - player.x) < 1.3 && Math.abs(e.z - player.z) < 1.3 && e.y > player.y - 0.6 && e.y < player.y + 2.3) {
          const left = pickup({ id: e.id, count: e.count, dmg: e.dmg || undefined });
          if (left <= 0) { remove(e); continue; }
          e.count = left;
        }
        if (render) {
          if (!e.mesh) e.mesh = render.itemMesh(e.id);
          const d = IT.get(e.id), lift = d.kind === 'block' ? 0.14 : 0.22;
          e.mesh.position.set(e.x, e.y + lift + Math.sin(e.age * 2.2 + e.phase) * 0.06, e.z);
          e.mesh.rotation.y = e.age * 1.3 + e.phase;
        }
      }
      if (mergeT > 0.5) { mergeT = 0; mergeNearby(); }
    }

    const pack = () => list.map(e => [e.id, e.count, e.dmg || 0, +e.x.toFixed(2), +e.y.toFixed(2), +e.z.toFixed(2), Math.round(e.age), +Math.max(0, e.delay).toFixed(2)]);
    function load(arr) {
      for (const a of arr || []) {
        const d = IT.get(a[0]); if (!d || !(a[1] > 0)) continue;
        const s = { id: a[0], count: Math.min(a[1] | 0, d.maxStack) }; if (d.tool) s.dmg = a[2] | 0;
        spawn(s, +a[3] || 0, +a[4] || 0, +a[5] || 0, 0, 0, 0, +a[7] || 0, +a[6] || 0);
      }
    }
    const count = () => list.length;
    const totalItems = id => list.reduce((n, e) => n + (id == null || e.id === id ? e.count : 0), 0);

    return { list, spawn, drop, toss, scatter, remove, clear, update, pack, load, count, totalItems, INV };
  }

  BC.entities = { create, DESPAWN };
})(typeof window !== 'undefined' ? window : globalThis);
