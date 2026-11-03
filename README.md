# Infinity Mansion: Napoli (MVP)

A gray-box, single-player browser slice for testing mechanics. You play one agent in one city. You get through three procedural areas of occupied Napoli and take down Commander Hale, by fighting, sneaking or talking. The design doc is [`docs/design.md`](docs/design.md), and every choice the doc left open is recorded in [`DECISIONS.md`](DECISIONS.md).

Built with Three.js, Rapier (`@dimforge/rapier3d-compat`), strict TypeScript, Vite, lil-gui and vitest. There are no external art, animation or audio assets: characters are capsule rigs built in code and animated with keyed poses.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest: 125 tests
npm run build      # type-check + production build into dist/
npm run balance    # optional: headless playtest bots, prints success rates per approach
```

You need Node 20 or newer. `.npmrc` sets `legacy-peer-deps` because of an npm bug with vitest 4's optional peers. Add `?lowfx=1` to the URL to turn off shadows on slow machines.

Click the game view to capture the mouse. A gamepad (Xbox layout, standard mapping) works as soon as you press a button; the HUD prompts follow whichever device you used last.

## Controls

| Action | Gamepad | Keyboard / mouse |
| --- | --- | --- |
| Move | Left stick | WASD |
| Camera | Right stick | Mouse |
| Light string (8, 8, 14) | X | E |
| Heavy (24, 24-frame hitstun) | Y | Q |
| Point-blank shot (during a strike) | RT | Left mouse |
| Parry (tap) / Block (hold) | LB | Ctrl or C |
| Dodge | A | Space |
| Takedown / Execution / Throw | B | F |
| Aim / Fire | LT / RT | Right / Left mouse |
| Sprint | L3 (toggle) | Shift (hold) |
| Lock-on | R3 | Middle mouse |
| Interact (talk, loot, exit) | RB | R |
| Swap weapon | D-pad ← → | 1, 2 |
| Use item (hold to cycle) | D-pad ↑ | 3 |
| Reload (automatic when empty) | D-pad ↓ | T |
| Pause | Start | Esc |
| Debug panel | Back | ` (backtick) |

Menus work with the D-pad or arrow keys plus A or Enter, or with the mouse. In conversations, press 1-4 or select a reply.

Ctrl+W closes the tab in most browsers, so use C to block if you move with WASD. During a run the browser asks before you leave the page.

## How a run works

1. **FOB.** Buy gear with cash and pick a loadout:
   - The starter kit (silenced pistol and ballistic vest) never locks.
   - On top of that: one extra weapon, one armor upgrade, one gadget, and up to two run-only items.
2. **Areas 1 and 2.** Two of Porto, Spaccanapoli and Quartieri, in random order. Find the exit (a green beacon), loot caches, and deal with hostiles however you like.
   - **Suspicion** (0-100) is per area and never falls on its own. At 100, every hostile converges on you.
   - **Legionaries and Troopers** who spot you come over to question you. Each conversation has three exchanges, and charm alone can win any of them. Intel lines and bribes are shortcuts.
   - **Lucca** (gunsmith) and **Lucretia** (informant) may appear. They remember you between runs.
3. **Area 3: the Castel garrison.** Hale has escorts and there's no exit. Taking him down in combat or with a stealth Takedown wins the run. *Hale's schedule* intel marks him on the HUD.
4. **Extraction.** At zero health you're pulled out to the FOB. You keep all cash, and any owned gear you carried locks for exactly one run. Hale holds a grudge if it happened in his garrison.

Each run ends on a summary screen with time, kills, Takedowns, conversations won and lost, peak suspicion, and cash earned.

**Debug panel** (backtick or Back):
- Live readouts: seed, suspicion, conversation trust, cast trust, Hale's grudge.
- Every value in `src/data/tuning.ts`.
- Run tools: new run from a seed, regenerate the area, skip to an area.
- Cheats: cash, suspicion, reveal everything, teleports, god mode, vision cones, reset save.

