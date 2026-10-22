'use strict';
// Rendering with three.js: chunk meshes (smooth lighting, ambient occlusion, shaped blocks), sky, particles,
// block highlight, mining cracks, dropped-item and falling-block meshes and the first-person held item.
//
// Lighting: chunk vertices carry their sky and block light (0-15, averaged over the cells around each corner, like
// the reference game's smooth lighting) next to the AO/face shade colour. The shader turns them into a colour with
// the current daylight (a uniform), so day and night never need re-meshing: warm torch light, blue-ish moonlight,
// dark but not black caves. Loose objects (items, falling blocks, the held item) get the same colour from the light
// at their position.
(function (root) {
  const BC = root.BC;
  const { CS, WH } = BC.C;
  const { B, DEFS, OPAQUE, LIQUID, SHAPE } = BC.blocks;
  const T = BC.tex;
  const { mulberry32, smooth } = BC.util;

  const R = BC.render = {};
  let renderer, scene, camera, hudScene, hudCam;
  let opaqueMat, waterMat, atlasTex, itemTex, partMat, entBlockMat, entItemMat, entFlatMat, heldBlockMat, heldItemMat, heldFlatMat, handMat;
  let heldMats = [];

  // ---------------------------------------------------------------- light colour (shared by the shader and the CPU)
  const NIGHT_SKY = 0.42;                           // sky light strength at night relative to noon
  const NIGHT_TINT = [0.56, 0.66, 1.0];             // moonlight
  const AMBIENT = [0.06, 0.06, 0.075];               // floor so unlit caves are dark but not pitch black
  const GAMMA = 0.4;                                // 0 = contrasty light falloff, 1 = flat (like a brightness setting)
  const U_SKYMUL = { value: 1 }, U_SKYTINT = { value: null }, U_AMBIENT = { value: null };
  const LIGHT_GLSL = `
    #define BC_GAMMA ${GAMMA.toFixed(3)}
    attribute vec2 aLight;
    uniform float uSkyMul;
    uniform vec3 uSkyTint;
    uniform vec3 uAmbient;
    float bcCurve(float f) { float b = f / (4.0 - 3.0 * f); float t = 1.0 - b; t *= t; return mix(b, 1.0 - t * t, BC_GAMMA); }
    vec3 bcLight(vec2 l) {
      vec3 s = uSkyTint * bcCurve(clamp(l.x * uSkyMul, 0.0, 1.0));
      float b = bcCurve(l.y);
      vec3 w = vec3(b, b * (0.5 + 0.38 * b), b * (0.24 + 0.52 * b * b));
      return uAmbient + (1.0 - uAmbient) * max(s, w);
    }`;
  function curve(f) { const b = f / (4 - 3 * f); let t = 1 - b; t *= t; return b + (1 - t * t - b) * GAMMA; }
  let skyMul = 1; const skyTint = [1, 1, 1];
  // Colour for a sky level and block level (0-15) under the current daylight; writes into out[0..2].
  function lightRGB(sky, blk, out) {
    const s = curve(Math.min(1, sky / 15 * skyMul)), b = curve(blk / 15);
    const w = [b, b * (0.5 + 0.38 * b), b * (0.24 + 0.52 * b * b)];
    for (let i = 0; i < 3; i++) out[i] = AMBIENT[i] + (1 - AMBIENT[i]) * Math.max(skyTint[i] * s, w[i]);
    return out;
  }
  R.lightRGB = lightRGB;
  function makeLit(mat) {
    mat.onBeforeCompile = sh => {
      sh.uniforms.uSkyMul = U_SKYMUL; sh.uniforms.uSkyTint = U_SKYTINT; sh.uniforms.uAmbient = U_AMBIENT;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + LIGHT_GLSL)
        .replace('#include <color_vertex>', '#include <color_vertex>\n\tvColor.xyz *= bcLight(aLight);');
    };
    mat.customProgramCacheKey = () => 'bc-lit';
    return mat;
  }

  // ---------------------------------------------------------------- world attachment (light queries)
  R.world = null;
  R.attachWorld = w => { R.world = w; };
  R.detachWorld = w => { if (R.world === w) R.world = null; };
  const tmpRGB = [0, 0, 0];
  // Light colour at a point: the cell's light, or the cell above when the point is inside an opaque block.
  function lightAt(x, y, z, out) {
    const W = R.world;
    if (!W || !W.getSkyLight) { out[0] = out[1] = out[2] = 1; return out; }
    let fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    if (OPAQUE[W.getBlock(fx, fy, fz)]) fy++;
    return lightRGB(W.getSkyLight(fx, fy, fz), W.getBlockLight(fx, fy, fz), out);
  }
  R.lightAt = lightAt;
  // Tint a loose object's own material by the light where it is.
  R.lightMesh = function (m, x, y, z) {
    if (!m || !m.userData.ownMat) return;
    lightAt(x, y, z, tmpRGB);
    m.material.color.setRGB(tmpRGB[0], tmpRGB[1], tmpRGB[2]);
  };

  // ---------------------------------------------------------------- setup
  R.init = function (canvas) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.autoClear = false;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, 1, 0.08, 700);
    camera.rotation.order = 'YXZ';
    scene.fog = new THREE.Fog(0x87b7f0, 50, 90);
    scene.background = new THREE.Color(0x87b7f0);
    hudScene = new THREE.Scene();
    hudCam = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    U_SKYTINT.value = new THREE.Color(1, 1, 1);
    U_AMBIENT.value = new THREE.Color(AMBIENT[0], AMBIENT[1], AMBIENT[2]);

    atlasTex = new THREE.CanvasTexture(T.atlas);
    atlasTex.magFilter = THREE.NearestFilter; atlasTex.minFilter = THREE.NearestFilter; atlasTex.generateMipmaps = false;
    itemTex = new THREE.CanvasTexture(T.itemAtlas);
    itemTex.magFilter = THREE.NearestFilter; itemTex.minFilter = THREE.NearestFilter; itemTex.generateMipmaps = false;
    opaqueMat = makeLit(new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, alphaTest: 0.5 }));
    waterMat = makeLit(new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide }));
    partMat = new THREE.PointsMaterial({ size: 0.13, vertexColors: true });
    // Templates for loose objects; each mesh gets its own clone so it can be tinted by the light where it is.
    entBlockMat = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, alphaTest: 0.5 });
    entItemMat = new THREE.MeshBasicMaterial({ map: itemTex, alphaTest: 0.5, side: THREE.DoubleSide });
    entFlatMat = new THREE.MeshBasicMaterial({ map: atlasTex, alphaTest: 0.5, side: THREE.DoubleSide });
    heldBlockMat = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, alphaTest: 0.5 });
    heldItemMat = new THREE.MeshBasicMaterial({ map: itemTex, alphaTest: 0.5, side: THREE.DoubleSide });
    heldFlatMat = new THREE.MeshBasicMaterial({ map: atlasTex, alphaTest: 0.5, side: THREE.DoubleSide });
    handMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    heldMats = [heldBlockMat, heldItemMat, heldFlatMat, handMat];

    initShapes();
    buildSky();
    buildHighlight();
    buildHeld();
    Object.assign(R, { renderer, scene, camera, hudScene, hudCam, opaqueMat, waterMat });
  };

  R.resize = function (w, h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    hudCam.aspect = w / h; hudCam.updateProjectionMatrix();
  };
  R.render = function (showHeld) {
    renderer.clear();
    renderer.render(scene, camera);
    if (showHeld) { renderer.clearDepth(); renderer.render(hudScene, hudCam); }
  };

  // ---------------------------------------------------------------- chunk meshing
  // Faces: [left(-x), right(+x), bottom, top, back(-z), front(+z)]; corners [x, y, z, u, v].
  const FACES = [
    { d: [-1, 0, 0], c: [[0,1,0,0,1],[0,0,0,0,0],[0,1,1,1,1],[0,0,1,1,0]] },
    { d: [ 1, 0, 0], c: [[1,1,1,0,1],[1,0,1,0,0],[1,1,0,1,1],[1,0,0,1,0]] },
    { d: [0, -1, 0], c: [[1,0,1,1,0],[0,0,1,0,0],[1,0,0,1,1],[0,0,0,0,1]] },
    { d: [0,  1, 0], c: [[0,1,1,1,1],[1,1,1,0,1],[0,1,0,1,0],[1,1,0,0,0]] },
    { d: [0, 0, -1], c: [[1,0,0,0,0],[0,0,0,1,0],[1,1,0,0,1],[0,1,0,1,1]] },
    { d: [0, 0,  1], c: [[0,0,1,0,0],[1,0,1,1,0],[0,1,1,0,1],[1,1,1,1,1]] },
  ];
  const SHADE = [0.8, 0.8, 0.55, 1.0, 0.68, 0.68];
  const AOL = [0.42, 0.62, 0.8, 1.0];
  for (const F of FACES) {
    const na = F.d.findIndex(v => v !== 0), axes = [0, 1, 2].filter(a => a !== na);
    F.s = F.c.map(C => { const s1 = [0, 0, 0], s2 = [0, 0, 0]; s1[axes[0]] = C[axes[0]] ? 1 : -1; s2[axes[1]] = C[axes[1]] ? 1 : -1; return [s1, s2]; });
  }
  R.FACES = FACES;
  const P = CS + 2, PP = P * P;
  const pad = new Uint8Array(PP * (WH + 2));    // block ids of the chunk plus a 1-cell border
  const padL = new Uint8Array(PP * (WH + 2));   // their light (sky << 4 | block)
  const PI = (x, y, z) => (x + 1) + (z + 1) * P + (y + 1) * PP;
  const OFF = v => v[0] + v[2] * P + v[1] * PP;
  const DOFF = FACES.map(F => OFF(F.d));
  const S1 = FACES.map(F => F.s.map(s => OFF(s[0]))), S2 = FACES.map(F => F.s.map(s => OFF(s[1])));
  const UVE = 0.01;
  const tileUV = tile => [(tile % T.ATW) / T.ATW, 1 - (Math.floor(tile / T.ATW) + 1) / T.ATH];
  const SHADE8 = SHADE.map(s => AOL.map(a => Math.round(255 * s * a)));
  // AVG[n * 64 + sum]: a light sum over n cells as a 0-255 byte (level * 17)
  const AVG = new Uint8Array(5 * 64);
  for (let n = 1; n <= 4; n++) for (let sum = 0; sum <= 60; sum++) AVG[n * 64 + sum] = Math.round(sum * 17 / n);
  const CHUNK_SPHERE = new THREE.Sphere(new THREE.Vector3(CS / 2, WH / 2, CS / 2), Math.hypot(CS / 2, WH / 2, CS / 2));

  // Shapes for the mesher: 0 cube, 1 cross (plants), 2 torch. Leaves-like blocks show their inner faces.
  const SHAPE_ID = new Uint8Array(256), LEAFY = new Uint8Array(256);
  let torchGeo = [];
  function faceVisible(id, n) {
    if (n === 0) return true;
    if (OPAQUE[n]) return false;
    if (LIQUID[id]) return !LIQUID[n];
    if (n === id) return LEAFY[id] === 1;
    return true;
  }

  // Growable vertex buffers: position, uv, colour (AO x face shade), light (sky, block) as bytes.
  function makeBuf() { return { pos: new Float32Array(12288), uv: new Float32Array(8192), col: new Uint8Array(12288), lt: new Uint8Array(8192), idx: new Uint32Array(6144), nv: 0, ni: 0 }; }
  const grow = (a, n) => { const r = new a.constructor(n); r.set(a); return r; };
  function reserve(b, nv, ni) {
    if ((b.nv + nv) * 3 > b.pos.length) {
      const cap = Math.max(b.nv + nv, (b.pos.length / 3) * 2);
      b.pos = grow(b.pos, cap * 3); b.uv = grow(b.uv, cap * 2); b.col = grow(b.col, cap * 3); b.lt = grow(b.lt, cap * 2);
    }
    if (b.ni + ni > b.idx.length) b.idx = grow(b.idx, Math.max(b.ni + ni, b.idx.length * 2));
  }
  function vtx(b, x, y, z, u, v, c, sky, blk) {
    const n = b.nv++;
    b.pos[n * 3] = x; b.pos[n * 3 + 1] = y; b.pos[n * 3 + 2] = z;
    b.uv[n * 2] = u; b.uv[n * 2 + 1] = v;
    b.col[n * 3] = c; b.col[n * 3 + 1] = c; b.col[n * 3 + 2] = c;
    b.lt[n * 2] = sky; b.lt[n * 2 + 1] = blk;
  }
  const quad = (b, base, flip) => {
    const I = b.idx, k = b.ni;
    if (flip) { I[k] = base; I[k + 1] = base + 1; I[k + 2] = base + 3; I[k + 3] = base; I[k + 4] = base + 3; I[k + 5] = base + 2; }
    else { I[k] = base; I[k + 1] = base + 1; I[k + 2] = base + 2; I[k + 3] = base + 2; I[k + 4] = base + 1; I[k + 5] = base + 3; }
    b.ni += 6;
  };
  const OB = makeBuf(), WB = makeBuf();
  const ao = [0, 0, 0, 0], lv = [0, 0, 0, 0];
  R.stats = { meshes: 0, meshMs: 0 };

  // Build meshes for a chunk. `chunkAt(cx, cz)` returns a loaded chunk ({data, light}) or null.
  R.meshChunk = function (ch, chunkAt) {
    const t0 = performance.now();
    const srcs = [], lits = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = chunkAt(ch.cx + dx, ch.cz + dz); if (!c) return false; srcs.push(c.data); lits.push(c.light);
    }
    pad.fill(B.BEDROCK, 0, PP); padL.fill(0, 0, PP);
    pad.fill(0, PP * (WH + 1)); padL.fill(0xF0, PP * (WH + 1));
    for (let z = -1; z <= CS; z++) {
      const sz = z < 0 ? 0 : z >= CS ? 2 : 1, lz = (z + CS) % CS;
      for (let x = -1; x <= CS; x++) {
        const sx = x < 0 ? 0 : x >= CS ? 2 : 1, lx = (x + CS) % CS, src = srcs[sz * 3 + sx], lsrc = lits[sz * 3 + sx];
        let si = lx + lz * CS, di = PI(x, 0, z);
        if (lsrc) for (let y = 0; y < WH; y++) { pad[di] = src[si]; padL[di] = lsrc[si]; si += CS * CS; di += PP; }
        else for (let y = 0; y < WH; y++) { pad[di] = src[si]; padL[di] = 0xF0; si += CS * CS; di += PP; }
      }
    }
    const O = OB, Wt = WB;
    O.nv = O.ni = Wt.nv = Wt.ni = 0;
    for (let y = 0; y < WH; y++) for (let z = 0; z < CS; z++) {
      let ci = PI(0, y, z);
      for (let x = 0; x < CS; x++, ci++) {
        const id = pad[ci];
        if (!id) continue;
        const shape = SHAPE_ID[id];
        if (shape) { emitShape(O, shape, id, x, y, z, padL[ci]); continue; }
        const liquid = LIQUID[id];
        for (let f = 0; f < 6; f++) {
          const oi = ci + DOFF[f];
          if (!faceVisible(id, pad[oi])) continue;
          const Tg = liquid ? Wt : O;
          reserve(Tg, 4, 6);
          const base = Tg.nv, F = FACES[f], tile = T.BTEX[id][f];
          const u0 = (tile % T.ATW) / T.ATW, v0 = 1 - (Math.floor(tile / T.ATW) + 1) / T.ATH;
          const lowerTop = liquid && !LIQUID[pad[ci + PP]];
          const s1f = S1[f], s2f = S2[f], sh8 = SHADE8[f];
          const l0 = padL[oi];
          for (let c = 0; c < 4; c++) {
            const C = F.c[c], ai = oi + s1f[c], bi = oi + s2f[c], di = ai + s2f[c];
            const o1 = OPAQUE[pad[ai]], o2 = OPAQUE[pad[bi]], oc = OPAQUE[pad[di]];
            const a = liquid ? 3 : o1 && o2 ? 0 : 3 - o1 - o2 - oc;
            // smooth light: average the clear cells around this corner on the face's side
            let sk = l0 >> 4, bl = l0 & 15, n = 1, L;
            if (!o1) { L = padL[ai]; sk += L >> 4; bl += L & 15; n++; }
            if (!o2) { L = padL[bi]; sk += L >> 4; bl += L & 15; n++; }
            if (!oc && !(o1 && o2)) { L = padL[di]; sk += L >> 4; bl += L & 15; n++; }
            const skv = AVG[n * 64 + sk], blv = AVG[n * 64 + bl];
            ao[c] = a; lv[c] = AOL[a] * (40 + Math.max(skv, blv));
            vtx(Tg, x + C[0], y + C[1] - (lowerTop && C[1] ? 0.12 : 0), z + C[2],
              u0 + (C[3] * (1 - 2 * UVE) + UVE) / T.ATW, v0 + (C[4] * (1 - 2 * UVE) + UVE) / T.ATH, sh8[a], skv, blv);
          }
          // split the quad along the diagonal that keeps AO and light gradients symmetric
          quad(Tg, base, lv[1] + lv[2] > lv[0] + lv[3]);
        }
      }
    }
    setMesh(ch, 'opaque', O, opaqueMat);
    setMesh(ch, 'water', Wt, waterMat);
    ch.dirty = false;
    R.stats.meshes++; R.stats.meshMs += performance.now() - t0;
    return true;
  };

  // ---- shaped blocks
  function emitShape(b, shape, id, x, y, z, L) {
    const sky = (L >> 4) * 17, blk = (L & 15) * 17;
    if (shape === 1) {
      // cross: two diagonal quads, both sides, full tile, no AO
      const [u0, v0] = tileUV(T.BTEX[id][0]), e = 0.06;
      const uA = u0 + UVE / T.ATW, uB = u0 + (1 - UVE) / T.ATW, vA = v0 + UVE / T.ATH, vB = v0 + (1 - UVE) / T.ATH;
      for (let k = 0; k < 2; k++) {
        reserve(b, 4, 12);
        const za = k ? 1 - e : e, zb = k ? e : 1 - e, base = b.nv, c = k ? 230 : 255;
        vtx(b, x + e, y, z + za, uA, vA, c, sky, blk); vtx(b, x + 1 - e, y, z + zb, uB, vA, c, sky, blk);
        vtx(b, x + e, y + 1, z + za, uA, vB, c, sky, blk); vtx(b, x + 1 - e, y + 1, z + zb, uB, vB, c, sky, blk);
        quad(b, base, false);
        const I = b.idx, n = b.ni;   // back side
        I[n] = base; I[n + 1] = base + 2; I[n + 2] = base + 1; I[n + 3] = base + 2; I[n + 4] = base + 3; I[n + 5] = base + 1;
        b.ni += 6;
      }
    } else if (shape === 2) {
      const g = torchGeo[id];
      if (!g) return;
      reserve(b, g.n, g.idx.length);
      const base = b.nv;
      for (let i = 0; i < g.n; i++) vtx(b, x + g.pos[i * 3], y + g.pos[i * 3 + 1], z + g.pos[i * 3 + 2], g.uv[i * 2], g.uv[i * 2 + 1], g.col[i], sky, blk);
      for (let i = 0; i < g.idx.length; i++) b.idx[b.ni + i] = base + g.idx[i];
      b.ni += g.idx.length;
    }
  }
  // Torch: a 2x2x10-pixel post. Standing torches sit in the middle of the floor; wall torches lean 22.5 degrees
  // away from the block behind them, their foot against it. Built once per torch block id.
  function initShapes() {
    for (let id = 1; id < DEFS.length; id++) {
      const d = DEFS[id]; if (!d) continue;
      SHAPE_ID[id] = SHAPE[id] === 'cross' ? 1 : SHAPE[id] === 'torch' ? 2 : 0;
      LEAFY[id] = /leaves/.test(d.key) ? 1 : 0;
      if (SHAPE_ID[id] === 2) torchGeo[id] = buildTorch(id, d);
    }
  }
  function buildTorch(id, d) {
    const [u0, v0] = tileUV(T.BTEX[id][0]), px = 1 / 16;
    const U = p => u0 + p / 16 / T.ATW, V = row => v0 + (16 - row) / 16 / T.ATH;
    const wall = d.attach && d.attach[1] === 0;
    const box = wall ? [-px, 3.5 * px, 7 * px, px, 13.5 * px, 9 * px] : [7 * px, 0, 7 * px, 9 * px, 10 * px, 9 * px];
    const ang = -22.5 * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang), piv = [0, 3.5 * px];
    // facing (fx, fz): the direction the torch points; base shape points +x
    const fx = wall ? -d.attach[0] : 1, fz = wall ? -d.attach[2] : 0;
    const out = { pos: [], uv: [], col: [], idx: [], n: 0 };
    for (let f = 0; f < 6; f++) {
      if (f === 2 && !wall) continue;   // the foot of a standing torch touches the floor
      const F = FACES[f], base = out.n;
      for (const C of F.c) {
        let x = C[0] ? box[3] : box[0], y = C[1] ? box[4] : box[1], z = C[2] ? box[5] : box[2];
        if (wall) {
          const rx = x - piv[0], ry = y - piv[1];
          x = piv[0] + rx * ca - ry * sa; y = piv[1] + rx * sa + ry * ca;
          const bx = x - 0.5, bz = z - 0.5;   // rotate the +x-facing shape to its facing, about the block centre
          x = 0.5 + bx * fx - bz * fz; z = 0.5 + bx * fz + bz * fx;
        }
        out.pos.push(x, y, z);
        const u = 7.05 + 1.9 * C[3];
        const row = f === 3 ? 7.95 - 1.9 * C[4] : f === 2 ? 15.95 - 1.9 * C[4] : 15.95 - 9.9 * C[4];
        out.uv.push(U(u), V(row));
        out.col.push(Math.round(255 * Math.min(1, SHADE[f] + 0.12)));
        out.n++;
      }
      out.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
    return out;
  }

  function geometryFrom(b) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(b.pos.slice(0, b.nv * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(b.uv.slice(0, b.nv * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(b.col.slice(0, b.nv * 3), 3, true));
    g.setAttribute('aLight', new THREE.BufferAttribute(b.lt.slice(0, b.nv * 2), 2, true));
    const idx = b.idx.subarray(0, b.ni);
    g.setIndex(new THREE.BufferAttribute(b.nv > 65535 ? idx.slice() : Uint16Array.from(idx), 1));
    g.boundingSphere = CHUNK_SPHERE.clone();   // every chunk mesh spans its 16x80x16 cell box
    return g;
  }
  function setMesh(ch, slot, b, mat) {
    const old = ch[slot];
    if (old) { scene.remove(old); old.geometry.dispose(); ch[slot] = null; }
    if (!b.ni) return;
    const m = new THREE.Mesh(geometryFrom(b), mat);
    m.position.set(ch.cx * CS, 0, ch.cz * CS);
    m.matrixAutoUpdate = false; m.updateMatrix();
    if (slot === 'water') m.renderOrder = 1;
    scene.add(m);
    ch[slot] = m;
  }
  R.disposeChunk = function (ch) {
    for (const s of ['opaque', 'water']) if (ch[s]) { scene.remove(ch[s]); ch[s].geometry.dispose(); ch[s] = null; }
  };

  // ---------------------------------------------------------------- item geometry (drops, held items, falling blocks)
  const geoCache = new Map();
  function arraysGeometry(Tg) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(Tg.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(Tg.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(Tg.col, 3));
    g.setIndex(Tg.idx);
    g.computeBoundingSphere();
    return g;
  }
  function blockGeometry(id, size) {
    const k = 'b' + id + ':' + size; if (geoCache.has(k)) return geoCache.get(k);
    const Tg = { pos: [], uv: [], col: [], idx: [] };
    for (let f = 0; f < 6; f++) {
      const F = FACES[f], base = Tg.pos.length / 3, [u0, v0] = tileUV(T.BTEX[id][f]);
      for (const C of F.c) {
        Tg.pos.push((C[0] - 0.5) * size, (C[1] - 0.5) * size, (C[2] - 0.5) * size);
        Tg.uv.push(u0 + (C[3] * (1 - 2 * UVE) + UVE) / T.ATW, v0 + (C[4] * (1 - 2 * UVE) + UVE) / T.ATH);
        Tg.col.push(SHADE[f], SHADE[f], SHADE[f]);
      }
      Tg.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
    const g = arraysGeometry(Tg); geoCache.set(k, g); return g;
  }
  function planeUV(g, u0, v0, du, dv) {
    const uv = g.attributes.uv;
    for (let j = 0; j < uv.count; j++) uv.setXY(j, u0 + uv.getX(j) * du, v0 + uv.getY(j) * dv);
    return g;
  }
  function spriteGeometry(itemId, size) {
    const k = 's' + itemId + ':' + size; if (geoCache.has(k)) return geoCache.get(k);
    const i = T.spriteIndex(itemId);
    const g = planeUV(new THREE.PlaneGeometry(size, size), (i % T.SIW) / T.SIW, 1 - (Math.floor(i / T.SIW) + 1) / T.SIH, 1 / T.SIW, 1 / T.SIH);
    geoCache.set(k, g); return g;
  }
  // Flat picture of a shaped block (torch, sapling) for dropped and held items.
  function flatGeometry(blockId, size) {
    const k = 'f' + blockId + ':' + size; if (geoCache.has(k)) return geoCache.get(k);
    const [u0, v0] = tileUV(T.BTEX[blockId][0]);
    const g = planeUV(new THREE.PlaneGeometry(size, size), u0, v0, 1 / T.ATW, 1 / T.ATH);
    geoCache.set(k, g); return g;
  }
  const isFlat = d => d.kind === 'block' && SHAPE[d.block] !== 'cube';
  const own = (geo, mat) => { const m = new THREE.Mesh(geo, mat.clone()); m.userData.ownMat = true; return m; };
  // A mesh for a dropped item stack (own material, tinted by the light where it lies).
  R.itemMesh = function (itemId) {
    const d = BC.items.get(itemId);
    const m = isFlat(d) ? own(flatGeometry(d.block, 0.42), entFlatMat)
      : d.kind === 'block' ? own(blockGeometry(d.block, 0.25), entBlockMat) : own(spriteGeometry(itemId, 0.42), entItemMat);
    scene.add(m); return m;
  };
  // A full-size block mesh (falling sand and gravel), centred on its position.
  R.blockMesh = function (id) { const m = own(blockGeometry(id, 1), entBlockMat); scene.add(m); return m; };
  R.removeMesh = function (m) { scene.remove(m); if (m.userData.ownMat) m.material.dispose(); };

  // ---------------------------------------------------------------- highlight + mining cracks
  let highlight, crack, crackStage = -1;
  function buildHighlight() {
    highlight = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }));
    highlight.visible = false; scene.add(highlight);
    crack = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006),
      new THREE.MeshBasicMaterial({ map: atlasTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    crack.userData.baseUV = Float32Array.from(crack.geometry.attributes.uv.array);
    crack.visible = false; crack.renderOrder = 3; scene.add(crack);
  }
  R.setHighlight = function (h) { highlight.visible = !!h; if (h) highlight.position.set(h.x + 0.5, h.y + 0.5, h.z + 0.5); };
  R.setCrack = function (h, stage) {
    if (!h || stage < 0) { crack.visible = false; return; }
    crack.visible = true; crack.position.set(h.x + 0.5, h.y + 0.5, h.z + 0.5);
    if (stage !== crackStage) {
      crackStage = stage;
      const [u0, v0] = tileUV(T.TILE['crack_' + Math.min(9, stage)]), base = crack.userData.baseUV, uv = crack.geometry.attributes.uv;
      for (let j = 0; j < uv.count; j++) uv.setXY(j, u0 + base[j * 2] / T.ATW, v0 + base[j * 2 + 1] / T.ATH);
      uv.needsUpdate = true;
    }
  };

  // ---------------------------------------------------------------- particles
  const particles = [];
  R.burst = function (x, y, z, id, n = 16) {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), vel = new Float32Array(n * 3);
    const c = T.TILE_AVG[T.BTEX[id][0]], r = Math.random, l = lightAt(x + 0.5, y + 0.5, z + 0.5, [0, 0, 0]);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = x + 0.15 + r() * 0.7; pos[i * 3 + 1] = y + 0.15 + r() * 0.7; pos[i * 3 + 2] = z + 0.15 + r() * 0.7;
      vel[i * 3] = (r() - 0.5) * 3; vel[i * 3 + 1] = 1.5 + r() * 3; vel[i * 3 + 2] = (r() - 0.5) * 3;
      const k = 0.75 + r() * 0.35; col[i * 3] = c[0] * k * l[0]; col[i * 3 + 1] = c[1] * k * l[1]; col[i * 3 + 2] = c[2] * k * l[2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const p = new THREE.Points(g, partMat); scene.add(p);
    particles.push({ p, vel, life: 0.8 });
  };
  R.clearParticles = function () { for (const Pp of particles) { scene.remove(Pp.p); Pp.p.geometry.dispose(); } particles.length = 0; };
  R.updateParticles = function (dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const Pp = particles[i]; Pp.life -= dt;
      if (Pp.life <= 0) { scene.remove(Pp.p); Pp.p.geometry.dispose(); particles.splice(i, 1); continue; }
      const a = Pp.p.geometry.attributes.position, v = Pp.vel;
      for (let j = 0; j < a.count; j++) { v[j * 3 + 1] -= 16 * dt; a.array[j * 3] += v[j * 3] * dt; a.array[j * 3 + 1] += v[j * 3 + 1] * dt; a.array[j * 3 + 2] += v[j * 3 + 2] * dt; }
      a.needsUpdate = true;
    }
  };

  // ---------------------------------------------------------------- sky
  let sun, moon, stars, clouds, cloudMat, wind = 0;
  function squareTex(core, glow) {
    const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d');
    x.fillStyle = glow; x.fillRect(4, 4, 24, 24); x.fillStyle = core; x.fillRect(8, 8, 16, 16);
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; return t;
  }
  function buildSky() {
    sun = new THREE.Mesh(new THREE.PlaneGeometry(46, 46), new THREE.MeshBasicMaterial({ map: squareTex('#fff8d8', 'rgba(255,230,140,0.35)'), transparent: true, fog: false, depthWrite: false }));
    moon = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), new THREE.MeshBasicMaterial({ map: squareTex('#dfe6f0', 'rgba(200,210,230,0.18)'), transparent: true, fog: false, depthWrite: false }));
    scene.add(sun, moon);
    {
      const r = mulberry32(99), n = 600, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        pos[i * 3] = s * Math.cos(th) * 400; pos[i * 3 + 1] = u * 400; pos[i * 3 + 2] = s * Math.sin(th) * 400;
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }));
      scene.add(stars);
    }
    const cloudTex = (() => {
      const N = 32, r = mulberry32(4242); let g = new Uint8Array(N * N);
      for (let i = 0; i < g.length; i++) g[i] = r() < 0.42 ? 1 : 0;
      for (let it = 0; it < 3; it++) {
        const ng = new Uint8Array(N * N);
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          let c = 0; for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) c += g[((x + ox + N) % N) + ((y + oy + N) % N) * N];
          ng[x + y * N] = c >= 5 ? 1 : 0;
        }
        g = ng;
      }
      const c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d');
      x.fillStyle = '#fff'; for (let i = 0; i < g.length; i++) if (g[i]) x.fillRect(i % N, (i / N) | 0, 1, 1);
      const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
    })();
    cloudMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: cloudTex }, offset: { value: new THREE.Vector2() }, color: { value: new THREE.Color(1, 1, 1) }, center: { value: new THREE.Vector2() }, radius: { value: 300 } },
      vertexShader: 'varying vec2 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: 'uniform sampler2D map; uniform vec2 offset; uniform vec3 color; uniform vec2 center; uniform float radius; varying vec2 vW;' +
        'void main(){ float t = texture2D(map, (vW + offset) / 384.0).a; float a = t * 0.82 * (1.0 - smoothstep(radius * 0.5, radius, distance(vW, center))); if (a < 0.01) discard; gl_FragColor = vec4(color, a); }',
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    clouds = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), cloudMat);
    clouds.rotation.x = -Math.PI / 2; clouds.position.y = 112; clouds.renderOrder = 2;
    scene.add(clouds);
  }
  const cDay = new THREE.Color(0.53, 0.73, 0.96), cNight = new THREE.Color(0.02, 0.035, 0.08), cDusk = new THREE.Color(0.96, 0.56, 0.36);
  const cWater = new THREE.Color(0.08, 0.2, 0.45), sky = new THREE.Color(), tmp = new THREE.Color(), sunDir = new THREE.Vector3();
  const heldRGB = [1, 1, 1], heldTarget = [1, 1, 1];
  R.heldLight = heldRGB;   // the colour the held item is lit with (read by tests)
  // Daylight factor 0.2 (night) … 1 (day) for a time of day in [0,1).
  R.daylight = t => { const sy = Math.sin(t * Math.PI * 2); return 0.2 + 0.8 * smooth(-0.15, 0.3, sy); };
  R.updateSky = function (dayTime, dt, underwater, rd) {
    const a = dayTime * Math.PI * 2, sy = Math.sin(a);
    const light = R.daylight(dayTime), dayness = (light - 0.2) / 0.8;
    sky.copy(cNight).lerp(cDay, smooth(-0.2, 0.3, sy));
    const dusk = Math.exp(-((sy / 0.16) ** 2)) * 0.55; sky.lerp(cDusk, dusk);
    const eye = camera.position;
    if (underwater) {
      tmp.copy(cWater).multiplyScalar(light);
      scene.background.copy(tmp); scene.fog.color.copy(tmp); scene.fog.near = 0.5; scene.fog.far = 20;
    } else {
      scene.background.copy(sky); scene.fog.color.copy(sky); scene.fog.far = rd * CS; scene.fog.near = rd * CS * 0.55;
    }
    // world light: sky light strength and colour follow the day; block light is constant
    skyMul = NIGHT_SKY + (1 - NIGHT_SKY) * dayness; U_SKYMUL.value = skyMul;
    for (let i = 0; i < 3; i++) skyTint[i] = NIGHT_TINT[i] + (1 - NIGHT_TINT[i]) * dayness;
    U_SKYTINT.value.setRGB(skyTint[0], skyTint[1], skyTint[2]);
    // the held item takes the light where the player stands (eased, so walking past a torch doesn't flicker)
    lightAt(eye.x, eye.y, eye.z, heldTarget);
    const k = dt > 0 ? 1 - Math.exp(-dt * 8) : 0;
    for (let i = 0; i < 3; i++) heldRGB[i] += (heldTarget[i] - heldRGB[i]) * (heldRGB.init ? k : 1);
    heldRGB.init = true;
    for (const m of heldMats) m.color.setRGB(heldRGB[0], heldRGB[1], heldRGB[2]);
    sunDir.set(Math.cos(a), sy, 0.28).normalize();
    sun.position.copy(eye).addScaledVector(sunDir, 320); sun.lookAt(eye);
    moon.position.copy(eye).addScaledVector(sunDir, -320); moon.lookAt(eye);
    stars.position.copy(eye); stars.rotation.z = a; stars.material.opacity = 1 - smooth(-0.25, 0.08, sy);
    wind += dt * 1.6;
    clouds.position.x = eye.x; clouds.position.z = eye.z;
    cloudMat.uniforms.center.value.set(eye.x, eye.z);
    cloudMat.uniforms.offset.value.set(-wind, 0);
    cloudMat.uniforms.radius.value = rd * CS + 180;
    cloudMat.uniforms.color.value.setScalar(0.25 + 0.75 * light).lerp(cDusk, dusk * 0.4);
    return light;
  };

  // ---------------------------------------------------------------- held item (first person)
  let heldRoot, heldMesh = null, heldKey = null, handMesh;
  const HELD_BASE = new THREE.Vector3(0.56, -0.5, -0.9);
  function buildHeld() {
    heldRoot = new THREE.Group(); hudScene.add(heldRoot);
    const g = new THREE.BoxGeometry(0.2, 0.2, 0.72);
    const cols = []; const faceShade = [0.8, 0.8, 1, 0.55, 0.7, 0.7];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) cols.push(0.86 * faceShade[f], 0.66 * faceShade[f], 0.52 * faceShade[f]);
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    handMesh = new THREE.Mesh(g, handMat);
  }
  // Show the given stack (or the bare hand when null).
  R.setHeld = function (stack) {
    const key = stack ? String(stack.id) : 'hand';
    if (key === heldKey) return;
    heldKey = key;
    if (heldMesh) heldRoot.remove(heldMesh);
    const d = stack && BC.items.get(stack.id);
    if (!d) {
      heldMesh = handMesh; heldMesh.position.set(0.12, -0.12, 0.1); heldMesh.rotation.set(-0.35, 0.28, 0.12);
    } else if (isFlat(d)) {
      heldMesh = new THREE.Mesh(flatGeometry(d.block, 0.6), heldFlatMat);
      heldMesh.position.set(0.1, 0.04, 0); heldMesh.rotation.set(0.1, -1.05, 0.28);
    } else if (d.kind === 'block') {
      heldMesh = new THREE.Mesh(blockGeometry(d.block, 0.42), heldBlockMat);
      heldMesh.position.set(0, 0.02, 0); heldMesh.rotation.set(0.12, Math.PI / 4, 0);
    } else {
      heldMesh = new THREE.Mesh(spriteGeometry(d.id, 0.6), heldItemMat);
      heldMesh.position.set(0.1, 0.04, 0); heldMesh.rotation.set(0.1, -1.05, 0.28);
    }
    heldRoot.add(heldMesh);
  };
  // state: {swing 0..1 (or -1), equip 0..1, eating bool, bob phase, bobAmp, reduceMotion}
  R.animateHeld = function (s) {
    const p = heldRoot.position.copy(HELD_BASE), r = heldRoot.rotation; r.set(0, 0, 0);
    if (s.swing >= 0) {
      const t = s.swing, sq = Math.sin(Math.sqrt(t) * Math.PI);
      p.x -= 0.28 * sq; p.y += 0.18 * Math.sin(Math.sqrt(t) * Math.PI * 2); p.z -= 0.18 * Math.sin(t * Math.PI);
      r.x -= 0.9 * Math.sin(t * t * Math.PI); r.y += 0.45 * sq;
    }
    if (s.eating) { p.x -= 0.2; p.y += 0.1 + (s.reduceMotion ? 0 : Math.abs(Math.sin(s.time * 14)) * 0.05); p.z += 0.1; r.x += 0.3; }
    if (!s.reduceMotion && s.bobAmp > 0) { p.x += Math.sin(s.bob) * 0.03 * s.bobAmp; p.y -= Math.abs(Math.cos(s.bob)) * 0.035 * s.bobAmp; }
    p.y -= (1 - s.equip) * 0.6;
  };
})(window);
