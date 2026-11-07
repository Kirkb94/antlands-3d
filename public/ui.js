// Antlands UI: HUD panels (stocks, population, nest), egg queue, tool palette, speed and view
// controls, tooltips, toasts, widgets for stage modules, title / how-to / pause / game-over screens.
(function (root) {
'use strict';
const AL = root.AL, C = AL.CASTE;
let G = null, t = 0, typed = '';
const $ = id => document.getElementById(id);
const fmt = v => v >= 10000 ? (v / 1000).toFixed(0) + 'k' : v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.floor(Math.max(0, v)).toString();
const widgets = new Map();
const SURFACE_TOOLS = ['look', 'food', 'alarm', 'avoid', 'collect', 'bridge', 'raid', 'send', 'link', 'march', 'swarm', 'erase', 'xrally', 'xflight', 'xtunnel'];
const NEST_TOOLS = ['look', 'dig', 'chamber', 'fill'];
const TOOL_LABEL = { bridge: 'Bridge', raid: 'Raid', send: 'Send', link: 'Link', xrally: 'Rally', xflight: 'Fly queen', xtunnel: 'Tunnel', march: 'March', swarm: 'Swarm raid', look: 'Look', food: 'Food trail', alarm: 'Alarm', avoid: 'Avoid', collect: 'Collect', erase: 'Erase', dig: 'Dig', chamber: 'Chamber', fill: 'Undo' };
const TOOL_KEYS = { bridge: '4', raid: 'I', send: 'O', link: 'P', xrally: 'Y', xflight: 'L', xtunnel: 'K', march: 'B', swarm: 'Z', look: 'Q', food: 'F', alarm: 'R', avoid: 'V', collect: 'T', erase: 'E', dig: 'G', chamber: 'C', fill: 'X' };
const TOOL_SWATCH = { bridge: '#d08a4a', raid: '#ff6a4a', send: '#9fd37a', link: '#c99a62', xrally: '#ff9a5a', xflight: '#f6d77a', xtunnel: '#a0744a', march: '#e0a060', swarm: '#d9784a', food: '#f2c14e', alarm: '#ef5a3c', avoid: '#a77be0', collect: '#e8b04a', erase: '#bbb', dig: '#ffb050', chamber: '#f0e6c8', fill: '#999', look: '#e9dcc0' };

// tool icons: small code-drawn SVGs in the tool's colour (24x24 view box, stroked)
const TOOL_SVG = {
  look: '<path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V10m0-1.5V4a1.5 1.5 0 0 1 3 0v6m0-4.5a1.5 1.5 0 0 1 3 0V12m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.8-2.4L4 14.5a1.6 1.6 0 0 1 2.4-2L8 14"/>',
  food: '<path d="M3 19c3-1 3-5 6-6s4 2 7 0 2-6 5-8"/><circle cx="21" cy="5" r="1.6" fill="currentColor"/><circle cx="3" cy="19" r="1.2" fill="currentColor"/>',
  alarm: '<path d="M12 3l9.5 17h-19z"/><path d="M12 9.5v5"/><circle cx="12" cy="17.3" r=".9" fill="currentColor"/>',
  avoid: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  collect: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="3 2.4"/><circle cx="9.5" cy="10" r="1.6" fill="currentColor"/><circle cx="14.5" cy="11" r="1.3" fill="currentColor"/><circle cx="11.5" cy="15" r="1.5" fill="currentColor"/>',
  march: '<path d="M3 15h12"/><path d="M11 10.5l4.5 4.5-4.5 4.5"/><circle cx="19" cy="15" r="2.4" fill="currentColor"/><path d="M5 9c1-2 3-3 5-3"/>',
  swarm: '<path d="M4 20L12 9l8 11"/><path d="M3 13c3-2 6-3 9-3s6 1 9 3"/><circle cx="8" cy="6" r="1.3" fill="currentColor"/><circle cx="12" cy="4.5" r="1.3" fill="currentColor"/><circle cx="16" cy="6" r="1.3" fill="currentColor"/>',
  erase: '<path d="M14.5 4.5l5 5-9 9h-5l-2.5-2.5z"/><path d="M9 10l5 5"/><path d="M12 20h8"/>',
  dig: '<path d="M14 4l6 6"/><path d="M17 7l-7.5 7.5"/><path d="M9.5 14.5l-3 .5-3 4 1.5 1.5 4-3 .5-3z" fill="currentColor"/>',
  chamber: '<path d="M3 20V12a9 7 0 0 1 18 0v8z"/><path d="M8 20v-4a4 3 0 0 1 8 0v4"/>',
  fill: '<path d="M9 7H15a5 5 0 0 1 0 10H8"/><path d="M11 3.5L7 7l4 3.5"/>',
  raid: '<path d="M4 20l9-9"/><path d="M11 6l7-3-3 7"/><path d="M3 13c2-1 4-1 6 1"/><path d="M14 21c-1-2-1-4 1-6"/><path d="M17 15a4 3 0 0 1 4 4"/>',
  send: '<path d="M3 17a3 2 0 0 1 6 0"/><path d="M15 17a3 2 0 0 1 6 0"/><path d="M6 13c2-5 10-5 12 0"/><path d="M15.5 10.5l2.5 2.5 2.5-2"/>',
  link: '<circle cx="5" cy="7" r="2.6"/><circle cx="19" cy="17" r="2.6"/><path d="M7 9c3 6 7 0 10 6" stroke-dasharray="2.2 2"/>',
  xrally: '<path d="M6 21V4"/><path d="M6 4h11l-2.5 4L17 12H6" fill="currentColor" fill-opacity=".35"/>',
  xflight: '<path d="M12 8c-3-5-8-5-9-3 2 4 5 5 9 5 4 0 7-1 9-5-1-2-6-2-9 3z"/><path d="M12 10v8"/><circle cx="12" cy="19.5" r="1.4" fill="currentColor"/>',
  bridge: '<path d="M2 18c3 0 4 1.5 7 1.5s4-1.5 7-1.5 4 1.5 6 1.5" stroke-opacity=".55"/><path d="M2 13c5-4.5 15-4.5 20 0"/><circle cx="7" cy="10.4" r="1.5" fill="currentColor"/><circle cx="12" cy="9.2" r="1.5" fill="currentColor"/><circle cx="17" cy="10.4" r="1.5" fill="currentColor"/>',
  xtunnel: '<path d="M2 18h20"/><path d="M6 18v-3a6 6 0 0 1 12 0v3"/><path d="M10 18v-2a2 2 0 0 1 4 0v2" fill="currentColor"/>',
};
const toolIcon = id => TOOL_SVG[id] ? '<svg class="ti" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:' + TOOL_SWATCH[id] + '">' + TOOL_SVG[id] + '</svg>' : '<i class="sw" style="background:' + TOOL_SWATCH[id] + '"></i>';
// the UI size factor (CSS --k: the player's UI scale x the phone fit), for canvas icons
const uiK = () => { try { const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1; return v * (innerHeight <= 560 || innerWidth <= 820 ? 0.8 : 1); } catch (e) { return 1; } };

// rich tooltips, built on hover from the current world (so research and perks show up at once)
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch]));
const num = v => v >= 100 ? Math.round(v).toString() : v >= 1 ? (Math.round(v * 10) / 10).toString() : v >= 0.1 ? (Math.round(v * 100) / 100).toString() : v > 0 ? v.toFixed(3) : '0';
const TIP_HTML = {
  caste(el) {
    const w = G && G.world; if (!w || G.demo || !w.player) return null;
    const col = w.player, k = +el.dataset.caste, info = AL.CASTES[k]; if (!info) return null;
    const S = UI.casteStats(col, k), q = col.eggQueue ? col.eggQueue.filter(x => x === k).length : 0;
    const br = col.brood ? col.brood.filter(b => b.caste === k).length : 0;
    const have = 'You have ' + (col.pop[k] || 0) + (br ? ' · ' + br + ' in brood' : '') + (q ? ' · ' + q + ' queued' : '');
    const rows = [
      ['Health', num(S.hp) + (S.tough > 1.01 ? ' <span class="mute">x' + num(S.tough) + ' tough</span>' : '')],
      ['Bite', S.dps > 0 ? num(S.dps) + '/s' : 'none'],
      ['Speed', num(S.speed)],
      ['Sight', num(S.sight)],
      ['Lives', '~' + Math.max(1, Math.round(S.life / 60)) + ' min'],
      ['Eats', num(S.sugarMin) + ' sugar/min'],
      ['Larva', '<span class="protein">' + num(S.prot) + ' protein</span> · <span class="sugar">' + num(S.sug) + ' sugar</span>'],
    ];
    if (k === C.WORKER || k === C.FORAGER || k === C.SCOUT) rows.push(['Carries', num(S.carry) + ' crumb' + (S.carry === 1 ? '' : 's') + ' a trip']);
    if (S.drag > 0 && k !== C.NURSE) rows.push(['Drag', num(S.drag) + ' <span class="mute">pull on big prey</span>']);
    if (k === C.HONEYPOT) rows.push(['Stores', num(S.honey) + ' sugar <span class="mute">never spoils</span>']);
    if (k === C.NURSE) rows.push(['Tends', '8 brood <span class="mute">each, faster growth</span>']);
    return '<div class="tt-h"><b>' + esc(info.name) + '</b><span class="mute">' + esc(have) + '</span></div>' +
      '<div class="tt-p">' + esc(info.tip) + '</div>' +
      '<div class="tt-g">' + rows.map(r => '<span>' + r[0] + '</span><b>' + r[1] + '</b>').join('') + '</div>';
  },
};

