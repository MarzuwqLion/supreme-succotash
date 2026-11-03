import { add, angleDiff, clamp, distXZ, forwardFromYaw, normalizeXZ, rightFromYaw, scale, sub, turnToward, v3, yawTo, type V3 } from '../core/vec';
import { tuning, type MoveFrames } from '../data/tuning';
import type { InputFrame } from '../input/input';
import { gunDamage } from './damage';
import type { Hostile, ItemSlot, Player } from './entities';
import type { SimWorld } from './world';

/** Player controller: movement, view, melee, defense, context actions, guns, items. */

const DT = () => 1 / tuning.sim.hz;
export const ITEM_ORDER: readonly ItemSlot[] = ['medkit', 'smoke', 'jammer'];

export function itemAvailable(w: SimWorld, item: ItemSlot): boolean {
  const p = w.player;
  if (item === 'medkit') return p.items.medkit > 0;
  if (item === 'smoke') return p.items.smoke > 0;
  return p.hasJammer && w.suspicion.jammerAvailable;
}

export function selectedItem(w: SimWorld): ItemSlot | null {
  const p = w.player;
  for (let k = 0; k < ITEM_ORDER.length; k++) {
    const item = ITEM_ORDER[(p.selectedItem + k) % ITEM_ORDER.length]!;
    if (itemAvailable(w, item)) return item;
  }
  return null;
}

const totalFrames = (m: MoveFrames) => m.startup + m.active + m.recovery;
const lightFrames = (step: number): MoveFrames => [tuning.melee.light1, tuning.melee.light2, tuning.melee.light3][step]!;

function alive(h: Hostile | null): h is Hostile {
  return !!h && h.state !== 'dead';
}

// ------------------------------------------------------------------ view

function updateView(w: SimWorld, input: InputFrame): void {
  const p = w.player;
  const cam = tuning.camera;
  p.viewPitch = clamp(p.viewPitch + input.look.y, (tuning.player.pitchMinDeg * Math.PI) / 180, (tuning.player.pitchMaxDeg * Math.PI) / 180);
  const target = w.hostile(p.lockTarget);
  if (input.pressed.lockOn) {
    if (p.lockTarget !== null) p.lockTarget = null;
    else p.lockTarget = pickLockTarget(w);
  }
  if (alive(target) && distXZ(target.pos, p.pos) <= cam.lockOnBreakRange) {
    const want = yawTo(p.pos, target.pos);
    p.viewYaw = turnToward(p.viewYaw, want, 6 * DT()) - input.look.x * 0.25;
  } else {
    if (p.lockTarget !== null) p.lockTarget = null;
    p.viewYaw -= input.look.x;
  }
}

function pickLockTarget(w: SimWorld): number | null {
  const p = w.player;
  let best: { id: number; score: number } | null = null;
  for (const h of w.hostiles) {
    if (h.state === 'dead') continue;
    const d = distXZ(h.pos, p.pos);
    if (d > tuning.camera.lockOnRange) continue;
    const ang = Math.abs(angleDiff(p.viewYaw, yawTo(p.pos, h.pos)));
    if (ang > (75 * Math.PI) / 180) continue;
    if (!w.physics.clearLine(v3(p.pos.x, 1.5, p.pos.z), v3(h.pos.x, 1.5, h.pos.z))) continue;
    const score = d + ang * 8;
    if (!best || score < best.score) best = { id: h.id, score };
  }
  return best?.id ?? null;
}

// ------------------------------------------------------------------ movement

function moveDirWorld(p: Player, input: InputFrame): V3 {
  const f = forwardFromYaw(p.viewYaw);
  const r = rightFromYaw(p.viewYaw);
  return add(scale(f, input.move.y), scale(r, input.move.x));
}

