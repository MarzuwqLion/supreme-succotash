import { describe, expect, it } from 'vitest';
import { distXZ } from '../src/core/vec';
import { tuning } from '../src/data/tuning';
import { castAppears, findCellPath, generateArea, planRun } from '../src/sim/gen/generator';
import type { AreaType } from '../src/sim/gen/layout';
import { Nav } from '../src/sim/nav';

const TYPES: AreaType[] = ['porto', 'spaccanapoli', 'quartieri', 'castel'];
const SEEDS = Array.from({ length: 25 }, (_, i) => 1000 + i * 7919);

describe('seeded generation', () => {
  it('is deterministic: the same seed gives the same layout', () => {
    for (const type of TYPES) {
      const a = generateArea({ type, index: 0, seed: 42, luccaPresent: true, lucretiaPresent: true });
      const b = generateArea({ type, index: 0, seed: 42, luccaPresent: true, lucretiaPresent: true });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('different seeds give different layouts', () => {
    const a = generateArea({ type: 'quartieri', index: 0, seed: 1 });
    const b = generateArea({ type: 'quartieri', index: 0, seed: 2 });
    expect(JSON.stringify(a.cells)).not.toBe(JSON.stringify(b.cells));
  });

  for (const type of TYPES) {
    it(`${type}: 6x6 grid of 12 m blocks, entrance/exit >= 50 m apart with a path`, () => {
      for (const seed of SEEDS) {
        const l = generateArea({ type, index: type === 'castel' ? 2 : 0, seed });
        expect(l.cells.length).toBe(36);
        expect(l.blockSize).toBe(12);
        const goal = l.exit ?? (() => {
          const k = l.cells[l.keepCells[0]!]!;
          return { x: (k.i + 0.5) * 12, y: 0, z: (k.j + 0.5) * 12 };
        })();
        expect(distXZ(l.entrance, goal)).toBeGreaterThanOrEqual(tuning.gen.minEntranceExitDistance);
        const nav = new Nav(l);
        const path = findCellPath(l.cells, nav.cellOf(l.entrance), nav.cellOf(goal));
        expect(path, `${type} seed ${seed}`).not.toBe(null);
        // Every walkable cell is reachable (no orphan pockets).
        for (let ci = 0; ci < l.cells.length; ci++) {
          if (l.cells[ci]!.type !== 'building') expect(findCellPath(l.cells, nav.cellOf(l.entrance), ci)).not.toBe(null);
        }
        // Spawned things sit on walkable cells.
        for (const h of l.hostiles) expect(l.cells[nav.cellOf(h.pos)]!.type).not.toBe('building');
        for (const c of l.caches) expect(l.cells[nav.cellOf(c.pos)]!.type).not.toBe('building');
      }
    });
  }

  it('uses the doc piece types', () => {
    const seen = new Set<string>();
    for (const type of TYPES) for (const seed of SEEDS.slice(0, 5)) for (const c of generateArea({ type, index: 0, seed }).cells) seen.add(c.type);
    for (const t of ['street', 'alley', 'courtyard', 'piazza', 'building']) expect(seen.has(t)).toBe(true);
  });

  it('places 8-12 hostiles in Areas 1-2 and 12-15 in Area 3, plus 3-4 caches', () => {
    for (const seed of SEEDS) {
      for (const type of ['porto', 'spaccanapoli', 'quartieri'] as const) {
        const l = generateArea({ type, index: 0, seed });
        expect(l.hostiles.length).toBeGreaterThanOrEqual(8);
        expect(l.hostiles.length).toBeLessThanOrEqual(12);
        expect(l.caches.length).toBeGreaterThanOrEqual(3);
        expect(l.caches.length).toBeLessThanOrEqual(4);
        expect(l.intel).not.toBe(null);
      }
      const c = generateArea({ type: 'castel', index: 2, seed });
      expect(c.hostiles.length).toBeGreaterThanOrEqual(12);
      expect(c.hostiles.length).toBeLessThanOrEqual(15);
      expect(c.exit).toBe(null);
      expect(c.hostiles.filter((h) => h.kind === 'hale').length).toBe(1);
      expect(c.hostiles.filter((h) => h.kind === 'escort').length).toBe(2);
    }
  });

  it("Hale's grudge adds up to two extra escorts", () => {
    expect(generateArea({ type: 'castel', index: 2, seed: 5, extraEscorts: 1 }).hostiles.filter((h) => h.kind === 'escort').length).toBe(3);
    expect(generateArea({ type: 'castel', index: 2, seed: 5, extraEscorts: 9 }).hostiles.filter((h) => h.kind === 'escort').length).toBe(4);
  });

  it('hostile mix follows the area type', () => {
    const count = (type: AreaType, kind: string) =>
      SEEDS.reduce((n, seed) => n + generateArea({ type, index: 0, seed }).hostiles.filter((h) => h.kind === kind).length, 0);
    expect(count('porto', 'legionary')).toBeGreaterThan(count('porto', 'trooper') * 2);
    expect(count('quartieri', 'legionary')).toBeGreaterThan(count('quartieri', 'trooper') * 2);
    expect(count('castel', 'trooper')).toBeGreaterThan(count('castel', 'legionary') * 2);
  });

  it('cast spots appear only when requested', () => {
    const l = generateArea({ type: 'porto', index: 0, seed: 3, luccaPresent: true });
    expect(l.castSpots.lucca).not.toBe(null);
    expect(l.castSpots.lucretia).toBe(null);
  });

  it('run plan: Areas 1 and 2 are two different city areas, Area 3 is the Castel', () => {
    for (const seed of SEEDS) {
      const p = planRun(seed);
      expect(p.areaTypes[2]).toBe('castel');
      expect(p.areaTypes[0]).not.toBe(p.areaTypes[1]);
      expect(['porto', 'spaccanapoli', 'quartieri']).toContain(p.areaTypes[0]);
      expect(['porto', 'spaccanapoli', 'quartieri']).toContain(p.areaTypes[1]);
    }
  });

  it('Lucca and Lucretia are guaranteed by Area 2 if not seen in Area 1', () => {
    for (const seed of SEEDS) {
      for (const who of ['lucca', 'lucretia'] as const) {
        const a1 = castAppears(seed, who, 0, false);
        const a2 = castAppears(seed, who, 1, a1);
        expect(a1 || a2).toBe(true);
        expect(castAppears(seed, who, 2, true)).toBe(false);
      }
    }
  });
});
