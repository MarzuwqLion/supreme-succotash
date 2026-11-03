import { angleDiff, clone, distXZ, forwardFromYaw, lerp, normalizeXZ, rightFromYaw, sub, turnToward, v3, yawTo, type V3 } from '../core/vec';
import { tuning } from '../data/tuning';
import type { Hostile } from './entities';
import type { SimWorld } from './world';

/**
 * Hostile AI: Patrol (route + vision cone + 0.75 s spotting), Challenge
 * (talkable hostiles walk over to question the agent), Alert (attack, pull
 * in hostiles within 10 m, forget after 20 s unseen), attack token limits.
 */

const DT = () => 1 / tuning.sim.hz;
const deg = (d: number) => (d * Math.PI) / 180;

function runSpeedOf(h: Hostile): number {
  const ht = tuning.hostiles;
  if (h.kind === 'legionary') return ht.legionary.runSpeed;
  if (h.kind === 'hale') return ht.hale.runSpeed;
  return ht.trooper.runSpeed;
}

function face(h: Hostile, target: V3, degPerSec = 540): void {
  h.yaw = turnToward(h.yaw, yawTo(h.pos, target), deg(degPerSec) * DT());
}

/** Is a capsule-wide straight walk from a to b free of walls? */
export function walkable(w: SimWorld, a: V3, b: V3): boolean {
  const d = distXZ(a, b);
  if (d < 0.05) return true;
  const nx = (b.x - a.x) / d;
  const nz = (b.z - a.z) / d;
  const off = tuning.hostiles.capsuleRadius;
  for (const s of [-off, 0, off]) {
    const ox = -nz * s;
    const oz = nx * s;
    if (!w.physics.clearLine(v3(a.x + ox, 0.9, a.z + oz), v3(b.x + ox, 0.9, b.z + oz))) return false;
  }
  return true;
}

/** Walk toward `target` using the cell graph. Returns true when arrived. */
function moveTo(w: SimWorld, h: Hostile, target: V3, speed: number, arriveDist = 0.5): boolean {
  if (!h.body) return true;
  if (distXZ(h.pos, target) <= arriveDist) {
    h.path = [];
    return true;
  }
  h.pathAge++;
  if (!h.path.length || !h.pathTarget || distXZ(h.pathTarget, target) > 2 || h.pathAge > 90) {
    h.path = w.nav.waypoints(h.pos, target);
    // String-pull: skip waypoints we can walk past in a straight line.
    while (h.path.length >= 2 && walkable(w, h.pos, h.path[1]!)) h.path.shift();
    h.pathTarget = clone(target);
    h.pathAge = 0;
  }
  let wp = h.path[0];
  while (wp && h.path.length > 1 && distXZ(h.pos, wp) < 0.6) {
    h.path.shift();
    wp = h.path[0];
  }
  if (!wp) return true;
  let dir = normalizeXZ(sub(wp, h.pos));
  dir = avoidCharacters(w, h, dir);
  const step = Math.min(speed * DT(), distXZ(h.pos, wp));
  w.physics.move(h.body, dir.x * step, dir.z * step);
  h.yaw = turnToward(h.yaw, Math.atan2(dir.x, dir.z), deg(420) * DT());
  return false;
}

/**
 * Steer around other characters ahead. Everyone keeps to their right, so two
 * people meeting head-on in an alley pass instead of pushing forever.
 */
export function avoidCharacters(w: SimWorld, self: { id: number; pos: V3 }, dir: V3): V3 {
  const range = tuning.hostiles.avoidRange;
  let ax = 0;
  let az = 0;
  const consider = (id: number, pos: V3) => {
    if (id === self.id) return;
    const dx = pos.x - self.pos.x;
    const dz = pos.z - self.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > range || d < 1e-4) return;
    const ahead = (dx * dir.x + dz * dir.z) / d;
    if (ahead < 0.2) return;
    const k = ahead * (1 - d / range);
    // Push away and to our right.
    const rx = -dir.z;
    const rz = dir.x;
    ax += (-dx / d) * k * 0.6 + rx * k;
    az += (-dz / d) * k * 0.6 + rz * k;
  };
  for (const o of w.hostiles) if (o.state !== 'dead' && o.body) consider(o.id, o.pos);
  if (!w.player.dead) consider(w.player.id, w.player.pos);
  if (ax === 0 && az === 0) return dir;
  return normalizeXZ(v3(dir.x + ax, 0, dir.z + az));
}