function locomote(w: SimWorld, input: InputFrame): void {
  const p = w.player;
  const pt = tuning.player;
  const dir = moveDirWorld(p, input);
  const mag = Math.min(1, Math.hypot(dir.x, dir.z));
  const moving = mag > 0.05;
  p.sprinting = !!input.held.sprint && moving && !p.aiming && !p.blocking;
  let speed = mag < 0.55 && input.device === 'pad' ? pt.walkSpeed : pt.runSpeed;
  if (p.sprinting) speed = pt.sprintSpeed;
  if (p.aiming) speed = pt.aimMoveSpeed;
  if (p.blocking) speed = pt.blockMoveSpeed;
  const nd = normalizeXZ(dir);
  const step = moving ? speed * Math.max(mag, 0.6) * DT() : 0;
  if (moving) w.physics.move(p.body, nd.x * step, nd.z * step);
  p.speed = moving ? speed * Math.max(mag, 0.6) : 0;

  const turn = ((pt.turnRateDegPerSec * Math.PI) / 180) * DT();
  const lock = w.hostile(p.lockTarget);
  if (p.aiming) p.yaw = turnToward(p.yaw, p.viewYaw, turn * 2);
  else if (alive(lock)) p.yaw = turnToward(p.yaw, yawTo(p.pos, lock.pos), turn);
  else if (moving) p.yaw = turnToward(p.yaw, Math.atan2(nd.x, nd.z), turn);
}

// ------------------------------------------------------------------ melee

function pickMeleeTarget(w: SimWorld, input: InputFrame): Hostile | null {
  const p = w.player;
  const lock = w.hostile(p.lockTarget);
  const range = tuning.melee.targetAcquireRange;
  if (alive(lock) && lock.combat !== 'grabbed' && distXZ(lock.pos, p.pos) <= range) return lock;
  const dir = moveDirWorld(p, input);
  const pref = Math.hypot(dir.x, dir.z) > 0.2 ? Math.atan2(dir.x, dir.z) : p.yaw;
  let best: { h: Hostile; score: number } | null = null;
  for (const h of w.hostiles) {
    if (h.state === 'dead' || h.combat === 'grabbed') continue;
    const d = distXZ(h.pos, p.pos);
    if (d > range) continue;
    const ang = Math.abs(angleDiff(pref, yawTo(p.pos, h.pos)));
    if (ang > (110 * Math.PI) / 180 && d > 1.2) continue;
    const score = d + ang * 1.5 - (h.state === 'alert' ? 0.5 : 0);
    if (!best || score < best.score) best = { h, score };
  }
  return best?.h ?? null;
}

function startLight(w: SimWorld, input: InputFrame, step: number): void {
  const p = w.player;
  const t = pickMeleeTarget(w, input);
  p.action = { kind: 'light', step, frame: 0, target: t?.id ?? null, hit: false, queued: false, pbFired: false, pbAt: -1 };
  p.meleeTarget = t?.id ?? null;
  if (t) p.yaw = yawTo(p.pos, t.pos);
}

function startHeavy(w: SimWorld, input: InputFrame): void {
  const p = w.player;
  const t = pickMeleeTarget(w, input);
  p.action = { kind: 'heavy', frame: 0, target: t?.id ?? null, hit: false, pbFired: false, pbAt: -1 };
  p.meleeTarget = t?.id ?? null;
  if (t) p.yaw = yawTo(p.pos, t.pos);
}

function startDodge(w: SimWorld, input: InputFrame): void {
  const p = w.player;
  const dir = moveDirWorld(p, input);
  const d = Math.hypot(dir.x, dir.z) > 0.2 ? normalizeXZ(dir) : scale(forwardFromYaw(p.yaw), -1);
  p.action = { kind: 'dodge', frame: 0, dir: d };
  p.blocking = false;
  p.parryFrame = -1;
  if (p.lockTarget === null) p.yaw = Math.atan2(d.x, d.z);
}

/** Lunge toward the target during startup so strikes connect. */
function lunge(w: SimWorld, target: Hostile | null, startup: number): void {
  const p = w.player;
  if (!alive(target)) return;
  p.yaw = turnToward(p.yaw, yawTo(p.pos, target.pos), 0.5);
  const d = distXZ(p.pos, target.pos);
  const desired = tuning.melee.reach * 0.7;
  const gap = d - desired;
  if (gap <= 0) return;
  const per = Math.min(gap, tuning.melee.lungeMax) / Math.max(1, startup);
  const dir = normalizeXZ(sub(target.pos, p.pos));
  w.physics.move(p.body, dir.x * per, dir.z * per);
}

function strikeConnects(w: SimWorld, target: Hostile | null): target is Hostile {
  const p = w.player;
  if (!alive(target) || target.combat === 'grabbed') return false;
  const d = distXZ(p.pos, target.pos);
  if (d > tuning.melee.reach + tuning.hostiles.capsuleRadius) return false;
  const ang = Math.abs(angleDiff(p.yaw, yawTo(p.pos, target.pos)));
  return ang <= (tuning.melee.arcDeg * Math.PI) / 360;
}

