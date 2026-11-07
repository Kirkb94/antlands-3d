# Antlands design

Source: Uno's design survey (October 2026). This file records the spec and the state of the build.

## Pillars
- **Nature sim first.** Real ant behaviour; strategy grows out of it.
- **Stylized 2D**: clean, painted, readable at a glance. All art code-drawn for now (raster art goes through Sprite Forge approval later).
- **Control by pheromone trails only.** No box-select. Trails fade unless ants keep walking them.
- Matches 30-50 min, eventually 6-8 colonies on a backyard-sized map. A mature colony is thousands of ants on screen.

## Spec summary
- Fog of war **plus scent** (smell enemies before you see them).
- Trails: food, alarm, dig marker, danger/avoid, recruitment (pull N ants from the nest).
- The queen never leaves her chamber. Food is carried home crumb by crumb; big prey needs several carriers.
- Economy: sugar feeds adults, protein makes brood; also water, leaves, seeds, soil. Storage chambers with capacity, honeypot repletes as living storage, food spoils and can be stolen. Aphids can be herded.
- Castes: workers, nurses, foragers, scouts, soldiers, majors, honeypots, winged reproductives. You choose each egg (egg queue). Ants age and die. Research/evolution tree later.
- Nest: free digging on a soil grid in side view; chambers: queen, nursery, food store, fungus garden, barracks, water reservoir, midden, aphid stable. Hazards: flooding, cave-ins, rocks and roots, temperature, disease. The mound grows from excavated soil, keeps brood warm, defends the entrance and shows colony strength. Smooth zoom from the surface into the mound.
- Combat: numbers win. Neutral creatures are threat and prey. Points of interest: dead insects, fallen fruit (rots), picnic spill, aphid colonies, puddles, termite mound, shelters, human zones.
- World: day/night, rain storms (flood tunnels, wash trails), heat waves, seasons with winter hibernation.
- Win by killing every rival queen or holding key points; satellite queens; queen takeover.
- Species: Fire ants (baseline), Leafcutters (fungus), Army ants (bivouac, raids), Carpenter ants (wood, big workers).
- Later: nuptial flight race, founding phase, 8 founding sites, online multiplayer, campaign.

## Built (this slice)
| Area | State |
|---|---|
| Sim core: SoA ants, spatial hash, fixed 30 Hz step, pheromone grids, foraging, LOD, 5k benchmark | done |
| Nest: soil layers, rocks, roots, water table, dig markers, chambers + capacity, flow-field navigation | done |
| Brood + egg queue, sugar/protein economy, spoilage, honeypots, temperature, aging, disease, midden, flooding, cave-ins | done |
| Surface: backyard map, apples (rot), dead insects (multi-carrier), picnic spill, aphid honeydew, puddles, seeds, clover, rock shelter, renewable insect litter | done |
| Tools: food, alarm, avoid, recruit, erase, dig, chamber, undo | done |
| Rival fire-ant AI: forage, breed, defend, raid, break in, steal; siege of its mound; win/lose | done |
| Fog of war + scent wisps, minimap | done |
| Smooth surface <-> nest zoom | done |
| HUD, tooltips, inspect click, hints, title, how to play, menu, game over, speeds 1/2/4x, keyboard + mouse + touch, phone landscape viewing | done |
| Audio (WebAudio synth, off by default) | basic |
| Nuptial flight (Flight stage) | integrated |
| Founding phase, 8 sites with soil variants, site traits feeding colony play (Founding stage) | integrated |
| Founding race: every rival queen founds alongside you (race panel + map, species pace), colony stage lets you leave early, rivals still founding start the match small and raidable, rivals already out scout and raid founding nests (telegraphed) | done |
| Day/night, weather (rain, storms, heat waves, snow), seasons with a winter truce, creatures (spider, beetles, ladybugs, caterpillars, robin, termite mound), aphid herding, human zone (footsteps, mower, sprinklers, picnic) (World stage) | integrated; core reads per-species night speed, heat in open sun and the World flood inflow |
| Winged queens, satellite nests, queen takeover, raid tunnels, rally, key points (wake at 20:00, hold 5:00 to win), victory screen (Expansion stage) | integrated |
| Species: fire (baseline), leafcutter (fungus garden), carpenter (big workers, wood), army (no digging, living bivouac, March tool) | done; army bivouac is nomadic (statary/nomadic cycle, the colony marches with brood and queen; rivals march on their own, bivouac.js) |
| Campaign "A Backyard Summer": 10 scenario missions (data + a mission-runner system, objectives panel, mission map, briefings, win/lose card, saved progress); plus 8 guided species tutorials; see docs/CAMPAIGN.md | done |
| Research / evolution tree: 3 shared branches (Foraging, Defence, Colony) x 5 nodes + 2 species nodes each, one at a time, Evolution panel [J], rivals research from a priority list; raid tunnels are its Deep tunnelling node | done |
| Species perks: 3 per species (pick 1 on the title screen; rivals seeded), each a trade-off | done |
| Species: fire (baseline), leafcutter (fungus garden), carpenter (big workers, wood), army (no digging, living bivouac, March tool) | done (army is a simplified bivouac: the nest is a fixed cavern) |

## Judgment calls
- Key points wake at 20 minutes and need a 5-minute hold, so the hold win lands inside the 30-50 minute match window instead of at 8 minutes (the Expansion stage shipped 5:00 + 3:00).
- Nest floods are capped at about a third of the open tunnels; ants swim for the entrance and brood survives a short soaking (World storms otherwise drowned whole starter nests).
- The rival nest is abstract (numbers by caste) so the CPU budget goes to the player's detailed nest and the surface. Sieges inside it are resolved with a square-law model.
- Homing uses path integration (real ants do this) instead of a home pheromone, which halves the trail grids.
- Outbound foragers on a trail prefer the direction away from home; painted food trails get slightly stronger toward the far end.
- Insects and crumbs keep turning up across the yard (most near the colonies) so protein never dries up completely.
- Research is colony evolution, not tech: every node is a real ant trait (antennae, exoskeleton, royal jelly, polygyny,
  replete size, fungus strains). One research at a time; the whole tree is ~30 minutes of research time plus the food,
  so a full tree takes most of a 30-50 minute match. Costs lean on protein (players hold more protein than sugar).
- Rivals pay 90% of the price and save for it out of spare stock; their abstract economy holds almost no protein, so a
  sugar-rich rival may swap sugar for protein. Strong rivals finish the tree around 35-40 minutes, weak ones stall.
- Perks always trade something away (a stat below 1 or a start bonus only) so none is strictly best. Perks use the same
  `col.mods` as research but are distinct choices from the species' own research nodes.
- Effects reach the existing code through one object (`col.mods`) plus a per-colony `col.sp` view, so most systems needed
  no edits; hp is applied per ant by research.js, damage through one call in combat.
- Key J opens the Evolution panel (G, the brief's suggestion, is Dig).
- Perk balance (hands-off player, 15 min, 4 colonies, seeds 5-8): no perk dominates its species beyond the run-to-run noise,
  which is large (any change to a colony moves its 15-minute population by up to +-40%). Outliers were tuned: fast cutters
  and bigger brood toned down, swarm founding and heartwood borers given a softer downside, thrifty honeypots pay with
  smaller repletes instead of speed. Combat perks barely show hands-off; they matter in fights.
- Research for a hands-off player who buys nodes when it can spare the food (15 min, seeds 5-8): fire +7% food and -12%
  deaths, leafcutter +13% food, carpenter +15% population and -18% deaths, bullet ants roughly even (research competes
  with their protein-hungry brood). The tree is a long-game investment, not an early power spike.
