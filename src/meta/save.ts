import type { ConversationResult } from '../content/dialogue/types';
import { tuning } from '../data/tuning';

/**
 * The one versioned save module. Everything that persists between runs or
 * page reloads goes through here: wallet, owned gear, locks, upgrades, cast
 * memory, Hale's grudge, and an in-progress run marker.
 */

export const SAVE_VERSION = 3;
export const SAVE_KEY = 'infinity-mansion-napoli/save';

export type OwnedGearId = 'revolver' | 'smg' | 'plateCarrier' | 'jammer';
export type RunItemId = 'smoke' | 'medkit';
export type UpgradeId = 'conditioning' | 'coverIdentity';
export const OWNED_GEAR: readonly OwnedGearId[] = ['revolver', 'smg', 'plateCarrier', 'jammer'];
export const RUN_ITEMS: readonly RunItemId[] = ['smoke', 'medkit'];
export const UPGRADES: readonly UpgradeId[] = ['conditioning', 'coverIdentity'];

export interface NpcMemory {
  trust: number;
  meetings: number;
  lastResult: ConversationResult;
}

export interface HaleMemory {
  /** Extra escorts he brings (0..maxGrudgeEscorts); clears when beaten. */
  grudge: number;
  encounters: number;
  defeats: number;
  extractionsInvolved: number;
  /** Set when the agent is extracted in his garrison; cleared after he taunts. */
  pendingTaunt: boolean;
  lastOutcome: 'none' | 'agentExtracted' | 'defeated';
}

export interface Loadout {
  weapon: 'revolver' | 'smg' | null;
  armor: 'plateCarrier' | null;
  gadget: 'jammer' | null;
  runItems: RunItemId[];
}

export interface ActiveRun {
  runIndex: number;
  seed: number;
  loadout: Loadout;
  areaIndex: number;
  haleInvolved: boolean;
  cashEarned: number;
}

export interface RunRecord {
  runIndex: number;
  seed: number;
  outcome: 'win' | 'extracted';
  timeSec: number;
  kills: number;
  takedowns: number;
  conversationsWon: number;
  conversationsLost: number;
  peakSuspicion: number;
  cashEarned: number;
  areaReached: number;
  interrupted?: boolean;
}

export interface Settings {
  /** Third-person style: 'classic' or the over-the-shoulder shooter camera. */
  cameraStyle: 'classic' | 'shoulder';
}

export interface SaveData {
  version: number;
  settings: Settings;
  cash: number;
  owned: Record<OwnedGearId, boolean>;
  stash: Record<RunItemId, number>;
  upgrades: Record<UpgradeId, boolean>;
  /** Gear id -> run index during which it is locked. */
  gearLocks: Partial<Record<OwnedGearId, number>>;
  runsStarted: number;
  lastLoadout: Loadout;
  cast: { lucca: NpcMemory; lucretia: NpcMemory };
  hale: HaleMemory;
  activeRun: ActiveRun | null;
  history: RunRecord[];
  stats: { wins: number; extractions: number };
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements KeyValueStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

export const emptyLoadout = (): Loadout => ({ weapon: null, armor: null, gadget: null, runItems: [] });

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    settings: { cameraStyle: 'classic' },
    cash: 0,
    owned: { revolver: false, smg: false, plateCarrier: false, jammer: false },
    stash: { smoke: 0, medkit: 0 },
    upgrades: { conditioning: false, coverIdentity: false },
    gearLocks: {},
    runsStarted: 0,
    lastLoadout: emptyLoadout(),
    cast: {
      lucca: { trust: tuning.trust.luccaStart, meetings: 0, lastResult: 'none' },
      lucretia: { trust: tuning.trust.lucretiaStart, meetings: 0, lastResult: 'none' },
    },
    hale: { grudge: 0, encounters: 0, defeats: 0, extractionsInvolved: 0, pendingTaunt: false, lastOutcome: 'none' },
    activeRun: null,
    history: [],
    stats: { wins: 0, extractions: 0 },
  };
}