/** Shared light/heavy logic: lunge, hit on active frames, point-blank shot. */
function runStrike(
  w: SimWorld,
  input: InputFrame,
  a: { frame: number; target: number | null; hit: boolean; pbFired: boolean; pbAt: number },
  frames: MoveFrames,
  damage: number,
  hitstun: number,
): void {
  const target = w.hostile(a.target);
  if (a.frame < frames.startup) lunge(w, target, frames.startup);
  const activeStart = frames.startup;
  const activeEnd = frames.startup + frames.active;
  if (!a.hit && a.frame >= activeStart && a.frame < activeEnd && strikeConnects(w, target)) {
    a.hit = true;
    w.damageHostile(target, damage, 'melee', hitstun);
    w.applySuspicion(w.suspicion.melee());
    w.emit({ type: 'impact', pos: v3(target.pos.x, 1.2, target.pos.z), kind: 'melee' });
  }
  // Point-blank shot: RT during a strike snaps a shot at the melee target, once per strike.
  if (input.pressed.fire && !a.pbFired && alive(target) && canShoot(w.player)) {
    a.pbFired = true;
    a.pbAt = a.frame + tuning.melee.pointBlankSnapFrames;
  }
  if (a.pbAt >= 0 && a.frame === a.pbAt) {
    a.pbAt = -1;
    if (alive(target)) pointBlankShot(w, target);
  }
}

function startContext(w: SimWorld): boolean {
  const p = w.player;
  const { action, target } = p.context;
  const h = w.hostile(target);
  if (!action || !alive(h)) return false;
  w.cancelAttack(h);
  h.combat = 'grabbed';
  h.combatFrames = 0;
  p.yaw = yawTo(p.pos, h.pos);
  p.blocking = false;
  p.aiming = false;
  if (action === 'takedown') p.action = { kind: 'takedown', frame: 0, target: h.id };
  else if (action === 'execution') p.action = { kind: 'execution', frame: 0, target: h.id };
  else p.action = { kind: 'throw', frame: 0, target: h.id, dir: forwardFromYaw(p.yaw), from: { ...h.pos } };
  return true;
}

function releaseGrab(h: Hostile | null): void {
  if (alive(h) && h.combat === 'grabbed') {
    h.combat = 'none';
    h.combatFrames = 0;
  }
}

/** Pull the grabbed target to a spot in front of the agent. */
function holdTarget(w: SimWorld, h: Hostile, distance: number): void {
  const p = w.player;
  const f = forwardFromYaw(p.yaw);
  const spot = add(p.pos, scale(f, distance));
  if (h.body) w.physics.teleport(h.body, spot);
  h.yaw = p.yaw; // facing away: the agent is behind them
}

// ------------------------------------------------------------------ guns

function canShoot(p: Player): boolean {
  const slot = p.weapons[p.slot];
  return !!slot && slot.mag > 0 && p.reload === 0 && p.swap === 0 && p.fireCooldown === 0;
}

function startReload(p: Player): void {
  const slot = p.weapons[p.slot];
  if (!slot || p.reload > 0) return;
  const spec = tuning.weapons[slot.id];
  if (slot.mag >= spec.magazine || slot.reserve <= 0) return;
  p.reload = spec.reload;
}

function tickReload(p: Player): void {
  if (p.reload <= 0) return;
  p.reload--;
  if (p.reload === 0) {
    const slot = p.weapons[p.slot]!;
    const spec = tuning.weapons[slot.id];
    const take = Math.min(spec.magazine - slot.mag, slot.reserve);
    slot.mag += take;
    slot.reserve -= take;
  }
}

/** Gunfire noise rules: loud = +20 (rate limited) and 30 m alert; silenced = +10 only if seen. */
function gunNoise(w: SimWorld, loud: boolean): void {
  const p = w.player;
  if (loud) {
    w.applySuspicion(w.suspicion.loudGunfire(w.timeSec));
    w.loudNoise(p.pos);
  } else {
    // A silenced shot gives the agent away only to hostiles who weren't already fighting.
    const seen = w.witnesses().filter((h) => h.state !== 'stoodDown' && h.state !== 'alert');
    w.applySuspicion(w.suspicion.silencedShot(seen.length > 0));
    for (const h of seen) w.alert(h, p.pos, { propagate: false });
  }
}

