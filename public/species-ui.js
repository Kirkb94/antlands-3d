// Antlands species UI and art for the added species (browser only): the harvesters' cleared disc, a species
// panel (repletes and honey, seed millers, captives and raids, the named bullet ants), toasts and inspect text.
(function (root) {
'use strict';
const AL = root.AL, UI = AL.UI, C = AL.CASTE;
const G = () => AL.Game;
const live = w => G() && w === G().world && !G().demo;
const throttle = {};
const once = (key, secs, fn) => { const now = performance.now() / 1000; if (throttle[key] && now - throttle[key] < secs) return; throttle[key] = now; fn(); };
const spName = (w, id) => { const c = w.colonies[id]; return c ? (c.id === AL.me() ? 'your own' : c.sp.name.replace(/s$/, '').toLowerCase()) : 'foreign'; };
const fmt = v => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.floor(v);

// ---- art: harvester ants clear a bare, sun-baked disc around the mound ----
AL.registerSystem({
  id: 'species-art', order: 30,
  render: {
    ground(ctx, view, r) {
      const w = r && r.world; if (!w) return;
      for (const c of w.colonies) {
        if (!c.sp.seeds || !c.alive) continue;
        const R = c.moundR * 2.6 + 40;
        if (c.x + R < view.x0 || c.x - R > view.x1 || c.y + R < view.y0 || c.y - R > view.y1) continue;
        if (c.id !== AL.me() && w.fog && !w.fog.seenAt(c.x, c.y)) continue;
        const g = ctx.createRadialGradient(c.x, c.y, R * 0.2, c.x, c.y, R);
        g.addColorStop(0, 'rgba(168,132,86,0.75)'); g.addColorStop(0.75, 'rgba(160,126,82,0.55)'); g.addColorStop(1, 'rgba(150,120,80,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, AL.TAU); ctx.fill();
        // a few pebbles and seed husks on the bare ground
        const Rn = AL.rng(c.id * 97 + 5);
        for (let k = 0; k < 40; k++) {
          const a = Rn() * AL.TAU, d = c.moundR + Rn() * (R - c.moundR) * 0.85;
          ctx.fillStyle = k % 3 ? 'rgba(120,96,66,0.7)' : 'rgba(214,190,140,0.75)';
          ctx.beginPath(); ctx.ellipse(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, 1.4 + Rn() * 1.6, 1 + Rn(), Rn() * 3, 0, AL.TAU); ctx.fill();
        }
      }
    },
  },
});

// ---- the species panel ----
function bar(v, max, col) { return '<i class="bar"><i style="width:' + Math.min(100, max > 0 ? v / max * 100 : 0).toFixed(0) + '%;background:' + col + '"></i></i>'; }
function panel(w) {
  const c = w.player, sp = c.sp, A = w.ants;
  if (sp.repletes) {
    const n = c.pop[C.HONEYPOT], cap = n * AL.TUNE.HONEYPOT_STORE * (sp.honeyStore || 1);
    return '<div data-tip="Repletes: workers swollen with honey, hanging in the food store. Honey never spoils; in lean times it is rationed to the adults and the queen stops laying."><b>Repletes ' + n + '</b> · honey ' + fmt(c.honey || 0) + ' / ' + fmt(cap) + bar(c.honey || 0, cap, '#e9a93a') + '</div>' +
      (c.lean ? '<div class="warn" data-tip="No sugar coming in: the repletes feed the colony and the queen has stopped laying.">Lean times: living on honey</div>' : '<div class="mute small">More repletes swell up once these are full.</div>');
  }
  if (sp.seeds) {
    return '<div data-tip="Harvester ants live on seed. Majors mill stored seed into sugar and protein whenever either runs short; seed never spoils."><b>Seed store ' + fmt(c.stock.seeds) + '</b> · millers ' + c.pop[C.MAJOR] + '</div>' +
      '<div class="mute small">Milled so far: ' + fmt(c.milled || 0) + ' seeds. Grass near the mound keeps shedding seed.</div>';
  }
  if (sp.raider) {
    const by = {}; let n = 0;
    for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === AL.me() && A.caste[i] === C.CAPTIVE) { const h = A.host ? A.host[i] : 0; by[h] = (by[h] || 0) + 1; n++; }
    const pup = c.brood.filter(b => b.caste === C.CAPTIVE).length, st = c.spStats || {};
    const list = Object.keys(by).map(h => by[h] + ' ' + (w.colonies[+h] ? (+h === AL.me() ? 'your own kind' : w.colonies[+h].sp.name.toLowerCase()) : 'foreign')).join(', ');
    return '<div data-tip="Captives hatch from stolen pupae. They forage, dig and nurse; your own sickle-jawed workers only raid. Captives age and die, so keep raiding."><b>Captives ' + n + '</b>' + (list ? ' <span class="mute">(' + list + ')</span>' : '') + '</div>' +
      '<div class="mute small">Stolen pupae in the nursery: ' + pup + ' · raided ' + (st.captured || 0) + '</div>' +
      '<div class="tipline" data-tip="Raid [I]: pick how many go and click a rival mound. Your raiders march, scatter the defenders with propaganda scent and carry pupae home.">Raid: send a Raid [I] onto a rival mound</div>' +
      (n < 6 ? '<div class="warn">Few captives left: raid soon!</div>' : '');
  }
  if (sp.solitary) {
    const ants = [];
    for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === AL.me() && A.caste[i] !== C.QUEEN) ants.push(i);
    ants.sort((a, b) => A.age[b] - A.age[a]);
    let h = '<div data-tip="Bullet ants: few, huge and long-lived. Every one of them counts."><b>' + ants.length + ' hunters</b></div><div class="roster">';
    for (const i of ants.slice(0, 6)) h += '<div class="small">' + AL.Species.nameOf(A.uid[i]) + ' <span class="mute">' + AL.CASTES[A.caste[i]].name.toLowerCase() + ', ' + Math.floor(A.age[i] / 60) + ' min</span>' + bar(A.hp[i], A.maxhp[i], '#c8503a') + '</div>';
    return h + (ants.length > 6 ? '<div class="mute small">+' + (ants.length - 6) + ' more</div>' : '') + '</div>';
  }
  return '';
}
const baseNew = UI.onNewGame;
UI.onNewGame = function (world, opts) {
  if (baseNew) baseNew(world, opts);
  const sp = world.player.sp;
  if (!(opts && opts.demo) && (sp.repletes || sp.seeds || sp.raider || sp.solitary)) UI.addWidget('species', { where: 'left', every: 0.5, html: w => w.player ? panel(w) : '' });
  else UI.removeWidget('species');
};

// ---- toasts ----
AL.on('broodCaptured', (w, d) => { if (live(w) && d.col === AL.me()) once('cap', 12, () => UI.toast('A stolen pupa is in your nursery: it will hatch as a captive ' + spName(w, d.host) + ' worker.', 'good')); });
AL.on('broodStolen', (w, d) => { if (live(w) && d.from === 0) once('stolen-brood', 15, () => UI.toast('Slave-makers are carrying off your brood!', 'bad')); });
AL.on('broodRaid', (w, d) => { if (live(w) && d.target === AL.me()) UI.toast('Slave-maker raid! About ' + d.n + ' raiders are coming for your brood.', 'bad'); });
AL.on('slaveRaid', (w, d) => { if (live(w) && d.col === AL.me()) UI.toast('Slave raid! ' + d.n + ' raiders march on the ' + spName(w, d.target) + ' nest.', 'good'); });
AL.on('captivesLow', (w, d) => { if (live(w) && d.col === AL.me()) UI.toast('Only ' + d.n + ' captives left to do the work. Raid a rival nest for pupae.', 'bad'); });
AL.on('repleteMade', (w, d) => { if (live(w) && d.col === AL.me()) once('replete', 120, () => UI.toast('A worker swelled into a replete: living honey storage.', 'good')); });
AL.on('antDied', (w, d) => {
  if (!live(w) || d.col !== AL.me() || !w.player.sp.solitary || d.caste === C.QUEEN || d.cause === 'age') return;
  once('bullet-' + d.cause, 6, () => UI.toast('One of your bullet ants fell (' + (d.cause === 'fight' ? 'in a fight' : d.cause) + '). Every one counts.', 'bad'));
});

// ---- inspect: captives say whose they are, bullet ants have names ----
const baseClick = UI.click;
UI.click = function (wx, wy, e) {
  baseClick.call(UI, wx, wy, e);
  const w = G().world; if (!w || G().demo) return;
  const A = w.ants, nestView = G().renderer.view === 'nest';
  let best = -1, bd = 14 * 14;
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.layer[i] !== (nestView ? 1 : 0) || (nestView && A.nest[i] !== AL.me())) continue;
    if (A.col[i] !== AL.me() && w.fog && !nestView && !w.fog.visibleAt(A.x[i], A.y[i])) continue;
    const d = AL.dist2(A.x[i], A.y[i], wx, wy); if (d < bd) { bd = d; best = i; }
  }
  if (best < 0) return;
  const tt = document.getElementById('inspect'); if (!tt || tt.hidden) return;
  const col = w.colonies[A.col[best]];
  let extra = '';
  if (A.caste[best] === C.CAPTIVE) extra = 'A ' + spName(w, A.host ? A.host[best] : 0) + ' worker raised from a stolen pupa, working for ' + (col.id === AL.me() ? 'you' : 'the ' + col.sp.name.toLowerCase()) + '.';
  else if (col.sp.solitary && A.caste[best] !== C.QUEEN) extra = 'Name: <b>' + AL.Species.nameOf(A.uid[best]) + '</b>';
  else if (A.carry[best] === AL.CARRY.BROOD) extra = 'Carrying a stolen pupa.';
  if (extra) tt.innerHTML += '<br><span class="mute">' + extra + '</span>';
};
})(window);
