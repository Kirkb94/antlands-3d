# Antlands integration contract

Owner: the lead/integrator agent. Stage agents (flight, founding, world, expansion) build against this
and deliver into `antlands-stages/<stage>/` with a `READY.md`. **Stage agents never write to the PC.**
The lead copies modules into the tree, wires them into `public/index.html`, tests and commits.

The current core source is always mirrored at `antlands-stages/_core/` (read-only for you: copy it to your
own folder to run/test against; don't edit it). Re-check this file's changelog when you start a session.

## Changelog
- **v5 (wounds)** - wounded ants go home to heal: states `ST.HEAL = 11` (surface, walking home) and `ST.N_HEAL = 27`
  (resting in the nest), action `ACT.HEAL = 10`, tuning `AL.HEAL` (data.js). `AL.Combat.goHeal(world, i)`,
  `AL.Life.healAt/wounded/canHeal/homeRaided/needsRest/rest`. `col._raidT` = last time the colony's own mound was
  raided (wounded ants defend it for `AL.HEAL.RAID_HOLD` s). AI nests pool unhealed wounds per caste in `col.wound`
  (`col.woundN`); code that spawns ants out of `col.inside` should call `AL.AI.walkOut(col, caste, ants, i)` before
  taking the ant off `col.inside`.
- **v5 (polish)** - army bivouac marches (`bivouac.js`, `col.biv`, events `march` / `marchEnd`, state `ST.B_MARCH = 70`);
  UI theme variables and layout (section 9a); difficulty levels (`opts.aiLevel`).
- **v5 (research tree + species perks)** - `research.js` loads after `expansion.js`, `research-ui.js` after `expansion-ui.js`
  (and before `main.js`). New colony fields `col.mods`, `col.research` (now the whole tree; `research.tunnel` kept), `col.perk`;
  `col.sp` becomes a per-colony view of `AL.SPECIES[key]` (section 8b). Events `researchStarted` / `researchDone`
  now carry `what` = node id (was always `'tunnel'`) and `node`; new `researchCancelled`, `perkChosen`. createWorld options
  `perk`, `rivalPerks`, `research: false`, `rivalResearch: false`. Combat must multiply damage by
  `AL.Research.dpsMul(col, caste)` (one place); hp is already applied per ant by research.js.
- **v4 (founding race)** - `founding-race.js` loads after `founding.js`. New `col.founding` contract (section 8a) and
  event `foundingDone`. `AL.Founding.PROFILE` is open (add species; missing keys fall back to `PROFILE_DEFAULT`), plus
  `profileFor`, `colonyReady`, `race`, `plugEntrance`. Founding handoffs carry `race`, `larder` and a bigger stock the longer
  the player waits at colony stage.
- **v3 (after Founding + species commit)** - Flight and Founding are integrated and load in this order:
  `... fog.js founding-sites.js founding.js flight.js` (sim) and `... ui-screens.js ui-hints.js audio.js flight-scene.js founding-scene.js main.js`.
  World/Expansion: put your sim files after `flight.js` and render/UI files after `founding-scene.js`; tell me in READY.md.
  New/real: `AL.UI.toast(text, 'good'|'bad')`, `AL.UI.addWidget(id, {where, every, html})`, `AL.UI.removeWidget(id)`,
  `AL.UI.onScene` hides the HUD for every scene; `ants.size` Float32Array (per-ant body scale, renderers use it);
  `colony.siteTraits` now read by core (dig, caveIn, flood, warmth, defence, visibility); species twists:
  `sp.fungus` (leaves -> fungus garden -> food), `sp.wood`, `sp.nomad` (no digging, bivouac, `march` event, colony.x/y can move!).
  The HUD clock reads `env.day`, `env.season`, `env.timeOfDay`, `env.rain`, `env.heat` - World stage, just set them.
  Events added: `starving`/`fed`, `raid`, `breakIn`, `foodStolen`, `siege`, `creatureDied`, `recruitOrder`, `march`, `founded`.
  Combat for creatures is live (section 7): `prey`/`hostile` creatures get swarmed; `attacking: true` makes workers join.
- **v2 (M2, commit after 8ad2f57)** - nest + colony life landed (`nest.js`, `life.js`, `render-nest.js`).
  Now real: `world.nest` / `colony.nest`, `colony.queen/brood/eggQueue/cap/disease/orders/hotspots`,
  `AL.Combat.killAnt(world,i,cause)` and `AL.Combat.hitAnt(world,i,dmg,cause)`, events `antDied antBorn eggLaid
  queenDied tunnelDug caveIn broodLost`, createWorld `nestPreset start queenTraits siteTraits`, nest render layers
  `nestUnder nestOver nestScreen`, `world.nestHandlers[state] = (world,i,dt)` for custom nest states (ids >= 40),
  `colony.enter(world, i)` = what happens when an ant reaches that colony's entrance. `env.winter` stops laying,
  `env.rain` floods the nest, `env.temp` sets nest temperature. See section 11 for the nest API.
- **v1 (M1)** - namespace, module pattern, systems/events/scenes registries, render layers, world shape,
  ant SoA, surface map, env, food sources, win checks, washTrails. Nest/colony brood/AI/combat/fog
  shapes are *planned* (marked PLANNED) and land with M2/M3; their names below are final.

---

## 1. Module pattern and load order
Plain scripts, no bundler, no ES modules. Every file is an IIFE that works in the browser *and* Node tests:

```js
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./sim.js'); /* deps you use */ }
// ... your code ...
AL.MyThing = { ... };
if (NODE) module.exports = AL.MyThing;
})(typeof window !== 'undefined' ? window : globalThis);
```

- Pure simulation code must not touch `document`/`window` (it runs in `node --test`). Rendering/UI code
  may be browser-only and end with `})(window);`.
- Browser load order (index.html): `al.js data.js pheromone.js ants.js surface.js colony.js behavior.js
  sim.js [nest.js combat.js ai.js fog.js]` -> **stage sim modules** -> `art.js render.js input.js ui.js`
  -> **stage render/UI modules** -> `main.js`. Register at load time; `createWorld` picks you up.
- Name your files `public/<stage>-*.js` (e.g. `world-weather.js`, `world-creatures.js`, `flight.js`,
  `founding.js`, `expansion.js`) and tests `test/<stage>*.test.js` (node:test, `require('../public/x.js')`).
- No dependencies, no build step, no raster images (all art is Canvas paths), works offline from `public/`.
- Sim randomness: use `world.R()` (seeded xorshift; also `.int(n) .range(a,b) .pick(arr)`), never
  `Math.random()` in sim code. Render code may use `Math.random()`.

## 2. Registries (in `al.js`)

### Systems
```js
AL.registerSystem({
  id: 'world-weather', order: 10,          // lower runs first; core systems use 0..9 (nest 2, combat 4, ai 6, fog 8)
  enabled(opts) { return true; },          // optional, decides per createWorld(opts)
  init(world, opts) {},                    // after map + colonies exist, before the first tick
  pre(world, dt) {},                       // every tick, before ants move (set world.env here)
  tick(world, dt) {},                      // every tick, after ants moved (hash is fresh)
  post(world, dt) {},                      // every tick, after all tick()s
  second(world, 1) {},                     // once per sim second (economy, slow logic)
  render: {                                // optional draw hooks, see section 6
    ground(ctx, view, r) {}, underAnts(ctx, view, r) {}, overAnts(ctx, view, r) {},
    weather(ctx, view, r) {}, grade(ctx, view, r) {}, screen(ctx, view, r) {},
    nestUnder(ctx, view, r) {}, nestOver(ctx, view, r) {}, nestScreen(ctx, view, r) {},  // PLANNED (M2)
  },
});
```
`dt` is always `AL.TUNE.DT` (1/30 s of sim time). Game speed (1x/2x/4x) runs more ticks, never bigger dt.
Re-registering the same id replaces the old one.

### Events
```js
AL.on('antDied', (world, d) => {});        // returns an unsubscribe fn
AL.emit(world, 'myEvent', { ... });        // also pushed to world.events (drained each frame by the UI)
```
Core events (data fields):
| event | data | when |
|---|---|---|
| `worldCreated` | `{opts}` | end of createWorld |
| `foodDelivered` | `{col, kind, amt}` | a crumb reached a colony store |
| `bigFood` | `{col, x, y, kind, food}` | big prey dragged home |
| `scoutFound` | `{col, i, x, y, kind, big}` | a scout reached a food source and starts laying a trail home (behavior.js) |
| `gameOver` | `{winner, win, reason, t}` | `AL.Sim.endGame` |
| `antBorn` | `{col, i, caste}` | PLANNED M2 - adult ant emerged |
| `antDied` | `{col, i, caste, x, y, layer, cause}` | PLANNED M2 - cause: 'age','fight','starve','drown','creature','disease' |
| `eggLaid` | `{col, caste}` | PLANNED M2 |
| `queenDied` | `{col, colony, data}` | PLANNED M3 - set `data.handled = true` in a listener to stop the default game over (queen takeover) |
| `fight` | `{x, y, cols:[a,b]}` | PLANNED M3 - throttled, for audio/fx |
| `tunnelDug` | `{col, c, r}` | PLANNED M2 |

### Scenes (pre-colony phases: flight, founding)
```js
AL.registerScene({
  id: 'flight', order: 10,                 // flight 10, founding 20
  enabled(opts) { return !opts.skipFlight; },
  start(game, ctx) {},                     // ctx = { opts, done(patch), skip() }
  update(game, realDt) {},                 // real seconds; you run your own sim/timers
  render(c2d, game) {},                    // full canvas is yours (game.renderer.cv, .w, .h, .dpr)
  key(e) {}, pointer(type, e) {},          // optional input (lead will route; until then add your own listeners in start and remove in end)
  end(game) {},
});
```
Flow: Title -> `AL.Game.startFlow(opts)` -> each enabled scene in `order` -> `ctx.done(patch)` merges `patch`
into the options -> `AL.Game.newGame(opts)` starts colony play. A scene must clean up its DOM/listeners in `end`.

### Win checks
```js
AL.WIN_CHECKS.push(world => cond ? { winner: 0, reason: 'Held the picnic for 3 minutes' } : null); // checked each sim second
AL.Sim.endGame(world, winnerColonyId /* -1 = nobody */, reasonText);                               // first call wins
```
Core rules (M3): player queen dead -> rival wins (unless `queenDied` handled); every rival queen dead -> player wins.

## 3. createWorld options (what pre-colony scenes can patch)
```js
AL.Sim.createWorld({
  seed, species: 'fire'|'leafcutter'|'carpenter'|'army',
  playerSite: { x, y },                    // surface units; default {760,2240}
  rivalSites: [{ x, y }, ...],             // default [{3240,760}]; one AI colony per site (up to 7)
  nestPreset: 'starter' | 'founding' | fn(nest, R),   // PLANNED M2: 'founding' = entrance shaft + sealed queen cell only
  start: { workers: 40, brood: [{ caste, stage /*0 egg,1 larva,2 pupa*/ }], stock: { sugar, protein, water } }, // PLANNED M2
  queenTraits: { lifespanMul, layMul, hpMul, ... },  // free-form, stored on colony.queen.traits (flight result)
  siteTraits: { ... },                     // free-form, stored on world.player.siteTraits (founding result)
  phase: 'colony' | 'founding',            // a system may use enabled(opts) to run only in a phase
  layout: { nests: [...] },                // low level, prefer playerSite/rivalSites
  bench: N,                                // perf benchmark: N foragers on the surface
})
```
Unknown keys are kept on `world.opts`. Systems read their own keys there.

## 4. World shape
```js
world = {
  seed, R, t /*sim seconds*/, tick, over /* null | {winner, win, reason} */,
  ants: AntStore, hash: SpatialHash, surface: Surface, colonies: [Colony], player: colonies[0],
  pher: { food: [Grid per colony], alarm: [Grid per colony], avoid: Grid, recruit: Grid }, pherList,
  env: { day, timeOfDay /*0..1, 0.5 noon*/, night /*0..1*/, light /*0..1*/, rain /*0..1*/, heat /*0..1*/,
         temp /*surface °C*/, season /*'spring'|'summer'|'autumn'|'winter'*/, winter /*bool*/ },
  view: { x0, y0, x1, y1 },               // visible surface rect (+margin) for sim LOD; set by renderer
  lod, systems, events, fxq, opts,
  nest,                                   // PLANNED M2: the player's detailed nest (also colonies[0].nest)
  fog,                                    // PLANNED M3: { visibleAt(x,y), seenAt(x,y), visCell, ... }
}
```
**env is owned by the World stage** (day/night, rain, heat, seasons). Core reads: `night` (ants slow,
foragers head home), `rain` (ants slow, foragers head home, nest flooding M2), `temp` + `heat` (nest
temperature M2), `winter` (hibernation M2: no laying, ants stay inside, lower food use), `light` is for your
own grading. Without the World stage env stays a mild spring day. Rain should call
`AL.Sim.washTrails(world, keepFraction)` (it skips cells under shelters).

### Time
`AL.TUNE.DT = 1/30` per tick, `world.t` sim seconds. `AL.TUNE.DAY = 240` sim seconds per day,
`AL.TUNE.SEASON_DAYS = 3`. Matches target 30-50 real minutes at 1x.

### Coordinates
- Surface: world units, origin top-left, x right, y down, map `4000 x 3000` (`AL.Surface.W/H`).
  A worker is ~11 units long. Pheromone/obstacle cell 16 units (`surface.gw x gh` cells), fog cell 32.
- Screen: `sx = wx * view.z + view.ox` (view.z already includes devicePixelRatio).
- Nest (PLANNED M2): separate side-view space, tile = 10 units, `nest.cols x nest.rows` (90 x 60),
  x right, y down, y = 0 is ground level, row 0 is the first soil row; the mound is drawn above y < 0.

## 5. Ants (struct of arrays, `world.ants`)
Slot `i` in `0 .. ants.high-1`; `ants.state[i] === 0` means free. Never cache slots across ticks without
checking `ants.uid[i]`. Fields (all typed arrays):
`x y` position (surface units, or nest units when layer=NEST) - `px py` previous tick (render lerp) -
`a` heading rad - `turn` - `col` colony index - `caste` (`AL.CASTE`) - `state` (`AL.ST`) - `prev` -
`layer` (`AL.LAYER`: 0 SURFACE, 1 NEST, 2 INSIDE abstract) - `carry` (`AL.CARRY`) - `task` -
`hp maxhp age life` (seconds) - `timer str` - `tx ty` target point - `tgt tuid` target slot + its uid -
`uid anim wf`.
API: `ants.spawn(col, caste, layer, x, y, angle, world.R) -> i | -1`, `ants.kill(i)` (prefer the
PLANNED `AL.Combat.killAnt(world, i, cause)` which drops a corpse and emits `antDied`), `ants.count`.
Castes and their stats: `AL.CASTES[caste]` in `data.js`. Species: `AL.SPECIES`.
Neighbour queries: `AL.Sim.antsNear(world, x, y, r, j => { /* return true to stop */ })` (surface).
Custom surface states: put a handler in `world.surfaceHandlers[stateId] = (world, i, dt, senseTick) => 0|1|2`
(0 = then apply normal movement along `a`/`turn`, 1 = you positioned the ant yourself, 2 = ant left the surface/died).
Pick state ids >= 40 for stage modules (core uses < 40).

## 6. Rendering hooks
Render layers per frame, in order (surface): ground, (trails, scenery, food, mounds), **ground/underAnts**,
(ants, particles), **overAnts**, (rocks, tree shade), **weather**, **grade**, **fog** (core, M3), **screen**.
Every layer except `screen` is called with the world transform set (`ctx.setTransform(view.z,0,0,view.z,view.ox,view.oy)`),
so draw in world units. `screen` is in canvas pixels. `ctx.save/restore` is done for you.
`view = { x0,y0,x1,y1 /*visible world rect*/, z, ox, oy, w, h /*canvas px*/, dpr, cam, alpha /*tick lerp*/, frame, scene }`.
Cull with the rect. Hide rival/neutral things the player can't see with `world.fog && !world.fog.visibleAt(x,y)`.
Food visuals: `AL.Art.foodDrawers[visualName] = (ctx, food, fractionLeft, renderer) => {}` in world units.
Helpers: `AL.Art.canvas(w,h)`, `AL.Art.shade(hex,f)`, `AL.Art.mix(a,b,t)`, `AL.Art.softDot(r,'r,g,b')`,
`renderer.atlas[col].hi[caste]` ant sprites, `renderer.shadow(ctx,x,y,rx,ry)`.
Style: stylized painted 2D, lit from the upper left, soft drop shadows to the lower right, warm earthy palette.

## 7. Surface map (`world.surface`)
`W H cell gw gh` - `blocked` Uint8 per cell (1 = impassable) - `shelter` Uint8 per cell -
`foods[]` - `byId: Map` - `pois[]` - `creatures[]` - `rocks logs stones trees flowers patio nestSites`.
Helpers: `AL.Surface.isBlocked(S,x,y)`, `addFood(S, {...})`, `dropCorpse(S,x,y,col,amt)`, `foodAt(S,x,y)`,
`stampEllipse(S, S.blocked, x,y,rx,ry,rot, 1|0)` (then nothing else needed).
Food source: `{ id, kind (AL.CARRY), x, y, r, amount, max, regen /*per s*/, quality, big, needed /*carriers*/,
pull, carriers, moving, visual, poi, gone }`. Foragers take 1 crumb per trip; `big` items are dragged by
`needed`+ carriers (strength = caste drag), else cut up. Set `gone = true` to remove; set `S.foodDirty = true`
after moving/adding/removing.
**World stage owns** POIs beyond the basic food set (fruit rot, aphids/honeydew growth, puddles growing in rain,
termite mound, human zone hazards) and **creatures**. The core already places basic POIs (apples, beetles,
picnic spill, aphid plants, puddles, seeds, clover) - you may replace `AL.Surface.updatePois` behaviour by
registering a system; tell the lead in READY.md if you need core changes.

### Creatures (PLANNED M3 combat hook - shape is final)
Put creatures in `world.surface.creatures`:
`{ id, type, x, y, a, r /*body radius*/, hp, maxHp, alive, hostile /*bites ants*/, prey /*ants attack it*/,
   armor /*0..1 damage reduction*/, attackers /*set by core each tick*/, protein, needed, onDeath(world) }`.
Core combat makes nearby ants grapple prey/hostile creatures (numbers win) and subtracts hp. When hp <= 0 core
calls `onDeath(world)` if present, else turns it into a big carcass (`protein`, `needed`). Creature AI,
movement, rendering (overAnts hook) and its attacks are yours: hurt ants with `AL.Combat.hitAnt(world, i, dmg, 'creature')`.

## 8. Colony shape (`world.colonies[k]`)
```js
{ id, isPlayer, sp /*species data*/, spKey, colours, x, y /*surface entrance*/, alive,
  stock: { sugar, protein, water, seeds, leaves, fungus }, moundSoil, moundR, pop /*Int32Array per caste*/,
  surf, inNest, stats: { foodIn, born, died, kills },
  // PLANNED M2/M3:
  cap: { food, water }, queen: { alive, hp, maxHp, i, traits }, brood: [], eggQueue: [], nest /*player*/,
  inside /*Float32Array per caste, AI abstract nest*/, wound /*missing hp indoors per caste, AI*/, ai, orders /*recruit*/, hotspots /*alarm*/,
  disease /*0..100*/, nurseryTemp, siteTraits }
```
`AL.Sim.addStock(colony, AL.CARRY.SUGAR, amt)` adds to stock. Expansion stage: add satellite nests as
`colony.satellites = [{ x, y, hp, queen }]` from your own system; the core won't touch that field.

### 8a. Founding colonies: `col.founding` (founding race, `public/founding-race.js`)
When the player starts colony play while some rival queens are still founding, those rivals begin the match
as **founding nests**. The `founding-race` system (order 4) sets, on the first tick:
```js
col.founding = {
  progress,      // 0..1 toward colony stage (same formula as the founding scene's race panel)
  phase,         // 'digging' | 'sealed' | 'eggs' | 'larvae' | 'pupae' | 'nanitics' | 'open'
  colonyAt,      // nanitics needed for colony stage (per species, AL.Founding.PROFILE[sp].colonyAt)
  nanitics,      // first workers raised so far (they live in col.inside[CASTE.WORKER] / on the surface)
  opened,        // entrance open (foragers can leave)
  exposure,      // 0..~1.5: how easy the nest is to notice (scouting AI may use it)
  brood: [dev],  // development 0..1 of each brood item still growing
  dig, toLay, layRate, devRate, siege: { n, power, hp, by }, spKey, since, setup,
}
```
While `col.founding` is set:
- **ai.js must skip the colony entirely** (no breeding, no forager release, no defence release, no raids, no
  tickAI break-in). The `founding-race` system owns it: it grows the brood at the species pace
  (`M.SEC_PER_DAY` = 20 sim s per founding day), lets at most 3 nanitics forage within ~280 units, and resolves
  break-ins itself (foreign ants in GUARD/RALLY/RECRUIT/RAID/FIGHT, or wandering soldiers/majors/scouts, that
  reach the mound). An ai.js that honours this should put `skipsFounding: true` on its registered system object;
  until then `founding-race` masks founding colonies from the AI's own calls (their `col.inside` reads as `null`
  only during `ai.tick/second`).
