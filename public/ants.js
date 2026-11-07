// Ant storage (struct of arrays in typed arrays) and a spatial hash for neighbour queries.
// Thousands of ants stay cache-friendly and allocation-free: no per-ant objects anywhere.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) require('./data.js');

class AntStore {
  constructor(cap) {
    this.cap = cap;
    this.x = new Float32Array(cap); this.y = new Float32Array(cap);     // position (surface world units, or nest units when layer=NEST)
    this.px = new Float32Array(cap); this.py = new Float32Array(cap);   // previous position, for render interpolation
    this.a = new Float32Array(cap);                                      // heading (radians)
    this.turn = new Float32Array(cap);                                   // steering decided by the last sensing pass
    this.col = new Uint8Array(cap);                                      // colony index
    this.caste = new Uint8Array(cap);
    this.state = new Uint8Array(cap);                                    // AL.ST.*; 0 = free slot
    this.prev = new Uint8Array(cap);                                     // state to go back to after a fight
    this.layer = new Uint8Array(cap);                                    // AL.LAYER.*
    this.nest = new Uint8Array(cap);                                     // which nest an ant on the NEST layer is in (a nest id: colony k's own is k, satellites' see world.homes)
    this.home = new Uint8Array(cap);                                     // the nest an ant lives in (its colony's, or one of its satellites')
    this.carry = new Uint8Array(cap);                                    // AL.CARRY.*
    this.task = new Uint8Array(cap);                                     // nest task / field id
    this.hp = new Float32Array(cap); this.maxhp = new Float32Array(cap);
    this.age = new Float32Array(cap); this.life = new Float32Array(cap);
    this.timer = new Float32Array(cap);                                  // generic state timer
    this.str = new Float32Array(cap);                                    // trail strength being laid (decays as it walks)
    this.tx = new Float32Array(cap); this.ty = new Float32Array(cap);   // target point
    this.tgt = new Int32Array(cap);                                      // target ant / food / creature / order index
    this.tuid = new Int32Array(cap);                                     // uid of the targeted ant (detects reused slots)
    this.uid = new Int32Array(cap);
    this.anim = new Float32Array(cap);                                   // walk-cycle phase
    this.wf = new Float32Array(cap);                                     // wall-follow timer after bumping an obstacle
    this.act = new Uint8Array(cap);                                      // nest action to do on arrival (AL.ACT)
    this.wp = new Int16Array(cap);                                       // waypoint index (recruit paths)
    this.size = new Float32Array(cap).fill(1);                           // body scale (nanitics are small)
    this.legs = new Uint8Array(cap).fill(63);                            // legs left (bits 0-2 left front/mid/hind, 3-5 right; injury.js)
    this.headless = new Uint8Array(cap);                                 // 1 = lost its head in a fight (injury.js)
    this.gut = new Float32Array(cap).fill(1);                            // stomach, 0 empty .. 1 full (hunger.js)
    this.load = new Float32Array(cap);                                   // food a nurse carries to the queen or brood (hunger.js)
    this.free = new Int32Array(cap);
    this.nfree = 0;
    this.high = 0;     // one past the highest slot ever used
    this.count = 0;    // live ants
    this.nextUid = 1;
  }
  spawn(col, caste, layer, x, y, a, R) {
    let i;
    if (this.nfree > 0) i = this.free[--this.nfree];
    else if (this.high < this.cap) i = this.high++;
    else return -1;
    const info = AL.CASTES[caste];
    this.x[i] = this.px[i] = x; this.y[i] = this.py[i] = y; this.a[i] = a || 0; this.turn[i] = 0;
    this.col[i] = col; this.caste[i] = caste; this.layer[i] = layer; this.nest[i] = col; this.home[i] = col;
    this.state[i] = layer === AL.LAYER.SURFACE ? AL.ST.WANDER : AL.ST.N_IDLE; this.prev[i] = this.state[i];
    this.carry[i] = 0; this.task[i] = 0;
    this.hp[i] = this.maxhp[i] = info.hp;
    this.age[i] = 0;
    const r = R ? R() : Math.random();
    this.life[i] = info.life * (0.8 + 0.4 * r);
    this.timer[i] = 0; this.str[i] = 0; this.tx[i] = x; this.ty[i] = y;
    this.tgt[i] = -1; this.tuid[i] = 0; this.uid[i] = this.nextUid++;
    this.anim[i] = r * 4; this.wf[i] = 0; this.act[i] = 0; this.wp[i] = 0; this.size[i] = 1;
    this.legs[i] = 63; this.headless[i] = 0;
    this.gut[i] = 0.4 + 0.6 * ((r * 7.31) % 1); this.load[i] = 0;          // not everyone hungry at once
    this.count++;
    return i;
  }
  kill(i) {
    if (this.state[i] === AL.ST.DEAD) return;
    this.state[i] = AL.ST.DEAD; this.uid[i] = 0; this.carry[i] = 0;
    this.free[this.nfree++] = i; this.count--;
  }
  alive(i) { return this.state[i] !== AL.ST.DEAD; }
  // is the ant this slot targets still the same ant?
  targetValid(i) { const t = this.tgt[i]; return t >= 0 && this.state[t] !== AL.ST.DEAD && this.uid[t] === this.tuid[i]; }
}

