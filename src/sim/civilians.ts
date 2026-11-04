import { clone, normalizeXZ, sub, turnToward, type V3 } from '../core/vec';
import { tuning } from '../data/tuning';
import type { Civilian } from './entities';
import type { SimWorld } from './world';

/**
 * Ambient citizens. They stroll between spots on the navigation graph,
 * linger at fountains and benches, scatter from violence, hide for a while,
 * then go back to their day. They never block anyone and can't be hurt.
 */

const DT = () => 1 / tuning.sim.hz;
const dist3 = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function follow(w: SimWorld, c: Civilian, speed: number): boolean {
  const wp = c.path[0];
  if (!wp) return true;
  const d = Math.hypot(wp.x - c.pos.x, wp.z - c.pos.z);
  if (d < 0.6) {
    c.path.shift();
    return c.path.length === 0;
  }
  const dir = normalizeXZ(sub(wp, c.pos));
  const step = Math.min(speed * DT(), d);
  w.physics.move(c.body, dir.x * step, dir.z * step);
  c.yaw = turnToward(c.yaw, Math.atan2(dir.x, dir.z), 6 * DT());
  return false;
}

function goTo(w: SimWorld, c: Civilian, target: V3): void {
  c.target = clone(target);
  c.path = w.nav.waypoints(c.pos, target);
  c.pathAge = 0;
}

/** A node in the given distance band (from `from`), optionally far from `away`. */
function pickNode(w: SimWorld, from: V3, minD: number, maxD: number, away: V3 | null): V3 | null {
  const nodes = w.nav.nodes;
  let best: V3 | null = null;
  let bestScore = -Infinity;
  for (let k = 0; k < 14; k++) {
    const n = nodes[w.rng.int(0, nodes.length - 1)]!;
    const d = dist3(n, from);
    if (d < minD || d > maxD) continue;
    const score = away ? dist3(n, away) : w.rng.next();
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

export function updateCivilian(w: SimWorld, c: Civilian): void {
  const cv = tuning.civilians;
  c.speed = 0;
  switch (c.state) {
    case 'flee': {
      c.speed = cv.fleeSpeed;
      if (follow(w, c, cv.fleeSpeed) || ++c.pathAge > 60 * 12) {
        c.state = 'cower';
        c.timer = w.rng.int(Math.round(cv.cowerMinSec * 60), Math.round(cv.cowerMaxSec * 60));
        c.path = [];
      }
      break;
    }
    case 'cower':
      if (--c.timer <= 0) {
        c.state = c.idle ? 'idle' : 'wander';
        c.timer = w.rng.int(60, 240);
        if (c.idle) goTo(w, c, c.home);
      }
      break;
    case 'idle': {
      if (c.path.length) {
        c.speed = cv.walkSpeed;
        follow(w, c, cv.walkSpeed);
      } else if (--c.timer <= 0) {
        // Shift weight, look around.
        c.timer = w.rng.int(120, 420);
        c.yaw += w.rng.range(-1.2, 1.2);
      }
      break;
    }
    case 'wander': {
      if (c.path.length) {
        c.speed = cv.walkSpeed;
        if (follow(w, c, cv.walkSpeed)) c.timer = w.rng.int(90, 420);
        if (++c.pathAge > 60 * 40) c.path = [];
      } else if (--c.timer <= 0) {
        const t = pickNode(w, c.pos, 8, 40, null);
        if (t) goTo(w, c, t);
        else c.timer = 120;
      }
      break;
    }
  }
}

/** Everyone near `at` runs for it. Returns how many were scared. */
export function scareCivilians(w: SimWorld, at: V3, radius: number): number {
  let n = 0;
  for (const c of w.civilians) {
    if (c.state === 'flee' || dist3(c.pos, at) > radius) continue;
    const t = pickNode(w, c.pos, 18, 70, at);
    if (!t) continue;
    c.state = 'flee';
    goTo(w, c, t);
    n++;
  }
  return n;
}

export type CivilianLineKind = 'idle' | 'nervous' | 'rumor' | 'cowering';

/** The agent talks to a passer-by: one line, maybe a tip about a stash. */
export function talkToCivilian(w: SimWorld, c: Civilian): CivilianLineKind | null {
  if (c.state === 'flee') return null;
  c.yaw = Math.atan2(w.player.pos.x - c.pos.x, w.player.pos.z - c.pos.z);
  c.path = [];
  if (c.state !== 'cower') c.timer = Math.max(c.timer, 150);
  const first = !c.talked;
  c.talked = true;
  if (c.state === 'cower') return 'cowering';
  if (w.suspicion.value >= 50) return 'nervous';
  if (c.rumor && first && w.revealCache()) return 'rumor';
  return 'idle';
}
