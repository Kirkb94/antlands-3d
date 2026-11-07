// Antlands nuptial flight scene: title card, countdown, the race over the backyard, end summary.
// Registers itself with AL.registerScene; drives AL.Flight (flight.js) and draws everything with
// Canvas paths (no raster files). Reuses the lead's ground painter and scenery drawing when present.
(function (root) {
'use strict';
// polish: small HUD text follows the UI text size (CSS --ui-scale, ui-settings.js), a notch bigger than before
const FS = n => { let k = 1; try { k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1; } catch (e) { /* no DOM */ } return Math.round(n * 1.12 * k * 10) / 10; };
const AL = root.AL, Fl = AL.Flight, TAU = Math.PI * 2;
const INTRO = 2.8, COUNT = 3, AFTER = 1.5, GO = 0.8;
const INK = '#f3e9d2', MUTE = '#bfae8f', GOLD = '#f2c14e', PANEL = 'rgba(24,17,11,0.86)', LINE = 'rgba(214,170,110,0.28)';
const GOOD = '#9bd36a', BAD = '#f08a6a';
const SPECIES_NAME = k => (AL.SPECIES && AL.SPECIES[k] ? AL.SPECIES[k].name : k);

let S = null; // scene state (one flight at a time)

// ---- setup ---------------------------------------------------------------------------------
function start(game, ctx) {
  ctx = ctx || {};
  const opts = Object.assign({}, ctx.opts || ctx.options || {});
  const seed = (opts.seed >>> 0) || ((Math.random() * 1e9) | 0);
  S = { listeners: [] };
  const surf = buildBackdrop(seed, opts);
  // founding sites: given in opts, or placed by the Founding stage's AL.Sites on this same map, or our defaults
  let sites = opts.sites || opts.foundingSites || null;
  const sz = (AL.MAP_SIZES && AL.MAP_SIZES[opts.mapSize]) || { W: 4000, H: 3000 };
  if (!sites && AL.Sites && AL.Sites.place) { try { sites = AL.Sites.place(surf || { W: sz.W, H: sz.H }, { seed, ids: AL.Sites.stageIds ? AL.Sites.stageIds(opts) : undefined }); } catch (e) { console.error('[flight] AL.Sites.place', e); sites = null; } }
  let colonies = Array.isArray(opts.colonies) ? opts.colonies : null;   // colonies stage: a number opts.colonies is the match size
  if (colonies) colonies = colonies.map((c, k) => Object.assign({ colonyId: c.colonyId != null ? c.colonyId : (c.id != null ? c.id : k) }, c, { isPlayer: c.isPlayer != null ? c.isPlayer : !!c.player }));
  if (!colonies) {
    // rivals: opts.rivals (count or species list), else one per opts.rivalSites, else 1. Rival 1 is fire ants
    // in the lead's rival colours so it matches the colony game.
    const rv = opts.rivals != null ? opts.rivals : opts.rivalSites ? opts.rivalSites.length : 1;
    const R = AL.rng(seed ^ 0x5bec);
    const keys = Object.keys(AL.SPECIES || { fire: 1, leafcutter: 1, carpenter: 1, army: 1 });
    const list = Array.isArray(rv) ? rv : Array.from({ length: Math.max(0, Math.min(7, rv | 0)) }, (_, k) => k === 0 ? 'fire' : R.pick(keys));
    colonies = [{ colonyId: 0, species: opts.species || 'fire', isPlayer: true }];
    list.forEach((sp, k) => colonies.push({ colonyId: k + 1, species: sp, colours: k === 0 && AL.RIVAL_COLOURS && sp === 'fire' ? AL.RIVAL_COLOURS : undefined }));
  }
  const fl = Fl.create({ seed, colonies, sites, duration: opts.flightTime, W: surf ? surf.W : sz.W, H: surf ? surf.H : sz.H });
  Object.assign(S, {
    game, ctx, opts, fl, seed, mode: 'intro', pt: 0, time: 0, frame: 0, doneSent: false,
    cam: { x: fl.W / 2, y: fl.H / 2, z: 0.2 }, zoomMul: 1, cw: 1, ch: 1, dpr: 1,
    ptr: { x: -1, y: -1, type: 'mouse', inside: false }, targetW: null, touchId: null, touchPos: null,
    mouseFlap: false, rightLand: false, btnHeld: {}, keys: new Set(), pinned: null, hoverSite: null,
    buttons: [], clouds: [], motes: [], dust: [], shed: [], toasts: [],
  });
  const me = Fl.player(fl);
  S.targetW = me ? { x: me.x + Math.cos(me.heading) * 200, y: me.y + Math.sin(me.heading) * 200 } : null;
  buildClouds(); buildMotes();
  attach();
}

// the yard under the flight: the match's map (founding-sites.js stageMap: the chosen biome and size) + the ground
// painter, or a plain lawn fallback
function buildBackdrop(seed, opts) {
  S.surf = null; S.ground = null; S.rp = null;
  try {
    if (AL.Surface && AL.Surface.generate) {
      if (AL.Sites && AL.Sites.stageMap) S.surf = AL.Sites.stageMap(Object.assign({}, opts, { seed }));
      else S.surf = AL.Surface.generate({ R: AL.rng(seed), seed }, { nests: [] });
      if (AL.Art && AL.Art.paintGround) S.ground = AL.Art.paintGround(S.surf, seed, []);
      if (AL.Renderer) {
        const rp = Object.create(AL.Renderer.prototype);
        rp.world = { surface: S.surf, colonies: [] }; rp.frame = 0; rp.atlas = [];
        rp.shadeCv = rp.paintTreeShade(S.surf);
        S.rp = rp;
      }
    }
  } catch (e) { console.error('[flight] backdrop', e); S.rp = null; }
  if (!S.ground) {
    const W = (S.surf && S.surf.W) || (AL.Surface && AL.Surface.W) || 4000, H = (S.surf && S.surf.H) || (AL.Surface && AL.Surface.H) || 3000;
    const c = mk(W / 8, H / 8), x = c.getContext('2d');
    x.fillStyle = '#5b8a3b'; x.fillRect(0, 0, c.width, c.height);
    const R = AL.rng(seed);
    for (let k = 0; k < 300; k++) { x.fillStyle = ['#64963f', '#4f7f33', '#7aa84c'][k % 3]; x.globalAlpha = 0.3; x.beginPath(); x.arc(R() * c.width, R() * c.height, 4 + R() * 20, 0, TAU); x.fill(); }
    S.ground = c;
  }
  return S.surf;
}
function mk(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }

// soft drifting cloud shadows (pre-rendered blobs, drawn big)
function buildClouds() {
  const R = AL.rng(S.seed ^ 0xC10D), fl = S.fl;
  for (let k = 0; k < 6; k++) {
    const c = mk(256, 170), x = c.getContext('2d');
    for (let j = 0; j < 7; j++) {
      const px = 50 + R() * 156, py = 45 + R() * 80, r = 30 + R() * 45;
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, 'rgba(18,32,44,0.55)'); g.addColorStop(0.6, 'rgba(18,32,44,0.3)'); g.addColorStop(1, 'rgba(18,32,44,0)');
      x.fillStyle = g; x.fillRect(0, 0, 256, 170);
    }
    S.clouds.push({ cv: c, x: R() * (fl.W + 1200) - 600, y: R() * (fl.H + 800) - 400, w: 900 + R() * 700, h: 0, sp: 0.8 + R() * 0.5 });
  }
  for (const cl of S.clouds) cl.h = cl.w * 0.66;
}
// dandelion fluff riding each breeze lane shows where the wind goes
function buildMotes() {
  const R = AL.rng(S.seed ^ 0x7A1E);
  S.fl.lanes.forEach((L, li) => { for (let k = 0; k < 46; k++) S.motes.push({ li, s: R() * L.len, off: (R() - 0.5) * L.w * 1.5, sp: 0.75 + R() * 0.5, rot: R() * TAU, wob: R() * TAU }); });
}

// ---- input ---------------------------------------------------------------------------------
function canvasEl() { return (S && S.c2d && S.c2d.canvas) || document.getElementById('cv') || document.querySelector('canvas'); }
function attach() {
  const cv = canvasEl(); if (!cv) return;
  const on = (el, ev, fn, o) => { el.addEventListener(ev, fn, o); S.listeners.push([el, ev, fn, o]); };
  on(cv, 'pointerdown', onDown); on(window, 'pointermove', onMove); on(window, 'pointerup', onUp); on(window, 'pointercancel', onUp);
  on(cv, 'contextmenu', e => e.preventDefault());
  on(cv, 'wheel', e => { e.preventDefault(); S.zoomMul = AL.clamp(S.zoomMul * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), 0.55, 1.9); }, { passive: false });
  on(cv, 'pointerleave', e => { if (e.pointerType === 'mouse') S.ptr.inside = false; });
  on(window, 'keydown', keyDown); on(window, 'keyup', e => S.keys.delete(e.code));
  on(window, 'blur', () => { S.keys.clear(); S.mouseFlap = false; S.rightLand = false; S.btnHeld = {}; });
}
function detach() { if (!S) return; for (const [el, ev, fn, o] of S.listeners) el.removeEventListener(ev, fn, o); S.listeners = []; }
function local(e) { const cv = canvasEl(), r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function hitButton(x, y) { for (const b of S.buttons) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b; return null; }

function onDown(e) {
  if (!S) return;
  const p = local(e);
  S.ptr.x = p.x; S.ptr.y = p.y; S.ptr.type = e.pointerType || 'mouse'; S.ptr.inside = true;
  try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
  const b = hitButton(p.x, p.y);
  if (S.mode === 'summary') { if (!b || b.id === 'continue') finishScene(); return; }
  if (b) { if (b.id === 'skip') skipAhead(); else S.btnHeld[b.id] = e.pointerId; e.preventDefault(); return; }
  if (e.button === 2) { S.rightLand = true; return; }
  const site = siteUnderScreen(p.x, p.y);
  if (S.ptr.type === 'mouse') { if (e.button === 0) S.mouseFlap = true; }
  else { S.touchId = e.pointerId; S.touchPos = p; S.targetW = toWorld(p.x, p.y); S.pinned = site ? site.id : null; }
}
function onMove(e) {
  if (!S) return;
  const p = local(e);
  if (e.pointerType === 'mouse' || !e.pointerType) { S.ptr.x = p.x; S.ptr.y = p.y; S.ptr.type = 'mouse'; S.ptr.inside = p.x >= 0 && p.y >= 0 && p.x <= S.cw && p.y <= S.ch; }
  else if (e.pointerId === S.touchId) { S.touchPos = p; S.ptr.x = p.x; S.ptr.y = p.y; }
}
function onUp(e) {
  if (!S) return;
  for (const k in S.btnHeld) if (S.btnHeld[k] === e.pointerId) delete S.btnHeld[k];
  if (e.pointerType === 'mouse' || !e.pointerType) { if (e.button === 2) S.rightLand = false; else S.mouseFlap = false; }
  if (e.pointerId === S.touchId) { S.touchId = null; S.touchPos = null; }
}
function keyDown(e) {
  if (!S) return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  S.keys.add(e.code);
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    if (S.mode === 'summary') finishScene();
    else if (S.mode === 'intro') { S.mode = 'count'; S.pt = 0; }
    else { const me = Fl.player(S.fl); if (me && me.site) skipAhead(); }
  }
  if (S && S.mode === 'summary' && e.code === 'Space') finishScene(); // S is null once done() ended the scene
}
// the lead's scene runner may forward keydowns here too: recording a held key twice is harmless
function key(e) { if (S && e && e.type === 'keydown' && !S.listeners.length) keyDown(e); }