function lookAround(h: Hostile, w: SimWorld, amplitudeDeg = 55, periodSec = 3.5): void {
  const t = (w.frame + h.id * 37) / tuning.sim.hz;
  const target = h.lookBase + Math.sin((t / periodSec) * Math.PI * 2) * deg(amplitudeDeg);
  h.yaw = turnToward(h.yaw, target, deg(120) * DT());
}

function acquireToken(w: SimWorld, h: Hostile, kind: 'melee' | 'ranged'): boolean {
  if (h.token === kind) return true;
  const max = kind === 'melee' ? tuning.hostiles.maxMeleeAttackers : tuning.hostiles.maxRangedAttackers;
  const set = w.tokens[kind];
  if (set.size >= max) return false;
  set.add(h.id);
  h.token = kind;
  return true;
}

// ------------------------------------------------------------------ patrol

function followRoute(w: SimWorld, h: Hostile, speed: number): void {
  // Escorts stay with Hale while he is on his rounds.
  if (h.escortOf !== null) {
    const hale = w.hostile(h.escortOf);
    if (hale && hale.state !== 'dead') {
      const idx = w.hostiles.filter((o) => o.escortOf === h.escortOf).indexOf(h);
      const back = forwardFromYaw(hale.yaw);
      const side = rightFromYaw(hale.yaw);
      const sideSign = idx % 2 === 0 ? 1 : -1;
      const row = 1.4 + Math.floor(idx / 2) * 1.3;
      const spot = v3(hale.pos.x - back.x * row + side.x * sideSign * 1.3, 0, hale.pos.z - back.z * row + side.z * sideSign * 1.3);
      if (!moveTo(w, h, spot, speed * 1.15, 0.8)) return;
      h.yaw = turnToward(h.yaw, hale.yaw + sideSign * deg(35), deg(180) * DT());
      return;
    }
  }
  if (h.route.length <= 1) {
    const home = h.route[0] ?? h.pos;
    if (moveTo(w, h, home, speed, 0.6)) lookAround(h, w);
    return;
  }
  const inspecting = h.kind === 'hale';
  if (h.waitFrames > 0) {
    h.waitFrames--;
    // Hale stops to inspect: he keeps his eyes on the work, with only a narrow glance.
    if (inspecting) lookAround(h, w, tuning.hostiles.haleInspectLookDeg, 5);
    else lookAround(h, w, 70, 4);
    return;
  }
  const target = h.route[h.routeIndex]!;
  if (moveTo(w, h, target, speed, 0.5)) {
    const hw = tuning.hostiles;
    h.waitFrames = inspecting ? w.rng.int(Math.round(hw.haleInspectMinSec * 60), Math.round(hw.haleInspectMaxSec * 60)) : w.rng.int(60, 160);
    h.lookBase = h.yaw;
    let next = h.routeIndex + h.routeDir;
    if (next < 0 || next >= h.route.length) {
      h.routeDir = h.routeDir === 1 ? -1 : 1;
      next = h.routeIndex + h.routeDir;
    }
    h.routeIndex = Math.max(0, Math.min(h.route.length - 1, next));
  }
}

function patrol(w: SimWorld, h: Hostile): void {
  const ht = tuning.hostiles;
  const p = w.player;
  const d = distXZ(h.pos, p.pos);
  const sees = w.canSee(h);
  const sprintNoise = p.sprinting && d <= ht.sprintNoticeRange;
  const bump = d <= ht.peripheralRange;
  h.seesPlayer = !p.dead && (sees || sprintNoise || bump);
  if (h.seesPlayer) {
    h.detection = Math.min(1, h.detection + DT() / ht.spotTimeSec);
  } else {
    h.detection = Math.max(0, h.detection - ht.detectionDecayPerSec * DT());
  }
  if (h.detection >= 1) {
    spotted(w, h);
    return;
  }
  if (h.seesPlayer && (sprintNoise || h.detection > 0.35)) {
    face(h, p.pos, 240); // stop and stare
    return;
  }
  followRoute(w, h, h.speed);
}

function spotted(w: SimWorld, h: Hostile): void {
  if (h.talkable && !h.talkedDown && !w.suspicion.atMax) {
    h.state = 'challenge';
    h.challengeLostSec = 0;
    h.lastKnown = clone(w.player.pos);
    h.path = [];
    w.emit({ type: 'message', text: `${h.kind === 'legionary' ? 'A Legionary' : 'A Trooper'} wants a word.`, tone: 'warn' });
  } else {
    w.alert(h, w.player.pos);
  }
}

