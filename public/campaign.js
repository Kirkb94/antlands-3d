// Antlands campaign: "A Backyard Summer", ten short scenario missions that teach and then test the game.
// Pure simulation (no DOM; runs in node --test). The browser screens live in campaign-ui.js.
//
// Every mission is data:
//   { id, n, title, when, species | pickSpecies, story, speciesNote, tips[],
//     opts      createWorld / startFlow options (seed, colonies, rivals, start stock, worldTime, founding on/off ...)
//     setup     world tweaks applied when the mission starts (calm weather, no mower, extra ants, key points ...)
//     script    timed / triggered events ([{ at | after, delay, unless, msg | weather | mower | raid | reveal | spawn | time }])
//     goals     primary objectives (all needed to win)          [{ id, type, ...params, text }]
//     bonus     optional objectives (one star each, max 2)      [{ id, type, ...params, text }]
//     debrief   { win, lose } texts }
// The 'campaign' system (AL.registerSystem, order 40) runs when createWorld gets opts.campaign = <mission id>: it
// applies the setup, fires the script, checks the objectives once per second (most trackers listen to the existing
// events: foodDelivered, antBorn, broodLost, raid, mower, recall, queenDied, termitesBreached, ...) and ends the
// match through AL.Sim.endGame with world.over.campaign = { id, win, stars, bonus[], time, reason }.
//
//   AL.Campaign.MISSIONS / get(id) / next(id)
//   AL.Campaign.optsFor(id, extra)       -> startFlow options for a mission (deterministic seed)
//   AL.Campaign.status(world)            -> objectives with live progress, for the HUD panel and tests
//   AL.Campaign.Progress                 -> saved progress helpers (localStorage, always try/catch)
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./sim.js'); }
const C = AL.CASTE, K = AL.CARRY, L = AL.LAYER;

