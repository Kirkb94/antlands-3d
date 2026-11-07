// The Wildlife panel: a census of the yard's creatures (eco.js), how well fed each kind is, and their young.
// Click the heading to fold it. Browser only.
(function (root) {
'use strict';
const AL = root.AL;
let folded = false;
try { folded = localStorage.getItem('antlands.ecoFold') === '1'; } catch (e) { /* storage off: open */ }
const ROWS = [
  { k: 'spider', name: 'Wolf spiders', young: c => (c.n.eggsac ? c.n.eggsac + ' egg sac' + (c.n.eggsac > 1 ? 's' : '') : ''), tip: 'Hunt lone ants (and, when hungry, ladybugs and caterpillars). A well-fed spider guards an egg sac; spiderlings set up new lairs.' },
  { k: 'beetle', name: 'Ground beetles', young: c => (c.n.clutch.beetle ? c.n.clutch.beetle + ' in the soil' : ''), tip: 'Scavenge the dead (your ants\' carcasses too) and the leaf litter, and eat caterpillars. A hungry beetle goes for ants. Fed beetles lay eggs in the soil.' },
  { k: 'ladybug', name: 'Ladybugs', young: c => [c.n.lblarva ? c.n.lblarva + ' larva' + (c.n.lblarva > 1 ? 'e' : '') : '', c.n.clutch.ladybug ? c.n.clutch.ladybug + ' eggs' : ''].filter(Boolean).join(', '), tip: 'Eat your aphids. They lay eggs on the plant and their larvae eat aphids too. Chase them off to keep the honeydew.' },
  { opt: 1, k: 'centipede', name: 'Centipedes', young: c => (c.n.clutch.centipede ? c.n.clutch.centipede + ' eggs in the soil' : ''), tip: 'Night hunters: by day they hide under the litter; after dark they run down ants out in the open. A starving one comes out in daylight too.' },
  { opt: 1, k: 'antlion', name: 'Antlions', young: c => (c.n.clutch.antlion ? c.n.clutch.antlion + ' eggs in the sand' : ''), tip: 'Sit at the bottom of a sand pit. Ants that step in slide down to the jaws. A hungry antlion digs a wider pit. Kill it to fill the pit.' },
  { opt: 1, k: 'assassin', name: 'Assassin bugs', young: c => (c.n.clutch.assassin ? c.n.clutch.assassin + ' eggs' : ''), tip: 'Wait beside busy ant trails, still as a twig, and stab whatever walks past. A hungry one creeps up on ants.' },
  { opt: 1, k: 'mantis', name: 'Praying mantises', young: c => (c.n.clutch.mantis ? c.n.clutch.mantis + ' egg cases' : ''), tip: 'Perch on plants (aphid plants most of all) and snatch ants, ladybugs and butterflies that come in reach. Mobbed, they fly to another plant.' },
  { k: 'caterpillar', name: 'Caterpillars', young: c => [c.n.cocoon ? c.n.cocoon + ' cocoon' + (c.n.cocoon > 1 ? 's' : '') : '', c.n.butterfly ? c.n.butterfly + ' butterfl' + (c.n.butterfly > 1 ? 'ies' : 'y') : '', c.n.clutch.caterpillar ? c.n.clutch.caterpillar + ' eggs' : ''].filter(Boolean).join(', '), tip: 'Graze the clover. One that eats its fill becomes a cocoon, then a butterfly that lays eggs on clover. Big prey for your ants.' },
];
function bar(f) {
  if (f == null) return '';
  const c = f >= 0.6 ? '#9be36a' : f >= AL.Eco.TUNE.HUNGRY ? '#f2c14e' : '#ff7a5a';
  return '<i class="ecobar" title="' + (f >= 0.6 ? 'well fed' : f >= AL.Eco.TUNE.HUNGRY ? 'peckish' : 'hungry') + '"><b style="width:' + Math.round(f * 100) + '%;background:' + c + '"></b></i>';
}
function html(w) {
  if (!AL.Eco || !w.eco) return '';
  const c = AL.Eco.census(w);
  let h = '<h3 data-ecofold style="cursor:pointer" data-tip="The yard\'s wildlife eats, starves and breeds. What you kill, what you leave, and where army ant swarms strip the ground all change it.">Wildlife <small>' + (folded ? '&#9656;' : '&#9662;') + '</small></h3>';
  if (folded) return h;
  for (const r of ROWS) {
    const n = c.n[r.k], y = r.young(c);
    if (r.opt && !n && !y) continue;   // (the hunters show once one has turned up)
    h += '<div class="ecorow" data-tip="' + r.tip.replace(/"/g, '&quot;') + '"><span>' + r.name + ' <b>' + n + '</b></span>' + (n ? bar(c.fed[r.k]) : '<small>none</small>') + (y ? '<small class="ecoy">' + y + '</small>' : '') + '</div>';
  }
  h += '<div class="ecorow"><span>Aphids <b>' + c.aphids + '</b></span><small>on ' + w.surface.pois.filter(p => p.type === 'aphids' && !p.gone).length + ' plants</small></div>';
  return h;
}
function style() {
  if (document.getElementById('eco-style')) return;
  const s = document.createElement('style'); s.id = 'eco-style';
  s.textContent = '#w-wildlife h3{margin:0 0 4px}#w-wildlife h3 small{color:var(--mute)}.ecorow{display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px;font-size:var(--fs-sm,12px);margin:2px 0}' +
    '.ecorow span{flex:1 1 auto;min-width:0}.ecorow small{color:var(--mute);font-size:var(--fs-xs,11px)}.ecorow .ecoy{flex-basis:100%;margin-top:-2px}' +
    '.ecobar{display:inline-block;width:54px;height:5px;border-radius:3px;background:rgba(255,255,255,0.12);overflow:hidden;vertical-align:middle}.ecobar b{display:block;height:100%}';
  document.head.appendChild(s);
}
document.addEventListener('click', e => {
  const t = e.target && e.target.closest && e.target.closest('[data-ecofold]');
  if (!t) return;
  folded = !folded;
  try { localStorage.setItem('antlands.ecoFold', folded ? '1' : '0'); } catch (err) { /* fine */ }
  const w = AL.Game && AL.Game.world, el = document.getElementById('w-wildlife');
  if (w && el) el.innerHTML = html(w);
});
AL.on('worldCreated', w => {
  if (!AL.UI || !AL.UI.addWidget || !AL.Eco || (AL.Game && AL.Game.demo)) return;
  style();
  AL.UI.addWidget('wildlife', { where: 'right', every: 1, html });
});
})(window);
