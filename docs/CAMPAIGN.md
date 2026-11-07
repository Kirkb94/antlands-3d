# Campaign mode: A Backyard Summer

Ten short scenario missions that teach the game and then test it, told as one backyard's summer. Title screen ->
**Campaign** -> mission map (locked / open / done, stars) -> briefing -> the normal scene flow -> win / lose card.

## Files
| File | What |
|---|---|
| `public/campaign.js` | Sim only (runs in Node). Mission data, the `campaign` system (order 40), objective trackers, script actions, saved-progress helpers. |
| `public/campaign-ui.js` | Browser only. Mission map (code-drawn yard), briefing, HUD objectives panel (`AL.UI.addWidget('campaign')`), toasts, end card. |
| `public/ui-screens.js` | One button (`#btnCampaign`) next to Start colony, plus its click handler. |
| `public/index.html` | `campaign.js` after `world-fog.js`; `campaign-ui.js` after `world-fx.js` (it must load after `expansion-ui.js`, whose end screen it wraps). |
| `test/campaign.test.js` | Data, trackers, progress storage, every mission won by a scripted strategy, every tutorial completed by a scripted player. |

## The missions
| # | Mission | Species | Map | Teaches / tests | Goals (bonus) |
|---|---|---|---|---|---|
| 1 | First Foragers | fire | solo | Food trail tool | trail to aphids, 150 sugar (80 protein, inside 5:00) |
| 2 | Dig Deep | fire | solo, founding nest | nest view, Chamber tool, brood | nursery 24 tiles, food store 20, raise 30 (midden, 9:00) |
| 3 | The Storm | leafcutter | solo | forecast telegraph, floods | ride out a scripted storm, lose <= 4 brood (none lost, water reservoir) |
| 4 | Neighbours | carpenter | 2 colonies | fog, scouting, defence | find the rival nest, beat off the scripted raid (20 kills, no brood lost in the raid) |
| 5 | The Mower | honeypot | solo | Mower alarm [U] | alarm before the blades, wait out the mow, <= 12 crushed (<= 2, 120 sugar) |
| 6 | The Founding Race | fire | 4 colonies, founding scene on | founding speed, raiding founding nests | open while a rival still founds, raze a founding nest (finish first, inside 7:00) |
| 7 | Big Game | army | 3 colonies (fair map) | March [B], termite mound, big prey | march, breach the termite mound, 300 protein (6 big prey, a wolf spider) |
| 8 | Two Fronts | slave-maker | 6 colonies | key points, Rally, captives | fill the hold meter (points wake 1:30, 3:00 hold) (40 captives, every point at once) |
| 9 | Winter Is Coming | harvester | solo, autumn | seasons, hibernation | 260 food before winter, wake in spring with 40+ ants (<= 3 lost to cold, 420 food) |
| 10 | Queen of the Yard | player's pick | 4 colonies | everything | win the match (points wake 10:00, 4:00 hold) (kill 2 queens, inside 30:00) |