// ---------------------------------------------------------------------------------------------------------------
// the missions
// ---------------------------------------------------------------------------------------------------------------
const OFF = 1e9;   // key points that never wake
const MISSIONS = [
  {
    id: 'forage', n: 1, title: 'First Foragers', when: 'Early June', species: 'fire', map: { x: 0.13, y: 0.78 },
    story: 'Under the corner of the patio a young fire-ant colony wakes to its first warm morning. Forty workers, one queen, and a yard full of things to eat. Somewhere close, aphids are milking a dandelion for honeydew.',
    speciesNote: 'Fire ants breed fast and sting hard. They are the yard\'s all-rounders.',
    tips: ['Pick Food trail [F] and paint from your mound to the aphid plant. Foragers follow the scent and keep it strong.', 'The minimap (bottom right) shows food you have found as coloured dots.'],
    opts: { seed: 1101, rivalSites: [], keypointsAt: OFF, worldTime: { season: 'summer', timeOfDay: 0.32 } },
    setup: { calm: 900, noMower: true, noFeet: 240 },
    script: [
      { at: 3, msg: 'Paint a food trail [F] from your mound to the aphids on the dandelion.' },
      { at: 90, unless: 'trail', msg: 'The nearest aphids are on the plant just east of your mound. Press F and drag from the mound to it.' },
    ],
    goals: [
      { id: 'trail', type: 'trail', to: 'aphids', text: 'Paint a food trail from your mound to an aphid plant' },
      { id: 'sugar', type: 'deliver', res: 'sugar', n: 150, text: 'Bring home {n} sugar' },
    ],
    bonus: [
      { id: 'protein', type: 'deliver', res: 'protein', n: 80, text: 'Bring home {n} protein (dead insects)' },
      { id: 'fast', type: 'within', secs: 300, text: 'Finish within 5:00' },
    ],
    debrief: { win: 'Honeydew flows down the trail and the store fills. The colony is fed and the queen lays without pause. Next it needs room to grow.', lose: 'The colony could not feed itself. Paint the trail early and let the foragers do the walking.' },
  },
  {
    id: 'dig', n: 2, title: 'Dig Deep', when: 'June', species: 'fire', map: { x: 0.27, y: 0.62 },
    story: 'The colony has outgrown its scrape under the patio stone. Only a shaft and the queen\'s cell remain usable. Dig a real nest: a nursery for the brood and a store for the food, then raise the next generation.',
    speciesNote: 'Fire ants dig quickly. A shallow nursery under a big mound is the warmest.',
    tips: ['Press Tab (or wheel over the mound) to zoom into the nest.', 'Chamber [C]: pick Nursery or Food store, then paint on soil. Workers dig it out as that room.', 'Larvae need protein to grow: keep a food trail to dead insects.'],
    opts: { seed: 2202, rivalSites: [], keypointsAt: OFF, nestPreset: 'founding', worldTime: { season: 'summer', timeOfDay: 0.3 },
      start: { workers: 24, stock: { sugar: 120, protein: 80, water: 40 }, brood: [0, 0, 0, 0, 1, 1, 1, 2, 2].map(s => ({ caste: 0, stage: s })) } },
    setup: { calm: 1200, noMower: true },
    script: [
      { at: 3, msg: 'Zoom into the nest [Tab] and paint a Nursery and a Food store with the Chamber tool [C].' },
    ],
    goals: [
      { id: 'nursery', type: 'chamber', ch: 'NURSERY', n: 24, text: 'Dig a nursery of {n} tiles' },
      { id: 'store', type: 'chamber', ch: 'FOOD', n: 20, text: 'Dig a food store of {n} tiles' },
      { id: 'raise', type: 'born', n: 30, text: 'Raise {n} new ants' },
    ],
    bonus: [
      { id: 'midden', type: 'chamber', ch: 'MIDDEN', n: 6, text: 'Dig a midden for the dead ({n} tiles)' },
      { id: 'fast', type: 'within', secs: 540, text: 'Finish within 9:00' },
    ],
    debrief: { win: 'Galleries branch under the lawn and the nursery hums with brood. The patio colony is here to stay.', lose: 'The nest never took shape. Paint the rooms early: digging takes time.' },
  },
  {
    id: 'storm', n: 3, title: 'The Storm', when: 'Late June', species: 'leafcutter', map: { x: 0.42, y: 0.74 },
    story: 'By the hedge, the leafcutters are farming. The afternoon turns heavy and still, and thunderheads stack up over the fence. Rain floods tunnels from the bottom up, and brood in a low nursery drowns.',
    speciesNote: 'Leafcutters carry cut leaves home and grow fungus on them in the fungus garden: food that keeps coming. They start slowly.',
    tips: ['Clouds gather and the wind rises before the rain: that is your warning.', 'Water fills the lowest tunnels first. A nursery dug high up stays dry; a Water reservoir soaks up flood water.', 'Rain washes trails away except under shelter.'],
    opts: { seed: 3303, rivalSites: [], keypointsAt: OFF, worldTime: { season: 'summer', timeOfDay: 0.45 } },
    setup: { calm: 120, noMower: true },
    script: [
      { at: 5, msg: 'Storm clouds over the fence. You have about two minutes to get the brood high and dry.' },
      { at: 100, weather: 'storm', lead: 30, dur: 110 },
      { at: 132, msg: 'The storm breaks! Keep the brood out of the water.', kind: 'bad' },
    ],
    goals: [
      { id: 'storm', type: 'weather', kind: 'storm', text: 'Ride out the rainstorm' },
      { id: 'brood', type: 'lossMax', what: 'brood', cause: 'flood', max: 4, text: 'Lose no more than {max} brood to the flood' },
    ],
    bonus: [
      { id: 'dry', type: 'lossMax', what: 'brood', cause: 'flood', max: 0, text: 'Lose no brood at all' },
      { id: 'water', type: 'chamber', ch: 'WATER', n: 10, text: 'Dig a water reservoir ({n} tiles)' },
    ],
    debrief: { win: 'The storm rolls east. Water drains from the low galleries and the fungus garden steams in the sun. Not a larva lost to the flood worth mourning.', lose: 'The flood took the nursery. Next time dig the nursery high, near the surface, before the rain arrives.' },
  },
  {
    id: 'neighbours', n: 4, title: 'Neighbours', when: 'July', species: 'carpenter', map: { x: 0.56, y: 0.55 },
    story: 'The carpenter ants in the old stump have always kept to themselves. But the patio fire ants have grown, and their scouts are getting bold. Find where they live before they find you, and be ready when they come.',
    speciesNote: 'Carpenter ants are big and tough and tunnel through wood four times faster (your nest has a buried stump). They breed slowly, so every ant counts.',
    tips: ['Rivals are hidden until your ants see their nest. Scouts (egg queue) range far and lift the fog.', 'You smell rivals before you see them: red scent wisps point the way.', 'Alarm [R] at your mound brings soldiers out to guard it.'],
    opts: { seed: 4404, rivalSpecies: ['fire'], keypointsAt: OFF, worldTime: { season: 'summer', timeOfDay: 0.3 }, start: { stock: { sugar: 120, protein: 70 } } },
    setup: { calm: 600, noMower: true, ants: { scout: 3, soldier: 4 }, rivalsCalm: 9999 },
    script: [
      { at: 3, msg: 'Find the fire-ant nest. Queue a couple of scouts and follow the red scent.' },
      { at: 330, unless: 'find', msg: 'The fire-ant scent is strongest to the north-east, across the lawn.' },
      { after: 'find', delay: 30, msg: 'Their scouts have found your stump too. A raid is coming: sound the alarm [R] at your mound.', kind: 'bad' },
      { after: 'find', delay: 45, raid: { col: 1, soldiers: 14, workers: 6 } },
      { at: 600, unless: 'find', raid: { col: 1, soldiers: 14, workers: 6 } },
    ],
    goals: [
      { id: 'find', type: 'findColony', n: 1, text: 'Find the rival nest' },
      { id: 'defend', type: 'defendRaid', n: 1, text: 'Beat off a raid on your nest' },
    ],
    bonus: [
      { id: 'kills', type: 'kills', n: 20, text: 'Kill {n} raiders' },
      { id: 'brood', type: 'lossMax', what: 'brood', cause: 'any', max: 0, from: 'raid', text: 'Lose no brood once the raid starts' },
    ],
    debrief: { win: 'The raiders limp home across the lawn. The fire ants know the stump bites back.', lose: 'The stump has fallen. Keep soldiers at home and answer the raid with an alarm trail.' },
  },
  {
    id: 'mower', n: 5, title: 'The Mower', when: 'Late July', species: 'honeypot', map: { x: 0.7, y: 0.7 },
    story: 'Saturday. A shed door bangs and something big starts with a cough. Twice a summer the mower crosses the whole yard, strip after strip, and anything on the grass in front of the blades is gone.',
    speciesNote: 'Honeypot ants swell some workers into living jars of honey that never spoil. They are poor fighters but hard to starve.',
    tips: ['When the engine starts you get about 30 seconds of warning. Press the Mower alarm [U]: every ant outside runs home and stays in.', 'The alarm calls itself off when the mower is done.', 'Ants under a rock or log overhang are safe from the blades.'],
    opts: { seed: 5505, rivalSites: [], keypointsAt: OFF, worldTime: { season: 'summer', timeOfDay: 0.42 }, start: { workers: 50 } },
    setup: { calm: 900, noMower: true },
    script: [
      { at: 3, msg: 'Forage while you can. When you hear the mower, sound the Mower alarm [U].' },
      { at: 75, mower: true },
      { at: 76, msg: 'The mower is starting! Sound the Mower alarm [U] now.', kind: 'bad' },
    ],
    goals: [
      { id: 'alarm', type: 'recall', text: 'Sound the mower alarm before the blades arrive' },
      { id: 'mowed', type: 'mowerDone', text: 'Wait out the mow' },
      { id: 'losses', type: 'lossMax', what: 'ants', cause: 'crushed', max: 12, text: 'Lose no more than {max} ants to the blades' },
    ],
    bonus: [
      { id: 'none', type: 'lossMax', what: 'ants', cause: 'crushed', max: 2, text: 'Lose {max} ants or fewer' },
      { id: 'honey', type: 'deliver', res: 'sugar', n: 120, text: 'Bring home {n} sugar' },
    ],
    debrief: { win: 'Cut grass smells sweet. Stripes of lawn stretch to the fence, and the colony is still all there.', lose: 'The blades caught the foragers in the open. Sound the alarm the moment the engine starts.' },
  },
  {
    id: 'race', n: 6, title: 'The Founding Race', when: 'August, flight day', species: 'fire', map: { x: 0.8, y: 0.47 },
    story: 'On the hottest afternoon, winged queens rise from every nest in the yard. One of them is a daughter of the patio colony. She lands, sheds her wings and digs, and so do three rival queens nearby. Whoever raises workers first can bully the rest.',
    speciesNote: 'Fire ants found faster than any rival here. A shallow chamber is warmer and quicker.',
    tips: ['Founding: dig shallow, open the entrance once the first workers hatch, and start the colony as soon as you can.', 'Nests still founding are tiny, weak and exposed. Find one and send ants onto its mound (Raid [I] or Alarm [R]).'],
    opts: { seed: 6606, skipFounding: false, colonies: 4, rivalSpecies: ['leafcutter', 'carpenter', 'harvester'], keypointsAt: OFF, worldTime: { season: 'summer', timeOfDay: 0.3 } },
    setup: { calm: 600, noMower: true },
    script: [
      { at: 3, msg: 'Some rival queens are still founding. Find a founding nest and destroy it before it grows.' },
    ],
    goals: [
      { id: 'early', type: 'foundingAhead', text: 'Open your colony while a rival is still founding' },
      { id: 'kill', type: 'killFounding', n: 1, text: 'Destroy a nest that is still founding' },
    ],
    bonus: [
      { id: 'first', type: 'foundingPlace', place: 1, text: 'Finish founding first of all four queens' },
      { id: 'fast', type: 'within', secs: 420, text: 'Destroy it within 7:00 of colony start' },
    ],
    debrief: { win: 'One rival queen will never see autumn. The young colony has the corner of the yard to itself for now.', lose: 'The rivals all grew up. Found faster (shallow chamber, open early) and hunt the founding nests at once.' },
  },
  {
    id: 'biggame', n: 7, title: 'Big Game', when: 'August', species: 'army', map: { x: 0.67, y: 0.3 },
    story: 'A column of army ants pours over the fence in the night. They have no nest, only a living bivouac of their own bodies, and they eat whatever cannot run. In the middle of the yard stands a termite mound full of fat larvae.',
    speciesNote: 'Army ants cannot dig. Their bivouac can March [B] to a new spot; foragers find the new home on their own. Hard-hitting, fast, big start.',
    tips: ['March [B]: click open ground and the whole bivouac moves there.', 'The termite mound fights back. Send a big swarm (Alarm [R] on it); once breached its larvae spill out for carrying.', 'Big prey needs several carriers: drag a Collect [T] circle over it and your ants haul it home whole.'],
    opts: { seed: 7707, colonies: 3, rivalSpecies: ['fire', 'carpenter'], keypointsAt: OFF, worldTime: { season: 'summer', timeOfDay: 0.3 }, start: { stock: { sugar: 160, protein: 60 } } },
    setup: { calm: 900, noMower: true, ants: { soldier: 12 }, rivalsCalm: 420 },
    script: [
      { at: 3, msg: 'March the bivouac toward the termite mound, then storm it.' },
    ],
    goals: [
      { id: 'march', type: 'march', n: 1, text: 'March the bivouac [B]' },
      { id: 'breach', type: 'breach', text: 'Breach the termite mound' },
      { id: 'protein', type: 'deliver', res: 'protein', n: 300, text: 'Bring home {n} protein' },
    ],
    bonus: [
      { id: 'prey', type: 'bigPrey', n: 6, text: 'Drag {n} big prey home whole' },
      { id: 'spider', type: 'hunt', kind: 'spider', n: 1, text: 'Kill a wolf spider' },
    ],
    debrief: { win: 'The termite mound is a husk and the bivouac is fat with larvae. By dawn the column is moving on.', lose: 'The swarm ran out of steam. Keep the bivouac close to the food and hit the mound with everything at once.' },
  },
  {
    id: 'fronts', n: 8, title: 'Two Fronts', when: 'Late August', species: 'slavemaker', map: { x: 0.5, y: 0.2 },
    story: 'Six colonies now share the yard and the best ground is fought over: the picnic spill and the apple groves. The slave-makers of the fence line cannot even feed themselves. They take what they need, workers included.',
    speciesNote: 'Slave-makers raid rival nests for pupae: send a Raid [I] onto a rival mound. Stolen pupae hatch as captives that forage and nurse for you. Their own workers barely work, but their sickle jaws hit hard.',
    tips: ['Key points wake after 1:30. Stand ants on most of them to fill your hold meter (top of the screen).', 'Rally [Y] sends fighters to hold a spot.', 'Raid a weak neighbour for pupae early: captives keep the colony fed.'],
    opts: { seed: 8808, colonies: 6, rivalSpecies: ['fire', 'harvester', 'leafcutter', 'honeypot', 'carpenter'], keypointsAt: 90, worldTime: { season: 'summer', timeOfDay: 0.3 }, start: { stock: { sugar: 220, protein: 140 } } },
    setup: { calm: 900, noMower: true, ants: { soldier: 26, worker: 16 }, keypoints: { hold: 180 }, rivalsCalm: 300 },
    script: [
      { at: 3, msg: 'Hold most of the key points until your meter fills. They wake at 1:30.' },
      { at: 80, msg: 'The key points wake in ten seconds. Rally [Y] your fighters onto them.' },
    ],
    goals: [
      { id: 'hold', type: 'hold', text: 'Fill your hold meter on the key points' },
    ],
    bonus: [
      { id: 'captives', type: 'captives', n: 40, text: 'Have {n} captive workers' },
      { id: 'all', type: 'allPoints', text: 'Own every key point at once' },
    ],
    debrief: { win: 'The fence-line colony holds the middle of the yard. The neighbours will remember the sickle jaws.', lose: 'The yard was too crowded to hold. Get fighters onto the points the moment they wake.' },
  },
  {
    id: 'winter', n: 9, title: 'Winter Is Coming', when: 'September into winter', species: 'harvester', map: { x: 0.33, y: 0.3 },
    story: 'The nights are cold and the apples are falling. The harvesters by the path know what comes next: months underground with nothing but what they stored. Fill the granary, then sleep.',
    speciesNote: 'Harvester ants live on seeds: seeds keep forever, and majors mill them into sugar and protein. They eat 30% less, so they are slow to starve.',
    tips: ['Seed heads and grass round your mound shed seeds all autumn.', 'In winter the queen stops laying and ants stay inside; anyone left outside freezes.', 'Food stores hold sugar, protein and seeds: dig more store if it fills.'],
    opts: { seed: 9909, rivalSites: [], keypointsAt: OFF, worldTime: { season: 'autumn', seasonDay: 0, timeOfDay: 0.3 } },
    setup: { noMower: true },
    script: [
      { at: 3, msg: 'Winter arrives in about six minutes. Stockpile food, then hibernate.' },
      { at: 300, unless: 'larder', msg: 'The first frost is close. Get the last food home.', kind: 'bad' },
    ],
    goals: [
      { id: 'larder', type: 'stock', n: 260, by: 'winter', text: 'Store {n} food before winter (sugar, protein, seeds)' },
      { id: 'sleep', type: 'hibernate', pop: 40, text: 'Hibernate and wake in spring with {pop}+ ants' },
    ],
    bonus: [
      { id: 'cold', type: 'lossMax', what: 'ants', cause: 'cold', max: 3, text: 'Lose {max} ants or fewer to the cold' },
      { id: 'big', type: 'stock', n: 420, by: 'winter', text: 'Store {n} food before winter' },
    ],
    debrief: { win: 'Snow melts off the path. Under it the harvesters stir, fat on seed, and the queen begins to lay again.', lose: 'The colony did not make it through the cold. Stock up early: autumn is short.' },
  },
  {
    id: 'queen', n: 10, title: 'Queen of the Yard', when: 'End of summer', pickSpecies: true, map: { x: 0.18, y: 0.2 },
    story: 'Everything you have learned, in one match. Four colonies, one yard. Kill every rival queen, or hold the key points until your meter fills.',
    speciesNote: 'Pick any species.',
    tips: ['Key points wake at 10:00 in this mission and need a 4:00 hold.', 'Queue soldiers early; scouts find the rivals.'],
    opts: { seed: 10010, colonies: 4, keypointsAt: 600, worldTime: { season: 'summer', timeOfDay: 0.3 } },
    setup: { keypoints: { hold: 240 } },
    script: [],
    goals: [
      { id: 'win', type: 'win', text: 'Win the match' },
    ],
    bonus: [
      { id: 'queens', type: 'killQueens', n: 2, text: 'Kill {n} rival queens' },
      { id: 'fast', type: 'within', secs: 1800, text: 'Win within 30:00' },
    ],
    debrief: { win: 'Summer ends with one name on every ant\'s lips. The yard is yours.', lose: 'Another colony rules the yard this year. There is always next summer.' },
  },
];
// ---------------------------------------------------------------------------------------------------------------
// species tutorials: guided, step by step (one step active at a time, auto-advance, Skip / Back in the HUD).
// A step is an objective plus: help (one or two sentences), hl (CSS selector of a HUD element to highlight),
// spot (a world target the UI rings and points at: mound aphids clover seeds food prey creature rival stump),
// start (actions when the step begins: msg, time, stock, food, spawn, reveal). Safe setup: solo yard (the
// slave-maker one has a calm, revealed neighbour), calm weather, no mower, generous stock, no raids.
// ---------------------------------------------------------------------------------------------------------------
const TOOL = id => '#tools [data-tool="' + id + '"]', EGG = c => '#eggBtns [data-caste="' + C[c] + '"]';
const TUT_SETUP = { calm: 1800, noMower: true, noFeet: 1800, rivalsCalm: 99999 };
const tut = (sp, seed, extra) => Object.assign({ id: 'tut-' + sp, tutorial: true, species: sp, n: 0, when: 'Tutorial',
  opts: { seed, rivalSites: [], keypointsAt: OFF, worldTime: { season: 'summer', timeOfDay: 0.32 }, start: { stock: { sugar: 160, protein: 110, water: 40 } } },
  setup: TUT_SETUP, script: [], bonus: [] }, extra);
