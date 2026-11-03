# Infinity Mansion: Napoli MVP Design Doc

Nov 3, 2026 · @Marzuwq Muhammad

## Summary

The first build is a single-player browser slice of Infinity Mansion: one agent, one city, three procedural areas, and a Federation commander to take down. A run should last about 15-20 minutes. It exists to test the mechanics, not to look finished.

The build needs to answer five questions:

| Question | What a good result looks like |
| --- | --- |
| Can stealth, gun-fu, and talking each get you through an area? | Testers clear areas in different ways, and no single approach feels like the only sensible one |
| Does suspicion make talking a real decision? | Players think before starting a risky conversation |
| Does losing your gear for a run feel fair? | Players try another loadout after extraction instead of quitting |
| Do recurring characters pull players back? | Testers want to see how Lucca and Lucretia react on the next run |
| Do procedural areas stay readable? | Players can find treasure and the exit without getting lost |

## Premise

The Earth Federation, from another version of Earth, is invading and kidnapping people across the planet. The UN is losing the war, but a huge battle outside the Infinity Mansion gives the agent, who works for a powerful underground organization, a way in.

The Mansion is one of many planetary gateways. The Federation rarely uses it because it's unstable, so it's less well guarded. The UN secured a forward operating base (FOB) there at great cost, making it the only route it can use.

The agent's assignment is to push deep into the Federation's plane and take out its top general. Along the way, players learn from key people and intel that the kidnapped are being harvested for organs. Brains are especially valuable as wetware computers.

**In this build:** the game takes place only in Napoli, on the alternate Earth ruled by the Global Roman Empire. Federation forces and the local forces they control hold the city. The Mansion and the top general come later.

## Run loop

A run starts at the FOB and moves through three Napoli areas to Commander Hale. Players win by taking him down, and stealth counts. If their health reaches zero, they're extracted to the FOB before they die.

&#91;embedded content: run loop · three areas, two endings\]

Extraction can happen in any area. A failed run costs time and gear access, not cash.

1. **Prepare.** Spend cash and choose a loadout from a simple FOB menu.
2. **Get through Areas 1 and 2.** Find each exit. Deal with hostiles by fighting, shooting, sneaking, or talking, and search for treasure along the way.
3. **Take down the commander.** Area 3 always ends with him, and there's no exit until he's down.
4. **Return to the FOB.** Cash is kept after a win or an extraction, so every run pays something.

**Extraction rules**

- Players can't call for extraction themselves.
- Extraction has no direct cost, and all cash is kept.
- Gear carried on that run is locked for the next run, then comes back.
- Lucca, Lucretia, and the commander remember what happened.

**Area order:** Areas 1 and 2 are drawn at random from Porto, Spaccanapoli, and Quartieri. Area 3 is always the Castel garrison.

## Combat and camera

Combat is third-person gun-fu, split about evenly between guns and melee. Guns handle open fights. Melee ends fights quickly and keeps the agent under the radar.

