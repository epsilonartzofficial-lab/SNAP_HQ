'use strict';
// World-systems blocks (ids 21–29): torch, sapling, falling blocks, plants. Owned by the lighting/world-systems workstream.
//
// Block behaviours used by world.js (all optional on a block definition):
//   canPlace(W, x, y, z, face) / placeAs(W, x, y, z, face, player)  placement rules (called by game.js)
//   onNeighbor(W, x, y, z)       a neighbour changed (also runs once when the block itself is placed)
//   randomTick(W, x, y, z, rand) the block was picked by a random tick (3 per 16x16x16 section per game tick)
//   falls: true                  falls as an entity when the block below is air or liquid (sand, gravel)
//   shape: 'cross' | 'torch'     rendered shape; shaped blocks never hide their neighbours' faces
//   attach: [dx, dy, dz]         (torches) where the supporting block is
// `W` is the world object from world.js (getBlock, setBlock, dropItem, getLight, batch, ...).
(function (root) {
  const BC = root.BC;
  const { B, DEFS, SOLID, SHAPE, register } = BC.blocks;

  // A block a torch can stand on or hang from: a solid full cube (not cactus, whose sides are not full faces).
  const NO_SUPPORT = new Set(['cactus']);
  const supports = id => SOLID[id] === 1 && SHAPE[id] === 'cube' && !NO_SUPPORT.has(DEFS[id].key) && !DEFS[id].noSupport;
  // Break a block that lost its support and drop its item (W.dropItem only drops in Survival).
  function popOff(W, x, y, z, key) {
    W.setBlock(x, y, z, 0);
    if (W.dropItem && BC.items) W.dropItem(BC.items.make(key, 1), x, y, z);
  }

  // ---------------------------------------------------------------- torches
  // The standing torch (21) is the item; wall torches (22-25) are placed by it and drop it. A wall torch's name says
  // which way it points; its support is the block behind it.
  const torchSupported = (W, x, y, z, id) => { const a = DEFS[id].attach; return supports(W.getBlock(x + a[0], y + a[1], z + a[2])); };
  const torchCheck = (W, x, y, z) => { const id = W.getBlock(x, y, z); if (!torchSupported(W, x, y, z, id)) popOff(W, x, y, z, 'torch'); };
  const WALLS = [
    { id: 22, key: 'wall_torch_north', f: [0, -1] },
    { id: 23, key: 'wall_torch_south', f: [0, 1] },
    { id: 24, key: 'wall_torch_west', f: [-1, 0] },
    { id: 25, key: 'wall_torch_east', f: [1, 0] },
  ];
  const wallFor = (fx, fz) => WALLS.find(w => w.f[0] === fx && w.f[1] === fz).id;
  // Placement options in order of preference: the clicked face, then the floor, then walls starting with the one
  // the player looks at (as the reference game tries the nearest looking directions).
  function torchOptions(face, player) {
    const out = [];
    if (face && face[1] === 1) out.push(21);
    else if (face && face[1] === 0) out.push(wallFor(face[0], face[2]));
    out.push(21);
    const yaw = player && typeof player.yaw === 'number' ? player.yaw : 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    WALLS.slice().sort((a, b) => (fx * a.f[0] + fz * a.f[1]) - (fx * b.f[0] + fz * b.f[1])).forEach(w => out.push(w.id));
    return out;
  }
  const torchChoice = (W, x, y, z, face, player) => torchOptions(face, player).find(id => torchSupported(W, x, y, z, id)) || 0;

  const TORCH_BASE = { tex: 'torch', shape: 'torch', solid: false, light: 14, hardness: 0, onNeighbor: torchCheck };
  register(21, Object.assign({ key: 'torch', name: 'Torch', attach: [0, -1, 0],
    canPlace: (W, x, y, z, face) => !!torchChoice(W, x, y, z, face, null),
    placeAs: (W, x, y, z, face, player) => torchChoice(W, x, y, z, face, player) || 21 }, TORCH_BASE));
  for (const w of WALLS) register(w.id, Object.assign({ key: w.key, name: 'Wall Torch', attach: [-w.f[0], 0, -w.f[1]], facing: w.f, item: false, drop: 'torch' }, TORCH_BASE));

  // ---------------------------------------------------------------- saplings and trees
  const SOIL = new Set(['grass_block', 'dirt', 'snowy_grass_block']);
  const isSoil = id => !!DEFS[id] && (SOIL.has(DEFS[id].key) || !!DEFS[id].soil);
  // Grow an oak tree from the sapling at (x, y, z), with the v1 generator's shape: a 4-6 block trunk and a leaf crown
  // of two 5x5 layers (random corners) and two 3x3 layers (no corners). Needs a clear trunk and loaded chunks.
  function growOak(W, x, y, z, rand) {
    const th = 4 + Math.floor(rand() * 3), ty = y - 1 + th;
    if (ty + 1 >= BC.C.WH) return false;
    for (let yy = y + 1; yy <= ty + 1; yy++) { const b = W.getBlock(x, yy, z); if (b && b !== B.OAK_LEAVES) return false; }
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) if (W.hasChunk && !W.hasChunk(x + dx, z + dz)) return false;
    const put = () => {
      for (let ly = ty - 2; ly <= ty + 1; ly++) {
        const rad = ly <= ty - 1 ? 2 : 1;
        for (let oz = -rad; oz <= rad; oz++) for (let ox = -rad; ox <= rad; ox++) {
          const corner = Math.abs(ox) === rad && Math.abs(oz) === rad;
          if (corner && (ly === ty + 1 || rad === 1 || rand() < 0.5)) continue;
          if (ox === 0 && oz === 0 && ly <= ty) continue;
          if (W.getBlock(x + ox, ly, z + oz) === 0) W.setBlock(x + ox, ly, z + oz, B.OAK_LEAVES);
        }
      }
      for (let yy = y; yy <= ty; yy++) W.setBlock(x, yy, z, B.OAK_LOG);
      W.setBlock(x, y - 1, z, B.DIRT);
    };
    if (W.batch) W.batch(put); else put();
    return true;
  }
  register(26, {
    key: 'oak_sapling', name: 'Oak Sapling', tex: 'oak_sapling', shape: 'cross', solid: false, hardness: 0,
    canPlace: (W, x, y, z) => isSoil(W.getBlock(x, y - 1, z)),
    onNeighbor: (W, x, y, z) => { if (!isSoil(W.getBlock(x, y - 1, z))) popOff(W, x, y, z, 'oak_sapling'); },
    // Reference: with light >= 9 above, 1 in 7 random ticks advances one of two growth stages. Vibecraft has no
    // block states, so the tree grows in one step with chance 1/14 (the same average: about 16 minutes loaded).
    randomTick: (W, x, y, z, rand) => { if (W.getLight(x, y + 1, z) >= 9 && rand() < 1 / 14) growOak(W, x, y, z, rand); },
    grow: growOak,
  });

  // ---------------------------------------------------------------- grass (random ticks, reference rules)
  // Grass turns to dirt when an opaque block or water covers it. With light >= 9 above, each tick it tries 4 random
  // spots in x±1, y-3..+1, z±1 and turns dirt with a clear, dry top into grass.
  const { OPAQUE, LIQUID } = BC.blocks;
  const canBeGrass = (W, x, y, z) => { const a = W.getBlock(x, y + 1, z); return !OPAQUE[a] && !LIQUID[a]; };
  function grassTick(W, x, y, z, rand) {
    if (!canBeGrass(W, x, y, z)) { W.setBlock(x, y, z, B.DIRT); return; }
    if (W.getLight(x, y + 1, z) < 9) return;
    for (let i = 0; i < 4; i++) {
      const tx = x + Math.floor(rand() * 3) - 1, ty = y + Math.floor(rand() * 5) - 3, tz = z + Math.floor(rand() * 3) - 1;
      if (W.getBlock(tx, ty, tz) === B.DIRT && canBeGrass(W, tx, ty, tz)) W.setBlock(tx, ty, tz, B.GRASS_BLOCK);
    }
  }
  DEFS[B.GRASS_BLOCK].randomTick = grassTick;
  DEFS[B.SNOWY_GRASS_BLOCK].randomTick = grassTick;

  BC.worldBlocks = { supports, torchOptions, growOak, isSoil, canBeGrass, WALLS };
})(typeof window !== 'undefined' ? window : globalThis);