## Code layout

```
src/
  data/tuning.ts        every tunable number (the debug panel edits this live)
  core/                 seeded RNG, vector math, fixed 60 Hz loop
  input/                gamepad-first input -> one InputFrame per sim step
  sim/                  simulation: no three.js, no DOM
    world.ts            area state, perception, damage, alerts, events
    player.ts           movement, melee, guns, items, context actions
    hostiles.ts         Patrol / Challenge / Alert AI, attack tokens
    suspicion.ts, damage.ts, conversation.ts, treasure.ts   pure rules
    gen/                seeded generator for the four area types
    physics.ts, nav.ts  Rapier wrapper, cell-graph navigation
  content/dialogue/     JSON conversations + DialogueProvider interface
  meta/                 versioned save, economy and gear lock, cast memory
  game/                 run flow, conversation controller, state machine
  render/               three.js presentation: rig, poses, camera, scene
  ui/                   HUD, screens, lil-gui debug panel
tests/                  vitest suites (+ tests/bots: headless playtest bots)
```

**Architecture rules:**
- The simulation runs at a fixed 60 Hz and never reads the renderer. Aiming uses the sim's own view yaw and pitch.
- Presentation only reads sim state.
- Conversations are JSON behind `DialogueProvider` (`src/content/dialogue/provider.ts`). Game logic owns trust, intel and suspicion, and caps any trust change a provider reports. An AI provider can implement the same three async methods without changing game logic.
- All persistence goes through `src/meta/save.ts`.

## Testing

`npm test` covers:

- **Damage, suspicion, trust, and conversation results.** Every Legionary and Trooper script wins by charm alone and fails when played rudely. Lucretia takes three charm-only meetings.
- **Gear lock** (exactly one run), **saves** (round trip, migration, corrupt data), and **seeded generation** (determinism, the 50 m rule, guaranteed paths, hostile and cache counts).
- **Headless Rapier simulation:**
  - Spotting time, Challenge, Takedown and witnesses.
  - Loud and silenced gunfire, headshots, reload.
  - Parry into Execution, block, Throw, the light string, point-blank shot, dodge i-frames.
  - Items, attack tokens, smoke, max suspicion, the 20 s forget timer.
  - The Hale rules.
- **A stealth Takedown win on Hale** and **seed replay**.

`npm run balance` runs talk, gun-fu and stealth bots through Areas 1 and 2 on several seeds, using the starter kit only. The latest run:

| Approach | Areas 1 and 2 success |
| --- | --- |
| Talk | 100% |
| Gun-fu (with aim error) | 80-100% |
| Stealth (with two smoke grenades) | 50-90% |

The bots are crude, so treat these as a floor rather than a measure of player experience.

## Cut or simplified in this build

- **Gamepads:** tested with a simulated Xbox-layout pad through the Gamepad API, not physical hardware.
- **Hostiles don't notice bodies**, and don't react to melee noise or to the agent standing in plain sight once stood down.
- **The world is flat,** with no stairs, jumping or climbing. There's no crouch, since the doc has none; stealth relies on vision cones, routes, Takedowns and smoke.
- **Navigation** is a cell graph with straight-line shortcuts, not a navmesh. Hostiles can occasionally scrape along corners.
- **Armor plates and medkits apply instantly,** with no use animation.
- **Animation** blends keyed poses with no inverse kinematics. Hits use the strike's target rather than limb collision.
- **Hale's taunts** are subtitles. There's no audio at all.
- **Area 3 has no post-Hale escape;** the run ends as a win (see DECISIONS.md).
- **No settings menu**, rebindable controls or look inversion.

Out of scope per the doc: co-op, the Infinity Mansion and the top general, free-speaking AI characters and voice, a walkable FOB, photo-based characters, cover snapping, powers, scanning, environmental hazards, final art and audio, and the full one-hour run.
