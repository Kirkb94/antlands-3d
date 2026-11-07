// Antlands art: everything is drawn with Canvas paths at load time (no raster files).
// - ant sprite atlases: pre-rotated low-res cells (fast batched drawing when zoomed out)
//   plus unrotated high-res cells (drawn with a transform when zoomed in)
// - the painted backyard ground, with crisp detail chunks cached for close zoom
(function (root) {
'use strict';
const AL = root.AL;
const TAU = Math.PI * 2;

const ROT = 24;          // rotations in the low-res atlas
const FRAMES = 4;        // walk-cycle frames
const LO = 2.4;          // px per world unit in the low-res atlas
const HI = 7;            // px per world unit in the high-res atlas
const BASE_LEN = 11;     // worker body length in world units

function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
function shade(hex, f) {
  // f < 0 darkens, f > 0 lightens
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; } else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
}
function mix(a, b, t) {
  const na = parseInt(a.slice(1), 16), nb = parseInt(b.slice(1), 16);
  const r = ((na >> 16) * (1 - t) + (nb >> 16) * t) | 0, g = (((na >> 8) & 255) * (1 - t) + ((nb >> 8) & 255) * t) | 0, bl = ((na & 255) * (1 - t) + (nb & 255) * t) | 0;
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}

// ---- the ant itself (drawn facing +x, centred on the thorax-petiole joint, in world units) ----
// shape params per caste
const SHAPES = [
  /* worker   */ { head: 1.0,  mand: 1.0, gaster: 1.0, thorax: 1.0, leg: 1.0,  ant: 1.0 },
  /* forager  */ { head: 0.95, mand: 0.9, gaster: 0.92, thorax: 0.95, leg: 1.25, ant: 1.15 },
  /* scout    */ { head: 0.9,  mand: 0.8, gaster: 0.85, thorax: 0.9, leg: 1.2,  ant: 1.4 },
  /* soldier  */ { head: 1.55, mand: 1.8, gaster: 1.0, thorax: 1.05, leg: 1.0,  ant: 0.95 },
  /* major    */ { head: 1.9,  mand: 2.2, gaster: 1.05, thorax: 1.15, leg: 0.95, ant: 0.9 },
  /* nurse    */ { head: 0.95, mand: 0.8, gaster: 1.0, thorax: 0.9, leg: 0.9,  ant: 1.0, pale: 0.18 },
  /* honeypot */ { head: 0.9,  mand: 0.8, gaster: 2.6, thorax: 0.9, leg: 0.85, ant: 0.9, honey: true },
  /* queen    */ { head: 1.15, mand: 1.0, gaster: 1.9, thorax: 1.5, leg: 0.95, ant: 1.0, queen: true },
  /* winged   */ { head: 1.0,  mand: 0.9, gaster: 1.2, thorax: 1.3, leg: 0.95, ant: 1.1, wings: true },
  /* captive  */ { head: 1.0,  mand: 1.0, gaster: 1.0, thorax: 1.0, leg: 1.0,  ant: 1.0, mark: true },
];
// species looks (pal.look, set from AL.SPECIES[k].look by species.js): small shape tweaks drawn over the caste shape
const LOOKS = {
  honeypot:   { gaster: 1.12, leg: 1.12, amber: true },                    // long-legged desert ant, translucent amber gaster
  harvester:  { head: 1.18, mand: 1.1, beard: true },                      // square big head with a psammophore (beard)
  slavemaker: { head: 0.95, mand: 1.15, sickle: true, gloss: true },       // shiny, sickle-shaped jaws
  bullet:     { head: 1.1, mand: 1.25, gaster: 1.1, thorax: 1.12, leg: 1.05, sting: true, hairy: true },
};

function drawAnt(ctx, caste, pal, frame, opts) {
  opts = opts || {};
  const lk = LOOKS[pal.look], base = SHAPES[caste] || SHAPES[0];
  const sh = lk && caste !== 7 ? Object.assign({}, base, { head: base.head * (lk.head || 1), mand: base.mand * (lk.mand || 1), gaster: base.gaster * (base.honey ? 1 : (lk.gaster || 1)), thorax: base.thorax * (lk.thorax || 1), leg: base.leg * (lk.leg || 1) }) : base;
  const legC = shade(pal.body, -0.35), outline = shade(pal.gaster, -0.55);
  const swing = [0, 1, 0, -1][frame & 3];
  const L = BASE_LEN;
  // body part centres along x (head at +x)
  const thx = 0.6, thR = 1.35 * sh.thorax, thL = 2.3 * sh.thorax;
  const hx = thx + thL * 0.5 + 1.25 * sh.head, hR = 1.35 * sh.head;
  const gx = -1.2 - 2.3 * sh.gaster, gR = 2.0 * sh.gaster, gL = 2.6 * sh.gaster;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // legs: three pairs off the thorax, tripod gait (L1,R2,L3 swing together)
  ctx.strokeStyle = legC; ctx.lineWidth = 0.5;
  const legBase = [0.95, 1.65, 2.35], legX = [thx + 0.8, thx, thx - 0.8];
  // opts.legs: bitmask of legs left (bits 0-2 left front/mid/hind, 3-5 right; injury.js); a lost leg is a stump
  const legs = opts.legs == null ? 63 : opts.legs;
  for (let k = 0; k < 3; k++) for (const side of [-1, 1]) {
    const tri = (k === 1) === (side === 1) ? 1 : -1;
    const ang = (legBase[k] + (opts.dead ? 0.9 : swing * 0.3 * tri)) * side;
    const len = (k === 2 ? 4.2 : 3.6) * sh.leg * (opts.dead ? 0.55 : 1);
    const bx = legX[k], by = side * thR * 0.6;
    if (!(legs >> ((side < 0 ? 0 : 3) + k) & 1)) {
      ctx.strokeStyle = outline; ctx.lineWidth = 0.65;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(ang - side * 0.35) * len * 0.22, by + Math.sin(ang - side * 0.35) * len * 0.22); ctx.stroke();
      ctx.strokeStyle = legC; ctx.lineWidth = 0.5;
      continue;
    }
    const kx = bx + Math.cos(ang - side * 0.35) * len * 0.45, ky = by + Math.sin(ang - side * 0.35) * len * 0.45;
    const fx = kx + Math.cos(ang + side * 0.25) * len * 0.62, fy = ky + Math.sin(ang + side * 0.25) * len * 0.62;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
  }
  // wings (winged reproductives) under the body highlights
  if (sh.wings) {
    ctx.fillStyle = 'rgba(230,240,255,0.42)'; ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 0.18;
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(thx - 3.6, side * 1.9, 4.4, 1.5, side * 0.22, 0, TAU); ctx.fill(); ctx.stroke(); }
  }
  // gaster
  const gasterCol = sh.honey ? '#e9a93a' : lk && lk.amber ? mix(pal.gaster, '#e0a040', 0.35) : pal.gaster;
  // bullet ants: a stinger at the tip of the gaster
  if (lk && lk.sting) { ctx.strokeStyle = shade(pal.gaster, -0.5); ctx.lineWidth = 0.35; ctx.beginPath(); ctx.moveTo(gx - gL * 0.95, 0); ctx.lineTo(gx - gL - 1.1, 0); ctx.stroke(); }
  let g = ctx.createRadialGradient(gx + gL * 0.25, -gR * 0.35, gR * 0.15, gx, 0, gL * 1.1);
  g.addColorStop(0, shade(gasterCol, sh.honey ? 0.55 : 0.35)); g.addColorStop(0.55, gasterCol); g.addColorStop(1, shade(gasterCol, -0.4));
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(gx, 0, gL, gR, 0, 0, TAU); ctx.fill();
  if (sh.honey) { ctx.strokeStyle = 'rgba(120,60,10,0.55)'; ctx.lineWidth = 0.25; for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.ellipse(gx + k * gL * 0.45, 0, 0.5, gR * 0.92, 0, 0, TAU); ctx.stroke(); } }
  else { ctx.strokeStyle = shade(gasterCol, -0.35); ctx.lineWidth = 0.22; for (let k = 0; k < 2; k++) { ctx.beginPath(); ctx.ellipse(gx + gL * (0.15 - k * 0.42), 0, 0.35, gR * (0.92 - k * 0.12), 0, -1.3, 1.3); ctx.stroke(); } }
  // petiole node
  ctx.fillStyle = shade(pal.body, -0.15); ctx.beginPath(); ctx.ellipse(-0.75, 0, 0.6, 0.55, 0, 0, TAU); ctx.fill();
  // thorax
  g = ctx.createLinearGradient(0, -thR, 0, thR);
  g.addColorStop(0, shade(pal.body, 0.3)); g.addColorStop(0.5, pal.body); g.addColorStop(1, shade(pal.body, -0.3));
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(thx, 0, thL * 0.5 + 0.2, thR * 0.72, 0, 0, TAU); ctx.fill();
  if (sh.queen) { ctx.fillStyle = shade(pal.body, -0.3); for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(thx - 0.6, s * thR * 0.6, 0.5, 0.3, 0, 0, TAU); ctx.fill(); } }
  // decapitated (injury.js): a dark, torn neck where the head was, and no head parts below
  const nohead = !!opts.headless;
  if (nohead) {
    ctx.fillStyle = shade(pal.body, -0.6); ctx.beginPath(); ctx.ellipse(thx + thL * 0.5 + 0.1, 0, 0.55, thR * 0.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(190,200,120,0.55)'; ctx.beginPath(); ctx.ellipse(thx + thL * 0.5 + 0.25, 0, 0.25, thR * 0.28, 0, 0, TAU); ctx.fill();   // a little haemolymph
  } else {
    // head
    g = ctx.createRadialGradient(hx + hR * 0.2, -hR * 0.35, hR * 0.1, hx, 0, hR * 1.2);
    g.addColorStop(0, shade(pal.head, 0.35)); g.addColorStop(0.6, pal.head); g.addColorStop(1, shade(pal.head, -0.4));
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(hx, 0, hR * 1.05, hR * 0.95, 0, 0, TAU); ctx.fill();
    // mandibles
    ctx.strokeStyle = outline; ctx.lineWidth = 0.32 * Math.max(1, sh.mand * 0.75);
    const mL = 1.1 * sh.mand;
    if (lk && lk.sickle) {
      // Polyergus: thin, strongly curved sickle jaws that pierce defenders' heads
      ctx.lineWidth = 0.28;
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(hx + hR * 0.8, s * hR * 0.4); ctx.quadraticCurveTo(hx + hR + mL * 1.15, s * hR * 0.95, hx + hR + mL * 0.55, s * 0.12); ctx.stroke(); }
    } else for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(hx + hR * 0.85, s * hR * 0.35); ctx.quadraticCurveTo(hx + hR + mL, s * hR * 0.45, hx + hR + mL * 0.8, -s * 0.05); ctx.stroke(); }
    // harvester ants: the psammophore, a beard of long hairs under the head for carrying sand and seed
    if (lk && lk.beard) { ctx.strokeStyle = 'rgba(235,215,170,0.75)'; ctx.lineWidth = 0.14; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(hx + hR * 0.3 + k * 0.18, k * hR * 0.18); ctx.lineTo(hx + hR * 0.15 + k * 0.18, k * hR * 0.18 + (k < 0 ? -0.7 : 0.7)); ctx.stroke(); } }
  }
  // bullet ants: coarse golden hairs on thorax and gaster
  if (lk && lk.hairy) { ctx.strokeStyle = 'rgba(200,160,90,0.5)'; ctx.lineWidth = 0.12; for (let k = 0; k < 7; k++) { const x = gx + gL * (0.7 - k * 0.22), y = (k & 1 ? 1 : -1) * gR * 0.8; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 0.3, y * 1.22); ctx.stroke(); } }
  if (!nohead) {
    // eyes
    ctx.fillStyle = 'rgba(10,6,4,0.85)';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(hx + hR * 0.2, s * hR * 0.72, 0.32, 0.22, 0, 0, TAU); ctx.fill(); }
    // antennae (elbowed), sway a touch with the gait
    ctx.strokeStyle = legC; ctx.lineWidth = 0.32;
    const aL = 2.4 * sh.ant;
    for (const s of [-1, 1]) {
      const bx = hx + hR * 0.7, by = s * hR * 0.45, sw = opts.dead ? 0.6 : swing * 0.08 * s;
      const ex = bx + Math.cos(s * 0.55 + sw) * aL * 0.55, ey = by + Math.sin(s * 0.55 + sw) * aL * 0.55;
      const tx = ex + Math.cos(s * -0.25 + sw) * aL * 0.7, ty = ey + Math.sin(s * -0.25 + sw) * aL * 0.7;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.lineTo(tx, ty); ctx.stroke();
    }
  }
  // specular glints sell the painted, glossy look
  ctx.fillStyle = 'rgba(255,240,220,0.5)';
  ctx.beginPath(); ctx.ellipse(gx + gL * 0.3, -gR * 0.45, gL * 0.28, gR * 0.16, -0.2, 0, TAU); ctx.fill();
  if (!nohead) { ctx.beginPath(); ctx.ellipse(hx + hR * 0.15, -hR * 0.42, hR * 0.32, hR * 0.14, 0, 0, TAU); ctx.fill(); }
  if (lk && lk.gloss) { ctx.fillStyle = 'rgba(255,250,240,0.35)'; ctx.beginPath(); ctx.ellipse(thx + 0.2, -thR * 0.35, thL * 0.3, thR * 0.16, 0, 0, TAU); ctx.fill(); }
  // captives: a pale scent mark on the thorax (the slave-makers' colony odour)
  if (sh.mark) { ctx.fillStyle = 'rgba(255,238,190,0.85)'; ctx.beginPath(); ctx.ellipse(thx, 0, 0.75, 0.6, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(90,60,30,0.6)'; ctx.lineWidth = 0.12; ctx.stroke(); }
  if (sh.pale) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = 'rgba(255,235,200,' + sh.pale + ')'; ctx.fillRect(-20, -20, 40, 40); ctx.globalCompositeOperation = 'source-over'; }
}
// half extents of an ant (world units) for cell sizing
function antExtent(caste) {
  const sh = SHAPES[caste] || SHAPES[0];
  const front = 0.6 + 1.15 * sh.thorax + 2.5 * sh.head + 1.4 * sh.mand + 1.6 * sh.ant;
  const back = 1.2 + 4.9 * sh.gaster;
  const side = Math.max(4.6 * sh.leg, 2.1 * sh.gaster, 1.6 * sh.ant + 1.5 * sh.head) + 0.6;
  return Math.max(front, back, side) + 0.8;
}

