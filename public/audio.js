// Antlands sound: a WebAudio synth, no files needed. On by default (M toggles it); starts on the first click or key.
//
//   ambience   breeze, birdsong by day, crickets and frogs at night, rain and thunder, heat-wave cicadas,
//              autumn leaves, the winter hush. Underground the yard is muffled and the soil hums.
//   close-up   fades in as you zoom in: ant crowds rustling and ticking, mandible clacks in fights,
//              spiders, beetles, ladybugs, butterflies, caterpillars, termites, aphids, puddle drips;
//              in the nest: digging, scurrying, eggs, drips in flooded tunnels.
//   yard       loud things you hear from anywhere: the mower engine, sprinklers, shoe stomps, the robin.
//
// Any sound can be replaced by a recorded file later: drop it in sfx/ and list it in sfx/manifest.json,
// e.g. { "rain": "rain.mp3", "thunder": "thunder.mp3" }. Names are the keys of SYNTH and LOOPS below.
(function (root) {
'use strict';
const AL = root.AL;
const R = Math.random, clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

let ctx = null, master = null, surfBus = null, surfLP = null, nestBus = null, uiBus = null, on = true;
try { on = localStorage.getItem('antlands.sound') !== 'off'; } catch (_) {}
const NOISE = {}, FILES = {}, layers = {};
let voices = 0;
const MAX_VOICES = 36, MASTER = 0.6;

// ---- setup ----------------------------------------------------------------------------------------
function noiseBuf(kind) {
  const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, br = 0;
  for (let i = 0; i < len; i++) {
    const w = R() * 2 - 1;
    if (kind === 'white') d[i] = w * 0.5;
    else if (kind === 'pink') { b0 = 0.997 * b0 + w * 0.029591; b1 = 0.985 * b1 + w * 0.032534; b2 = 0.95 * b2 + w * 0.048056; d[i] = (b0 + b1 + b2 + w * 0.05) * 1.6; }
    else { br = (br + w * 0.02) / 1.02; d[i] = br * 3.5; }
  }
  return buf;
}
function ensure() {
  if (ctx) return true;
  const AC = root.AudioContext || root.webkitAudioContext; if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = on ? MASTER : 0; master.connect(ctx.destination);
  // surface sounds pass through a low-pass that closes when you go underground
  surfLP = ctx.createBiquadFilter(); surfLP.type = 'lowpass'; surfLP.frequency.value = 18000; surfLP.Q.value = 0.4;
  surfBus = ctx.createGain(); surfBus.connect(surfLP); surfLP.connect(master);
  // the nest: a little cave echo
  nestBus = ctx.createGain(); nestBus.gain.value = 0;
  const dl = ctx.createDelay(1), fb = ctx.createGain(), wet = ctx.createGain(), dlf = ctx.createBiquadFilter();
  dl.delayTime.value = 0.13; fb.gain.value = 0.32; wet.gain.value = 0.35; dlf.type = 'lowpass'; dlf.frequency.value = 1800;
  nestBus.connect(master); nestBus.connect(dl); dl.connect(dlf); dlf.connect(fb); fb.connect(dl); dlf.connect(wet); wet.connect(master);
  uiBus = ctx.createGain(); uiBus.connect(master);
  NOISE.white = noiseBuf('white'); NOISE.pink = noiseBuf('pink'); NOISE.brown = noiseBuf('brown');
  buildLoops();
  return true;
}
function now() { return ctx.currentTime; }
function panner(bus, pan) {
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (!p) return bus;
  p.pan.value = clamp(pan || 0, -1, 1); p.connect(bus); return p;
}
function env(g, t, a, peak, dur) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + 0.01, dur));
}
function claim(dur) { if (voices >= MAX_VOICES) return false; voices++; setTimeout(() => voices--, (dur + 0.1) * 1000); return true; }