// ------------------------------------------------------------------ challenge

function challenge(w: SimWorld, h: Hostile): void {
  const ht = tuning.hostiles;
  const p = w.player;
  if (w.suspicion.atMax || p.dead) {
    w.alert(h, p.pos);
    return;
  }
  const sees = w.canSee(h, 220, 25);
  h.seesPlayer = sees;
  if (sees) {
    h.challengeLostSec = 0;
    h.lastKnown = clone(p.pos);
  } else h.challengeLostSec += DT();
  const d = distXZ(h.pos, p.pos);
  if (h.challengeLostSec > ht.challengeGiveUpSec || d > ht.challengeGiveUpRange) {
    w.emit({ type: 'message', text: 'You dodged a challenge. They are raising the alarm.', tone: 'bad' });
    w.alert(h, h.lastKnown ?? p.pos);
    return;
  }
  if (d <= ht.challengeTalkRange && sees) {
    w.beginHostileConversation(h);
    return;
  }
  moveTo(w, h, h.lastKnown ?? p.pos, h.speed * 1.35, ht.challengeTalkRange * 0.8);
  if (sees && d < 6) face(h, p.pos);
}

// ------------------------------------------------------------------ alert

function startAttack(h: Hostile, kind: 'melee' | 'ranged'): void {
  h.attack = { kind, frame: 0, shots: 0, hit: false };
}

function rangedSpec(h: Hostile) {
  const a = tuning.hostileAttacks;
  if (h.kind === 'legionary') return a.pistol;
  if (h.kind === 'hale') return a.haleRifle;
  return a.rifle;
}

function meleeSpec(h: Hostile) {
  return h.kind === 'hale' ? tuning.hostileAttacks.haleMelee : tuning.hostileAttacks.baton;
}

function finishAttack(w: SimWorld, h: Hostile, cooldown: number): void {
  w.cancelAttack(h);
  h.attackCooldown = cooldown + w.rng.int(0, 30);
}

function runAttack(w: SimWorld, h: Hostile): void {
  const atk = h.attack!;
  const p = w.player;
  atk.frame++;
  if (atk.kind === 'melee') {
    const s = meleeSpec(h);
    if (atk.frame < s.startup * 0.7) face(h, p.pos, 720);
    if (!atk.hit && atk.frame >= s.startup && atk.frame < s.startup + s.active) {
      const d = distXZ(h.pos, p.pos);
      const ang = Math.abs(angleDiff(h.yaw, yawTo(h.pos, p.pos)));
      if (d <= s.reach + tuning.player.capsuleRadius && ang <= deg(65) && !p.dead) {
        atk.hit = true;
        w.hostileMeleeHitsPlayer(h, s.damage);
        if (!h.attack) return; // parried: attack cancelled and attacker staggered
      }
    }
    if (atk.frame >= s.startup + s.active + s.recovery) finishAttack(w, h, 40);
    return;
  }
  const s = rangedSpec(h);
  const eye = w.eye(h);
  const chest = v3(p.pos.x, 1.2, p.pos.z);
  if (atk.frame <= s.aim) {
    face(h, p.pos, 600);
    h.aimPoint = chest;
    return;
  }
  const since = atk.frame - s.aim;
  if (since % s.burstGap === 1 && atk.shots < s.burst) {
    atk.shots++;
    const a = tuning.hostileAttacks;
    const d = distXZ(h.pos, p.pos);
    const clear = w.physics.clearLine(eye, chest) && w.canSee(h, 120, tuning.hostiles.rangedMaxDistance + 6);
    let hit = false;
    if (clear && !p.dead) {
      const t = Math.max(0, Math.min(1, (d - a.nearDistance) / (a.farDistance - a.nearDistance)));
      let chance = lerp(a.hitChanceNear, a.hitChanceFar, t);
      if (p.sprinting) chance -= a.sprintHitPenalty;
      if (w.rng.chance(chance)) hit = w.hostileGunHitsPlayer(s.damage);
    }
    const miss = hit ? chest : v3(chest.x + w.rng.range(-1.2, 1.2), chest.y + w.rng.range(-0.5, 0.8), chest.z + w.rng.range(-1.2, 1.2));
    w.emit({ type: 'shot', from: v3(h.pos.x, 1.4, h.pos.z), to: miss, loud: true, byPlayer: false, hit });
    // Hostile gunfire pulls in anyone within 10 m.
    w.alert(h, p.pos);
  }
  if (atk.shots >= s.burst && since > s.burst * s.burstGap + 6) finishAttack(w, h, s.cooldown);
}

