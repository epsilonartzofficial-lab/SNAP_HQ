'use strict';
// Rendering with three.js: chunk meshes, sky, particles, block highlight, mining cracks,
// dropped-item meshes and the first-person held item.
(function (root) {
  const BC = root.BC;
  const { CS, WH } = BC.C;
  const { B, OPAQUE, LIQUID } = BC.blocks;
  const T = BC.tex;
  const { mulberry32, smooth } = BC.util;

  const R = BC.render = {};
  let renderer, scene, camera, hudScene, hudCam;
  let opaqueMat, waterMat, atlasTex, itemTex, partMat, entBlockMat, entItemMat, heldBlockMat, heldItemMat, handMat;

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

    atlasTex = new THREE.CanvasTexture(T.atlas);
    atlasTex.magFilter = THREE.NearestFilter; atlasTex.minFilter = THREE.NearestFilter; atlasTex.generateMipmaps = false;
    itemTex = new THREE.CanvasTexture(T.itemAtlas);
    itemTex.magFilter = THREE.NearestFilter; itemTex.minFilter = THREE.NearestFilter; itemTex.generateMipmaps = false;
    opaqueMat = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, alphaTest: 0.5 });
    waterMat = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide });
    partMat = new THREE.PointsMaterial({ size: 0.13, vertexColors: true });
    entBlockMat = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, alphaTest: 0.5 });
    entItemMat = new THREE.MeshBasicMaterial({ map: itemTex, alphaTest: 0.5, side: THREE.DoubleSide });
    heldBlockMat = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, alphaTest: 0.5 });
    heldItemMat = new THREE.MeshBasicMaterial({ map: itemTex, alphaTest: 0.5, side: THREE.DoubleSide });
    handMat = new THREE.MeshBasicMaterial({ vertexColors: true });

    buildSky();
    buildHighlight();
    buildHeld();
    Object.assign(R, { renderer, scene, camera, hudScene, hudCam });
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
  const pad = new Uint8Array(PP * (WH + 2));
  const PI = (x, y, z) => (x + 1) + (z + 1) * P + (y + 1) * PP;
  const UVE = 0.01;
  const tileUV = tile => [(tile % T.ATW) / T.ATW, 1 - (Math.floor(tile / T.ATW) + 1) / T.ATH];

  function faceVisible(id, n) {
    if (n === 0) return true;
    if (OPAQUE[n]) return false;
    if (LIQUID[id]) return !LIQUID[n];
    if (n === id) return id === B.LEAVES;
    return true;
  }

  // Build meshes for a chunk. `dataAt(cx, cz)` returns neighbour chunk data or null.
  R.meshChunk = function (ch, dataAt) {
    const srcs = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const d = dataAt(ch.cx + dx, ch.cz + dz); if (!d) return false; srcs.push(d);
    }
    pad.fill(B.BEDROCK, 0, PP);
    pad.fill(0, PP * (WH + 1));
    for (let z = -1; z <= CS; z++) {
      const sz = z < 0 ? 0 : z >= CS ? 2 : 1, lz = (z + CS) % CS;
      for (let x = -1; x <= CS; x++) {
        const sx = x < 0 ? 0 : x >= CS ? 2 : 1, lx = (x + CS) % CS, src = srcs[sz * 3 + sx];
        let si = lx + lz * CS, di = PI(x, 0, z);
        for (let y = 0; y < WH; y++) { pad[di] = src[si]; si += CS * CS; di += PP; }
      }
    }
    const O = { pos: [], uv: [], col: [], idx: [] }, Wt = { pos: [], uv: [], col: [], idx: [] };
    const ao = [0, 0, 0, 0];
    for (let y = 0; y < WH; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const id = pad[PI(x, y, z)];
      if (!id) continue;
      const liquid = LIQUID[id];
      for (let f = 0; f < 6; f++) {
        const F = FACES[f], dx = F.d[0], dy = F.d[1], dz = F.d[2];
        if (!faceVisible(id, pad[PI(x + dx, y + dy, z + dz)])) continue;
        const Tg = liquid ? Wt : O, base = Tg.pos.length / 3;
        const [u0, v0] = tileUV(T.BTEX[id][f]);
        const lowerTop = liquid && !LIQUID[pad[PI(x, y + 1, z)]];
        const ox = x + dx, oy = y + dy, oz = z + dz;
        for (let c = 0; c < 4; c++) {
          const C = F.c[c];
          Tg.pos.push(x + C[0], y + C[1] - (lowerTop && C[1] ? 0.12 : 0), z + C[2]);
          Tg.uv.push(u0 + (C[3] * (1 - 2 * UVE) + UVE) / T.ATW, v0 + (C[4] * (1 - 2 * UVE) + UVE) / T.ATH);
          let a = 3;
          if (!liquid) {
            const s1 = F.s[c][0], s2 = F.s[c][1];
            const o1 = OPAQUE[pad[PI(ox + s1[0], oy + s1[1], oz + s1[2])]];
            const o2 = OPAQUE[pad[PI(ox + s2[0], oy + s2[1], oz + s2[2])]];
            const oc = OPAQUE[pad[PI(ox + s1[0] + s2[0], oy + s1[1] + s2[1], oz + s1[2] + s2[2])]];
            a = o1 && o2 ? 0 : 3 - o1 - o2 - oc;
          }
          ao[c] = a;
          const b = SHADE[f] * AOL[a];
          Tg.col.push(b, b, b);
        }
        if (ao[1] + ao[2] > ao[0] + ao[3]) Tg.idx.push(base, base + 1, base + 3, base, base + 3, base + 2);
        else Tg.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      }
    }
    setMesh(ch, 'opaque', O, opaqueMat);
    setMesh(ch, 'water', Wt, waterMat);
    ch.dirty = false;
    return true;
  };
  function geometryFrom(Tg) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(Tg.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(Tg.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(Tg.col, 3));
    g.setIndex(Tg.idx);
    g.computeBoundingSphere();
    return g;
  }
  function setMesh(ch, slot, Tg, mat) {
    const old = ch[slot];
    if (old) { scene.remove(old); old.geometry.dispose(); ch[slot] = null; }
    if (!Tg.idx.length) return;
    const m = new THREE.Mesh(geometryFrom(Tg), mat);
    m.position.set(ch.cx * CS, 0, ch.cz * CS);
    m.matrixAutoUpdate = false; m.updateMatrix();
    if (slot === 'water') m.renderOrder = 1;
    scene.add(m);
    ch[slot] = m;
  }
  R.disposeChunk = function (ch) {
    for (const s of ['opaque', 'water']) if (ch[s]) { scene.remove(ch[s]); ch[s].geometry.dispose(); ch[s] = null; }
  };

  // ---------------------------------------------------------------- item geometry (drops, held items)
  const geoCache = new Map();
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
    const g = geometryFrom(Tg); geoCache.set(k, g); return g;
  }
  function spriteGeometry(itemId, size) {
    const k = 's' + itemId + ':' + size; if (geoCache.has(k)) return geoCache.get(k);
    const i = T.spriteIndex(itemId), g = new THREE.PlaneGeometry(size, size);
    const u0 = (i % T.SIW) / T.SIW, v0 = 1 - (Math.floor(i / T.SIW) + 1) / T.SIH, du = 1 / T.SIW, dv = 1 / T.SIH;
    const uv = g.attributes.uv;
    for (let j = 0; j < uv.count; j++) uv.setXY(j, u0 + uv.getX(j) * du, v0 + uv.getY(j) * dv);
    geoCache.set(k, g); return g;
  }
  // A mesh for a dropped item stack.
  R.itemMesh = function (itemId) {
    const d = BC.items.get(itemId);
    const m = d.kind === 'block' ? new THREE.Mesh(blockGeometry(d.block, 0.25), entBlockMat) : new THREE.Mesh(spriteGeometry(itemId, 0.42), entItemMat);
    scene.add(m); return m;
  };
  R.removeMesh = function (m) { scene.remove(m); };

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
    const c = T.TILE_AVG[T.BTEX[id][0]], r = Math.random;
    for (let i = 0; i < n; i++) {
      pos[i * 3] = x + 0.15 + r() * 0.7; pos[i * 3 + 1] = y + 0.15 + r() * 0.7; pos[i * 3 + 2] = z + 0.15 + r() * 0.7;
      vel[i * 3] = (r() - 0.5) * 3; vel[i * 3 + 1] = 1.5 + r() * 3; vel[i * 3 + 2] = (r() - 0.5) * 3;
      const k = 0.75 + r() * 0.35; col[i * 3] = c[0] * k; col[i * 3 + 1] = c[1] * k; col[i * 3 + 2] = c[2] * k;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const p = new THREE.Points(g, partMat); scene.add(p);
    particles.push({ p, vel, life: 0.8 });
  };
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
  // Daylight factor 0.2 (night) … 1 (day) for a time of day in [0,1).
  R.daylight = t => { const sy = Math.sin(t * Math.PI * 2); return 0.2 + 0.8 * smooth(-0.15, 0.3, sy); };
  R.updateSky = function (dayTime, dt, underwater, rd) {
    const a = dayTime * Math.PI * 2, sy = Math.sin(a);
    const light = R.daylight(dayTime);
    sky.copy(cNight).lerp(cDay, smooth(-0.2, 0.3, sy));
    const dusk = Math.exp(-((sy / 0.16) ** 2)) * 0.55; sky.lerp(cDusk, dusk);
    const eye = camera.position;
    if (underwater) {
      tmp.copy(cWater).multiplyScalar(light);
      scene.background.copy(tmp); scene.fog.color.copy(tmp); scene.fog.near = 0.5; scene.fog.far = 20;
    } else {
      scene.background.copy(sky); scene.fog.color.copy(sky); scene.fog.far = rd * CS; scene.fog.near = rd * CS * 0.55;
    }
    for (const m of [opaqueMat, waterMat, partMat, entBlockMat, entItemMat, heldBlockMat, heldItemMat, handMat]) m.color.setScalar(Math.max(light, 0.35));
    opaqueMat.color.setScalar(light); waterMat.color.setScalar(light); partMat.color.setScalar(light);
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