// ---- one-shot primitives --------------------------------------------------------------------------
// o: { vol, pan, bus, when, slide, a (attack) }
// (event sounds call tone/burst directly: no sound yet, sound off or a suspended context means silence, not a crash)
const live = () => on && !!ctx && ctx.state === 'running';
function tone(freq, dur, type, o) {
  if (!live()) return;
  o = o || {}; if (!claim(dur)) return;
  const t = now() + (o.when || 0), os = ctx.createOscillator(), g = ctx.createGain();
  os.type = type || 'sine'; os.frequency.setValueAtTime(freq, t);
  if (o.slide) os.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
  env(g, t, o.a || 0.008, o.vol || 0.05, dur);
  let out = g;
  if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; g.connect(f); out = f; }
  os.connect(g); out.connect(panner(o.bus || surfBus, o.pan)); os.start(t); os.stop(t + dur + 0.05);
}
// filtered noise burst
function burst(kind, dur, ftype, freq, o) {
  if (!live()) return;
  o = o || {}; if (!claim(dur)) return;
  const t = now() + (o.when || 0), src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = NOISE[kind] || NOISE.white; src.playbackRate.value = o.rate || 1;
  f.type = ftype; f.frequency.setValueAtTime(freq, t); f.Q.value = o.q || 1;
  if (o.sweep) f.frequency.exponentialRampToValueAtTime(o.sweep, t + dur);
  env(g, t, o.a || 0.005, o.vol || 0.05, dur);
  src.connect(f); f.connect(g); g.connect(panner(o.bus || surfBus, o.pan));
  src.start(t, R() * 2); src.stop(t + dur + 0.05);
}
function file(name, o) {
  const b = FILES[name]; if (!b || !claim(b.duration)) return false;
  o = o || {};
  const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; g.gain.value = (o.vol || 0.05) * 6;
  s.playbackRate.value = o.rate || (0.92 + R() * 0.16);
  s.connect(g); g.connect(panner(o.bus || surfBus, o.pan)); s.start(now() + (o.when || 0));
  return true;
}

// ---- named one-shots (each can be swapped for a file) ---------------------------------------------
const SYNTH = {
  chirp(o) { const f = 2600 + R() * 1800, n = 2 + (R() * 3 | 0); for (let k = 0; k < n; k++) tone(f * (1 + (R() - 0.5) * 0.25), 0.07 + R() * 0.05, 'sine', Object.assign({}, o, { when: (o.when || 0) + k * (0.09 + R() * 0.06), slide: f * (R() < 0.5 ? 1.35 : 0.8) })); },
  warble(o) { const f = 1800 + R() * 900; for (let k = 0; k < 6; k++) tone(f + (k % 2) * 380, 0.05, 'sine', Object.assign({}, o, { when: (o.when || 0) + k * 0.055 })); },
  cricket(o) { const f = 4100 + R() * 700, n = 3 + (R() * 3 | 0); for (let k = 0; k < n; k++) tone(f, 0.022, 'sine', Object.assign({}, o, { when: (o.when || 0) + k * 0.042, a: 0.003 })); },
  frog(o) { for (let k = 0; k < 3; k++) tone(150 + R() * 30, 0.07, 'sawtooth', Object.assign({}, o, { when: (o.when || 0) + k * 0.085, slide: 105, lp: 520 })); },
  leaves(o) { burst('pink', 0.35 + R() * 0.4, 'bandpass', 2200 + R() * 1200, Object.assign({ q: 0.7, a: 0.08 }, o)); },
  thunder(o) {
    burst('brown', 3.2 + R() * 1.5, 'lowpass', 220, Object.assign({}, o, { a: 0.25, q: 0.3, sweep: 70 }));
    if (o.near) burst('white', 0.25, 'highpass', 1500, Object.assign({}, o, { vol: o.vol * 0.7, a: 0.002 }));
  },
  clack(o) { tone(1700 + R() * 600, 0.018, 'square', Object.assign({ a: 0.002, lp: 4000 }, o)); burst('white', 0.02, 'bandpass', 3800, Object.assign({}, o, { vol: (o.vol || 0.03) * 0.8, when: (o.when || 0) + 0.03, q: 3 })); },
  tick(o) { burst('white', 0.012, 'highpass', 5200 + R() * 2500, Object.assign({ a: 0.001 }, o)); },
  skitter(o) { for (let k = 0; k < 4; k++) burst('white', 0.01, 'bandpass', 2600 + R() * 900, Object.assign({}, o, { when: (o.when || 0) + k * 0.035, q: 4, a: 0.001 })); },
  beetle(o) { tone(95 + R() * 30, 0.06, 'square', Object.assign({ lp: 700, a: 0.004 }, o)); burst('white', 0.03, 'bandpass', 1300, Object.assign({}, o, { vol: (o.vol || 0.03) * 0.6, when: (o.when || 0) + 0.02, q: 2 })); },
  hiss(o) { burst('white', 0.5, 'highpass', 3000, Object.assign({ a: 0.05 }, o)); },
  buzz(o) { tone(170 + R() * 50, 0.22, 'sawtooth', Object.assign({ lp: 900, a: 0.03 }, o)); },
  flutter(o) { for (let k = 0; k < 3; k++) burst('pink', 0.06, 'lowpass', 520, Object.assign({}, o, { when: (o.when || 0) + k * 0.11, a: 0.02 })); },
  munch(o) { for (let k = 0; k < 2; k++) burst('white', 0.035, 'bandpass', 1900 + R() * 900, Object.assign({}, o, { when: (o.when || 0) + k * 0.12, q: 2.5 })); },
  squeak(o) { tone(5200 + R() * 1500, 0.035, 'sine', Object.assign({ slide: 6800 }, o)); },
  drip(o) { tone(1300 + R() * 600, 0.08, 'sine', Object.assign({ slide: 520, a: 0.002 }, o)); },
  wings(o) { burst('pink', 0.22, 'bandpass', 520, Object.assign({ q: 0.8, a: 0.09 }, o)); },
  swoosh(o) { burst('pink', 1.3, 'bandpass', 300, Object.assign({ q: 0.9, a: 0.9, sweep: 2600 }, o)); },
  robin(o) { const f = 2300 + R() * 300; for (let k = 0; k < 4; k++) tone(f * (1 - k * 0.07), 0.11, 'sine', Object.assign({}, o, { when: (o.when || 0) + k * 0.15, slide: f * 0.85 })); },
  thud(o) { tone(70, 0.28, 'sine', Object.assign({ slide: 38, a: 0.004 }, o)); burst('brown', 0.3, 'lowpass', 160, Object.assign({}, o, { a: 0.004 })); },
  splat(o) { burst('brown', 0.4, 'lowpass', 300, Object.assign({ a: 0.003 }, o)); burst('white', 0.08, 'bandpass', 1600, Object.assign({}, o, { vol: (o.vol || 0.05) * 0.5 })); },
  scrape(o) { burst('white', 0.12 + R() * 0.06, 'bandpass', 700 + R() * 600, Object.assign({ q: 1.4, a: 0.01 }, o)); },
  plop(o) { tone(420 + R() * 80, 0.09, 'sine', Object.assign({ slide: 260 }, o)); },
  rumble(o) { burst('brown', 1.6, 'lowpass', 140, Object.assign({ a: 0.08 }, o)); },
  gush(o) { burst('pink', 2.2, 'lowpass', 900, Object.assign({ a: 0.3, sweep: 400 }, o)); },
  gulp(o) { tone(300, 0.06, 'sine', Object.assign({ slide: 160 }, o)); },
};
function play(name, o) { if (!on || !ensure() || ctx.state !== 'running') return; o = o || {}; if (!file(name, o)) SYNTH[name](o); }

