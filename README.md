# Antlands 3D

A 3D version of [Antlands](https://github.com/Kirkb94/antlands): the same simulation, AI, UI, nest view, scenes and multiplayer, with the surface drawn by **Three.js** (`public/render3d.js`, three.js r170 vendored in `public/vendor/`). Ants are real 3D models built from the same caste and species proportions as the 2D sprites (head, thorax, gaster, mandibles, antennae, legs in a tripod walk cycle), and mounds, rocks, logs, flowers and food stand up off the ground with real-time shadows. The painted ground, trails, fog of war, day/night grade, weather and HUD are the original 2D layers, composited around the 3D scene so everything lines up and every tool works as before. Spiders, beetles, ladybugs, caterpillars, centipedes, assassin bugs, mantises, larvae and egg sacs are 3D models too, and so are their carcasses and dead ants. Press **F7** to switch between 3D and the classic 2D sprites, and **F8** (or **\\**) to page through a gallery of every 3D model beside your mound. The nuptial flight, founding and nest views are still the original 2D art.

`tools/import-antlands.js` copied the original game into this repo (run once; it only copies when `public/index.html` is missing) and vendors three.js after `npm install`.

---

# Antlands (original README)

An ant colony nature sim with strategy growing out of real ant behaviour, for the browser. Plain JavaScript and Canvas 2D: no engine, no build step, no dependencies, works offline. Same setup as the other Renegade Dev Console games.

`npm start` serves the game at http://localhost:3000 (set `PORT` to change it). `npm test` runs the logic tests (`node --test`).

## Playing
Pick a species on the title screen (fire ants, leafcutters, carpenter ants, army ants) and press Start colony. By default the match opens with the **nuptial flight** (race the rival queen to one of 8 founding sites) and the **founding** (the lone queen digs and seals a chamber and raises her first tiny workers). Untick both boxes to start straight away with a young colony: a queen, about 40 workers, some brood and a small nest. A rival colony lives elsewhere in the yard.

You don't command single ants. You lay pheromone trails and choose the eggs:

| Surface tools | |
|---|---|
| Food trail **F** | paint from the mound toward food; foragers follow and reinforce it, unused trails fade |
| Alarm **R** | soldiers pour out, rally to the spot and guard it |
| Avoid **V** | ants steer around it |
| Recruit **T** | draw a path; 10/25/50/100 ants leave the nest and walk it (soldiers guard the end, workers forage there) |
| Erase **E** | wipe your trails |

| Nest tools (Tab to zoom in) | |
|---|---|
| Dig **G** | mark soil; workers excavate tile by tile and carry it up to the mound |
| Chamber **C** | paint rooms on dug space (or on soil to dig them out): nursery, food store, barracks, midden, water, queen |
| Undo **X** | remove marks and room designations |

Other keys: drag / WASD / arrows pan, wheel / pinch / + − zoom, Tab or N nest view, Space pause, 1 2 3 speed (1x/2x/4x), H hide trails, M sound, click to inspect, Esc menu, F3 perf readout, F9 or the 5k button for the 5,000-ant benchmark (`/?bench=5000` also works).

Win by killing every rival queen (break into their mound with enough ants, or tunnel in) or by holding most of the key points for 5 minutes once they wake at 20:00. Lose if your last queen dies. Late game: raise winged queens (Royal chamber, 70+ ants) and fly them out to found satellite nests (L), research raid tunnels (K), rally fighters (Y). Seasons turn every few days; winter is a truce, so stockpile.

## Multiplayer
Up to 4 players, each with their own colony in one backyard, plus 0 to 7 AI rivals. On the title screen press **Multiplayer**, type a name and **Create room**; share the 4-letter code, and friends press Multiplayer and **Join** with it. Everyone picks a species and perk, the guests press Ready, and the host sets the AI rivals and presses Start match. The host controls pause and speed. Win by being the last colony standing or by holding the key points.

Everyone has to open the same running server: `npm start` on your own PC works for players on your network (`http://<your-PC-address>:3000`), and `render.yaml` deploys it to Render for play over the internet. Render's free plan sleeps after 15 minutes without visitors (the first page load then takes about a minute) and can restart the server at any time, deploys included.

Server restarts: rooms live only in the server's memory, but every PC keeps the start message and the whole turn log, so a match survives a restart. At the start the server gives each player a secret for their slot (kept in that browser tab's sessionStorage; the start message carries only hashes of the secrets, and a signature made with `MP_KEY`, which `render.yaml` generates once so it stays the same across restarts). When a PC reconnects and the new server doesn't know its room, it sends `rejoin` with its slot, secret and last turn; the server asks the host's PC to upload the start and the turn log (`restore`, `restoreLog` chunks, `restoreEnd`), checks it (signature when `MP_KEY` is set, the host's own secret, at most 4 players, sane species/names/settings, turns numbered from 0 with valid step counts and commands, 32 MB and 300,000 turns at most) and rebuilds the room, waiting 3 s so a PC that got a turn or two the host missed can add them. Everyone then takes their slot back by their secret, gets only the turns they lack, and the turns go on from the end of the log; hash checks continue. A restore never replaces a room the server knows. If the host's PC doesn't come back within 30 s (`MP_RESTORE_WAIT`, ms) the others see "The server restarted and this match was lost". PCs also see a screen when the server can't be reached for a while (it keeps retrying; Give up goes back to the title) and when their match ended (its room closed after everyone left). Tests: `test/net-restore.test.js` (server side: restore, slot claims, every refusal).

How it works: lockstep. Every PC runs the same simulation from the same seed; `server.js` only relays each player's commands in numbered 100 ms turns (WebSocket at `/mp`, no dependencies) and keeps the turn log, so a PC that reloads or reconnects replays the match and catches up. PCs report a world hash every 5 s and see a warning if one drifts out of sync. Every change a player makes to the world goes through `AL.Cmd` (`public/cmd.js`; brushes in `public/brush.js`), so new player actions must be added as commands, not as direct world edits from UI code. Each human colony has the full player model (its own nest, brood, orders, research); `world.me` is this PC's colony (UI only), and ants inside a nest carry the nest owner in `ants.nest`.

## Systems
- **Ants** live in typed arrays (struct of arrays, `ants.js`) with a spatial hash; the sim runs at a fixed 30 Hz separate from rendering, which interpolates. Off-screen ants update every other tick once the colony is big (sim LOD).
- **Pheromones** (`pheromone.js`): a Float32Array grid per kind (food trail per colony, alarm per colony, avoid, recruit) with evaporation, light diffusion and reinforcement by traffic.
- **Foraging** (`behavior.js`): wander, smell food, pick up one crumb, walk home by path integration laying a food trail, deliver. Big prey needs enough carriers pulling the same way (numbers win the tug of war) or gets cut up.
- **Nest** (`nest.js`, `life.js`): 90x60 side-view soil grid (topsoil, clay, gravel lenses, rocks and roots you can't dig, a water table). Ants navigate by flow fields. Sugar feeds adults, protein raises larvae; in people's colonies every ant has its own stomach and walks to a food store to eat, surface ants come home hungry, and nurses carry food to the larvae and the queen (`hunger.js`; AI rivals pay one colony upkeep), stores have capacity from their area, protein spoils, overflow spoils fast, honeypots hold sugar that keeps. Brood speed depends on nursery temperature (depth + mound size), nurses, water and disease. Ants age and die; bodies left in tunnels raise disease until carried to the midden. Rain floods the lowest tunnels; gravel can cave in.
- **Combat** (`combat.js`): ants grapple and bite; extra attackers stack, so numbers win. Soldiers and majors hit harder. Fights lay alarm pheromone and call soldiers. Creatures plug in through `world.surface.creatures`.
- **Injuries** (`injury.js`, tuning `AL.INJURY` in `data.js`): bites can cost legs (big jaws most) and rarely heads. Limbs never grow back: each lost leg is 20% slower, no legs on one side walks the ant in circles, a headless ant wanders blind until it starves.
- **Rival AI** (`ai.js`): abstract nest (counts, not tiles) that forages with the same behaviour, breeds, defends and raids. Raiders break into your nest, fight in the tunnels, steal food and go for the queen. Your ants that reach its mound fight the defenders inside (square-law) and then the queen.
- **Fog of war + scent** (`fog.js`): you see what your ants see; enemies just beyond sight show as drifting scent wisps.
- **Rendering** (`art.js`, `render.js`, `render-nest.js`, `render-bars.js`): all art is drawn with Canvas paths at load time. Pre-rotated low-res sprite atlas with baked shadows for many ants, high-res rotated sprites up close, dots when zoomed far out; painted ground with cached detail chunks; smooth zoom transition from the surface into the mound; health bars over hurt ants and creatures (fade a few seconds after the last hit, batched, render only).
- **UI**: `ui.js` (HUD, egg queue, tools), `ui-game.js` (minimap, toasts, game over), `ui-screens.js` (title, how to play, menu), `ui-hints.js` (first-time tips), `audio.js` (WebAudio synth, off by default).
- **Stages**: modules built in parallel plug in through `docs/CONTRACT.md` (systems, events, scenes, render layers). Integrated: nuptial flight (`flight.js`, `flight-scene.js`), founding (`founding-sites.js`, `founding.js`, `founding-scene.js`), expansion (`expansion.js`, `victory.js`, `expansion-art.js`, `expansion-ui.js`) and the world (`world-time.js`, `world-poi.js`, `world-creatures.js`, `world-fog.js`, `world-art.js`, `world-fx.js`).

See `docs/DESIGN.md` for the full design and what's built vs planned.
