import { tuning } from '../data/tuning';
import type { ActiveRun, Loadout, OwnedGearId, RunItemId, RunRecord, SaveData, UpgradeId } from './save';
import { emptyLoadout, OWNED_GEAR } from './save';

/** FOB shop, loadout rules, gear lock, and run start/end bookkeeping. */

export type ShopItemId = OwnedGearId | RunItemId | UpgradeId;
export type ShopItemType = 'owned' | 'runOnly' | 'permanent';

export interface ShopItem {
  id: ShopItemId;
  name: string;
  type: ShopItemType;
  slot?: 'weapon' | 'armor' | 'gadget';
  desc: string;
}

export const SHOP_ITEMS: readonly ShopItem[] = [
  { id: 'revolver', name: 'Heavy revolver', type: 'owned', slot: 'weapon', desc: 'Loud. 55 damage, 6 rounds.' },
  { id: 'smg', name: 'Compact SMG', type: 'owned', slot: 'weapon', desc: 'Loud. 12 damage, 30 rounds, automatic.' },
  { id: 'plateCarrier', name: 'Plate carrier', type: 'owned', slot: 'armor', desc: 'Replaces the vest with 100 armor.' },
  { id: 'jammer', name: 'Signal jammer', type: 'owned', slot: 'gadget', desc: 'Removes 25 suspicion, once per area.' },
  { id: 'smoke', name: 'Smoke grenade', type: 'runOnly', desc: 'Blocks vision for 8 seconds.' },
  { id: 'medkit', name: 'Medkit', type: 'runOnly', desc: 'Restores 50 health.' },
  { id: 'conditioning', name: 'Conditioning', type: 'permanent', desc: 'Adds 20 max health.' },
  { id: 'coverIdentity', name: 'Cover identity', type: 'permanent', desc: 'First failed conversation in each area adds no suspicion.' },
];

export const shopItem = (id: ShopItemId): ShopItem => SHOP_ITEMS.find((i) => i.id === id)!;
export const priceOf = (id: ShopItemId): number => tuning.shop[id];

export function isOwnedGear(id: string): id is OwnedGearId {
  return (OWNED_GEAR as readonly string[]).includes(id);
}

export interface CheckResult {
  ok: boolean;
  reason?: string;
}

export function canBuy(save: SaveData, id: ShopItemId): CheckResult {
  const item = shopItem(id);
  if (item.type === 'owned' && save.owned[id as OwnedGearId]) return { ok: false, reason: 'Already owned' };
  if (item.type === 'permanent' && save.upgrades[id as UpgradeId]) return { ok: false, reason: 'Already active' };
  if (save.cash < priceOf(id)) return { ok: false, reason: 'Not enough cash' };
  return { ok: true };
}

export function buy(save: SaveData, id: ShopItemId): CheckResult {
  const check = canBuy(save, id);
  if (!check.ok) return check;
  save.cash -= priceOf(id);
  const item = shopItem(id);
  if (item.type === 'owned') save.owned[id as OwnedGearId] = true;
  else if (item.type === 'permanent') save.upgrades[id as UpgradeId] = true;
  else save.stash[id as RunItemId] += 1;
  return { ok: true };
}

/** Locked gear can't be equipped for the upcoming run (index = runsStarted). */
export function isLocked(save: SaveData, id: OwnedGearId): boolean {
  const lock = save.gearLocks[id];
  return lock !== undefined && lock >= save.runsStarted;
}

export function lockedGear(save: SaveData): OwnedGearId[] {
  return OWNED_GEAR.filter((g) => isLocked(save, g));
}

export function loadoutGear(l: Loadout): OwnedGearId[] {
  const out: OwnedGearId[] = [];
  if (l.weapon) out.push(l.weapon);
  if (l.armor) out.push(l.armor);
  if (l.gadget) out.push(l.gadget);
  return out;
}