## Species tutorials
Eight guided tutorials (`AL.Campaign.TUTORIALS`, ids `tut-<species>`), one per species, 5-7 steps each, built on the same
runner: a tutorial's `steps` are objectives that run **one at a time** (a step's tracker starts counting when it becomes
active), auto-advance when met, never fail (a failed step restarts), and the panel has **Back** / **Skip step**
(`AL.Campaign.backStep / skipStep`). Each step has `text`, `help`, optional `hl` (CSS selector of the HUD element to pulse,
e.g. the Food trail tool or an egg button), `spot` (a yard target ringed on screen above the fog, with an edge arrow when
off screen; the fog lifts there) and `start` actions (msg, time, stock, food, spawn, reveal). Safe setup: solo yard (the
slave-maker one has a calm, revealed fire-ant neighbour whose queen can't die: `setup.sturdyRivals`), calm weather, no
mower, generous stock, no raids.
| Species | Steps |
|---|---|
| fire | food trail to aphids, 30 sugar, nest view, dig 6 tiles, queue 2 soldiers, raise 8, kill a beetle with Alarm |
| leafcutter | trail to clover, 15 leaves, nest view, grow 6 fungus, enlarge the fungus garden, raise 6 |
| carpenter | food trail, nest view, dig 4 tiles of the buried stump, drag a dead beetle home whole, queue a major, nightfall |
| army | Recruit a raiding party, kill a beetle, 30 protein, March the bivouac, queue soldiers, raise 8 |
| honeypot | trail to aphids, 40 sugar, nest view, a new replete, bank 15 honey, live 30 s off the honey (sugar set to 0) |
| harvester | trail to seed heads, 20 seeds, queue a major, raise it, nest view, mill 6 seeds |
| slavemaker | captives in the nest, find the revealed rival, Recruit onto its mound, steal 2 pupae, a captive hatches |
| bullet | food trail, 30 food (3-crumb loads), hunt a caterpillar, queue a worker, raise a hunter (bonus: lose no ants) |

Entry points: a **Species tutorials** tab on the campaign screen, and the first time a player starts a free game with a
species, a prompt offers its tutorial (Play the tutorial / Skip; remembered per species in `localStorage['antlands.tutSeen']`).
New UI events the sim trackers read: `viewChanged { view }` (campaign-ui wraps `UI.onView`) and `eggQueued { col, caste }`
(egg button clicks). Free-play `ui-hints` are hidden in campaign and tutorial worlds (`body.campaign #hint`), so only one
set of guidance shows. Panel type sizes are relative (`em`) so the shared HUD type scale enlarges them.

## Mission format (all data, see `MISSIONS` in campaign.js)
- `opts`: createWorld / startFlow options (`seed`, `colonies`, `rivalSites: []` for a solo yard, `rivalSpecies`, `start`,
  `nestPreset`, `worldTime`, `keypointsAt`, `skipFounding: false`). `AL.Campaign.optsFor(id, extra)` adds
  `campaign: id`, `skipFlight`, the species and the rival species, so every mission is deterministic.
- `setup`: applied in the system's `init`: `calm` (clear weather for N s), `noMower`, `noFeet`, `ants` (extra player ants
  by caste), `rivalsCalm` (rival raid timer), `keypoints: { hold }` (no `keypoints` and `keypointsAt` off = no key points).
- `script`: `{ at | after: goalId, delay, unless: goalId, msg | weather (lead, dur) | mower | raid { col, soldiers, workers } | reveal | spawn | time }`.
  Uses the existing helpers: `AL.World.setTime / forceWeather` (and the weather's own telegraph via `weather.next/timer`),
  `AL.WorldPOI.startMower`, `AL.AI.discover` + the AI's raid timer.
- `goals` (all needed) and `bonus` (one star each). Tracker types: `deliver trail born pop chamber weather lossMax
  findColony defendRaid recall mowerDone foundingAhead foundingPlace killFounding march breach bigPrey hunt kills hold
  allPoints captives stock hibernate win killQueens within survive`. `lossMax` and `within` are keep-type (they hold
  unless violated). A failed primary goal fails the mission.
- Events read: `foodDelivered bigFood antBorn antDied broodLost raid mower queenDied termitesBreached creatureDied march
  gameOver`, plus `trailPainted` (new, emitted by campaign-ui when a Food trail stroke ends). Emitted: `campaignMsg`,
  `campaignObjective`, `campaignEnd` (`{ id, win, stars, bonus[], time, reason }`, also on `world.over.campaign`).

## Progress
`localStorage['antlands.campaign'] = { v: 1, missions: { id: { done, stars, bonus[], best, plays } } }`, read and written in
try/catch. Mission 1 is open; each later one opens when the one before is won. Stars = 1 + bonus objectives ever met.

## Judgment calls
- "One colony's story": the throughline is the patio fire-ant colony (missions 1, 2, 6, and it is the raider in 4); the
  species-fixed missions are chapters about its neighbours in the same yard, so the mix of species fits one summer.
- Mission 6 cannot be won if every rival finishes founding first, so "open while a rival still founds" is a primary goal
  that fails at once (with a debrief saying how to found faster); finishing first is a bonus.
- A core victory (every rival queen dead, or the hold meter) counts as a mission win; a core defeat as a loss.
- Missions without key points hide the hold strip and clear the points; free-play tutorial hints are hidden in campaign
  worlds (the mission messages and objectives do that job).
- Seeds are fixed per mission, so a mission plays the same map every time.