const S_TRAIL = (to, spot, what) => ({ id: 'trail', type: 'trail', to, spot, hl: TOOL('food'), text: 'Paint a food trail to ' + what, help: 'Press F (or the Food trail button), then drag from your mound to the ringed ' + what.replace(/^the /, '') + '. Foragers follow the scent; every trip home makes it stronger.' });
const S_NEST = { id: 'nest', type: 'view', view: 'nest', hl: '#btnView', text: 'Look inside the nest', help: 'Press Tab or the Nest button (or scroll in over your mound). The queen, brood and food store live down here.' };
const S_EGG = (caste, n, why) => ({ id: 'egg', type: 'eggQueued', caste, n, hl: EGG(caste), text: 'Queue ' + (n > 1 ? n + ' ' : 'a ') + AL.CASTES[C[caste]].name.toLowerCase() + (n > 1 ? 's' : '') + ' in the egg queue', help: 'Click ' + AL.CASTES[C[caste]].name + ' in the Egg queue panel. The queen lays what you queue; ' + why });
const TUTORIALS = [
  tut('fire', 501, {
    title: 'Fire ants', story: 'The yard\'s all-rounders: they breed fast and sting hard. Learn the basics here first.',
    steps: [
      S_TRAIL('aphids', 'aphids', 'the aphid plant'),
      { id: 'sugar', type: 'deliver', res: 'sugar', n: 30, spot: 'aphids', text: 'Bring home {n} sugar', help: 'Sugar feeds every adult ant. Watch the counter top left go up.' },
      S_NEST,
      { id: 'dig', type: 'dug', n: 6, hl: TOOL('dig'), text: 'Dig {n} tiles of tunnel', help: 'In the nest, press G (Dig) and paint soil next to a tunnel. Workers dig it out and pile the soil on the mound.' },
      S_EGG('SOLDIER', 2, 'soldiers need 3 protein each.'),
      { id: 'raise', type: 'born', n: 8, text: 'Raise {n} new ants', help: 'Fire ants breed fastest of all. Larvae need protein: keep the store topped up.' },
      { id: 'sting', type: 'hunt', n: 1, spot: 'creature', start: { spawn: 'beetle', d: 170, msg: 'A ground beetle is wandering past your mound.' }, hl: TOOL('alarm'), text: 'Kill the ground beetle', help: 'Press R (Alarm) and paint on the beetle: soldiers pour out. Fire-ant stings do 15% more damage.' },
    ] }),
  tut('leafcutter', 502, {
    title: 'Leafcutters', story: 'Farmers: they cut leaves and grow fungus on them underground. Slow to start, huge later.',
    steps: [
      S_TRAIL('clover', 'clover', 'the clover patch'),
      { id: 'leaves', type: 'deliver', res: 'leaves', n: 15, spot: 'clover', text: 'Bring home {n} leaves', help: 'Leafcutters carry cut clover home. Leaves are not food yet: they feed the fungus.' },
      S_NEST,
      { id: 'fungus', type: 'stockRes', res: 'fungus', n: 6, gain: true, text: 'Grow {n} more fungus in the garden', help: 'The pale room left of the queen is the fungus garden. Ants lay leaves on it and the fungus grows: food that keeps coming.' },
      { id: 'garden', type: 'chamberGrow', ch: 'FUNGUS', n: 6, hl: TOOL('chamber'), text: 'Enlarge the fungus garden by {n} tiles', help: 'Press C (Chamber), pick Fungus garden, and paint beside the garden. A bigger garden grows more food.' },
      { id: 'raise', type: 'born', n: 6, text: 'Raise {n} new ants', help: 'Leafcutter queens lay faster as the colony grows. Patience pays.' },
    ] }),
  tut('carpenter', 503, {
    title: 'Carpenter ants', story: 'Big, tough workers that chew through wood and come alive at night. Few of them, so every ant counts.',
    steps: [
      S_TRAIL('food', 'food', 'the nearest food'),
      S_NEST,
      { id: 'wood', type: 'dug', kind: 'WOOD', n: 4, hl: TOOL('dig'), spot: 'stump', text: 'Dig {n} tiles into the buried stump', help: 'The brown block right of the queen is an old stump. Press G and paint on the wood next to a tunnel: carpenters chew wood four times faster than soil.' },
      { id: 'prey', type: 'bigPrey', n: 1, spot: 'prey', start: { food: { kind: 'protein', amount: 40, needed: 3, visual: 'beetle', d: 190 } }, text: 'Drag the dead beetle home whole', help: 'Big prey needs several carriers. Carpenter workers are strong: paint a food trail to it and a few of them haul it home.' },
      S_EGG('MAJOR', 1, 'majors crush enemies and drag prey alone.'),
      { id: 'night', type: 'night', start: { time: { timeOfDay: 0.78 }, msg: 'Evening falls over the yard.' }, text: 'Wait for nightfall', help: 'Carpenters are nocturnal: at night they move faster and hit 20% harder, while fire ants slow down.' },
    ] }),
  tut('army', 504, {
    title: 'Army ants', story: 'No nest at all: a living bivouac that hunts everything nearby, then marches on.',
    steps: [
      { id: 'hunt', type: 'hunt', n: 1, spot: 'creature', start: { spawn: 'beetle', d: 200 }, hl: TOOL('alarm'), text: 'Kill the beetle', help: 'Press R (Alarm) and paint on the beetle: the soldiers pour out. Army ants hit hard and come in numbers.' },
      { id: 'collect', type: 'collect', hl: TOOL('collect'), spot: 'prey', text: 'Collect the carcass', help: 'Press T (Collect), pick how many ants, and drag a circle over the dead beetle. They haul it home, trip after trip, until it is gone.' },
      { id: 'protein', type: 'deliver', res: 'protein', n: 30, spot: 'prey', text: 'Bring home {n} protein', help: 'The carcass is food. Raids feed the brood: army ants live on protein.' },
      { id: 'march', type: 'march', n: 1, hl: TOOL('march'), text: 'March the bivouac [B]', help: 'Press B and click open ground well away from here. The whole colony moves; foragers find the new home on their own.' },
      S_EGG('SOLDIER', 2, 'army-ant soldiers lead the raids.'),
      { id: 'raise', type: 'born', n: 8, text: 'Raise {n} new ants', help: 'A fed bivouac grows fast. Keep it near food and keep it moving.' },
    ] }),
  tut('honeypot', 505, {
    title: 'Honeypot ants', story: 'Hoarders of the warm path: some workers swell into living jars of honey that carry the colony through lean times.',
    opts: { seed: 505, rivalSites: [], keypointsAt: OFF, worldTime: { season: 'summer', timeOfDay: 0.32 }, start: { stock: { sugar: 220, protein: 110, water: 40 } } },
    steps: [
      S_TRAIL('aphids', 'aphids', 'the aphid plant'),
      { id: 'sugar', type: 'deliver', res: 'sugar', n: 40, spot: 'aphids', text: 'Bring home {n} sugar', help: 'Honeypots love sugar. Surplus sugar becomes honey.' },
      S_NEST,
      { id: 'repletes', type: 'castePop', caste: 'HONEYPOT', n: 1, gain: true, text: 'Grow a new replete', help: 'When sugar is plentiful, workers in the food store swell into repletes for free. Look for the round amber ants hanging there.' },
      { id: 'honey', type: 'stockRes', res: 'honey', n: 15, gain: true, text: 'Bank {n} more honey in the repletes', help: 'Honey in a replete never spoils, and the queen can\'t eat it all at once.' },
      { id: 'lean', type: 'survive', secs: 30, start: { stock: { sugar: 0 }, msg: 'A dry spell: the loose sugar is gone.' }, text: 'Live off the honey for {secs} s', help: 'The repletes feed the store when sugar runs out. Honeypots fight poorly, but they are very hard to starve.' },
    ] }),
  tut('harvester', 506, {
    title: 'Harvester ants', story: 'Seed farmers with big-headed millers and a fierce sting. Seeds keep forever.',
    steps: [
      S_TRAIL('seeds', 'seeds', 'the seed heads'),
      { id: 'seeds', type: 'deliver', res: 'seeds', n: 20, spot: 'seeds', text: 'Bring home {n} seeds', help: 'Seeds never spoil for harvesters. The grass round your mound keeps shedding more.' },
      S_EGG('MAJOR', 1, 'harvester majors are the millers.'),
      { id: 'major', type: 'castePop', caste: 'MAJOR', n: 1, gain: true, text: 'Raise a new major', help: 'Majors cost 6 protein. Keep a trail to dead insects.' },
      S_NEST,
      { id: 'mill', type: 'milled', n: 6, text: 'Mill {n} seeds into food', help: 'Majors mill stored seeds into sugar and protein. Watch the seed count fall and the sugar rise.' },
    ] }),
  tut('slavemaker', 507, {
    setup: Object.assign({ sturdyRivals: true }, TUT_SETUP),
    title: 'Slave-makers', story: 'Raiders that can\'t keep house. They steal other colonies\' pupae; the captives that hatch do all the work.',
    opts: { seed: 507, rivalSites: [{ x: 1640, y: 1720 }], rivalSpecies: ['fire'], keypointsAt: OFF, worldTime: { season: 'summer', timeOfDay: 0.32 }, start: { stock: { sugar: 200, protein: 120, water: 40 } } },
    steps: [
      { id: 'captives', type: 'view', view: 'nest', hl: '#btnView', text: 'Meet your captives in the nest', help: 'Press Tab. Most of your workers are captives of another species: they forage and nurse for you. Your own ants barely work.' },
      { id: 'look', type: 'view', view: 'surface', hl: '#btnView', spot: 'rival', start: { reveal: true, msg: 'Your scouts found a fire-ant nest nearby.' }, text: 'Back to the surface: find the ringed rival nest', help: 'Press Tab again. A fire-ant colony lives close by. Their pupae are your next workers.' },
      { id: 'raid', type: 'playerRaid', hl: TOOL('raid'), spot: 'rival', text: 'Raid the rival mound', help: 'Press I (Raid), pick how many go, then click their mound. Your raiders storm in and carry pupae home.' },
      { id: 'steal', type: 'stolen', n: 2, spot: 'rival', text: 'Steal {n} pupae', help: 'Sickle jaws do 50% more damage. Keep the raids coming.' },
      { id: 'hatch', type: 'born', caste: 'CAPTIVE', n: 1, text: 'A stolen pupa hatches as a captive', help: 'Stolen pupae hatch as captive workers in that colony\'s colours. Keep raiding: captives grow old and die.' },
    ] }),
  tut('bullet', 508, {
    title: 'Bullet ants', story: 'A handful of huge hunters with the most painful sting there is. Every ant has a name.',
    opts: { seed: 508, rivalSites: [], keypointsAt: OFF, worldTime: { season: 'summer', timeOfDay: 0.32 }, start: { stock: { sugar: 160, protein: 140, water: 40 }, brood: [2, 2, 2, 1, 1, 0].map(s => ({ caste: 0, stage: s })) } },
    steps: [
      S_TRAIL('food', 'food', 'the nearest food'),
      { id: 'loads', type: 'deliver', res: 'food', n: 30, spot: 'food', text: 'Bring home {n} food', help: 'A bullet ant carries three crumbs a trip, so a few ants feed the colony.' },
      { id: 'hunt', type: 'hunt', n: 1, spot: 'creature', start: { spawn: 'caterpillar', d: 170, msg: 'A caterpillar is crawling past.' }, hl: TOOL('alarm'), text: 'Hunt the caterpillar', help: 'Paint an Alarm [R] on it. Bullet ants are 3x tougher and hit 2.6x harder, but you have very few.' },
      { id: 'careful', type: 'lossMax', what: 'ants', cause: 'any', max: 0, keepFor: 'hunt', text: 'Lose no ants', help: '' },
      S_EGG('WORKER', 1, 'each bullet larva needs a lot of protein.'),
      { id: 'raise', type: 'born', n: 1, text: 'Raise a new hunter', help: 'Bullet ants breed slowly and live almost twice as long. A new ant gets a name of its own.' },
    ] }),
];
// 'careful' style steps (keepFor) are not steps of their own: they watch the step they name
for (const t of TUTORIALS) { t.goals = t.steps.filter(s => !s.keepFor); t.bonus = t.steps.filter(s => s.keepFor); t.steps = t.goals; }
TUTORIALS.forEach((t, k) => { t.index = k; t.n = k + 1; });
const byId = {}; MISSIONS.forEach((m, k) => { m.index = k; byId[m.id] = m; });
for (const t of TUTORIALS) byId[t.id] = t;
const get = id => byId[id] || null;
// missions and tutorials played as, or against, a species that isn't playable yet (data.js AL.PLAYABLE) are "coming soon"
const playable = k => !k || !AL.isPlayable || AL.isPlayable(k);
const soon = m => !!m && (!playable(m.species) || ((m.opts && m.opts.rivalSpecies) || []).some(k => !playable(k)));
const next = id => { const m = get(id); if (!m || m.tutorial) return null; for (let k = m.index + 1; k < MISSIONS.length; k++) if (!soon(MISSIONS[k])) return MISSIONS[k]; return null; };
const tutorialFor = sp => byId['tut-' + sp] || null;
const fill = (text, o) => String(text || '').replace(/\{(\w+)\}/g, (_, k) => o[k] != null ? o[k] : '');