function consumeRound(w: SimWorld): { damage: number; loud: boolean } | null {
  const p = w.player;
  const slot = p.weapons[p.slot];
  if (!slot || !canShoot(p)) return null;
  const spec = tuning.weapons[slot.id];
  slot.mag--;
  p.fireCooldown = spec.fireInterval;
  p.lastShotFrame = w.frame;
  return { damage: spec.damage, loud: spec.loud };
}

function afterShot(w: SimWorld): void {
  const p = w.player;
  const slot = p.weapons[p.slot]!;
  if (slot.mag === 0) startReload(p); // automatic when empty
}

function muzzle(p: Player): V3 {
  const f = forwardFromYaw(p.yaw);
  const r = rightFromYaw(p.yaw);
  return v3(p.pos.x + f.x * 0.5 + r.x * 0.25, 1.35, p.pos.z + f.z * 0.5 + r.z * 0.25);
}

function pointBlankShot(w: SimWorld, target: Hostile): void {
  const round = consumeRound(w);
  if (!round) return;
  const p = w.player;
  const to = v3(target.pos.x, 1.2, target.pos.z);
  w.damageHostile(target, round.damage, 'gun', 6);
  w.emit({ type: 'shot', from: muzzle(p), to, loud: round.loud, byPlayer: true, hit: true });
  gunNoise(w, round.loud);
  afterShot(w);
}

/** Where the aim ray starts and points, from sim state only (never the render camera). */
export function aimRay(p: Player): { origin: V3; dir: V3 } {
  const cam = p.aiming ? tuning.camera.aim : tuning.camera.explore;
  const r = rightFromYaw(p.viewYaw);
  const cp = Math.cos(p.viewPitch);
  const dir = v3(Math.sin(p.viewYaw) * cp, Math.sin(p.viewPitch), Math.cos(p.viewYaw) * cp);
  // Start at the camera pivot (beside the shoulder) so walls behind the agent don't eat shots.
  const origin = v3(p.pos.x + r.x * cam.side, cam.height, p.pos.z + r.z * cam.side);
  return { origin, dir };
}

function fireAimed(w: SimWorld): void {
  const round = consumeRound(w);
  if (!round) return;
  const p = w.player;
  const lock = w.hostile(p.lockTarget);
  let origin: V3;
  let dir: V3;
  if (!p.aiming && alive(lock)) {
    origin = muzzle(p);
    const to = v3(lock.pos.x, 1.25, lock.pos.z);
    const d = sub(to, origin);
    const l = Math.hypot(d.x, d.y, d.z);
    dir = scale(d, 1 / l);
  } else {
    ({ origin, dir } = aimRay(p));
    if (!p.aiming) p.yaw = p.viewYaw;
  }
  const range = tuning.weapons.range;
  const hit = w.physics.raycast(origin, dir, range, 'all', p.body);
  const end = hit ? hit.point : add(origin, scale(dir, range));
  let hitHostile = false;
  if (hit && hit.entityId !== null) {
    const h = w.hostiles.find((x) => x.id === hit.entityId) ?? null;
    if (alive(h)) {
      const top = h.body ? h.body.centerY + h.body.halfHeight + h.body.radius : 1.85;
      const headshot = hit.point.y >= top - tuning.weapons.headZoneHeight;
      hitHostile = true;
      w.damageHostile(h, gunDamage(round.damage, headshot), 'gun', 6);
      w.emit({ type: 'impact', pos: hit.point, kind: 'gun' });
      if (headshot) w.emit({ type: 'message', text: 'Headshot', tone: 'good' });
    }
  }
  w.emit({ type: 'shot', from: muzzle(p), to: end, loud: round.loud, byPlayer: true, hit: hitHostile });
  gunNoise(w, round.loud);
  afterShot(w);
}

// ------------------------------------------------------------------ items

