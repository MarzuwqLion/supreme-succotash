import { content } from '../../src/content/dialogue';
import { ScriptedDialogueProvider } from '../../src/content/dialogue/provider';
import { angleDiff, distXZ, normalizeXZ, sub, v3, yawTo, type V3 } from '../../src/core/vec';
import { tuning } from '../../src/data/tuning';
import { ConversationController } from '../../src/game/conversationController';
import { emptyFrame, type InputFrame } from '../../src/input/input';
import { Rng } from '../../src/core/rng';
import { generateArea, planRun } from '../../src/sim/gen/generator';
import { initPhysics } from '../../src/sim/physics';
import { SimWorld, type PlayerCarry } from '../../src/sim/world';
import { aimRay } from '../../src/sim/player';
import type { Hostile } from '../../src/sim/entities';
import { avoidCharacters, walkable } from '../../src/sim/hostiles';

/**
 * Headless playtest bots used for the tuning pass. They cheat on camera
 * control (they set view yaw/pitch directly) but otherwise press the same
 * buttons a player would, through the same InputFrame.
 */

export type Style = 'talk' | 'gunfu' | 'stealth';
const provider = new ScriptedDialogueProvider(content);
declare const process: { env: Record<string, string | undefined>; stdout: { write(s: string): void } };

export interface BotResult {
  reachedExit: boolean;
  died: boolean;
  frames: number;
  kills: number;
  takedowns: number;
  convWon: number;
  convLost: number;
  peakSuspicion: number;
  health: number;
}

function steerTo(w: SimWorld, f: InputFrame, target: V3): void {
  const p = w.player;
  const dir = avoidCharacters(w, p, normalizeXZ(sub(target, p.pos)));
  p.viewYaw = Math.atan2(dir.x, dir.z);
  f.move = { x: 0, y: 1 };
}

const deg = (d: number) => (d * Math.PI) / 180;

/** Would hostile `h` see a body standing at `pt`? (Same rule as the sim's vision cone.) */
function inCone(w: SimWorld, h: Hostile, pt: V3): boolean {
  const ht = tuning.hostiles;
  if (distXZ(h.pos, pt) > ht.visionRange + 0.5) return false;
  if (Math.abs(angleDiff(h.yaw, yawTo(h.pos, pt))) > deg(ht.visionConeDeg / 2 + 5)) return false;
  return w.physics.clearLine(w.eye(h), v3(pt.x, 1.2, pt.z));
}

let aimRng = new Rng(99);
/** Human-ish aim error in metres at the target (0 = perfect). */
const AIM_ERROR = Number(process.env.AIM_ERROR ?? 0.35);

/** Put the crosshair on the target: the ray starts at the shoulder, so converge on it. */
function aimAt(w: SimWorld, h: Hostile, head = false): void {
  const p = w.player;
  p.aiming = true;
  const e = () => (aimRng.next() * 2 - 1) * AIM_ERROR;
  const target = v3(h.pos.x + e(), (head ? 1.62 : 1.25) + e(), h.pos.z + e());
  p.viewYaw = yawTo(p.pos, h.pos);
  for (let k = 0; k < 3; k++) {
    const { origin } = aimRay(p);
    p.viewYaw = Math.atan2(target.x - origin.x, target.z - origin.z);
  }
  const { origin } = aimRay(p);
  p.viewPitch = Math.atan2(target.y - origin.y, Math.hypot(target.x - origin.x, target.z - origin.z));
}

export interface BotOptions {
  /** Remove every hostile except Hale and his escorts (isolates the final approach). */
  onlyHaleGroup?: boolean;
  haleMethod?: (m: string) => void;
}

