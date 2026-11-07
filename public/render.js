// Antlands renderer: the surface (top-down backyard). Draw order:
// ground -> trails -> scenery & food -> mounds -> ants -> creatures -> particles -> shade -> light grade -> fog -> health bars
(function (root) {
'use strict';
const AL = root.AL, Art = AL.Art, TAU = Math.PI * 2, K = AL.CARRY;

// food trail heat ramp: 256 RGBA entries indexed by sqrt(strength / max)
function trailRamp() {
  const stops = [   // t, r, g, b, alpha
    [0.00, 255, 232, 160, 0], [0.05, 255, 230, 150, 60], [0.22, 255, 214, 96, 115], [0.42, 255, 178, 44, 160],
    [0.55, 255, 132, 28, 190], [0.72, 236, 66, 30, 215], [0.88, 255, 170, 80, 235], [1.00, 255, 244, 205, 250],
  ];
  const L = new Uint8ClampedArray(256 * 4);
  for (let k = 0; k < 256; k++) {
    const t = k / 255; let j = 0; while (j < stops.length - 2 && t > stops[j + 1][0]) j++;
    const a = stops[j], b = stops[j + 1], u = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
    for (let c = 0; c < 4; c++) L[k * 4 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * u;
  }
  return L;
}

class Renderer {
  constructor(cv) {
    this.cv = cv; this.ctx = cv.getContext('2d', { alpha: false });
    this.dpr = 1; this.w = 1; this.h = 1;
    this.cam = { x: 800, y: 2200, z: 2.2 };
    this.showTrails = true;
    this.trailCv = null; this.trailImg = null; this.trailFrame = 0;
    this.particles = []; this.frame = 0;
    this.stats = { drawn: 0, ms: 0 };
    this.dotCache = {};
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = Math.max(1, Math.floor(window.innerWidth * dpr)); this.h = Math.max(1, Math.floor(window.innerHeight * dpr));
    this.cv.width = this.w; this.cv.height = this.h;
  }
  setWorld(world) {
    this.world = world;
    const S = world.surface;
    this.atlas = world.colonies.map(c => Art.buildAtlas(c.colours, k => AL.CASTES[k].size * c.sp.size));
    this.ground = Art.paintGround(S, world.seed, world.colonies);
    this.chunks = new Art.ChunkCache(this.ground, S, world.seed);
    this.trailCv = Art.canvas(S.gw, S.gh);
    this.trailCtx = this.trailCv.getContext('2d');
    this.trailImg = this.trailCtx.createImageData(S.gw, S.gh);
    this.glow = Art.softDot(32, '255,220,140');
    this.puff = Art.softDot(32, '255,90,60');
    this.moundCache = new Map();
    this.shadeCv = this.paintTreeShade(S);
    const p = world.player; this.cam.x = p.x + 60; this.cam.y = p.y - 40; this.cam.z = 2.2;
  }
  // ---- camera helpers ----
  viewRect(cam, margin) {
    const z = cam.z * this.dpr, hw = this.w / 2 / z, hh = this.h / 2 / z, m = margin || 0;
    return { x0: cam.x - hw - m, y0: cam.y - hh - m, x1: cam.x + hw + m, y1: cam.y + hh + m };
  }
  screenToWorld(sx, sy, cam) {
    cam = cam || this.cam; const z = cam.z * this.dpr;
    return { x: cam.x + (sx * this.dpr - this.w / 2) / z, y: cam.y + (sy * this.dpr - this.h / 2) / z };
  }
  clampCam(cam) {
    const S = this.world.surface, z = cam.z * this.dpr;
    const hw = this.w / 2 / z, hh = this.h / 2 / z;
    cam.x = hw * 2 >= S.W ? S.W / 2 : AL.clamp(cam.x, hw, S.W - hw);
    cam.y = hh * 2 >= S.H ? S.H / 2 : AL.clamp(cam.y, hh, S.H - hh);
  }

  // ---- frame ----
  draw(alpha) {
    const t0 = performance.now();
    this.frame++;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawSurface(ctx, this.cam, alpha, 1);
    this.stats.ms = performance.now() - t0;
  }
  // render hook: every registered system with render[name] draws here (see docs/CONTRACT.md)
  layer(name, ctx, view) {
    const sys = this.world.systems;
    for (let k = 0; k < sys.length; k++) {
      const r = sys[k].render; if (!r || !r[name]) continue;
      ctx.save();
      try { r[name](ctx, view, this); } catch (e) { if (!this._warned) { console.error('[render ' + sys[k].id + '.' + name + ']', e); this._warned = true; } }
      ctx.restore();
      ctx.setTransform(view.z, 0, 0, view.z, view.ox, view.oy);
    }
  }
  drawSurface(ctx, cam, alpha, opacity) {
    const world = this.world, S = world.surface, z = cam.z * this.dpr;
    const ox = this.w / 2 - cam.x * z, oy = this.h / 2 - cam.y * z;
    const v = this.viewRect(cam, 0);
    world.view = this.viewRect(cam, 80);
    // view handed to render hooks: world rect + transform (screen = world * z + o), alpha for interpolation
    const view = Object.assign(v, { z, ox, oy, w: this.w, h: this.h, dpr: this.dpr, cam, alpha, scene: 'surface', frame: this.frame });
    this.lastView = view;
    ctx.globalAlpha = opacity;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawGround(ctx, cam, v, z, ox, oy);
    ctx.setTransform(z, 0, 0, z, ox, oy);
    this.layer('ground', ctx, view);
    this.drawTreeShade(ctx, 0.5);
    if (this.showTrails) this.drawTrails(ctx, S);
    this.drawScenery(ctx, v, z);
    this.drawFoods(ctx, v, z);
    for (const c of world.colonies) this.drawMound(ctx, c, z);
    this.layer('underAnts', ctx, view);
    this.drawAnts(ctx, cam, alpha, v, z, ox, oy);
    ctx.setTransform(z, 0, 0, z, ox, oy);
    this.drawParticles(ctx, z);
    this.layer('overAnts', ctx, view);
    this.drawRocks(ctx, v);
    this.drawTreeShade(ctx, 1);
    this.layer('weather', ctx, view);
    this.layer('grade', ctx, view);
    if (this.showTrails) this.drawTrailGlow(ctx, S);
    this.drawOrders(ctx, view);
    if (world.fog) this.drawFog(ctx, view);
    this.layer('fog', ctx, view);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.drawBars) this.drawBars(ctx, view);   // health bars over hurt ants and creatures, above the fog and the night
    this.layer('screen', ctx, Object.assign({}, view, { z: 1, ox: 0, oy: 0 }));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  drawGround(ctx, cam, v, z, ox, oy) {
    const gs = Art.GROUND_RES;
    ctx.imageSmoothingEnabled = true;
    // whole-map painting (cheap) ...
    const sx = Math.max(0, v.x0), sy = Math.max(0, v.y0), ex = Math.min(this.world.surface.W, v.x1), ey = Math.min(this.world.surface.H, v.y1);
    ctx.drawImage(this.ground, sx * gs, sy * gs, (ex - sx) * gs, (ey - sy) * gs, sx * z + ox, sy * z + oy, (ex - sx) * z, (ey - sy) * z);
    // ... and crisp detail chunks once zoomed in (built progressively, two per frame)
    if (cam.z >= 1.1) {
      const C = Art.CHUNK; let budget = 2;
      const cx0 = Math.max(0, Math.floor(v.x0 / C)), cx1 = Math.floor(Math.min(this.world.surface.W - 1, v.x1) / C);
      const cy0 = Math.max(0, Math.floor(v.y0 / C)), cy1 = Math.floor(Math.min(this.world.surface.H - 1, v.y1) / C);
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        let ch = this.chunks.get(cx, cy, false);
        if (!ch && budget > 0) { ch = this.chunks.get(cx, cy, true); budget--; }
        if (ch) ctx.drawImage(ch, Math.floor(cx * C * z + ox), Math.floor(cy * C * z + oy), Math.ceil(C * z) + 1, Math.ceil(C * z) + 1);
      }
    }
  }

  // dappled shade under tree canopies (a soft painted blob layer); pass 0.5 under ants, 1 over them
  paintTreeShade(S) {
    const res = 0.125, c = Art.canvas(S.W * res, S.H * res), x = c.getContext('2d');
    const R = AL.rng(77);
    for (const t of S.trees) {
      for (let k = 0; k < 60; k++) {
        const a = R() * TAU, d = Math.sqrt(R()) * t.r, r = (30 + R() * 70) * res;
        const px = (t.x + Math.cos(a) * d + 40) * res, py = (t.y + Math.sin(a) * d + 50) * res;
        const g = x.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, 'rgba(10,25,15,0.55)'); g.addColorStop(1, 'rgba(10,25,15,0)');
        x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
      }
    }
    return c;
  }
  drawTreeShade(ctx, pass) {
    const S = this.world.surface;
    ctx.save();
    ctx.globalAlpha *= pass === 1 ? 0.28 : 0.5;
    ctx.imageSmoothingEnabled = true;
    const sway = Math.sin(this.frame * 0.01) * 4;
    ctx.drawImage(this.shadeCv, sway, 0, S.W, S.H);
    ctx.restore();
  }

  // trails: rebuild a small RGBA image from the pheromone grids every few frames; GPU upscales it smoothly.
  // Your food trails use a heat ramp (faint pale gold -> gold -> orange -> red -> white-hot) so busy ant
  // highways stand out from fresh or painted trails (the brush tops out around orange). Strong trails also
  // get a soft glow pass after the day/night grade so they stay readable at night.
  drawTrails(ctx, S) {
    const world = this.world;
    if (!this.trailLut) this.trailLut = trailRamp();
    if (!this.glowCv || this.glowCv.width !== S.gw) { this.glowCv = Art.canvas(S.gw, S.gh); this.glowCtx = this.glowCv.getContext('2d'); this.glowImg = this.glowCtx.createImageData(S.gw, S.gh); }
    if (this.frame % 4 === 0) {
      const d = this.trailImg.data, gd = this.glowImg.data, LUT = this.trailLut;
      const me = world.me || 0, fg = world.pher.food[me], f = fg.data, fmax = fg.max || 12, fk = 255 / Math.sqrt(fmax);
      const al = world.pher.alarm[me].data, av = (world.pher.avoidOf ? world.pher.avoidOf[me] : world.pher.avoid).data, rc = (world.pher.recruitOf ? world.pher.recruitOf[me] : world.pher.recruit).data;
      // rival trails: the strongest of every rival colony's food + alarm grids (2-8 colonies)
      const NR = world.pher.food.length;
      let rf = null, ra = null;
      if (NR > 1) {
        if (!this.rivalPher || this.rivalPher.length !== S.gw * S.gh) this.rivalPher = new Float32Array(S.gw * S.gh);
        const m = this.rivalPher; m.fill(0);
        for (let k = 0; k < NR; k++) {
          if (k === me) continue;
          const a = world.pher.food[k].data, b = world.pher.alarm[k] ? world.pher.alarm[k].data : null;
          for (let i = 0; i < m.length; i++) { const v = a[i] + (b ? b[i] : 0); if (v > m[i]) m[i] = v; }
        }
        rf = m; ra = null;
      }
      const fog = world.fog, gw = S.gw;
      const n = S.gw * S.gh;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        let fv = f[i], a = al[i], v = av[i], r = rc[i];
        let ef = 0;
        // rival trails show only where you can see (pheromone cell 16 -> fog cell 32)
        if (rf && rf[i] > 0.05) { if (!fog || fog.vis[(((i / gw) | 0) >> 1) * fog.w + ((i % gw) >> 1)]) ef = rf[i]; }
        gd[o + 3] = 0;
        if (fv < 0.03 && a < 0.03 && v < 0.03 && r < 0.03 && ef < 0.05) { d[o + 3] = 0; continue; }
        // other trails: alarm red, avoid violet, recruit cyan, enemy trail dull crimson (additive mix as before)
        a = Math.min(1, a * 0.6); v = Math.min(1, v * 0.5); r = Math.min(1, r * 0.6); ef = Math.min(1, ef * 0.3);
        const tot = a + v + r + ef;
        let R = 0, G = 0, B = 0, A = 0;
        if (tot > 0) {
          R = (240 * a + 150 * v + 90 * r + 170 * ef) / tot; G = (60 * a + 80 * v + 220 * r + 40 * ef) / tot; B = (50 * a + 230 * v + 240 * r + 50 * ef) / tot;
          A = Math.min(0.8, 0.2 + tot * 0.67);
        }
        // food trail on top, from the heat ramp (sqrt scale: faint trails still show, highways saturate late)
        if (fv >= 0.03) {
          const k = Math.min(255, (Math.sqrt(fv) * fk) | 0) * 4, fa = LUT[k + 3] / 255;
          const na = fa + A * (1 - fa);
          R = (LUT[k] * fa + R * A * (1 - fa)) / na; G = (LUT[k + 1] * fa + G * A * (1 - fa)) / na; B = (LUT[k + 2] * fa + B * A * (1 - fa)) / na; A = na;
          if (k > 96 * 4) { gd[o] = LUT[k]; gd[o + 1] = LUT[k + 1]; gd[o + 2] = LUT[k + 2]; gd[o + 3] = Math.min(255, (k / 4 - 96) * 1.6); }
        }
        d[o] = R; d[o + 1] = G; d[o + 2] = B; d[o + 3] = A * 255;
      }
      this.trailCtx.putImageData(this.trailImg, 0, 0);
      this.glowCtx.putImageData(this.glowImg, 0, 0);
    }
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.globalAlpha *= 0.78;
    ctx.drawImage(this.trailCv, 0, 0, S.gw * S.cell, S.gh * S.cell);
    ctx.restore();
  }
  // after the light grade: strong trails glow a little, more at night, so highways read in the dark too
  drawTrailGlow(ctx, S) {
    if (!this.glowCv) return;
    const env = this.world.env || {}, k = 0.12 + 0.5 * (env.night || 0);
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.globalAlpha *= k; ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.glowCv, 0, 0, S.gw * S.cell, S.gh * S.cell);
    ctx.restore();
  }

  drawScenery(ctx, v, z) {
    const S = this.world.surface;
    // flowers and clover tufts
    for (const f of S.flowers) {
      if (f.cut) continue;   // mowed
      if (f.x < v.x0 - 20 || f.x > v.x1 + 20 || f.y < v.y0 - 20 || f.y > v.y1 + 20) continue;
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.scale(f.s, f.s);
      if (f.kind === 'clover') {
        for (let k = 0; k < 3; k++) { ctx.rotate(TAU / 3); ctx.fillStyle = k ? '#5f9a3e' : '#6aa646'; ctx.beginPath(); ctx.ellipse(4, 0, 4.2, 3.4, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(220,240,200,0.35)'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.arc(4, 0, 2, 0, 3); ctx.stroke(); }
      } else {
        const petal = f.kind === 'daisy' ? '#f4f1e6' : '#f2c531';
        ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.arc(2, 3, 7, 0, TAU); ctx.fill();
        ctx.fillStyle = petal;
        for (let k = 0; k < 10; k++) { ctx.rotate(TAU / 10); ctx.beginPath(); ctx.ellipse(4.2, 0, 3.4, 1.2, 0, 0, TAU); ctx.fill(); }
        ctx.fillStyle = f.kind === 'daisy' ? '#e8b923' : '#d99a1c'; ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    // logs
    for (const l of S.logs) this.drawLog(ctx, l);
  }
  drawLog(ctx, l) {
    ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.rot);
    ctx.fillStyle = 'rgba(20,15,10,0.35)'; ctx.beginPath(); ctx.ellipse(8, 12, l.len / 2 + 6, l.r + 4, 0, 0, TAU); ctx.fill();
    const g = ctx.createLinearGradient(0, -l.r, 0, l.r);
    g.addColorStop(0, '#9a7650'); g.addColorStop(0.45, '#7a5a3a'); g.addColorStop(1, '#4a3420');
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(-l.len / 2, -l.r, l.len, l.r * 2, l.r); ctx.fill();
    ctx.strokeStyle = 'rgba(50,32,18,0.55)'; ctx.lineWidth = 1.4;
    const R = AL.rng(l.seed | 0);
    for (let k = 0; k < 16; k++) { const xx = -l.len / 2 + 20 + R() * (l.len - 40), yy = (R() - 0.5) * l.r * 1.4; ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + 20 + R() * 30, yy + (R() - 0.5) * 3); ctx.stroke(); }
    // cut end with rings
    ctx.fillStyle = '#c49a68'; ctx.beginPath(); ctx.ellipse(l.len / 2 - 4, 0, 10, l.r - 1, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(110,70,40,0.6)'; ctx.lineWidth = 0.8;
    for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.ellipse(l.len / 2 - 4, 0, 10 * k / 4, (l.r - 1) * k / 4, 0, 0, TAU); ctx.stroke(); }
    // moss
    ctx.fillStyle = 'rgba(110,150,60,0.55)';
    for (let k = 0; k < 10; k++) { ctx.beginPath(); ctx.ellipse(-l.len / 2 + 30 + R() * (l.len - 80), -l.r * 0.5 + R() * 6, 8 + R() * 10, 4 + R() * 3, 0, 0, TAU); ctx.fill(); }
    ctx.restore();
  }
  drawRocks(ctx, v) {
    const S = this.world.surface;
    for (const r of S.rocks) {
      if (r.x + r.rx + 20 < v.x0 || r.x - r.rx - 20 > v.x1 || r.y + r.ry + 20 < v.y0 || r.y - r.ry - 20 > v.y1) continue;
      ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(r.rot);
      ctx.fillStyle = 'rgba(15,20,10,0.32)'; ctx.beginPath(); ctx.ellipse(r.rx * 0.12 + 6, r.ry * 0.18 + 8, r.rx * 1.05, r.ry * 1.05, 0, 0, TAU); ctx.fill();
      const g = ctx.createRadialGradient(-r.rx * 0.35, -r.ry * 0.45, 2, 0, 0, Math.max(r.rx, r.ry) * 1.1);
      g.addColorStop(0, '#bdb7a8'); g.addColorStop(0.5, '#8f897c'); g.addColorStop(1, '#5d584e');
      ctx.fillStyle = g; ctx.beginPath();
      for (let i = 0; i <= 22; i++) { const a = i / 22 * TAU, w = 1 + (AL.hash2(i % 22, 3, r.seed | 0) - 0.5) * 0.16; ctx.lineTo(Math.cos(a) * r.rx * w, Math.sin(a) * r.ry * w); }
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(-r.rx * 0.1, -r.ry * 0.15, r.rx * 0.7, r.ry * 0.6, 0, 3.6, 5.2); ctx.stroke();
      ctx.fillStyle = 'rgba(120,150,70,0.4)'; ctx.beginPath(); ctx.ellipse(r.rx * 0.3, r.ry * 0.35, r.rx * 0.25, r.ry * 0.18, 0.4, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  drawFoods(ctx, v, z) {
    const S = this.world.surface;
    for (const f of S.foods) {
      if (f.gone || (f.spring && f.amount < 1)) continue;   // (an empty key point spring shows nothing)
      const m = (f.r || 8) + 40;
      if (f.x + m < v.x0 || f.x - m > v.x1 || f.y + m < v.y0 || f.y - m > v.y1) continue;
      const frac = f.max ? AL.clamp(f.amount / f.max, 0, 1) : 1;
      const custom = Art.foodDrawers[f.visual];
      if (custom) { ctx.save(); try { custom(ctx, f, frac, this); } catch (e) { console.error(e); } ctx.restore(); continue; }
      switch (f.visual) {
        case 'fruit': this.drawApple(ctx, f, frac); break;
        case 'beetle': this.drawBeetle(ctx, f, frac); break;
        case 'cookie': this.drawCookie(ctx, f, frac); break;
        case 'ham': this.drawHam(ctx, f, frac); break;
        case 'honeydew': this.drawAphidPlant(ctx, f, frac); break;
        case 'water': this.drawPuddle(ctx, f); break;
        case 'seeds': this.drawSeeds(ctx, f, frac); break;
        case 'leaves': this.drawClover(ctx, f, frac); break;
        case 'corpse': this.drawCorpse(ctx, f); break;
        case 'bug': this.drawBug(ctx, f); break;
        case 'grubs': this.drawGrubs(ctx, f, frac); break;
        case 'spider': if (this.drawSpiderBody) this.drawSpiderBody(ctx, f, true); break;
        default: this.drawCrumbs(ctx, f, frac);
      }
    }
  }
  shadow(ctx, x, y, rx, ry) { ctx.fillStyle = 'rgba(20,15,5,0.28)'; ctx.beginPath(); ctx.ellipse(x + rx * 0.18, y + ry * 0.28, rx, ry, 0, 0, TAU); ctx.fill(); }
  drawApple(ctx, f, frac) {
    const r = f.r * (0.55 + 0.45 * Math.sqrt(frac)), rot = f.rot;
    this.shadow(ctx, f.x, f.y, r * 1.05, r * 0.95);
    const base = Art.mix('#c8322a', '#6b4a22', rot), hi = Art.mix('#f07a5a', '#9a7a3a', rot);
    const g = ctx.createRadialGradient(f.x - r * 0.35, f.y - r * 0.4, r * 0.1, f.x, f.y, r * 1.05);
    g.addColorStop(0, hi); g.addColorStop(0.6, base); g.addColorStop(1, Art.shade(base, -0.4));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, TAU); ctx.fill();
    // bites taken out show how much is left
    if (frac < 0.95) { ctx.fillStyle = Art.mix('#f2e2b8', '#8a6a3a', rot); ctx.beginPath(); ctx.ellipse(f.x + r * 0.55, f.y + r * 0.2, r * 0.4 * (1 - frac) + 3, r * 0.5 * (1 - frac) + 3, 0.5, 0, TAU); ctx.fill(); }
    if (rot > 0.3) { ctx.fillStyle = 'rgba(60,40,15,' + (rot * 0.7) + ')'; for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.arc(f.x + Math.cos(k * 2.3) * r * 0.5, f.y + Math.sin(k * 2.3) * r * 0.5, r * 0.18 * rot + 1, 0, TAU); ctx.fill(); } }
    ctx.strokeStyle = '#4a3018'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(f.x - 2, f.y - r * 0.2); ctx.lineTo(f.x - 5, f.y - r * 0.7); ctx.stroke();
    ctx.fillStyle = '#5a9a3a'; ctx.beginPath(); ctx.ellipse(f.x - 10, f.y - r * 0.75, 7, 3.2, -0.5, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(f.x - r * 0.4, f.y - r * 0.45, r * 0.25, r * 0.13, -0.6, 0, TAU); ctx.fill();
  }
  drawBeetle(ctx, f, frac) {
    const r = f.r, a = f.heading != null ? f.heading + Math.PI : (f.a || 0);
    ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(a);
    ctx.fillStyle = 'rgba(15,10,5,0.32)'; ctx.beginPath(); ctx.ellipse(3, 4, r * 1.1, r * 0.8, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#1a1612'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    for (let k = -1; k <= 1; k++) for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(k * r * 0.35, s * r * 0.4); ctx.lineTo(k * r * 0.45 + 2, s * r * 0.95); ctx.lineTo(k * r * 0.6 + 4, s * r * 1.2); ctx.stroke(); }
    const g = ctx.createRadialGradient(-r * 0.2, -r * 0.3, 1, 0, 0, r);
    g.addColorStop(0, '#5a7a6a'); g.addColorStop(0.4, '#2a3a40'); g.addColorStop(1, '#101418');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(-r * 0.15, 0, r * 0.85 * (0.7 + 0.3 * frac), r * 0.62, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-r * 0.95, 0); ctx.lineTo(r * 0.5, 0); ctx.stroke();
    ctx.fillStyle = '#1d2226'; ctx.beginPath(); ctx.ellipse(r * 0.75, 0, r * 0.32, r * 0.36, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(160,220,200,0.35)'; ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.3, r * 0.4, r * 0.12, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  drawCookie(ctx, f, frac) {
    const R = AL.rng(f.id * 31 + 7), n = Math.ceil(26 * frac + 2);
    for (let k = 0; k < n; k++) {
      const a = R() * TAU, d = Math.sqrt(R()) * f.r, x = f.x + Math.cos(a) * d, y = f.y + Math.sin(a) * d, s = 2.5 + R() * 5;
      this.shadow(ctx, x, y, s, s * 0.7);
      ctx.fillStyle = ['#d8a868', '#c99456', '#e2b97c'][k % 3]; ctx.beginPath(); ctx.ellipse(x, y, s, s * 0.8, R() * 3, 0, TAU); ctx.fill();
      if (k % 4 === 0) { ctx.fillStyle = '#4a2a14'; ctx.beginPath(); ctx.arc(x + 1, y, s * 0.3, 0, TAU); ctx.fill(); }
    }
  }
  drawHam(ctx, f, frac) {
    const r = f.r * (0.5 + 0.5 * frac);
    this.shadow(ctx, f.x, f.y, r * 1.2, r * 0.8);
    ctx.fillStyle = '#e38a8a'; ctx.beginPath(); ctx.ellipse(f.x, f.y, r * 1.2, r * 0.8, 0.4, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#f6d2c8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(f.x, f.y, r * 1.05, r * 0.65, 0.4, 0.3, 2.2); ctx.stroke();
  }
  drawAphidPlant(ctx, f, frac) {
    const p = f.poi, R = AL.rng((p.seed * 1000) | 0);
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(15,30,10,0.3)'; ctx.beginPath(); ctx.ellipse(10, 14, p.r * 1.05, p.r * 0.95, 0, 0, TAU); ctx.fill();
    // leaves radiating from the stem
    for (let k = 0; k < 9; k++) {
      const a = k / 9 * TAU + R() * 0.3, L = p.r * (0.75 + R() * 0.3);
      ctx.save(); ctx.rotate(a);
      const g = ctx.createLinearGradient(0, -8, 0, 8); g.addColorStop(0, '#7cbf55'); g.addColorStop(1, '#3f7a2c');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(4, 0); ctx.quadraticCurveTo(L * 0.5, -L * 0.32, L, 0); ctx.quadraticCurveTo(L * 0.5, L * 0.32, 4, 0); ctx.fill();
      ctx.strokeStyle = 'rgba(220,255,200,0.35)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(L * 0.95, 0); ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = '#4a7a2e'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill();
    // aphids: little pale green pears clustered on the stems, honeydew glints
    const n = Math.round(p.aphids);
    for (let k = 0; k < n; k++) {
      const a = k * 2.39996, d = 8 + (k % 7) * 4.5;
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      ctx.fillStyle = '#c8e68a'; ctx.beginPath(); ctx.ellipse(x, y, 2.4, 1.7, a, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(60,90,20,0.6)'; ctx.beginPath(); ctx.arc(x + Math.cos(a) * 1.8, y + Math.sin(a) * 1.8, 0.7, 0, TAU); ctx.fill();
    }
    const drops = Math.round(frac * 10);
    for (let k = 0; k < drops; k++) {
      const a = k * 1.7 + 0.4, d = 12 + (k % 4) * 6, x = Math.cos(a) * d, y = Math.sin(a) * d;
      ctx.fillStyle = 'rgba(255,225,140,0.85)'; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(x - 0.6, y - 0.6, 0.6, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  drawPuddle(ctx, f) {
    const p = f.poi, r = p.r, t = this.frame * 0.02;
    if (!(r > 2) || !isFinite(r)) return;   // a dried-up pool (or a bad radius) draws nothing
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(70,55,35,0.45)'; ctx.beginPath();
    for (let i = 0; i <= 28; i++) { const a = i / 28 * TAU, w = 1.08 + (AL.hash2(i % 28, 9, (p.seed * 100) | 0) - 0.5) * 0.22; ctx.lineTo(Math.cos(a) * r * w, Math.sin(a) * r * 0.8 * w); }
    ctx.fill();
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 2, 0, 0, r);
    g.addColorStop(0, '#9fd0e6'); g.addColorStop(0.6, '#5f9fbf'); g.addColorStop(1, '#3e6f8a');
    ctx.fillStyle = g; ctx.beginPath();
    for (let i = 0; i <= 28; i++) { const a = i / 28 * TAU, w = 1 + (AL.hash2(i % 28, 9, (p.seed * 100) | 0) - 0.5) * 0.22; ctx.lineTo(Math.cos(a) * r * w, Math.sin(a) * r * 0.8 * w); }
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
    for (let k = 0; k < 2; k++) { const rr = ((t + k * 0.5) % 1) * r * 0.7; ctx.globalAlpha *= 1; ctx.beginPath(); ctx.ellipse(r * 0.15, r * 0.1, rr, rr * 0.75, 0, 0, TAU); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.ellipse(-r * 0.35, -r * 0.3, r * 0.3, r * 0.08, -0.4, 0, TAU); ctx.fill();
    ctx.restore();
  }
  drawSeeds(ctx, f, frac) {
    const R = AL.rng(f.id * 13 + 1), n = Math.ceil(20 * frac + 1);
    for (let k = 0; k < n; k++) {
      const a = R() * TAU, d = Math.sqrt(R()) * f.r, x = f.x + Math.cos(a) * d, y = f.y + Math.sin(a) * d, ang = R() * TAU;
      ctx.fillStyle = '#8a6a3a'; ctx.beginPath(); ctx.ellipse(x, y, 2.6, 1, ang, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(245,240,225,0.75)'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * 6, y + Math.sin(ang) * 6); ctx.stroke();
      ctx.fillStyle = 'rgba(250,250,240,0.5)'; ctx.beginPath(); ctx.arc(x + Math.cos(ang) * 6.5, y + Math.sin(ang) * 6.5, 2.4, 0, TAU); ctx.fill();
    }
  }
  drawClover(ctx, f, frac) {
    const R = AL.rng(f.id * 17 + 3), n = Math.ceil(16 * frac + 4);
    for (let k = 0; k < n; k++) {
      const a = R() * TAU, d = Math.sqrt(R()) * f.r, x = f.x + Math.cos(a) * d, y = f.y + Math.sin(a) * d;
      ctx.save(); ctx.translate(x, y); ctx.rotate(R() * TAU);
      for (let j = 0; j < 3; j++) { ctx.rotate(TAU / 3); ctx.fillStyle = j ? '#5c9b3c' : '#6eae4a'; ctx.beginPath(); ctx.ellipse(5, 0, 5, 4, 0, 0, TAU); ctx.fill(); }
      ctx.fillStyle = 'rgba(230,250,210,0.3)'; ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }
  drawCrumbs(ctx, f, frac) {
    const R = AL.rng(f.id * 7 + 5), n = Math.ceil(5 * frac + 1);
    for (let k = 0; k < n; k++) {
      const x = f.x + (R() - 0.5) * f.r * 1.6, y = f.y + (R() - 0.5) * f.r * 1.6, s = 1.6 + R() * 2;
      this.shadow(ctx, x, y, s, s * 0.7);
      ctx.fillStyle = f.kind === K.SUGAR ? ['#f4ead2', '#e9d8a6'][k & 1] : ['#c86a4a', '#a8543a'][k & 1];
      ctx.beginPath(); ctx.ellipse(x, y, s, s * 0.8, R() * 3, 0, TAU); ctx.fill();
    }
  }
  // a key point's protein spring: a heap of pale grubs, more of them the fuller it is
  drawGrubs(ctx, f, frac) {
    const n = Math.max(1, Math.round(2 + frac * 10)), seed = (f.id * 13) % 97;
    this.shadow(ctx, f.x, f.y, f.r * 0.9, f.r * 0.6);
    for (let k = 0; k < n; k++) {
      const a = AL.hash2(seed, k, 3) * TAU, d = Math.sqrt(AL.hash2(seed, k, 5)) * f.r * 0.75, x = f.x + Math.cos(a) * d, y = f.y + Math.sin(a) * d * 0.8, rot = AL.hash2(seed, k, 7) * TAU;
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
      ctx.fillStyle = '#efe2c2'; ctx.beginPath(); ctx.ellipse(0, 0, 3.4, 1.9, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(150,120,80,0.6)'; ctx.lineWidth = 0.4; for (let s = -2; s <= 2; s++) { ctx.beginPath(); ctx.moveTo(s * 1.1, -1.6); ctx.lineTo(s * 1.1, 1.6); ctx.stroke(); }
      ctx.fillStyle = '#8a5a2a'; ctx.beginPath(); ctx.arc(3, 0, 0.9, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }
  drawBug(ctx, f) {
    ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.a || 0);
    this.shadow(ctx, 0, 0, 5, 3);
    ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 0.6;
    for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(k * 2, -4); ctx.lineTo(k * 2.5, 4); ctx.stroke(); }
    ctx.fillStyle = '#6a5a3a'; ctx.beginPath(); ctx.ellipse(0, 0, 4.5, 2.6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(200,220,255,0.4)'; ctx.beginPath(); ctx.ellipse(-1, -1.5, 3.5, 1.4, 0.3, 0, TAU); ctx.fill();
    ctx.restore();
  }
  drawCorpse(ctx, f) {
    const at = this.atlas[f.col || 0].dead, n = Math.min(6, f.n || 1), R = AL.rng(f.id * 3 + 1);
    const s = 1 / at.scale;
    for (let k = 0; k < n; k++) {
      const x = f.x + (k ? (R() - 0.5) * 10 : 0), y = f.y + (k ? (R() - 0.5) * 10 : 0);
      ctx.save(); ctx.translate(x, y); ctx.rotate(R() * TAU); ctx.scale(s, s);
      ctx.drawImage(at.img, -at.cs / 2, -at.cs / 2); ctx.restore();
    }
  }

  // the mound: excavated soil piled around the entrance; cached per radius
  moundCanvas(c) {
    const key = c.id + ':' + Math.round(c.moundR);
    let m = this.moundCache.get(key);
    if (m) return m;
    const r = Math.round(c.moundR), res = 2, size = (r * 2 + 30) * res;
    const cv = Art.canvas(size, size), x = cv.getContext('2d');
    x.scale(res, res); x.translate(r + 15, r + 15);
    const R = AL.rng(c.id * 99 + r);
    // soft shadow
    let g = x.createRadialGradient(6, 8, r * 0.4, 6, 8, r * 1.15);
    g.addColorStop(0, 'rgba(20,12,5,0.45)'); g.addColorStop(1, 'rgba(20,12,5,0)');
    x.fillStyle = g; x.beginPath(); x.arc(6, 8, r * 1.15, 0, TAU); x.fill();
    // soil heap, lit from the upper left
    g = x.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#b48a5a'); g.addColorStop(0.55, '#8d6a42'); g.addColorStop(1, '#5e442a');
    x.fillStyle = g; x.beginPath();
    for (let i = 0; i <= 30; i++) { const a = i / 30 * TAU, w = 1 + (AL.hash2(i % 30, 5, c.id + 3) - 0.5) * 0.14; x.lineTo(Math.cos(a) * r * w, Math.sin(a) * r * w); }
    x.fill();
    // terraces of freshly dumped soil and small clods, lit from the upper left
    for (let k = 3; k >= 1; k--) {
      const rr = r * k / 3.6;
      const g2 = x.createRadialGradient(-rr * 0.3, -rr * 0.35, rr * 0.2, 0, 0, rr);
      g2.addColorStop(0, 'rgba(210,170,120,0.22)'); g2.addColorStop(1, 'rgba(90,60,35,0.18)');
      x.fillStyle = g2; x.beginPath();
      for (let i = 0; i <= 24; i++) { const a = i / 24 * TAU, w = 1 + (AL.hash2(i % 24, k, c.id + 7) - 0.5) * 0.2; x.lineTo(Math.cos(a) * rr * w, Math.sin(a) * rr * w); }
      x.fill();
    }
    for (let k = 0; k < r * 3.2; k++) {
      const a = R() * TAU, d = Math.sqrt(R()) * r * 0.95, gx = Math.cos(a) * d, gy = Math.sin(a) * d, s2 = 0.7 + R() * 1.4;
      const lit = (-gx - gy) / (r * 1.4);
      x.fillStyle = 'rgba(40,24,12,0.28)'; x.beginPath(); x.arc(gx + 0.5, gy + 0.7, s2, 0, TAU); x.fill();
      x.fillStyle = lit > 0 ? 'rgba(200,160,110,0.55)' : 'rgba(130,95,60,0.5)'; x.beginPath(); x.arc(gx, gy, s2, 0, TAU); x.fill();
    }
    // entrance crater
    const er = Math.min(10, 5 + r * 0.06);
    g = x.createRadialGradient(0, 0, 0, 0, 0, er * 2);
    g.addColorStop(0, 'rgba(30,18,8,0.9)'); g.addColorStop(0.5, 'rgba(70,45,22,0.6)'); g.addColorStop(1, 'rgba(90,60,30,0)');
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, er * 2, 0, TAU); x.fill();
    x.fillStyle = '#140b05'; x.beginPath(); x.ellipse(0, 0, er * 0.75, er * 0.6, 0.3, 0, TAU); x.fill();
    x.strokeStyle = 'rgba(230,200,150,0.35)'; x.lineWidth = 1; x.beginPath(); x.ellipse(0, 0, er * 0.9, er * 0.75, 0.3, 3.4, 5.4); x.stroke();
    m = { cv, size: size / res, off: r + 15 };
    if (this.moundCache.size > 40) this.moundCache.clear();
    this.moundCache.set(key, m);
    return m;
  }
  // army ants: the 'mound' is a living bivouac, a heap of clinging ants
  drawBivouac(ctx, c, z) {
    const at = this.atlas[c.id], sp = at.lo[AL.CASTE.WORKER], cs = sp.cs, n = Math.min(140, 30 + (c.pop[0] + c.pop[1]) * 0.5 | 0);
    const R = AL.rng(c.id * 13 + 5), r = 18 + Math.sqrt(n) * 3.2, k = 1 / sp.scale;
    ctx.fillStyle = 'rgba(20,10,4,0.35)'; ctx.beginPath(); ctx.ellipse(c.x + 4, c.y + 6, r * 1.05, r * 0.95, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(40,20,8,0.85)'; ctx.beginPath(); ctx.arc(c.x, c.y, r * 0.8, 0, TAU); ctx.fill();
    for (let j = 0; j < n; j++) {
      const a = R() * TAU, d = Math.sqrt(R()) * r, x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d;
      const ang = R() * TAU + Math.sin(this.frame * 0.05 + j) * 0.2, rot = ((ang / TAU * Art.ROT) | 0) % Art.ROT, fr = (j + (this.frame >> 3)) & 3;
      ctx.drawImage(sp.img, rot * cs, fr * cs, cs, cs, x - cs * k / 2, y - cs * k / 2, cs * k, cs * k);
    }
  }
  drawMound(ctx, c, z) {
    if (this.world.fog && c.id !== AL.me() && !this.world.fog.seenAt(c.x, c.y)) return;
    if (c.sp.nomad) { this.drawBivouac(ctx, c, z); return; }
    const m = this.moundCanvas(c);
    ctx.drawImage(m.cv, c.x - m.off, c.y - m.off, m.size, m.size);
    // a fallen colony's mound goes quiet and grey
    if (!c.alive) { ctx.fillStyle = 'rgba(60,60,60,0.45)'; ctx.beginPath(); ctx.arc(c.x, c.y, c.moundR, 0, TAU); ctx.fill(); }
    // siege: attackers vs defenders inside, and the queen's health
    if (c.sieging && c.siegeLog && c.alive) {
      const w = 90, x = c.x - w / 2, y = c.y - c.moundR - 30, a = c.siegeLog.att, d = c.siegeLog.def, tot = Math.max(1, a + d);
      ctx.fillStyle = 'rgba(20,12,6,0.75)'; ctx.fillRect(x - 3, y - 3, w + 6, 20);
      ctx.fillStyle = '#d9473a'; ctx.fillRect(x, y, w * d / tot, 6);
      ctx.fillStyle = '#e8b04a'; ctx.fillRect(x + w * d / tot, y, w * a / tot, 6);
      ctx.fillStyle = '#5a1a12'; ctx.fillRect(x, y + 9, w, 5);
      ctx.fillStyle = '#ff6a4a'; ctx.fillRect(x, y + 9, w * c.queen.hp / c.queen.maxHp, 5);
      ctx.font = '600 9px system-ui'; ctx.fillStyle = '#f4ead6'; ctx.textAlign = 'center';
      ctx.fillText('Siege: ' + Math.round(a) + ' of yours vs ' + Math.round(d) + ' defenders', c.x, y - 6);
    }
  }
  // alarm hotspots and recruit paths of the player's colony
  drawOrders(ctx, view) {
    const col = this.world.player, t = this.frame * 0.05;
    for (const h of col.hotspots || []) {
      if (!h.player) continue;
      const age = (this.world.t - h.t) / h.life; if (age > 1) continue;
      ctx.strokeStyle = 'rgba(255,90,60,' + (0.8 * (1 - age)) + ')'; ctx.lineWidth = 2.2;
      for (let k = 0; k < 2; k++) { const r = 18 + ((t + k * 0.5) % 1) * 40; ctx.globalAlpha = 1 - ((t + k * 0.5) % 1); ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, TAU); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    for (const o of col.orders || []) {
      if (o.done || o.cancelled) continue;
      ctx.strokeStyle = 'rgba(95,211,230,0.55)'; ctx.lineWidth = 1.6; ctx.setLineDash([6, 6]); ctx.lineDashOffset = -this.frame * 0.4;
      ctx.beginPath(); o.pts.forEach((p, k) => k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); ctx.setLineDash([]);
      const e = o.pts[o.pts.length - 1];
      ctx.fillStyle = 'rgba(95,211,230,0.85)'; ctx.beginPath(); ctx.arc(e.x, e.y, 5, 0, TAU); ctx.fill();
      ctx.font = '600 10px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#dff8fc';
      ctx.fillText(o.arrived + ' / ' + o.want, e.x, e.y - 10);
    }
  }
  // fog of war: a small alpha image upscaled smoothly, then scent wisps at the edge of sight
  drawFog(ctx, view) {
    const fog = this.world.fog;
    if (!this.fogCv || this.fogCv.width !== fog.w || this.fogCv.height !== fog.h) { this.fogBig = null; this.fogCv = Art.canvas(fog.w, fog.h); this.fogCtx = this.fogCv.getContext('2d'); this.fogImg = this.fogCtx.createImageData(fog.w, fog.h); this.fogVer = -1; }
    if (this.fogVer !== fog.version) {
      const d = this.fogImg.data;
      for (let i = 0; i < fog.n; i++) {
        const a = fog.vis[i] ? 0 : fog.seen[i] ? 120 : 236;
        d[i * 4] = 16; d[i * 4 + 1] = 20; d[i * 4 + 2] = 14; d[i * 4 + 3] = a;
      }
      this.fogCtx.putImageData(this.fogImg, 0, 0); this.fogVer = fog.version;
      // soften the cell edges once per update: blur into a 4x canvas
      if (!this.fogBig) { this.fogBig = Art.canvas(fog.w * 4, fog.h * 4); this.fogBigCtx = this.fogBig.getContext('2d'); }
      const b = this.fogBigCtx; b.clearRect(0, 0, this.fogBig.width, this.fogBig.height);
      b.filter = 'blur(5px)'; b.imageSmoothingEnabled = true; b.drawImage(this.fogCv, 0, 0, this.fogBig.width, this.fogBig.height); b.filter = 'none';
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fogBig, 0, 0, fog.w * fog.cell, fog.h * fog.cell);
    // scent: warm wisps drifting where enemies are smelled but not seen
    const cs = fog.cell, t = this.frame * 0.02;
    const x0 = Math.max(0, (view.x0 / cs) | 0), x1 = Math.min(fog.w - 1, (view.x1 / cs) | 0), y0 = Math.max(0, (view.y0 / cs) | 0), y1 = Math.min(fog.h - 1, (view.y1 / cs) | 0);
    ctx.globalCompositeOperation = 'lighter';
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const v = fog.scent[y * fog.w + x]; if (v < 0.06) continue;
      const ph = AL.hash2(x, y, 3) * 6.28, px = (x + 0.5) * cs + Math.sin(t + ph) * 8, py = (y + 0.5) * cs + Math.cos(t * 0.8 + ph) * 8;
      ctx.globalAlpha = Math.min(0.55, v * 0.6) * (0.75 + 0.25 * Math.sin(t * 3 + ph));
      ctx.drawImage(this.puff, px - 26, py - 26, 52, 52);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  // ---- ants: three paths depending on zoom ------------------------------------------------
  drawAnts(ctx, cam, alpha, v, z, ox, oy) {
    const world = this.world, A = world.ants, n = A.high;
    const X = A.x, Y = A.y, PX = A.px, PY = A.py, ANG = A.a, ST = A.state, LY = A.layer, COL = A.col, CA = A.caste, AN = A.anim, CR = A.carry;
    const fog = world.fog, HOST = A.host, CAPT = AL.CASTE.CAPTIVE, ME = world.me || 0, HP = A.hp, MHP = A.maxhp, CS = AL.CASTES, LG = A.legs, HL = A.headless;
    const x0 = v.x0 - 12, x1 = v.x1 + 12, y0 = v.y0 - 12, y1 = v.y1 + 12;
    let drawn = 0;
    const ROT = Art.ROT, rotK = ROT / TAU;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.barBegin(z < 0.8);   // health bars of hurt ants (render-bars.js), drawn later by drawBars
    if (z < 0.8) {
      // dots: fastest path for the whole-yard view
      const s = Math.max(1.5, 2.6 * z);
      for (let c = 0; c < world.colonies.length; c++) {
        ctx.fillStyle = c === ME ? '#2a140a' : '#d8301e';
        for (let i = 0; i < n; i++) {
          if (!ST[i] || LY[i] !== 0 || COL[i] !== c) continue;
          const x = PX[i] + (X[i] - PX[i]) * alpha, y = PY[i] + (Y[i] - PY[i]) * alpha;
          if (x < x0 || x > x1 || y < y0 || y > y1) continue;
          if (c !== ME && fog && !fog.visibleAt(x, y)) continue;
          ctx.fillRect(x * z + ox - s / 2, y * z + oy - s / 2, s * (CA[i] === 4 ? 1.6 : 1), s);
          if (c === ME && HP[i] < MHP[i]) this.barAnt(i, x * z + ox, y * z + oy, s);   // far out: only your own ants
          drawn++;
        }
      }
    } else if (z <= Art.LO * 1.15) {
      // pre-rotated low-res sprites with baked shadows: one drawImage per ant, no transforms
      for (let i = 0; i < n; i++) {
        if (!ST[i] || LY[i] !== 0) continue;
        const x = PX[i] + (X[i] - PX[i]) * alpha, y = PY[i] + (Y[i] - PY[i]) * alpha;
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        const c = COL[i];
        if (c !== ME && fog && !fog.visibleAt(x, y)) continue;
        const sp = this.atlas[CA[i] === CAPT && HOST ? HOST[i] : c].lo[CA[i]], cs = sp.cs;   // captives wear their host colony's colours (species.js)
        let a = ANG[i]; if (a < 0) a += TAU;
        const r = ((a * rotK + 0.5) | 0) % ROT, f = (AN[i] | 0) & 3;
        const dw = cs * (z / sp.scale) * A.size[i];
        ctx.drawImage(sp.img, r * cs, f * cs, cs, cs, x * z + ox - dw / 2, y * z + oy - dw / 2, dw, dw);
        if (CR[i]) this.drawCarried(ctx, CR[i], x * z + ox + Math.cos(ANG[i]) * 6.5 * z * AL.CASTES[CA[i]].size, y * z + oy + Math.sin(ANG[i]) * 6.5 * z * AL.CASTES[CA[i]].size, z);
        if (HP[i] < MHP[i]) this.barAnt(i, x * z + ox, y * z + oy, 6.5 * z * A.size[i] * CS[CA[i]].size);
        drawn++;
      }
    } else {
      // close up: high-res sprites rotated with a transform, plus a soft separate shadow
      for (let i = 0; i < n; i++) {
        if (!ST[i] || LY[i] !== 0) continue;
        const x = PX[i] + (X[i] - PX[i]) * alpha, y = PY[i] + (Y[i] - PY[i]) * alpha;
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        const c = COL[i];
        if (c !== ME && fog && !fog.visibleAt(x, y)) continue;
        this.drawAntHi(ctx, CA[i] === CAPT && HOST ? HOST[i] : c, CA[i], (AN[i] | 0) & 3, x * z + ox, y * z + oy, ANG[i], z * A.size[i], CR[i], LG[i] !== 63 || HL[i] ? LG[i] | HL[i] << 6 : 0);
        if (HP[i] < MHP[i]) this.barAnt(i, x * z + ox, y * z + oy, 6.5 * z * A.size[i] * CS[CA[i]].size);
        drawn++;
      }
    }
    this.stats.drawn = drawn;
  }
  // health bars: render-bars.js replaces these
  barBegin() {}
  barAnt() {}
  // inj: 0 for a whole ant, else legs left | headless << 6 (injury.js): drawn from a maimed sprite (art.js hurtSprite)
  drawAntHi(ctx, c, caste, f, sx, sy, a, z, carry, inj) {
    const at = this.atlas[c], hv = inj ? Art.hurtSprite(at, caste, inj & 63, inj >> 6) : null;
    const sp = hv || at.hi[caste], sh = hv ? hv.shadow : at.shadow[caste], k = z / sp.scale, cs = sp.cs;
    const co = Math.cos(a) * k, si = Math.sin(a) * k;
    ctx.setTransform(co, si, -si, co, sx + 1.6 * z, sy + 2.2 * z);
    ctx.drawImage(sh.img, -sh.cs / 2, -sh.cs / 2);
    ctx.setTransform(co, si, -si, co, sx, sy);
    ctx.drawImage(sp.img, f * cs, 0, cs, cs, -cs / 2, -cs / 2, cs, cs);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (carry) { const d = 6.5 * z * AL.CASTES[caste].size; this.drawCarried(ctx, carry, sx + Math.cos(a) * d, sy + Math.sin(a) * d, z); }
  }
  // the crumb an ant holds in its mandibles
  drawCarried(ctx, kind, x, y, z) {
    const r = Math.max(1.2, 1.7 * z);
    if (kind === K.BROOD) { ctx.fillStyle = '#f3ead2'; ctx.beginPath(); ctx.ellipse(x, y, r * 1.5, r * 0.95, 0.5, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(120,95,60,0.6)'; ctx.lineWidth = Math.max(0.5, z * 0.15); ctx.stroke(); return; }   // a stolen pupa
    ctx.fillStyle = kind === K.SUGAR ? '#f6e7b4' : kind === K.PROTEIN ? '#d0674a' : kind === K.WATER ? '#8fd0f0' : kind === K.SEED ? '#a07a42' : kind === K.LEAF ? '#6fbf4a' : kind === K.SOIL ? '#7a5534' : '#888';
    if (kind === K.LEAF) { ctx.beginPath(); ctx.ellipse(x, y - r, r * 2.4, r * 1.6, 0.6, 0, TAU); ctx.fill(); return; }
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }

  // ---- particles ----
  spawnFx(world) {
    const q = world.fxq.a;
    for (let k = 0; k < q.length; k += 4) {
      const t = q[k], x = q[k + 1], y = q[k + 2], e = q[k + 3];
      if (this.particles.length > 1500) break;
      const n = t === 1 ? 5 : 3;
      for (let j = 0; j < n; j++) {
        const a = Math.random() * TAU, s = 8 + Math.random() * 22;
        this.particles.push({ t, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (t === 1 ? 10 : 0), life: 0.5 + Math.random() * 0.5, age: 0, e, layer: t >= 10 ? 1 : 0 });
      }
    }
    q.length = 0;
  }
  drawParticles(ctx, z, layer) {
    layer = layer || 0;
    const ps = this.particles, dt = 1 / 60;
    for (let k = ps.length - 1; k >= 0; k--) {
      const p = ps[k];
      if (p.layer !== layer) continue;
      p.age += dt; if (p.age > p.life) { ps[k] = ps[ps.length - 1]; ps.pop(); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy = p.vy * 0.92 + (layer ? 60 * dt : 0);
      const a = 1 - p.age / p.life;
      ctx.globalAlpha = a;
      if (p.t === 3) { ctx.fillStyle = '#ffd36a'; ctx.beginPath(); ctx.arc(p.x, p.y, 1.2 + a, 0, TAU); ctx.fill(); }
      else if (p.t === 4) { ctx.fillStyle = '#ff5a3a'; ctx.fillRect(p.x - 0.8, p.y - 0.8, 1.6, 1.6); }
      else { ctx.fillStyle = p.e === K.SUGAR ? '#f6e7b4' : p.e === K.PROTEIN ? '#d0674a' : p.e === K.WATER ? '#a6dcf2' : '#8a6038'; ctx.fillRect(p.x - 0.7, p.y - 0.7, 1.4, 1.4); }
    }
    ctx.globalAlpha = 1;
  }
}

// nectar: a bead of gold in the flower's heart, bigger when full
Art.foodDrawers.nectar = function (ctx, f, frac) {
  if (frac < 0.2 || (f.flower && f.flower.cut)) return;
  const r = 0.8 + 1.5 * frac;
  ctx.fillStyle = 'rgba(255,214,90,' + (0.45 + 0.4 * frac) + ')'; ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,250,220,0.8)'; ctx.beginPath(); ctx.arc(f.x - r * 0.35, f.y - r * 0.35, r * 0.35, 0, TAU); ctx.fill();
};

AL.Renderer = Renderer;
})(window);