// ---- loops: continuous layers whose volume follows the game ---------------------------------------
// each: noise type -> filter chain -> gain [-> AM] -> pan -> bus
const LOOPS = {
  wind:      { noise: 'brown', f: [['bandpass', 380, 0.5]], bus: 'surf' },
  rain:      { noise: 'white', f: [['highpass', 1100, 0.5], ['lowpass', 7000, 0.5]], bus: 'surf' },
  downpour:  { noise: 'brown', f: [['lowpass', 420, 0.6]], bus: 'surf' },
  cicadas:   { noise: 'white', f: [['bandpass', 5300, 7]], am: 46, bus: 'surf' },
  crowd:     { noise: 'white', f: [['bandpass', 3400, 1.3]], bus: 'surf' },
  mower:     { osc: [[56, 'sawtooth'], [112, 'square'], [168, 'sawtooth']], noise: 'brown', f: [['lowpass', 900, 0.7]], am: 9, bus: 'surf' },
  sprinkler: { noise: 'white', f: [['highpass', 3800, 0.5]], am: 5, bus: 'surf' },
  soil:      { noise: 'brown', f: [['lowpass', 130, 0.7]], osc: [[46, 'sine']], bus: 'nest' },
  scurry:    { noise: 'pink', f: [['bandpass', 2400, 1.1]], bus: 'nest' },
};
function buildLoops() {
  for (const name in LOOPS) {
    const L = LOOPS[name], g = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    g.gain.value = 0;
    let head = ctx.createGain(); head.gain.value = 1;
    let node = head;
    for (const [type, freq, q] of L.f || []) { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; node.connect(f); node = f; }
    let tail = g;
    node.connect(g);
    if (L.am) {
      // amplitude flutter: a gain wobbled by a slow oscillator
      const amg = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
      amg.gain.value = 0.55; lfo.frequency.value = L.am; depth.gain.value = 0.45; lfo.connect(depth); depth.connect(amg.gain); lfo.start();
      g.connect(amg); tail = amg;
    }
    const bus = L.bus === 'nest' ? nestBus : surfBus;
    if (pan) { tail.connect(pan); pan.connect(bus); } else tail.connect(bus);
    const srcs = [];
    if (L.noise) { const s = ctx.createBufferSource(); s.buffer = NOISE[L.noise]; s.loop = true; s.connect(head); s.start(0, R() * 2); srcs.push(s); }
    for (const [f, type] of L.osc || []) { const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = f; o.type = type; og.gain.value = type === 'sine' ? 0.6 : 0.12; o.connect(og); og.connect(head); o.start(); srcs.push(o); }
    layers[name] = { g, pan, head, srcs, filter: node };
    if (FILES[name]) swapLoop(name);
  }
}
function swapLoop(name) {
  const Ly = layers[name]; if (!Ly || !FILES[name]) return;
  for (const s of Ly.srcs) { try { s.stop(); } catch (_) {} }
  const s = ctx.createBufferSource(); s.buffer = FILES[name]; s.loop = true; s.connect(Ly.g); s.start();
  Ly.srcs = [s];
}
function setLoop(name, vol, pan, tc) {
  const L = layers[name]; if (!L) return;
  const t = now();
  L.g.gain.setTargetAtTime(Math.max(0, vol), t, tc || 0.35);
  if (L.pan && pan != null) L.pan.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.2);
}