function toWorld(x, y) { const z = S.cam.z; return { x: S.cam.x + (x - S.cw / 2) / z, y: S.cam.y + (y - S.ch / 2) / z }; }
function toScreen(x, y) { const z = S.cam.z; return { x: (x - S.cam.x) * z + S.cw / 2, y: (y - S.cam.y) * z + S.ch / 2 }; }
function siteUnderScreen(x, y) {
  let best = null, bd = 1e9;
  for (const s of S.fl.sites) { const p = toScreen(s.x, s.y), r = Math.max(s.r * S.cam.z, 22), d = Math.hypot(p.x - x, p.y - y); if (d < r && d < bd) { bd = d; best = s; } }
  return best;
}

function playerInput() {
  const k = S.keys, me = Fl.player(S.fl);
  let kx = 0, ky = 0;
  if (k.has('KeyW') || k.has('ArrowUp')) ky -= 1;
  if (k.has('KeyS') || k.has('ArrowDown')) ky += 1;
  if (k.has('KeyA') || k.has('ArrowLeft')) kx -= 1;
  if (k.has('KeyD') || k.has('ArrowRight')) kx += 1;
  if (S.ptr.type === 'mouse' && S.ptr.inside && !hitButton(S.ptr.x, S.ptr.y)) S.targetW = toWorld(S.ptr.x, S.ptr.y);
  if (S.touchPos) S.targetW = toWorld(S.touchPos.x, S.touchPos.y);
  if (kx || ky) S.targetW = null;
  const flap = k.has('ShiftLeft') || k.has('ShiftRight') || S.mouseFlap || !!S.btnHeld.flap;
  const land = k.has('Space') || k.has('KeyE') || k.has('KeyL') || S.rightLand || !!S.btnHeld.land;
  const t = S.targetW || (me ? { x: me.x, y: me.y } : { x: 0, y: 0 });
  return { tx: kx || ky ? null : t.x, ty: kx || ky ? null : t.y, kx, ky, flap, land };
}

// ---- update ------------------------------------------------------------------------------------
function update(game, dt) {
  if (!S) return;
  dt = Math.min(0.1, Math.max(0, dt || 0));
  S.time += dt; S.pt += dt; S.frame++;
  const fl = S.fl, me = Fl.player(fl);
  if (S.mode === 'intro' && S.pt >= INTRO) { S.mode = 'count'; S.pt = 0; }
  if (S.mode === 'count' && S.pt >= COUNT) { S.mode = 'fly'; S.pt = 0; Fl.start(fl); }
  if (S.mode === 'fly' || S.mode === 'after') {
    Fl.setInput(fl, playerInput());
    const warp = me && me.site && fl.phase !== 'done' ? 2.5 : 1;
    Fl.step(fl, dt * warp);
    if (S.mode === 'fly' && fl.phase === 'done') { S.mode = 'after'; S.pt = 0; }
    if (S.mode === 'after' && S.pt >= AFTER) { S.mode = 'summary'; S.pt = 0; }
  } else Fl.step(fl, dt);
  for (const ev of Fl.drainEvents(fl)) onEvent(ev);
  // world dressing
  const wdx = 16, wdy = 6;
  for (const c of S.clouds) { c.x += wdx * c.sp * dt; c.y += wdy * c.sp * dt; if (c.x > fl.W + 700) { c.x = -c.w - 300; } if (c.y > fl.H + 500) c.y = -c.h - 200; }
  for (const m of S.motes) { const L = fl.lanes[m.li]; if (!L) continue; m.s += L.str * m.sp * 0.85 * dt; m.rot += dt * 0.6; m.wob += dt * 1.7; if (m.s > L.len) m.s -= L.len; }
  for (let k = S.dust.length - 1; k >= 0; k--) { const p = S.dust[k]; p.age += dt; if (p.age > p.life) { S.dust.splice(k, 1); continue; } p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.pow(0.08, dt); p.vy *= Math.pow(0.08, dt); }
  for (let k = S.toasts.length - 1; k >= 0; k--) if ((S.toasts[k].age += dt) > 3.4) S.toasts.splice(k, 1);
  updateCamera(dt);
  // hovered site for the full card (mouse hover, a pinned tap, or the site under your queen)
  const hov = S.ptr.type === 'mouse' && S.ptr.inside ? siteUnderScreen(S.ptr.x, S.ptr.y) : null;
  S.hoverSite = hov ? hov.id : (S.pinned || (me && !me.site && me.over) || null);
}

function onEvent(ev) {
  const fl = S.fl, q = fl.queens.find(z => z.colonyId === ev.colonyId), s = ev.siteId != null ? Fl.siteById(fl, ev.siteId) : null;
  if (ev.type === 'takeoff') toast('Fly!', GOLD);
  if (ev.type === 'timeup') toast('Time is up: the last queens glide down', '#f0b25a');
  if (ev.type === 'land' && q && s) {
    const who = q.isPlayer ? 'You' : q.name + ' (' + SPECIES_NAME(q.species) + ')';
    toast(who + (q.isPlayer ? ' claim ' : ' claims ') + s.name + (ev.order === 1 ? ': first down!' : ''), q.team);
    if (ev.shared) toast('Shared site: instant neighbours, early war', BAD);
  }
  if (ev.type === 'touchdown') {
    const R = AL.rng((ev.colonyId + 1) * 7919 + (S.frame | 0));
    for (let k = 0; k < 34; k++) {
      const a = R() * TAU, sp = 30 + R() * 90;
      S.dust.push({ x: ev.x + Math.cos(a) * 6, y: ev.y + Math.sin(a) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8, r: 5 + R() * 9, life: 0.6 + R() * 0.7, age: 0, c: R() < 0.5 ? '186,150,104' : '150,118,80' });
    }
    // a newly mated queen breaks off her wings: they stay on the ground beside her
    for (let k = 0; k < 4; k++) S.shed.push({ x: ev.x + (R() - 0.5) * 34, y: ev.y + 10 + R() * 18, a: R() * TAU, l: k < 2 ? 12 : 9 });
  }
}
function toast(text, col) { S.toasts.push({ text, col: col || INK, age: 0 }); if (S.toasts.length > 4) S.toasts.shift(); }