This section adapts the [gun-fu combat spec](https://claude.ai/artifact/UQoq4YJfNWtHcMwkS5fcHV) and keeps its numbers where they still fit. The setting is contemporary, so powers and their supporting systems are gone. Frame counts run at 60 frames per second.

| Move | Xbox / keyboard | Timing (frames) | Effect |
| --- | --- | --- | --- |
| Light string | X / E | 6-3-10, 7-3-11, 9-4-16 | 8, 8, then 14 damage |
| Heavy | Y / Q | 14-4-20 | 24 damage, 24-frame hitstun |
| Point-blank shot | RT / left mouse during a strike | 4-frame snap | Fires at the melee target once per strike |
| Parry | LB tap / Ctrl | 8-frame window | Stops a melee attack and staggers the attacker for 45 frames |
| Block | LB hold / Ctrl | Continuous | Cuts melee damage by 70% |
| Dodge | A / Space | 20 total, 3-14 invulnerable | Moves 3.2 m |
| Takedown | B / F | 40 total | Instantly and silently kills an unaware hostile within 2 m |
| Execution | B / F | 70 total, 1-50 invulnerable | Instantly and silently kills a staggered or knocked-down hostile |
| Throw | B / F | 50 total | 30 damage on landing, 90-frame knockdown |
| Aim and fire | LT, RT / right, left mouse | By weapon | Aimed shots use the current weapon |

B does one job at a time: Takedown on an unaware target, Execution on a staggered or knocked-down one, otherwise Throw.

**Other controls**

| Action | Xbox / keyboard |
| --- | --- |
| Move | Left stick / WASD |
| Camera | Right stick / mouse |
| Sprint | L3 / Shift |
| Lock-on | R3 / middle mouse |
| Interact (talk, loot, exit) | RB / R |
| Swap weapon | D-pad left or right / 1, 2 |
| Use item | D-pad up / 3 |
| Reload (automatic when empty) | D-pad down / T |
| Pause | Start / Esc |
| Debug panel | Back / backtick |

**Health and armor:** the agent has 100 health, which doesn't regenerate. Armor absorbs gunfire before health, but melee damage goes straight to health.

**Camera:** one third-person camera moves between modes with a spring-damper, using the spec's values.

| Mode | When | Distance (m) | Height (m) | Side offset (m) | Field of view |
| --- | --- | --- | --- | --- | --- |
| Explore | Default | 4.5 | 1.8 | 0.6 | 60° |
| Melee | Close fight | 6.5 | 2.6 | 0.3 | 65° |
| Aim | Aim held | 1.8 | 1.6 | 0.8 | 45° |
| Conversation | Talking | 2.2 | 1.4 | 0.8 | 50° |

**Hostiles (starting values)**

| Hostile | Force | Health | Attack | Can be talked down? |
| --- | --- | --- | --- | --- |
| Legionary | Federation-occupied local forces | 60 | Baton and pistol | Yes, with a low trust target |
| Trooper | Federation | 100 | Rifle | Yes, with a high trust target |
| Escort (2) | Federation | 100 | Rifle | No |
| Commander Hale | Federation | 300 | Rifle and melee | No |

Hale can't be thrown, and Execution only works on him at 30% health or below. A Takedown still works if he's unaware, which is what makes the stealth win possible.

## Suspicion

Suspicion is a 0-100 meter for the current area. At 100, every hostile in the area knows where the agent is and converges on them. It doesn't fall during an area, then resets to 0 in the next one.

| Event | Suspicion |
| --- | --- |
| Loud gunfire | +20, at most once every 3 seconds |
| Silenced shot seen by a hostile | +10 |
| Silenced shot nobody sees | 0 |
| Failed conversation | +15 |
| Melee strike, Takedown, or Execution | 0 |
| Signal jammer | -25 |

&#91;embedded content: hostile encounter flow · patrol to outcome\]

A hostile's state decides which options the player still has. Once one goes to Alert, talking is off the table.

**How hostiles behave**

- **Patrol:** they follow a route with a 90° vision cone reaching 14 m. Spotting the agent takes 0.75 seconds. A sprinting agent draws attention within 5 m.
- **Challenge:** a hostile who can be talked down walks over and starts a conversation. One who can't goes straight to Alert.
- **Alert:** they attack, and hostiles within 10 m join in. Alerted hostiles can't be talked to. They return to Patrol after 20 seconds without seeing the agent.
- **Witnesses:** a hostile who sees a Takedown goes to Alert, but suspicion doesn't rise.
- **Loud gunfire:** every hostile within 30 m goes to Alert.

## Talking

Conversations are scripted in this build, but they use the same hidden values AI characters can use later. Talking can prevent fights and earn bonuses. Choices and intel decide the outcome, with no dice rolls, and a smooth talker can win on charm alone.

The action pauses during a conversation. Its risk comes from suspicion, not the clock.

| Hidden value | Scope | Purpose |
| --- | --- | --- |
| Trust (-100 to 100) | One conversation for generic hostiles, saved between runs for Lucca and Lucretia | Decides success |
| Intel flags | Current run | Unlock stronger lines |
| Suspicion | Current area | Sets the cost of failure |

**How a conversation works**

1. The character opens with a line based on who they are and what they remember.
2. Three exchanges follow, with three or four replies each. Each reply changes trust.
3. Lines that suit the character's personality gain the most trust, up to +15.
4. Intel lines gain +25 and only appear if the player has the matching intel. Bribe lines spend cash.
5. After the last exchange, the game compares trust with the target. Legionaries start at a target of 20 and Troopers at 40.

**Results**

- **Success:** the hostile stands down and may reveal the exit, reveal a treasure cache, or hand over intel.
- **Failure:** suspicion rises by 15, and the hostile goes to Alert.

**Content rule:** every character who can be talked down needs a path to success using charm alone. Intel and bribes are shortcuts, not requirements.

**Intel in this build**

| Intel | Found in | What it does |
| --- | --- | --- |
| Patrol codes | Areas 1 and 2 | Unlocks a strong bluff line with Legionaries and Troopers |
| Hale's schedule | Areas 1 and 2 | Marks Hale's position in Area 3 |
| Transport manifest | Areas 1 and 2 | Hints at what's happening to the kidnapped and unlocks a line with Lucretia |

Areas 1 and 2 each hold one random piece of intel. A character can also hand one over after a successful conversation.

## Napoli and cast

Napoli stays the same place between runs, but its areas are rebuilt each time from street-sized blocks. A fixed cast gives that random layout some continuity: the map changes, but the people remember you.

| Area | Position | Layout | Hostiles |
| --- | --- | --- | --- |
| Porto | 1 or 2 | Open docks and long sightlines | Mostly Legionaries |
| Spaccanapoli | 1 or 2 | One long street with side passages | Mixed |
| Quartieri | 1 or 2 | Tight alleys and courtyards | Mostly Legionaries |
| Castel garrison | Always 3 | Walled compound | Mostly Troopers, plus Hale and his escorts |

**Generation rules**

- Build each area on a 6 x 6 grid of 12 m blocks, using street, alley, courtyard, and piazza pieces.
- Keep the entrance and exit at least 50 m apart, with a guaranteed path between them.
- Place 8-12 hostiles in Areas 1 and 2, and 12-15 in Area 3.
- Place 3-4 treasure caches in each area.
- Use a seed so the same run can be replayed, and show it in the debug panel.

**Cast**

| Character | Role | Starting trust | What they offer |
| --- | --- | --- | --- |
| Lucca | Gunsmith, sympathetic to the cause | 30 | Sells ammo, medkits, and smoke, with a discount at trust 60 or higher |
| Lucretia | Informant, not sympathetic at first | -30 | Gives intel and reveals exits or caches at trust 30 or higher, or for a bribe |
| Commander Hale | Runs the occupation | n/a | Can't be talked down, but he holds a grudge |

**Finding them:** Lucca and Lucretia each have a 50% chance of appearing in an area. If either hasn't appeared by Area 2, they're guaranteed to appear there.

**Lucretia:** her trust can rise by at most 20 per conversation, so winning her over takes a few meetings. Until then, a bribe buys her help once.

**Memory:** the game saves trust, number of meetings, and the last conversation result for Lucca and Lucretia. Their opening lines change with those values.

**Hale's grudge:** if he's involved in an extraction, he taunts the agent on the next encounter and brings one more escort. He can bring up to two extra, and the grudge clears when he's beaten.

## Gear and economy

The agent always starts with a silenced pistol and a ballistic vest, which never lock. Everything else is bought with cash, which is earned from treasure and kept after every run. Prices and stats are starting values for playtesting.

**Starter kit**

| Item | Stats |
| --- | --- |
| Silenced pistol | 18 damage, double on a headshot, 12 rounds, 12-frame fire interval, 84-frame reload |
| Ballistic vest | 50 armor, which doesn't regenerate |

**FOB shop**

| Item | Type | Cash | Effect |
| --- | --- | --- | --- |
| Heavy revolver | Owned gear | 600 | Loud, 55 damage, 6 rounds, 36-frame fire interval, 120-frame reload |
| Compact SMG | Owned gear | 800 | Loud, 12 damage, 30 rounds, 6-frame fire interval, 96-frame reload |
| Plate carrier | Owned gear | 700 | Replaces the vest with 100 armor |
| Signal jammer | Owned gear | 500 | Removes 25 suspicion, once per area |
| Smoke grenade | Run-only | 100 | Blocks vision for 8 seconds |
| Medkit | Run-only | 150 | Restores 50 health |
| Conditioning | Permanent upgrade | 1,000 | Adds 20 max health |
| Cover identity | Permanent upgrade | 1,200 | The first failed conversation in each area adds no suspicion |

**Loadout:** the starter kit, plus one extra weapon, one armor upgrade, one gadget, and up to two run-only items.

**Gear lock:** owned gear carried on a run that ends in extraction is locked for the next run, then comes back. Run-only items are used up, and permanent upgrades stay active.

**Treasure**

| Find | Odds | Result |
| --- | --- | --- |
| Valuables | 70% | 100-300 cash, kept even after extraction |
| Run item | 30% | Medkit, smoke grenade, ammo, or an armor plate that restores 25 armor |

Cash is one wallet. It pays for the FOB shop, Lucca's stock, and bribes.

## Tech and scope

The build uses the gun-fu spec's stack and gray-box visuals. Characters are capsule rigs built in code, so there are no art assets to source. The build is finished when every mechanic works, not when it looks good.

| Piece | Choice |
| --- | --- |
| Rendering | Three.js |
| Physics | Rapier (`@dimforge/rapier3d-compat`) |
| Language and build | Strict TypeScript and Vite |
| Simulation | Fixed 60 Hz, separate from rendering |
| Input | Gamepad first, keyboard and mouse fallback |
| Tuning | All numbers in `tuning.ts`, exposed in a lil-gui debug panel |
| Conversations | JSON content behind a `DialogueProvider` interface |
| Saves | Versioned localStorage save |
| Tests | vitest for game logic |

**Readability over looks:** colors separate Legionaries, Troopers, Hale, and the named cast. Hostiles show a yellow outline during Challenge and a red outline during Alert.

**Run summary:** each run ends with a screen showing time, kills, Takedowns, conversations won and lost, peak suspicion, and cash earned. This gives playtests something concrete to compare.

**Not in this build**

- Co-op, including redeploying in the next area
- The Infinity Mansion, other alternate Earths, and the top general
- Free-speaking AI characters and voice input
- A walkable FOB (it's a menu here)
- Photo-based characters
- Cover snapping, Mass Effect-style powers, scanning, and environmental hazards
- Final art, audio, and the full one-hour run

**Assumptions to confirm**

- A win doesn't lock gear. Only extraction does.
- The action pauses during conversations.
- Silenced shots raise suspicion only when seen. This keeps gunfire and stealth compatible now that the starter pistol is silenced.
- A staggered or knocked-down hostile can be executed at any health, so melee can end fights instantly.
- "Legionary" and "Commander Hale" are placeholder names.
- The 15-20 minute run, area sizes, prices, and stats are starting values.

## Claude Code build prompt

Export this doc as Markdown, save it as `docs/design.md` in an empty repo, and give Claude Code the prompt below. The doc includes everything it needs, so it doesn't need access to the gun-fu spec.

```
Build the complete Infinity Mansion Napoli MVP from docs/design.md. That file is the source of truth, so read all of it before writing code.

This is a mechanics test, not a polished game. Use gray-box visuals, but every mechanic in the doc must work end to end.

Work autonomously. Don't stop at milestones or ask for approval. If the doc leaves something open, choose the simplest option that fits it, record the choice in DECISIONS.md, and keep going. Stop only if you're truly blocked.

Stack
- Three.js, strict TypeScript, Vite, @dimforge/rapier3d-compat, lil-gui, and vitest
- Browser only, with gamepad first and keyboard and mouse as a fallback
- No external art, animation, or audio assets. Build characters in code with a capsule rig and keyed poses

Architecture rules
- Run the simulation at a fixed 60 Hz. Combat logic must never read the renderer
- Keep every tunable number in src/data/tuning.ts and expose it in the debug panel
- Keep simulation, presentation, and content separate
- Store conversations as JSON behind a DialogueProvider interface, so an AI provider can replace the scripted one without changing game logic
- Save progress in localStorage through one versioned save module

Build order
1. Project setup, game loop, input, player movement, camera, and rig
2. Melee: lights, heavy, point-blank shot, parry, block, dodge, Takedown, Execution, and Throw
3. Ranged: aiming, silenced pistol, revolver, SMG, ammo, and reloads
4. Hostile AI: Patrol, vision cones, Challenge, Alert, and attack limits
5. Suspicion meter and the max-suspicion response
6. Seeded procedural generator for the four Napoli area types
7. Conversations, intel, and saved trust
8. Lucca, Lucretia, Commander Hale, and Hale's grudge
9. Treasure, cash, FOB menu, loadout, extraction, and gear lock
10. Full run flow, HUD, win and extraction screens, and run summary
11. Debug panel and a tuning pass against the doc's starting values

Write all conversation content in the doc's tone: at least 3 Legionary conversations, 3 Trooper conversations, 3 meeting stages for Lucca, 3 meeting stages for Lucretia, and Hale's taunts. Every character who can be talked down must have a charm-only path to success.

Testing
- Write vitest tests for damage, suspicion, trust, conversation results, gear lock, saves, and seeded generation
- Confirm npm run build succeeds

Definition of done
- A player can win a full run by taking down Hale in combat or with a stealth Takedown
- A player who reaches zero health is extracted, keeps their cash, and finds used gear locked for exactly one run
- Stealth, gun-fu, and talking can each get a player through Areas 1 and 2
- Lucca, Lucretia, and Hale remember the player after a page reload
- npm run dev starts with no console errors, and npm test passes

When finished, write a README with run instructions, controls, and anything you cut. Then give me a short summary and list anything in DECISIONS.md I should review.
```
