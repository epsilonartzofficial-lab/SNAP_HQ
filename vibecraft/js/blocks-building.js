'use strict';
// Building blocks with orientation (block states): logs along any axis, and slabs and stairs that can face every
// way, including vertical and upside down. Ids 160–191 (see docs/ROADMAP.md, "Id ranges").
//
// State byte (stored per block next to its id; see world.js getState/setBlock):
//   logs   — axis: 0 vertical (y), 1 along x, 2 along z
//   slabs  — the face the half-block sits against, in FACES order: 0 −x, 1 +x, 2 −y (bottom slab), 3 +y (top), 4 −z, 5 +z
//   stairs — base * 4 + k: `base` is the face the full half sits against (as for slabs), and the step (the tall
//            quarter) sits on the other half toward PERP[base][k]
(function (root) {
  const BC = root.BC;
  const { DEFS } = BC.blocks;
  const DIRS = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
  const opposite = f => f ^ 1;
  const faceOf = (x, y, z) => DIRS.findIndex(d => d[0] === x && d[1] === y && d[2] === z);
  // The four directions perpendicular to each face, in a fixed order.
  const PERP = DIRS.map((d, f) => [0, 1, 2, 3, 4, 5].filter(g => g >> 1 !== f >> 1));

  // Half of the unit cube against face f, as [x0, y0, z0, x1, y1, z1].
  function half(f) {
    const b = [0, 0, 0, 1, 1, 1], a = f >> 1;
    if (f & 1) b[a] = 0.5; else b[a + 3] = 0.5;
    return b;
  }
  // Intersection of two boxes.
  const meet = (p, q) => [Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.max(p[2], q[2]), Math.min(p[3], q[3]), Math.min(p[4], q[4]), Math.min(p[5], q[5])];

  const SLAB_BOXES = DIRS.map((_, f) => [half(f)]);
  const STAIR_BOXES = [];
  for (let base = 0; base < 6; base++) for (let k = 0; k < 4; k++) {
    const step = PERP[base][k];
    STAIR_BOXES[base * 4 + k] = [half(base), meet(half(opposite(base)), half(step))];
  }

  // Collision and outline boxes of a block in its own cell (null = the full cube).
  function boxes(id, state) {
    const d = DEFS[id];
    if (!d) return null;
    if (d.shape === 'slab') return SLAB_BOXES[state] || SLAB_BOXES[2];
    if (d.shape === 'stairs') return STAIR_BOXES[state] || STAIR_BOXES[8];
    return null;
  }

  // State for a block placed against face normal n (the clicked face) by a player looking along look (unit vector).
  // hitY: height of the hit point within the clicked block (0..1); sneak: hold to place a horizontal slab on a wall.
  function placementState(id, n, look, hitY, sneak) {
    const d = DEFS[id];
    if (!d) return 0;
    if (d.axis) return n[0] ? 1 : n[2] ? 2 : 0;
    if (d.shape !== 'slab' && d.shape !== 'stairs') return 0;
    let base = opposite(faceOf(n[0], n[1], n[2]));   // against the clicked face
    if (sneak && n[1] === 0) base = hitY > 0.5 ? 3 : 2;   // on a wall: top or bottom half, as the reference game
    if (d.shape === 'slab') return base;
    // stairs: the tall step goes the way the player looks, among the directions perpendicular to the base
    const perp = PERP[base];
    let best = 0, bestV = -Infinity;
    for (let k = 0; k < 4; k++) {
      const v = DIRS[perp[k]][0] * look[0] + DIRS[perp[k]][1] * look[1] + DIRS[perp[k]][2] * look[2];
      if (v > bestV) { bestV = v; best = k; }
    }
    return base * 4 + best;
  }

  // ---- registrations
  // Logs: every *_log block turns along the axis of the face it is placed on.
  for (const d of DEFS) if (d && /_log$/.test(d.key)) d.axis = true;

  const MATERIALS = ['oak_planks', 'spruce_planks', 'birch_planks', 'acacia_planks', 'mahogany_planks', 'willow_planks',
    'cobblestone', 'stone', 'stone_bricks', 'bricks', 'sandstone', 'red_sandstone', 'granite', 'limestone', 'slate', 'mossy_cobblestone'];
  const MADE = [];
  let id = 160;
  for (const mk of MATERIALS) {
    const m = BC.blocks.BY_KEY[mk];
    const stem = mk.endsWith('_planks') ? mk.replace(/_planks$/, '') : mk.replace(/bricks$/, 'brick');
    if (!m) { id += 2; continue; }   // keep ids stable even if a material is missing
    const common = { tex: m.tex, hardness: m.hardness, tool: m.tool, tier: m.tier, material: mk };
    const nm = m.name.replace(/ Planks$/, '');
    BC.blocks.register(id, Object.assign({ key: stem + '_slab', name: nm + ' Slab', shape: 'slab', stateful: true }, common));
    BC.blocks.register(id + 1, Object.assign({ key: stem + '_stairs', name: nm + ' Stairs', shape: 'stairs', stateful: true }, common));
    MADE.push({ material: mk, slab: stem + '_slab', stairs: stem + '_stairs' });
    id += 2;
  }

  BC.building = { DIRS, PERP, boxes, placementState, SLAB_BOXES, STAIR_BOXES, MATERIALS: MADE };
})(typeof window !== 'undefined' ? window : globalThis);