function baseZoom() { return Math.sqrt((S.cw * S.ch) / (1900 * 1250)); }
function overviewZoom() { return Math.min(S.cw / S.fl.W, S.ch / S.fl.H) * 0.96; }
function updateCamera(dt) {
  const fl = S.fl, me = Fl.player(fl), cam = S.cam;
  const z0 = overviewZoom(), zf = AL.clamp(baseZoom(), 0.25, 1.2) * S.zoomMul;
  let tx = fl.W / 2, ty = fl.H / 2, tz = z0, k = 1 - Math.exp(-3 * dt);
  if (me) {
    const fx = me.x + me.vx * 0.6, fy = me.y + me.vy * 0.6;
    if (S.mode === 'intro') { tx = fl.W / 2; ty = fl.H / 2; tz = z0; k = 1; }
    else if (S.mode === 'count') { const e = AL.smooth(Math.min(1, S.pt / (COUNT * 0.8))); tx = AL.lerp(fl.W / 2, me.x, e); ty = AL.lerp(fl.H / 2, me.y, e); tz = AL.lerp(z0, zf, e); k = 1; }
    else if (S.mode === 'summary') { tx = fl.W / 2; ty = fl.H / 2; tz = z0; k = 1 - Math.exp(-2 * dt); }
    else if (me.site) { tx = me.lx; ty = me.ly; tz = zf * 0.8; k = 1 - Math.exp(-1.5 * dt); }
    else { tx = fx; ty = fy; tz = zf; }
  }
  cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; cam.z += (tz - cam.z) * (S.mode === 'count' || S.mode === 'intro' ? 1 : 1 - Math.exp(-4 * dt));
  // keep the view over the yard (a little hedge margin is fine)
  const hw = S.cw / 2 / cam.z, hh = S.ch / 2 / cam.z, m = 90;
  cam.x = hw * 2 >= fl.W + m * 2 ? fl.W / 2 : AL.clamp(cam.x, hw - m, fl.W + m - hw);
  cam.y = hh * 2 >= fl.H + m * 2 ? fl.H / 2 : AL.clamp(cam.y, hh - m, fl.H + m - hh);
}

// ---- render ----------------------------------------------------------------------------------
function render(c2d, game) {
  if (!S) return;
  S.c2d = c2d;
  const cv = c2d.canvas;
  S.dpr = cv.clientWidth ? cv.width / cv.clientWidth : (root.devicePixelRatio || 1);
  S.cw = cv.width / S.dpr; S.ch = cv.height / S.dpr;
  if (S.mode === 'intro' && S.frame < 2) updateCamera(0);
  const c = c2d, d = S.dpr;
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  c.fillStyle = '#2b4320'; c.fillRect(0, 0, cv.width, cv.height);
  drawWorld(c, d);
  c.setTransform(d, 0, 0, d, 0, 0);
  drawSiteLabels(c);
  drawQueens(c);
  drawGrade(c);
  layoutButtons();
  drawHud(c);
  if (S.mode === 'intro') drawTitle(c);
  if (S.mode === 'count' || (S.mode === 'fly' && S.pt < GO)) drawCountdown(c);
  if (S.mode === 'summary') drawSummary(c);
}

function drawWorld(c, d) {
  const fl = S.fl, z = S.cam.z, ox = S.cw / 2 - S.cam.x * z, oy = S.ch / 2 - S.cam.y * z;
  c.setTransform(d * z, 0, 0, d * z, d * ox, d * oy);
  const v = { x0: S.cam.x - S.cw / 2 / z, y0: S.cam.y - S.ch / 2 / z, x1: S.cam.x + S.cw / 2 / z, y1: S.cam.y + S.ch / 2 / z };
  // hedge border beyond the yard
  drawHedge(c, v);
  c.imageSmoothingEnabled = true;
  c.drawImage(S.ground, 0, 0, S.ground.width, S.ground.height, 0, 0, fl.W, fl.H);
  if (S.rp) {
    try {
      S.rp.frame = S.frame;
      S.rp.drawTreeShade(c, 0.5);
      S.rp.drawScenery(c, v, z);
      S.rp.drawFoods(c, v, z);
      S.rp.drawRocks(c, v);
    } catch (e) { if (!S.rpErr) console.error('[flight] scenery', e); S.rpErr = true; S.rp = null; }
  }
  for (const s of fl.sites) { if (s.decor && AL.Sites && AL.Sites.drawDecor) { try { AL.Sites.drawDecor(c, s, S.frame); continue; } catch (e) { if (!S.decorErr) console.error('[flight] drawDecor', e); S.decorErr = true; } } drawSiteGround(c, s, z); }
  drawShedWings(c);
  drawLanes(c, z, v);
  drawClouds(c);
  for (const s of fl.sites) drawSiteRing(c, s, z);
  drawDust(c);
}

function drawHedge(c, v) {
  const fl = S.fl;
  c.fillStyle = '#2d4a22'; c.fillRect(v.x0 - 10, v.y0 - 10, v.x1 - v.x0 + 20, v.y1 - v.y0 + 20);
  // leafy clumps along the fence line, only where visible
  const R = AL.rng(4242);
  for (let k = 0; k < 260; k++) {
    const side = k % 4, t = R() * (side < 2 ? fl.W : fl.H), o = 20 + R() * 120;
    const x = side === 0 ? t : side === 1 ? t : side === 2 ? -o : fl.W + o, y = side === 0 ? -o : side === 1 ? fl.H + o : t;
    const r = 40 + R() * 50;
    if (x + r < v.x0 || x - r > v.x1 || y + r < v.y0 || y - r > v.y1) continue;
    c.fillStyle = ['#355a28', '#3e6a2c', '#2a4520', '#46752f'][k % 4]; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }
}

// small ground dressing so each type reads at a glance, even where the yard has no matching prop
function drawSiteGround(c, s, z) {
  const R = AL.rng(hashStr(s.id) + 1);
  c.save(); c.translate(s.x, s.y);
  switch (s.type) {
    case 'sand': {
      const g = c.createRadialGradient(0, 0, 0, 0, 0, s.r * 1.1);
      g.addColorStop(0, 'rgba(232,208,152,0.95)'); g.addColorStop(0.7, 'rgba(220,192,135,0.7)'); g.addColorStop(1, 'rgba(210,180,120,0)');
      c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, s.r * 1.15, s.r * 0.9, 0.3, 0, TAU); c.fill();
      c.fillStyle = 'rgba(160,130,90,0.5)'; for (let k = 0; k < 40; k++) { c.beginPath(); c.arc((R() - 0.5) * s.r * 1.6, (R() - 0.5) * s.r * 1.2, 1 + R(), 0, TAU); c.fill(); }
      break;
    }
    case 'garden': {
      c.rotate(-0.12);
      c.fillStyle = 'rgba(40,25,12,0.35)'; c.beginPath(); c.roundRect(-s.r * 1.05 + 6, -s.r * 0.75 + 8, s.r * 2.1, s.r * 1.5, 14); c.fill();
      c.fillStyle = '#6b4a2c'; c.beginPath(); c.roundRect(-s.r * 1.05, -s.r * 0.75, s.r * 2.1, s.r * 1.5, 14); c.fill();
      c.strokeStyle = 'rgba(40,24,10,0.5)'; c.lineWidth = 3;
      for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(-s.r * 0.9, k * s.r * 0.26); c.lineTo(s.r * 0.9, k * s.r * 0.26); c.stroke(); }
      for (let k = -2; k <= 2; k++) for (let j = -3; j <= 3; j++) {
        const x = j * s.r * 0.26 + (R() - 0.5) * 6, y = k * s.r * 0.26 - 4;
        c.fillStyle = '#5aa83e'; c.beginPath(); c.ellipse(x - 4, y, 6, 3, -0.6, 0, TAU); c.fill(); c.beginPath(); c.ellipse(x + 4, y, 6, 3, 0.6, 0, TAU); c.fill();
      }
      break;
    }
    case 'stump': {
      c.fillStyle = 'rgba(20,14,6,0.35)'; c.beginPath(); c.ellipse(10, 14, s.r * 0.8, s.r * 0.75, 0, 0, TAU); c.fill();
      for (let k = 0; k < 5; k++) { const a = k / 5 * TAU + 0.3; c.strokeStyle = '#5a3e24'; c.lineWidth = 9; c.lineCap = 'round'; c.beginPath(); c.moveTo(Math.cos(a) * s.r * 0.5, Math.sin(a) * s.r * 0.5); c.quadraticCurveTo(Math.cos(a + 0.2) * s.r, Math.sin(a + 0.2) * s.r, Math.cos(a + 0.35) * s.r * 1.25, Math.sin(a + 0.35) * s.r * 1.25); c.stroke(); }
      const g = c.createRadialGradient(-10, -10, 4, 0, 0, s.r * 0.75);
      g.addColorStop(0, '#d8b080'); g.addColorStop(0.8, '#b28455'); g.addColorStop(1, '#6e4a2a');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, s.r * 0.72, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(110,70,38,0.55)'; c.lineWidth = 1.4;
      for (let k = 1; k < 6; k++) { c.beginPath(); c.arc(2, 1, s.r * 0.72 * k / 6, 0, TAU); c.stroke(); }
      c.strokeStyle = 'rgba(60,36,18,0.7)'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(0, 0); c.lineTo(s.r * 0.5, -s.r * 0.2); c.stroke();
      break;
    }
    case 'crack': {
      c.fillStyle = 'rgba(190,182,166,0.85)'; c.beginPath(); c.roundRect(-s.r, -s.r * 0.8, s.r * 2, s.r * 1.6, 6); c.fill();
      c.strokeStyle = '#2a241c'; c.lineWidth = 4; c.lineJoin = 'round'; c.beginPath(); c.moveTo(-s.r * 0.95, -s.r * 0.3);
      for (let k = 1; k <= 6; k++) c.lineTo(-s.r * 0.95 + k * s.r * 0.32, -s.r * 0.3 + (k % 2 ? 1 : -1) * 9 + k * 6);
      c.stroke();
      c.fillStyle = '#5c8c3c'; for (let k = 0; k < 5; k++) { c.beginPath(); c.ellipse(-s.r * 0.6 + k * s.r * 0.3, -s.r * 0.22 + k * 8, 4, 2, k, 0, TAU); c.fill(); }
      break;
    }
    case 'roots': {
      c.lineCap = 'round';
      for (let k = 0; k < 7; k++) {
        const a = k / 7 * TAU + R() * 0.4, L = s.r * (0.9 + R() * 0.5);
        c.strokeStyle = k % 2 ? '#6e4e30' : '#7d5a38'; c.lineWidth = 7 - k * 0.4;
        c.beginPath(); c.moveTo(Math.cos(a) * 10, Math.sin(a) * 10);
        c.bezierCurveTo(Math.cos(a + 0.5) * L * 0.4, Math.sin(a + 0.5) * L * 0.4, Math.cos(a - 0.4) * L * 0.7, Math.sin(a - 0.4) * L * 0.7, Math.cos(a) * L, Math.sin(a) * L); c.stroke();
        c.strokeStyle = 'rgba(255,230,190,0.2)'; c.lineWidth = 1.5; c.stroke();
      }
      break;
    }
    case 'log': {
      c.fillStyle = 'rgba(150,110,70,0.75)';
      for (let k = 0; k < 18; k++) { c.save(); c.translate((R() - 0.5) * s.r * 1.4, (R() - 0.5) * s.r * 1.1); c.rotate(R() * TAU); c.fillRect(-4, -1.5, 8, 3); c.restore(); }
      c.fillStyle = 'rgba(210,190,160,0.8)'; for (let k = 0; k < 6; k++) { c.beginPath(); c.arc((R() - 0.5) * s.r, (R() - 0.5) * s.r * 0.8, 3, 0, TAU); c.fill(); } // little mushrooms
      break;
    }
    case 'rock': {
      for (let k = 0; k < 9; k++) { const x = (R() - 0.5) * s.r * 1.4, y = (R() - 0.5) * s.r * 1.2, r = 3 + R() * 5; c.fillStyle = 'rgba(30,25,15,0.3)'; c.beginPath(); c.ellipse(x + 1.5, y + 2, r, r * 0.8, 0, 0, TAU); c.fill(); c.fillStyle = ['#b3ab9a', '#9d968a', '#c4bdae'][k % 3]; c.beginPath(); c.ellipse(x, y, r, r * 0.8, R() * 3, 0, TAU); c.fill(); }
      break;
    }
    default: { // meadow: tall tufts and a few flowers
      for (let k = 0; k < 22; k++) {
        const x = (R() - 0.5) * s.r * 1.8, y = (R() - 0.5) * s.r * 1.5;
        c.strokeStyle = ['#7db450', '#8cc45a', '#6aa244'][k % 3]; c.lineWidth = 2;
        for (let j = -1; j <= 1; j++) { c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + j * 4, y - 8, x + j * 7, y - 14); c.stroke(); }
        if (k % 5 === 0) { c.fillStyle = k % 10 ? '#f4f1e6' : '#f2c531'; c.beginPath(); c.arc(x + 3, y - 14, 3.2, 0, TAU); c.fill(); }
      }
    }
  }
  c.restore();
}
function hashStr(s) { s = String(s); let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h >>> 0; }