// startFlow / createWorld options for a mission (deterministic seed, no flight)
function optsFor(id, extra) {
  const m = get(id); if (!m) return null;
  const o = Object.assign({ skipFlight: true, skipFounding: true }, JSON.parse(JSON.stringify(m.opts)), extra || {});
  o.campaign = m.id;
  o.species = (extra && extra.species) || m.species || o.species || 'fire';
  // every rival gets a known species (the title screen picks random ones; missions are scripted)
  if (o.colonies != null && !o.rivalSpecies) { const pool = ['fire', 'leafcutter', 'carpenter', 'harvester', 'honeypot', 'army', 'bullet'].filter(playable); o.rivalSpecies = Array.from({ length: Math.max(0, o.colonies - 1) }, (_, k) => pool[k % pool.length]); }
  if (o.rivals == null && o.rivalSpecies) o.rivals = o.rivalSpecies.slice();
  return o;
}

// ---------------------------------------------------------------------------------------------------------------
// objective trackers: init(world, s, o), ev: { event(world, s, o, d) }, second(world, s, o), keep (violation = lost)
// each instance s = { o (definition), v, of, done, failed, text }
// ---------------------------------------------------------------------------------------------------------------
const totalPop = c => { let n = 0; for (let k = 0; k < c.pop.length; k++) if (k !== C.QUEEN) n += c.pop[k]; return n; };
const foodOf = c => (c.stock.sugar || 0) + (c.stock.protein || 0) + (c.stock.seeds || 0) + (c.honey || 0);
const resMatch = (res, kind) => res === 'food' ? (kind === K.SUGAR || kind === K.PROTEIN || kind === K.SEED) : AL.RES[kind] === res;
const near = (p, x, y, r) => AL.dist2(p.x, p.y, x, y) <= r * r;