type AnyRecord = Record<string, unknown>;
const isObj = (v: unknown): v is AnyRecord => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Step-wise migrations. Each entry upgrades a save from version N to N+1.
 * v0: pre-release saves had no version field and stored cast trust as plain numbers.
 * v1 -> v2: Hale memory gained `pendingTaunt`.
 * v2 -> v3: player settings (camera style).
 */
const MIGRATIONS: Record<number, (d: AnyRecord) => AnyRecord> = {
  0: (d) => {
    const cast = isObj(d.cast) ? d.cast : {};
    const asMem = (v: unknown, start: number) =>
      typeof v === 'number' ? { trust: v, meetings: 0, lastResult: 'none' } : isObj(v) ? v : { trust: start, meetings: 0, lastResult: 'none' };
    return {
      ...d,
      version: 1,
      cast: { lucca: asMem(cast.lucca, tuning.trust.luccaStart), lucretia: asMem(cast.lucretia, tuning.trust.lucretiaStart) },
    };
  },
  1: (d) => {
    const hale = isObj(d.hale) ? d.hale : {};
    return { ...d, version: 2, hale: { ...hale, pendingTaunt: hale.lastOutcome === 'agentExtracted' } };
  },
  2: (d) => ({ ...d, version: 3, settings: { cameraStyle: 'classic' } }),
};

/** Deep-merge `raw` onto `defaults`, keeping only keys and types the defaults know. */
function sanitize<T>(defaults: T, raw: unknown): T {
  if (Array.isArray(defaults)) return (Array.isArray(raw) ? raw : defaults) as T;
  if (isObj(defaults)) {
    if (!isObj(raw)) return defaults;
    const out: AnyRecord = { ...(defaults as AnyRecord) };
    for (const k of Object.keys(raw)) {
      const dv = (defaults as AnyRecord)[k];
      const rv = raw[k];
      if (dv === undefined) {
        // Open maps (gearLocks) and nullable records (activeRun) keep raw values.
        out[k] = rv;
      } else if (dv === null) {
        out[k] = rv;
      } else {
        out[k] = sanitize(dv, rv);
      }
    }
    return out as T;
  }
  if (typeof defaults === typeof raw) return raw as T;
  return defaults;
}

export function migrate(raw: unknown): SaveData {
  if (!isObj(raw)) return defaultSave();
  let d: AnyRecord = { ...raw };
  let v = typeof d.version === 'number' ? d.version : 0;
  if (v > SAVE_VERSION) return defaultSave(); // from a newer build; don't guess
  while (v < SAVE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) return defaultSave();
    d = step(d);
    v = typeof d.version === 'number' ? d.version : v + 1;
  }
  const out = sanitize(defaultSave(), d);
  out.version = SAVE_VERSION;
  out.cash = Math.max(0, Math.floor(out.cash));
  return out;
}

export function loadSave(storage: KeyValueStorage): SaveData {
  try {
    const text = storage.getItem(SAVE_KEY);
    if (!text) return defaultSave();
    return migrate(JSON.parse(text));
  } catch {
    return defaultSave();
  }
}

export function writeSave(data: SaveData, storage: KeyValueStorage): void {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify({ ...data, version: SAVE_VERSION }));
  } catch {
    // Storage full or blocked: the game keeps running with in-memory state.
  }
}

/** Owns the live save and writes it through on every change. */
export class SaveStore {
  data: SaveData;

  constructor(private readonly storage: KeyValueStorage) {
    this.data = loadSave(storage);
  }

  update(fn: (d: SaveData) => void): void {
    fn(this.data);
    writeSave(this.data, this.storage);
  }

  reset(): void {
    this.data = defaultSave();
    this.storage.removeItem(SAVE_KEY);
    writeSave(this.data, this.storage);
  }

  reload(): void {
    this.data = loadSave(this.storage);
  }
}

export function browserStorage(): KeyValueStorage {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Access denied (privacy mode); fall through.
  }
  return new MemoryStorage();
}
