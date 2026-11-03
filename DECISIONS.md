# Decisions

Where `docs/design.md` left something open, I picked the simplest option that fits it and recorded it here. Every number below lives in `src/data/tuning.ts` and can be changed live in the debug panel (backtick or Back).

## Review these first

These change how the game plays, or they reinterpret the doc.

1. **A silenced shot only adds suspicion if a hostile who isn't already in Alert sees it.** Taken literally, "Silenced shot seen by a hostile: +10" makes every pistol shot in a firefight worth +10, with no rate limit, because the people shooting at you can see you. A short fight hits max suspicion in seconds, which is far harsher than loud gunfire (+20 per 3 s). Here, a hostile who is already fighting you doesn't count as a new witness. (`src/sim/player.ts`, `gunNoise`)
2. **Lucca and Lucretia have three outcomes: success, rebuff, and failure.** Lucretia can't reach 30 trust before her third meeting because of the +20 cap. Counting every earlier meeting as a failed conversation would cost +15 suspicion each time and contradict "winning her over takes a few meetings."
   - **Rebuff** means trust went up but is still under the target. There's no penalty, and the meeting is remembered.
   - **Failure** means trust didn't go up. It adds +15 suspicion, and they leave the area.
   - Rebuffs count as neither won nor lost in the run summary.
3. **A run is won the moment Hale goes down** (after a 2.5 s beat). The doc says there's "no exit until he's down", but it also says players "win by taking him down", so there's no walk to an exit afterwards.
4. **"Hale was involved in an extraction" means the agent was extracted in Area 3** (the Castel garrison). His grudge adds one escort per such extraction, capped at +2, and lasts until he's beaten.
   - The taunt plays once, as a radio line when the agent enters the Castel. That way a stealth player who never alerts him still hears it.
   - The Castel's 12-15 hostiles include Hale and his 2 base escorts. Grudge escorts come on top.
5. **Hale pauses to inspect.** At each stop on his rounds he stands for 3-5 s facing the work, glancing only ±20°. Other hostiles sweep ±70°. Without this, his escort group always turned back toward anyone following, and the stealth win was close to impossible in testing. This is the main lever on how hard the stealth win is.
6. **Stood-down hostiles step aside and stay out of fights.** Talked-down hostiles don't block movement (shots still hit them). They ignore loud gunfire and witnessed kills, and go back to Alert only if attacked or when suspicion hits max.
   - Without this, groups of stood-down hostiles walled the agent into 4 m alleys.
   - They can still be taken down.
7. **Hostile attack numbers are mine.** The doc gives hostile health but no attack damage, timing or accuracy, so the numbers below are starting values. With them, starter-kit bots get through Areas 1 and 2 by talking 100% of the time, by gun-fu 80-100%, and by stealth 50-90% (see the tuning pass below).

   | Attack | Values |
   | --- | --- |
   | Legionary baton | 20-4-26 frames, 10 damage |
   | Legionary pistol | 7 damage |
   | Trooper and escort rifle | 3-round burst, 5 damage per round |
   | Hale's rifle | 3-round burst, 7 damage per round |
   | Hale's melee | 18 damage |
   | Hit chance | 75% at 4 m, falling to 30% at 22 m; 20% lower against a sprinting agent |
   | Attack tokens | At most 2 melee and 3 ranged attackers at once |
8. **A reload mid-run counts as an extraction.** On the next boot, carried gear locks and banked cash stays. Otherwise a reload would dodge the gear lock. The browser also asks for confirmation before leaving the page during a run.
9. **Lucretia's bribe works in any meeting while her trust is under 30.** It costs 300 cash and buys her help for that meeting only (help = one piece of intel the agent lacks, plus revealing the exit and all caches). If trust also reaches 30 in the same conversation, it counts as a success, not a bribe.

## Combat

