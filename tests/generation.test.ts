import { describe, expect, it } from 'vitest';
import { distXZ } from '../src/core/vec';
import { tuning } from '../src/data/tuning';
import { castAppears, generateArea, planRun } from '../src/sim/gen/generator';
import type { AreaType } from '../src/sim/gen/layout';
import { reachableNodes } from '../src/sim/gen/navbuild';
import { Nav } from '../src/sim/nav';
import { initPhysics } from '../src/sim/physics';
import { SimWorld } from '../src/sim/world';
import { carry } from './helpers';

const TYPES: AreaType[] = ['porto', 'spaccanapoli', 'quartieri', 'castel'];
const SEEDS = Array.from({ length: 20 }, (_, i) => 1000 + i * 7919);
const idxFor = (t: AreaType) => (t === 'castel' ? 2 : 0);

describe('seeded generation', () => {
  it('is deterministic: the same seed gives the same layout', () => {
    for (const type of TYPES) {
      const a = generateArea({ type, index: idxFor(type), seed: 42, luccaPresent: true, lucretiaPresent: true });
      const b = generateArea({ type, index: idxFor(type), seed: 42, luccaPresent: true, lucretiaPresent: true });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('different seeds give different layouts', () => {
    const a = generateArea({ type: 'quartieri', index: 0, seed: 1 });
    const b = generateArea({ type: 'quartieri', index: 0, seed: 2 });
    expect(JSON.stringify(a.cells)).not.toBe(JSON.stringify(b.cells));
  });

  for (const type of TYPES) {
    it(`${type}: 6x6 grid of blocks, entrance/exit >= 50 m apart, connected navigation`, () => {
      for (const seed of SEEDS) {
        const l = generateArea({ type, index: idxFor(type), seed });
        expect(l.cells.length).toBe(36);
        expect(l.gridSize).toBe(tuning.gen.gridSize);
        expect(l.blockSize).toBe(tuning.gen.blockSize);
        const nav = new Nav(l);
        const start = nav.nearest(l.entrance);
        // Every node is reachable from the entrance (the generator prunes the rest).
        expect(reachableNodes(l.nav, start).size, `${type} ${seed}`).toBe(l.nav.nodes.length);
        if (l.exit) {
          expect(distXZ(l.entrance, l.exit)).toBeGreaterThanOrEqual(tuning.gen.minEntranceExitDistance);
          expect(nav.path(start, nav.nearest(l.exit)), `${type} ${seed}`).not.toBe(null);
        } else {
          const hale = l.hostiles[l.haleIndex]!;
          expect(distXZ(l.entrance, hale.pos)).toBeGreaterThanOrEqual(tuning.gen.minEntranceExitDistance);
          expect(nav.path(start, nav.nearest(hale.pos))).not.toBe(null);
        }
        // Spawned things sit on reachable walkable ground.
        for (const h of l.hostiles) expect(nav.nearest(h.pos)).toBeGreaterThanOrEqual(0);
        for (const c of l.caches) expect(Math.min(...l.nav.nodes.map((n) => distXZ(n, c.pos)))).toBeLessThan(2.5);
      }
    });
  }

  it('uses the doc pieces plus riverwalk canals', () => {
    const seen = new Set<string>();
    for (const type of TYPES) for (const seed of SEEDS.slice(0, 8)) for (const c of generateArea({ type, index: idxFor(type), seed }).cells) seen.add(c.type);
    for (const t of ['street', 'alley', 'courtyard', 'piazza', 'building', 'canal']) expect(seen.has(t), t).toBe(true);
  });

  it('builds elevated walkways that are reachable on foot', () => {
    let elevated = 0;
    for (const type of ['porto', 'spaccanapoli', 'castel'] as const) {
      for (const seed of SEEDS.slice(0, 6)) {
        const l = generateArea({ type, index: idxFor(type), seed });
        elevated += l.nav.nodes.filter((n) => n.y > tuning.gen.deckHeight - 0.5).length;
      }
    }
    // Pruning keeps only nodes reachable from the entrance, so these all have a stair.
    expect(elevated).toBeGreaterThan(50);
  });

  it('places 8-12 hostiles in Areas 1-2 and 12-15 in Area 3, plus 3-4 caches and the crowds', () => {
    for (const seed of SEEDS) {
      for (const type of ['porto', 'spaccanapoli', 'quartieri'] as const) {
        const l = generateArea({ type, index: 0, seed });
        expect(l.hostiles.length).toBeGreaterThanOrEqual(8);
        expect(l.hostiles.length).toBeLessThanOrEqual(12);
        expect(l.caches.length).toBeGreaterThanOrEqual(3);
        expect(l.caches.length).toBeLessThanOrEqual(4);
        expect(l.intel).not.toBe(null);
        expect(l.civilians.length).toBe(tuning.civilians[type]);
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
    const count = (type: AreaType, kind: string) => SEEDS.reduce((n, seed) => n + generateArea({ type, index: idxFor(type), seed }).hostiles.filter((h) => h.kind === kind).length, 0);
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

  it('every navigation link is walkable in the real physics world', async () => {
    const R = await initPhysics();
    let checked = 0;
    for (const type of TYPES) {
      for (const seed of SEEDS.slice(0, 3)) {
        const layout = generateArea({ type, index: idxFor(type), seed });
        const w = new SimWorld(R, { layout, areaIndex: 0, runSeed: seed, carry: carry(), coverIdentity: false, areaIntel: null, haleTaunt: null });
        layout.nav.links.forEach((ls, i) => {
          for (const j of ls) {
            if (j < i) continue;
            const a = layout.nav.nodes[i]!;
            const b = layout.nav.nodes[j]!;
            if (Math.abs(a.y - b.y) > 0.3) continue; // stairs
            expect(w.walkClear(a, b), `${type} ${seed} ${JSON.stringify(a)} -> ${JSON.stringify(b)}`).toBe(true);
            checked++;
          }
        });
        w.dispose();
      }
    }
    expect(checked).toBeGreaterThan(2000);
  }, 60000);
});