const VIS = { clover: 'leaves', seeds: 'seeds' };
const resOf = (c, res) => res === 'honey' ? c.honey || 0 : c.stock[res] || 0;
const TRACK = {
  // bring food home (crumbs + big prey dragged home whole)
  deliver: {
    init(w, s, o) { s.of = o.n; },
    ev: {
      foodDelivered(w, s, o, d) { if (d.col === 0 && resMatch(o.res, d.kind)) s.v += d.amt || 1; },
      bigFood(w, s, o, d) { if (d.col === 0 && resMatch(o.res, d.kind)) s.v += Math.floor((d.food && (d.food.max || d.food.amount)) || 0); },
    },
    second(w, s, o) { if (s.v >= o.n) s.done = true; },
  },
  // a painted food trail (campaign-ui emits 'trailPainted' when a Food trail stroke ends) joining the mound and an aphid plant
  trail: {
    init(w, s) { s.of = 1; },
    ev: {
      trailPainted(w, s, o, d) {
        if (d.col !== 0 || !d.pts || d.pts.length < 2) return;
        const c = w.player, home = d.pts.some(p => near(p, c.x, c.y, 150));
        const targets = o.to === 'aphids' ? w.surface.pois.filter(p => p.type === 'aphids' && !p.gone) : w.surface.foods.filter(f => !f.gone && f.amount >= 1 && (!VIS[o.to] || f.visual === VIS[o.to]));
        const reach = targets.some(t => d.pts.some(p => near(p, t.x, t.y, (t.r || 20) + 110)));
        if (home && reach) { s.v = 1; s.done = true; }
      },
    },
  },
  born: { init(w, s, o) { s.of = o.n; }, ev: { antBorn(w, s, o, d) { if (d.col === 0 && (o.caste == null || d.caste === C[o.caste])) s.v++; } }, second(w, s, o) { if (s.v >= o.n) s.done = true; } },
  pop: { init(w, s, o) { s.of = o.n; }, second(w, s, o) { s.v = totalPop(w.player); if (s.v >= o.n) s.done = true; } },
  // a nest room of at least n tiles (dug out, not just painted)
  chamber: {
    init(w, s, o) { s.of = o.n; },
    second(w, s, o) {
      const n = w.nest; if (!n) return;
      const ch = AL.Nest.CH[o.ch], t = n.tiles[ch] || [];
      s.v = t.length; if (s.v >= o.n) s.done = true;
    },
  },
  // a weather front (forced by the script or natural) has come and gone
  weather: {
    init(w, s) { s.of = 1; },
    second(w, s, o) {
      const W = w.weather; if (!W) { s.done = true; return; }
      if (W.kind === o.kind) s.seen = true;
      else if (s.seen && W.rain < 0.12) { s.v = 1; s.done = true; }
      s.note = s.done ? '' : s.seen ? 'raining' : W.next === o.kind && W.timer < 60 ? 'coming in ' + Math.max(0, Math.round(W.timer)) + ' s' : 'not yet';
    },
  },
  // keep losses under a cap (brood or adults, by cause). from: 'raid' counts only once a raid on you started
  lossMax: {
    keep: true,
    init(w, s, o) { s.of = o.max; },
    ev: {
      broodLost(w, s, o, d) { if (o.what === 'brood' && d.col === 0 && (o.cause === 'any' || d.cause === o.cause) && (!o.from || w.campaign.raidOn)) { s.v += d.n || 1; if (s.v > o.max) s.failed = true; } },
      antDied(w, s, o, d) { if (o.what === 'ants' && d.col === 0 && d.caste !== C.QUEEN && (o.cause === 'any' || d.cause === o.cause) && (!o.from || w.campaign.raidOn)) { s.v++; if (s.v > o.max) s.failed = true; } },
    },
  },
  // see a rival nest (fog) - noFog worlds count every nest as seen
  findColony: {
    init(w, s, o) { s.of = o.n; },
    second(w, s, o) {
      let n = 0;
      for (const c of w.colonies) if (!c.isPlayer && (!w.fog || w.fog.seenAt(c.x, c.y))) n++;
      s.v = Math.max(s.v, n); if (s.v >= o.n) s.done = true;
    },
  },
  // a raid on the player's nest is over: none of the raiding colony's ants left near or inside the nest
  defendRaid: {
    init(w, s, o) { s.of = o.n; s.raids = []; },
    ev: { raid(w, s, o, d) { if (d.target === 0) { s.raids.push({ col: d.col, t: w.t, n: d.n, quiet: 0 }); w.campaign.raidOn = true; } } },
    second(w, s, o) {
      const A = w.ants, me = w.player;
      for (const r of s.raids) {
        if (r.over) continue;
        // raiders: the rival's ants in your nest, near your mound, or still marching on it
        let n = 0, at = 0;
        for (let i = 0; i < A.high; i++) {
          if (!A.state[i] || A.col[i] !== r.col) continue;
          if (A.layer[i] === L.NEST) { n++; at++; }
          else if (A.layer[i] === L.SURFACE) { if (near(me, A.x[i], A.y[i], 460)) { n++; at++; } else if (A.state[i] === AL.ST.RAID) n++; }
        }
        r.left = at; if (at) r.arrived = true;
        r.quiet = n === 0 ? r.quiet + 1 : 0;
        if ((r.arrived || w.t - r.t > 90) && w.t - r.t > 25 && r.quiet >= 6) { r.over = true; s.v++; }
      }
      const cur = s.raids.find(r => !r.over);
      s.note = cur ? (cur.left ? cur.left + ' raiders at your nest' : 'raid on its way') : s.raids.length ? '' : 'no raid yet';
      if (s.v >= o.n) s.done = true;
    },
  },
  // the mower alarm sounded while the mower was coming (or already mowing)
  recall: {
    init(w, s) { s.of = 1; },
    second(w, s) {
      const M = w.poi && w.poi.human.mower;
      if (M && (M.state === 'warn' || M.state === 'mow') && w.player.recall) { s.v = 1; s.done = true; }
      if (M && M.state === 'mow' && !s.done && M.lane > 0) s.failed = true;   // too late: the first strip is done
      s.note = M && M.state === 'warn' ? 'mower starting: ' + Math.ceil(M.t) + ' s' : '';
    },
  },
  mowerDone: {
    init(w, s) { s.of = 1; },
    ev: { mower(w, s, o, d) { if (d.phase === 'warn') s.started = true; if (d.phase === 'end' && s.started) { s.v = 1; s.done = true; } } },
    second(w, s) { const M = w.poi && w.poi.human.mower; s.note = M && M.state === 'mow' ? 'strip ' + (M.lane + 1) + ' of ' + M.lanes : ''; },
  },
  // the founding race: at colony start some rival is still founding (else the mission can't be won)
  foundingAhead: {
    init(w, s) { s.of = 1; },
    second(w, s) {
      if (s.done || s.failed) return;
      if (w.colonies.some(c => c.founding)) { s.v = 1; s.done = true; }
      else if (w.t > 3) s.failed = true;
    },
  },
  foundingPlace: {
    init(w, s, o) { s.of = 1; const fr = w.opts.foundingRace; if (fr && fr.place && fr.place <= o.place) { s.v = 1; s.done = true; } },
  },
  killFounding: {
    init(w, s, o) { s.of = o.n; },
    ev: { queenDied(w, s, o, d) { if (d.col !== 0 && (d.founding || (d.colony && d.colony.founding))) s.v++; } },
    second(w, s, o) {
      if (s.v >= o.n) { s.done = true; return; }
      // every founding nest grew up (or died some other way): nothing left to raid
      const still = w.colonies.filter(c => c.founding).length;
      if (w.t > 5 && !still) s.failed = true;
      s.note = still ? still + ' still founding' : '';
    },
  },
  march: { init(w, s, o) { s.of = o.n; }, ev: { march(w, s, o, d) { if (d.col === 0) s.v++; } }, second(w, s, o) { if (s.v >= o.n) s.done = true; } },
  breach: { init(w, s) { s.of = 1; }, ev: { termitesBreached(w, s, o, d) { if (d.col === 0) { s.v = 1; s.done = true; } } } },
  bigPrey: { init(w, s, o) { s.of = o.n; }, ev: { bigFood(w, s, o, d) { if (d.col === 0) s.v++; } }, second(w, s, o) { if (s.v >= o.n) s.done = true; } },
  hunt: {
    init(w, s, o) { s.of = o.n; },
    ev: { creatureDied(w, s, o, d) { const kind = d.kind || (d.creature && d.creature.type); if (d.col === 0 && (!o.kind || kind === o.kind)) s.v++; } },
    second(w, s, o) { if (s.v >= o.n) s.done = true; },
  },
  kills: { init(w, s, o) { s.of = o.n; s.base = w.player.stats.kills || 0; }, second(w, s, o) { s.v = Math.floor((w.player.stats.kills || 0) - s.base); if (s.v >= o.n) s.done = true; } },
  hold: {
    init(w, s) { s.of = 100; },
    second(w, s) {
      const V = w.victory; if (!V) return;
      s.v = Math.floor(V.hold[0] / V.holdTime * 100);
      if (V.hold[0] >= V.holdTime) s.done = true;
      s.note = w.t < V.activeAt ? 'wake in ' + Math.ceil(V.activeAt - w.t) + ' s' : V.points.filter(p => p.owner === 0).length + ' of ' + V.points.length + ' held';
      s.unit = '%';
    },
  },
  allPoints: {
    init(w, s) { s.of = 1; },
    second(w, s) { const V = w.victory; if (V && V.points.length && V.points.every(p => p.owner === 0)) { s.v = 1; s.done = true; } },
  },
  captives: { init(w, s, o) { s.of = o.n; }, second(w, s, o) { s.v = Math.max(s.v, w.player.pop[C.CAPTIVE] || 0); if (s.v >= o.n) s.done = true; } },
  // food in store reaches n before an event ('winter') happens
  stock: {
    init(w, s, o) { s.of = o.n; },
    second(w, s, o) {
      if (s.done || s.failed) return;
      s.v = Math.floor(foodOf(w.player));
      if (s.v >= o.n) s.done = true;
      else if (o.by === 'winter' && w.env.winter) s.failed = true;
      if (o.by === 'winter' && w.env.winterIn > 0) s.note = 'winter in ' + Math.floor(w.env.winterIn / 60) + ':' + String(Math.floor(w.env.winterIn % 60)).padStart(2, '0');
    },
  },
  // go through winter and wake in spring with at least pop ants
  hibernate: {
    init(w, s, o) { s.of = o.pop; },
    second(w, s, o) {
      s.v = totalPop(w.player);
      if (w.env.winter) { s.slept = true; s.note = 'hibernating'; return; }
      if (s.slept) { if (s.v >= o.pop) s.done = true; else s.failed = true; }
      else s.note = 'waiting for winter';
    },
  },
  win: { init(w, s) { s.of = 1; } },   // set by the gameOver listener
  killQueens: {
    init(w, s, o) { s.of = o.n; },
    ev: { queenDied(w, s, o, d) { if (d.col !== 0 && !(AL.Expansion && AL.Expansion.livingQueens && AL.Expansion.livingQueens(w, w.colonies[d.col]) > 0)) s.v++; } },
    second(w, s, o) { if (s.v >= o.n) s.done = true; },
  },
  // bonus: the mission is won within secs of the start
  within: { keep: true, init(w, s, o) { s.of = o.secs; }, second(w, s, o) { s.v = Math.floor(w.t - s.t0); if (s.v > o.secs) s.failed = true; } },
  survive: { init(w, s, o) { s.of = o.secs; }, second(w, s, o) { s.v = Math.floor(w.t - s.t0); if (s.v >= o.secs) s.done = true; } },
  // ---- tutorial steps ----
  // the egg queue holds n of a caste (campaign-ui also reports clicks as 'eggQueued', since the queen may lay at once)
  eggQueued: {
    init(w, s, o) { s.of = o.n || 1; },
    ev: { eggQueued(w, s, o, d) { if (d.col === 0 && d.caste === C[o.caste]) s.v++; } },
    second(w, s, o) { const q = w.player.eggQueue || []; s.v = Math.max(s.v, q.filter(c => c === C[o.caste]).length); if (s.v >= s.of) s.done = true; },
  },
  // the camera is on the nest / the surface (campaign-ui emits 'viewChanged')
  view: { init(w, s) { s.of = 1; }, ev: { viewChanged(w, s, o, d) { if (d.view === o.view) { s.v = 1; s.done = true; } } } },
  // tiles dug out (kind: only tiles that were WOOD / CLAY ...)
  dug: {
    init(w, s, o) { s.of = o.n; },
    ev: { tunnelDug(w, s, o, d) { if (d.col !== 0) return; const n = w.nest; if (o.kind && (!n || n.base[d.r * n.cols + d.c] !== AL.Nest.TILE[o.kind])) return; s.v++; } },
    second(w, s, o) { if (s.v >= o.n) s.done = true; },
  },
  // a nest room grows by n tiles from the size it had when the step began
  chamberGrow: {
    init(w, s, o) { s.of = o.n; const n = w.nest; s.base = n ? n.tiles[AL.Nest.CH[o.ch]].length : 0; },
    second(w, s, o) { const n = w.nest; if (!n) return; s.v = Math.max(0, n.tiles[AL.Nest.CH[o.ch]].length - s.base); if (s.v >= o.n) s.done = true; },
  },
  // a stock level (honey is held by honeypot repletes)
  // gain: count only what was added since the step began
  stockRes: {
    init(w, s, o) { s.of = o.n; s.base = o.gain ? resOf(w.player, o.res) : 0; s.hi = s.base; },
    second(w, s, o) { const v = resOf(w.player, o.res); s.hi = Math.max(s.hi, v); s.v = Math.floor(s.hi - s.base); if (s.v >= o.n) s.done = true; },
  },
  castePop: {
    init(w, s, o) { s.of = o.n; s.base = o.gain ? w.player.pop[C[o.caste]] || 0 : 0; },
    ev: { antBorn(w, s, o, d) { if (o.gain && d.col === 0 && d.caste === C[o.caste]) s.born = (s.born || 0) + 1; }, repleteMade(w, s, o, d) { if (o.gain && d.col === 0 && o.caste === 'HONEYPOT') s.born = (s.born || 0) + 1; } },
    second(w, s, o) { s.v = o.gain ? Math.max(s.born || 0, (w.player.pop[C[o.caste]] || 0) - s.base) : w.player.pop[C[o.caste]] || 0; if (s.v >= o.n) s.done = true; },
  },
  night: { init(w, s) { s.of = 1; }, second(w, s) { if (w.env.night > 0.5) { s.v = 1; s.done = true; } } },
  // a Collect circle drawn
  collect: { init(w, s) { s.of = 1; }, ev: { collectOrder(w, s, o, d) { if (d.col === 0) { s.v = 1; s.done = true; } } } },
  // a Raid (Raid tool, raids.js) sent against a rival's hill
  playerRaid: { init(w, s) { s.of = 1; }, ev: { playerRaid(w, s, o, d) { const t = w.colonies[d.tcol]; if (d.col === 0 && t && !t.isPlayer) { s.v = 1; s.done = true; } } } },
  // a Recruit order (to: 'rival' = its path ends on a rival mound)
  recruit: {
    init(w, s) { s.of = 1; },
    ev: { recruitOrder(w, s, o, d) {
      if (d.col !== 0) return;
      const pts = (d.order && d.order.pts) || [], end = pts[pts.length - 1];
      if (o.to === 'rival' && !(end && w.colonies.some(c => !c.isPlayer && near(c, end.x, end.y, (c.moundR || 30) + 60)))) return;
      s.v = 1; s.done = true;
    } },
  },
  stolen: { init(w, s, o) { s.of = o.n; }, ev: { broodStolen(w, s, o, d) { if (d.col === 0) s.v++; } }, second(w, s, o) { if (s.v >= o.n) s.done = true; } },
  milled: { init(w, s, o) { s.of = o.n; s.base = w.player.milled || 0; }, second(w, s, o) { s.v = Math.floor((w.player.milled || 0) - s.base); if (s.v >= o.n) s.done = true; } },

};