// ---- atlases --------------------------------------------------------------------------
function buildAtlas(pal, scaleOf) {
  // scaleOf(caste) -> overall size multiplier (caste size * species size)
  const atlas = { lo: [], hi: [], shadow: [], ext: [] };
  const tmp = canvas(256, 256), tc = tmp.getContext('2d');
  for (let caste = 0; caste < AL.NCASTE; caste++) {
    const s = scaleOf(caste), ext = antExtent(caste) * s * (LOOKS[pal.look] ? 1.12 : 1);   // species looks reach a little further
    atlas.ext[caste] = ext;
    // high-res, unrotated: one row of FRAMES cells
    const hcs = Math.ceil(ext * 2 * HI);
    const hi = canvas(hcs * FRAMES, hcs), hc = hi.getContext('2d');
    for (let f = 0; f < FRAMES; f++) {
      hc.setTransform(HI * s, 0, 0, HI * s, f * hcs + hcs / 2, hcs / 2);
      drawAnt(hc, caste, pal, f);
    }
    hc.setTransform(1, 0, 0, 1, 0, 0);
    atlas.hi[caste] = { img: hi, cs: hcs, scale: HI };
    // blurred shadow (from frame 0) for the high-res path
    const shc = canvas(hcs + 16, hcs + 16), sc = shc.getContext('2d');
    sc.filter = 'blur(' + (HI * 0.45).toFixed(1) + 'px) brightness(0)'; sc.globalAlpha = 0.38;
    sc.drawImage(hi, 0, 0, hcs, hcs, 8, 8, hcs, hcs);
    atlas.shadow[caste] = { img: shc, cs: hcs + 16 };
    // low-res, pre-rotated with a baked sun shadow (sun from the upper left)
    const lcs = Math.ceil(ext * 2 * LO) + 4;
    const lo = canvas(lcs * ROT, lcs * FRAMES), lc = lo.getContext('2d');
    if (tmp.width < lcs) { tmp.width = tmp.height = lcs; }
    for (let f = 0; f < FRAMES; f++) for (let r = 0; r < ROT; r++) {
      const ang = (r / ROT) * TAU;
      tc.setTransform(1, 0, 0, 1, 0, 0); tc.clearRect(0, 0, tmp.width, tmp.height);
      tc.setTransform(LO * s * Math.cos(ang), LO * s * Math.sin(ang), -LO * s * Math.sin(ang), LO * s * Math.cos(ang), lcs / 2, lcs / 2);
      drawAnt(tc, caste, pal, f);
      const ox = r * lcs, oy = f * lcs;
      lc.save(); lc.filter = 'blur(0.8px) brightness(0)'; lc.globalAlpha = 0.34;
      lc.drawImage(tmp, 0, 0, lcs, lcs, ox + 1.4, oy + 1.9, lcs, lcs); lc.restore();
      lc.drawImage(tmp, 0, 0, lcs, lcs, ox, oy, lcs, lcs);
    }
    atlas.lo[caste] = { img: lo, cs: lcs, scale: LO };
  }
  // dead ant (curled legs, dull) for corpses
  const dcs = Math.ceil(antExtent(0) * 2 * HI * 0.8);
  const dead = canvas(dcs, dcs), dc = dead.getContext('2d');
  dc.setTransform(HI * 0.8, 0, 0, HI * 0.8, dcs / 2, dcs / 2); dc.globalAlpha = 0.85;
  drawAnt(dc, 0, { body: mix(pal.body, '#555044', 0.45), head: mix(pal.head, '#555044', 0.45), gaster: mix(pal.gaster, '#3a3630', 0.4) }, 0, { dead: true });
  atlas.dead = { img: dead, cs: dcs, scale: HI * 0.8 };
  atlas.pal = pal; atlas.scaleOf = scaleOf; atlas.inj = new Map();
  return atlas;
}
// a maimed ant's high-res cells (lost legs, no head: injury.js), built the first time one is drawn and kept:
// { img, cs, scale } plus its own shadow, like atlas.hi[caste] / atlas.shadow[caste]
function hurtSprite(atlas, caste, legs, headless) {
  const key = caste * 128 + legs * 2 + (headless ? 1 : 0);
  let v = atlas.inj.get(key);
  if (v) return v;
  const base = atlas.hi[caste], hcs = base.cs, s = atlas.scaleOf(caste);
  const hi = canvas(hcs * FRAMES, hcs), hc = hi.getContext('2d');
  for (let f = 0; f < FRAMES; f++) {
    hc.setTransform(HI * s, 0, 0, HI * s, f * hcs + hcs / 2, hcs / 2);
    drawAnt(hc, caste, atlas.pal, f, { legs, headless });
  }
  const shc = canvas(hcs + 16, hcs + 16), sc = shc.getContext('2d');
  sc.filter = 'blur(' + (HI * 0.45).toFixed(1) + 'px) brightness(0)'; sc.globalAlpha = 0.38;
  sc.drawImage(hi, 0, 0, hcs, hcs, 8, 8, hcs, hcs);
  v = { img: hi, cs: hcs, scale: HI, shadow: { img: shc, cs: hcs + 16 } };
  atlas.inj.set(key, v);
  return v;
}