function drawSiteRing(c, s, z) {
  const fl = S.fl, me = Fl.player(fl), hot = S.hoverSite === s.id, over = me && !me.site && me.over === s.id;
  const pulse = 0.5 + 0.5 * Math.sin(S.time * 3 + hashStr(s.id));
  c.save(); c.translate(s.x, s.y);
  // landing pad glow
  const g = c.createRadialGradient(0, 0, s.r * 0.2, 0, 0, s.r * 1.25);
  g.addColorStop(0, 'rgba(255,240,200,' + (over ? 0.28 : 0.1) + ')'); g.addColorStop(1, 'rgba(255,240,200,0)');
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, s.r * 1.25, 0, TAU); c.fill();
  c.lineWidth = (over || hot ? 4 : 2.6) / z;
  c.strokeStyle = over ? GOLD : 'rgba(255,248,230,' + (0.55 + pulse * 0.25) + ')';
  c.setLineDash([14 / z, 9 / z]); c.lineDashOffset = -S.time * 18 / z;
  c.beginPath(); c.arc(0, 0, s.r, 0, TAU); c.stroke();
  c.setLineDash([]);
  if (s.occupants.length) { // claimed: solid rings in the owners' colours
    s.occupants.forEach((id, k) => { const q = fl.queens.find(o => o.colonyId === id); c.strokeStyle = q ? q.team : '#fff'; c.lineWidth = 4 / z; c.beginPath(); c.arc(0, 0, s.r + (3 + k * 6) / z, 0, TAU); c.stroke(); });
  }
  // hold-to-land progress
  if (me && me.holdSite === s.id && me.hold > 0) {
    c.strokeStyle = GOLD; c.lineWidth = 7 / z; c.lineCap = 'round';
    c.beginPath(); c.arc(0, 0, s.r + 8 / z, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, me.hold / Fl.TUNE.LAND_HOLD)); c.stroke();
  }
  c.restore();
}

function drawShedWings(c) {
  for (const w of S.shed) {
    c.save(); c.translate(w.x, w.y); c.rotate(w.a);
    c.fillStyle = 'rgba(235,240,250,0.55)'; c.strokeStyle = 'rgba(90,80,60,0.45)'; c.lineWidth = 0.6;
    c.beginPath(); c.ellipse(w.l / 2, 0, w.l / 2, w.l * 0.17, 0, 0, TAU); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(1, 0); c.lineTo(w.l * 0.85, 0); c.stroke();
    c.restore();
  }
}

function drawLanes(c, z, v) {
  const fl = S.fl;
  c.save();
  for (const L of fl.lanes) {
    // the ribbon: a faint warm band
    c.strokeStyle = 'rgba(255,248,220,0.07)'; c.lineWidth = L.w * 1.6; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); L.pts.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke();
    // drifting chevrons show which way it blows
    c.strokeStyle = 'rgba(255,252,235,0.22)'; c.lineWidth = 3 / z;
    const gap = 220, off = (S.time * L.str * 0.85) % gap;
    for (let s = off; s < L.len; s += gap) {
      const p = Fl.lanePoint(L, s);
      if (p.x < v.x0 - 50 || p.x > v.x1 + 50 || p.y < v.y0 - 50 || p.y > v.y1 + 50) continue;
      const nx = -p.ty, ny = p.tx, a = 16;
      c.beginPath(); c.moveTo(p.x - p.tx * a + nx * a, p.y - p.ty * a + ny * a); c.lineTo(p.x, p.y); c.lineTo(p.x - p.tx * a - nx * a, p.y - p.ty * a - ny * a); c.stroke();
    }
  }
  // dandelion fluff riding the breeze
  for (const m of S.motes) {
    const L = fl.lanes[m.li]; if (!L) continue;
    const p = Fl.lanePoint(L, m.s), off = m.off + Math.sin(m.wob) * 14;
    const x = p.x - p.ty * off, y = p.y + p.tx * off;
    if (x < v.x0 - 20 || x > v.x1 + 20 || y < v.y0 - 20 || y > v.y1 + 20) continue;
    const edge = Math.min(1, m.s / 300, (L.len - m.s) / 300);
    c.globalAlpha = 0.85 * edge;
    c.fillStyle = 'rgba(30,30,20,0.25)'; c.beginPath(); c.arc(x + 14, y + 18, 3.5, 0, TAU); c.fill(); // tiny shadow
    c.strokeStyle = 'rgba(255,255,250,0.85)'; c.lineWidth = 0.9;
    for (let k = 0; k < 8; k++) { const a = m.rot + k * TAU / 8; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6); c.stroke(); }
    c.fillStyle = '#fffdf2'; c.beginPath(); c.arc(x, y, 1.8, 0, TAU); c.fill();
  }
  c.globalAlpha = 1; c.restore();
}

function drawClouds(c) {
  c.save(); c.globalAlpha = 0.5; c.globalCompositeOperation = 'multiply';
  for (const cl of S.clouds) c.drawImage(cl.cv, cl.x, cl.y, cl.w, cl.h);
  c.restore();
}
function drawDust(c) {
  for (const p of S.dust) {
    const a = 1 - p.age / p.life;
    c.fillStyle = 'rgba(' + p.c + ',' + (a * 0.55).toFixed(3) + ')';
    c.beginPath(); c.arc(p.x, p.y, p.r * (1.4 - a * 0.6), 0, TAU); c.fill();
  }
}

