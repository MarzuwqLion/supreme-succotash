import { describe, expect, it } from 'vitest';
import civilians from '../src/content/dialogue/civilians.json';
import type { CivilianContent } from '../src/content/dialogue/types';

const c = civilians as CivilianContent;

describe('civilian content', () => {
  for (const area of ['porto', 'spaccanapoli', 'quartieri', 'castel'] as const) {
    it(`${area} has enough lines`, () => {
      const a = c.areas[area];
      expect(a.idle.length).toBeGreaterThanOrEqual(8);
      expect(a.nervous.length).toBeGreaterThanOrEqual(5);
      expect(a.rumors.length).toBeGreaterThanOrEqual(4);
    });
  }
  it('has flee and cowering lines', () => {
    expect(c.flee.length).toBeGreaterThanOrEqual(6);
    expect(c.cowering.length).toBeGreaterThanOrEqual(4);
  });
  it('keeps every line short enough for a subtitle', () => {
    const all = [...Object.values(c.areas).flatMap((a) => [...a.idle, ...a.nervous, ...a.rumors]), ...c.flee, ...c.cowering];
    for (const line of all) {
      expect(line.length, line).toBeLessThanOrEqual(150);
      expect(line.trim()).toBe(line);
    }
    expect(new Set(all).size).toBe(all.length);
  });
});
