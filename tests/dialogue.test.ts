import { describe, expect, it } from 'vitest';
import { content } from '../src/content/dialogue';
import { charmOnlyRun, validateCastProgression, validateHale, validateIntel, validateScript } from '../src/content/dialogue/validate';
import { tuning } from '../src/data/tuning';

describe('dialogue content', () => {
  it('has the required amount of content', () => {
    expect(content.legionary.length).toBeGreaterThanOrEqual(3);
    expect(content.trooper.length).toBeGreaterThanOrEqual(3);
    expect(content.lucca.filter((s) => s.stage).length).toBeGreaterThanOrEqual(3);
    expect(content.lucretia.filter((s) => s.stage).length).toBeGreaterThanOrEqual(3);
  });

  const all = [...content.legionary, ...content.trooper, ...content.lucca, ...content.lucretia];
  for (const script of all) {
    it(`script ${script.id} is valid`, () => {
      expect(validateScript(script)).toEqual([]);
    });
  }

  it('every generic hostile has a charm-only path to success', () => {
    for (const s of [...content.legionary, ...content.trooper]) {
      expect(charmOnlyRun(s, 0).outcome, s.id).toBe('success');
    }
  });

  it('Lucca is winnable by charm alone on the first meeting', () => {
    expect(validateCastProgression(content.lucca, 'lucca')).toEqual([]);
  });

  it('Lucretia is winnable by charm alone within three meetings, not on the first', () => {
    expect(validateCastProgression(content.lucretia, 'lucretia')).toEqual([]);
    const first = content.lucretia.find((s) => s.stage === 1)!;
    expect(charmOnlyRun(first, tuning.trust.lucretiaStart).outcome).not.toBe('success');
  });

  it('Lucretia offers a transport manifest line and a bribe', () => {
    const replies = content.lucretia.flatMap((s) => s.exchanges.flatMap((e) => e.replies));
    expect(replies.some((r) => r.tier === 'intel' && r.requiresIntel === 'transportManifest')).toBe(true);
    expect(replies.some((r) => r.tier === 'bribe')).toBe(true);
  });

  it('Legionaries and Troopers offer a patrol-codes bluff', () => {
    for (const s of [...content.legionary, ...content.trooper]) {
      const replies = s.exchanges.flatMap((e) => e.replies);
      expect(replies.some((r) => r.tier === 'intel' && r.requiresIntel === 'patrolCodes'), s.id).toBe(true);
    }
  });

  it('Hale taunts and intel docs are complete', () => {
    expect(validateHale(content.hale)).toEqual([]);
    expect(validateIntel(content.intel)).toEqual([]);
  });
});
