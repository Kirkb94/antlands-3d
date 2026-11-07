// Antlands shared namespace and small helpers.
// Every game module attaches itself to AL. In Node (tests) modules require each other;
// in the browser they are plain <script> tags loaded in order (no build step).
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = (!NODE && root.AL) || {};

AL.TAU = Math.PI * 2;
AL.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
AL.lerp = (a, b, t) => a + (b - a) * t;
AL.smooth = t => t * t * (3 - 2 * t);
AL.easeInOut = t => { if (t < 0.5) return 4 * t * t * t; const u = -2 * t + 2; return 1 - u * u * u / 2; };
AL.sq = v => v * v;
AL.dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
// wrap an angle to [-PI, PI)
AL.wrap = a => { a = (a + Math.PI) % AL.TAU; if (a < 0) a += AL.TAU; return a - Math.PI; };

// ---- the same maths on every browser -------------------------------------------------------------------
// Math.sin, cos, atan2, exp, pow and hypot may differ in the last bit between browser engines (Chrome, Firefox,
// Safari each have their own), and in a lockstep match one bit is enough to send two PCs' worlds apart. The
// simulation uses these instead: ports of the fdlibm routines (sun.com, the ones most engines started from) made of
// + - * / and Math.sqrt / round / floor only, which IEEE-754 makes exact everywhere. Drawing code may keep Math.*.
(function () {
  const PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11, INVPIO2 = 6.36619772367581382433e-01;
  const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04, S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
  const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05, C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
  const ks = x => { const z = x * x, v = z * x, r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6))); return x + v * (S1 + z * r); };
  const kc = x => { const z = x * x, r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6))))); return 1 - (0.5 * z - z * r); };
  // x = n * PI/2 + r, |r| <= PI/4 (n * PIO2_1 is exact for |n| < 2^20: PIO2_1 has 33 significant bits)
  let N = 0;
  const red = x => { const n = Math.round(x * INVPIO2); N = n; return (x - n * PIO2_1) - n * PIO2_1T; };
  AL.sin = x => {
    if (!(x === x) || x === Infinity || x === -Infinity) return NaN;
    if (x > -0.7853981633974483 && x < 0.7853981633974483) return ks(x);
    const r = red(x), q = N & 3;
    return q === 0 ? ks(r) : q === 1 ? kc(r) : q === 2 ? -ks(r) : -kc(r);
  };
  AL.cos = x => {
    if (!(x === x) || x === Infinity || x === -Infinity) return NaN;
    if (x > -0.7853981633974483 && x < 0.7853981633974483) return kc(x);
    const r = red(x), q = N & 3;
    return q === 0 ? kc(r) : q === 1 ? -ks(r) : q === 2 ? -kc(r) : ks(r);
  };
  const ATHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
  const ATLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
  const AT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01, 9.09088713343650656196e-02,
    -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02, 4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];
  AL.atan = x => {
    if (!(x === x)) return NaN;
    const neg = x < 0; let a = neg ? -x : x, id;
    if (a >= 7.378697629483821e19) return neg ? -(ATHI[3] + ATLO[3]) : ATHI[3] + ATLO[3];
    if (a < 0.4375) { if (a < 1.862645149230957e-9) return x; id = -1; }
    else if (a < 1.1875) { if (a < 0.6875) { id = 0; a = (2 * a - 1) / (2 + a); } else { id = 1; a = (a - 1) / (a + 1); } }
    else if (a < 2.4375) { id = 2; a = (a - 1.5) / (1 + 1.5 * a); } else { id = 3; a = -1 / a; }
    const z = a * a, w = z * z;
    const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
    const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
    const r = id < 0 ? a - a * (s1 + s2) : ATHI[id] - ((a * (s1 + s2) - ATLO[id]) - a);
    return neg ? -r : r;
  };
  const PI = 3.1415926535897931160e+00, PI_LO = 1.2246467991473531772e-16, PIO2 = 1.5707963267948965580e+00;
  AL.atan2 = (y, x) => {
    if (!(x === x) || !(y === y)) return NaN;
    if (y === 0) return x > 0 || (x === 0 && 1 / x > 0) ? y : (1 / y > 0 ? PI : -PI);
    if (x === 0) return y > 0 ? PIO2 : -PIO2;
    if (x === Infinity || x === -Infinity || y === Infinity || y === -Infinity) return Math.atan2(y, x);   // (never in the game)
    const z = AL.atan(Math.abs(y / x));
    if (x > 0) return y > 0 ? z : -z;
    return y > 0 ? PI - (z - PI_LO) : (z - PI_LO) - PI;
  };
  // 2^k exactly (|k| <= 1023), by its bits
  const F64 = new Float64Array(1), U32 = new Uint32Array(F64.buffer), HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0;
  const pow2 = k => { F64[0] = 0; U32[HI] = (k + 1023) << 20; return F64[0]; };
  const LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10, INVLN2 = 1.44269504088896338700e+00;
  const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05, P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;
  AL.exp = x => {
    if (!(x === x)) return NaN;
    if (x > 709.782712893384) return Infinity;
    if (x < -745.1332191019411) return 0;
    const a = x < 0 ? -x : x;
    if (a < 3.725290298461914e-9) return 1 + x;
    let k = 0, hi = x, lo = 0;
    if (a > 0.34657359027997264) {
      k = a < 1.0397207708399179 ? (x > 0 ? 1 : -1) : Math.trunc(INVLN2 * x + (x < 0 ? -0.5 : 0.5));
      hi = x - k * LN2_HI; lo = k * LN2_LO; x = hi - lo;
    }
    const t = x * x, c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
    if (k === 0) return 1 - ((x * c) / (c - 2) - x);
    const y = 1 - ((lo - (x * c) / (2 - c)) - hi);
    if (k >= -1021) return k > 1023 ? y * pow2(1023) * pow2(k - 1023) : y * pow2(k);
    return y * pow2(k + 1000) * pow2(-1000);
  };
  const LG1 = 6.666666666666735130e-01, LG2 = 3.999999999940941908e-01, LG3 = 2.857142874366239149e-01, LG4 = 2.222219843214978396e-01, LG5 = 1.818357216161805012e-01, LG6 = 1.531383769920937332e-01, LG7 = 1.479819860511658591e-01;
  AL.log = x => {
    if (!(x === x) || x < 0) return NaN;
    if (x === 0) return -Infinity;
    if (x === Infinity) return Infinity;
    let k = 0;
    F64[0] = x; let hx = U32[HI];
    if (hx < 0x00100000) { k -= 54; F64[0] = x * 18014398509481984; hx = U32[HI]; }   // subnormal: times 2^54
    k += (hx >> 20) - 1023; hx &= 0x000fffff;
    const i = (hx + 0x95f64) & 0x100000;
    U32[HI] = hx | (i ^ 0x3ff00000);   // normalise to [sqrt(2)/2, sqrt(2))
    k += i >> 20;
    const f = F64[0] - 1, s = f / (2 + f), dk = k, z = s * s, w = z * z;
    const t1 = w * (LG2 + w * (LG4 + w * LG6)), t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7))), R = t2 + t1;
    const hfsq = 0.5 * f * f;
    return dk * LN2_HI - ((hfsq - (s * (hfsq + R) + dk * LN2_LO)) - f);
  };
  // x^y: whole exponents by multiplying (exact sequence), others as exp(y log x)
  AL.pow = (x, y) => {
    if (y === 0) return 1;
    if (!(x === x) || !(y === y)) return NaN;
    if (y === Math.floor(y) && y >= -64 && y <= 64) {
      let n = y < 0 ? -y : y, b = x, r = 1;
      while (n > 0) { if (n & 1) r *= b; b *= b; n >>= 1; }
      return y < 0 ? 1 / r : r;
    }
    if (x === 0) return y > 0 ? 0 : Infinity;
    if (x < 0) return NaN;
    return AL.exp(y * AL.log(x));
  };
  AL.hypot = (x, y, z) => Math.sqrt(z === undefined ? x * x + y * y : x * x + y * y + z * z);
})();