// recorded replacements listed in sfx/manifest.json (optional)
function loadFiles() {
  if (!root.fetch) return;
  fetch('sfx/manifest.json').then(r => r.ok ? r.json() : {}).then(list => {
    for (const name in list) fetch('sfx/' + list[name]).then(r => r.arrayBuffer()).then(ab => {
      if (!ensure()) return;
      ctx.decodeAudioData(ab, b => { FILES[name] = b; if (layers[name]) swapLoop(name); });
    }).catch(() => {});
  }).catch(() => {});
}

// ---- the mixer: reads the game ~10 times a second -------------------------------------------------
const SEASON_BIRDS = { spring: 1, summer: 0.7, autumn: 0.4, winter: 0.08 };
const SEASON_CRICKETS = { spring: 0.5, summer: 1, autumn: 0.8, winter: 0 };
let crowdN = 0, crowdPan = 0, crowdNest = 0, lastCount = 0, windDrift = 0;
const chance = (perSec, dt) => R() < perSec * dt;

function viewInfo(G) {
  const r = G.renderer, w = G.world;
  if (!r || !w || !r.viewRect) return null;
  const nest = r.view === 'nest' && !!r.nest, cam = r.activeCam ? r.activeCam() : r.cam;
  const rect = r.viewRect(cam, 0), hw = (rect.x1 - rect.x0) / 2;
  let zf;
  if (nest) { const lim = r.zoomLimits ? r.zoomLimits() : { min: 0.5 }; zf = smooth(lim.min * 1.35, lim.min * 3, cam.z); }
  else zf = smooth(1.7, 3.4, cam.z);
  return { r, w, nest, cam, rect, hw, zf };
}
const inRect = (v, x, y, m) => x >= v.rect.x0 - (m || 0) && x <= v.rect.x1 + (m || 0) && y >= v.rect.y0 - (m || 0) && y <= v.rect.y1 + (m || 0);
const panOf = (v, x) => clamp((x - v.cam.x) / (v.hw || 1), -1, 1) * 0.8;
// loud yard sounds: heard across the yard, fading with distance from the camera (in view widths)
function distAtt(v, x, y, reach) {
  const d = Math.hypot(x - v.cam.x, y - v.cam.y) / Math.max(200, v.hw * 2);
  return clamp(1 - d / (reach || 3), 0.03, 1);
}

function countAnts(v) {
  const A = v.w.ants; let n = 0, sx = 0;
  const layer = v.nest ? 1 : 0;
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.layer[i] !== layer) continue;
    if (v.nest && A.nest[i] !== AL.me()) continue;
    const x = A.x[i], y = A.y[i];
    if (x < v.rect.x0 || x > v.rect.x1 || y < v.rect.y0 || y > v.rect.y1) continue;
    if (!v.nest && A.col[i] !== AL.me() && v.w.fog && !v.w.fog.visibleAt(x, y)) continue;
    n++; sx += x;
  }
  return { n, pan: n ? panOf(v, sx / n) : 0 };
}

