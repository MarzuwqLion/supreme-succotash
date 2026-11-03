import { tuning } from '../data/tuning';

/** Pure damage rules shared by player and hostiles. */

export type DamageType = 'melee' | 'gun';

export interface Vitals {
  health: number;
  armor: number;
}

export interface DamageResult {
  healthLost: number;
  armorLost: number;
  dead: boolean;
}

export interface DefenseState {
  /** Frames since block was pressed, or -1 if no parry window is open. */
  parryFrame: number;
  blocking: boolean;
  invulnerable: boolean;
}

export type MeleeDefenseOutcome = 'invulnerable' | 'parried' | 'blocked' | 'hit';

/** Decide how the agent's defense handles an incoming melee hit. */
export function resolveMeleeDefense(def: DefenseState): MeleeDefenseOutcome {
  if (def.invulnerable) return 'invulnerable';
  if (def.parryFrame >= 0 && def.parryFrame < tuning.melee.parryWindow) return 'parried';
  if (def.blocking) return 'blocked';
  return 'hit';
}

/**
 * Apply damage to the agent. Armor absorbs gunfire before health; melee
 * goes straight to health. Block cuts melee damage by 70%.
 */
export function applyAgentDamage(v: Vitals, amount: number, type: DamageType, blocked = false): DamageResult {
  let dmg = Math.max(0, amount);
  let armorLost = 0;
  if (type === 'melee') {
    if (blocked) dmg = dmg * (1 - tuning.melee.blockReduction);
  } else {
    armorLost = Math.min(v.armor, dmg);
    v.armor -= armorLost;
    dmg -= armorLost;
  }
  const healthLost = Math.min(v.health, dmg);
  v.health -= healthLost;
  return { healthLost, armorLost, dead: v.health <= 0 };
}

/** Gun damage against a hostile; headshots multiply. */
export function gunDamage(base: number, headshot: boolean): number {
  return headshot ? base * tuning.weapons.headshotMultiplier : base;
}

export function applyHostileDamage(h: { health: number }, amount: number): DamageResult {
  const healthLost = Math.min(h.health, Math.max(0, amount));
  h.health -= healthLost;
  return { healthLost, armorLost: 0, dead: h.health <= 0 };
}

export type HostileKind = 'legionary' | 'trooper' | 'escort' | 'hale';

export interface CombatTargetInfo {
  kind: HostileKind;
  health: number;
  maxHealth: number;
  /** Patrol (unaware) or stood down. */
  unaware: boolean;
  staggered: boolean;
  knockedDown: boolean;
}

export type ContextAction = 'takedown' | 'execution' | 'throw' | null;

/**
 * B does one job at a time: Takedown on an unaware target, Execution on a
 * staggered or knocked-down one, otherwise Throw. Hale can't be thrown and
 * can only be executed at or below 30% health.
 */
export function contextActionFor(t: CombatTargetInfo, distance: number): ContextAction {
  const m = tuning.melee;
  if (t.health <= 0) return null;
  if (t.unaware && distance <= m.takedownRange) return 'takedown';
  if ((t.staggered || t.knockedDown) && distance <= m.executionRange) {
    if (t.kind !== 'hale' || t.health <= t.maxHealth * m.haleExecuteHealthFraction) return 'execution';
  }
  if (!t.unaware && t.kind !== 'hale' && distance <= m.throwRange && !t.knockedDown) return 'throw';
  return null;
}
