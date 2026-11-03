import type { IntelId } from '../content/dialogue/types';
import { INTEL_IDS } from '../content/dialogue/types';
import { Rng, hashSeed } from '../core/rng';
import { tuning, type WeaponId } from '../data/tuning';
import { maxArmorFor, maxHealthFor } from '../meta/economy';
import type { Loadout, SaveData } from '../meta/save';
import type { WeaponSlot } from '../sim/entities';
import { planRun, type RunPlan } from '../sim/gen/generator';
import type { PlayerCarry } from '../sim/world';

/** State of one run across its three areas. */

export interface RunStats {
  timeFrames: number;
  kills: number;
  takedowns: number;
  executions: number;
  conversationsWon: number;
  conversationsLost: number;
  conversationsPending: number;
  peakSuspicion: number;
  cashEarned: number;
}

export interface RunSession {
  plan: RunPlan;
  runIndex: number;
  areaIndex: number;
  loadout: Loadout;
  carry: PlayerCarry;
  stats: RunStats;
  castSeen: { lucca: boolean; lucretia: boolean };
  haleInvolved: boolean;
  coverIdentity: boolean;
}

export function weaponSlot(id: WeaponId): WeaponSlot {
  const w = tuning.weapons[id];
  return { id, mag: w.magazine, reserve: w.reserve };
}

export function initialCarry(save: SaveData, loadout: Loadout): PlayerCarry {
  const weapons = [weaponSlot('pistol')];
  if (loadout.weapon) weapons.push(weaponSlot(loadout.weapon));
  const maxHealth = maxHealthFor(save);
  const maxArmor = maxArmorFor(loadout);
  return {
    health: maxHealth,
    maxHealth,
    armor: maxArmor,
    maxArmor,
    weapons,
    items: {
      medkit: loadout.runItems.filter((i) => i === 'medkit').length,
      smoke: loadout.runItems.filter((i) => i === 'smoke').length,
    },
    hasJammer: loadout.gadget === 'jammer',
    intel: [],
  };
}

export function newRunSession(save: SaveData, loadout: Loadout, seed: number, runIndex: number): RunSession {
  return {
    plan: planRun(seed),
    runIndex,
    areaIndex: 0,
    loadout,
    carry: initialCarry(save, loadout),
    stats: {
      timeFrames: 0,
      kills: 0,
      takedowns: 0,
      executions: 0,
      conversationsWon: 0,
      conversationsLost: 0,
      conversationsPending: 0,
      peakSuspicion: 0,
      cashEarned: 0,
    },
    castSeen: { lucca: false, lucretia: false },
    haleInvolved: false,
    coverIdentity: save.upgrades.coverIdentity,
  };
}

/** Areas 1 and 2 each hold one random piece of intel, preferring ones the agent lacks. */
export function intelForArea(seed: number, areaIndex: number, held: readonly IntelId[]): IntelId | null {
  if (areaIndex >= 2) return null;
  const rng = new Rng(hashSeed(seed, 'intel', areaIndex));
  const missing = INTEL_IDS.filter((i) => !held.includes(i));
  return rng.pick(missing.length ? missing : INTEL_IDS);
}