function useItem(w: SimWorld, item: ItemSlot | null): void {
  const p = w.player;
  if (!item) {
    w.emit({ type: 'message', text: 'No usable items', tone: 'info' });
    return;
  }
  if (item === 'medkit') {
    if (p.health >= p.maxHealth) {
      w.emit({ type: 'message', text: 'Already at full health', tone: 'info' });
      return;
    }
    p.items.medkit--;
    p.health = Math.min(p.maxHealth, p.health + tuning.items.medkitHeal);
    w.emit({ type: 'message', text: `Medkit: +${tuning.items.medkitHeal} health`, tone: 'good' });
  } else if (item === 'smoke') {
    p.items.smoke--;
    const f = forwardFromYaw(p.viewYaw);
    const d = w.physics.freeDistance(p.pos, f, tuning.items.smokeThrowDistance, 0.5);
    w.spawnSmoke(add(p.pos, scale(f, d)));
  } else {
    const change = w.suspicion.jammer();
    if (!change) {
      w.emit({ type: 'message', text: 'Jammer already used in this area', tone: 'warn' });
      return;
    }
    w.applySuspicion(change);
    w.emit({ type: 'message', text: `Signal jammer: -${tuning.suspicion.jammer} suspicion`, tone: 'good' });
  }
}

function handleItems(w: SimWorld, input: InputFrame, free: boolean): void {
  const p = w.player;
  const cycle = tuning.items.useHoldCycleFrames;
  if (input.pressed.useItem) p.useHeldFrames = 0;
  else if (p.useHeldFrames >= 0 && input.held.useItem) {
    p.useHeldFrames++;
    if (p.useHeldFrames % cycle === 0) {
      // Long press cycles to the next available item.
      const cur = selectedItem(w);
      const start = cur ? ITEM_ORDER.indexOf(cur) : p.selectedItem;
      for (let k = 1; k <= ITEM_ORDER.length; k++) {
        const idx = (start + k) % ITEM_ORDER.length;
        if (itemAvailable(w, ITEM_ORDER[idx]!)) {
          p.selectedItem = idx;
          break;
        }
      }
    }
  }
  if (p.useHeldFrames >= 0 && (input.released.useItem || !input.held.useItem)) {
    if (p.useHeldFrames < cycle && free) useItem(w, selectedItem(w));
    p.useHeldFrames = -1;
  }
}

// ------------------------------------------------------------------ main

