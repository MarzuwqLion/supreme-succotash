import { tuning } from '../data/tuning';
import type { Civilian, Hostile, Player } from '../sim/entities';
import { POSES, blendPose, ease, overlayUpper, type Pose } from './rig';

/**
 * Maps simulation state to keyed poses. Reads sim state only; keeps a
 * locomotion phase per entity for walk/run cycles.
 */

const P = (k: string): Pose => POSES[k]!;

function phaseOf(frame: number, startup: number, active: number, recovery: number, wind: Pose, hit: Pose): Pose {
  if (frame < startup) return blendPose(P('idle'), wind, ease(Math.min(1, frame / Math.max(1, startup))));
  if (frame < startup + active) return blendPose(wind, hit, ease((frame - startup + 1) / Math.max(1, active)));
  const t = (frame - startup - active) / Math.max(1, recovery);
  return blendPose(hit, P('idle'), ease(Math.min(1, t)));
}

export class LocomotionPhase {
  phase = 0;
  advance(speed: number, dt: number): void {
    const stride = speed > 6 ? 2.6 : speed > 3.6 ? 2.2 : 1.5;
    this.phase += (speed * dt) / stride * Math.PI;
  }
  pose(speed: number): Pose {
    const t = (Math.sin(this.phase) + 1) / 2;
    if (speed < 0.2) return P('idle');
    if (speed > 6.5) return blendPose(P('sprintA'), P('sprintB'), t);
    if (speed > 3.6) return blendPose(P('runA'), P('runB'), t);
    const walk = blendPose(P('walkA'), P('walkB'), t);
    return speed < 1 ? blendPose(P('idle'), walk, speed) : walk;
  }
}

export function playerPose(p: Player, loco: LocomotionPhase, recentShot: boolean): Pose {
  const m = tuning.melee;
  if (p.dead) return P('knockdown');
  const a = p.action;
  switch (a.kind) {
    case 'light': {
      const fr = [m.light1, m.light2, m.light3][a.step]!;
      const keys = [
        ['lightWind', 'lightHit'],
        ['light2Wind', 'light2Hit'],
        ['kickWind', 'kickHit'],
      ][a.step]!;
      return phaseOf(a.frame, fr.startup, fr.active, fr.recovery, P(keys[0]!), P(keys[1]!));
    }
    case 'heavy':
      return phaseOf(a.frame, m.heavy.startup, m.heavy.active, m.heavy.recovery, P('heavyWind'), P('heavyHit'));
    case 'dodge': {
      // Forward roll: tuck, one full somersault over the travel frames, stand up.
      const travel = Math.max(1, m.dodgeTotal - 4);
      const t = Math.min(1, a.frame / travel);
      const tuck = a.frame < 3 ? blendPose(P('idle'), P('tuck'), a.frame / 3) : a.frame < travel ? P('tuck') : blendPose(P('tuck'), P('idle'), (a.frame - travel) / 4);
      return { ...tuck, tumble: ease(t) * Math.PI * 2 };
    }
    case 'takedown':
      return a.frame < 8 ? blendPose(P('idle'), P('grab'), a.frame / 8) : blendPose(P('grab'), P('takedown'), Math.min(1, (a.frame - 8) / 12));
    case 'execution': {
      const k = m.executionKillFrame;
      if (a.frame < k - 12) return blendPose(P('grab'), P('executeWind'), Math.min(1, a.frame / 20));
      if (a.frame < k) return blendPose(P('executeWind'), P('executeHit'), ease((a.frame - (k - 12)) / 12));
      return blendPose(P('executeHit'), P('idle'), Math.min(1, (a.frame - k) / (m.executionTotal - k)));
    }
    case 'throw':
      if (a.frame < 12) return blendPose(P('idle'), P('grab'), a.frame / 12);
      if (a.frame < m.throwLandFrame) return blendPose(P('grab'), P('throwRelease'), ease((a.frame - 12) / 14));
      return blendPose(P('throwRelease'), P('idle'), (a.frame - m.throwLandFrame) / (m.throwTotal - m.throwLandFrame));
    case 'hitstun':
      return P('hitstun');
    case 'none':
      break;
  }
  const base = loco.pose(p.speed);
  if (p.cover) {
    const c = p.cover;
    if (c.low) return c.expose > 0.5 ? blendPose(P('crouch'), P('aim'), c.expose) : P('coverLow');
    return c.expose > 0.3 ? overlayUpper(base, P('aim')) : overlayUpper(base, P('coverHigh'));
  }
  if (p.talking) return P(Math.sin(performance.now() / 900) > 0 ? 'talk' : 'talkB');
  if (p.blocking) return overlayUpper(base, p.parryFrame >= 0 ? P('parry') : P('block'));
  if (p.aiming || recentShot) return overlayUpper(base, P('aim'));
  return base;
}

export function hostilePose(h: Hostile, loco: LocomotionPhase, speed: number): Pose {
  if (h.state === 'dead') return P('dead');
  switch (h.combat) {
    case 'grabbed':
      return P('grabbed');
    case 'knockdown':
      return P('knockdown');
    case 'stagger':
      return P('stagger');
    case 'hitstun':
      return P('hitstun');
    case 'none':
      break;
  }
  const base = loco.pose(speed);
  if (h.attack) {
    if (h.attack.kind === 'melee') {
      const s = h.kind === 'hale' ? tuning.hostileAttacks.haleMelee : tuning.hostileAttacks.baton;
      return phaseOf(h.attack.frame, s.startup, s.active, s.recovery, P('batonWind'), P('batonHit'));
    }
    return overlayUpper(base, h.kind === 'legionary' ? P('aim') : P('aimRifle'));
  }
  if (h.state === 'conversation') return P('talk');
  if (h.state === 'challenge') return overlayUpper(base, P('challenge'));
  if (h.state === 'alert') return overlayUpper(base, h.kind === 'legionary' ? P('idle') : P('aimRifle'));
  if (speed < 0.2 && h.state === 'patrol' && h.detection > 0.3) return P('lookAround');
  return base;
}

export function civilianPose(c: Civilian, loco: LocomotionPhase, speed: number, talking: boolean): Pose {
  if (c.state === 'cower') return P('cower');
  if (talking) return P(Math.sin(performance.now() / 700 + c.id) > 0 ? 'talk' : 'talkB');
  if (speed > 0.2) return loco.pose(speed);
  return (c.look & 1) === 0 ? P('idleClasp') : P('idle');
}