// every event a tracker listens to is routed to the active mission (one listener per event type)
const routed = new Set();
function route(type) {
  if (routed.has(type)) return; routed.add(type);
  AL.on(type, (w, d) => {
    const st = w && w.campaign; if (!st || st.result) return;
    for (const s of st.all) { if (st.tut && !s.bonus && !s.active) continue; const t = TRACK[s.o.type], f = t && t.ev && t.ev[type]; if (f && !s.failed && !(s.done && !t.keep)) f(w, s, s.o, d); }
  });
}
for (const k in TRACK) if (TRACK[k].ev) for (const e in TRACK[k].ev) route(e);

// ---------------------------------------------------------------------------------------------------------------
// setup and script actions
// ---------------------------------------------------------------------------------------------------------------
function spawnAround(w, col, caste, n, r0) {
  const c = w.colonies[col];
  for (let k = 0; k < n; k++) {
    const a = w.R() * AL.TAU, d = (r0 || 14) + w.R() * 30;
    let x = c.x + AL.cos(a) * d, y = c.y + AL.sin(a) * d;
    if (AL.Surface.isBlocked(w.surface, x, y)) { x = c.x; y = c.y; }
    const i = w.ants.spawn(col, caste, L.SURFACE, x, y, a, w.R);
    if (i >= 0) { w.ants.state[i] = AL.ST.HOMING; w.ants.age[i] = w.R() * 100; }
  }
}
function applySetup(w, m) {
  const su = m.setup || {};
  if (su.calm && AL.World && w.weather) { AL.World.forceWeather(w, 'clear', su.calm, true); w.weather.next = 'cloudy'; }
  if (w.poi && w.poi.human) {
    if (su.noMower) w.poi.human.mower.next = OFF;
    if (su.noFeet) w.poi.human.foot.next = su.noFeet;
  }
  if (su.ants) for (const k in su.ants) spawnAround(w, 0, C[k.toUpperCase()], su.ants[k]);
  for (const c of w.colonies) if (!c.isPlayer && c.ai) {
    if (su.rivalsCalm) c.ai.raidT = Math.max(c.ai.raidT || 0, su.rivalsCalm);
  }
  const V = w.victory;
  if (V) {
    if (!su.keypoints && w.opts.keypointsAt >= OFF) V.points = [];
    else if (su.keypoints && su.keypoints.hold) V.holdTime = su.keypoints.hold;
  }
}
// force a raid: the rival learns where the player lives, gets an army and marches now
function forceRaid(w, r) {
  const c = w.colonies[r.col]; if (!c || c.alive === false || c.out || !c.ai || !c.inside) return false;
  if (AL.AI && AL.AI.discover) AL.AI.discover(w, c.id, 0, w.player.x, w.player.y, 'campaign');
  if (c.ai.known) c.ai.known[0] = 1;
  c.inside[C.SOLDIER] += r.soldiers || 0; c.inside[C.WORKER] += r.workers || 0; c.inside[C.MAJOR] += r.majors || 0;
  c.ai.raidT = 0; c.ai.target = 0;
  return true;
}
function act(w, st, e) {
  if (e.msg) AL.emit(w, 'campaignMsg', { text: e.msg, kind: e.kind || '' });
  if (e.weather && w.weather) {
    const W = w.weather;
    if (e.lead) { W.next = e.weather; W.timer = Math.min(W.timer, e.lead); W.forecasted = false; st.stretch = { kind: e.weather, dur: e.dur }; }
    else AL.World.forceWeather(w, e.weather, e.dur, !!e.instant);
  }
  if (e.mower && AL.WorldPOI && w.poi) AL.WorldPOI.startMower(w);
  if (e.time && AL.World) AL.World.setTime(w, e.time);
  if (e.raid) forceRaid(w, e.raid);
  // reveal: the player's fog lifts over every rival nest (as if a scout had been there)
  if (e.reveal && w.fog) for (const c of w.colonies) if (!c.isPlayer) {
    const f = w.fog, cx = (c.x * f.inv) | 0, cy = (c.y * f.inv) | 0;
    for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) if (x >= 0 && y >= 0 && x < f.w && y < f.h) f.seen[y * f.w + x] = 1;
  }
  if (e.spawn && AL.WorldCreatures) { const p = openSpot(w, e.d || 260); st.spawned = AL.WorldCreatures.spawn(w, e.spawn, p.x, p.y); }
  if (e.stock) Object.assign(w.player.stock, e.stock);
  if (e.food) { const p = openSpot(w, e.food.d || 200), f = e.food; st.food = AL.Surface.addFood(w.surface, { kind: K[f.kind.toUpperCase()], x: p.x, y: p.y, r: 16, amount: f.amount, max: f.amount, big: !!f.needed, needed: f.needed || 0, visual: f.visual || 'bug', a: 0.6 }); w.surface.foodDirty = true; }
}
// open ground about d from the player's mound (deterministic: tries angles in turn)
function openSpot(w, d) {
  const c = w.player, S = w.surface;
  for (let k = 0; k < 24; k++) { const a = 0.4 + k * 0.785, x = c.x + AL.cos(a) * d, y = c.y + AL.sin(a) * d; if (x > 40 && y > 40 && x < S.W - 40 && y < S.H - 40 && !AL.Surface.isBlocked(S, x, y)) return { x, y }; }
  return { x: c.x + d, y: c.y };
}
function runScript(w, st) {
  const m = st.m, t = w.t - st.t0;
  (m.script || []).forEach((e, k) => {
    if (st.fired[k]) return;
    let due = false;
    if (e.after) { const s = st.byId[e.after]; if (s && s.done) { if (s.doneAt == null) s.doneAt = t; due = t >= s.doneAt + (e.delay || 0); } }
    else due = t >= (e.at || 0);
    if (!due) return;
    st.fired[k] = 1;
    if (e.unless && st.byId[e.unless] && st.byId[e.unless].done) return;
    act(w, st, e);
  });
  // a weather front the script asked for: once it arrives, make it last the scripted time
  if (st.stretch && w.weather.kind === st.stretch.kind) { if (st.stretch.dur) w.weather.timer = st.stretch.dur; w.weather.next = 'clear'; st.stretch = null; }
}

