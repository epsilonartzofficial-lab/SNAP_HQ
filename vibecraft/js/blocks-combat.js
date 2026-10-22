'use strict';
// Creatures-and-combat blocks: beds (ids 36–39, the Stage 2 utility range) and wool (120, creatures range).
// A bed is two full blocks, a foot and a head, lying along the x or z axis. The rendered world only has cube
// blocks, so a bed is a full cube rather than the reference game's 9/16-high frame (see docs/FEATURES.md).
// The bed item (items-combat.js) places the foot where you click and the head one block further along your view.
(function (root) {
  const BC = root.BC;
  const { register, DEFS, SOLID, LIQUID } = BC.blocks;

  register(120, { key: 'wool', name: 'Wool', tex: 'wool', hardness: 0.8 });

  const bedTex = (part, axis) => ({ top: `bed_${part}_top_${axis}`, side: `bed_${part}_side`, bottom: 'planks', front: `bed_${part}_end` });
  const base = { hardness: 0.2, use: 'bed', item: false, drop: 'bed' };
  // bed: which half; bedAxis: the axis the bed lies along. Heads and feet on the same axis pair up.
  register(36, Object.assign({ key: 'bed_foot', name: 'Bed', tex: bedTex('foot', 'z'), bed: 'foot', bedAxis: 'z' }, base));
  register(37, Object.assign({ key: 'bed_head', name: 'Bed', tex: bedTex('head', 'z'), bed: 'head', bedAxis: 'z' }, base));
  register(38, Object.assign({ key: 'bed_foot_x', name: 'Bed', tex: bedTex('foot', 'x'), frontAxis: 'x', bed: 'foot', bedAxis: 'x' }, base));
  register(39, Object.assign({ key: 'bed_head_x', name: 'Bed', tex: bedTex('head', 'x'), frontAxis: 'x', bed: 'head', bedAxis: 'x' }, base));
  const PART = { foot: { z: 36, x: 38 }, head: { z: 37, x: 39 } };

  const isBed = id => !!(DEFS[id] && DEFS[id].bed);
  const free = id => id === 0 || LIQUID[id] === 1;
  // The direction the player looks along, snapped to the dominant horizontal axis.
  function facing(player) {
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    return Math.abs(fx) > Math.abs(fz) ? { axis: 'x', dx: Math.sign(fx) || 1, dz: 0 } : { axis: 'z', dx: 0, dz: Math.sign(fz) || 1 };
  }
  // The other half of the bed at (x, y, z), or null for a lone half. Placement never puts two beds end to end on the
  // same axis, so a half has at most one partner; if commands created an ambiguous row, the first match wins.
  function partner(world, x, y, z) {
    const d = DEFS[world.getBlock(x, y, z)];
    if (!d || !d.bed) return null;
    const want = PART[d.bed === 'foot' ? 'head' : 'foot'][d.bedAxis];
    for (const s of [1, -1]) {
      const px = d.bedAxis === 'x' ? x + s : x, pz = d.bedAxis === 'z' ? z + s : z;
      if (world.getBlock(px, y, pz) === want) return { x: px, y, z: pz, id: want };
    }
    return null;
  }
  // The head block of the bed at (x, y, z) (itself for a head or a lone half).
  function head(world, x, y, z) {
    const d = DEFS[world.getBlock(x, y, z)];
    if (!d || !d.bed) return null;
    if (d.bed === 'head') return { x, y, z };
    const p = partner(world, x, y, z);
    return p ? { x: p.x, y: p.y, z: p.z } : { x, y, z };
  }
  // Blocks a bed placed at (x, y, z) would occupy: [[x, y, z, id], ...], or null when there is no room.
  function placement(world, x, y, z, player) {
    const f = facing(player), hx = x + f.dx, hz = z + f.dz;
    if (!free(world.getBlock(x, y, z)) || !free(world.getBlock(hx, y, hz)) || y < 0 || y >= BC.C.WH) return null;
    // Keep beds from touching end to end on the same axis, so each half has exactly one partner.
    const blocked = (bx, bz) => { const d = DEFS[world.getBlock(bx, y, bz)]; return !!(d && d.bed && d.bedAxis === f.axis); };
    if (blocked(x - f.dx, z - f.dz) || blocked(hx + f.dx, hz + f.dz)) return null;
    return [[x, y, z, PART.foot[f.axis]], [hx, y, hz, PART.head[f.axis]]];
  }
  // Where a player can stand up next to a bed: a free two-high cell with a solid floor, nearest to the head first.
  function standUp(world, x, y, z) {
    const h = head(world, x, y, z) || { x, y, z }, p = partner(world, h.x, h.y, h.z);
    const cells = [];
    for (const c of [h, p].filter(Boolean)) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) for (const dy of [0, 1, -1]) cells.push([c.x + dx, c.y + dy, c.z + dz]);
    cells.push([h.x, h.y + 1, h.z]);
    for (const [cx, cy, cz] of cells) {
      if (isBed(world.getBlock(cx, cy, cz))) continue;
      if (!SOLID[world.getBlock(cx, cy, cz)] && !SOLID[world.getBlock(cx, cy + 1, cz)] && !LIQUID[world.getBlock(cx, cy, cz)] && SOLID[world.getBlock(cx, cy - 1, cz)]) return { x: cx + 0.5, y: cy, z: cz + 0.5 };
    }
    return null;
  }

  BC.beds = { PART, isBed, facing, partner, head, placement, standUp };
})(typeof window !== 'undefined' ? window : globalThis);
