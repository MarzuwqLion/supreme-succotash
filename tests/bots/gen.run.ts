import { it } from 'vitest';
import { generateArea } from '../../src/sim/gen/generator';
import type { AreaType } from '../../src/sim/gen/layout';
declare const process: { stdout: { write(s: string): void }; env: Record<string, string | undefined> };
it('gen report', () => {
  for (const type of ['porto', 'spaccanapoli', 'quartieri', 'castel'] as AreaType[]) {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const t0 = Date.now();
      const l = generateArea({ type, index: type === 'castel' ? 2 : 0, seed, luccaPresent: true, lucretiaPresent: true });
      const ms = Date.now() - t0;
      const elev = l.nav.nodes.filter((n) => n.y > 0.5).length;
      const links = l.nav.links.reduce((s, x) => s + x.length, 0) / 2;
      const types = l.cells.reduce((m, c) => ((m[c.type] = (m[c.type] ?? 0) + 1), m), {} as Record<string, number>);
      const sentries = l.hostiles.filter((h) => h.pos.y > 0.5).length;
      process.stdout.write(`${type} s${seed} ${ms}ms nodes ${l.nav.nodes.length} elev ${elev} links ${links} boxes ${l.boxes.length} decor ${l.decor.length} hostiles ${l.hostiles.length} (sentries ${sentries}) civ ${l.civilians.length} caches ${l.caches.length} intel ${!!l.intel} cast ${!!l.castSpots.lucca}/${!!l.castSpots.lucretia} exit ${!!l.exit} ${JSON.stringify(types)}\n`);
    }
  }
}, 120000);