function mix(dt) {
  const G = AL.Game; if (!ctx || !G || !G.world) return;
  const v = viewInfo(G); if (!v) return;
  const w = v.w, e = w.env || {}, W = w.weather || {}, season = e.season || 'spring';
  const paused = G.paused, day = clamp(1 - (e.night || 0), 0, 1), night = 1 - day;
  master.gain.setTargetAtTime(on ? (paused ? MASTER * 0.35 : MASTER) : 0, now(), 0.15);
  // underground: muffle the yard, bring up the soil
  surfLP.frequency.setTargetAtTime(v.nest ? 420 : 18000, now(), 0.25);
  surfBus.gain.setTargetAtTime(v.nest ? 0.55 : 1, now(), 0.25);
  nestBus.gain.setTargetAtTime(v.nest ? 1 : 0, now(), 0.25);

  // ---- ambience ----
  const wind = W.wind != null ? W.wind : 0.3;
  windDrift = clamp(windDrift + (R() - 0.5) * 0.08, -0.4, 0.4);
  setLoop('wind', (0.03 + 0.12 * wind) * (1 + windDrift * 0.5) * (e.winter ? 0.7 : 1), windDrift, 0.8);
  if (layers.wind) layers.wind.filter.frequency.setTargetAtTime(260 + 420 * wind + windDrift * 160, now(), 1);
  setLoop('rain', 0.2 * (W.rain || 0), 0);
  setLoop('downpour', 0.22 * clamp(((W.rain || 0) - 0.5) * 2, 0, 1), 0);
  const cic = day * ((season === 'summer' ? 0.035 : 0) + 0.075 * (W.heat || 0)) * (1 - (W.rain || 0));
  setLoop('cicadas', cic, 0.2);
  setLoop('soil', v.nest ? 0.12 : 0, 0);
  if (!paused) {
    const quiet = 1 - clamp((W.rain || 0) * 1.4, 0, 0.9);
    if (chance(0.9 * day * (SEASON_BIRDS[season] || 0.5) * quiet, dt)) play(R() < 0.75 ? 'chirp' : 'warble', { vol: 0.014 + R() * 0.012, pan: R() * 1.6 - 0.8 });
    if (chance(6 * night * (SEASON_CRICKETS[season] || 0) * quiet, dt)) play('cricket', { vol: 0.006 + R() * 0.008, pan: R() * 1.8 - 0.9 });
    if (chance(0.35 * night * (season === 'spring' ? 1 : season === 'summer' ? 0.6 : 0) * quiet, dt)) play('frog', { vol: 0.02 + R() * 0.015, pan: R() * 1.6 - 0.8 });
    if (chance((season === 'autumn' ? 0.5 : 0.08) * (0.3 + wind), dt)) play('leaves', { vol: 0.02 + R() * 0.02, pan: R() * 1.6 - 0.8 });
  }

  // ---- close-up: ant crowds ----
  if (performance.now() - lastCount > 250) { lastCount = performance.now(); const c = countAnts(v); crowdN = c.n; crowdPan = c.pan; }
  const crowd = v.zf * clamp(crowdN / 50, 0, 1);
  setLoop('crowd', v.nest ? 0 : 0.06 * crowd, crowdPan, 0.2);
  setLoop('scurry', v.nest ? 0.07 * crowd : 0, crowdPan, 0.2);
  if (!paused && crowd > 0.02 && chance(Math.min(crowdN, 40) * 0.5 * v.zf, dt)) {
    play('tick', { vol: 0.012 + 0.012 * v.zf, pan: crowdPan + (R() - 0.5) * 0.8, bus: v.nest ? nestBus : surfBus });
  }

  if (v.nest) mixNest(v, dt, paused);
  else mixSurface(v, dt, paused, e);
  mixYard(v, dt, paused);
}

