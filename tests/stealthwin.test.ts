import { describe, expect, it } from 'vitest';
import { runBot } from './bots/bots';

describe('stealth win', () => {
  it('Hale and his escorts can be taken down from behind without an alert', async () => {
    let wins = 0;
    const seeds = [11, 23, 37, 41, 53, 67];
    for (const seed of seeds) {
      let method = '';
      const r = await runBot('stealth', seed, 2, undefined, 60 * 180, { onlyHaleGroup: true, haleMethod: (m) => (method = m) });
      if (r.reachedExit && method === 'takedown' && r.peakSuspicion === 0) wins++;
    }
    // A crude bot should manage this on most seeds; a player with intel and smoke more so.
    expect(wins).toBeGreaterThanOrEqual(seeds.length / 2);
  }, 120000);
});

describe('replay', () => {
  it('the same seed and inputs replay identically', async () => {
    const a = await runBot('gunfu', 4242, 0, undefined, 60 * 40);
    const b = await runBot('gunfu', 4242, 0, undefined, 60 * 40);
    expect(b).toEqual(a);
  }, 60000);
});
