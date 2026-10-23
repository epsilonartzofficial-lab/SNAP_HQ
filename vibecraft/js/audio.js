'use strict';
// Sound effects, synthesized at run time with the Web Audio API (no audio files, all original): footsteps, digging,
// breaking and placing by material, hits, eating, splashes, interface clicks and creature voices.
// BC.sfx.play(name, opts) is safe to call anywhere; it does nothing until the first user gesture unlocks audio,
// when the volume is 0, or where Web Audio is missing (Node tests).
(function (root) {
  const BC = root.BC;
  let ctx = null, master = null, noise = null, volume = 0.7, listener = { x: 0, y: 0, z: 0, yaw: 0 };
  const AC = root.AudioContext || root.webkitAudioContext;

  function unlock() {
    if (!AC) return;
    if (!ctx) {
      try { ctx = new AC(); } catch (e) { ctx = null; return; }
      master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
      const n = ctx.sampleRate * 2, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      noise = buf;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }
  if (root.addEventListener) for (const ev of ['pointerdown', 'keydown', 'touchstart']) root.addEventListener(ev, unlock, { capture: true, passive: true });

  // Peak output level right now (0..1), read from an analyser on the master bus; used by tests and the dev panel.
  let analyser = null, abuf = null;
  function level() {
    if (!ctx) return 0;
    if (!analyser) { analyser = ctx.createAnalyser(); analyser.fftSize = 2048; master.connect(analyser); abuf = new Float32Array(analyser.fftSize); }
    analyser.getFloatTimeDomainData(abuf);
    let m = 0; for (let i = 0; i < abuf.length; i++) m = Math.max(m, Math.abs(abuf[i]));
    return m;
  }
  function setVolume(v) { volume = Math.max(0, Math.min(1, +v || 0)); if (master) master.gain.value = volume; }
  // Where the player's ears are, for distance and left/right of positioned sounds.
  function setListener(x, y, z, yaw) { listener.x = x; listener.y = y; listener.z = z; listener.yaw = yaw; }
  const ready = () => ctx && ctx.state === 'running' && volume > 0;

  // Output node for one sound: gain and stereo pan from its position (or centred when it has none).
  function out(gain, pos, range) {
    let g = gain, pan = 0;
    if (pos) {
      const dx = pos.x - listener.x, dy = pos.y - listener.y, dz = pos.z - listener.z, d = Math.hypot(dx, dy, dz), r = range || 16;
      if (d > r) return null;
      g *= Math.pow(1 - d / r, 1.6);
      // right of the view direction (-sin yaw, -cos yaw) is (cos yaw, -sin yaw)
      const rx = Math.cos(listener.yaw), rz = -Math.sin(listener.yaw);
      pan = d > 0.5 ? Math.max(-0.85, Math.min(0.85, (dx * rx + dz * rz) / d)) : 0;
    }
    if (g < 0.003) return null;
    const v = ctx.createGain(); v.gain.value = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; v.connect(p); p.connect(master); }
    else v.connect(master);
    return v;
  }
  const jit = (v, k) => v * (1 + (Math.random() * 2 - 1) * k);

  // Filtered noise burst. f: filter frequency, q, type, dur (s), a: attack (s), f2: frequency at the end.
  function burst(dest, t, { f = 1000, q = 1, type = 'bandpass', dur = 0.1, a = 0.004, f2, g = 1, mod = 0 }) {
    const s = ctx.createBufferSource(); s.buffer = noise; s.playbackRate.value = jit(1, 0.1);
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.setValueAtTime(f, t); flt.Q.value = q;
    if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const e = ctx.createGain(); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + a); e.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(flt); flt.connect(e);
    if (mod) {   // amplitude flutter (gravel grains, rattles, hisses)
      const am = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
      lfo.frequency.value = mod; depth.gain.value = 0.5; am.gain.value = 0.5; lfo.connect(depth); depth.connect(am.gain);
      e.connect(am); am.connect(dest); lfo.start(t); lfo.stop(t + dur + 0.05);
    } else e.connect(dest);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  // Oscillator note sliding from f to f2, optionally through a low-pass "mouth" filter and with vibrato.
  function note(dest, t, { f = 440, f2, type = 'sine', dur = 0.2, a = 0.01, g = 1, lp, vib = 0, vibF = 6, trem = 0 }) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    if (vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = vibF; lg.gain.value = vib; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + 0.05); }
    const e = ctx.createGain(); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + a); e.gain.setValueAtTime(g, t + Math.max(a, dur * 0.55)); e.gain.exponentialRampToValueAtTime(0.001, t + dur);
    let n = o;
    if (lp) { const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = lp; flt.Q.value = 3; o.connect(flt); n = flt; }
    if (trem) {
      const am = ctx.createGain(), l = ctx.createOscillator(), lg = ctx.createGain();
      am.gain.value = 0.6; l.frequency.value = trem; lg.gain.value = 0.4; l.connect(lg); lg.connect(am.gain); l.start(t); l.stop(t + dur + 0.05);
      n.connect(am); n = am;
    }
    n.connect(e); e.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ---- materials
  const MAT_CACHE = new Map();
  function materialOf(id) {
    if (MAT_CACHE.has(id)) return MAT_CACHE.get(id);
    const d = BC.blocks.DEFS[id], k = (d && d.key) || '';
    let m = 'stone';
    if (!d) m = 'stone';
    else if (/glass|ice/.test(k)) m = 'glass';
    else if (/wool|bed/.test(k)) m = 'wool';
    else if (/snow/.test(k)) m = 'snow';
    else if (/leaves|sapling|flower|tall_grass|fern|bush|torch/.test(k) || d.shape === 'cross') m = 'plant';
    else if (/gravel/.test(k)) m = 'gravel';
    else if (/sand/.test(k) && !/stone/.test(k)) m = 'sand';
    else if (/grass_block|moss|podzol|mycelium/.test(k)) m = 'grass';
    else if (/dirt|clay|mud|farmland/.test(k) || d.tool === 'shovel') m = 'dirt';
    else if (/log|planks|wood|table|chest|door|fence/.test(k) || d.tool === 'axe') m = 'wood';
    else if (d.liquid) m = 'water';
    MAT_CACHE.set(id, m);
    return m;
  }
  // Step, dig, break and place sounds per material: [kind, params] layers.
  const MAT = {
    grass: { step: [['b', { f: 2200, q: 0.7, dur: 0.11, g: 0.7 }], ['b', { f: 700, type: 'lowpass', dur: 0.06, g: 0.4 }]], hit: 1, brk: 1.8 },
    dirt: { step: [['b', { f: 650, type: 'lowpass', q: 1, dur: 0.1, g: 0.9 }]], hit: 1, brk: 1.6 },
    gravel: { step: [['b', { f: 1300, q: 0.9, dur: 0.13, g: 0.8, mod: 70 }]], hit: 1, brk: 1.6 },
    sand: { step: [['b', { f: 3200, type: 'highpass', dur: 0.12, a: 0.02, g: 0.55 }]], hit: 1, brk: 1.5 },
    snow: { step: [['b', { f: 1600, type: 'lowpass', q: 2, dur: 0.12, a: 0.015, g: 0.7, mod: 45 }]], hit: 1, brk: 1.5 },
    plant: { step: [['b', { f: 2600, type: 'highpass', dur: 0.14, a: 0.01, g: 0.5 }]], hit: 0.8, brk: 1.4 },
    wool: { step: [['b', { f: 420, type: 'lowpass', dur: 0.12, a: 0.02, g: 0.7 }]], hit: 0.8, brk: 1.3 },
    wood: { step: [['n', { f: 190, f2: 150, type: 'triangle', dur: 0.08, a: 0.002, g: 0.6 }], ['b', { f: 950, q: 2, dur: 0.07, g: 0.6 }]], hit: 1, brk: 1.8 },
    stone: { step: [['b', { f: 520, q: 1.6, dur: 0.08, a: 0.002, g: 0.9 }], ['b', { f: 2600, q: 3, dur: 0.03, a: 0.001, g: 0.25 }]], hit: 1, brk: 2 },
    glass: { step: [['b', { f: 1800, q: 4, dur: 0.06, a: 0.001, g: 0.6 }]], hit: 0.8, brk: 1 },
    water: { step: [['b', { f: 900, type: 'lowpass', dur: 0.2, a: 0.03, g: 0.5 }]], hit: 0.5, brk: 1 },
  };
  function layers(dest, t, list, scale, durMul) {
    for (const [kind, p] of list) {
      const q = Object.assign({}, p, { g: (p.g || 1) * scale, dur: p.dur * (durMul || 1) });
      if (q.f) q.f = jit(q.f, 0.12);
      if (kind === 'b') burst(dest, t, q); else note(dest, t, q);
    }
  }
  function glassBreak(dest, t) {
    for (let i = 0; i < 7; i++) burst(dest, t + i * 0.025 + Math.random() * 0.02, { f: jit(4200, 0.35), q: 8, dur: 0.12 + Math.random() * 0.15, a: 0.001, g: 0.5 });
    burst(dest, t, { f: 900, type: 'lowpass', dur: 0.15, g: 0.5 });
  }

  // ---- creature voices
  const VOICES = {
    pig: (d, t, k) => { note(d, t, { f: 150 * k, f2: 110 * k, type: 'sawtooth', dur: 0.16, lp: 650, g: 0.9 }); note(d, t + 0.2, { f: 135 * k, f2: 100 * k, type: 'sawtooth', dur: 0.14, lp: 600, g: 0.7 }); },
    cow: (d, t, k) => note(d, t, { f: 112 * k, f2: 92 * k, type: 'sawtooth', dur: 0.95, a: 0.12, lp: 520, vib: 2, vibF: 5, g: 0.9 }),
    sheep: (d, t, k) => note(d, t, { f: 320 * k, f2: 290 * k, type: 'sawtooth', dur: 0.6, a: 0.03, lp: 1100, trem: 24, g: 0.7 }),
    chicken: (d, t, k) => { for (let i = 0; i < 3; i++) note(d, t + i * 0.09, { f: jit(820, 0.15) * k, f2: 600 * k, type: 'square', dur: 0.06, lp: 1800, g: 0.35 }); },
    mirewalker: (d, t, k) => { note(d, t, { f: 82 * k, f2: 64 * k, type: 'sawtooth', dur: 1.2, a: 0.2, lp: 380, vib: 3, vibF: 3, g: 1 }); burst(d, t, { f: 300, type: 'lowpass', dur: 1, a: 0.3, g: 0.3 }); },
    hollow_archer: (d, t, k) => { for (let i = 0; i < 6; i++) burst(d, t + i * 0.055, { f: jit(3000, 0.2) * k, q: 6, dur: 0.035, a: 0.001, g: 0.7 }); },
    cragskitter: (d, t, k) => burst(d, t, { f: 4200 * k, type: 'highpass', dur: 0.45, a: 0.05, g: 0.5, mod: 32 }),
  };
  function voice(type, dest, t, k) { const v = VOICES[type]; if (v) v(dest, t, k); }

  // ---- the sound list
  function play(name, opts) {
    if (!ready()) return;
    const o = opts || {}, t = ctx.currentTime + 0.005;
    const at = o.pos || null;
    switch (name) {
      case 'step': case 'dig': case 'place': case 'break': {
        const mat = materialOf(o.block), M = MAT[mat] || MAT.stone;
        const base = { step: 0.22, dig: 0.3, place: 0.55, break: 0.6 }[name] * (o.gain || 1);
        const dest = out(base, at, 16); if (!dest) return;
        if (name === 'break' && mat === 'glass') { glassBreak(dest, t); return; }
        layers(dest, t, M.step, name === 'step' ? 1 : M.hit, name === 'break' ? M.brk : name === 'place' ? 1.2 : 1);
        if (name === 'break') layers(dest, t + 0.05, M.step, 0.6, M.brk);
        return;
      }
      case 'hurt': {   // the player takes damage
        const d = out(0.6); if (!d) return;
        note(d, t, { f: 260, f2: 150, type: 'square', dur: 0.16, lp: 1200, g: 0.5 }); burst(d, t, { f: 500, type: 'lowpass', dur: 0.12, g: 0.7 });
        return;
      }
      case 'land': { const d = out(0.5 * Math.min(1, o.gain || 1)); if (d) burst(d, t, { f: 260, type: 'lowpass', dur: 0.18, g: 1 }); return; }
      case 'swing': { const d = out(0.18); if (d) burst(d, t, { f: 600, f2: 2400, q: 1.2, dur: 0.14, a: 0.03, g: 0.8 }); return; }
      case 'hit': {   // something struck a creature
        const d = out(o.crit ? 0.6 : 0.45, at, 16); if (!d) return;
        burst(d, t, { f: 380, type: 'lowpass', dur: 0.1, a: 0.002, g: 1 }); if (o.crit) burst(d, t, { f: 3000, q: 2, dur: 0.08, a: 0.001, g: 0.5 });
        return;
      }
      case 'mob': {   // creature voice: o.type, o.kind 'ambient' | 'hurt' | 'death'
        const d = out(o.kind === 'ambient' ? 0.4 : 0.5, at, o.kind === 'ambient' ? 20 : 16); if (!d) return;
        const k = o.kind === 'hurt' ? 1.25 : o.kind === 'death' ? 0.8 : jit(1, 0.05);
        voice(o.type, d, t, k);
        if (o.kind === 'death') burst(d, t + 0.25, { f: 900, type: 'lowpass', dur: 0.35, a: 0.05, g: 0.4 });
        return;
      }
      case 'shoot': { const d = out(0.4, at, 16); if (d) { note(d, t, { f: 330, f2: 160, type: 'triangle', dur: 0.18, g: 0.6 }); burst(d, t, { f: 1500, f2: 400, q: 1, dur: 0.2, g: 0.3 }); } return; }
      case 'eat': { const d = out(0.35); if (d) burst(d, t, { f: jit(1100, 0.3), q: 1.5, dur: 0.09, a: 0.002, g: 1, mod: 60 }); return; }
      case 'burp': { const d = out(0.3); if (d) note(d, t, { f: 120, f2: 85, type: 'sawtooth', dur: 0.3, lp: 400, g: 0.6 }); return; }
      case 'splash': { const d = out(0.5 * Math.min(1, o.gain || 1)); if (d) { burst(d, t, { f: 2000, f2: 300, type: 'lowpass', dur: 0.5, a: 0.01, g: 1 }); burst(d, t + 0.05, { f: 4000, type: 'highpass', dur: 0.3, g: 0.3 }); } return; }
      case 'swim': { const d = out(0.15); if (d) burst(d, t, { f: 700, f2: 400, type: 'lowpass', dur: 0.3, a: 0.06, g: 0.8 }); return; }
      case 'pop': { const d = out(0.25, at, 12); if (d) note(d, t, { f: jit(700, 0.2), f2: 1400, type: 'sine', dur: 0.06, g: 0.6 }); return; }   // item pickup
      case 'click': { const d = out(0.25); if (d) note(d, t, { f: 900, f2: 700, type: 'square', dur: 0.035, a: 0.001, lp: 2500, g: 0.4 }); return; }
      case 'open': { const d = out(0.4, at, 12); if (d) { note(d, t, { f: 210, f2: 180, type: 'triangle', dur: 0.12, g: 0.6 }); burst(d, t, { f: 800, q: 2, dur: 0.15, g: 0.4 }); } return; }
      case 'fizz': { const d = out(0.3, at, 12); if (d) burst(d, t, { f: 3500, type: 'highpass', dur: 0.4, a: 0.02, g: 0.6 }); return; }   // furnace, fire
      case 'break_tool': { const d = out(0.5); if (d) { note(d, t, { f: 1400, f2: 500, type: 'square', dur: 0.12, lp: 3000, g: 0.4 }); burst(d, t, { f: 2500, q: 3, dur: 0.15, g: 0.5 }); } return; }
      default: return;
    }
  }

  // A sound must never break the game: failures are counted, not thrown.
  let errors = 0;
  function safePlay(name, opts) { try { play(name, opts); } catch (e) { errors++; } }

  BC.sfx = { play: safePlay, get errors() { return errors; }, level, setVolume, setListener, unlock, materialOf, get volume() { return volume; }, get running() { return !!(ctx && ctx.state === 'running'); }, NAMES: Object.keys(VOICES) };
})(typeof window !== 'undefined' ? window : globalThis);
