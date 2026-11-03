import { describe, expect, it } from 'vitest';
import { beginRun, buy, canBuy, earnCash, endRun, isLocked, lockedGear, sanitizeLoadout, validateLoadout } from '../src/meta/economy';
import { defaultSave, emptyLoadout, type Loadout, type RunRecord, type SaveData } from '../src/meta/save';

function rich(): SaveData {
  const s = defaultSave();
  s.cash = 10000;
  for (const id of ['revolver', 'smg', 'plateCarrier', 'jammer'] as const) buy(s, id);
  return s;
}

const record = (s: SaveData, outcome: 'win' | 'extracted'): RunRecord => ({
  runIndex: s.activeRun!.runIndex,
  seed: 1,
  outcome,
  timeSec: 1,
  kills: 0,
  takedowns: 0,
  conversationsWon: 0,
  conversationsLost: 0,
  peakSuspicion: 0,
  cashEarned: 0,
  areaReached: 0,
});

const full: Loadout = { weapon: 'smg', armor: 'plateCarrier', gadget: 'jammer', runItems: [] };

describe('gear lock and economy', () => {
  it('buys gear once and spends cash', () => {
    const s = defaultSave();
    s.cash = 700;
    expect(canBuy(s, 'smg').ok).toBe(false);
    expect(buy(s, 'revolver').ok).toBe(true);
    expect(s.cash).toBe(100);
    s.cash = 1000;
    expect(buy(s, 'revolver').reason).toBe('Already owned');
  });

  it('run-only items stack in the stash; permanent upgrades are one-time', () => {
    const s = defaultSave();
    s.cash = 5000;
    buy(s, 'medkit');
    buy(s, 'medkit');
    buy(s, 'conditioning');
    expect(s.stash.medkit).toBe(2);
    expect(buy(s, 'conditioning').ok).toBe(false);
  });

  it('extraction locks carried owned gear for exactly one run, then it comes back', () => {
    const s = rich();
    beginRun(s, full, 1);
    endRun(s, record(s, 'extracted'));
    expect(lockedGear(s).sort()).toEqual(['jammer', 'plateCarrier', 'smg']);
    expect(validateLoadout(s, full).length).toBeGreaterThan(0);
    // The next run must go without them.
    beginRun(s, { ...emptyLoadout(), weapon: 'revolver' }, 2);
    expect(isLocked(s, 'smg')).toBe(false); // the locked run is now under way
    endRun(s, record(s, 'win'));
    expect(lockedGear(s)).toEqual([]);
    expect(validateLoadout(s, full)).toEqual([]);
  });

  it('gear that was not carried is never locked', () => {
    const s = rich();
    beginRun(s, { ...emptyLoadout(), weapon: 'revolver' }, 1);
    endRun(s, record(s, 'extracted'));
    expect(lockedGear(s)).toEqual(['revolver']);
    expect(isLocked(s, 'smg')).toBe(false);
  });

  it('a win locks nothing', () => {
    const s = rich();
    beginRun(s, full, 1);
    endRun(s, record(s, 'win'));
    expect(lockedGear(s)).toEqual([]);
  });

  it('the starter kit never locks (a starter-only extraction locks nothing)', () => {
    const s = defaultSave();
    beginRun(s, emptyLoadout(), 1);
    const res = endRun(s, record(s, 'extracted'));
    expect(res.lockedNow).toEqual([]);
  });

  it('two extractions in a row: each lock lasts one run from when it was set', () => {
    const s = rich();
    beginRun(s, { ...emptyLoadout(), weapon: 'smg' }, 1);
    endRun(s, record(s, 'extracted'));
    beginRun(s, { ...emptyLoadout(), weapon: 'revolver' }, 2);
    endRun(s, record(s, 'extracted'));
    expect(lockedGear(s)).toEqual(['revolver']);
  });

  it('cash is kept after extraction', () => {
    const s = defaultSave();
    beginRun(s, emptyLoadout(), 1);
    earnCash(s, 250);
    endRun(s, record(s, 'extracted'));
    expect(s.cash).toBe(250);
  });

  it('run-only items are used up; at most two per loadout', () => {
    const s = defaultSave();
    s.cash = 1000;
    buy(s, 'medkit');
    buy(s, 'smoke');
    buy(s, 'smoke');
    expect(validateLoadout(s, { ...emptyLoadout(), runItems: ['medkit', 'smoke', 'smoke'] })[0]).toMatch(/At most 2/);
    beginRun(s, { ...emptyLoadout(), runItems: ['medkit', 'smoke'] }, 1);
    expect(s.stash).toEqual({ medkit: 0, smoke: 1 });
  });

  it('sanitizeLoadout drops locked and unowned gear', () => {
    const s = rich();
    beginRun(s, full, 1);
    endRun(s, record(s, 'extracted'));
    expect(sanitizeLoadout(s, full)).toEqual(emptyLoadout());
  });
});