// ---- queens ------------------------------------------------------------------------------------
function queenPx(q) { return 2.9 * AL.clamp(S.cam.z / 0.6, 0.8, 1.3) * (q.state === 'landed' ? 0.78 : 0.66 + 0.34 * Math.max(q.alt, 0.15)); }
function drawQueens(c) {
  const fl = S.fl, list = fl.queens.slice().sort((a, b) => (a.state === 'landed' ? 0 : 1) - (b.state === 'landed' ? 0 : 1) || a.alt - b.alt);
  // landed queens sit on the ground, then the shadows of the flyers, then the flyers
  for (const q of list) if (q.state === 'landed') { const p = toScreen(q.x, q.y); drawQueenShadow(c, q, p.x + 2, p.y + 3, queenPx(q), 0); drawQueenBody(c, q, p.x, p.y, queenPx(q), false); drawTag(c, q, p.x, p.y - 22); }
  for (const q of list) if (q.state !== 'landed') { const p = toScreen(q.x, q.y), k = queenPx(q); drawQueenShadow(c, q, p.x + 6 + q.alt * 34, p.y + 8 + q.alt * 46, k * (1 - q.alt * 0.12), q.alt); }
  const me = Fl.player(fl);
  if (me && me.state === 'fly' && S.mode !== 'summary') drawAim(c, me);
  for (const q of list) if (q.state !== 'landed') {
    const p = toScreen(q.x, q.y), k = queenPx(q);
    c.save(); c.globalAlpha = 0.9; c.strokeStyle = q.team; c.lineWidth = q.isPlayer ? 3 : 2;
    c.beginPath(); c.ellipse(p.x, p.y, 30 * k / 2.5, 24 * k / 2.5, 0, 0, TAU); c.stroke(); c.restore();
    drawQueenBody(c, q, p.x, p.y, k, true);
    drawTag(c, q, p.x, p.y - 40 * k / 2.5 - (q.isPlayer ? 16 : 6));
    if (q.isPlayer && q.state === 'fly') drawStaminaRing(c, q, p.x, p.y, k);
  }
}
function drawTag(c, q, x, y) {
  const txt = q.isPlayer ? 'You' : q.name;
  c.font = '700 ' + FS(11) + 'px system-ui,"Segoe UI",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  const w = c.measureText(txt).width + 12;
  c.fillStyle = 'rgba(24,17,11,0.72)'; c.beginPath(); c.roundRect(x - w / 2, y - 8, w, 16, 8); c.fill();
  c.fillStyle = q.team; c.fillText(txt, x, y + 0.5);
}
function drawAim(c, me) {
  if (!S.targetW || me.input.kx || me.input.ky) return;
  const a = toScreen(me.x, me.y), b = toScreen(S.targetW.x, S.targetW.y), d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d < 30) return;
  c.save(); c.strokeStyle = 'rgba(255,240,200,0.45)'; c.lineWidth = 2; c.setLineDash([3, 7]); c.lineDashOffset = -S.time * 30;
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]);
  if (S.ptr.type !== 'mouse') { c.strokeStyle = GOLD; c.lineWidth = 2; c.beginPath(); c.arc(b.x, b.y, 10, 0, TAU); c.stroke(); c.beginPath(); c.arc(b.x, b.y, 2.5, 0, TAU); c.fillStyle = GOLD; c.fill(); }
  c.restore();
}
function drawStaminaRing(c, q, x, y, k) {
  const r = 40 * k / 2.5;
  c.save(); c.lineCap = 'round'; c.lineWidth = 4;
  c.strokeStyle = 'rgba(24,17,11,0.55)'; c.beginPath(); c.arc(x, y, r, Math.PI * 0.75, Math.PI * 2.25); c.stroke();
  c.strokeStyle = q.winded ? BAD : q.flapping ? '#ffe08a' : q.inWind > 0.3 ? '#bfe9ff' : GOOD;
  c.beginPath(); c.arc(x, y, r, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * q.stamina); c.stroke();
  c.restore();
}
// silhouette shadow cast on the ground (sun from the upper left)
function drawQueenShadow(c, q, x, y, k, alt) {
  c.save(); c.translate(x, y); c.rotate(q.heading); c.scale(k, k);
  // two passes (a wide faint one, then the core) fake a soft edge without ctx.filter, which is slow
  const a = 0.3 - alt * 0.12, sp = q.state !== 'landed' ? wingSpread(q) : 0;
  for (let pass = 0; pass < 2; pass++) {
    const g = pass ? 0 : 0.6 + alt * 0.9;
    c.fillStyle = 'rgba(14,22,8,' + (pass ? a * 0.75 : a * 0.45).toFixed(3) + ')';
    c.beginPath(); c.ellipse(-4.2, 0, 4.6 + g, 2.9 + g, 0, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(1.5, 0, 2.6 + g, 1.6 + g, 0, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(4.6, 0, 1.7 + g, 1.5 + g, 0, 0, TAU); c.fill();
    if (q.state !== 'landed') for (const side of [-1, 1]) { c.save(); c.translate(0.8, side * 0.8); c.rotate(side * (Math.PI - sp)); c.beginPath(); c.ellipse(7.6, 0, 7.8 + g, 2.2 + g * 0.6, 0, 0, TAU); c.fill(); c.restore(); }
  }
  c.restore();
}
function wingSpread(q) { return q.flapping ? 0.55 + Math.sin(q.phase) * 0.42 : 0.34 + Math.sin(q.phase * 0.5) * 0.06; }
function drawWing(c, len, wid, ang, side, shimmer, alpha) {
  c.save(); c.rotate(side * ang);
  const g = c.createLinearGradient(0, 0, len, 0);
  g.addColorStop(0, 'rgba(225,235,250,' + (0.55 * alpha) + ')');
  g.addColorStop(AL.clamp(shimmer - 0.18, 0.05, 0.9), 'rgba(205,230,255,' + (0.4 * alpha) + ')');
  g.addColorStop(AL.clamp(shimmer, 0.1, 0.92), 'rgba(255,214,246,' + (0.62 * alpha) + ')');
  g.addColorStop(AL.clamp(shimmer + 0.12, 0.15, 0.95), 'rgba(255,246,196,' + (0.5 * alpha) + ')');
  g.addColorStop(1, 'rgba(235,245,255,' + (0.3 * alpha) + ')');
  c.fillStyle = g; c.strokeStyle = 'rgba(255,255,255,' + (0.7 * alpha) + ')'; c.lineWidth = 0.32;
  c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(len * 0.3, -side * wid * 1.25, len * 0.85, -side * wid * 1.05, len, -side * wid * 0.15);
  c.bezierCurveTo(len * 0.9, side * wid * 0.55, len * 0.4, side * wid * 0.6, 0, 0); c.fill(); c.stroke();
  c.strokeStyle = 'rgba(70,55,40,' + (0.45 * alpha) + ')'; c.lineWidth = 0.16;
  // veins
  c.beginPath(); c.moveTo(0.4, 0); c.quadraticCurveTo(len * 0.5, -side * wid * 0.55, len * 0.9, -side * wid * 0.25); c.moveTo(len * 0.35, -side * wid * 0.5); c.lineTo(len * 0.55, side * wid * 0.2); c.stroke();
  c.restore();
}
function drawQueenBody(c, q, x, y, k, flying) {
  c.save(); c.translate(x, y); c.rotate(q.heading); c.scale(k, k);
  if (flying) {
    const sp = wingSpread(q), sh = (Math.sin(S.time * 2.2 + q.colonyId) + 1) / 2 * 0.7 + 0.15;
    for (const side of [-1, 1]) {
      c.save(); c.translate(0.9, side * 0.7);
      if (q.flapping) { drawWing(c, 15, 3.4, Math.PI - 0.12, side, sh, 0.3); drawWing(c, 15, 3.4, Math.PI - 0.98, side, sh, 0.3); } // beat blur
      drawWing(c, 11.5, 2.7, Math.PI - sp - 0.3, side, sh, 0.9);         // hind wing
      drawWing(c, 15.5, 3.5, Math.PI - sp, side, sh, 1);                  // fore wing
      c.restore();
    }
  }
  if (AL.Art && AL.Art.drawAnt && AL.CASTE) AL.Art.drawAnt(c, AL.CASTE.QUEEN, q.pal, flying ? 0 : ((S.time * 6) | 0) & 3);
  else { c.fillStyle = q.pal.gaster; c.beginPath(); c.ellipse(-4.2, 0, 4.4, 2.6, 0, 0, TAU); c.fill(); c.fillStyle = q.pal.body; c.beginPath(); c.ellipse(1.5, 0, 2.4, 1.4, 0, 0, TAU); c.fill(); c.fillStyle = q.pal.head; c.beginPath(); c.arc(4.6, 0, 1.5, 0, TAU); c.fill(); }
  c.restore();
}

// warm daylight grade + soft vignette
function drawGrade(c) {
  const w = S.cw, h = S.ch;
  c.save();
  c.globalCompositeOperation = 'soft-light';
  let g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, 'rgba(255,214,140,0.35)'); g.addColorStop(1, 'rgba(255,170,90,0.12)');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = 'source-over';
  g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.hypot(w, h) * 0.62);
  g.addColorStop(0, 'rgba(30,18,6,0)'); g.addColorStop(1, 'rgba(30,18,6,0.32)');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.restore();
}