// xorshift32: seeded, fast, good enough for gameplay
AL.rng = function (seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  const f = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  f.int = n => (f() * n) | 0;
  f.range = (a, b) => a + f() * (b - a);
  f.pick = arr => arr[(f() * arr.length) | 0];
  f.state = () => s;
  f.setState = v => { s = v >>> 0; };   // (a world snapshot puts the stream back where it was: snap.js)
  return f;
};

// cheap deterministic 2D value noise (used by map generation and the painted textures)
AL.hash2 = (x, y, seed) => {
  let h = (x * 374761393 + y * 668265263 + (seed | 0) * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
AL.noise2 = (x, y, seed) => {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = AL.hash2(xi, yi, seed), b = AL.hash2(xi + 1, yi, seed), c = AL.hash2(xi, yi + 1, seed), d = AL.hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
AL.fbm = (x, y, seed, oct) => {
  let s = 0, amp = 0.5, f = 1, n = 0;
  for (let o = 0; o < (oct || 4); o++) { s += amp * AL.noise2(x * f, y * f, seed + o * 31); n += amp; amp *= 0.5; f *= 2; }
  return s / n;
};

// this PC's colony id in the current game (0 in single player; multiplayer: the slot this PC plays). UI only:
// the simulation never asks who is watching.
AL.me = () => { const G = AL.Game, w = G && G.world; return (w && w.me) || 0; };

// ---- plug-in points (see docs/CONTRACT.md) ------------------------------------------
// Systems: simulation/render modules that hook into every world without editing core files.
//   AL.registerSystem({ id, order, enabled(opts), init(world, opts), pre(world, dt), tick(world, dt),
//                       second(world, 1), render: { <layer>: (ctx, view, renderer) => {} } })
AL.SYSTEMS = AL.SYSTEMS || [];
AL.registerSystem = function (sys) {
  if (!sys || !sys.id) throw new Error('registerSystem needs an id');
  const i = AL.SYSTEMS.findIndex(s => s.id === sys.id);
  if (i >= 0) AL.SYSTEMS[i] = sys; else AL.SYSTEMS.push(sys);
  AL.SYSTEMS.sort((a, b) => (a.order || 0) - (b.order || 0));
  return sys;
};
// Events: AL.on(type, fn(world, data)); AL.emit(world, type, data). Listeners must not throw.
AL.LISTENERS = AL.LISTENERS || {};
AL.on = function (type, fn) { (AL.LISTENERS[type] = AL.LISTENERS[type] || []).push(fn); return () => AL.off(type, fn); };
AL.off = function (type, fn) { const l = AL.LISTENERS[type]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } };
AL.emit = function (world, type, data) {
  data = data || {};
  if (world && world.events && world.events.length < 500) world.events.push(Object.assign({ type, t: world.t }, data));
  const l = AL.LISTENERS[type];
  if (l) for (const fn of l.slice()) { try { fn(world, data); } catch (e) { if (AL.reportError) AL.reportError(e, 'event ' + type, world); else if (typeof console !== 'undefined') console.error('[AL.on ' + type + ']', e); } }
  const any = AL.LISTENERS['*'];
  if (any) for (const fn of any.slice()) { try { fn(world, Object.assign({ type }, data)); } catch (e) { console.error(e); } }
};
// Scenes: full-screen phases that run before (or instead of) colony play, e.g. nuptial flight, founding.
//   AL.registerScene({ id, order, start(game, ctx), update(game, dt), render(c2d, game), key(e), end(game) })
// The flow runs every registered pre-colony scene in order; each calls ctx.done(patch) and the
// patches are merged into the createWorld options for the colony game.
AL.SCENES = AL.SCENES || [];
AL.registerScene = function (sc) {
  const i = AL.SCENES.findIndex(s => s.id === sc.id);
  if (i >= 0) AL.SCENES[i] = sc; else AL.SCENES.push(sc);
  AL.SCENES.sort((a, b) => (a.order || 0) - (b.order || 0));
  return sc;
};

if (NODE) module.exports = AL; else root.AL = AL;
})(typeof window !== 'undefined' ? window : globalThis);