// soft round dot sprite (fog puffs, particles, glows)
function softDot(r, rgb) {
  const c = canvas(r * 2, r * 2), x = c.getContext('2d');
  const g = x.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(' + rgb + ',1)'); g.addColorStop(0.45, 'rgba(' + rgb + ',0.45)'); g.addColorStop(1, 'rgba(' + rgb + ',0)');
  x.fillStyle = g; x.fillRect(0, 0, r * 2, r * 2);
  return c;
}

// ---- painted ground ---------------------------------------------------------------------
const GROUND_RES = 0.5;      // px per unit for the whole-map ground canvas
const CHUNK = 256, CHUNK_RES = 2;
const GRASS = ['#4f7f33', '#5a8b3a', '#64963f', '#6f9f45', '#4a7530', '#7aa84c', '#577f36'];

// terrain colours (terrain.js): a few tones each, picked by noise so patches aren't flat
const TERRAIN_TONES = [
  ['#5b8a3b', '#4f7f33', '#64963f'],   // grass
  ['#d9c28c', '#cdb47c', '#e2cd9a'],   // sand
  ['#a39a8a', '#958c7c', '#b1a898'],   // gravel
  ['#5e4630', '#6b5236', '#54402b'],   // mud
  ['#7a5a2e', '#8a6634', '#6a4e28'],   // leaf litter
  ['#3f78a8', '#3a6f9c', '#4682b2'],   // stream
  ['#3f78a8', '#3a6f9c', '#4682b2'],   // (water under a bridge)
];
function paintTerrain(S, x, seed, R) {
  const T = AL.TERRAIN, gw = S.gw, gh = S.gh, ter = S.terrain, W = S.W * GROUND_RES, H = S.H * GROUND_RES;
  // 1) the patches: one pixel per cell, upscaled smoothly so the edges blend
  const small = canvas(gw, gh), sx = small.getContext('2d'), img = sx.createImageData(gw, gh);
  for (let i = 0; i < gw * gh; i++) {
    const t = ter[i], gx = i % gw, gy = (i / gw) | 0, tones = TERRAIN_TONES[t] || TERRAIN_TONES[0];
    const hex = tones[(AL.hash2(gx, gy, seed) * tones.length) | 0], n = 0.9 + AL.fbm(gx / 9, gy / 9, seed + 9, 2) * 0.2;
    const v = parseInt(hex.slice(1), 16);
    img.data[i * 4] = ((v >> 16) & 255) * n; img.data[i * 4 + 1] = ((v >> 8) & 255) * n; img.data[i * 4 + 2] = (v & 255) * n; img.data[i * 4 + 3] = 255;
  }
  sx.putImageData(img, 0, 0);
  const cell = S.cell * GROUND_RES;
  x.imageSmoothingEnabled = true; x.filter = 'blur(' + (cell * 0.6).toFixed(1) + 'px)'; x.drawImage(small, -cell, -cell, W + cell * 2, H + cell * 2); x.drawImage(small, 0, 0, W, H); x.filter = 'none';
  // the texture's terrain lookup is jittered by a cell or so, so patch edges come out ragged rather than in cell steps
  const at = AL.Art.terrainAt = (px, py) => { const j = cell * 0.9, ox = (AL.noise2(px / 7, py / 7, seed + 61) - 0.5) * 2 * j, oy = (AL.noise2(px / 7 + 30, py / 7, seed + 62) - 0.5) * 2 * j;
    const gx = Math.max(0, Math.min(gw - 1, ((px + ox) / cell) | 0)), gy = Math.max(0, Math.min(gh - 1, ((py + oy) / cell) | 0)); return ter[gy * gw + gx]; };
  // 2) texture: sand ripples and grains, gravel pebbles, mud sheen, fallen leaves
  for (let k = 0; k < 60000; k++) {
    const px = R() * W, py = R() * H, t = at(px, py);
    if (t === T.SAND) { x.fillStyle = R() < 0.5 ? 'rgba(255,240,200,0.35)' : 'rgba(150,120,70,0.3)'; x.fillRect(px, py, 0.8, 0.8); }
    else if (t === T.GRAVEL && k % 3 === 0) { const r = 0.6 + R() * 1.4; x.fillStyle = ['#8a8274', '#b8b0a0', '#9c9484', '#6f685c'][k % 4]; x.beginPath(); x.ellipse(px, py, r, r * 0.8, R() * 3, 0, TAU); x.fill(); }
    else if (t === T.MUD && k % 4 === 0) { x.fillStyle = R() < 0.3 ? 'rgba(200,190,170,0.18)' : 'rgba(30,20,12,0.25)'; x.beginPath(); x.ellipse(px, py, 1 + R() * 3, 0.6 + R() * 1.4, R() * 3, 0, TAU); x.fill(); }
    else if (t === T.LITTER && k % 2 === 0) { const r = 1.4 + R() * 2.6; x.fillStyle = ['#9a6a2a', '#b07a30', '#6e4a22', '#c89a40', '#7d5a2a', '#5a3c1c'][k % 6]; x.globalAlpha = 0.7 + R() * 0.3; x.beginPath(); x.ellipse(px, py, r, r * 0.45, R() * 3.2, 0, TAU); x.fill(); x.globalAlpha = 1; }
  }
  // sand ripples
  x.strokeStyle = 'rgba(160,130,80,0.22)'; x.lineWidth = 0.7;
  for (let k = 0; k < 900; k++) { const px = R() * W, py = R() * H; if (at(px, py) !== T.SAND) continue; x.beginPath(); x.moveTo(px - 6, py); x.quadraticCurveTo(px, py - 1.5, px + 6, py); x.stroke(); }
  // 3) streams: water with dark banks and light glints; twig bridges across
  const water = t => t === T.STREAM || t === T.BRIDGE;
  let anyWater = false; for (let i = 0; i < gw * gh && !anyWater; i++) anyWater = water(ter[i]);
  if (anyWater) {
    const m = canvas(gw, gh), mx = m.getContext('2d'), mi = mx.createImageData(gw, gh);
    for (let i = 0; i < gw * gh; i++) if (water(ter[i])) { mi.data[i * 4 + 3] = 255; }
    mx.putImageData(mi, 0, 0);
    const big = canvas(W, H), bx = big.getContext('2d');
    bx.imageSmoothingEnabled = true; bx.filter = 'blur(' + (cell * 0.7).toFixed(1) + 'px)'; bx.drawImage(m, 0, 0, W, H); bx.filter = 'none';
    const src = bx.getImageData(0, 0, W, H), sd = src.data, out = bx.createImageData(W, H), od = out.data;
    // alpha bands: bank (wet earth) > deep > shallow edge, thresholds on the blurred mask
    for (let i = 0, n = W * H; i < n; i++) {
      const a = sd[i * 4 + 3]; if (a < 70) continue;
      const k = i * 4;
      if (a < 110) { od[k] = 52; od[k + 1] = 40; od[k + 2] = 26; od[k + 3] = 170; }
      else if (a < 150) { od[k] = 70; od[k + 1] = 128; od[k + 2] = 168; od[k + 3] = 255; }
      else { const d = Math.min(1, (a - 150) / 90); od[k] = 70 - d * 18; od[k + 1] = 128 - d * 18; od[k + 2] = 168 - d * 8; od[k + 3] = 255; }
    }
    bx.putImageData(out, 0, 0);
    x.drawImage(big, 0, 0);
  }
  x.strokeStyle = 'rgba(220,240,255,0.35)'; x.lineWidth = 0.8;
  for (let k = 0; k < 3000; k++) { const px = R() * W, py = R() * H; if (at(px, py) !== T.STREAM) continue; x.beginPath(); x.moveTo(px - 2.5, py); x.lineTo(px + 2.5, py + 0.6); x.stroke(); }
  // twig bridges: one bundle of twigs per bridge patch, laid across the stream (the shortest way over the water)
  const seenB = new Uint8Array(gw * gh), isW = (gx, gy) => gx >= 0 && gy >= 0 && gx < gw && gy < gh && water(ter[gy * gw + gx]);
  for (let i0 = 0; i0 < gw * gh; i0++) {
    if (ter[i0] !== T.BRIDGE || seenB[i0]) continue;   // (never any now: no twig bridges, terrain.js; kept for old saves)
    const q = [i0]; seenB[i0] = 1; let sx2 = 0, sy2 = 0, n = 0;
    while (q.length) { const i = q.pop(), gx = i % gw, gy = (i / gw) | 0; sx2 += gx; sy2 += gy; n++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = gx + dx, ny = gy + dy, j = ny * gw + nx; if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && !seenB[j] && ter[j] === T.BRIDGE) { seenB[j] = 1; q.push(j); } } }
    const cgx = sx2 / n + 0.5, cgy = sy2 / n + 0.5;
    let best = 1e9, ang = 0;
    for (let k = 0; k < 12; k++) {
      const a = k * Math.PI / 12, dx = Math.cos(a), dy = Math.sin(a); let len = 0;
      for (const sg of [1, -1]) for (let d = 0.5; d < 12; d += 0.5) { if (!isW((cgx + dx * d * sg) | 0, (cgy + dy * d * sg) | 0)) break; len += 0.5; }
      if (len < best) { best = len; ang = a; }
    }
    const len = (best + 1.6) * cell, wid = Math.min(Math.sqrt(n) * 0.8, 2.2) * cell, cx = cgx * cell, cy = cgy * cell;
    x.save(); x.translate(cx, cy); x.rotate(ang);
    const twigs = 3 + ((AL.hash2(i0, 1, seed) * 2) | 0);
    for (let t = 0; t < twigs; t++) {
      const o = (t / (twigs - 1) - 0.5) * wid, tl = len * (0.92 + AL.hash2(i0, t + 5, seed) * 0.2), tw = cell * (0.22 + AL.hash2(i0, t + 9, seed) * 0.12), rot = (AL.hash2(i0, t + 13, seed) - 0.5) * 0.12;
      x.save(); x.translate((AL.hash2(i0, t + 17, seed) - 0.5) * cell * 0.4, o); x.rotate(rot);
      x.fillStyle = 'rgba(20,14,8,0.35)'; x.fillRect(-tl / 2, -tw / 2 + 1.2, tl, tw);
      x.fillStyle = ['#8a6a3e', '#7a5a32', '#9a7a48'][t % 3]; x.fillRect(-tl / 2, -tw / 2, tl, tw);
      x.fillStyle = 'rgba(255,230,180,0.22)'; x.fillRect(-tl / 2, -tw / 2, tl, tw * 0.3);
      x.restore();
    }
    x.restore();
  }
}
function paintGround(S, seed, colonies) {
  const W = S.W * GROUND_RES, H = S.H * GROUND_RES;
  const c = canvas(W, H), x = c.getContext('2d');
  const R = AL.rng(seed ^ 0x5151);
  const B = AL.BIOMES && AL.BIOMES[S.biome], grassy = !S.terrain;
  x.fillStyle = (B && B.ground) || '#5b8a3b'; x.fillRect(0, 0, W, H);
  if (S.terrain) paintTerrain(S, x, seed, R);
  const T = AL.TERRAIN, onGrass = (px, py) => grassy || AL.Art.terrainAt(px, py) === T.GRASS;
  // big tonal blobs (sun-bleached and lush patches)
  for (let k = 0; k < 520; k++) {
    const px = R() * W, py = R() * H, r = 30 + R() * 140;
    if (!onGrass(px, py)) continue;
    const n = AL.fbm(px / 300, py / 300, seed, 3);
    const col = n > 0.55 ? ['#7ea24a', '#8aa956', '#91ad5a'][k % 3] : n < 0.42 ? ['#3f6a2a', '#456f2c', '#4b772f'][k % 3] : GRASS[k % GRASS.length];
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.globalAlpha = 0.35; x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
  }
  x.globalAlpha = 1;
  // bare earth patches: worn ground around the nests, under trees and along the path
  const dirt = (px, py, r, a) => {
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(122,92,58,' + a + ')'); g.addColorStop(0.6, 'rgba(110,84,52,' + a * 0.6 + ')'); g.addColorStop(1, 'rgba(100,80,50,0)');
    x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
  };
  for (const n of S.nestSites) { for (let k = 0; k < 9; k++) dirt(n.x * GROUND_RES + (R() - 0.5) * 70, n.y * GROUND_RES + (R() - 0.5) * 70, 50 + R() * 50, 0.55); }
  for (const t of S.trees) for (let k = 0; k < 14; k++) dirt((t.x + (R() - 0.5) * t.r * 1.1) * GROUND_RES, (t.y + (R() - 0.5) * t.r * 1.1) * GROUND_RES, 20 + R() * 40, 0.35);
  for (let k = 0; k < 40; k++) dirt(R() * W, R() * H, 10 + R() * 30, 0.3);
  // grass strokes
  for (let k = 0; k < 90000; k++) {
    const px = R() * W, py = R() * H;
    if (!onGrass(px, py)) continue;
    const n = AL.noise2(px / 60, py / 60, seed + 7);
    x.strokeStyle = GRASS[(n * GRASS.length * 1.3 + R() * 2) % GRASS.length | 0];
    x.globalAlpha = 0.35 + R() * 0.4; x.lineWidth = 0.6 + R() * 0.6;
    const len = 2 + R() * 4, a = -Math.PI / 2 + (R() - 0.5) * 1.2;
    x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + Math.cos(a) * len * 0.5 + 1, py + Math.sin(a) * len * 0.5, px + Math.cos(a) * len, py + Math.sin(a) * len); x.stroke();
  }
  x.globalAlpha = 1;
  // patio slabs (human zone)
  if (S.patio) {
    const p = S.patio, s = GROUND_RES;
    x.fillStyle = 'rgba(40,36,30,0.35)'; x.fillRect(p.x * s - 4, p.y * s - 4, p.w * s + 8, p.h * s + 8);
    const slab = 70;
    for (let yy = 0; yy < p.h; yy += slab) for (let xx = 0; xx < p.w; xx += slab) {
      const v = 0.85 + R() * 0.15;
      x.fillStyle = 'rgb(' + (178 * v | 0) + ',' + (170 * v | 0) + ',' + (156 * v | 0) + ')';
      x.fillRect((p.x + xx + 2) * s, (p.y + yy + 2) * s, (slab - 4) * s, (slab - 4) * s);
      x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect((p.x + xx + 2) * s, (p.y + yy + 2) * s, (slab - 4) * s, 2);
    }
  }
  // stepping stones
  for (const st of S.stones) drawStone(x, st.x * GROUND_RES, st.y * GROUND_RES, st.rx * GROUND_RES, st.ry * GROUND_RES, st.rot, st.seed, 1);
  return c;
}
function drawStone(x, cx, cy, rx, ry, rot, seed, k) {
  x.save(); x.translate(cx, cy); x.rotate(rot);
  x.fillStyle = 'rgba(30,30,20,0.35)'; x.beginPath(); x.ellipse(2 * k, 3 * k, rx, ry, 0, 0, TAU); x.fill();
  const g = x.createRadialGradient(-rx * 0.3, -ry * 0.4, 1, 0, 0, Math.max(rx, ry));
  g.addColorStop(0, '#c9c3b4'); g.addColorStop(0.7, '#a59f90'); g.addColorStop(1, '#827c6e');
  x.fillStyle = g; x.beginPath();
  for (let i = 0; i <= 18; i++) { const a = i / 18 * TAU, w = 1 + (AL.hash2(i % 18, 1, seed | 0) - 0.5) * 0.12; x.lineTo(Math.cos(a) * rx * w, Math.sin(a) * ry * w); }
  x.fill();
  x.strokeStyle = 'rgba(90,85,75,0.5)'; x.lineWidth = 0.6 * k;
  x.beginPath(); x.moveTo(-rx * 0.5, -ry * 0.1); x.lineTo(-rx * 0.1, ry * 0.2); x.lineTo(rx * 0.3, ry * 0.1); x.stroke();
  x.restore();
}