export function validateLoadout(save: SaveData, l: Loadout): string[] {
  const errs: string[] = [];
  for (const g of loadoutGear(l)) {
    if (!save.owned[g]) errs.push(`${shopItem(g).name} is not owned`);
    else if (isLocked(save, g)) errs.push(`${shopItem(g).name} is locked this run`);
  }
  if (l.weapon && l.weapon !== 'revolver' && l.weapon !== 'smg') errs.push('Invalid weapon');
  if (l.runItems.length > tuning.shop.maxRunItems) errs.push(`At most ${tuning.shop.maxRunItems} run-only items`);
  const counts: Record<RunItemId, number> = { smoke: 0, medkit: 0 };
  for (const r of l.runItems) counts[r]++;
  for (const r of Object.keys(counts) as RunItemId[]) if (counts[r] > save.stash[r]) errs.push(`Not enough ${shopItem(r).name} in stash`);
  return errs;
}

/** Drop anything from a loadout that is no longer valid (locked, unowned, missing stock). */
export function sanitizeLoadout(save: SaveData, l: Loadout): Loadout {
  const out = emptyLoadout();
  if (l.weapon && save.owned[l.weapon] && !isLocked(save, l.weapon)) out.weapon = l.weapon;
  if (l.armor && save.owned[l.armor] && !isLocked(save, l.armor)) out.armor = l.armor;
  if (l.gadget && save.owned[l.gadget] && !isLocked(save, l.gadget)) out.gadget = l.gadget;
  const stock = { ...save.stash };
  for (const r of l.runItems) {
    if (out.runItems.length >= tuning.shop.maxRunItems) break;
    if (stock[r] > 0) {
      stock[r]--;
      out.runItems.push(r);
    }
  }
  return out;
}

/** Start a run: consume run-only items, advance the run counter, mark the run active. */
export function beginRun(save: SaveData, loadout: Loadout, seed: number): ActiveRun {
  const errs = validateLoadout(save, loadout);
  if (errs.length) throw new Error(`Invalid loadout: ${errs.join(', ')}`);
  for (const r of loadout.runItems) save.stash[r] -= 1;
  const run: ActiveRun = {
    runIndex: save.runsStarted,
    seed,
    loadout: { ...loadout, runItems: [...loadout.runItems] },
    areaIndex: 0,
    haleInvolved: false,
    cashEarned: 0,
  };
  save.runsStarted += 1;
  save.lastLoadout = { ...loadout, runItems: [...loadout.runItems] };
  save.activeRun = run;
  return run;
}

export interface RunEndResult {
  lockedNow: OwnedGearId[];
}

/**
 * Finish the active run. Extraction locks every piece of owned gear that was
 * carried for exactly the next run; a win locks nothing. Cash was already
 * banked as it was found, so nothing is taken away here.
 */
export function endRun(save: SaveData, record: RunRecord): RunEndResult {
  const run = save.activeRun;
  const lockedNow: OwnedGearId[] = [];
  if (run && record.outcome === 'extracted') {
    for (const g of loadoutGear(run.loadout)) {
      save.gearLocks[g] = run.runIndex + 1;
      lockedNow.push(g);
    }
  }
  // Drop expired locks so the save stays tidy.
  for (const g of OWNED_GEAR) {
    const lock = save.gearLocks[g];
    if (lock !== undefined && lock < save.runsStarted) delete save.gearLocks[g];
  }
  if (record.outcome === 'win') save.stats.wins++;
  else save.stats.extractions++;
  save.history = [...save.history, record].slice(-10);
  save.activeRun = null;
  return { lockedNow };
}

/** Bank cash found during a run immediately, so it survives anything. */
export function earnCash(save: SaveData, amount: number): void {
  save.cash += amount;
  if (save.activeRun) save.activeRun.cashEarned += amount;
}

export function spendCash(save: SaveData, amount: number): boolean {
  if (save.cash < amount) return false;
  save.cash -= amount;
  return true;
}

export function maxHealthFor(save: SaveData): number {
  return tuning.player.maxHealth + (save.upgrades.conditioning ? tuning.items.conditioningHealth : 0);
}

export function maxArmorFor(l: Loadout): number {
  return l.armor === 'plateCarrier' ? tuning.armor.plateCarrier : tuning.armor.vest;
}
