import type { Rng } from '../core/rng';
import { tuning } from '../data/tuning';

/** Treasure cache rolls: 70% valuables (100-300 cash), 30% a run item. */

export type RunPickup = 'medkit' | 'smoke' | 'ammo' | 'armorPlate';
export const RUN_PICKUPS: readonly RunPickup[] = ['medkit', 'smoke', 'ammo', 'armorPlate'];

export type CacheLoot = { kind: 'cash'; amount: number } | { kind: 'item'; item: RunPickup };

export function rollCache(rng: Rng): CacheLoot {
  const t = tuning.treasure;
  if (rng.chance(t.valuablesChance)) {
    // Round to tens so values read cleanly.
    const amount = Math.round(rng.range(t.valuablesMin, t.valuablesMax) / 10) * 10;
    return { kind: 'cash', amount: Math.max(t.valuablesMin, Math.min(t.valuablesMax, amount)) };
  }
  return { kind: 'item', item: rng.pick(RUN_PICKUPS) };
}

export const PICKUP_NAMES: Record<RunPickup, string> = {
  medkit: 'Medkit',
  smoke: 'Smoke grenade',
  ammo: 'Ammo',
  armorPlate: 'Armor plate',
};