// small canvas icon of a caste, drawn from the sprite atlas
function casteIcon(caste, size) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size * 2; cv.className = 'icon';
  cv.style.width = cv.style.height = size + 'px';
  const draw = () => {
    if (UI.icon3d && UI.icon3d(cv, caste)) return;   // the 3D ant model (icons3d.js), else the 2D sprite
    const r = G.renderer; if (!r.atlas) return;
    const sp = r.atlas[0].hi[caste], x = cv.getContext('2d'), k = (size * 2 * 0.95) / sp.cs * (caste === C.QUEEN || caste === C.MAJOR ? 1.45 : 1.9);   // polish: fill the icon (easier to spot)
    x.clearRect(0, 0, cv.width, cv.height);
    x.setTransform(0, -k, k, 0, cv.width / 2, cv.height / 2);
    x.drawImage(sp.img, 0, 0, sp.cs, sp.cs, -sp.cs / 2, -sp.cs / 2, sp.cs, sp.cs);
  };
  draw(); cv._draw = draw;
  return cv;
}

const UI = AL.UI = {
  init(game) {
    G = game;
    AL.Tools.init(game);
    $('tools').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) UI.pickTool(b.dataset.tool); });
    $('speed').addEventListener('click', e => { const b = e.target.closest('[data-speed]'); if (!b) return; const s = +b.dataset.speed; if (s === 0) G.paused = !G.paused; else { G.speed = s; G.paused = false; } UI.syncSpeed(); });
    $('btnView').addEventListener('click', () => G.renderer.toggleView && G.renderer.toggleView());
    $('btnBench').addEventListener('click', () => UI.bench());
    $('btnMenu').addEventListener('click', () => UI.pause(true));
    $('chambers').addEventListener('click', e => { const b = e.target.closest('[data-ch]'); if (!b) return; AL.Tools.chamberType = +b.dataset.ch; AL.Tools.select('chamber'); UI.syncChambers(); });
    $('collectN').addEventListener('click', e => { const b = e.target.closest('[data-n]'); if (!b) return; AL.Tools.collectN = +b.dataset.n; for (const x of $('collectN').children) x.classList.toggle('on', x === b); AL.Tools.select('collect'); });
    $('eggBtns').addEventListener('click', e => { const b = e.target.closest('[data-caste]'); if (!b || !G.world) return; const col = G.world.player; if (!col.eggQueue) return; AL.Cmd.issue('egg', UI.atHome({ caste: +b.dataset.caste }), () => UI.syncQueue()); });
    $('eggQueue').addEventListener('click', e => { const b = e.target.closest('[data-qi]'); if (!b || !G.world) return; AL.Cmd.issue('eggDel', UI.atHome({ i: +b.dataset.qi }), () => UI.syncQueue()); });
    $('eggAuto').addEventListener('change', e => { if (G.world) AL.Cmd.issue('eggAuto', UI.atHome({ on: e.target.checked })); });
    // tooltips for anything with data-tip (data-tip-html="caste" etc. builds a richer one on hover, see TIP_HTML)
    document.addEventListener('pointerover', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) UI.showTip(el); });
    document.addEventListener('pointerout', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) UI.tip(null); });
    // collapsible panels: click a header marked data-fold
    $('eggPanel').querySelector('.ph').dataset.fold = 'eggPanel';
    document.addEventListener('click', e => { const h = e.target.closest && e.target.closest('.ph[data-fold]'); if (!h) return; const p = h.closest('.panel'); if (!p) return; p.classList.toggle('folded'); try { localStorage.setItem('antlands.fold.' + h.dataset.fold, p.classList.contains('folded') ? '1' : '0'); } catch (er) { /* private mode */ } });
    addEventListener('resize', () => UI.layout());
    if (UI.initScreens) UI.initScreens();
    UI.buildTools('surface'); UI.syncSpeed();
  },
  onNewGame(world) {
    $('hud').hidden = false; $('toasts').hidden = false;
    UI.buildEggButtons(); UI.buildChambers(); UI.syncQueue();
    $('eggPanel').hidden = !world.nest; $('btnView').hidden = !world.nest;
    $('eggAuto').checked = world.player.auto !== false;
    // the egg panel starts folded on short screens (phones) unless the player chose otherwise
    let f = null; try { f = localStorage.getItem('antlands.fold.eggPanel'); } catch (e) { /* private mode */ }
    $('eggPanel').classList.toggle('folded', f != null ? f === '1' : innerHeight < 560);
    UI.buildTools('surface'); AL.Tools.select(null);
    if (UI.afterNewGame) UI.afterNewGame(world);
  },
  // ---- tools ----
  buildTools(view) {
    const sp = G.world ? G.world.player.sp : AL.SPECIES.fire;
    const nc = view === 'nest' && G.renderer && G.renderer.nestCol, other = nc && nc.id !== (G.world ? G.world.me || 0 : 0);   // a rival's nest: look only (renderer.setNestCol); your satellites' work like yours
    const list = (other ? ['look'] : view === 'nest' ? NEST_TOOLS : SURFACE_TOOLS).filter(id => (id === 'look' || AL.Tools.TOOLS[id]) && !((id === 'march' || id === 'swarm') && !sp.nomad) && !(id === 'dig' && !sp.dig) && !((id === 'chamber' || id === 'fill') && sp.nomad) && UI.toolAvailable(id));
    UI._toolSig = UI.toolSig();
    $('tools').innerHTML = list.map(id => {
      const tl = AL.Tools.TOOLS[id], tip = id === 'look' ? 'Look: drag to pan, wheel or pinch to zoom.' : tl.name + ': ' + tl.tip;
      return '<button data-tool="' + id + '" data-tip="' + tip.replace(/"/g, '&quot;') + ' [' + TOOL_KEYS[id] + ']">' + toolIcon(id) + '<span class="lbl">' + TOOL_LABEL[id] + '</span><kbd>' + TOOL_KEYS[id] + '</kbd></button>';
    }).join('');
    $('tools').classList.toggle('compact', list.length > 7 || UI._compactW === innerWidth);
    UI.view = view;
    $('chambers').hidden = true; $('collectN').hidden = true;
    UI.onTool(AL.Tools.current);
  },
  // expansion tools appear once they can be used (a winged queen waiting, tunnelling researched)
  toolAvailable(id) {
    const w = G.world, c = w && w.player, X = AL.Expansion;
    if (id === 'xflight') return !!(c && c.royal && (c.royal.queens > 0 || (c.satellites && c.satellites.length)));
    if (id === 'xtunnel') return !!(c && c.research && c.research.tunnel >= 1);
    if (id === 'xrally') return !!(w && w.exp);
    if (id === 'link') return !!(c && c.mods && c.mods.nestlink);
    return true;
  },
  toolSig() { return ['xflight', 'xtunnel', 'xrally', 'link'].map(id => UI.toolAvailable(id) ? 1 : 0).join(''); },
  pickTool(id) {
    const tl = AL.Tools.TOOLS[id];
    if (id === 'look' || !tl) { AL.Tools.select(null); return; }
    if ((tl.layer === 'nest') !== (UI.view === 'nest')) { if (G.renderer.toggleView) G.renderer.toggleView(); }
    AL.Tools.select(id);
  },
  onTool(tool) {
    for (const b of document.querySelectorAll('#tools [data-tool]')) b.classList.toggle('on', (tool ? tool.id : 'look') === b.dataset.tool);
    $('chambers').hidden = !(tool && tool.id === 'chamber');
    $('collectN').hidden = !(tool && tool.id === 'collect');
    if (UI.onPartyTool) UI.onPartyTool(tool);   // raids-ui.js: the Raid / Send sliders
    $('cv').style.cursor = tool ? 'crosshair' : 'grab';
  },
  onView(view) {
    UI.buildTools(view);
    if (AL.Tools.current && (AL.Tools.current.layer === 'nest') !== (view === 'nest')) AL.Tools.select(null);
    $('btnView').textContent = view === 'nest' ? 'Surface [Tab]' : 'Nest [Tab]';
    const oc = view === 'nest' && G.renderer && G.renderer.nestCol;
    if (oc && UI.toast) UI.toast(oc.sat && oc.id === (G.world.me || 0) ? 'Your satellite nest: its own queen, brood and food store. The egg queue and nest tools work on it while you are here.' : 'Inside the ' + oc.sp.name.toLowerCase() + ' nest. Tab or scroll out to go back up.');
    $('btnView').classList.toggle('on', view === 'nest');
    if (UI.hintEvent) UI.hintEvent('view:' + view);
    UI.syncQueue();   // (the egg queue follows the nest in focus)
  },
  buildChambers() {
    const pl = G.world && G.world.player;
    $('chambers').innerHTML = AL.Nest ? AL.Nest.CH_INFO.map((c, k) => c && (k !== AL.Nest.CH.FUNGUS || (pl && pl.sp.fungus)) && (k !== AL.Nest.CH.APHID || (pl && pl.mods && pl.mods.rootAphids)) ? '<button data-ch="' + k + '" data-tip="' + c.name + ': ' + c.tip + '"><i class="sw" style="background:' + c.col + '"></i>' + c.name.replace(' chamber', '').replace(' reservoir', '') + '</button>' : '').join('') : '';
    UI.syncChambers();
  },
  syncChambers() { for (const b of $('chambers').children) b.classList.toggle('on', +b.dataset.ch === AL.Tools.chamberType); },
  // ---- egg queue ----
  buildEggButtons() {
    const el = $('eggBtns'); el.innerHTML = '';
    for (const caste of AL.EGG_CASTES) {
      const info = AL.CASTES[caste], b = document.createElement('button');
      b.dataset.caste = caste;
      const prot = Math.round(info.prot * ((G.world && G.world.player.sp.broodCost) || 1));
      b.dataset.tip = info.name + ': ' + info.tip + ' Larva needs ' + prot + ' protein.';
      b.dataset.tipHtml = 'caste'; b.dataset.tipSide = 'left';   // hover shows this colony's stats for the caste (TIP_HTML.caste)
      b.appendChild(casteIcon(caste, Math.round(28 * uiK())));
      const s = document.createElement('span'); s.innerHTML = info.name + '<small>' + prot + 'p</small>'; b.appendChild(s);
      el.appendChild(b);
    }
  },
  // the nest the HUD, the egg queue and your orders are about: the one of yours on view in the nest view, else the
  // one picked in the nest tabs (nest-switch.js; your capital when you have no satellites)
  focus(w) {
    w = w || G.world; if (!w) return null;
    const r = G.renderer, me = w.me || 0;
    if (r && r.view === 'nest') { const on = r.nestCol; if (!on) return w.player; if (on.sat && on.id === me && !on.gone) return on; }
    return (UI.picked && UI.picked(w)) || w.player;
  },
  atHome(a) { const f = UI.focus(); if (f && f.sat) a.h = f.hid; return a; },   // commands for the nest in focus
  syncQueue() {
    const w = G.world, fc = UI.focus(w); if (!w || !fc || !fc.eggQueue) return;
    const q = fc.eggQueue;
    $('eggAuto').checked = fc.auto !== false;
    $('eggQueue').innerHTML = q.length ? '' : '<span class="mute">Empty: the queen lays ' + (fc.auto ? 'a balanced mix' : 'nothing') + '.</span>';
    q.forEach((caste, k) => { const s = document.createElement('span'); s.className = 'qi'; s.dataset.qi = k; s.dataset.tip = AL.CASTES[caste].name + ' (click to remove)'; s.appendChild(casteIcon(caste, Math.round(22 * uiK()))); $('eggQueue').appendChild(s); });
  },
  // ---- misc ----
  showPerf(on) { $('perf').hidden = !on; },
  syncSpeed() { for (const b of document.querySelectorAll('#speed [data-speed]')) { const s = +b.dataset.speed; b.classList.toggle('on', s === 0 ? G.paused : (!G.paused && G.speed === s)); } },
  // text is shown as plain text; with html set it is trusted markup (build it with esc() for any text in it)
  tip(text, el, html) {
    const tt = $('tooltip');
    if (!text) { tt.hidden = true; UI._tipEl = null; return; }
    if (html) tt.innerHTML = text; else tt.textContent = text;
    tt.hidden = false; UI._tipEl = el;
    const r = el.getBoundingClientRect(), w = Math.min(320, innerWidth - 20);
    tt.style.maxWidth = w + 'px';
    const ttr = tt.getBoundingClientRect();
    let x = r.left + r.width / 2 - ttr.width / 2, y = r.top - ttr.height - 8;
    if (y < 8) y = r.bottom + 8;
    // data-tip-side="left": beside the panel instead, so the buttons next to it stay in view (the egg panel)
    const pr = el.dataset.tipSide === 'left' && (el.closest('.panel') || el).getBoundingClientRect();
    if (pr && pr.left - ttr.width - 8 >= 8) { x = pr.left - ttr.width - 8; y = r.top + r.height / 2 - ttr.height / 2; }
    tt.style.left = AL.clamp(x, 8, innerWidth - ttr.width - 8) + 'px'; tt.style.top = AL.clamp(y, 8, Math.max(8, innerHeight - ttr.height - 8)) + 'px';
  },
  // the tooltip for an element: its rich one (data-tip-html) if it can be built now, else data-tip as text
  showTip(el) {
    const f = el.dataset.tipHtml && TIP_HTML[el.dataset.tipHtml];
    let h = null; if (f) try { h = f(el); } catch (e) { console.error(e); }
    if (h) UI.tip(h, el, true); else UI.tip(el.dataset.tip, el);
  },
  // what an ant of caste k of colony col is like right now: species x research x perk (read-only, UI only)
  casteStats(col, k) {
    const info = AL.CASTES[k], sp = col.sp || {}, cs = AL.Combat && AL.Combat.stat ? AL.Combat.stat(col, k) : null;
    const hpMul = AL.Research && AL.Research.hpMul ? AL.Research.hpMul(col, k) : 1;   // research hp lands on each ant's maxhp
    const up = AL.Colony && AL.Colony.casteUpkeep ? AL.Colony.casteUpkeep(sp, k) : 1;
    return {
      hp: (cs ? cs.hp : info.hp * (sp.hp || 1)) * (k === C.QUEEN ? 1 : hpMul),
      tough: cs ? cs.tough : 1,
      dps: cs ? cs.dps : info.dps * (sp.dps || 1),
      speed: info.speed * (sp.speed || 1),
      life: info.life * (sp.life || 1),
      sugarMin: up * AL.TUNE.SUGAR_PER_ANT * (sp.appetite || 1) * 60,
      prot: info.prot * (sp.broodCost || 1), sug: info.sug,
      carry: sp.carry || 1, drag: info.drag * (sp.size || 1),
      sight: info.vis * AL.TUNE.FOG_CELL,
      honey: AL.TUNE.HONEYPOT_STORE * (sp.honeyStore || 1),
    };
  },
  key(e) {
    const c = e.code;
    if (G.scene && G.scene.key) { G.scene.key(e); return; }
    if (UI.screenKey && UI.screenKey(e)) return;
    if (!G.world) return;
    if (c.startsWith('Key')) { typed = (typed + c.slice(3)).slice(-5); if (typed === 'BENCH') { typed = ''; UI.bench(); return; } }
    if (c === 'Space') { G.paused = !G.paused; UI.syncSpeed(); e.preventDefault(); }
    else if (c === 'Digit1') { G.speed = 1; G.paused = false; UI.syncSpeed(); }
    else if (c === 'Digit2') { G.speed = 2; G.paused = false; UI.syncSpeed(); }
    else if (c === 'Digit3') { G.speed = 4; G.paused = false; UI.syncSpeed(); }
    else if (c === 'Tab' || c === 'KeyN') { if (G.renderer.toggleView) G.renderer.toggleView(); e.preventDefault(); }
    else if (c === 'KeyH') G.renderer.showTrails = !G.renderer.showTrails;
    else if (c === 'KeyU') { if (UI.toggleRecall) UI.toggleRecall(); }
    else if (c === 'KeyM') { if (AL.Audio) AL.Audio.toggle(); }
    else if (c === 'Equal' || c === 'NumpadAdd') AL.Input.zoomTo(G.renderer.activeCam().z * 1.25);
    else if (c === 'Minus' || c === 'NumpadSubtract') AL.Input.zoomTo(G.renderer.activeCam().z / 1.25);
    else if (c === 'Backquote' || c === 'F3') { UI.showPerf($('perf').hidden); e.preventDefault(); }
    else if (c === 'F9') { UI.bench(); e.preventDefault(); }
    else if (c === 'Escape') { if (AL.Tools.current) AL.Tools.select(null); else UI.pause(true); }
    else if (c === 'KeyQ') AL.Tools.select(null);
    else for (const id in TOOL_KEYS) if (id[0] !== 'x' && ('Key' + TOOL_KEYS[id] === c || 'Digit' + TOOL_KEYS[id] === c) && AL.Tools.TOOLS[id]) { UI.pickTool(id); break; }   // x* tools bind their own keys
  },
  // click in Look mode: describe what's under the cursor
  click(wx, wy, e) {
    const w = G.world; if (!w || G.demo) return;
    const r = G.renderer, nestView = r.view === 'nest', A = w.ants;
    let best = -1, bd = 14 * 14;
    for (let i = 0; i < A.high; i++) {
      if (!A.state[i] || A.layer[i] !== (nestView ? 1 : 0) || (nestView && A.nest[i] !== AL.me())) continue;
      if (A.col[i] !== AL.me() && w.fog && !nestView && !w.fog.visibleAt(A.x[i], A.y[i])) continue;
      const d = AL.dist2(A.x[i], A.y[i], wx, wy); if (d < bd) { bd = d; best = i; }
    }
    let html = '';
    if (best >= 0) {
      const info = AL.CASTES[A.caste[best]], col = w.colonies[A.col[best]];
      const what = { 1: 'searching for food', 2: 'carrying food home', 3: 'answering a recruit call', 4: 'rallying to the alarm', 5: 'fighting', 6: 'dragging prey', 7: 'hauling soil out', 8: 'on guard', 9: 'raiding', 10: 'heading home', 11: 'going home to heal', 20: 'resting', 21: 'on an errand', 22: 'digging', 23: 'tending brood', 24: 'storing honey', 25: 'laying eggs', 26: 'raiding the nest', 27: 'healing its wounds' }[A.state[best]] || '';
      // polygyne colonies: say which queen this is
      const nq = A.caste[best] === C.QUEEN && AL.Life && AL.Life.queenCount ? AL.Life.queenCount(col) : 0;
      const qn = nq > 1 ? (col.queen.i === best ? ' (main queen, one of ' + nq + ')' : ' (an extra laying queen, one of ' + nq + ')') : '';
      const hurt = AL.Injury ? AL.Injury.describe(w, best) : '';   // lost legs / head (injury.js)
      const doing = A.headless[best] ? 'wandering blindly' : what;
      html = '<b>' + (col.id === AL.me() ? 'Your ' : col.isPlayer && col.name ? col.name + '\'s ' : 'Rival ') + info.name.toLowerCase() + '</b> · ' + doing + qn + (hurt ? '<br><span class="bad">' + hurt + '</span>' : '') + '<br><span class="mute">' + Math.round(A.hp[best]) + '/' + Math.round(A.maxhp[best]) + ' hp · age ' + Math.floor(A.age[best] / 60) + ' of ~' + Math.floor(A.life[best] / 60) + ' min</span>';
      if (A.caste[best] !== C.QUEEN) { const S = UI.casteStats(col, A.caste[best]); html += '<br><span class="mute">' + (S.dps > 0 && !A.headless[best] ? 'bite ' + num(S.dps) + '/s · ' : '') + 'speed ' + num(S.speed * (AL.Injury ? AL.Injury.speedMul(w, best) : 1)) + ' · eats ' + num(S.sugarMin) + ' sugar/min</span>'; }
      // its stomach (people's colonies: every ant eats at the food store, hunger.js)
      if (col.isPlayer && col.nest && A.gut && AL.HUNGER) { const g = A.gut[best]; html += '<br><span class="' + (g < AL.HUNGER.HUNGRY ? 'warn' : 'mute') + '">' + (g <= 0 ? 'starving' : g < AL.HUNGER.HUNGRY ? 'hungry · fed ' + Math.round(g * 100) + '%' : 'fed ' + Math.round(g * 100) + '%') + (A.load && A.load[best] > 0 ? ' · carrying food to the ' + (A.act[best] === AL.ACT.FEEDQ ? 'queen' : 'brood') : '') + '</span>'; }
    } else if (!nestView) {
      const f = w.surface.foods.find(f => !f.gone && f.amount >= 1 && AL.dist2(f.x, f.y, wx, wy) < (f.r + 12) * (f.r + 12) && (!w.fog || w.fog.seenAt(f.x, f.y)));
      if (f) {
        const kind = AL.RES[f.kind] || 'food';
        const name = { fruit: 'Fallen apple', beetle: 'Dead insect', cookie: 'Cookie crumbs', ham: 'Picnic ham', honeydew: 'Aphids on a plant (honeydew)', water: 'Puddle', seeds: 'Seed heads', leaves: 'Clover', corpse: 'Dead ants', bug: 'Dead bug', crumb: 'Crumbs' }[f.visual] || 'Food';
        html = '<b>' + name + '</b> · ' + Math.floor(f.amount) + ' ' + kind + (f.big ? '<br><span class="mute">Needs ' + f.needed + '+ carriers to drag (' + f.carriers + ' on it); otherwise it gets cut up crumb by crumb.</span>' : '') + (f.visual === 'fruit' && f.rot > 0.3 ? '<br><span class="mute">Rotting</span>' : '') + (f.poi && f.poi.aphids != null ? '<br><span class="mute">' + Math.round(f.poi.aphids) + ' aphids. Ladybugs eat them.</span>' : '');
      }
    } else if (w.nest) {
      const N = AL.Nest, n = w.nest, t = N.tileOf(n, wx, wy), k = n.kind[t];
      const names = ['Tunnel', 'Topsoil', 'Clay', 'Gravel (can cave in)', 'Rock (can\'t dig)', 'Root (can\'t dig)', 'Wood'];
      html = '<b>' + (n.chamber[t] && k === 0 ? N.CH_INFO[n.chamber[t]].name : names[k]) + '</b>' + (k && N.HARD[k] !== Infinity ? '<br><span class="mute">Dig effort x' + N.HARD[k] + '</span>' : '') + (((t / n.cols) | 0) >= n.waterTable ? '<br><span class="water">Below the water table: floods when dug</span>' : '');
    }
    const tt = $('inspect');
    if (!html) { tt.hidden = true; return; }
    tt.innerHTML = html; tt.hidden = false;
    tt.style.left = Math.min(innerWidth - 260, (e ? e.clientX : innerWidth / 2) + 14) + 'px'; tt.style.top = Math.max(8, (e ? e.clientY : 100) - 10) + 'px';
    clearTimeout(UI._insT); UI._insT = setTimeout(() => { tt.hidden = true; }, 4000);
  },
  pause(on) { if (UI.showPause) UI.showPause(on); else G.paused = on; UI.syncSpeed(); },
  // dev: top the yard up to 5,000 ants and show the perf readout
  bench() {
    const w = G.world; if (!w) return;
    const need = 5000 - w.ants.count;
    if (need > 0) AL.Sim.spawnBench(w, need);
    if (G.renderer.view === 'nest') { G.renderer.view = 'surface'; UI.onView('surface'); }
    G.renderer.cam.x = w.player.x + 250; G.renderer.cam.y = w.player.y - 200; G.renderer.cam.z = 1.6;
    AL.Tools.select(null); UI.showPerf(true);
  },
  toast(text, kind) {
    const el = document.createElement('div'); el.className = 'toast ' + (kind || ''); el.textContent = text;
    $('toasts').appendChild(el); setTimeout(() => el.classList.add('out'), 3600); setTimeout(() => el.remove(), 4200);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  },
  // keep the HUD from overlapping itself: bottom bar right of the Royal chamber, side columns end above the
  // bottom bar / Royal chamber (extra panels scroll inside the column), toasts under the top bar
  layout() {
    const H = innerHeight, Wd = innerWidth, M = 8, bot = $('bottom'), hud = $('hud');
    if (!bot || !hud || hud.hidden) return;
    const vis = el => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).display !== 'none' ? r : null; };
    const royal = vis(document.getElementById('exp-royal'));
    const r0 = bot.getBoundingClientRect(), bw = r0.width, nat = Wd / 2 - bw / 2;   // where the centred bar would sit
    let shift = 0;
    if (royal && nat < royal.right + M && r0.bottom > royal.top) shift = Math.max(0, Math.min(royal.right + M - nat, Wd - M - (nat + bw)));
    // still overlapping the Royal chamber panel (wide tool labels on a 1280px screen): drop the labels.
    // Sticky until the window is resized, so it doesn't flip back and forth as the bar shrinks.
    const tl = $('tools');
    if (tl && royal && nat + shift < royal.right + M && r0.bottom > royal.top && !tl.classList.contains('compact')) { tl.classList.add('compact'); UI._compactW = Wd; return; }
    const want = shift ? 'calc(50% + ' + Math.round(shift) + 'px)' : '50%';
    if (bot.style.left !== want) bot.style.left = want;
    const br = { left: nat + shift, right: nat + shift + bw, top: r0.top };
    for (const id of ['left', 'right']) {
      const col = $(id), cr = col.getBoundingClientRect();
      let lim = H - M;
      const block = r => { if (r && r.left < cr.right && r.right > cr.left) lim = Math.min(lim, r.top - M); };
      block(br); if (id === 'left') block(royal);
      col.style.maxHeight = Math.max(80, lim - cr.top) + 'px';
    }
    const tb = $('topbar').getBoundingClientRect();
    $('toasts').style.top = Math.round(tb.height > 4 ? tb.bottom + 8 : 58) + 'px';
  },
  addWidget(id, w) { widgets.set(id, Object.assign({ where: 'left', every: 0.5, acc: 99 }, w)); },
  removeWidget(id) { widgets.delete(id); const el = $('w-' + id); if (el) el.remove(); },
  // ---- per frame ----
  frame(w, dt) {
    for (const [id, wd] of widgets) {
      wd.acc += dt; if (wd.acc < wd.every) continue; wd.acc = 0;
      let el = $('w-' + id); if (!el) { el = document.createElement('div'); el.id = 'w-' + id; el.className = 'panel widget'; $(wd.where === 'right' ? 'right' : wd.where === 'top' ? 'topbar' : 'left').appendChild(el); }
      try { el.innerHTML = wd.html(w); } catch (e) { console.error(e); }
    }
    if (UI.frameExtra) UI.frameExtra(w, dt);
    t += dt; if (t < 0.25) return; t = 0;
    // a rich tooltip that is up keeps its numbers current (queue, population, finished research)
    const te = UI._tipEl;
    if (te && te.dataset.tipHtml && !$('tooltip').hidden) { if (te.isConnected) UI.showTip(te); else UI.tip(null); }
    if (UI.view !== 'nest' && UI._toolSig !== UI.toolSig()) UI.buildTools(UI.view || 'surface');
    UI.layout();
    const col = UI.focus(w) || w.player, s = col.stock, cap = col.cap || {}, P = G.perf;   // (a satellite's own numbers while you look into its nest)
    const sugarFlow = c => {
      const F = c.sugarFlow; if (!F || F.n < 5) return '';
      const net = F.inMin - F.outMin, left = net < -0.2 ? c.stock.sugar / -net : Infinity;
      const cls = left < 2 ? 'bad' : net < -0.2 ? 'warn' : 'good';
      return '<div class="flow ' + cls + '" data-tip="Sugar per minute: brought home (+) and eaten by ants, larvae and the queen, or spoiled (-)' + (left < 60 ? '. At this rate it runs out in about ' + Math.max(1, Math.round(left)) + ' min.' : '.') + ' Aphid plants and flowers refill; crumbs and fruit run out.">+' + F.inMin.toFixed(0) + ' / -' + F.outMin.toFixed(0) + ' per min' + (left < 60 ? ' · ' + (left < 1 ? '<1' : Math.round(left)) + ' min left' : '') + '</div>';
    };
    const bar = (v, c) => c ? '<i class="bar"><i style="width:' + Math.min(100, v / c * 100).toFixed(0) + '%"></i></i>' : '';
    const food = s.sugar + s.protein + s.seeds;
    // repletes (honeypot ants): sugar above HONEY_KEEP is banked in their crops as col.honey (species.js honeyFlow)
    const honeyRes = () => {
      if (!col.sp.repletes) return '';
      const hc = cap.honey != null ? cap.honey : (col.pop[C.HONEYPOT] || 0) * AL.TUNE.HONEYPOT_STORE * (col.sp.honeyStore || 1), CF = AL.Species && AL.Species.CFG || {};
      return '<div class="res honey" data-tip="Honey held in the crops of ' + (col.pop[C.HONEYPOT] || 0) + ' repletes. Sugar above ' + (CF.HONEY_KEEP || 35) + ' is banked here until they are full; it never spoils. When sugar drops below ' + (CF.HONEY_LOW || 15) + ' they feed it back, rationed: the adults eat, but the queen stops laying."><b>' + fmt(col.honey || 0) + '</b><span class="hc">/' + fmt(hc) + '</span><span class="rl">honey</span></div>';
    };
    // the food the foragers are favouring (behavior.js needs: the short one, when the other is plentiful)
    const nd = AL.Behavior && AL.Behavior.needs ? AL.Behavior.needs(w, col, true) : null, NG = AL.Behavior && AL.Behavior.NEED;
    const fav = k => { if (!nd || !NG) return ''; const o = nd[k === 'sugar' ? 'protein' : 'sugar']; return o <= 0.25 && nd[k] >= o + NG.GAP ? ' wanted' : ''; };
    const wantTip = k => fav(k) ? ' Short of ' + k + ': many foragers walk past other food to look for it.' : '';
    $('stocks').innerHTML =
      '<div class="res sugar' + fav('sugar') + '" data-tip="Sugar feeds every adult ant. Honeypots store it without spoiling.' + wantTip('sugar') + '"><b>' + fmt(s.sugar) + '</b><span class="rl">sugar</span></div>' +
      honeyRes() + sugarFlow(col) +
      '<div class="res protein' + fav('protein') + '" data-tip="Protein is needed to raise every larva. It spoils over time.' + wantTip('protein') + '"><b>' + fmt(s.protein) + '</b><span class="rl">protein</span></div>' +
      '<div class="res water" data-tip="Water keeps brood healthy. Water reservoirs store it."><b>' + fmt(s.water) + '</b><span class="rl">water</span>' + bar(s.water, cap.water) + '</div>' +
      '<div class="res seeds" data-tip="Seeds keep well and are eaten when sugar runs low."><b>' + fmt(s.seeds) + '</b><span class="rl">seeds</span></div>' +
      (col.sp.fungus ? '<div class="res leaves" data-tip="Leaves feed the fungus garden."><b>' + fmt(s.leaves) + '</b><span class="rl">leaves</span></div><div class="res fungus" data-tip="Fungus: food grown from leaves."><b>' + fmt(s.fungus) + '</b><span class="rl">fungus</span></div>' : '') +
      '<div class="res soil" data-tip="Soil dug out of the nest, piled on the mound. A bigger mound keeps the nursery warm."><b>' + fmt(col.moundSoil) + '</b><span class="rl">soil</span></div>' +
      (cap.food ? '<div class="store" data-tip="Food store use: sugar + protein + seeds against store capacity. Over capacity it spoils fast.">Store ' + fmt(food) + ' / ' + fmt(cap.food) + bar(food, cap.food) + (col.spoilRate > 0.05 ? ' <em>spoiling</em>' : '') + '</div>' : '');
    const pop = col.pop, total = pop.reduce((a, b) => a + b, 0);
    let ph = '<div class="poptot" data-tip="Adults in the colony (outside / in the nest)"><b>' + total + '</b> ants <span class="mute">' + col.surf + ' out · ' + col.inNest + ' in</span></div><div class="castes">';
    for (const k of [C.WORKER, C.FORAGER, C.SCOUT, C.SOLDIER, C.MAJOR, C.NURSE, C.HONEYPOT]) if (pop[k]) ph += '<span data-tip="' + AL.CASTES[k].name + 's">' + AL.CASTES[k].name.slice(0, 3) + ' <b>' + pop[k] + '</b></span>';
    $('pop').innerHTML = ph + '</div>';
    if (w.nest) {
      const n = col.nest || w.nest, b = col.brood, eggs = b.filter(x => x.stage === 0).length, lar = b.filter(x => x.stage === 1).length, pup = b.length - eggs - lar;
      const bf = col.broodF ? Math.round(col.broodF.total * 100) : 100, temp = n.nurseryTemp;
      $('nestStats').innerHTML =
        '<div data-tip="Eggs / larvae / pupae. Larvae need protein to grow.">Brood <b>' + eggs + '</b>·<b>' + lar + '</b>·<b>' + pup + '</b> <span class="mute">of ' + (cap.nursery || 0) + '</span></div>' +
        (col.sp.polygyne && AL.Life ? '<div data-tip="Laying queens in the queen chamber. Each one lays into the same nursery. Keep a winged queen at home from the Royal chamber; a big colony also takes in new queens by itself.">Queens <b>' + AL.Life.queenCount(col) + '</b> <span class="mute">of ' + AL.Life.maxQueens(col) + '</span></div>' : '') +
        '<div data-tip="Brood grows fastest around 27°C. A bigger mound and shallow nursery are warmer.">Nursery <b class="' + (temp < 22 || temp > 32 ? 'warn' : '') + '">' + temp.toFixed(1) + '°C</b> · speed <b>' + bf + '%</b></div>' +
        '<div data-tip="Bodies in tunnels and an overfull midden spread disease. Above 50% brood slows; above 75% ants sicken.">Disease <i class="bar dis"><i style="width:' + col.disease.toFixed(0) + '%"></i></i></div>' +
        (n.caps && n.caps.aphid ? '<div data-tip="Root aphids in the root-aphid chamber: foragers bring them from wild aphid plants; they breed up to the chamber\'s size and their honeydew goes into the sugar store.">Aphids <b>' + Math.floor(col.aphids || 0) + '</b> <span class="mute">of ' + n.caps.aphid + ' · +' + Math.round((col._honeydew || 0) * 60) + ' sugar/min</span></div>' : '') +
        (n.digCount ? '<div class="mute">Digging ' + n.digCount + ' tiles · ' + (n.diggers || 0) + ' diggers</div>' : '') +
        (s.water < (cap.water || 20) * 0.3 ? '<div class="tipline" data-tip="Water keeps brood healthy. Without a reservoir you can only hold a little.">Low water: dig a Water room to store more.</div>' : '') +
        (col.broodFood ? '<div data-tip="Nurses carry food from the store to the larvae (and to the queen, who lays only when fed). With no nurses, workers do it.">Larva food <b>' + fmt(col.broodFood.sugar) + '</b> sugar · <b>' + fmt(col.broodFood.protein) + '</b> protein</div>' : '') +
        (col.hunger && col.hunger.hungry ? '<div class="' + (col.hunger.empty ? 'warn' : 'mute') + '" data-tip="Every ant has its own stomach and eats sugar at the food store. An ant with an empty stomach weakens and dies.">Hungry ants <b>' + col.hunger.hungry + '</b>' + (col.hunger.empty ? ' · starving <b>' + col.hunger.empty + '</b>' : '') + '</div>' : '') +
        (col.starving ? '<div class="warn">Starving! Find sugar.</div>' : '');
      $('stocks').classList.toggle('starving', !!col.starving);
      $('broodN').textContent = b.length;
    }
    // day / season clock (the World stage drives env; without it it's a mild spring day)
    const env = w.env, tod = env.timeOfDay == null ? 0.35 : env.timeOfDay, hh = Math.floor(tod * 24), mm = Math.floor((tod * 24 - hh) * 60);
    const season = (env.season || 'spring'); $('clock').hidden = !!AL.World;
    $('clock').innerHTML = '<b>Day ' + (env.day || 1) + '</b> · ' + season[0].toUpperCase() + season.slice(1) + ' · ' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + (env.rain > 0.1 ? ' · <span class="water">rain</span>' : '') + (env.heat > 0.3 ? ' · <span class="warn">heat</span>' : '') + ' · <span class="mute">' + Math.floor(w.t / 60) + ' min</span>';
    if (UI.clock) UI.clock(w);
    if (!$('perf').hidden) $('perf').textContent = 'fps ' + P.fps.toFixed(1) + ' (avg ' + (P.samples.length ? P.samples.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, P.samples.length) : 0).toFixed(1) + ')\nworst frame ' + (P.worstMs || 0).toFixed(0) + ' ms\nants ' + w.ants.count + ' drawn ' + G.renderer.stats.drawn + (w.lod ? ' LOD' : '') + '\nsim ' + P.simMs.toFixed(2) + ' ms render ' + P.renderMs.toFixed(2) + ' ms\nzoom ' + G.renderer.activeCam().z.toFixed(2) +
      '\n1% low ' + (P.low1 || 0).toFixed(0) + ' fps  hitches ' + (P.hitches || 0) + '/s' + (AL.R3D && AL.R3D.enabled && AL.R3D.stats ? '\n' + AL.R3D.stats() : '');
    // egg queue shrinks as the queen lays
    if (col.eggQueue && col.eggQueue.length !== UI._ql) { UI._ql = col.eggQueue.length; UI.syncQueue(); }
  },
};
})(window);