- The colony is weak: `col.queen.maxHp` = 90 (normal 600), `col.moundSoil` = 4, low `stock`, `col.broodQ` empty.
  Killing the nanitics inside and then the queen emits `queenDied` (`data.founding = true`) and ends the colony
  the normal way (`AL.Life.queenLost`, or a `data.handled` takeover). `col.sieging`/`col.siegeLog` drive the
  normal siege bar.
- It is a valid raid target for other AI colonies; break-ins are resolved by `founding-race`, not ai.js.
- At colony stage (`nanitics >= colonyAt` and open) the system deletes `col.founding`, restores the queen
  (600 x her health fraction), hands remaining brood to `col.broodQ`, sets `col.ai.raidT >= 240 s` and emits
  **`foundingDone`** `{ col, t, x, y }`. From then on it is a normal AI colony.
Input: `opts.rivalFoundings[k]` is a founding handoff (`AL.Founding.handoff`) with `col`, plus
`race: { stillFounding: true, progress, phase, colonyAt, nanitics, opened, exposure, digLeft, digTotal, toLay,
layRate, devRate, brood }` for nests still founding, or `race: { out: true, outDay }` + `headStart` (founding days
it left before the player; it starts with extra workers and food) for rivals that finished first.
`opts.foundingRace = { day, place, of, stillFounding }` summarises the race. The number of rivals follows the
flight's landings, else `opts.rivalSpecies` / `opts.rivalSites` / `opts.colonies` (count) / `opts.rivals`, else 1.
The founding scene does not set `rivalSites` without a flight (the colonies stage owns the map layout).