function alertUpdate(w: SimWorld, h: Hostile): void {
  const ht = tuning.hostiles;
  const p = w.player;
  const sees = w.canSee(h, 240, 30);
  h.seesPlayer = sees;
  if (sees || w.suspicion.atMax) {
    h.lastKnown = clone(p.pos);
    h.unseenSec = 0;
  } else h.unseenSec += DT();
  if (h.unseenSec >= ht.alertForgetSec) {
    // Lost them: back to Patrol.
    h.state = 'patrol';
    h.detection = 0;
    h.path = [];
    w.cancelAttack(h);
    w.emit({ type: 'message', text: 'A hostile gave up the search.', tone: 'info' });
    return;
  }
  if (p.dead) return;
  if (h.attack) {
    runAttack(w, h);
    return;
  }
  if (h.attackCooldown > 0) h.attackCooldown--;
  const d = distXZ(h.pos, p.pos);
  const run = runSpeedOf(h);
  const meleeCapable = h.kind === 'legionary' || h.kind === 'hale';
  if (sees) {
    if (meleeCapable && d < 5) {
      if (d > ht.meleeEngageRange) moveTo(w, h, p.pos, run, ht.meleeEngageRange * 0.9);
      else face(h, p.pos);
      if (d <= ht.meleeEngageRange + 0.3 && h.attackCooldown === 0 && acquireToken(w, h, 'melee')) startAttack(h, 'melee');
      return;
    }
    if (d > ht.rangedMaxDistance) moveTo(w, h, p.pos, run, 1);
    else if (d > ht.preferredRangedDistance + 3) moveTo(w, h, p.pos, h.speed, 1);
    else if (d < 3.5 && !meleeCapable && h.body) {
      const away = normalizeXZ(sub(h.pos, p.pos));
      w.physics.move(h.body, away.x * h.speed * DT(), away.z * h.speed * DT());
      face(h, p.pos);
    } else if (h.body) {
      // Strafe while holding range.
      if (--h.strafeFrames <= 0) {
        h.strafeSign = h.strafeSign === 1 ? -1 : 1;
        h.strafeFrames = w.rng.int(70, 150);
      }
      const r = rightFromYaw(yawTo(h.pos, p.pos));
      const sp = h.speed * 0.45 * DT() * h.strafeSign;
      w.physics.move(h.body, r.x * sp, r.z * sp);
      face(h, p.pos);
    }
    if (d <= ht.rangedMaxDistance && h.attackCooldown === 0 && acquireToken(w, h, 'ranged')) startAttack(h, 'ranged');
    return;
  }
  // Hunt the last known position.
  if (h.lastKnown && distXZ(h.pos, h.lastKnown) > 1.2) moveTo(w, h, h.lastKnown, w.suspicion.atMax ? run : run * 0.85, 1);
  else {
    h.lookBase = h.lookBase || h.yaw;
    lookAround(h, w, 90, 3);
  }
}

// ------------------------------------------------------------------ stood down

function stoodDown(w: SimWorld, h: Hostile): void {
  h.seesPlayer = false;
  h.detection = 0;
  const d = distXZ(h.pos, w.player.pos);
  if (h.waitFrames > 0 && d < 4) {
    face(h, w.player.pos, 200);
    h.waitFrames--;
    return;
  }
  followRoute(w, h, h.speed * 0.9);
}

export function updateHostile(w: SimWorld, h: Hostile): void {
  if (h.state === 'dead' || h.state === 'conversation') return;
  if (h.combat !== 'none') {
    if (h.combat === 'grabbed') return;
    if (--h.combatFrames <= 0) {
      h.combat = 'none';
      h.combatFrames = 0;
    } else return;
  }
  switch (h.state) {
    case 'patrol':
      if (h.attackCooldown > 0) h.attackCooldown--;
      patrol(w, h);
      break;
    case 'challenge':
      challenge(w, h);
      break;
    case 'alert':
      alertUpdate(w, h);
      break;
    case 'stoodDown':
      stoodDown(w, h);
      break;
  }
}
