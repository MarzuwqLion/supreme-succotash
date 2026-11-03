import { describe, expect, it } from 'vitest';
import { haleExtraEscorts, haleOnDefeat, haleOnEncounter, haleOnExtraction, npcStage, recordMeeting } from '../src/meta/memory';
import { defaultSave, loadSave, MemoryStorage, migrate, SAVE_KEY, SAVE_VERSION, SaveStore } from '../src/meta/save';

describe('saves', () => {
  it('starts from defaults with the doc starting trust', () => {
    const s = defaultSave();
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.cast.lucca.trust).toBe(30);
    expect(s.cast.lucretia.trust).toBe(-30);
    expect(s.hale.grudge).toBe(0);
  });

  it('round-trips through storage (survives a page reload)', () => {
    const storage = new MemoryStorage();
    const a = new SaveStore(storage);
    a.update((d) => {
      d.cash = 420;
      recordMeeting(d.cast.lucca, 'success', 45);
      recordMeeting(d.cast.lucretia, 'rebuff', -10);
      haleOnExtraction(d.hale);
    });
    const b = new SaveStore(storage); // a fresh page load
    expect(b.data.cash).toBe(420);
    expect(b.data.cast.lucca).toEqual({ trust: 45, meetings: 1, lastResult: 'success' });
    expect(b.data.cast.lucretia).toEqual({ trust: -10, meetings: 1, lastResult: 'rebuff' });
    expect(b.data.hale.grudge).toBe(1);
    expect(b.data.hale.pendingTaunt).toBe(true);
  });

  it('falls back to defaults on corrupt or missing data', () => {
    const storage = new MemoryStorage();
    expect(loadSave(storage)).toEqual(defaultSave());
    storage.setItem(SAVE_KEY, '{not json');
    expect(loadSave(storage)).toEqual(defaultSave());
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 999, cash: 5 }));
    expect(loadSave(storage).cash).toBe(0);
  });

  it('migrates an unversioned v0 save', () => {
    const out = migrate({ cash: 300, cast: { lucca: 55, lucretia: -10 }, hale: { grudge: 2, lastOutcome: 'agentExtracted' } });
    expect(out.version).toBe(SAVE_VERSION);
    expect(out.cash).toBe(300);
    expect(out.cast.lucca).toEqual({ trust: 55, meetings: 0, lastResult: 'none' });
    expect(out.hale.grudge).toBe(2);
    expect(out.hale.pendingTaunt).toBe(true);
    expect(out.owned.smg).toBe(false);
  });

  it('keeps unknown-but-typed fields out and fixes wrong types', () => {
    const out = migrate({ version: SAVE_VERSION, cash: '12', owned: { smg: 'yes', revolver: true } });
    expect(out.cash).toBe(0);
    expect(out.owned.smg).toBe(false);
    expect(out.owned.revolver).toBe(true);
  });

  it('meeting stages advance 1 -> 2 -> 3 and stay at 3', () => {
    const m = { trust: 0, meetings: 0, lastResult: 'none' as const };
    expect(npcStage(m)).toBe(1);
    expect(npcStage({ ...m, meetings: 1 })).toBe(2);
    expect(npcStage({ ...m, meetings: 2 })).toBe(3);
    expect(npcStage({ ...m, meetings: 9 })).toBe(3);
  });

  it("Hale's grudge adds an escort per extraction, caps at two, and clears when he's beaten", () => {
    const s = defaultSave();
    haleOnExtraction(s.hale);
    expect(haleExtraEscorts(s.hale)).toBe(1);
    expect(haleOnEncounter(s.hale)).toBe('grudge1');
    expect(haleExtraEscorts(s.hale)).toBe(1); // the grudge stays until he's beaten
    haleOnExtraction(s.hale);
    haleOnExtraction(s.hale);
    expect(haleExtraEscorts(s.hale)).toBe(2);
    expect(haleOnEncounter(s.hale)).toBe('grudge2');
    haleOnDefeat(s.hale);
    expect(haleExtraEscorts(s.hale)).toBe(0);
    expect(haleOnEncounter(s.hale)).toBe('rematch');
    expect(haleOnEncounter(defaultSave().hale)).toBe('firstEncounter');
  });

  it('a mid-run reload leaves an activeRun marker to resolve as an extraction', () => {
    const storage = new MemoryStorage();
    const a = new SaveStore(storage);
    a.update((d) => {
      d.activeRun = { runIndex: 0, seed: 1, loadout: { weapon: 'smg', armor: null, gadget: null, runItems: [] }, areaIndex: 1, haleInvolved: false, cashEarned: 50 };
    });
    expect(new SaveStore(storage).data.activeRun?.loadout.weapon).toBe('smg');
  });
});