// ---------------------------------------------------------------------------------------------------------------
// the runner
// ---------------------------------------------------------------------------------------------------------------
function mk(o, bonus) { return { o, bonus, v: 0, of: 1, done: false, failed: false, note: '' }; }
function init(w, opts) {
  const m = get(opts.campaign); if (!m) return;
  const st = w.campaign = { id: m.id, m, t0: w.t, goals: m.goals.map(o => mk(o, false)), bonus: (m.bonus || []).map(o => mk(o, true)), fired: {}, result: null, byId: {}, raidOn: false };
  st.all = st.goals.concat(st.bonus);
  st.tut = !!m.tutorial; st.step = 0;
  for (const s of st.all) { st.byId[s.o.id] = s; s.t0 = w.t; const t = TRACK[s.o.type]; if (t && t.init && !(st.tut && !s.bonus)) t.init(w, s, s.o); }
  applySetup(w, m);
  if (st.tut) startStep(w, st, 0);
}
// tutorials: step k becomes the active one (its tracker starts counting now, its start actions run)
function startStep(w, st, k) {
  for (const s of st.goals) s.active = false;
  st.step = k;
  const s = st.goals[k]; if (!s) return;
  Object.assign(s, { v: 0, done: false, failed: false, note: '', doneAt: null, active: true, t0: w.t, skipped: false });
  const t = TRACK[s.o.type]; if (t && t.init) t.init(w, s, s.o);
  if (s.o.start) act(w, st, s.o.start);
  // tutorials: the fog lifts round what the step points at, so the player can see it
  const sp = s.o.spot && w.fog ? spotOf(w, s.o.spot) : null;
  if (sp) { const f = w.fog, cx = (sp.x * f.inv) | 0, cy = (sp.y * f.inv) | 0; for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) if (x >= 0 && y >= 0 && x < f.w && y < f.h) f.seen[y * f.w + x] = 1; }
  AL.emit(w, 'campaignStep', { id: s.o.id, k, of: st.goals.length, text: textOf(s) });
}
function skipStep(w) {
  const st = w && w.campaign; if (!st || !st.tut || st.result) return false;
  const s = st.goals[st.step]; if (!s) return false;
  s.done = true; s.skipped = true; s.active = false; s.doneAt = w.t - st.t0;
  if (st.step + 1 >= st.goals.length) finish(w, true, 'Tutorial complete: ' + st.m.title + '.'); else startStep(w, st, st.step + 1);
  return true;
}
function backStep(w) {
  const st = w && w.campaign; if (!st || !st.tut || st.result || st.step <= 0) return false;
  st.goals[st.step].active = false; st.goals[st.step].done = false;
  startStep(w, st, st.step - 1);
  return true;
}
function second(w) {
  const st = w.campaign; if (!st || st.result || w.over) return;
  runScript(w, st);
  // practice neighbours (tutorials): their queen can't be killed and the nest keeps its workers
  if (st.m.setup && st.m.setup.sturdyRivals) for (const c of w.colonies) if (!c.isPlayer && c.queen && c.queen.alive) { c.queen.hp = c.queen.maxHp; if (c.inside && c.inside[C.WORKER] < 25) c.inside[C.WORKER] += 1; }
  for (const s of st.all) {
    if (st.tut && !s.bonus && !s.active) continue;
    const t = TRACK[s.o.type];
    if (t && t.second && !s.failed && !(s.done && !t.keep)) t.second(w, s, s.o);
    if (s.done && s.doneAt == null) { s.doneAt = w.t - st.t0; if (!t.keep) AL.emit(w, 'campaignObjective', { id: s.o.id, bonus: s.bonus, text: textOf(s) }); }
    if (s.failed && !s.failNoted) { s.failNoted = true; if (s.bonus) AL.emit(w, 'campaignObjective', { id: s.o.id, bonus: true, failed: true, text: textOf(s) }); }
  }
  if (st.tut) {
    // a tutorial step never fails: it starts over; a done step hands over to the next
    const s = st.goals[st.step];
    if (s && s.failed) startStep(w, st, st.step);
    else if (s && s.done) { if (st.step + 1 >= st.goals.length) finish(w, true, 'Tutorial complete: ' + st.m.title + '.'); else startStep(w, st, st.step + 1); }
    return;
  }
  const failed = st.goals.find(s => s.failed);
  if (failed) { finish(w, false, 'Failed: ' + textOf(failed).toLowerCase() + '.'); return; }
  const open = st.goals.filter(s => !TRACK[s.o.type].keep && !s.done);
  if (!open.length) finish(w, true, 'Mission complete: ' + st.m.title + '.');
}
// end the mission (a win also scores the bonus objectives) and the match with it
function finish(w, win, reason, fromCore) {
  const st = w.campaign; if (!st || st.result) return;
  const t = w.t - st.t0;
  const bonus = st.bonus.map(s => {
    const tr = TRACK[s.o.type];
    if (s.o.type === 'within') return win && t <= s.o.secs;
    return win && !s.failed && (tr.keep ? true : s.done);
  });
  const stars = win ? 1 + bonus.filter(Boolean).length : 0;
  st.result = { id: st.id, win, stars, bonus, time: Math.floor(t), reason };
  if (!fromCore) AL.Sim.endGame(w, win ? 0 : -1, reason);
  if (w.over) w.over.campaign = st.result;
  AL.emit(w, 'campaignEnd', st.result);
}
// the match ended some other way (the queen died, every rival queen died, someone filled the hold meter)
AL.on('gameOver', (w, d) => {
  const st = w && w.campaign; if (!st || st.result) return;
  const win = !!d.win;
  if (win) for (const s of st.goals) if (s.o.type === 'win') { s.v = 1; s.done = true; }
  finish(w, win, d.reason || (win ? 'Victory.' : 'Your colony is gone.'), true);
});