function mixSurface(v, dt, paused) {
  if (paused || v.zf <= 0.02) return;
  const S = v.w.surface, z = v.zf, fog = v.w.fog;
  for (const cr of S.creatures || []) {
    if (!cr.alive || cr.hidden || !inRect(v, cr.x, cr.y, 30)) continue;
    if (fog && !fog.visibleAt(cr.x, cr.y)) continue;
    const o = { vol: 0.03 * z, pan: panOf(v, cr.x) };
    switch (cr.type) {
      case 'spider': if (cr.state !== 'lurk' && chance(1.6, dt)) play('skitter', o); else if (chance(0.15, dt)) play('skitter', Object.assign(o, { vol: o.vol * 0.4 })); break;
      case 'beetle': if (cr.state === 'defend' && chance(0.5, dt)) play('hiss', Object.assign(o, { vol: o.vol * 0.8 })); else if (chance(0.9, dt)) play('beetle', o); break;
      case 'ladybug': if (cr.flying) { if (chance(3, dt)) play('buzz', Object.assign(o, { vol: o.vol * 0.7 })); } else if (chance(0.4, dt)) play('munch', Object.assign(o, { vol: o.vol * 0.5 })); break;
      case 'butterfly': if (chance(1.2, dt)) play('flutter', Object.assign(o, { vol: o.vol * 0.8 })); break;
      case 'caterpillar': if (chance(1.4, dt)) play('munch', o); break;
      case 'termites': if (chance(3, dt)) play('tick', Object.assign(o, { vol: o.vol * 0.6 })); break;
      default: break;
    }
  }
  for (const p of S.pois || []) {
    if (p.gone || !inRect(v, p.x, p.y, 20)) continue;
    if (p.type === 'aphids' && chance(0.5, dt)) play('squeak', { vol: 0.008 * z, pan: panOf(v, p.x) });
    else if (p.type === 'puddle' && chance(0.7, dt)) play('drip', { vol: 0.02 * z, pan: panOf(v, p.x) });
  }
}

function mixNest(v, dt, paused) {
  if (paused) return;
  const n = v.w.nest || (v.w.player && v.w.player.nest);
  if (n && (n.flood > 0.02 || (v.w.env && v.w.env.rain > 0.3)) && chance(0.6 + (n.flood || 0) * 4, dt)) play('drip', { vol: 0.02 + 0.02 * v.zf, pan: R() * 1.4 - 0.7, bus: nestBus });
}

function mixYard(v, dt, paused) {
  const P = v.w.poi;
  // the mower: a growl you hear from anywhere, loudest close by
  if (P && P.human) {
    const M = P.human.mower;
    if (M.state === 'mow') { const a = distAtt(v, M.x, M.y, 2.6); setLoop('mower', 0.2 * a * a, panOf(v, M.x), 0.15); }
    else if (M.state === 'warn') setLoop('mower', 0.012 * (1 - M.t / 30), 0, 0.5);
    else setLoop('mower', 0, 0, 0.6);
    let sp = 0, spx = v.cam.x;
    if (P.human.sprink && P.human.sprink.on) for (const s of P.sprinklers || []) { const a = distAtt(v, s.x, s.y, 1.6); if (a > sp) { sp = a; spx = s.x; } }
    setLoop('sprinkler', 0.07 * sp * sp, panOf(v, spx), 0.3);
  }
  if (paused) return;
  const b = v.w.creatures && v.w.creatures.bird;
  if (b && b.alive && b.state === 'circle' && chance(1.2, dt)) { const a = distAtt(v, b.x, b.y, 2); play('wings', { vol: 0.05 * a, pan: panOf(v, b.x) }); }
}

