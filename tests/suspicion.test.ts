import { describe, expect, it } from 'vitest';
import { SuspicionMeter } from '../src/sim/suspicion';

describe('suspicion', () => {
  it('starts at 0', () => {
    expect(new SuspicionMeter().value).toBe(0);
  });

  it('loud gunfire adds 20, at most once every 3 seconds', () => {
    const s = new SuspicionMeter();
    expect(s.loudGunfire(0).delta).toBe(20);
    expect(s.loudGunfire(1).delta).toBe(0);
    expect(s.loudGunfire(2.99).delta).toBe(0);
    expect(s.loudGunfire(3).delta).toBe(20);
    expect(s.value).toBe(40);
  });

  it('silenced shots add 10 only when seen', () => {
    const s = new SuspicionMeter();
    s.silencedShot(false);
    expect(s.value).toBe(0);
    s.silencedShot(true);
    expect(s.value).toBe(10);
  });

  it('melee strikes, Takedowns, and Executions add nothing', () => {
    const s = new SuspicionMeter();
    s.melee();
    expect(s.value).toBe(0);
  });

  it('a failed conversation adds 15', () => {
    const s = new SuspicionMeter();
    s.failedConversation();
    s.failedConversation();
    expect(s.value).toBe(30);
  });

  it('cover identity makes the first failed conversation in an area free', () => {
    const s = new SuspicionMeter(true);
    expect(s.failedConversation().delta).toBe(0);
    expect(s.failedConversation().delta).toBe(15);
    // A new area gets a new meter, so the free failure comes back.
    const next = new SuspicionMeter(true);
    expect(next.failedConversation().delta).toBe(0);
  });

  it('the signal jammer removes 25, once per area', () => {
    const s = new SuspicionMeter();
    s.loudGunfire(0);
    s.loudGunfire(10);
    expect(s.jammer()!.value).toBe(15);
    expect(s.jammer()).toBe(null);
    expect(s.jammerAvailable).toBe(false);
  });

  it('clamps to 0..100, flags the moment it reaches max, and tracks peak', () => {
    const s = new SuspicionMeter();
    let reached = 0;
    for (let t = 0; t < 30; t += 3) if (s.loudGunfire(t).reachedMax) reached++;
    expect(s.value).toBe(100);
    expect(s.atMax).toBe(true);
    expect(reached).toBe(1);
    s.jammer();
    expect(s.value).toBe(75);
    expect(s.peak).toBe(100);
    expect(new SuspicionMeter().jammer()!.value).toBe(0);
  });

  it('never falls on its own (no decay API) and resets with a new area', () => {
    const s = new SuspicionMeter();
    s.silencedShot(true);
    expect(s.value).toBe(10);
    expect(new SuspicionMeter().value).toBe(0);
  });
});
