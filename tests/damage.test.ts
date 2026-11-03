import { describe, expect, it } from 'vitest';
import { tuning } from '../src/data/tuning';
import { applyAgentDamage, applyHostileDamage, contextActionFor, gunDamage, resolveMeleeDefense, type CombatTargetInfo } from '../src/sim/damage';

describe('damage', () => {
  it('armor absorbs gunfire before health', () => {
    const v = { health: 100, armor: 50 };
    applyAgentDamage(v, 30, 'gun');
    expect(v).toEqual({ health: 100, armor: 20 });
    applyAgentDamage(v, 30, 'gun');
    expect(v).toEqual({ health: 90, armor: 0 });
  });

  it('melee goes straight to health, even with armor', () => {
    const v = { health: 100, armor: 50 };
    applyAgentDamage(v, 10, 'melee');
    expect(v).toEqual({ health: 90, armor: 50 });
  });

  it('block cuts melee damage by 70%', () => {
    const v = { health: 100, armor: 0 };
    applyAgentDamage(v, 10, 'melee', true);
    expect(v.health).toBeCloseTo(97, 6);
  });

  it('reports death at zero health and never goes negative', () => {
    const v = { health: 5, armor: 0 };
    const r = applyAgentDamage(v, 50, 'gun');
    expect(r.dead).toBe(true);
    expect(v.health).toBe(0);
  });

  it('parry window is the first 8 frames after pressing block', () => {
    expect(resolveMeleeDefense({ parryFrame: 0, blocking: true, invulnerable: false })).toBe('parried');
    expect(resolveMeleeDefense({ parryFrame: tuning.melee.parryWindow - 1, blocking: true, invulnerable: false })).toBe('parried');
    expect(resolveMeleeDefense({ parryFrame: -1, blocking: true, invulnerable: false })).toBe('blocked');
    expect(resolveMeleeDefense({ parryFrame: -1, blocking: false, invulnerable: false })).toBe('hit');
    expect(resolveMeleeDefense({ parryFrame: 0, blocking: true, invulnerable: true })).toBe('invulnerable');
  });

  it('headshots double gun damage', () => {
    expect(gunDamage(18, false)).toBe(18);
    expect(gunDamage(18, true)).toBe(36);
  });

  it('hostile damage reduces health and reports kills', () => {
    const h = { health: 60 };
    expect(applyHostileDamage(h, 24).dead).toBe(false);
    expect(h.health).toBe(36);
    expect(applyHostileDamage(h, 99).dead).toBe(true);
    expect(h.health).toBe(0);
  });

  it('light string totals 30 and heavy is 24 (doc values)', () => {
    expect(tuning.melee.lightDamage).toEqual([8, 8, 14]);
    expect(tuning.melee.heavyDamage).toBe(24);
    expect(tuning.melee.heavyHitstun).toBe(24);
  });

  describe('B does one job at a time', () => {
    const base: CombatTargetInfo = { kind: 'legionary', health: 60, maxHealth: 60, unaware: false, staggered: false, knockedDown: false };
    it('Takedown on an unaware target within 2 m', () => {
      expect(contextActionFor({ ...base, unaware: true }, 1.9)).toBe('takedown');
      expect(contextActionFor({ ...base, unaware: true }, 2.1)).toBe(null);
    });
    it('Execution on a staggered or knocked-down target', () => {
      expect(contextActionFor({ ...base, staggered: true }, 1.5)).toBe('execution');
      expect(contextActionFor({ ...base, knockedDown: true }, 1.5)).toBe('execution');
    });
    it('Execution works at any health for regular hostiles', () => {
      expect(contextActionFor({ ...base, staggered: true, health: 60 }, 1)).toBe('execution');
    });
    it('otherwise Throw', () => {
      expect(contextActionFor(base, 1.5)).toBe('throw');
    });
    it('Hale cannot be thrown', () => {
      expect(contextActionFor({ ...base, kind: 'hale', health: 300, maxHealth: 300 }, 1.5)).toBe(null);
    });
    it('Hale can be executed only at 30% health or below', () => {
      const hale = { ...base, kind: 'hale' as const, maxHealth: 300, staggered: true };
      expect(contextActionFor({ ...hale, health: 91 }, 1.5)).toBe(null);
      expect(contextActionFor({ ...hale, health: 90 }, 1.5)).toBe('execution');
    });
    it('an unaware Hale can still be taken down', () => {
      expect(contextActionFor({ ...base, kind: 'hale', health: 300, maxHealth: 300, unaware: true }, 1.5)).toBe('takedown');
    });
  });
});