// ---- site labels and cards (screen space) ----------------------------------------------------------
function stars(f) { const n = Math.round(AL.clamp(f, 0, 1) * 3); return '★'.repeat(n) + '☆'.repeat(3 - n); }
function drawSiteLabels(c) {
  const fl = S.fl, me = Fl.player(fl), z = S.cam.z;
  const heading = {};
  for (const q of fl.queens) if (!q.site && q.aim != null) (heading[q.aim] = heading[q.aim] || []).push(q);
  for (const s of fl.sites) {
    const p = toScreen(s.x, s.y), r = s.r * z;
    if (p.x < -160 || p.x > S.cw + 160 || p.y < -120 || p.y > S.ch + 120) continue;
    const ty = p.y - r - 16;
    c.font = '700 ' + FS(12) + 'px system-ui,"Segoe UI",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const fit = me ? s.fit[me.species] : 0.5;
    const title = s.name, tw = c.measureText(title).width;
    const tags = '+' + s.pros.map(o => o.tag).join(' +') + '   −' + s.cons.map(o => o.tag).join(' −');
    c.font = '600 ' + FS(10) + 'px system-ui,"Segoe UI",sans-serif';
    const gw = c.measureText(tags).width, w = Math.max(tw + 54, gw + 16);
    c.fillStyle = 'rgba(24,17,11,0.8)'; c.strokeStyle = S.hoverSite === s.id ? GOLD : LINE; c.lineWidth = 1;
    c.beginPath(); c.roundRect(p.x - w / 2, ty - 26, w, 34, 8); c.fill(); c.stroke();
    // type swatch, name, species fit
    c.fillStyle = s.colour; c.beginPath(); c.arc(p.x - w / 2 + 11, ty - 15, 4.5, 0, TAU); c.fill();
    c.font = '700 ' + FS(12) + 'px system-ui,"Segoe UI",sans-serif'; c.fillStyle = INK; c.textAlign = 'left';
    c.fillText(title, p.x - w / 2 + 20, ty - 15);
    c.fillStyle = GOLD; c.font = '' + FS(11) + 'px system-ui,sans-serif'; c.textAlign = 'right'; c.fillText(stars(fit), p.x + w / 2 - 7, ty - 15);
    c.font = '600 ' + FS(10) + 'px system-ui,"Segoe UI",sans-serif'; c.textAlign = 'center';
    // pros in green, cons in coral
    const pros = '+' + s.pros.map(o => o.tag).join(' +'), cons = '   −' + s.cons.map(o => o.tag).join(' −');
    const pw = c.measureText(pros).width, cwid = c.measureText(cons).width, x0 = p.x - (pw + cwid) / 2;
    c.textAlign = 'left'; c.fillStyle = GOOD; c.fillText(pros, x0, ty - 1); c.fillStyle = BAD; c.fillText(cons, x0 + pw, ty - 1);
    // who is heading here (pips) and who has landed (flags)
    const hs = heading[s.id] || [];
    hs.forEach((q, k) => { const px = p.x - (hs.length - 1) * 7 + k * 14, py = ty + 16; c.fillStyle = q.team; c.beginPath(); c.moveTo(px, py + 5); c.lineTo(px - 5, py - 3); c.lineTo(px + 5, py - 3); c.closePath(); c.fill(); });
    if (s.shared) { c.font = '700 ' + FS(10) + 'px system-ui,sans-serif'; c.fillStyle = BAD; c.textAlign = 'center'; c.fillText('SHARED', p.x, p.y + r + 14); }
  }
  // the full card for the hovered / tapped / underfoot site
  const hs = S.hoverSite != null ? Fl.siteById(fl, S.hoverSite) : null;
  if (hs && S.mode !== 'summary' && S.mode !== 'intro') drawCard(c, hs, heading[hs.id] || []);
}
function wrapText(c, text, maxW) {
  const words = text.split(' '), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
function drawCard(c, s, heading) {
  const fl = S.fl, me = Fl.player(fl), z = S.cam.z, p = toScreen(s.x, s.y);
  const W = Math.min(270, S.cw - 32), pad = 12;
  c.font = '' + FS(12) + 'px system-ui,"Segoe UI",sans-serif';
  const rows = [];
  for (const o of s.pros) rows.push({ col: GOOD, mark: '+', head: o.tag, lines: wrapText(c, o.text, W - pad * 2 - 18) });
  for (const o of s.cons) rows.push({ col: BAD, mark: '−', head: o.tag, lines: wrapText(c, o.text, W - pad * 2 - 18) });
  let H = pad + 10 + 20 + 14 + 12 + 12;
  for (const r of rows) H += 12 + r.lines.length * 15;
  let x = p.x + s.r * z + 18, y = p.y - H / 2;
  if (x + W > S.cw - 12) x = p.x - s.r * z - 18 - W;
  if (x < 12) x = AL.clamp(p.x - W / 2, 12, S.cw - W - 12);
  y = AL.clamp(y, 64, S.ch - H - 100);
  c.save();
  c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.roundRect(x + 2, y + 5, W, H, 12); c.fill();
  c.fillStyle = PANEL; c.beginPath(); c.roundRect(x, y, W, H, 12); c.fill();
  c.strokeStyle = 'rgba(242,193,78,0.55)'; c.lineWidth = 1; c.stroke();
  c.fillStyle = s.colour; c.beginPath(); c.roundRect(x, y, 6, H, [12, 0, 0, 12]); c.fill();
  let cy = y + pad + 10;
  c.textAlign = 'left'; c.textBaseline = 'middle';
  c.fillStyle = INK; c.font = '700 16px system-ui,"Segoe UI",sans-serif'; c.fillText(s.name, x + pad + 4, cy);
  cy += 20;
  if (me) { c.font = '' + FS(12) + 'px system-ui,sans-serif'; c.fillStyle = MUTE; c.fillText('Fit for ' + SPECIES_NAME(me.species) + ': ', x + pad + 4, cy); const w0 = c.measureText('Fit for ' + SPECIES_NAME(me.species) + ': ').width; c.fillStyle = GOLD; c.fillText(stars(s.fit[me.species]), x + pad + 4 + w0, cy); }
  cy += 14;
  for (const r of rows) {
    cy += 8;
    c.fillStyle = r.col; c.font = '800 ' + FS(13) + 'px system-ui,sans-serif'; c.fillText(r.mark, x + pad + 4, cy);
    c.font = '700 ' + FS(12) + 'px system-ui,sans-serif'; c.fillText(r.head, x + pad + 20, cy);
    c.font = '' + FS(12) + 'px system-ui,sans-serif'; c.fillStyle = INK;
    for (const l of r.lines) { cy += 15; c.fillText(l, x + pad + 20, cy); }
    cy += 4;
  }
  cy += 12;
  c.font = '' + FS(11) + 'px system-ui,sans-serif'; c.fillStyle = MUTE;
  const landed = s.occupants.map(id => fl.queens.find(q => q.colonyId === id)).filter(Boolean);
  let foot = landed.length ? 'Claimed by ' + landed.map(q => q.isPlayer ? 'you' : q.name).join(' + ') : heading.length ? 'Heading here: ' + heading.map(q => q.isPlayer ? 'you' : q.name).join(', ') : 'Nobody heading here yet';
  if (landed.length && heading.length) foot += ' · ' + heading.length + ' more coming';
  c.fillText(foot, x + pad + 4, cy);
  c.restore();
}

// ---- HUD -----------------------------------------------------------------------------------------
function layoutButtons() {
  S.buttons = [];
  const me = Fl.player(S.fl);
  if (S.mode === 'summary') { const w = Math.min(240, S.cw - 48); S.buttons.push({ id: 'continue', x: S.cw / 2 - w / 2, y: S.sumBtnY || S.ch - 120, w, h: 48 }); return; }
  if (!me || S.mode === 'intro') return;
  if (me.site) { if (S.fl.phase !== 'done') S.buttons.push({ id: 'skip', x: S.cw / 2 - 90, y: S.ch - 76, w: 180, h: 46 }); return; }
  const bw = Math.min(150, (S.cw - 48) / 2 - 8), y = S.ch - 80, narrow = S.cw < 760;
  const cx = narrow ? S.cw / 2 : S.cw / 2;
  S.buttons.push({ id: 'flap', x: cx - bw - 8, y, w: bw, h: 56 });
  S.buttons.push({ id: 'land', x: cx + 8, y, w: bw, h: 56 });
}
function drawButton(c, b, label, sub, on, hot) {
  c.save();
  c.fillStyle = on ? 'rgba(242,193,78,0.92)' : hot ? 'rgba(60,44,22,0.92)' : PANEL;
  c.strokeStyle = hot || on ? GOLD : LINE; c.lineWidth = hot ? 2 : 1;
  c.beginPath(); c.roundRect(b.x, b.y, b.w, b.h, b.h / 2); c.fill(); c.stroke();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = on ? '#24170b' : hot ? GOLD : INK; c.font = '800 15px system-ui,"Segoe UI",sans-serif';
  c.fillText(label, b.x + b.w / 2, b.y + b.h / 2 - (sub ? 7 : 0));
  if (sub) { c.font = '600 ' + FS(10) + 'px system-ui,sans-serif'; c.fillStyle = on ? '#3a2810' : MUTE; c.fillText(sub, b.x + b.w / 2, b.y + b.h / 2 + 10); }
  c.restore();
}
function drawHud(c) {
  const fl = S.fl, me = Fl.player(fl), touch = S.ptr.type !== 'mouse';
  if (S.mode === 'intro') return;
  // timer
  const left = Math.max(0, fl.duration - fl.t), secs = Math.ceil(left);
  const tw = 150, tx = S.cw / 2 - tw / 2;
  c.save();
  c.fillStyle = PANEL; c.strokeStyle = LINE; c.beginPath(); c.roundRect(tx, 12, tw, 46, 12); c.fill(); c.stroke();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = 'italic 600 ' + FS(11) + 'px Georgia,"Times New Roman",serif'; c.fillStyle = MUTE; c.fillText('The Nuptial Flight', S.cw / 2, 24);
  c.font = '800 19px ui-monospace,Consolas,monospace'; c.fillStyle = fl.timeUp ? BAD : left < 10 && S.mode === 'fly' ? '#f0b25a' : INK;
  c.fillText(fl.timeUp ? 'landing' : '0:' + String(secs).padStart(2, '0'), S.cw / 2, 42);
  c.fillStyle = 'rgba(255,255,255,0.1)'; c.fillRect(tx + 12, 53, tw - 24, 2);
  c.fillStyle = GOLD; c.fillRect(tx + 12, 53, (tw - 24) * (left / fl.duration), 2);
  c.restore();
  // toasts
  if (S.mode !== 'summary') S.toasts.forEach((t, k) => {
    const a = Math.min(1, t.age * 4, (3.4 - t.age) * 2);
    c.save(); c.globalAlpha = a; c.font = '700 ' + FS(13) + 'px system-ui,"Segoe UI",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const w = c.measureText(t.text).width + 26, y = S.cw < 760 ? S.ch - 112 - (S.toasts.length - 1 - k) * 30 : 76 + k * 30;
    c.fillStyle = PANEL; c.beginPath(); c.roundRect(S.cw / 2 - w / 2, y - 12, w, 24, 12); c.fill();
    c.fillStyle = t.col; c.fillText(t.text, S.cw / 2, y + 0.5); c.restore();
  });
  drawRoster(c);
  drawMinimap(c);
  // wings panel + controls (bottom left; on narrow screens only the ring around your queen shows)
  if (me && !me.site && S.cw >= 760) {
    const x = 14, y = S.ch - 112, w = 250;
    c.save(); c.fillStyle = PANEL; c.strokeStyle = LINE; c.beginPath(); c.roundRect(x, y, w, 98, 12); c.fill(); c.stroke();
    c.textAlign = 'left'; c.textBaseline = 'middle';
    const state = me.winded ? 'Winded: glide to recover' : me.flapping ? 'Flapping' : me.inWind > 0.3 ? 'Riding the breeze' : 'Gliding';
    c.font = '700 ' + FS(12) + 'px system-ui,sans-serif'; c.fillStyle = INK; c.fillText('Wings', x + 12, y + 16);
    c.fillStyle = me.winded ? BAD : MUTE; c.font = '600 ' + FS(11) + 'px system-ui,sans-serif'; c.fillText(state, x + 58, y + 16);
    c.fillStyle = 'rgba(255,255,255,0.1)'; c.beginPath(); c.roundRect(x + 12, y + 28, w - 24, 8, 4); c.fill();
    c.fillStyle = me.winded ? BAD : me.flapping ? '#ffe08a' : GOOD; c.beginPath(); c.roundRect(x + 12, y + 28, (w - 24) * me.stamina, 8, 4); c.fill();
    c.font = '' + FS(11) + 'px system-ui,sans-serif'; c.fillStyle = MUTE;
    const tips = touch ? ['Tap or drag to steer', 'Hold FLAP to speed up', 'Over a site, hold LAND'] : ['Steer: move the mouse (or WASD)', 'Flap: hold left button or Shift', 'Land: over a site, hold Space / right button'];
    tips.forEach((t, k) => c.fillText(t, x + 12, y + 50 + k * 15));
    c.restore();
  }
  // buttons
  for (const b of S.buttons) {
    if (b.id === 'flap') drawButton(c, b, 'FLAP', me.winded ? 'winded' : touch ? 'hold' : 'hold Shift / click', !!S.btnHeld.flap || me.flapping, false);
    if (b.id === 'land') { const ok = me.over != null; drawButton(c, b, 'LAND', ok ? (touch ? 'hold here' : 'hold Space') : 'fly over a site', !!S.btnHeld.land || me.hold > 0, ok); }
    if (b.id === 'skip') drawButton(c, b, 'Skip ahead', 'Enter', false, false);
  }
  // "you landed" note
  if (me && me.site && S.mode !== 'summary') {
    const s = Fl.siteById(fl, me.site);
    c.save(); c.textAlign = 'center'; c.font = '700 14px system-ui,sans-serif'; c.fillStyle = INK;
    c.fillText('You settled at ' + s.name + (s.shared ? ' (shared)' : '') + '. Waiting for the other queens…', S.cw / 2, S.ch - 96); c.restore();
  }
}
function drawRoster(c) {
  const fl = S.fl, narrow = S.cw < 760, w = narrow ? 128 : 230, x = S.cw - w - 12, y = narrow ? 66 : 12, rh = narrow ? 18 : 20;
  const qs = fl.queens.slice().sort((a, b) => (a.order || 99) - (b.order || 99) || a.colonyId - b.colonyId);
  c.save(); c.fillStyle = PANEL; c.strokeStyle = LINE;
  c.beginPath(); c.roundRect(x, y, w, 24 + qs.length * rh, 12); c.fill(); c.stroke();
  c.textBaseline = 'middle'; c.textAlign = 'left'; c.font = '700 ' + FS(11) + 'px system-ui,sans-serif'; c.fillStyle = MUTE; c.fillText('QUEENS', x + 12, y + 13);
  qs.forEach((q, k) => {
    const ry = y + 30 + k * rh, s = q.site != null ? Fl.siteById(fl, q.site) : (q.aim != null ? Fl.siteById(fl, q.aim) : null);
    c.fillStyle = q.team; c.beginPath(); c.arc(x + 16, ry, 5, 0, TAU); c.fill();
    c.font = (q.isPlayer ? '800 ' : '600 ') + (narrow ? '10px' : '11px') + ' system-ui,sans-serif'; c.fillStyle = INK;
    const nm = (q.order ? q.order + '. ' : '') + (q.isPlayer ? 'You' : q.name);
    c.fillText(nm, x + 26, ry);
    c.textAlign = 'right'; c.fillStyle = q.site ? (q.order === 1 ? GOLD : INK) : MUTE; c.font = '' + FS(11) + 'px system-ui,sans-serif';
    const status = q.site ? s.short + ' ' + q.landedAt.toFixed(1) + 's' : (narrow ? '' : SPECIES_NAME(q.species)) + (s ? ' \u2192 ' + s.short : '');
    c.fillText(status, x + w - 10, ry); c.textAlign = 'left';
  });
  c.restore();
}
function drawMinimap(c) {
  const fl = S.fl, narrow = S.cw < 760;
  const w = narrow ? 112 : 200, h = w * fl.H / fl.W, x = narrow ? 16 : S.cw - w - 14, y = narrow ? 70 : S.ch - h - 14;
  const k = w / fl.W;
  c.save();
  c.fillStyle = PANEL; c.beginPath(); c.roundRect(x - 4, y - 4, w + 8, h + 8, 10); c.fill();
  c.beginPath(); c.roundRect(x, y, w, h, 7); c.clip();
  c.globalAlpha = 0.9; c.drawImage(S.ground, x, y, w, h); c.globalAlpha = 1;
  c.strokeStyle = 'rgba(255,250,230,0.35)'; c.lineWidth = 3;
  for (const L of fl.lanes) { c.beginPath(); L.pts.forEach(([px, py], i) => (i ? c.lineTo(x + px * k, y + py * k) : c.moveTo(x + px * k, y + py * k))); c.stroke(); }
  for (const s of fl.sites) { c.fillStyle = s.colour; c.strokeStyle = s.occupants.length ? (fl.queens.find(q => q.colonyId === s.occupants[0]) || {}).team || '#fff' : 'rgba(255,255,255,0.9)'; c.lineWidth = s.occupants.length ? 2 : 1; c.beginPath(); c.arc(x + s.x * k, y + s.y * k, 3.5, 0, TAU); c.fill(); c.stroke(); }
  for (const q of fl.queens) { c.fillStyle = q.team; c.beginPath(); c.arc(x + q.x * k, y + q.y * k, q.isPlayer ? 3.5 : 2.6, 0, TAU); c.fill(); if (q.isPlayer) { c.strokeStyle = '#fff'; c.lineWidth = 1; c.stroke(); } }
  const z = S.cam.z, vx = (S.cam.x - S.cw / 2 / z) * k, vy = (S.cam.y - S.ch / 2 / z) * k;
  c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1; c.strokeRect(x + vx, y + vy, S.cw / z * k, S.ch / z * k);
  c.restore();
}

// ---- title, countdown, summary ------------------------------------------------------------------
function drawTitle(c) {
  const t = S.pt, a = Math.min(1, t * 2.5, (INTRO - t) * 2.5), me = Fl.player(S.fl);
  c.save(); c.globalAlpha = Math.max(0, a);
  c.fillStyle = 'rgba(20,12,6,0.45)'; c.fillRect(0, 0, S.cw, S.ch);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  const big = Math.min(58, S.cw / 11);
  c.font = 'italic 600 ' + big + 'px Georgia,"Times New Roman",serif'; c.fillStyle = '#fff3d6';
  c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 18;
  c.fillText('The Nuptial Flight', S.cw / 2, S.ch / 2 - 30 + (1 - Math.min(1, t * 2)) * 12);
  c.shadowBlur = 0;
  c.strokeStyle = 'rgba(242,193,78,0.7)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(S.cw / 2 - 120, S.ch / 2 + 6); c.lineTo(S.cw / 2 + 120, S.ch / 2 + 6); c.stroke();
  c.font = '600 ' + Math.min(17, S.cw / 26) + 'px system-ui,"Segoe UI",sans-serif'; c.fillStyle = INK;
  c.fillText('Race the other queens to a home. Every site shows its pros and cons.', S.cw / 2, S.ch / 2 + 30);
  if (me) { c.font = '' + FS(13) + 'px system-ui,sans-serif'; c.fillStyle = MUTE; c.fillText('You are a young ' + SPECIES_NAME(me.species).replace(/s$/, '') + ' queen · ' + (S.fl.queens.length - 1) + (S.fl.queens.length === 2 ? ' rival' : ' rivals') + ' · two queens can share a site', S.cw / 2, S.ch / 2 + 56); }
  c.restore();
}
function drawCountdown(c) {
  let txt, f;
  if (S.mode === 'count') { const n = Math.ceil(COUNT - S.pt); txt = String(Math.max(1, n)); f = 1 - (S.pt % 1); }
  else { txt = 'Fly!'; f = 1 - S.pt / GO; }
  c.save(); c.globalAlpha = AL.clamp(f * 1.6, 0, 1); c.textAlign = 'center'; c.textBaseline = 'middle';
  const sz = 90 + (1 - f) * 40;
  c.font = '800 ' + sz + 'px system-ui,"Segoe UI",sans-serif';
  c.lineWidth = 8; c.strokeStyle = 'rgba(24,17,11,0.7)'; c.strokeText(txt, S.cw / 2, S.ch / 2 - 40);
  c.fillStyle = txt === 'Fly!' ? GOLD : '#fff3d6'; c.fillText(txt, S.cw / 2, S.ch / 2 - 40);
  if (S.mode === 'count') { c.font = '600 14px system-ui,sans-serif'; c.globalAlpha = 0.9; c.fillStyle = INK; c.fillText(S.ptr.type === 'mouse' ? 'Hover the sites to compare them. Point where you want to fly.' : 'Tap sites to compare them. Tap where you want to fly.', S.cw / 2, S.ch / 2 + 30); }
  c.restore();
}
function drawSummary(c) {
  const fl = S.fl, res = Fl.result(fl), a = Math.min(1, S.pt * 3);
  const qs = res.queens.slice().sort((x, y) => x.order - y.order);
  const W = Math.min(620, S.cw - 24), rowH = 34, H = 120 + qs.length * rowH + 70, x = S.cw / 2 - W / 2, y = Math.max(12, S.ch / 2 - H / 2);
  c.save(); c.globalAlpha = a;
  c.fillStyle = 'rgba(16,10,5,0.5)'; c.fillRect(0, 0, S.cw, S.ch);
  c.fillStyle = PANEL; c.strokeStyle = 'rgba(242,193,78,0.5)'; c.beginPath(); c.roundRect(x, y, W, H, 16); c.fill(); c.stroke();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = 'italic 600 30px Georgia,"Times New Roman",serif'; c.fillStyle = '#fff3d6'; c.fillText('Every queen has landed', S.cw / 2, y + 38);
  const shared = res.sites.filter(s => s.shared).length;
  c.font = '' + FS(13) + 'px system-ui,sans-serif'; c.fillStyle = MUTE;
  c.fillText((res.timeUp ? 'The flight ran out of time. ' : 'The flight took ' + res.duration.toFixed(1) + ' s. ') + (shared ? shared + (shared > 1 ? ' sites are' : ' site is') + ' shared: expect an early war.' : 'Nobody shares a site.'), S.cw / 2, y + 68);
  const narrow = W < 520, cols = narrow ? [x + 16, x + 40, x + W * 0.5, x + W - 16] : [x + 22, x + 52, x + W * 0.42, x + W * 0.72, x + W - 22];
  c.font = '700 ' + FS(10) + 'px system-ui,sans-serif'; c.fillStyle = MUTE; c.textAlign = 'left';
  c.fillText('QUEEN', cols[1], y + 98); c.fillText('SITE', cols[2], y + 98);
  if (!narrow) c.fillText('TIME', cols[3], y + 98);
  c.textAlign = 'right'; c.fillText('BONUS', cols[cols.length - 1], y + 98);
  qs.forEach((q, k) => {
    const ry = y + 122 + k * rowH, Q = fl.queens.find(z => z.colonyId === q.colonyId);
    if (q.isPlayer) { c.fillStyle = 'rgba(242,193,78,0.1)'; c.beginPath(); c.roundRect(x + 8, ry - rowH / 2 + 2, W - 16, rowH - 4, 8); c.fill(); }
    c.textAlign = 'left';
    c.font = '800 14px system-ui,sans-serif'; c.fillStyle = q.order === 1 ? GOLD : INK; c.fillText(String(q.order), cols[0], ry);
    c.fillStyle = q.team; c.beginPath(); c.arc(cols[1] + 5, ry, 5, 0, TAU); c.fill();
    c.font = (q.isPlayer ? '800 ' : '600 ') + '13px system-ui,sans-serif'; c.fillStyle = INK;
    c.fillText((q.isPlayer ? 'You' : Q.name) + (narrow ? '' : ' · ' + SPECIES_NAME(q.species)), cols[1] + 16, ry);
    c.font = '' + FS(13) + 'px system-ui,sans-serif'; c.fillText(q.siteName + (narrow ? ' ' + q.landedAt.toFixed(1) + 's' : ''), cols[2], ry);
    if (q.shared) { const sw = c.measureText(q.siteName + (narrow ? ' ' + q.landedAt.toFixed(1) + 's' : '')).width; c.font = '700 ' + FS(9) + 'px system-ui,sans-serif'; c.fillStyle = BAD; c.fillText('SHARED', cols[2] + sw + 6, ry); }
    if (!narrow) { c.font = '' + FS(13) + 'px ui-monospace,Consolas,monospace'; c.fillStyle = INK; c.fillText(q.landedAt.toFixed(1) + ' s', cols[3], ry); }
    c.textAlign = 'right'; c.font = '600 ' + FS(12) + 'px system-ui,sans-serif';
    const b = q.bonus, bt = b.reserves ? (b.reserves > 0 ? '+' : '') + Math.round(b.reserves * 100) + '% reserves' : '—';
    c.fillStyle = b.reserves > 0 ? GOOD : b.reserves < 0 ? BAD : MUTE; c.fillText(bt, cols[cols.length - 1], ry - (b.tags.length ? 6 : 0));
    if (b.tags.length) { c.font = '' + FS(10) + 'px system-ui,sans-serif'; c.fillStyle = MUTE; c.fillText(b.tags.join(', '), cols[cols.length - 1], ry + 8); }
  });
  S.sumBtnY = y + H - 62;
  const b = S.buttons.find(z => z.id === 'continue');
  if (b) { b.y = S.sumBtnY; drawButton(c, b, S.opts && S.opts.skipFounding ? 'Begin colony' : 'Begin founding', 'Enter / tap', false, true); }   // polish: founding skipped -> straight to colony play
  c.restore();
}

// ---- finish ------------------------------------------------------------------------------------
function skipAhead() { if (!S) return; Fl.finish(S.fl); for (const ev of Fl.drainEvents(S.fl)) onEvent(ev); S.mode = 'after'; S.pt = AFTER * 0.5; }
function finishScene() {
  if (!S || S.doneSent || S.mode !== 'summary' || S.pt < 0.4) return;
  S.doneSent = true;
  const patch = Fl.toPatch(S.fl);
  root.__antlandsFlight = patch;
  if (S.ctx && typeof S.ctx.done === 'function') S.ctx.done(patch);
}
function end() { detach(); if (S) { S.ground = null; S.rp = null; } S = null; }

// optional routed input (contract: the lead may forward pointer events); ignored while our own listeners run
function pointer(type, e) {
  if (!S || S.listeners.length) return;
  if (type === 'down' || type === 'pointerdown') onDown(e); else if (type === 'move' || type === 'pointermove') onMove(e); else if (type === 'up' || type === 'pointerup' || type === 'cancel') onUp(e);
}
const Scene = {
  id: 'flight', order: 10,
  enabled(opts) { return !(opts && opts.skipFlight); },
  start, update, render, key, pointer, end,
  state: () => S, // for tests / harness
};
AL.FlightScene = Scene;
if (AL.registerScene) AL.registerScene(Scene);
})(window);