- **Parry and block share one button.** Pressing LB or Ctrl opens the 8-frame parry window; holding it blocks. A new parry window can't open for 24 frames after the last press, so tapping can't keep one open. C is an alternate block key, because Ctrl+W closes the tab in some browsers.
- **Light hitstun is 14/14/22 frames.** The doc only gives the heavy's 24.
- **Chaining:**
  - Pressing light during a strike buffers the next hit, which starts on the first recovery frame.
  - Heavy, dodge, B and block can cancel light or heavy recovery.
  - The third light hit is a kick.
- **Melee targeting:**
  - Strikes pick the lock-on target if there is one. Otherwise they pick the best hostile within 3.2 m, scored by distance and by angle from the stick or facing direction.
  - The agent snaps to face the target and lunges up to 1.4 m during startup.
  - Hits need 1.9 m reach and a 120° arc.
- **Point-blank shot:** RT during any strike frame queues one shot at the melee target 4 frames later. It uses the current weapon, its ammo, its damage (no headshot) and its normal noise rules. It always hits.
- **B (Takedown, Execution, Throw):**
  - "Unaware" means Patrol or stood down. A hostile still building detection counts as unaware.
  - Takedown kills on frame 28, Execution on frame 48, and Throw lands on frame 38. Throws travel 2.6 m, stopping at walls.
  - On Hale, B does nothing unless a Takedown or Execution is valid, since he can't be thrown.
- **Witnesses:** the doc's rule for Takedowns ("goes to Alert, no suspicion") also applies to Executions.
- **Dodge** moves over frames 0-15 and is invulnerable on frames 3-14. With no stick input it goes backward.
- **Guns:**
  - Headshots (×2) apply to every gun, not just the pistol.
  - Gun hits cause a 6-frame flinch.
  - Firing without aiming shoots along the camera, or at the lock-on target.
- **Reserve ammo:** pistol 48, revolver 24, SMG 120. An ammo pickup or a purchase from Lucca adds two magazines to each weapon carried. Swapping weapons takes 18 frames and cancels a reload.
- **The agent is invulnerable to gunfire only during dodge and Execution i-frames.** Getting hit in melee with no block causes 14 frames of hitstun.

## Hostile AI

- **Detection:**
  - The meter fills over 0.75 s in the cone.
  - Out of sight, it drains at 0.6 per second.
  - Above 35%, a hostile stops and turns to look.
  - Touching a hostile (within 0.9 m) also builds detection. The 2 m Takedown range stays safe.
- **Sprinting within 5 m** draws attention from any direction, with no sight line needed.
- **Alerted hostiles see in a 240° cone out to 30 m**, and lose track after 20 s without seeing the agent.
- **Hostile gunfire** pulls in hostiles within 10 m. Only the agent's loud gunfire uses the 30 m rule.
- **Challenges:**
  - A challenger walks up and starts the conversation at 2.4 m.
  - If the agent stays out of sight for 4 s, or gets more than 18 m away, the challenger goes to Alert instead.
  - Pressing interact on an unaware, talkable hostile starts the same conversation.
- **Navigation:** hostiles pathfind on the generator's cell graph and skip waypoints they can walk straight to. Everyone keeps to their right, so head-on meetings in alleys don't deadlock.
- **Entity IDs are per area,** so a seed replays the same way in every session. Tests cover this.

## Talking

- **Trust per reply type** (the numbers are in tuning, not in the content files):

  | Reply type | Trust |
  | --- | --- |
  | Best | +15 |
  | Good | +8 |
  | Neutral | 0 |
  | Bad | -10 |
  | Insult | -20 |
  | Intel | +25 |
  | Legionary bribe | +20 for 150 cash |
  | Trooper bribe | +25 for 300 cash |

  Game logic caps whatever a provider claims: +15 for charm lines, +25 for intel. That way a future AI provider can't break the economy.
- **Lucretia's +20 cap applies to the conversation's total,** so the order of replies doesn't matter.
- **Lucca** has a target of 30 and needs one conversation per area before he trades.
  - His stock is ammo (80), medkits (150) and smoke (100).
  - At trust 60 or more he takes 25% off; trust is checked after the conversation.
  - He doesn't take bribes.