// detail chunks: the ground upscaled plus crisp grass blades, cached LRU
function ChunkCache(ground, S, seed) {
  this.ground = ground; this.S = S; this.seed = seed; this.map = new Map(); this.max = 48; this.built = 0;
}
ChunkCache.prototype.get = function (cx, cy, allowBuild) {
  const key = cy * 1000 + cx;
  let c = this.map.get(key);
  if (c) { this.map.delete(key); this.map.set(key, c); return c; }
  if (!allowBuild) return null;
  c = this.build(cx, cy); this.map.set(key, c); this.built++;
  if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  return c;
};
ChunkCache.prototype.build = function (cx, cy) {
  const px = CHUNK * CHUNK_RES, c = canvas(px, px), x = c.getContext('2d');
  const wx = cx * CHUNK, wy = cy * CHUNK, gs = GROUND_RES;
  x.imageSmoothingEnabled = true;
  x.drawImage(this.ground, wx * gs, wy * gs, CHUNK * gs, CHUNK * gs, 0, 0, px, px);
  const R = AL.rng((cx * 7919 + cy * 104729 + this.seed) >>> 0);
  // grass blades: dark undergrowth first, then lit tips
  for (let pass = 0; pass < 2; pass++) {
    const n = pass ? 520 : 900;
    for (let k = 0; k < n; k++) {
      const bx = R() * px, by = R() * px;
      const wxp = wx + bx / CHUNK_RES, wyp = wy + by / CHUNK_RES;
      if (AL.Surface.isBlocked(this.S, wxp, wyp)) continue;
      if (this.S.terrain) { const t = AL.Terrain.at(this.S, wxp, wyp); if (t !== AL.TERRAIN.GRASS && !(t === AL.TERRAIN.LITTER && k % 5 === 0)) continue; }
      const nn = AL.noise2(wxp / 90, wyp / 90, this.seed + 3);
      x.strokeStyle = pass ? GRASS[(nn * 5 + 2) % GRASS.length | 0] : GRASS[(nn * 3) % 3 === 0 ? 4 : 0];
      x.globalAlpha = pass ? 0.55 : 0.4;
      x.lineWidth = (pass ? 0.9 : 1.3) * CHUNK_RES * 0.5;
      const len = (3 + R() * 6) * CHUNK_RES * 0.7, a = -Math.PI / 2 + (R() - 0.5) * 1.3, bend = (R() - 0.5) * 4;
      x.beginPath(); x.moveTo(bx, by); x.quadraticCurveTo(bx + bend, by - len * 0.5, bx + Math.cos(a) * len, by + Math.sin(a) * len); x.stroke();
    }
  }
  x.globalAlpha = 1;
  // terrain close up: sand grains, gravel stones, leaves on the litter, a wet sheen on mud
  if (this.S.terrain) {
    const TT = AL.TERRAIN;
    for (let k = 0; k < 700; k++) {
      const bx = R() * px, by = R() * px, t = AL.Terrain.at(this.S, wx + bx / CHUNK_RES, wy + by / CHUNK_RES);
      if (t === TT.SAND) { x.fillStyle = R() < 0.5 ? 'rgba(255,244,210,0.5)' : 'rgba(140,110,60,0.4)'; x.fillRect(bx, by, 1.2, 1.2); }
      else if (t === TT.GRAVEL && k % 2 === 0) { const r = (0.8 + R() * 1.8) * CHUNK_RES; x.fillStyle = 'rgba(40,36,30,0.3)'; x.beginPath(); x.ellipse(bx + 1, by + 1.4, r, r * 0.75, 0, 0, TAU); x.fill(); x.fillStyle = ['#a8a090', '#c2baa8', '#8f8778'][k % 3]; x.beginPath(); x.ellipse(bx, by, r, r * 0.75, R() * 3, 0, TAU); x.fill(); }
      else if (t === TT.LITTER && k % 2 === 0) { const r = (2 + R() * 3.5) * CHUNK_RES, a = R() * 3.2; x.fillStyle = ['#a8742e', '#c0883a', '#7a5226', '#d6a44a', '#8c6230'][k % 5]; x.save(); x.translate(bx, by); x.rotate(a); x.beginPath(); x.ellipse(0, 0, r, r * 0.42, 0, 0, TAU); x.fill(); x.strokeStyle = 'rgba(60,36,14,0.6)'; x.lineWidth = 0.6; x.beginPath(); x.moveTo(-r, 0); x.lineTo(r, 0); x.stroke(); x.restore(); }
      else if (t === TT.MUD && k % 5 === 0) { x.fillStyle = 'rgba(210,200,180,0.16)'; x.beginPath(); x.ellipse(bx, by, (2 + R() * 4) * CHUNK_RES, (0.8 + R()) * CHUNK_RES, R() * 3, 0, TAU); x.fill(); }
    }
  }
  // pebbles and soil grains
  for (let k = 0; k < 26; k++) {
    const bx = R() * px, by = R() * px, r = (0.6 + R() * 1.6) * CHUNK_RES;
    x.fillStyle = 'rgba(40,30,20,0.25)'; x.beginPath(); x.ellipse(bx + 1, by + 1.5, r, r * 0.8, 0, 0, TAU); x.fill();
    x.fillStyle = ['#9b8e78', '#b3a58c', '#8a7a62'][k % 3]; x.beginPath(); x.ellipse(bx, by, r, r * 0.8, R() * 3, 0, TAU); x.fill();
  }
  // stones that cross the chunk get re-drawn crisp
  for (const st of this.S.stones) {
    if (st.x + st.rx < wx || st.x - st.rx > wx + CHUNK || st.y + st.ry < wy || st.y - st.ry > wy + CHUNK) continue;
    drawStone(x, (st.x - wx) * CHUNK_RES, (st.y - wy) * CHUNK_RES, st.rx * CHUNK_RES, st.ry * CHUNK_RES, st.rot, st.seed, CHUNK_RES);
  }
  return c;
};

AL.Art = { foodDrawers: {}, ROT, FRAMES, LO, HI, BASE_LEN, GROUND_RES, CHUNK, CHUNK_RES, canvas, shade, mix, drawAnt, antExtent, buildAtlas, hurtSprite, softDot, paintGround, drawStone, ChunkCache };
})(window);