AL.registerSystem({
  id: 'campaign', order: 40,
  enabled(opts) { return !!(opts && opts.campaign && get(opts.campaign)); },
  init, second,
});

// objectives with live progress (HUD panel, tests)
function textOf(s) { return fill(s.o.text, s.o); }
function status(w) {
  const st = w && w.campaign; if (!st) return null;
  const row = s => {
    const tr = TRACK[s.o.type];
    const state = s.failed ? 'failed' : (s.done || (tr.keep && st.result && st.result.win)) ? 'done' : 'open';
    let prog = '';
    if (s.o.type === 'within') prog = AL.Victory && AL.Victory.clock ? AL.Victory.clock(Math.max(0, s.o.secs - s.v)) + ' left' : '';
    else if (tr.keep) prog = s.v + ' / ' + s.of;
    else if (s.of > 1) prog = Math.min(s.v, s.of) + (s.unit || '') + ' / ' + s.of + (s.unit || '');
    return { id: s.o.id, text: textOf(s), help: s.o.help || '', state, v: s.v, of: s.of, prog, note: s.note || '', keep: !!tr.keep, bonus: s.bonus, active: !!s.active, skipped: !!s.skipped, hl: s.o.hl || '', spot: s.o.spot || '' };
  };
  return { id: st.id, title: st.m.title, n: st.m.n, tutorial: st.tut, step: st.step, goals: st.goals.map(row), bonus: st.bonus.map(row), result: st.result, t: Math.floor(w.t - st.t0) };
}

// where a tutorial step points in the yard (null: nothing to point at, e.g. a nest-view step)
function spotOf(w, spot) {
  const st = w && w.campaign, c = w && w.player; if (!st || !c || !spot) return null;
  const S = w.surface, d2 = p => AL.dist2(p.x, p.y, c.x, c.y);
  const nearest = arr => { let b = null, bd = 1e18; for (const p of arr) { const d = d2(p); if (d < bd) { bd = d; b = p; } } return b; };
  if (spot === 'mound') return { x: c.x, y: c.y, r: c.moundR || 30 };
  if (spot === 'aphids') return nearest(S.pois.filter(p => p.type === 'aphids' && !p.gone));
  if (spot === 'clover' || spot === 'seeds') return nearest(S.foods.filter(f => !f.gone && f.amount >= 1 && f.visual === VIS[spot]));
  if (spot === 'food') return nearest(S.foods.filter(f => !f.gone && f.amount >= 1 && !f.corpse && d2(f) > 60 * 60));
  if (spot === 'prey') return st.food && !st.food.gone ? st.food : nearest(S.foods.filter(f => !f.gone && f.amount >= 1 && f.kind === K.PROTEIN && !f.corpse));
  if (spot === 'creature') return st.spawned && st.spawned.alive ? st.spawned : nearest(S.creatures.filter(z => z.alive && z.prey && z.r > 0));
  if (spot === 'rival') return nearest(w.colonies.filter(o => !o.isPlayer && o.alive !== false));
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// saved progress: { v: 1, missions: { id: { done, stars, bonus: [..], best, plays } } }
// ---------------------------------------------------------------------------------------------------------------
const KEY = 'antlands.campaign';
const Progress = {
  KEY,
  empty: () => ({ v: 1, missions: {} }),
  load(store) {
    try { const s = store || (typeof localStorage !== 'undefined' ? localStorage : null); const raw = s && s.getItem(KEY); const p = raw ? JSON.parse(raw) : null; if (p && p.missions) return p; } catch (_) {}
    return Progress.empty();
  },
  save(p, store) { try { const s = store || (typeof localStorage !== 'undefined' ? localStorage : null); if (s) s.setItem(KEY, JSON.stringify(p)); return true; } catch (_) { return false; } },
  // fold a mission result into the progress (best stars and bonus flags are kept)
  record(p, r) {
    const e = p.missions[r.id] = p.missions[r.id] || { done: false, stars: 0, bonus: [], best: 0, plays: 0 };
    e.plays++;
    if (r.win) {
      e.done = true; e.stars = Math.max(e.stars, r.stars);
      r.bonus.forEach((b, k) => { e.bonus[k] = !!(e.bonus[k] || b); });
      e.stars = Math.max(e.stars, 1 + e.bonus.filter(Boolean).length);
      e.best = e.best ? Math.min(e.best, r.time) : r.time;
    }
    return p;
  },
  // mission 1 is open; each later one opens when the one before it is done ("coming soon" missions are skipped over)
  unlocked(p, id) {
    const m = get(id); if (!m || soon(m)) return false; if (m.tutorial) return true;
    let k = m.index - 1; while (k >= 0 && soon(MISSIONS[k])) k--;
    if (k < 0) return true;
    const prev = MISSIONS[k]; return !!(p.missions[prev.id] && p.missions[prev.id].done);
  },
  state(p, id) { if (soon(get(id))) return 'soon'; const e = p.missions[id]; return e && e.done ? 'done' : Progress.unlocked(p, id) ? 'open' : 'locked'; },
  stars(p) { let s = 0; for (const m of MISSIONS) if (!soon(m)) s += (p.missions[m.id] && p.missions[m.id].stars) || 0; return s; },
  // the mission before this one that has to be won first (for the "Win mission n" note)
  prevOpen(id) { const m = get(id); if (!m) return null; let k = m.index - 1; while (k >= 0 && soon(MISSIONS[k])) k--; return k >= 0 ? MISSIONS[k] : null; },
};

AL.Campaign = { MISSIONS, TUTORIALS, get, next, soon, tutorialFor, optsFor, status, TRACK, Progress, forceRaid, finish, fill, skipStep, backStep, spotOf, OFF };
if (NODE) module.exports = AL.Campaign;
})(typeof window !== 'undefined' ? window : globalThis);
