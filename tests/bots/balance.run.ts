import { runBot, summarize, type Style } from './bots';
import type { PlayerCarry } from '../../src/sim/world';

/** What a player plausibly carries into the Castel after a few runs of shopping. */
function lateCarry(style: Style): PlayerCarry {
  const gunfu = style === 'gunfu';
  return {
    health: 100,
    maxHealth: 100,
    armor: gunfu ? 100 : 50,
    maxArmor: gunfu ? 100 : 50,
    weapons: gunfu ? [{ id: 'pistol', mag: 12, reserve: 48 }, { id: 'smg', mag: 30, reserve: 120 }] : [{ id: 'pistol', mag: 12, reserve: 48 }],
    items: { medkit: gunfu ? 2 : 0, smoke: gunfu ? 0 : 2 },
    hasJammer: false,
    intel: ['halesSchedule'],
  };
}

/** Manual tuning harness: `npx vitest run --config tests/bots/vitest.config.ts` */
import { it } from 'vitest';

declare const process: { env: Record<string, string | undefined>; stdout: { write(s: string): void } };

it('balance report', async () => {
  const seeds = Array.from({ length: Number(process.env.SEEDS ?? 12) }, (_, i) => 101 + i * 31);
  for (const style of (process.env.STYLES ?? 'talk,gunfu,stealth').split(',') as Style[]) {
    for (const area of (process.env.AREAS ?? '0,1').split(',').map(Number)) {
      const results = [];
      for (const s of seeds) results.push(await runBot(style, s, area, area === 2 ? lateCarry(style) : undefined));
      process.stdout.write(`${style} area ${area + 1} ${JSON.stringify(summarize(results))}\n`);
    }
  }
}, 600000);
