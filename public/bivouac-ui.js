// Army ants, browser side of bivouac.js: the marching bivouac on the surface (old heap thinning out, the
// queen's knot rolling along the route, the new heap forming), the planned route, a bivouac status widget,
// toasts, and a banner over the nest view while the colony is on the move.
(function (root) {
'use strict';
const AL = root.AL, TAU = Math.PI * 2;
const B = () => AL.Bivouac;

// a heap of clinging ants (same look as render.js drawBivouac, any size, any spot)
function heap(r, ctx, c, x, y, n, seed) {
  if (n < 2) return;
  const at = r.atlas[c.id]; if (!at) return;
  const sp = at.lo[AL.CASTE.WORKER], cs = sp.cs, R = AL.rng(seed), rad = 10 + Math.sqrt(n) * 3.2, k = 1 / sp.scale;
  ctx.fillStyle = 'rgba(20,10,4,0.3)'; ctx.beginPath(); ctx.ellipse(x + 3, y + 5, rad * 1.05, rad * 0.95, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(40,20,8,0.8)'; ctx.beginPath(); ctx.arc(x, y, rad * 0.78, 0, TAU); ctx.fill();
  for (let j = 0; j < n; j++) {
    const a = R() * TAU, d = Math.sqrt(R()) * rad, px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
    const ang = R() * TAU + Math.sin(r.frame * 0.05 + j) * 0.2, rot = ((ang / TAU * AL.Art.ROT) | 0) % AL.Art.ROT, fr = (j + (r.frame >> 3)) & 3;
    ctx.drawImage(sp.img, rot * cs, fr * cs, cs, cs, px - cs * k / 2, py - cs * k / 2, cs * k, cs * k);
  }
}
function patchRenderer() {
  const P = AL.Renderer && AL.Renderer.prototype;
  if (!P || P._bivPatched || !P.drawBivouac) return;
  const orig = P.drawBivouac;
  P._bivPatched = true;
  // while marching the bivouac is three heaps: what's left at the old site, the queen's knot, the new heap
  P.drawBivouac = function (ctx, c, z) {
    const m = c.biv && c.biv.march;
    if (!m) return orig.call(this, ctx, c, z);
    const tau = (this.world.t - m.t0) / m.dur, full = Math.min(140, 30 + (c.pop[0] + c.pop[1]) * 0.5 | 0);
    const fog = this.world.fog, seen = (x, y) => c.id === AL.me() || !fog || fog.seenAt(x, y);
    if (seen(m.from.x, m.from.y)) heap(this, ctx, c, m.from.x, m.from.y, full * AL.clamp(1 - tau / 0.5, 0, 1) | 0, c.id * 13 + 5);
    if (seen(m.to.x, m.to.y)) heap(this, ctx, c, m.to.x, m.to.y, full * AL.clamp((tau - 0.55) / 0.45, 0, 1) | 0, c.id * 13 + 9);
    if (!m.qAt) heap(this, ctx, c, c.x, c.y, 14, c.id * 7 + 3);
  };
}

// the planned route: a worn scent path, and for the player the new site's ring
function drawRoutes(ctx, view, r) {
  const w = r.world, fog = w.fog;
  for (const c of w.colonies) {
    const m = c.biv && c.biv.march;
    if (!m || !c.alive) continue;
    const me = c.id === AL.me();
    if (!me && fog && !fog.visibleAt(c.x, c.y)) continue;
    const P = m.route.pts;
    ctx.strokeStyle = me ? 'rgba(224,160,96,0.45)' : 'rgba(200,90,60,0.35)'; ctx.lineWidth = me ? 5 : 4; ctx.lineCap = 'round';
    ctx.setLineDash([2, 10]); ctx.lineDashOffset = -r.frame * 0.5;
    ctx.beginPath(); P.forEach((p, k) => k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); ctx.setLineDash([]);
    if (me) {
      const pulse = 0.5 + 0.5 * Math.sin(r.frame * 0.08);
      ctx.strokeStyle = 'rgba(224,160,96,' + (0.4 + pulse * 0.4) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(m.to.x, m.to.y, 34 + pulse * 6, 0, TAU); ctx.stroke();
    }
  }
}
// March tool hover: show where the column would go
function drawPreview(ctx, view, r) {
  const tool = AL.Input && AL.Input.tool, mo = AL.Input && AL.Input.mouse, w = r.world, c = w.player;
  if (!tool || tool.id !== 'march' || !mo || !mo.inside || !c.sp.nomad || !B()) return;
  const p = { x: mo.wx, y: mo.wy };
  const can = B().canMarch(w, c), d = Math.hypot(p.x - c.x, p.y - c.y), T = B().TUNE;
  const ok = can.ok && d >= T.MIN_D && !AL.Surface.isBlocked(w.surface, p.x, p.y);
  const k = d > T.MAX_D ? T.MAX_D / d : 1, ex = c.x + (p.x - c.x) * k, ey = c.y + (p.y - c.y) * k;
  ctx.strokeStyle = ok ? 'rgba(224,160,96,0.7)' : 'rgba(220,90,70,0.6)'; ctx.lineWidth = 2.5; ctx.setLineDash([8, 8]);
  ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(ex, ey, 30, 0, TAU); ctx.stroke();
}
// swarm raids: the front rolling across the ground, small prey fleeing ahead of it
function drawSwarms(ctx, view, r) {
  const w = r.world, fog = w.fog;
  for (const c of w.colonies) {
    const s = c.swarm; if (!s || !c.alive) continue;
    const me = c.id === AL.me(), ca = Math.cos(s.a), sa = Math.sin(s.a), hw = Math.min(AL.Swarm.TUNE.WMAX, AL.Swarm.TUNE.W0 + s.h * AL.Swarm.TUNE.WK);
    const fx = s.ox + ca * s.h, fy = s.oy + sa * s.h;
    if (!me && fog && !fog.visibleAt(fx, fy)) continue;
    // the raid's path back home: a dark, trampled fan
    ctx.fillStyle = me ? 'rgba(60,30,10,0.12)' : 'rgba(80,20,10,0.12)';
    ctx.beginPath(); ctx.moveTo(s.ox, s.oy); ctx.lineTo(fx - sa * hw, fy + ca * hw); ctx.lineTo(fx + sa * hw, fy - ca * hw); ctx.closePath(); ctx.fill();
    // prey flushed out ahead of the front
    const R = AL.rng((s.id * 31 + (r.frame >> 2)) | 0);
    for (let k = 0; k < 18; k++) {
      const l = (R() * 2 - 1) * hw, ahead = 6 + R() * 26, x = fx - sa * l + ca * ahead, y = fy + ca * l + sa * ahead;
      ctx.fillStyle = R() < 0.5 ? 'rgba(40,30,20,0.75)' : 'rgba(90,70,40,0.75)';
      ctx.fillRect(x, y, 1.6, 1.1);
    }
  }
  // Swarm raid tool hover: the way the next raid would sweep
  const tool = AL.Input && AL.Input.tool, mo = AL.Input && AL.Input.mouse, c = w.player;
  if (tool && tool.id === 'swarm' && mo && mo.inside && c.sp.nomad) {
    const a = Math.atan2(mo.wy - c.y, mo.wx - c.x), d = AL.clamp(Math.hypot(mo.wx - c.x, mo.wy - c.y), 120, AL.Swarm.TUNE.DIST[1]), hw = Math.min(AL.Swarm.TUNE.WMAX, AL.Swarm.TUNE.W0 + d * AL.Swarm.TUNE.WK);
    const ex = c.x + Math.cos(a) * d, ey = c.y + Math.sin(a) * d, ca = Math.cos(a), sa = Math.sin(a);
    ctx.strokeStyle = 'rgba(224,160,96,0.7)'; ctx.lineWidth = 2; ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(ex - sa * hw, ey + ca * hw); ctx.moveTo(c.x, c.y); ctx.lineTo(ex + sa * hw, ey - ca * hw); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ex - sa * hw, ey + ca * hw); ctx.lineTo(ex + sa * hw, ey - ca * hw); ctx.stroke(); ctx.setLineDash([]);
  }
}
// over the nest view: the bivouac is a moving heap, say so
function nestBanner(ctx, view, r) {
  const c = r.world.player, m = c.biv && c.biv.march;
  if (!m) return;
  const tau = AL.clamp((r.world.t - m.t0) / m.dur, 0, 1), W = Math.min(360 * view.dpr, view.w - 32 * view.dpr), x = (view.w - W) / 2, y = view.h - 112 * view.dpr;   // above the tool bar, clear of the top panels
  ctx.save();
  ctx.fillStyle = 'rgba(24,15,8,0.82)'; ctx.strokeStyle = 'rgba(224,160,96,0.6)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(x, y, W, 40 * view.dpr, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#f4ead6'; ctx.font = '600 ' + (12 * view.dpr) + 'px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('On the march: the bivouac is moving (' + Math.round(tau * 100) + '%)', view.w / 2, y + 14 * view.dpr);
  ctx.fillStyle = 'rgba(224,160,96,0.9)'; ctx.fillRect(x + 12 * view.dpr, y + 28 * view.dpr, (W - 24 * view.dpr) * tau, 4 * view.dpr);
  ctx.restore();
}

AL.registerSystem({
  id: 'bivouac-art', order: 7.6,
  init() { patchRenderer(); },
  render: { underAnts: (ctx, v, r) => { drawRoutes(ctx, v, r); drawPreview(ctx, v, r); if (AL.Swarm) drawSwarms(ctx, v, r); }, nestScreen: nestBanner },
});

// ---- HUD: a small status line for an army player --------------------------------------------------
const mmss = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function widgetHtml(w) {
  const c = w.player, b = c.biv; if (!b) return '';
  const m = b.march, T = B().TUNE, st = B().broodStages(c), sw = c.swarm, SWT = AL.Swarm && AL.Swarm.TUNE;
  let raid = '';
  if (sw) raid = '<div class="biv" data-tip="A swarm raid: a broad front of raiders sweeping the ground. Every catch is carried home along the raid trail."><b>Swarm raid</b> out <small>' + sw.ants.size + ' at the front, ' + sw.caught + ' caught' + (sw.brood ? ', ' + sw.brood + ' brood taken' : '') + '</small></div>';
  else if (SWT && c.swarmNext != null && !m) raid = '<div class="biv"><b>Next raid</b> in ' + mmss(c.swarmNext - w.t) + ' <small>aim it: Swarm raid [Z]</small></div>';
  if (m) {
    const tau = AL.clamp((w.t - m.t0) / m.dur, 0, 1);
    return '<div class="biv nomadic" data-tip="The colony streams along the route carrying brood and the queen. The column is exposed: a killed carrier loses its brood."><b>On the march</b> ' + Math.round(tau * 100) + '%' +
      ' <small>' + m.carriers.size + ' brood carried' + (m.lost ? ', ' + m.lost + ' lost' : '') + '</small><i class="bar"><i style="width:' + (tau * 100).toFixed(0) + '%"></i></i></div>';
  }
  const t = w.t - b.since;
  if (b.phase === 'nomadic') {
    const next = Math.max(0, b.moveAt - w.t);
    return '<div class="biv nomadic" data-tip="Wandering (nomadic) phase: the larvae are hungry. The colony raids hard and moves to a new bivouac along its raid trail every so often, until the larvae pupate. Press B (March) and click to choose where the next move goes."><b>Wandering</b> ' + mmss(t) +
      ' <small>' + st.l + ' hungry larvae · moves ' + (next > 0 ? 'in ' + mmss(next) : 'soon') + ' [B]</small></div>' + raid;
  }
  const q = c.queen, laying = b.laying ? 'the queen is laying her batch' + (q && q.bank >= 1 ? ' (' + Math.floor(q.bank) + ' to go)' : '') : st.p ? st.p + ' pupae maturing' : 'resting';
  return '<div class="biv" data-tip="Settled (statary) phase: the bivouac stays put while the pupae mature, and the queen lays one big batch. When the new eggs hatch the colony starts wandering. Raids go out like spokes, a new direction each time."><b>Bivouac</b> settled ' + mmss(t) +
    ' <small>' + laying + '</small></div>' + raid;
}
AL.on('worldCreated', w => {
  if (!AL.UI || !AL.UI.addWidget || (AL.Game && AL.Game.world && AL.Game.world !== w && AL.Game.demo)) return;
  if (w.player && w.player.sp.nomad && B()) AL.UI.addWidget('bivouac', { where: 'left', every: 0.5, html: widgetHtml });
  else AL.UI.removeWidget('bivouac');
});
AL.on('marchEnd', (w, d) => {
  if (d.col !== AL.me() || !AL.UI || !AL.UI.toast || (AL.Game && w !== AL.Game.world)) return;
  AL.UI.toast('The new bivouac has settled' + (d.lost ? '; ' + d.lost + ' brood lost on the way.' : '.'), d.lost ? 'bad' : 'good');
});
const mine = (w, d) => d.col === AL.me() && AL.UI && AL.UI.toast && !(AL.Game && w !== AL.Game.world);
AL.on('bivPhase', (w, d) => {
  if (!mine(w, d)) return;
  AL.UI.toast(d.phase === 'nomadic' ? 'The larvae have hatched: the colony starts wandering. It raids hard and moves on along its raid trail.' : 'The larvae have pupated: the colony settles and the queen will lay her next batch.', 'good');
});
AL.on('bivBatch', (w, d) => { if (mine(w, d) && d.n >= 5) AL.UI.toast('The queen is laying a batch of about ' + d.n + ' eggs.', 'good'); });
AL.on('autoMarch', (w, d) => { if (mine(w, d)) AL.UI.toast('The colony moves on along its raid trail.'); });
AL.on('swarmEnd', (w, d) => { if (mine(w, d) && (d.caught || d.brood)) AL.UI.toast('The swarm raid is over: ' + d.caught + ' prey carried home' + (d.brood ? ', ' + d.brood + ' brood eaten' : '') + '.', 'good'); });
AL.on('swarmRaid', (w, d) => {
  if (!AL.UI || !AL.UI.toast || (AL.Game && w !== AL.Game.world)) return;
  if (d.victim === AL.me() && (w.t | 0) % 12 === 0) AL.UI.toast('An army ant swarm is overrunning your nest and eating the brood!', 'bad');
});
AL.on('march', (w, d) => {
  if (d.col === AL.me() || !AL.UI || !AL.UI.toast || (AL.Game && w !== AL.Game.world) || !w.fog) return;
  const c = w.colonies[d.col];
  if (c && w.fog.seenAt(c.x, c.y)) AL.UI.toast('A rival army ant colony is on the march.', 'bad');
});
})(window);