// ---- events -------------------------------------------------------------------------------------
const lastT = {};
const rate = (k, s) => { const n = performance.now() / 1000; if (lastT[k] && n - lastT[k] < s) return false; lastT[k] = n; return true; };
const isMe = w => AL.Game && w === AL.Game.world;
function here(w, x, y) {   // close-up gain for an event at (x, y) on the surface, 0 if off screen or zoomed out
  const v = viewInfo(AL.Game); if (!v || v.nest || !inRect(v, x, y, 40)) return null;
  return v;
}
AL.on('fight', (w, d) => { if (!isMe(w) || !rate('fight', 0.07)) return; const v = here(w, d.x, d.y); if (v && v.zf > 0.05) play('clack', { vol: 0.035 * v.zf, pan: panOf(v, d.x) }); });
AL.on('antDied', (w, d) => { if (!isMe(w) || d.layer || d.cause !== 'crushed' || !rate('crush', 0.05)) return; const v = here(w, d.x, d.y); if (v && v.zf > 0.1) play('tick', { vol: 0.03 * v.zf, pan: panOf(v, d.x) }); });
AL.on('stomp', (w, d) => { if (!isMe(w)) return; const v = viewInfo(AL.Game); if (!v) return; const a = distAtt(v, d.x, d.y, 2.5); play('thud', { vol: 0.16 * a * a, pan: panOf(v, d.x) }); });
AL.on('appleFell', (w, d) => { if (!isMe(w)) return; const v = viewInfo(AL.Game); if (!v) return; const a = distAtt(v, d.x, d.y, 2); play('thud', { vol: 0.1 * a * a, pan: panOf(v, d.x) }); });
AL.on('picnic', (w, d) => { if (!isMe(w)) return; const v = viewInfo(AL.Game); if (!v) return; const a = distAtt(v, d.x, d.y, 2.5); play('splat', { vol: 0.12 * a, pan: panOf(v, d.x) }); });
AL.on('lightning', (w, d) => { if (!isMe(w)) return; const v = viewInfo(AL.Game); const a = v ? distAtt(v, d.x, d.y, 4) : 0.5; play('thunder', { vol: 0.09 + 0.1 * a, pan: v ? panOf(v, d.x) * 0.5 : 0, when: 0.2 + (1 - a) * 2.2, near: a > 0.7 }); });
AL.on('bird', (w, d) => { if (!isMe(w)) return; const v = viewInfo(AL.Game); if (v) play('robin', { vol: 0.03 + 0.03 * distAtt(v, d.x, d.y, 2), pan: panOf(v, d.x) }); });
AL.on('birdDive', (w, d) => { if (!isMe(w)) return; const v = viewInfo(AL.Game); if (v) play('swoosh', { vol: 0.08 * distAtt(v, d.x, d.y, 2), pan: panOf(v, d.x) }); });
AL.on('birdStrike', (w, d) => { if (!isMe(w)) return; const v = viewInfo(AL.Game); if (v) play('thud', { vol: 0.06 * distAtt(v, d.x, d.y, 2), pan: panOf(v, d.x) }); });
AL.on('ladybug', (w, d) => { if (!isMe(w)) return; const v = here(w, d.x, d.y); if (v) play('buzz', { vol: 0.03 * Math.max(0.3, v.zf), pan: panOf(v, d.x) }); });
AL.on('spiderHunt', (w, d) => { if (!isMe(w)) return; const v = here(w, d.x, d.y); if (v) play('skitter', { vol: 0.05 * Math.max(0.3, v.zf), pan: panOf(v, d.x) }); });
AL.on('mower', (w, d) => { if (isMe(w) && d.phase === 'warn') play('rumble', { vol: 0.04 }); });
AL.on('sprinkler', (w, d) => { if (isMe(w) && d.on) play('gush', { vol: 0.03 }); });
// nest
function nestHere(w, c, r) {
  const v = viewInfo(AL.Game); if (!v || !v.nest) return null;
  const n = v.r.nest, x = (c + 0.5) * n.tile, y = (r + 0.5) * n.tile;
  return inRect(v, x, y, 30) ? Object.assign(v, { px: panOf(v, x) }) : null;
}
AL.on('tunnelDug', (w, d) => { if (!isMe(w) || d.col !== AL.me() || !rate('dig', 0.1)) return; const v = nestHere(w, d.c, d.r); if (v) play('scrape', { vol: 0.03 + 0.03 * v.zf, pan: v.px, bus: nestBus }); });
AL.on('caveIn', (w, d) => { if (!isMe(w) || d.col !== AL.me()) return; play('rumble', { vol: 0.12, bus: nestBus }); });
AL.on('flood', (w, d) => { if (isMe(w) && d.col === AL.me() && d.on) play('gush', { vol: 0.06, bus: nestBus }); });
AL.on('eggLaid', (w, d) => { if (!isMe(w) || d.col !== AL.me() || !rate('egg', 0.3)) return; const v = viewInfo(AL.Game); if (v && v.nest && v.zf > 0.1) play('plop', { vol: 0.03 * v.zf, bus: nestBus }); });
AL.on('foodDelivered', (w, d) => { if (!isMe(w) || d.col !== AL.me() || !rate('food', 0.2)) return; const v = viewInfo(AL.Game); if (v && v.nest && v.zf > 0.15) play('gulp', { vol: 0.02 * v.zf, bus: nestBus }); });
// colony moments (UI-ish, always heard)
AL.on('raid', (w, d) => { if (!isMe(w) || d.target !== AL.me()) return; tone(220, 0.5, 'sawtooth', { vol: 0.05, slide: 140, bus: uiBus, lp: 1500 }); tone(196, 0.6, 'sawtooth', { vol: 0.05, slide: 120, bus: uiBus, when: 0.45, lp: 1500 }); });
AL.on('antBorn', (w, d) => { if (isMe(w) && d.col === AL.me() && rate('born', 1.5)) play('squeak', { vol: 0.012, bus: v0() }); });
AL.on('gameOver', (w, d) => { if (!isMe(w)) return; const n = d.win ? [523, 659, 784, 1046] : [392, 330, 262, 196]; n.forEach((f, k) => tone(f, 0.4, 'triangle', { vol: 0.07, when: k * 0.22, bus: uiBus })); });
// key point alarms (kp-alerts.js): a two-note call for a rival capturing, a falling siren for one of ours, a
// hard repeated klaxon when it's critical, a chime as the key points wake
AL.on('kpWarn', w => { if (!isMe(w) || !rate('kpWarn', 3)) return; tone(660, 0.14, 'triangle', { vol: 0.05, bus: uiBus }); tone(880, 0.18, 'triangle', { vol: 0.05, bus: uiBus, when: 0.16 }); });
AL.on('kpDanger', w => { if (!isMe(w) || !rate('kpDanger', 2.5)) return; tone(740, 0.35, 'sawtooth', { vol: 0.05, slide: 420, bus: uiBus, lp: 2200 }); tone(740, 0.35, 'sawtooth', { vol: 0.05, slide: 420, bus: uiBus, lp: 2200, when: 0.4 }); });
AL.on('kpCritical', w => { if (!isMe(w) || !rate('kpCritical', 3.5)) return; for (let k = 0; k < 3; k++) { tone(520, 0.16, 'square', { vol: 0.06, bus: uiBus, lp: 2600, when: k * 0.36 }); tone(390, 0.16, 'square', { vol: 0.06, bus: uiBus, lp: 2600, when: k * 0.36 + 0.18 }); } });
AL.on('kpWake', w => { if (!isMe(w)) return; for (let k = 0; k < 3; k++) tone(990 - k * 110, 0.2, 'sine', { vol: 0.05, bus: uiBus, when: k * 0.22 }); });
AL.on('recall', (w, d) => { if (isMe(w) && d.col === AL.me() && d.on) { tone(880, 0.12, 'square', { vol: 0.03, bus: uiBus, lp: 2500 }); tone(660, 0.16, 'square', { vol: 0.03, bus: uiBus, lp: 2500, when: 0.14 }); } });
function v0() { const v = AL.Game && viewInfo(AL.Game); return v && v.nest ? nestBus : surfBus; }