// Uniform grid hash rebuilt every tick: head/next linked lists plus per-colony counts per cell
// (the counts let an ant skip neighbour scans when no enemy is anywhere near).
class SpatialHash {
  constructor(worldW, worldH, cell, cap, ncol) {
    this.cell = cell; this.inv = 1 / cell;
    this.w = Math.ceil(worldW / cell) + 1; this.h = Math.ceil(worldH / cell) + 1;
    this.head = new Int32Array(this.w * this.h).fill(-1);
    this.next = new Int32Array(cap);
    this.ncol = ncol || 2;
    this.cnt = new Uint16Array(this.w * this.h * this.ncol);
  }
  clear() { this.head.fill(-1); this.cnt.fill(0); }
  cellOf(x, y) {
    let cx = (x * this.inv) | 0, cy = (y * this.inv) | 0;
    if (cx < 0) cx = 0; else if (cx >= this.w) cx = this.w - 1;
    if (cy < 0) cy = 0; else if (cy >= this.h) cy = this.h - 1;
    return cy * this.w + cx;
  }
  insert(i, x, y, col) {
    const c = this.cellOf(x, y);
    this.next[i] = this.head[c]; this.head[c] = i;
    const k = c * this.ncol + col; if (this.cnt[k] < 65535) this.cnt[k]++;
  }
  // number of ants NOT of colony col in the 3x3 block around cell c
  enemiesNear(c, col) {
    const w = this.w, nc = this.ncol, cx = c % w, cy = (c / w) | 0;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = cy + dy; if (yy < 0 || yy >= this.h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = cx + dx; if (xx < 0 || xx >= w) continue;
        const k = (yy * w + xx) * nc;
        for (let o = 0; o < nc; o++) if (o !== col) n += this.cnt[k + o];
      }
    }
    return n;
  }
  // calls fn(j) for every ant within the 3x3 cells around (x,y); stops early if fn returns true
  each(x, y, fn) {
    const w = this.w, c = this.cellOf(x, y), cx = c % w, cy = (c / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = cy + dy; if (yy < 0 || yy >= this.h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = cx + dx; if (xx < 0 || xx >= w) continue;
        for (let j = this.head[yy * w + xx]; j !== -1; j = this.next[j]) if (fn(j)) return;
      }
    }
  }
}

AL.AntStore = AntStore;
AL.SpatialHash = SpatialHash;
if (NODE) module.exports = { AntStore, SpatialHash };
})(typeof window !== 'undefined' ? window : globalThis);