### 8b. Research, perks and `col.mods` (`public/research.js`)
Every colony evolves over the match: a shared tree (Foraging, Defence, Colony; 5 nodes each) plus 2 nodes unique to its
species (`AL.Research.NODES`, `nodesFor(spKey)`), one research at a time, paid in sugar + protein when it starts, then
`time` sim seconds. A species **perk** (`AL.Research.PERKS[spKey]`, 3 each) is picked once per match (`opts.perk`; rivals get a
seeded one, or `opts.rivalPerks: [ids]` per rival, `false` for none). Deep tunnelling (raid tunnels) is the `tunnel` node; its
cost is `AL.Expansion.CFG.tunnel.research`; `AL.Expansion.canResearch/research` are wrappers.
```js
col.research = { busy, cur /*node id*/, t, dur, done: { id: true }, order: [ids], fund: { sugar, protein } /*AI savings*/,
                 tunnel /*0..1: 1 = deep tunnelling known (expansion.js, ui.js read this)*/ }
col.perk = 'stingers' | null
AL.Research.can(world, ci, id) -> { ok, why }   start(world, ci, id)   cancel(world, ci)   grant(world, ci, id) /*dev, no cost*/
AL.Research.status(world, ci, id) -> 'done' | 'researching' | 'available' | 'short' | 'locked'    progress(col) -> 0..1
AL.Research.dpsMul(col, caste)   hpMul(col, caste)   refresh(world, col) /*after changing col.perk or research.done by hand*/
```
**`col.mods`** is the ONE place effects live (rebuilt from perk + finished nodes on every change). Multipliers default 1,
`smell`/`winterLay`/`hygiene`/`leafCarry` default 0, `tunnel` false:

| field | meaning | read by |
|---|---|---|
| `hp[caste]` (Float32Array) | max hp multiplier | research.js `fixHp` scales every ant once as it appears (and again if the mods change); the queen via `col.queen` |
| `dps[caste]` (Float32Array) | damage multiplier | **combat.js `dmgOf` via `AL.Research.dpsMul(col, caste)`** (merge: keep this one call in the reworked combat's damage function) |
| `speed` `lay` `life` `dig` `appetite` `carry` `honey` | walk speed, laying rate, adult life, digging, sugar upkeep, crumbs per trip, replete capacity | `col.sp.speed/.breed/.life/.dig/.appetite/.carry/.honeyStore`: the per-colony view (below), so existing reads need no change |
| `smell` (units) `search` `trail` | sniff food this far straight ahead, forage-time multiplier, trail laid per tick | behavior.js (3 hooks marked `research:`) |
| `brood` `cold` `nursery` | brood development, nursery temperature tolerance, nursery capacity | life.js `broodRate`, `updateCaps` (AI brood queue: research.js) |
| `trailKeep` `alarm` | food trail half-life, alarm hotspot life / alarm scent | research.js (the colony's own pheromone grids, `col.hotspots[].life`) |
| `mound` `meadow` `fungus` `mill` `leafCarry` `winterLay` `hygiene` | expansion `mainMaxHp`, harvester grass, fungus yield, seed milling yield, extra leaves per leaf, winter laying share, disease decay | research.js |
| `propaganda` | slave-maker raid strength | species.js `raidIn`, `propaganda` |
| `tunnel` | deep tunnelling known | sets `col.research.tunnel = 1` |

**`col.sp` view**: research.js replaces `col.sp` with `Object.create(AL.SPECIES[key])` (so `name`, `key`, flags, colours all
read through) and gives it own values `base x mod` for `speed breed life dig appetite carry honeyStore` once a mod is not 1.
`col.sp._rsBase` is the species data. Don't assign `col.sp` yourself; don't use `col.sp === AL.SPECIES.x` (use `col.spKey`).
`col.sp.hp/.dps` are NOT modded (hp/dps go per caste through `col.mods`), and the abstract siege math in ai.js
(`power`, square-law losses) does not see research hp/dps.

Rival research: `research-late` system (order 40) picks the first available node of `AL.Research.aiOrder(spKey)` and saves
toward it from spare stock (sugar above upkeep, a share of protein; a sugar-rich rival swaps sugar for protein); it pays
`CFG.ai.cost` (90%) of the price. Founding colonies (`col.founding`) never research. Not in ai.js.

## 9. UI hooks (PLANNED M4; guard with `if (AL.UI && AL.UI.addWidget)`)
`AL.UI.toast(text, kind)` - `AL.UI.addWidget(id, { where: 'left'|'right'|'top', every: 0.5, html: world => '...' })`
- `AL.UI.hint(id, text)`. Keep DOM you create inside your own root element and remove it in `end()`.

### 9a. UI theme (style.css; polish)
Size everything you add to the HUD with these CSS variables so it follows the player's **Text** setting
(Small / Normal / Large on the title and pause menu, `ui-settings.js`, stored in `localStorage['antlands.uiSize']`)
and shrinks on phones:
| variable | Normal size | use |
|---|---|---|
| `--fs-xs` | 11.5px | tags, key hints, fine print |
| `--fs-s` | 13px | secondary lines |
| `--fs-m` | 14.5px | body text (`body` uses it) |
| `--fs-l` | 16.5px | panel titles (`.ph`) |
| `--fs-num` | 19px | key numbers (stocks, population) |
| `--fs-xl` | 24px | headings |
| `--icon` | 26px | caste / tool icons |
| `--col-w` | 258px | width of the HUD side columns `#left` / `#right` |
| `--gap`, `--pad` | 6px, 8px 11px | column gap, panel padding |
| `--k` | 1 | the combined factor (`--ui-scale` x `--fit`); `calc(Npx * var(--k))` for anything else |
| `--ui-zoom` | 1.08 | `zoom` applied to px-sized module roots (`.fd-root`, `#exp-ui`) |
| `--good` `--bad` `--info` | colours | severity (toasts, `.good` / `.bad` text) |
Classes: `.panel` (HUD box), `.ph` (panel header row; add `data-fold="<id>"` to make the panel collapsible, state
remembered), `.mute`, `.warn`, `.tipline`, `.t-xs .t-s .t-m .t-l .t-num`, `.good .bad`, `.seg` (segmented buttons),
`.bar>i` (meter). Toasts: `AL.UI.toast(text, 'bad'|'good')`, anything else is info. Widgets go in `#left`/`#right`
columns, which `AL.UI.layout()` caps above the bottom bar and the Royal chamber (they scroll instead of overlapping);
`#toasts` sit under `#topbar`. Canvas text: read `--ui-scale` from `getComputedStyle(document.documentElement)`.
Difficulty: `AL.UI.aiLevel` ('easy'|'normal'|'hard') is passed as `opts.aiLevel` by `AL.UI.startGame` unless the
caller sets its own; ai.js `AL.AI_LEVELS[level]` = `{ firstRaid, raidEvery, raidSize, breed, sight, marchRest,
playerBias, playerGap }`, `AL.AI.levelOf(col)`.

## 11. Nest API (`world.nest`, player only; AI colonies use an abstract nest)
`nest = { cols:90, rows:60, tile:10, n, kind:Uint8 (AL.Nest.TILE: OPEN TOPSOIL CLAY GRAVEL ROCK ROOT WOOD),
chamber:Uint8 (AL.Nest.CH: QUEEN NURSERY FOOD BARRACKS MIDDEN WATER FUNGUS), mark:Uint8 dig markers, prog, water:Float32 flood 0..1,
entrance:{c,r}, waterTable, caps:{queen,nursery,food,barracks,midden,water,fungus}, tiles:[ch] -> open tile indices,
corpses:[{i,x,y,a,col,t}], fields (flow fields, AL.Nest.F), version (bumps on any change), layoutVersion }`.
Helpers: `AL.Nest.carve(nest,c0,r0,c1,r1,ch)`, `carveRoom(nest,cc,rc,hw,hh,ch)`, `mark/unmark(nest,c,r)`,
`designate(nest,c,r,ch)`, `idx(nest,c,r)`, `tileOf(nest,x,y)`, `centre(nest,i)`, `rebuild(nest)` (after carving).
A founding preset: `createWorld({ nestPreset: (nest, R) => { AL.Nest.carve(...); AL.Nest.carveRoom(..., AL.Nest.CH.QUEEN) } })`
plus `start: { workers: 0, brood: [{caste:0, stage:0}], stock: {...} }`. Brood = `{caste, stage 0 egg/1 larva/2 pupa, t 0..1}`.
Ants in the nest: `layer = AL.LAYER.NEST`, x/y in nest units. Nest states: `AL.ST.N_*`, actions `AL.ACT`.

## 10. Delivery checklist (READY.md)
1. Files list and where they go (`public/...`, `test/...`), and the script tags/order you need.
2. What's done, what's stubbed, any core change you need (be specific: file, function, why).
3. How to see it in the game (keys, URL params like `?play&skipFlight`).
4. `node --check` clean, your tests pass against the current `_core` copy.