// ---- public ---------------------------------------------------------------------------------------
const Audio = AL.Audio = {
  get on() { return on; },
  toggle() {
    on = !on; try { localStorage.setItem('antlands.sound', on ? 'on' : 'off'); } catch (_) {}
    if (on && ensure()) ctx.resume();
    if (master) master.gain.setTargetAtTime(on ? MASTER : 0, now(), 0.05);
    if (AL.UI && AL.UI.toast) AL.UI.toast('Sound ' + (on ? 'on' : 'off'));
    if (AL.UI && AL.UI.syncSound) AL.UI.syncSound();
  },
  click() { if (on && ensure() && ctx.state === 'running') tone(880, 0.05, 'triangle', { vol: 0.04, bus: uiBus }); },
  chirp() { play('chirp', { vol: 0.02 }); },
  play, SYNTH, LOOPS,
  // for tests and the perf overlay: context state, busy voices, current loudness of each loop
  debug() { return { state: ctx ? ctx.state : 'none', voices, loops: Object.fromEntries(Object.entries(layers).map(([k, l]) => [k, +l.g.gain.value.toFixed(3)])) }; },
};
// browsers only allow sound after the player does something
function wake() { if (!on || !ensure()) return; if (ctx.state !== 'running') ctx.resume(); }
root.addEventListener('pointerdown', wake, true);
root.addEventListener('keydown', wake, true);
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('button')) Audio.click(); });
let lastMix = performance.now();
setInterval(() => {
  const t = performance.now(), dt = Math.min(0.3, (t - lastMix) / 1000); lastMix = t;
  if (ctx && ctx.state === 'running') { try { mix(dt); } catch (err) { if (!mix.warned) { mix.warned = true; console.warn('audio mix', err); } } }
}, 100);
loadFiles();
})(window);
