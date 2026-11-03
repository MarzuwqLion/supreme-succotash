import { describe, expect, it } from 'vitest';
import { tuning } from '../src/data/tuning';
import { applyReply, clampReplyDelta, createConversationState, resolveConversation, tierTrustDelta } from '../src/sim/conversation';

const reply = (tier: Parameters<typeof tierTrustDelta>[0], trustDelta?: number) => ({ id: tier, tier, trustDelta });

describe('trust', () => {
  it('generic hostiles start each conversation at 0 with doc targets', () => {
    expect(createConversationState('legionary').trust).toBe(0);
    expect(createConversationState('legionary').target).toBe(20);
    expect(createConversationState('trooper').target).toBe(40);
  });

  it('personality lines gain at most +15; intel +25', () => {
    expect(tierTrustDelta('best', 'legionary')).toBe(15);
    expect(tierTrustDelta('intel', 'trooper')).toBe(25);
    // An AI provider can't exceed the ceilings.
    expect(clampReplyDelta('best', 40, 'legionary')).toBe(15);
    expect(clampReplyDelta('good', 40, 'legionary')).toBe(15);
    expect(clampReplyDelta('intel', 90, 'legionary')).toBe(25);
  });

  it('trust stays within -100..100', () => {
    const st = createConversationState('lucca', 95);
    st.totalExchanges = 10;
    for (let i = 0; i < 5; i++) applyReply(st, reply('best'), 0);
    expect(st.trust).toBe(100);
  });

  it('bribes spend cash and need enough of it', () => {
    const st = createConversationState('legionary');
    const poor = applyReply(st, reply('bribe'), 10);
    expect(poor.ok).toBe(false);
    expect(st.exchange).toBe(0);
    const rich = applyReply(st, reply('bribe'), 1000);
    expect(rich.ok).toBe(true);
    expect(rich.cashSpent).toBe(tuning.trust.bribeCostLegionary);
    expect(st.trust).toBe(tuning.trust.bribeLegionary);
  });

  it('Lucca does not take bribes', () => {
    const st = createConversationState('lucca', 30);
    expect(applyReply(st, reply('bribe'), 1000).reason).toBe('bribe-not-allowed');
  });

  it("Lucretia's trust rises at most 20 per conversation, regardless of reply order", () => {
    const a = createConversationState('lucretia', -30);
    for (const t of ['best', 'best', 'bad'] as const) applyReply(a, reply(t), 0);
    const b = createConversationState('lucretia', -30);
    for (const t of ['bad', 'best', 'best'] as const) applyReply(b, reply(t), 0);
    expect(a.trust).toBe(-10);
    expect(b.trust).toBe(-10);
    const c = createConversationState('lucretia', -30);
    for (const t of ['best', 'best', 'best'] as const) applyReply(c, reply(t), 0);
    expect(c.trust).toBe(-10);
  });

  it('winning Lucretia over by charm takes three meetings', () => {
    let trust = tuning.trust.lucretiaStart;
    const outcomes: string[] = [];
    for (let m = 0; m < 3; m++) {
      const st = createConversationState('lucretia', trust);
      for (let i = 0; i < 3; i++) applyReply(st, reply('best'), 0);
      outcomes.push(resolveConversation(st));
      trust = st.trust;
    }
    expect(outcomes).toEqual(['rebuff', 'rebuff', 'success']);
    expect(trust).toBe(30);
  });

  it("a bribe buys Lucretia's help once even below the target", () => {
    const st = createConversationState('lucretia', -30);
    applyReply(st, reply('bribe'), 1000);
    applyReply(st, reply('neutral'), 0);
    applyReply(st, reply('neutral'), 0);
    expect(resolveConversation(st)).toBe('bribed');
    expect(st.cashSpent).toBe(tuning.trust.bribeCostLucretia);
  });

  it('meeting the target beats a bribe', () => {
    const st = createConversationState('lucretia', 20);
    applyReply(st, reply('bribe'), 1000);
    applyReply(st, reply('best'), 0);
    applyReply(st, reply('neutral'), 0);
    expect(resolveConversation(st)).toBe('success');
  });
});