- **A talked-down Legionary or Trooper picks a reward at random** from whatever's still available: reveal the exit, reveal a cache, or hand over intel the agent lacks.
- **Generic hostiles' scripts** are chosen from the seed and the hostile's ID.
- **Named cast stages:** a script's stage is meetings + 1, capped at 3. Opening conditions' `minMeetings` counts earlier meetings.
- **The action pauses during conversations, shops, intel documents and the pause menu.**
- **Trust stays hidden from the player.** The debug panel shows it live.

## Napoli generation

- **Piece shapes** (each block is 12 m):

  | Piece | Shape |
  | --- | --- |
  | Street | 8 m lanes |
  | Alley | 4 m lanes |
  | Courtyard | Ring walls with 4 m doors |
  | Piazza | Open, walled only toward unconnected neighbours |
  | Building | Solid |

  Every piece keeps its centre and its lanes to connected edges clear, which is what navigation relies on.
- **Area layouts:**

  | Area | Layout |
  | --- | --- |
  | Porto | Open quays and a dock road, about 20% warehouses, tall container stacks for cover |
  | Spaccanapoli | One street spanning the whole area, side passages ending in courtyards, a partial back lane |
  | Quartieri | Randomized maze with a few loops; dead ends become courtyards |
  | Castel | Ring road, parade ground, barracks courtyards, south gate, Hale's two-cell keep on the north wall |
- **The entrance and exit sit on opposite edges,** at least 60 m apart (the doc asks for 50). A path between them is checked and carved if needed, and unreachable cells are removed.
- **Spawns:**
  - Hostiles spawn at least 20 m from the entrance, at most 2 per cell. Patrol routes cover 1-3 cells.
  - The hostile mix is about 80% Legionaries in Porto and Quartieri, 50/50 in Spaccanapoli, and about 80% Troopers in the Castel.
  - Caches prefer dead ends and courtyards off the main path.
- **Lucca and Lucretia** appear only in Areas 1-2, never in the Castel. Both can appear in the same area.
- **Intel:** each of Areas 1 and 2 holds one piece the agent doesn't have yet. If the agent already has all three, it's a random repeat.

## Economy, gear and runs

- **Run-only items** go into a stash when bought and are packed into the loadout (max 2). Packed items and anything found during a run are gone when the run ends, whatever the outcome.
- **Gear lock:** extraction locks every piece of owned gear the agent carried for the next run index exactly. The starter kit never locks.
- **Cash** is banked the moment it's picked up, so nothing can take it away.
- **Armor plates** apply on pickup. **Medkits** are instant (+50 health).
- **Use item:** a tap uses the selected item; holding it for 20 frames cycles through medkit, smoke and jammer.
- **Smoke** lands up to 7 m along the camera, stopping at walls. Its 4.5 m sphere blocks sight lines for 8 s.
- **Health, armor, ammo, items and intel** carry from area to area within a run. Suspicion resets each area.

## Presentation

- **Vision cones** are drawn on the ground by default; the debug panel can turn them off.
- **HUD markers:**
  - `?` (detecting or challenging) and `!` (alert) above hostiles.
  - Names on the cast.
  - Cache and exit markers within range, or always (with distance) once revealed.
  - A Hale marker once the agent holds his schedule.
- **The exit** has a green beacon that shows within 30 m, or always once revealed.
- **The camera** uses melee mode while any alerted hostile is within 7 m, or during a melee action. The spring is substepped so it stays stable at low frame rates.
- **On keyboard, the agent always moves at run speed.** A partly tilted stick walks.
- **L3 sprint** stays on until the stick is released; Shift has to be held.
- **`?lowfx=1`** turns off shadows and uses a 1x pixel ratio for slow machines and automated tests.

## Other

- **Save:** version 2 under the `infinity-mansion-napoli/save` key, with migrations from v0 and v1. Corrupt saves or saves from a newer build fall back to defaults.
- **The gun-fu spec** linked from the doc wasn't available. Every number comes from the design doc's tables, or from the choices above.
