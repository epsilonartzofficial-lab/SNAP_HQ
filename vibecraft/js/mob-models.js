'use strict';
// Creature models: cuboid parts with procedurally painted skins (all original art), animation (walk cycle, head
// look, attack swing, hurt flash, death tip-over, burning), arrows, hit particles and health bars.
// Everything is added to the scene through BC.render.scene; render.js itself is not modified.
// The last section registers the developer-toolkit commands and the Creatures tab (this file loads after devtools.js).
(function (root) {
  const BC = root.BC;
  const { mulberry32, hashStr, clamp } = BC.util;
  const PX = 1 / 16;

  // ════════════════════════════════════════════════════════════════ skins
  // A skin is a canvas; every box face gets its own rectangle (shelf-packed), painted by the model's painter and
  // shaded by face direction like the terrain (top brightest, bottom darkest).
  const FACE_SHADE = { top: 1.0, left: 0.86, right: 0.86, front: 0.8, back: 0.74, bottom: 0.56 };
  function makeSkin(seedKey) {
    const W = 256, H = 256;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    let sx = 0, sy = 0, row = 0;
    function rect(w, h) {
      w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
      if (sx + w > W) { sx = 0; sy += row + 1; row = 0; }
      if (sy + h > H) throw new Error('creature skin atlas full: ' + seedKey);
      const r = { x: sx, y: sy, w, h }; sx += w + 1; row = Math.max(row, h);
      return r;
    }
    function paint(r, face, fn, seed) {
      const rnd = mulberry32(hashStr(seedKey + ':' + seed + ':' + face));
      const shade = FACE_SHADE[face];
      const img = ctx.createImageData(r.w, r.h);
      const px = (x, y, c) => {
        x = Math.floor(x); y = Math.floor(y);
        if (x < 0 || y < 0 || x >= r.w || y >= r.h || !c) return;
        const i = (y * r.w + x) * 4, k = c[3] === 'glow' ? 1 : shade;   // glowing pixels (eyes, crystals) skip shading
        img.data[i] = clamp(Math.round(c[0] * k), 0, 255); img.data[i + 1] = clamp(Math.round(c[1] * k), 0, 255); img.data[i + 2] = clamp(Math.round(c[2] * k), 0, 255); img.data[i + 3] = 255;
      };
      fn(face, px, r.w, r.h, rnd);
      ctx.putImageData(img, r.x, r.y);
    }
    return { canvas, rect, paint, W, H, tex: null };
  }
  const jit = (c, r, v) => { const k = (r() - 0.5) * v; return [c[0] + k, c[1] + k, c[2] + k]; };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const glow = c => [c[0], c[1], c[2], 'glow'];
  function fill(px, w, h, r, c, v) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, jit(c, r, v == null ? 14 : v)); }
  function blob(px, cx, cy, rad, c, r, w, h) {
    for (let y = Math.floor(cy - rad); y <= cy + rad; y++) for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= rad - (r() * 0.6)) px(x, y, jit(c, r, 10));
    }
  }

  // ════════════════════════════════════════════════════════════════ geometry
  // Box corners per face, ordered top-left, top-right, bottom-left, bottom-right as the face's image appears when seen
  // from outside. The model faces -z; "right" is +x (the creature's own right side).
  function faceCorners(f, x0, y0, z0, x1, y1, z1) {
    switch (f) {
      case 'right': return [[x1, y1, z1], [x1, y1, z0], [x1, y0, z1], [x1, y0, z0]];
      case 'left': return [[x0, y1, z0], [x0, y1, z1], [x0, y0, z0], [x0, y0, z1]];
      case 'top': return [[x0, y1, z0], [x1, y1, z0], [x0, y1, z1], [x1, y1, z1]];
      case 'bottom': return [[x0, y0, z1], [x1, y0, z1], [x0, y0, z0], [x1, y0, z0]];
      case 'back': return [[x0, y1, z1], [x1, y1, z1], [x0, y0, z1], [x1, y0, z1]];
      default: return [[x1, y1, z0], [x0, y1, z0], [x1, y0, z0], [x0, y0, z0]];   // front
    }
  }
  const FACES = ['right', 'left', 'top', 'bottom', 'back', 'front'];
  function faceSize(f, s) { return f === 'right' || f === 'left' ? [s[2], s[1]] : f === 'top' || f === 'bottom' ? [s[0], s[2]] : [s[0], s[1]]; }
  // Build one geometry for a part from its boxes: {o: [x, y, z] corner (pixels, relative to the part pivot), s: size,
  // paint: fn(face, px, w, h, rnd), rot?: [rx, ry, rz] about the box centre, inflate?}.
  function partGeometry(skin, boxes, seed) {
    const pos = [], uv = [], idx = [];
    boxes.forEach((b, bi) => {
      const infl = b.inflate || 0;
      const x0 = b.o[0] - infl, y0 = b.o[1] - infl, z0 = b.o[2] - infl, x1 = b.o[0] + b.s[0] + infl, y1 = b.o[1] + b.s[1] + infl, z1 = b.o[2] + b.s[2] + infl;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
      let rotM = null;
      if (b.rot) { rotM = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(b.rot[0], b.rot[1], b.rot[2], 'YXZ')); }
      const v3 = new THREE.Vector3();
      for (const f of FACES) {
        const [fw, fh] = faceSize(f, b.s);
        const r = skin.rect(fw, fh);
        skin.paint(r, f, b.paint, seed + ':' + bi);
        const c = faceCorners(f, x0, y0, z0, x1, y1, z1);
        const u0 = r.x / skin.W, u1 = (r.x + r.w) / skin.W, vt = 1 - r.y / skin.H, vb = 1 - (r.y + r.h) / skin.H;
        const base = pos.length / 3;
        const uvs = [[u0, vt], [u1, vt], [u0, vb], [u1, vb]];
        for (let k = 0; k < 4; k++) {
          v3.set(c[k][0], c[k][1], c[k][2]);
          if (rotM) { v3.x -= cx; v3.y -= cy; v3.z -= cz; v3.applyMatrix4(rotM); v3.x += cx; v3.y += cy; v3.z += cz; }
          pos.push(v3.x * PX, v3.y * PX, v3.z * PX); uv.push(uvs[k][0], uvs[k][1]);
        }
        idx.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  // ════════════════════════════════════════════════════════════════ painters
  // Each painter receives (face, px, w, h, rnd). Colours are [r, g, b]; glow(c) ignores face shading.
  const P = {};
  // ---- pig: pink with dark spots (a spotted farm breed), floppy ears, round snout
  P.pigSkin = [238, 172, 160]; P.pigSpot = [84, 60, 64];
  const pigBody = (face, px, w, h, r) => {
    fill(px, w, h, r, P.pigSkin, 12);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (r() < 0.05) px(x, y, [226, 150, 142]);
    const n = face === 'top' ? 3 : face === 'bottom' ? 0 : 2;
    for (let k = 0; k < n; k++) blob(px, 1 + r() * (w - 2), 1 + r() * (h - 2), 1.4 + r() * 1.6, P.pigSpot, r);
    if (face === 'bottom') fill(px, w, h, r, [226, 158, 150], 8);
  };
  const pigHead = (face, px, w, h, r) => {
    fill(px, w, h, r, P.pigSkin, 10);
    if (face === 'front') {
      blob(px, 1.6, 2.2, 2.2, P.pigSpot, r);   // a spot around its right eye
      for (const ex of [1, w - 3]) { px(ex, 2, [250, 250, 244]); px(ex + 1, 2, [34, 26, 30]); px(ex, 3, [236, 160, 150]); }
      px(1, 1, [60, 44, 46]);
    }
    if (face === 'top') blob(px, w - 2, 2, 1.6, P.pigSpot, r);
  };
  const pigSnout = (face, px, w, h, r) => {
    fill(px, w, h, r, [246, 150, 150], 8);
    if (face === 'front') { px(1, 1, [128, 62, 72]); px(w - 2, 1, [128, 62, 72]); for (let x = 0; x < w; x++) px(x, 0, [250, 170, 168]); }
  };
  const pigEar = (face, px, w, h, r) => { fill(px, w, h, r, face === 'bottom' ? [214, 124, 124] : [232, 160, 150], 8); };
  const pigLeg = (face, px, w, h, r) => { fill(px, w, h, r, P.pigSkin, 10); if (face !== 'top' && face !== 'bottom') for (let x = 0; x < w; x++) { px(x, h - 1, [96, 70, 66]); } if (face === 'bottom') fill(px, w, h, r, [90, 66, 62], 6); };
  const pigTail = (face, px, w, h, r) => fill(px, w, h, r, [230, 150, 146], 8);

  // ---- cow: shaggy long-haired cattle with a fringe over the eyes and wide horns (three coats)
  const COW_COATS = [[182, 98, 52], [214, 184, 128], [66, 56, 52]];
  const cowHair = coat => (face, px, w, h, r) => {
    const c = COW_COATS[coat];
    const cols = []; for (let x = 0; x < w; x++) cols.push((r() - 0.5) * 34);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let k = cols[x] + (r() - 0.5) * 12;
      if (face === 'top' || face === 'bottom') k = (r() - 0.5) * 26;
      px(x, y, [c[0] + k, c[1] + k * 0.8, c[2] + k * 0.6]);
    }
    if (face !== 'top' && face !== 'bottom') for (let x = 0; x < w; x++) if (r() < 0.5) px(x, h - 1, mix(c, [0, 0, 0], 0.25));   // shaggy hem
  };
  const cowHead = coat => (face, px, w, h, r) => {
    cowHair(coat)(face, px, w, h, r);
    if (face === 'front') { for (const ex of [1, w - 3]) { px(ex, 3, [30, 22, 20]); px(ex + 1, 3, [30, 22, 20]); px(ex, 2, [250, 244, 230]); } }
  };
  const cowFringe = coat => (face, px, w, h, r) => {
    const c = mix(COW_COATS[coat], [255, 240, 220], 0.12);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, jit([c[0] + (x % 2 ? 10 : -10), c[1] + (x % 2 ? 8 : -8), c[2]], r, 16));
    if (face === 'front') for (let x = 0; x < w; x++) if ((x * 7 + 3) % 3 === 0) px(x, h - 1, null);
  };
  const cowMuzzle = (face, px, w, h, r) => { fill(px, w, h, r, [222, 184, 160], 10); if (face === 'front') { px(1, 1, [96, 60, 56]); px(w - 2, 1, [96, 60, 56]); for (let x = 1; x < w - 1; x++) px(x, h - 1, [196, 150, 130]); } };
  const horn = (face, px, w, h, r) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, jit(x >= w - 1 || y === 0 ? [206, 190, 150] : [240, 230, 204], r, 8)); };
  const hornTip = (face, px, w, h, r) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, jit(y < 1 ? [90, 80, 70] : [220, 206, 170], r, 8)); };
  const cowLeg = coat => (face, px, w, h, r) => { cowHair(coat)(face, px, w, h, r); if (face !== 'top') for (let x = 0; x < w; x++) { px(x, h - 1, [52, 42, 36]); px(x, h - 2, [70, 56, 46]); } };

  // ---- sheep: round fleece, dark face with amber eyes, fleece cap, sideways ears
  const FLEECES = [[238, 232, 216], [56, 54, 58], [130, 128, 126], [188, 186, 182], [126, 88, 60], [240, 172, 190]];
  const fleece = v => (face, px, w, h, r) => {
    const c = FLEECES[v];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const curl = ((x + (y % 2) * 2) % 4 === 0) ? -18 : ((x + y * 3) % 5 === 0 ? 12 : 0);
      px(x, y, jit([c[0] + curl, c[1] + curl, c[2] + curl], r, 12));
    }
  };
  const sheepFace = [66, 52, 46];
  const sheepHead = (face, px, w, h, r) => {
    fill(px, w, h, r, sheepFace, 10);
    if (face === 'front') {
      for (const ex of [0, w - 2]) { px(ex, 2, [236, 190, 90]); px(ex + 1, 2, [236, 190, 90]); px(ex + (ex ? 0 : 1), 2, [30, 24, 20]); }
      px(Math.floor(w / 2) - 1, h - 2, [40, 32, 28]); px(Math.floor(w / 2), h - 2, [40, 32, 28]);
      for (let x = 1; x < w - 1; x++) px(x, h - 1, [92, 76, 68]);
    }
  };
  const sheepEar = (face, px, w, h, r) => fill(px, w, h, r, face === 'front' ? [150, 110, 104] : [74, 60, 54], 8);
  const sheepLeg = (face, px, w, h, r) => { fill(px, w, h, r, sheepFace, 8); if (face !== 'top') for (let x = 0; x < w; x++) px(x, h - 1, [36, 30, 28]); };

  // ---- chicken: speckled golden-brown hen with a red comb and wattle
  const henC = [194, 138, 74];
  const henBody = (face, px, w, h, r) => {
    fill(px, w, h, r, henC, 14);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const q = r(); if (q < 0.12) px(x, y, [240, 222, 184]); else if (q < 0.2) px(x, y, [120, 78, 42]); }
    if (face === 'bottom') fill(px, w, h, r, [226, 204, 162], 8);
  };
  const henHead = (face, px, w, h, r) => {
    fill(px, w, h, r, [204, 150, 84], 10);
    if (face === 'front') { px(0, 1, [20, 16, 16]); px(w - 1, 1, [20, 16, 16]); px(0, 0, [250, 240, 220]); px(w - 1, 0, [250, 240, 220]); }
    if (face === 'left' || face === 'right') { px(face === 'left' ? 1 : w - 2, 1, [20, 16, 16]); px(face === 'left' ? 1 : w - 2, 0, [250, 240, 220]); }
  };
  const beak = (face, px, w, h, r) => fill(px, w, h, r, [238, 172, 48], 8);
  const comb = (face, px, w, h, r) => fill(px, w, h, r, [214, 44, 40], 12);
  const henWing = (face, px, w, h, r) => { fill(px, w, h, r, [160, 104, 54], 12); for (let y = 1; y < h; y += 2) for (let x = 0; x < w; x++) px(x, y, [132, 84, 44]); };
  const henTail = (face, px, w, h, r) => { fill(px, w, h, r, [96, 62, 36], 12); for (let x = 0; x < w; x += 2) px(x, 0, [52, 70, 54]); };
  const henLeg = (face, px, w, h, r) => fill(px, w, h, r, [226, 152, 44], 8);

  // ---- Mirewalker: hunched bog corpse, peat skin, moss mantle, reed stalks, glowing marsh-light eyes
  const peat = [100, 110, 82], moss = [70, 112, 46], rag = [72, 56, 42];
  const mwSkin = (face, px, w, h, r) => {
    fill(px, w, h, r, peat, 16);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const q = r(); if (q < 0.1) px(x, y, [72, 80, 56]); else if (q < 0.15) px(x, y, [150, 158, 116]); }
  };
  const mwHead = (face, px, w, h, r) => {
    mwSkin(face, px, w, h, r);
    if (face === 'front') {
      for (const ex of [1, w - 3]) { px(ex, 3, [26, 30, 22]); px(ex + 1, 3, [26, 30, 22]); px(ex, 4, [26, 30, 22]); px(ex + 1, 4, [26, 30, 22]); px(ex, 3, glow([176, 255, 140])); }
      px(w - 2, 3, glow([176, 255, 140]));
      for (let x = 2; x < w - 2; x++) px(x, 6, [40, 34, 28]);
      px(3, 7, [40, 34, 28]); px(w - 4, 7, [40, 34, 28]);
    }
    if (face === 'top') for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (r() < 0.55) px(x, y, jit(moss, r, 30));
    if (face !== 'top' && face !== 'bottom' && face !== 'front') for (let x = 0; x < w; x++) for (let y = 0; y < 2 + r() * 2; y++) px(x, y, jit(moss, r, 30));
  };
  const mwMoss = (face, px, w, h, r) => {
    fill(px, w, h, r, moss, 30);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (r() < 0.15) px(x, y, [108, 150, 62]);
    if (face !== 'top' && face !== 'bottom') for (let x = 0; x < w; x++) if (r() < 0.4) px(x, h - 1, [46, 76, 30]);
  };
  const mwRags = (face, px, w, h, r) => {
    fill(px, w, h, r, rag, 14);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x + y * 2) % 7 === 0) px(x, y, [58, 44, 32]);
    if (face === 'front') { for (let y = 1; y < h - 2; y++) if (r() < 0.5) px(Math.floor(w / 2), y, [52, 40, 30]); }
    if (face !== 'top' && face !== 'bottom') for (let x = 0; x < w; x++) { const d = Math.floor(r() * 3); for (let y = h - d; y < h; y++) px(x, y, peat); }
  };
  const mwLeg = (face, px, w, h, r) => { mwRags(face, px, w, h, r); for (let x = 0; x < w; x++) if (face !== 'top') { px(x, h - 1, [52, 46, 36]); px(x, h - 2, [60, 52, 40]); } };
  const reed = (face, px, w, h, r) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, y === 0 ? [118, 84, 50] : jit([150, 150, 84], r, 18)); };
  const mossBeard = (face, px, w, h, r) => { fill(px, w, h, r, [62, 100, 40], 30); };

  // ---- Hollow Archer: hooded, bone-masked archer in faded cloth, with a quiver and a bow
  const cloth = [82, 100, 104], clothDark = [58, 70, 74], bonec = [226, 220, 198];
  const haCloth = (face, px, w, h, r) => { fill(px, w, h, r, cloth, 12); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x * 3 + y) % 5 === 0) px(x, y, jit(clothDark, r, 8)); };
  const haHood = (face, px, w, h, r) => {
    haCloth(face, px, w, h, r);
    if (face === 'front') {
      // an oval opening with a pale mask and two slit eyes
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) px(x, y, [22, 22, 28]);
      for (let y = 2; y < h - 1; y++) for (let x = 2; x < w - 2; x++) px(x, y, jit(bonec, r, 10));
      for (const ex of [2, w - 4]) { px(ex, 4, [20, 16, 24]); px(ex + 1, 4, [20, 16, 24]); }
      px(2, 4, glow([190, 150, 250])); px(w - 3, 4, glow([190, 150, 250]));
      px(Math.floor(w / 2) - 1, 6, [150, 140, 126]); px(Math.floor(w / 2), 6, [150, 140, 126]);
      for (let x = 3; x < w - 3; x++) px(x, h - 2, [168, 160, 140]);
    }
  };
  const haBody = (face, px, w, h, r) => {
    haCloth(face, px, w, h, r);
    for (let x = 0; x < w; x++) { px(x, 6, [86, 62, 40]); px(x, 7, [70, 50, 32]); }
    if (face === 'front') { px(Math.floor(w / 2), 6, [200, 180, 110]); for (let y = 0; y < 6; y++) px(y % 2 ? 2 : w - 3, y, [110, 80, 52]); }
  };
  const haLimb = (face, px, w, h, r) => { haCloth(face, px, w, h, r); if (face !== 'top') for (let x = 0; x < w; x++) { px(x, h - 1, bonec); px(x, h - 2, jit(bonec, r, 16)); } };
  const haLeg = (face, px, w, h, r) => { haCloth(face, px, w, h, r); if (face !== 'top') for (let x = 0; x < w; x++) { px(x, h - 1, [52, 42, 34]); px(x, h - 2, [66, 52, 40]); } };
  const quiver = (face, px, w, h, r) => { fill(px, w, h, r, [120, 80, 46], 12); for (let x = 0; x < w; x++) px(x, 1, [90, 58, 32]); if (face === 'top') { px(0, 0, [236, 236, 230]); px(w - 1, h - 1, [200, 60, 50]); px(1, 1, [236, 236, 230]); } };
  const fletch = (face, px, w, h, r) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, (x + y) % 2 ? [236, 234, 226] : [196, 70, 56]); };
  const bowWood = (face, px, w, h, r) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, y > h / 2 - 2 && y < h / 2 + 1 ? [180, 160, 120] : jit([110, 76, 44], r, 10)); };
  const bowString = (face, px, w, h, r) => fill(px, w, h, r, [220, 214, 196], 4);
  const cape = (face, px, w, h, r) => { haCloth(face, px, w, h, r); for (let x = 0; x < w; x++) { const d = Math.floor(r() * 3); for (let y = h - d; y < h; y++) px(x, y, clothDark); } };

  // ---- Cragskitter: six-legged stone crawler with amber crystal growths and a cluster of amber eyes
  const stone = [98, 100, 108], stoneDark = [66, 68, 76], amber = [255, 176, 58];
  const skStone = (face, px, w, h, r) => {
    fill(px, w, h, r, stone, 18);
    for (let k = 0; k < 3; k++) { let x = r() * w, y = r() * h; for (let s = 0; s < 5; s++) { px(x, y, stoneDark); x += r() < 0.5 ? 1 : 0; y += r() < 0.5 ? 1 : -1; } }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (r() < 0.05) px(x, y, [140, 142, 150]);
  };
  const skHead = (face, px, w, h, r) => {
    skStone(face, px, w, h, r);
    if (face === 'front') {
      const e = glow(amber), e2 = glow([255, 226, 120]);
      px(1, 1, e); px(2, 1, e); px(1, 2, e); px(2, 2, e2);
      px(w - 3, 1, e); px(w - 2, 1, e); px(w - 3, 2, e2); px(w - 2, 2, e);
      px(3, 3, e); px(w - 4, 3, e);
      for (let x = 2; x < w - 2; x++) px(x, h - 1, [44, 40, 40]);
    }
  };
  const crystal = (face, px, w, h, r) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, glow(x === 0 || y === 0 ? [255, 222, 140] : jit([238, 150, 46], r, 20))); };
  const skLeg = (face, px, w, h, r) => { fill(px, w, h, r, [84, 86, 94], 12); for (let x = 0; x < w; x++) if (x % 4 === 0) for (let y = 0; y < h; y++) px(x, y, stoneDark); };
  const mandible = (face, px, w, h, r) => fill(px, w, h, r, [52, 46, 44], 8);

  // ════════════════════════════════════════════════════════════════ model definitions
  // Part: {name, pivot: [x, y, z] pixels from the feet centre, boxes: [...], rot?: base rotation [x, y, z]}.
  // The model faces -z. Walk animations are keyed by part names.
  function defs(type, v) {
    switch (type) {
      case 'pig': return [
        { name: 'body', pivot: [0, 5, 0], boxes: [{ o: [-5, 0, -7], s: [10, 9, 14], paint: pigBody }, { o: [-0.5, 5, 7], s: [1, 1, 2], paint: pigTail }, { o: [-0.5, 6, 8.5], s: [1, 2, 1], paint: pigTail }] },
        { name: 'head', pivot: [0, 10, -7], boxes: [
          { o: [-4, -3, -7], s: [8, 7, 7], paint: pigHead }, { o: [-2.5, -2.5, -9], s: [5, 3.5, 2], paint: pigSnout },
          { o: [-4.8, 1.8, -5.5], s: [3, 1, 3.5], paint: pigEar, rot: [0.5, 0, 0.35] }, { o: [1.8, 1.8, -5.5], s: [3, 1, 3.5], paint: pigEar, rot: [0.5, 0, -0.35] }] },
        { name: 'legFL', pivot: [3, 5, -4.5], boxes: [{ o: [-1.5, -5, -1.5], s: [3, 5, 3], paint: pigLeg }] },
        { name: 'legFR', pivot: [-3, 5, -4.5], boxes: [{ o: [-1.5, -5, -1.5], s: [3, 5, 3], paint: pigLeg }] },
        { name: 'legBL', pivot: [3, 5, 5], boxes: [{ o: [-1.5, -5, -1.5], s: [3, 5, 3], paint: pigLeg }] },
        { name: 'legBR', pivot: [-3, 5, 5], boxes: [{ o: [-1.5, -5, -1.5], s: [3, 5, 3], paint: pigLeg }] },
      ];
      case 'cow': return [
        { name: 'body', pivot: [0, 11, 0], boxes: [{ o: [-6, 0, -9], s: [12, 10, 18], paint: cowHair(v) }, { o: [-1, -8, 9], s: [2, 9, 1.5], paint: cowHair(v), rot: [0.08, 0, 0] }, { o: [-1.5, -10, 9], s: [3, 3, 2], paint: cowHair(v) }] },
        { name: 'head', pivot: [0, 17, -9], boxes: [
          { o: [-4, -4, -6], s: [8, 8, 6], paint: cowHead(v) }, { o: [-4.5, 0.5, -6.8], s: [9, 4, 1.8], paint: cowFringe(v) },
          { o: [-3, -4, -8], s: [6, 4, 2], paint: cowMuzzle },
          { o: [4, 1.5, -4], s: [4, 2, 2], paint: horn }, { o: [7, 2.5, -4], s: [2, 3.5, 2], paint: hornTip, rot: [0, 0, -0.35] },
          { o: [-8, 1.5, -4], s: [4, 2, 2], paint: horn }, { o: [-9, 2.5, -4], s: [2, 3.5, 2], paint: hornTip, rot: [0, 0, 0.35] }] },
        { name: 'legFL', pivot: [3.5, 11, -6], boxes: [{ o: [-2, -11, -2], s: [4, 11, 4], paint: cowLeg(v) }] },
        { name: 'legFR', pivot: [-3.5, 11, -6], boxes: [{ o: [-2, -11, -2], s: [4, 11, 4], paint: cowLeg(v) }] },
        { name: 'legBL', pivot: [3.5, 11, 6.5], boxes: [{ o: [-2, -11, -2], s: [4, 11, 4], paint: cowLeg(v) }] },
        { name: 'legBR', pivot: [-3.5, 11, 6.5], boxes: [{ o: [-2, -11, -2], s: [4, 11, 4], paint: cowLeg(v) }] },
      ];
      case 'sheep': return [
        { name: 'body', pivot: [0, 8, 0], boxes: [{ o: [-6.5, 0, -8], s: [13, 11, 16], paint: fleece(v) }, { o: [-5.5, 1, 7.5], s: [11, 9, 1.5], paint: fleece(v) }] },
        { name: 'head', pivot: [0, 15, -8], boxes: [
          { o: [-3, -5, -6], s: [6, 7, 6], paint: sheepHead }, { o: [-3.5, 0.5, -5.5], s: [7, 3, 5], paint: fleece(v) },
          { o: [3, -1, -3], s: [3, 1.2, 2], paint: sheepEar, rot: [0, 0, -0.3] }, { o: [-6, -1, -3], s: [3, 1.2, 2], paint: sheepEar, rot: [0, 0, 0.3] }] },
        { name: 'legFL', pivot: [3.5, 8, -5], boxes: [{ o: [-1.5, -8, -1.5], s: [3, 8, 3], paint: sheepLeg }, { o: [-2, -3, -2], s: [4, 3, 4], paint: fleece(v) }] },
        { name: 'legFR', pivot: [-3.5, 8, -5], boxes: [{ o: [-1.5, -8, -1.5], s: [3, 8, 3], paint: sheepLeg }, { o: [-2, -3, -2], s: [4, 3, 4], paint: fleece(v) }] },
        { name: 'legBL', pivot: [3.5, 8, 5.5], boxes: [{ o: [-1.5, -8, -1.5], s: [3, 8, 3], paint: sheepLeg }, { o: [-2, -3, -2], s: [4, 3, 4], paint: fleece(v) }] },
        { name: 'legBR', pivot: [-3.5, 8, 5.5], boxes: [{ o: [-1.5, -8, -1.5], s: [3, 8, 3], paint: sheepLeg }, { o: [-2, -3, -2], s: [4, 3, 4], paint: fleece(v) }] },
      ];
      case 'chicken': return [
        { name: 'body', pivot: [0, 4, 0], boxes: [{ o: [-3, 0, -3.5], s: [6, 6, 8], paint: henBody }, { o: [-2, 3, 4], s: [4, 5, 2], paint: henTail, rot: [-0.35, 0, 0] }] },
        { name: 'head', pivot: [0, 9, -3], boxes: [
          { o: [-2, 0, -2.5], s: [4, 5, 3.5], paint: henHead }, { o: [-1, 2, -4.5], s: [2, 1.2, 2], paint: beak },
          { o: [-0.5, 5, -2.5], s: [1, 1.6, 3], paint: comb }, { o: [-0.6, 0.6, -3.6], s: [1.2, 1.6, 1], paint: comb }] },
        { name: 'wingL', pivot: [3, 9, -1], boxes: [{ o: [0, -4, -2], s: [1, 4, 6], paint: henWing }] },
        { name: 'wingR', pivot: [-3, 9, -1], boxes: [{ o: [-1, -4, -2], s: [1, 4, 6], paint: henWing }] },
        { name: 'legL', pivot: [1.5, 4, 0.5], boxes: [{ o: [-0.5, -4, -0.5], s: [1, 4, 1], paint: henLeg }, { o: [-1.5, -4, -2], s: [3, 0.6, 3], paint: henLeg }] },
        { name: 'legR', pivot: [-1.5, 4, 0.5], boxes: [{ o: [-0.5, -4, -0.5], s: [1, 4, 1], paint: henLeg }, { o: [-1.5, -4, -2], s: [3, 0.6, 3], paint: henLeg }] },
      ];
      case 'mirewalker': return [
        { name: 'body', pivot: [0, 12, 0], rot: [0.28, 0, 0], boxes: [{ o: [-4, 0, -2.5], s: [8, 11, 5], paint: mwRags }, { o: [-5.5, 8, -3.5], s: [11, 4, 7], paint: mwMoss }, { o: [-4.5, 5, -3], s: [9, 3, 6], paint: mwMoss }] },
        { name: 'head', pivot: [0, 23, -3], boxes: [
          { o: [-4, 0, -4], s: [8, 8, 8], paint: mwHead }, { o: [-2, -2.5, -4.6], s: [4, 3, 1], paint: mossBeard },
          { o: [2, 7, 0], s: [1, 5, 1], paint: reed, rot: [0.2, 0, -0.25] }, { o: [-3, 7, 1], s: [1, 4, 1], paint: reed, rot: [-0.2, 0, 0.3] }] },
        { name: 'armL', pivot: [5.5, 21, -2.5], boxes: [{ o: [-1.5, -14, -1.5], s: [3, 14, 3], paint: mwSkin }, { o: [-2, -4, -2], s: [4, 4, 4], paint: mwMoss }] },
        { name: 'armR', pivot: [-5.5, 21, -2.5], boxes: [{ o: [-1.5, -14, -1.5], s: [3, 14, 3], paint: mwSkin }, { o: [-2, -4, -2], s: [4, 4, 4], paint: mwMoss }] },
        { name: 'legL', pivot: [2, 12, 0], boxes: [{ o: [-2, -12, -2], s: [4, 12, 4], paint: mwLeg }] },
        { name: 'legR', pivot: [-2, 12, 0], boxes: [{ o: [-2, -12, -2], s: [4, 12, 4], paint: mwLeg }] },
      ];
      case 'hollow_archer': return [
        { name: 'body', pivot: [0, 13, 0], boxes: [{ o: [-3.5, 0, -2], s: [7, 12, 4], paint: haBody }, { o: [1, 3, 2], s: [3, 10, 3], paint: quiver, rot: [0, 0, -0.35] }, { o: [1.5, 12.5, 2.5], s: [2, 1.5, 2], paint: fletch, rot: [0, 0, -0.35] }, { o: [-3.5, 1, 2], s: [7, 10, 1], paint: cape }] },
        { name: 'head', pivot: [0, 25, 0], boxes: [{ o: [-4, 0, -4], s: [8, 8, 8], paint: haHood }, { o: [-3, 7.5, -2], s: [6, 2, 6], paint: haCloth }, { o: [-1, 8, 2], s: [2, 2, 4], paint: haCloth, rot: [-0.4, 0, 0] }] },
        { name: 'armL', pivot: [5, 24, 0], boxes: [{ o: [-1.5, -12, -1.5], s: [3, 12, 3], paint: haLimb }] },
        { name: 'armR', pivot: [-5, 24, 0], boxes: [{ o: [-1.5, -12, -1.5], s: [3, 12, 3], paint: haLimb }] },
        { name: 'bow', pivot: [5, 24, 0], boxes: [{ o: [-0.5, -18, -3.5], s: [1, 12, 1], paint: bowWood }, { o: [-0.5, -16, -2.5], s: [0.4, 8, 0.4], paint: bowString }] },
        { name: 'legL', pivot: [1.7, 13, 0], boxes: [{ o: [-1.5, -13, -1.5], s: [3, 13, 3], paint: haLeg }] },
        { name: 'legR', pivot: [-1.7, 13, 0], boxes: [{ o: [-1.5, -13, -1.5], s: [3, 13, 3], paint: haLeg }] },
      ];
      case 'cragskitter': {
        const legs = [];
        const L = [['legL1', 1, -4, -0.7], ['legL2', 1, 0, 0], ['legL3', 1, 4, 0.7], ['legR1', -1, -4, 0.7], ['legR2', -1, 0, 0], ['legR3', -1, 4, -0.7]];
        for (const [name, side, z, yaw] of L) legs.push({ name, pivot: [side * 5, 8, z], base: { yaw: side > 0 ? yaw : yaw, side }, boxes: [{ o: side > 0 ? [0, -1, -1] : [-12, -1, -1], s: [12, 2, 2], paint: skLeg }] });
        return [
          { name: 'body', pivot: [0, 6, 0], boxes: [
            { o: [-5, 0, -5], s: [10, 6, 8], paint: skStone }, { o: [-6, -1, 3], s: [12, 8, 11], paint: skStone },
            { o: [-4, 7, 5], s: [2, 3, 2], paint: crystal, rot: [0.2, 0.3, 0.2] }, { o: [1, 7, 8], s: [2, 4, 2], paint: crystal, rot: [-0.2, 0, -0.25] },
            { o: [-1, 7, 10.5], s: [2, 2.5, 2], paint: crystal }, { o: [2.5, 6, 4], s: [1.5, 2, 1.5], paint: crystal, rot: [0, 0.5, 0.3] }] },
          { name: 'head', pivot: [0, 8, -5], boxes: [{ o: [-4, -3, -6], s: [8, 6, 6], paint: skHead }, { o: [1.5, -4, -8], s: [1.2, 2, 3], paint: mandible, rot: [0, -0.3, 0] }, { o: [-2.7, -4, -8], s: [1.2, 2, 3], paint: mandible, rot: [0, 0.3, 0] }] },
        ].concat(legs);
      }
    }
    return [];
  }

  // Built models are cached per species and variant: {skinTex, parts: [{name, pivot, rot, base, geometry}]}.
  const cache = new Map();
  function model(type, variant) {
    const key = type + ':' + (variant | 0);
    if (cache.has(key)) return cache.get(key);
    const skin = makeSkin(key);
    const parts = defs(type, variant | 0).map(p => ({ name: p.name, pivot: p.pivot, rot: p.rot || [0, 0, 0], base: p.base || null, geometry: partGeometry(skin, p.boxes, key + ':' + p.name) }));
    const tex = new THREE.CanvasTexture(skin.canvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    const m = { tex, parts, canvas: skin.canvas };
    cache.set(key, m);
    return m;
  }

  // ════════════════════════════════════════════════════════════════ view
  function createView(R) {
    const scene = R.scene;
    const inst = new Map();     // mob uid → instance
    const arrowMeshes = new Map();
    const particles = [];
    const partMat = new THREE.PointsMaterial({ size: 0.11, vertexColors: true, transparent: true, depthWrite: false });
    const hpBg = new THREE.MeshBasicMaterial({ color: 0x1a0c0c, transparent: true, opacity: 0.75, depthTest: false });
    const hpGeo = new THREE.PlaneGeometry(1, 0.09);
    const tmpV = new THREE.Vector3(), tmpC = new THREE.Color();

    function makeInstance(m) {
      const md = model(m.type, m.variant);
      const mat = new THREE.MeshBasicMaterial({ map: md.tex });
      const rootG = new THREE.Group(); rootG.rotation.order = 'YXZ';
      const body = new THREE.Group(); rootG.add(body);   // tips over when dying
      const parts = {};
      for (const p of md.parts) {
        const g = new THREE.Group(); g.rotation.order = 'YXZ';
        g.position.set(p.pivot[0] * PX, p.pivot[1] * PX, p.pivot[2] * PX);
        g.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
        const mesh = new THREE.Mesh(p.geometry, mat);
        g.add(mesh); body.add(g);
        parts[p.name] = { g, base: p.rot, info: p.base };
      }
      // health bar (shown for a few seconds after a hit)
      const hp = new THREE.Group();
      const bg = new THREE.Mesh(hpGeo, hpBg), fg = new THREE.Mesh(hpGeo, new THREE.MeshBasicMaterial({ color: 0x5fd35a, depthTest: false }));
      bg.renderOrder = 10; fg.renderOrder = 11; fg.position.z = 0.001; bg.scale.x = 0.8; hp.add(bg, fg); hp.visible = false;
      scene.add(rootG); scene.add(hp);
      const it = { root: rootG, body, parts, mat, hp, hpFg: fg, type: m.type };
      inst.set(m.uid, it);
      return it;
    }
    function removeMob(m) {
      const it = inst.get(m.uid); if (!it) return;
      scene.remove(it.root); scene.remove(it.hp); it.mat.dispose(); it.hpFg.material.dispose();
      inst.delete(m.uid);
    }
    function removeArrow(a) { const mesh = arrowMeshes.get(a.uid); if (mesh) { scene.remove(mesh); arrowMeshes.delete(a.uid); } }
    function clear() {
      for (const it of inst.values()) { scene.remove(it.root); scene.remove(it.hp); it.mat.dispose(); }
      inst.clear();
      for (const mesh of arrowMeshes.values()) scene.remove(mesh);
      arrowMeshes.clear();
      for (const p of particles) { scene.remove(p.pts); p.pts.geometry.dispose(); }
      particles.length = 0;
    }

    // ---- arrows: a shaft with a dark head and white/red fletching
    const arrowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const arrowGeo = (() => {
      const pos = [], col = [], idx = [];
      const box = (x0, y0, z0, x1, y1, z1, c) => {
        const b = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
        b.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        const p = b.attributes.position.array, base = pos.length / 3;
        for (let i = 0; i < p.length; i += 3) { pos.push(p[i], p[i + 1], p[i + 2]); const f = Math.floor(i / 3 / 6); const s = [0.85, 0.85, 1, 0.6, 0.75, 0.75][f] || 1; col.push(c[0] * s, c[1] * s, c[2] * s); }
        for (let i = 0; i < p.length / 3; i++) idx.push(base + i);
      };
      box(-0.02, -0.02, -0.25, 0.02, 0.02, 0.25, [0.55, 0.4, 0.24]);
      box(-0.035, -0.035, -0.31, 0.035, 0.035, -0.23, [0.3, 0.3, 0.33]);
      box(-0.005, -0.06, 0.14, 0.005, 0.06, 0.27, [0.93, 0.92, 0.88]);
      box(-0.06, -0.005, 0.14, 0.06, 0.005, 0.27, [0.78, 0.26, 0.2]);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
      return g;
    })();

    // ---- particles
    function burst(x, y, z, n, colors, speed, life, up) {
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), vel = new Float32Array(n * 3), r = Math.random;
      for (let i = 0; i < n; i++) {
        pos[i * 3] = x + (r() - 0.5) * 0.5; pos[i * 3 + 1] = y + (r() - 0.5) * 0.5; pos[i * 3 + 2] = z + (r() - 0.5) * 0.5;
        vel[i * 3] = (r() - 0.5) * speed; vel[i * 3 + 1] = (up == null ? 1 : up) + r() * speed * 0.6; vel[i * 3 + 2] = (r() - 0.5) * speed;
        const c = colors[Math.floor(r() * colors.length)]; col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const pts = new THREE.Points(g, partMat); scene.add(pts);
      particles.push({ pts, vel, life, grav: up == null ? 9 : 2 });
    }
    function effect(kind, x, y, z, data) {
      if (kind === 'hit') burst(x, y, z, 10, [[0.75, 0.08, 0.08], [0.55, 0.05, 0.05], [0.95, 0.3, 0.3]], 3, 0.5);
      else if (kind === 'crit') { burst(x, y, z, 10, [[0.75, 0.08, 0.08], [0.55, 0.05, 0.05]], 3, 0.5); burst(x, y + 0.2, z, 16, [[1, 0.95, 0.5], [1, 1, 1], [1, 0.8, 0.3]], 5, 0.6, 2); }
      else if (kind === 'poof') burst(x, y, z, 22, [[0.85, 0.85, 0.85], [0.7, 0.7, 0.7], [1, 1, 1]], 1.6, 0.9, 0.6);
      else if (kind === 'thunk') burst(x, y, z, 4, [[0.5, 0.45, 0.4]], 1, 0.3);
      else if (kind === 'fire') burst(x, y, z, 2, [[1, 0.6, 0.1], [1, 0.85, 0.3], [0.9, 0.3, 0.05]], 0.6, 0.45, 1.2);
    }
    function updateParticles(dt) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]; p.life -= dt;
        if (p.life <= 0) { scene.remove(p.pts); p.pts.geometry.dispose(); particles.splice(i, 1); continue; }
        const a = p.pts.geometry.attributes.position, v = p.vel;
        for (let j = 0; j < a.count; j++) { v[j * 3 + 1] -= p.grav * dt; a.array[j * 3] += v[j * 3] * dt; a.array[j * 3 + 1] += v[j * 3 + 1] * dt; a.array[j * 3 + 2] += v[j * 3 + 2] * dt; }
        a.needsUpdate = true;
      }
    }

    // ---- per-frame update
    const lerp = (a, b, t) => a + (b - a) * t;
    function lerpAngle(a, b, t) { const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; }
    let lastT = 0;
    function frame(list, arrows, alpha, info) {
      const now = performance.now() / 1000, dt = lastT ? Math.min(0.1, now - lastT) : 0; lastT = now;
      const cam = R.camera, range = (info.range || 96);
      const seen = new Set();
      const day = info.daylight == null ? 1 : info.daylight;
      for (const m of list) {
        const x = lerp(m.px, m.x, alpha), y = lerp(m.py, m.y, alpha), z = lerp(m.pz, m.z, alpha);
        const far = Math.abs(x - cam.position.x) > range || Math.abs(z - cam.position.z) > range;
        if (m.paused || m.frozen || far) { if (inst.has(m.uid)) removeMob(m); continue; }
        seen.add(m.uid);
        const it = inst.get(m.uid) || makeInstance(m);
        it.root.position.set(x, y, z);
        it.root.rotation.y = lerpAngle(m.pyaw, m.yaw, alpha);
        animate(it, m, now, alpha);
        // brightness from the light adapter: sky light scaled by daylight, or block light, whichever is brighter
        const sky = m.skyL == null ? 15 : m.skyL, blk = m.blockL || 0;
        const lv = Math.max(sky / 15 * day, blk / 15);
        const b = 0.22 + 0.78 * lv;
        if (m.hurtTime > 0 || m.deathTime >= 0) it.mat.color.setRGB(Math.min(1, b * 1.25 + 0.2), b * 0.42, b * 0.42);
        else it.mat.color.setScalar(b);
        // burning
        if (m.fire > 0 && Math.random() < dt * 14) effect('fire', x + (Math.random() - 0.5) * m.sp.w, y + Math.random() * m.sp.h, z + (Math.random() - 0.5) * m.sp.w);
        // health bar
        it.hp.visible = m.hpShowT > 0 && m.deathTime < 0;
        if (it.hp.visible) {
          const f = Math.max(0, m.health / m.sp.health);
          it.hp.position.set(x, y + m.sp.h + 0.35, z);
          it.hp.quaternion.copy(cam.quaternion);
          it.hpFg.scale.x = 0.8 * f; it.hpFg.position.x = -0.4 * (1 - f);
          it.hpFg.material.color.set(f > 0.5 ? 0x5fd35a : f > 0.25 ? 0xf5b544 : 0xe0453a);
        }
      }
      for (const [uid, it] of inst) if (!seen.has(uid)) { scene.remove(it.root); scene.remove(it.hp); it.mat.dispose(); inst.delete(uid); }
      // arrows
      const live = new Set();
      for (const a of arrows) {
        live.add(a.uid);
        let mesh = arrowMeshes.get(a.uid);
        if (!mesh) { mesh = new THREE.Mesh(arrowGeo, arrowMat); mesh.rotation.order = 'YXZ'; scene.add(mesh); arrowMeshes.set(a.uid, mesh); }
        const t = a.stuck ? 1 : alpha;
        mesh.position.set(lerp(a.px, a.x, t), lerp(a.py, a.y, t), lerp(a.pz, a.z, t));
        if (!a.stuck) { const hd = Math.hypot(a.vx, a.vz); mesh.rotation.set(Math.atan2(a.vy, hd), Math.atan2(-a.vx, -a.vz), 0); }
        arrowMat.color.setScalar(0.35 + 0.65 * day);
      }
      for (const [uid, mesh] of arrowMeshes) if (!live.has(uid)) { scene.remove(mesh); arrowMeshes.delete(uid); }
      updateParticles(dt);
    }

    function animate(it, m, now, alpha) {
      const P2 = it.parts, sw = Math.sin(m.walk) * 0.75 * m.walkAmt, cw = Math.cos(m.walk) * 0.75 * m.walkAmt;
      const set = (name, rx, ry, rz) => { const p = P2[name]; if (p) p.g.rotation.set(p.base[0] + (rx || 0), p.base[1] + (ry || 0), p.base[2] + (rz || 0)); };
      set('legFL', sw); set('legBR', sw); set('legFR', -sw); set('legBL', -sw);
      set('legL', sw); set('legR', -sw);
      if (P2.head) set('head', -(m.headPitch || 0), m.headYaw || 0, 0);
      const swing = m.swing > 0 ? Math.sin((1 - m.swing / 8) * Math.PI) : 0;
      if (m.type === 'mirewalker') {
        const reach = m.target ? -0.9 : 0;
        set('armL', -sw * 0.6 + reach - swing * 1.2, 0, -0.08);
        set('armR', sw * 0.6 + reach - swing * 1.2, 0, 0.08);
        if (P2.head) P2.head.g.rotation.z = Math.sin(now * 1.3 + m.uid) * 0.12;
      } else if (m.type === 'hollow_archer') {
        const aim = m.target ? 1 : 0;
        set('armL', aim ? -1.5 - (m.headPitch || 0) : -sw * 0.5, aim ? 0.1 : 0, 0);
        set('armR', aim ? -1.4 - (m.headPitch || 0) + Math.min(1, m.draw / 20) * 0.3 : sw * 0.5, aim ? -0.5 : 0, 0);
        const bow = P2.bow; if (bow) bow.g.rotation.copy(P2.armL.g.rotation);
      } else if (m.type === 'chicken') {
        const flap = !m.onGround ? Math.sin(now * 30) * 0.9 : m.walkAmt * 0.12 * Math.sin(now * 20);
        set('wingL', 0, 0, -Math.abs(flap)); set('wingR', 0, 0, Math.abs(flap));
        if (P2.head) P2.head.g.position.z = (-3 + Math.sin(m.walk * 2) * 0.8 * m.walkAmt) * PX;
      } else if (m.type === 'cragskitter') {
        for (const name of ['legL1', 'legL2', 'legL3', 'legR1', 'legR2', 'legR3']) {
          const p = P2[name]; if (!p) continue;
          const side = p.info.side, group = (name === 'legL1' || name === 'legR2' || name === 'legL3') ? 1 : -1;
          const ph = Math.sin(m.walk * 1.4) * group * m.walkAmt;
          p.g.rotation.set(0, p.info.yaw + ph * 0.45, side * (-0.55 + Math.max(0, ph) * 0.35));
        }
      }
      // idle breathing and dying
      it.body.position.y = m.deathTime >= 0 ? 0 : Math.sin(now * 2 + m.uid) * 0.006;
      const dying = m.deathTime >= 0 ? Math.min(1, (m.deathTime + alpha) / 12) : 0;
      it.body.rotation.z = dying * Math.PI / 2;
      it.body.position.x = dying * m.sp.h * 0.3;
    }

    return { frame, removeMob, removeArrow, effect, clear, get count() { return inst.size; } };
  }

  // A standalone preview of one creature (screenshots, menus): returns a THREE.Group positioned at the origin.
  function preview(type, variant) {
    const md = model(type, variant | 0);
    const mat = new THREE.MeshBasicMaterial({ map: md.tex });
    const g = new THREE.Group();
    for (const p of md.parts) {
      const pg = new THREE.Group(); pg.rotation.order = 'YXZ';
      pg.position.set(p.pivot[0] * PX, p.pivot[1] * PX, p.pivot[2] * PX); pg.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
      if (p.base) pg.rotation.set(0, p.base.yaw, p.base.side * -0.55);
      pg.add(new THREE.Mesh(p.geometry, mat)); g.add(pg);
    }
    return g;
  }

  BC.mobModels = { createView, preview, model };

  // ════════════════════════════════════════════════════════════════ developer toolkit: creatures
  const DEV = BC.dev, G = BC.game;
  if (!DEV || !G) return;
  const M = () => G.mobs;
  const SPEC = BC.mobs.SPECIES, TYPES = BC.mobs.TYPES;
  const fail = DEV.fail;
  const fmt = n => (Math.round(n * 100) / 100).toString();
  const catOf = t => (t === 'hostile' || t === 'passive' ? t : null);

  DEV.command('summon', { usage: '<creature> [count] [x y z]', args: [() => TYPES], help: 'Spawn creatures in front of you (or at x y z). /summon pig 3',
    run(a) {
      const type = a[0]; if (!SPEC[type]) fail(`Unknown creature "${type}". Press Tab for names.`);
      const n = a[1] == null ? 1 : Number(a[1]);
      if (!Number.isInteger(n) || n < 1 || n > 50) fail('Count must be 1–50');
      const p = G.player.p, d = G.dev.lookDir();
      let x, y, z;
      if (a.length >= 5) {
        const c = (tok, base) => { if (tok.startsWith('~')) return base + (Number(tok.slice(1)) || 0); const v = Number(tok); if (!isFinite(v)) fail('Bad coordinate ' + tok); return v; };
        x = c(a[2], p.x); y = c(a[3], p.y); z = c(a[4], p.z);
      } else {
        const hx = d.x, hz = d.z, l = Math.hypot(hx, hz) || 1;
        x = p.x + hx / l * 3; z = p.z + hz / l * 3; y = G.world.surfaceY(Math.floor(x), Math.floor(z));
        if (Math.abs(y - p.y) > 4) y = p.y;
      }
      const made = G.summon(type, x, y, z, n);
      return `Summoned ${made} ${SPEC[type].name}${made === 1 ? '' : 's'} at ${fmt(x)} ${fmt(y)} ${fmt(z)}`;
    } });
  DEV.command('killall', { usage: '[creature|hostile|passive|all]', args: [() => ['all', 'hostile', 'passive'].concat(TYPES)], help: 'Remove creatures (no drops).',
    run([k]) {
      const what = k || 'all';
      if (what !== 'all' && !catOf(what) && !SPEC[what]) fail(`Unknown group "${what}"`);
      const gone = M().list.filter(m => what === 'all' || m.sp.cat === what || m.type === what);
      for (const m of gone.slice()) M().remove(m);
      return `Removed ${gone.length} creature${gone.length === 1 ? '' : 's'}`;
    } });
  DEV.command('mobs', { help: 'Count creatures by kind, with caps and spawn settings.',
    run() {
      const c = M().config, by = {};
      for (const m of M().list) by[m.type] = (by[m.type] || 0) + 1;
      const act = M().list.filter(m => !m.paused && !m.frozen).length;
      return [`${M().list.length} creatures (${act} active, ${M().list.filter(m => m.paused).length} paused in unloaded chunks)`,
        TYPES.map(t => `${t} ${by[t] || 0}`).join(' · '),
        `spawning ${c.spawning ? 'on' : 'off'} · passive ×${c.passiveMul} cap ${c.passiveCap} · hostile ×${c.hostileMul} cap ${c.hostileCap} · max active ${c.maxActive} · AI ${c.ai ? 'on' : 'off'}`,
        `light: ${M().light.usingLighting ? 'BC.lighting' : 'heuristic fallback (no lighting engine loaded)'}`];
    } });
  DEV.command('mobcap', { usage: '<passive|hostile|active> <n>', args: [() => ['passive', 'hostile', 'active']], help: 'Set a creature cap (hostile default 40, passive 10 per 17×17 chunks, active 60).',
    run([k, v]) {
      const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 200) fail('Cap must be 0–200');
      const c = M().config;
      if (k === 'passive') c.passiveCap = n; else if (k === 'hostile') c.hostileCap = n; else if (k === 'active') c.maxActive = Math.max(1, n); else fail('passive, hostile or active');
      return `${k} cap set to ${n}`;
    } });
  DEV.command('spawnrate', { usage: '<passive|hostile> <multiplier>', args: [() => ['passive', 'hostile']], help: 'Scale natural spawning (0–10, 1 = reference rate).',
    run([k, v]) {
      const x = Number(v); if (!(x >= 0 && x <= 10)) fail('Multiplier 0–10');
      if (k === 'passive') M().config.passiveMul = x; else if (k === 'hostile') M().config.hostileMul = x; else fail('passive or hostile');
      return `${k} spawn rate ×${x}`;
    } });
  DEV.command('spawning', { usage: '[on|off]', args: [() => ['on', 'off']], help: 'Turn natural creature spawning on or off.',
    run([v]) { const c = M().config; c.spawning = v == null ? !c.spawning : v === 'on' ? true : v === 'off' ? false : fail('Use on or off'); return 'Creature spawning ' + (c.spawning ? 'on' : 'off'); } });
  DEV.command('mobai', { usage: '[on|off]', args: [() => ['on', 'off']], help: 'Freeze or unfreeze creature AI (physics keeps running).',
    run([v]) { const c = M().config; c.ai = v == null ? !c.ai : v === 'on' ? true : v === 'off' ? false : fail('Use on or off'); return 'Creature AI ' + (c.ai ? 'on' : 'off'); } });
  DEV.command('spawnweight', { usage: '<biome|default> <creature> <weight>', args: [() => Object.keys(M() ? M().tables : BC.mobs.SPAWN_TABLES), () => TYPES],
    help: 'Set a species weight in a biome spawn table (0 removes it). /spawnweight default pig 20',
    run([b, t, w]) {
      if (!b) { const tb = M().tables; return Object.keys(tb).map(k => `${k}: ${['passive', 'hostile'].map(c => tb[k][c].map(e => `${e.type} ${e.weight}`).join(', ') || '(none)').join(' | ')}`); }
      if (!SPEC[t]) fail(`Unknown creature "${t}"`);
      const n = Number(w); if (!(n >= 0 && n <= 1000)) fail('Weight 0–1000');
      const tb = M().tables; if (!tb[b]) tb[b] = JSON.parse(JSON.stringify(tb.default));
      const cat = SPEC[t].cat, list = tb[b][cat], e = list.find(x => x.type === t);
      if (e) e.weight = n; else list.push({ type: t, weight: n, min: 4, max: 4 });
      return `${b}: ${t} weight ${n}`;
    } });

  // Dev panel tab
  BC.devTabs.Creatures = () => {
    const out = [];
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const btn = (text, cmd) => { const b = el('button', 'btn small dev-btn', text); b.type = 'button'; b.addEventListener('click', () => { DEV.exec(cmd); refresh(); }); return b; };
    const row = kids => { const r = el('div', 'dev-row'); r.append(...kids); return r; };
    const slider = (name, min, max, step, get, toCmd) => {
      const l = el('label', 'dev-slider'), o = el('output'), r = el('input');
      r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = get(); o.textContent = (+r.value).toString();
      r.addEventListener('input', () => { o.textContent = (+r.value).toString(); DEV.exec(toCmd(+r.value)); refresh(); });
      l.append(name + ' ', o, r); return l;
    };
    const info = el('p', 'meta');
    const refresh = () => { const c = M().config, n = {}; for (const m of M().list) n[m.sp.cat] = (n[m.sp.cat] || 0) + 1; info.textContent = `${M().list.length} creatures · ${n.passive || 0} passive · ${n.hostile || 0} hostile · spawning ${c.spawning ? 'on' : 'off'} · AI ${c.ai ? 'on' : 'off'} · light: ${M().light.usingLighting ? 'lighting engine' : 'heuristic'}`; };
    out.push(el('span', 'dev-label', 'Summon (3 blocks ahead)'));
    const grid = el('div', 'dev-row creature-row');
    for (const t of TYPES) {
      const b = btn(SPEC[t].name, '/summon ' + t); b.classList.add(SPEC[t].cat === 'hostile' ? 'hostile' : 'passive');
      b.title = `${SPEC[t].name}: ${SPEC[t].health} health${SPEC[t].attack ? ', ' + SPEC[t].attack + ' attack' : ''}`;
      grid.appendChild(b);
    }
    out.push(grid);
    out.push(row([btn('Kill hostiles', '/killall hostile'), btn('Kill passive', '/killall passive'), btn('Kill all', '/killall all'), btn('Count', '/mobs')]));
    out.push(row([btn('Spawning on/off', '/spawning'), btn('AI on/off', '/mobai'), btn('Peaceful', '/difficulty peaceful'), btn('Normal', '/difficulty normal'), btn('Night', '/time set midnight'), btn('Day', '/time set noon')]));
    const c = M().config;
    out.push(slider('Passive spawn rate ×', 0, 5, 0.25, () => c.passiveMul, v => `/spawnrate passive ${v}`));
    out.push(slider('Hostile spawn rate ×', 0, 5, 0.25, () => c.hostileMul, v => `/spawnrate hostile ${v}`));
    out.push(slider('Passive cap', 0, 60, 1, () => c.passiveCap, v => `/mobcap passive ${v}`));
    out.push(slider('Hostile cap', 0, 100, 1, () => c.hostileCap, v => `/mobcap hostile ${v}`));
    out.push(slider('Max active creatures', 1, 120, 1, () => c.maxActive, v => `/mobcap active ${v}`));
    // spawn table of the biome here
    const p = G.player.p, bk = BC.mobs.biomeKey(G.world, p.x, p.z), tb = BC.mobs.tableFor(bk, M().tables);
    out.push(el('span', 'dev-label', `Spawn table here: ${bk || 'default (classic generator)'} · edit with /spawnweight <biome> <creature> <weight>`));
    const tbl = el('div', 'dev-row');
    for (const cat of ['passive', 'hostile']) for (const e of tb[cat]) tbl.appendChild(el('span', 'dev-chip', `${SPEC[e.type] ? SPEC[e.type].name : e.type} ${e.weight}`));
    out.push(tbl, info);
    refresh();
    return out;
  };
})(window);