export async function runBot(style: Style, seed: number, areaIndex = 0, carry?: PlayerCarry, maxFrames = 60 * 240, opts: BotOptions = {}): Promise<BotResult> {
  const R = await initPhysics();
  aimRng = new Rng(seed);
  const plan = planRun(seed);
  const layout = generateArea({ type: plan.areaTypes[areaIndex]!, index: areaIndex, seed });
  const w = new SimWorld(R, {
    layout,
    areaIndex,
    runSeed: seed,
    carry: carry ?? {
      health: 100,
      maxHealth: 100,
      armor: 50,
      maxArmor: 50,
      weapons: [{ id: 'pistol', mag: 12, reserve: 48 }],
      items: { medkit: 0, smoke: style === 'stealth' ? 2 : 0 },
      hasJammer: false,
      intel: [],
    },
    coverIdentity: false,
    areaIntel: null,
    haleTaunt: null,
  });
  if (opts.onlyHaleGroup) for (const h of w.hostiles) if (h.kind !== 'hale' && h.kind !== 'escort') w.killHostile(h, 'gun');
  w.stats.kills = 0;
  w.drainEvents();
  const castel = !layout.exit;
  const haleGoal = () => w.hale?.pos ?? layout.entrance;
  const exit = layout.exit ?? haleGoal();
  let haleDown = false;
  let waypoints = w.nav.waypoints(w.player.pos, exit);
  let replan = 0;
  let convWon = 0;
  let convLost = 0;
  let reached = false;
  let waitFrames = 0;
  let smokeGo = 0;
  let i = 0;
  for (; i < maxFrames && !w.player.dead; i++) {
    const f = emptyFrame();
    const p = w.player;
    if (castel ? haleDown : distXZ(p.pos, exit) < 2) {
      reached = true;
      break;
    }
    if (++replan > 120) {
      waypoints = w.nav.waypoints(p.pos, castel ? haleGoal() : exit);
      while (waypoints.length >= 2 && walkable(w, p.pos, waypoints[1]!)) waypoints.shift();
      replan = 0;
    }
    while (waypoints.length > 1 && distXZ(p.pos, waypoints[0]!) < 0.8) waypoints.shift();
    const next = waypoints[0] ?? exit;
    if (smokeGo > 0) smokeGo--;

    if (p.health < 45 && p.items.medkit > 0 && p.action.kind === 'none' && w.frame % 30 === 0) {
      p.selectedItem = 0;
      f.pressed.useItem = f.held.useItem = true;
    }
    const threats = w.hostiles.filter((h) => h.state === 'alert' || h.state === 'challenge');
    const visible = threats.filter((h) => w.physics.clearLine(v3(p.pos.x, 1.4, p.pos.z), v3(h.pos.x, 1.4, h.pos.z)) && distXZ(h.pos, p.pos) < 26);
    visible.sort((a, b) => distXZ(a.pos, p.pos) - distXZ(b.pos, p.pos));

    if (style === 'gunfu' && visible.length) {
      const t = visible[0]!;
      const d = distXZ(t.pos, p.pos);
      if (p.context.action && p.action.kind === 'none' && (p.context.action !== 'throw' || w.frame % 2 === 0)) {
        f.pressed.context = true;
      } else if (d < 2.2) {
        p.viewYaw = yawTo(p.pos, t.pos);
        // Parry if they're winding up, otherwise strike.
        if (t.attack?.kind === 'melee' && t.attack.frame >= 10 && t.attack.frame <= 16) f.pressed.block = f.held.block = true;
        else if (w.frame % 5 === 0) f.pressed.light = true;
        if (w.frame % 9 === 0) f.pressed.fire = true;
      } else {
        aimAt(w, t, process.env.HEADSHOTS === '1' && d < 12);
        f.held.aim = true;
        if (p.fireCooldown === 0 && p.reload === 0) f.pressed.fire = f.held.fire = true;
        const slot = p.weapons[p.slot]!;
        if (slot.mag === 0 && slot.reserve === 0 && p.weapons.length > 1) f.pressed.swap2 = true;
        // Dodge when someone is lining up a shot at close range.
        if (visible.some((h) => h.attack?.kind === 'ranged' && h.attack.frame === 20) && p.action.kind === 'none') f.pressed.dodge = true;
      }
    } else if (style === 'stealth') {
      // Read the cones: take down unaware hostiles from behind, wait when the
      // next few steps would walk into a cone, smoke a watcher who won't move.
      const patrols = w.hostiles.filter((h) => h.state === 'patrol' && h.combat === 'none');
      const seenNow = patrols.filter((h) => inCone(w, h, p.pos));
      const prey = patrols.find((h) => distXZ(h.pos, p.pos) < 8 && !inCone(w, h, p.pos) && w.physics.clearLine(v3(p.pos.x, 1, p.pos.z), v3(h.pos.x, 1, h.pos.z)));
      const goal = prey ? prey.pos : next;
      const dir = normalizeXZ(sub(goal, p.pos));
      const ahead = v3(p.pos.x + dir.x * 2.5, 0, p.pos.z + dir.z * 2.5);
      const seenAhead = patrols.filter((h) => inCone(w, h, ahead));
      if (p.context.action === 'takedown' && p.action.kind === 'none') f.pressed.context = true;
      else if (seenNow.length) {
        const h = seenNow[0]!;
        if (p.items.smoke > 0 && h.detection > 0.3 && p.action.kind === 'none') {
          p.viewYaw = yawTo(p.pos, h.pos);
          f.pressed.useItem = f.held.useItem = true;
        } else {
          p.viewYaw = yawTo(h.pos, p.pos);
          f.move = { x: 0, y: 1 };
        }
        waitFrames = 0;
      } else if (prey && !seenAhead.length) steerTo(w, f, prey.pos);
      else if (seenAhead.length && waitFrames > 60 * 3 && p.items.smoke > 0 && p.action.kind === 'none') {
        // Blind the watcher and slip past.
        const h = seenAhead[0]!;
        p.viewYaw = yawTo(p.pos, h.pos);
        f.pressed.useItem = f.held.useItem = true;
        waitFrames = 0;
        smokeGo = 60 * 6;
      } else if (seenAhead.length && waitFrames < 60 * 8 && smokeGo <= 0) waitFrames++;
      else {
        waitFrames = 0;
        steerTo(w, f, next);
      }
    } else {
      steerTo(w, f, next);
    }
    const waiting = style === 'stealth' && waitFrames > 0;
    if (f.move.x === 0 && f.move.y === 0 && !waiting && !(style === 'gunfu' && visible.length)) steerTo(w, f, next);
    w.tick(f);
    if (process.env.BOT_TRACE && w.frame % 60 === 0) {
      const g = w.hostiles.filter((h) => h.kind === 'hale' || h.kind === 'escort').map((h) => `${h.kind[0]}:${h.state[0]}${h.detection.toFixed(1)}@${h.pos.x.toFixed(0)},${h.pos.z.toFixed(0)}`);
      process.stdout.write(`t${w.frame / 60} p ${p.pos.x.toFixed(1)},${p.pos.z.toFixed(1)} ctx ${p.context.action} wait ${waitFrames} ${g.join(' ')}\n`);
    }
    for (const e of w.drainEvents()) {
      if (process.env.BOT_TRACE && (e.type === 'alert' || e.type === 'kill' || e.type === 'message')) process.stdout.write(`  ev ${JSON.stringify(e)}\n`);
      if (e.type === 'haleDown') {
        haleDown = true;
        opts.haleMethod?.(e.method);
      }
      if (e.type === 'conversation' && e.speaker === 'hostile') {
        const ctx = { speaker: e.kind, speakerKey: `${areaIndex}-${e.hostileId}`, memory: null, intel: [...w.player.intel], suspicion: w.suspicion.value, cash: 0, areaName: '', runSeed: seed };
        const c = new ConversationController(provider, ctx, 0);
        await c.begin();
        const rank = { best: 5, good: 4, neutral: 3, bad: 2, insult: 1, intel: 6, bribe: 0 } as const;
        while (!c.done) {
          const rs = c.visibleReplies(0).filter((r) => r.avail.enabled);
          // Gun-fu bots refuse to play along; everyone else talks their way out.
          const pick = style !== 'gunfu' ? [...rs].sort((a, b) => rank[b.reply.tier] - rank[a.reply.tier])[0]! : [...rs].sort((a, b) => rank[a.reply.tier] - rank[b.reply.tier])[0]!;
          await c.choose(pick.reply.id, 0);
        }
        const ok = c.outcome === 'success';
        if (ok) convWon++;
        else {
          convLost++;
          w.applySuspicion(w.suspicion.failedConversation());
        }
        w.endHostileConversation(e.hostileId, ok);
      }
    }
  }
  if (!reached && !w.player.dead && process.env.BOT_DEBUG) {
    const p = w.player;
    const near = w.hostiles.filter((h) => distXZ(h.pos, p.pos) < 4).map((h) => `${h.kind}:${h.state}:${h.combat}@${distXZ(h.pos, p.pos).toFixed(1)}`);
    process.stdout.write(`STUCK seed ${seed} area ${areaIndex} ${layout.type} pos ${p.pos.x.toFixed(1)},${p.pos.z.toFixed(1)} exit ${exit.x},${exit.z} wp ${JSON.stringify(waypoints[0])} action ${p.action.kind} near ${near.join(' ')}\n`);
  }
  const res: BotResult = {
    reachedExit: reached,
    died: w.player.dead,
    frames: i,
    kills: w.stats.kills,
    takedowns: w.stats.takedowns,
    convWon,
    convLost,
    peakSuspicion: w.suspicion.peak,
    health: w.player.health,
  };
  w.dispose();
  return res;
}

export function summarize(results: BotResult[]) {
  const n = results.length;
  const avg = (k: keyof BotResult) => results.reduce((s, r) => s + Number(r[k]), 0) / n;
  return {
    runs: n,
    success: results.filter((r) => r.reachedExit).length / n,
    died: results.filter((r) => r.died).length / n,
    avgSec: Math.round(avg('frames') / tuning.sim.hz),
    kills: avg('kills').toFixed(1),
    takedowns: avg('takedowns').toFixed(1),
    convWon: avg('convWon').toFixed(1),
    convLost: avg('convLost').toFixed(1),
    peakSusp: avg('peakSuspicion').toFixed(0),
    hp: avg('health').toFixed(0),
  };
}