export function updatePlayer(w: SimWorld, input: InputFrame): void {
  const p = w.player;
  if (p.dead) return;
  const m = tuning.melee;
  if (p.hurtFlash > 0) p.hurtFlash--;
  updateView(w, input);
  if (p.fireCooldown > 0) p.fireCooldown--;
  if (p.swap > 0) p.swap--;
  if (p.parryLockout > 0) p.parryLockout--;
  if (p.parryFrame >= 0 && ++p.parryFrame >= m.parryWindow) p.parryFrame = -1;
  tickReload(p);

  // Weapon management works in any state except grabs.
  const grabbing = p.action.kind === 'takedown' || p.action.kind === 'execution' || p.action.kind === 'throw';
  if (!grabbing) {
    let want = p.slot;
    if (input.pressed.swap1) want = 0;
    if (input.pressed.swap2) want = 1;
    if (input.pressed.swapNext || input.pressed.swapPrev) want = (p.slot + 1) % p.weapons.length;
    if (want !== p.slot && want < p.weapons.length) {
      p.slot = want;
      p.reload = 0;
      p.swap = tuning.weapons.swapFrames;
    }
    if (input.pressed.reload) startReload(p);
  }

  const a = p.action;
  switch (a.kind) {
    case 'none':
      break;
    case 'light': {
      const fr = lightFrames(a.step);
      runStrike(w, input, a, fr, m.lightDamage[a.step] ?? 8, m.lightHitstun[a.step] ?? 14);
      if (input.pressed.light) a.queued = true;
      a.frame++;
      const inRecovery = a.frame >= fr.startup + fr.active;
      if (inRecovery) {
        if (a.queued && a.step < 2) return startLight(w, input, a.step + 1);
        if (input.pressed.heavy) return startHeavy(w, input);
        if (input.pressed.dodge) return startDodge(w, input);
        if (input.pressed.context && startContext(w)) return;
        if (input.pressed.block) p.action = { kind: 'none' };
      }
      if (a.frame >= totalFrames(fr)) p.action = { kind: 'none' };
      if (p.action.kind !== 'none') return;
      break;
    }
    case 'heavy': {
      const fr = m.heavy;
      runStrike(w, input, a, fr, m.heavyDamage, m.heavyHitstun);
      a.frame++;
      if (a.frame >= fr.startup + fr.active) {
        if (input.pressed.dodge) return startDodge(w, input);
        if (input.pressed.light) return startLight(w, input, 0);
        if (input.pressed.context && startContext(w)) return;
        if (input.pressed.block) p.action = { kind: 'none' };
      }
      if (a.frame >= totalFrames(fr)) p.action = { kind: 'none' };
      if (p.action.kind !== 'none') return;
      break;
    }
    case 'dodge': {
      const moveFrames = Math.max(1, m.dodgeTotal - 4);
      if (a.frame < moveFrames) {
        const step = m.dodgeDistance / moveFrames;
        w.physics.move(p.body, a.dir.x * step, a.dir.z * step);
      }
      a.frame++;
      if (a.frame >= m.dodgeTotal) p.action = { kind: 'none' };
      else return;
      break;
    }
    case 'takedown': {
      const h = w.hostile(a.target);
      if (alive(h) && a.frame < m.takedownKillFrame) holdTarget(w, h, 0.75);
      if (a.frame === m.takedownKillFrame && alive(h)) {
        w.killHostile(h, 'takedown');
        w.applySuspicion(w.suspicion.melee());
        w.witnessKill(h);
      }
      a.frame++;
      if (a.frame >= m.takedownTotal) {
        releaseGrab(h);
        p.action = { kind: 'none' };
      } else return;
      break;
    }
    case 'execution': {
      const h = w.hostile(a.target);
      if (alive(h) && a.frame < m.executionKillFrame) holdTarget(w, h, 0.9);
      if (a.frame === m.executionKillFrame && alive(h)) {
        w.killHostile(h, 'execution');
        w.applySuspicion(w.suspicion.melee());
        w.witnessKill(h);
      }
      a.frame++;
      if (a.frame >= m.executionTotal) {
        releaseGrab(h);
        p.action = { kind: 'none' };
      } else return;
      break;
    }
    case 'throw': {
      const h = w.hostile(a.target);
      const grabEnd = 12;
      if (alive(h)) {
        if (a.frame < grabEnd) holdTarget(w, h, 0.8);
        else if (a.frame < m.throwLandFrame) {
          // Arc the target over to the landing spot.
          const from = add(p.pos, scale(a.dir, 0.8));
          const free = w.physics.freeDistance(from, a.dir, m.throwDistance, 0.4);
          const t = (a.frame - grabEnd) / Math.max(1, m.throwLandFrame - grabEnd);
          const spot = add(from, scale(a.dir, free * t));
          if (h.body) w.physics.teleport(h.body, spot);
        } else if (a.frame === m.throwLandFrame) {
          h.combat = 'knockdown';
          h.combatFrames = m.throwKnockdown;
          w.emit({ type: 'impact', pos: v3(h.pos.x, 0.3, h.pos.z), kind: 'melee' });
          w.damageHostile(h, m.throwDamage, 'throw', 0);
          if (alive(h)) {
            h.combat = 'knockdown';
            h.combatFrames = m.throwKnockdown;
          }
        }
      }
      a.frame++;
      if (a.frame >= m.throwTotal) {
        if (alive(h) && h.combat === 'grabbed') releaseGrab(h);
        p.action = { kind: 'none' };
      } else return;
      break;
    }
    case 'hitstun': {
      a.frame++;
      p.blocking = false;
      if (a.frame >= a.duration) p.action = { kind: 'none' };
      else return;
      break;
    }
  }

  // ---------------- neutral
  p.blocking = !!input.held.block;
  if (input.pressed.block && p.parryLockout === 0) {
    p.parryFrame = 0;
    p.parryLockout = m.parryRepressLockout;
  }
  p.aiming = !!input.held.aim && !p.blocking;
  locomote(w, input);
  handleItems(w, input, true);

  if (input.pressed.interact) {
    w.interact();
    return;
  }
  if (input.pressed.context && startContext(w)) return;
  if (input.pressed.dodge) return startDodge(w, input);
  if (!p.blocking) {
    if (input.pressed.light) return startLight(w, input, 0);
    if (input.pressed.heavy) return startHeavy(w, input);
  }
  const slot = p.weapons[p.slot];
  const auto = slot ? tuning.weapons[slot.id].automatic : false;
  if (!p.blocking && (input.pressed.fire || (auto && input.held.fire))) {
    if (slot && slot.mag === 0) startReload(p);
    else fireAimed(w);
  }
}
