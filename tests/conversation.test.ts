import { describe, expect, it } from 'vitest';
import { content } from '../src/content/dialogue';
import { ScriptedDialogueProvider, matchesOpening, type ConversationContext } from '../src/content/dialogue/provider';
import type { ConversationScript, SpeakerKind } from '../src/content/dialogue/types';
import { charmOnlyPick } from '../src/content/dialogue/validate';
import { tuning } from '../src/data/tuning';
import { ConversationController } from '../src/game/conversationController';
import type { NpcMemory } from '../src/meta/save';

function ctx(speaker: SpeakerKind, over: Partial<ConversationContext> = {}): ConversationContext {
  return { speaker, speakerKey: 'k', memory: null, intel: [], suspicion: 0, cash: 0, areaName: 'Porto', runSeed: 1, ...over };
}

/** Find a speakerKey that makes the scripted provider pick `script`. */
function keyFor(provider: ScriptedDialogueProvider, script: ConversationScript): string {
  for (let i = 0; i < 500; i++) if (provider.scriptFor(ctx(script.speaker, { speakerKey: `k${i}` })).id === script.id) return `k${i}`;
  throw new Error('no key');
}

async function play(c: ConversationController, pick: (replies: ReturnType<ConversationController['visibleReplies']>) => string, cash = 0) {
  await c.begin();
  while (!c.done) await c.choose(pick(c.visibleReplies(cash)), cash);
  return c.outcome;
}

const best = (rs: ReturnType<ConversationController['visibleReplies']>) => {
  const rank = { best: 5, good: 4, neutral: 3, bad: 2, insult: 1, intel: 0, bribe: 0 } as const;
  return [...rs].filter((r) => r.reply.tier !== 'intel' && r.reply.tier !== 'bribe').sort((a, b) => rank[b.reply.tier] - rank[a.reply.tier])[0]!.reply.id;
};
const worst = (rs: ReturnType<ConversationController['visibleReplies']>) => {
  const rank = { best: 5, good: 4, neutral: 3, bad: 2, insult: 1, intel: 9, bribe: 9 } as const;
  return [...rs].sort((a, b) => rank[a.reply.tier] - rank[b.reply.tier])[0]!.reply.id;
};

describe('conversation results', () => {
  const provider = new ScriptedDialogueProvider(content);

  for (const script of [...content.legionary, ...content.trooper]) {
    it(`${script.id}: charm alone succeeds, rudeness fails`, async () => {
      const key = keyFor(provider, script);
      const good = new ConversationController(provider, ctx(script.speaker, { speakerKey: key }), 0);
      expect(await play(good, best)).toBe('success');
      expect(good.log.length).toBeGreaterThan(6);
      const bad = new ConversationController(provider, ctx(script.speaker, { speakerKey: key }), 0);
      expect(await play(bad, worst)).toBe('failure');
    });
  }

  it('intel lines only appear with the matching intel, and are strong', async () => {
    const script = content.trooper[0]!;
    const key = keyFor(provider, script);
    const without = new ConversationController(provider, ctx('trooper', { speakerKey: key }), 0);
    await without.begin();
    const all = script.exchanges.flatMap((e) => e.replies);
    const intelReply = all.find((r) => r.tier === 'intel')!;
    // Walk to the exchange holding the intel line and check visibility.
    const exIndex = script.exchanges.findIndex((e) => e.replies.includes(intelReply));
    for (let i = 0; i < exIndex; i++) await without.choose(best(without.visibleReplies(0)), 0);
    expect(without.visibleReplies(0).some((r) => r.reply.id === intelReply.id)).toBe(false);

    const withIntel = new ConversationController(provider, ctx('trooper', { speakerKey: key, intel: ['patrolCodes'] }), 0);
    await withIntel.begin();
    for (let i = 0; i < exIndex; i++) await withIntel.choose(best(withIntel.visibleReplies(0)), 0);
    expect(withIntel.visibleReplies(0).some((r) => r.reply.id === intelReply.id)).toBe(true);
    const before = withIntel.state.trust;
    await withIntel.choose(intelReply.id, 0);
    expect(withIntel.state.trust - before).toBe(tuning.trust.intel);
  });

  it('bribe lines are disabled without enough cash and spend it when chosen', async () => {
    const script = content.legionary.find((s) => s.exchanges.some((e) => e.replies.some((r) => r.tier === 'bribe')))!;
    const key = keyFor(provider, script);
    const exIndex = script.exchanges.findIndex((e) => e.replies.some((r) => r.tier === 'bribe'));
    const c = new ConversationController(provider, ctx('legionary', { speakerKey: key }), 0);
    await c.begin();
    for (let i = 0; i < exIndex; i++) await c.choose(best(c.visibleReplies(0)), 0);
    const bribe = c.visibleReplies(0).find((r) => r.reply.tier === 'bribe')!;
    expect(bribe.avail.enabled).toBe(false);
    expect(c.visibleReplies(10000).find((r) => r.reply.tier === 'bribe')!.avail.enabled).toBe(true);
    expect(bribe.reply.text).not.toContain('{cost}');
    const spent = await c.choose(bribe.reply.id, 10000);
    expect(spent).toBe(tuning.trust.bribeCostLegionary);
  });

  it('Lucca and Lucretia open differently depending on memory', async () => {
    const fresh: NpcMemory = { trust: 30, meetings: 0, lastResult: 'none' };
    const after: NpcMemory = { trust: 70, meetings: 3, lastResult: 'success' };
    const a = await provider.begin(ctx('lucca', { memory: fresh, speakerKey: 'lucca' }));
    const b = await provider.begin(ctx('lucca', { memory: after, speakerKey: 'lucca' }));
    expect(a.opening).not.toBe(b.opening);
    const s1 = provider.scriptFor(ctx('lucretia', { memory: { trust: -30, meetings: 0, lastResult: 'none' } }));
    const s3 = provider.scriptFor(ctx('lucretia', { memory: { trust: 10, meetings: 5, lastResult: 'rebuff' } }));
    expect(s1.stage).toBe(1);
    expect(s3.stage).toBe(3);
  });

  it('opening conditions match memory and suspicion', () => {
    const c = ctx('lucca', { memory: { trust: 60, meetings: 2, lastResult: 'failure' }, suspicion: 55 });
    expect(matchesOpening({ lastResult: 'failure' }, c)).toBe(true);
    expect(matchesOpening({ lastResult: 'success' }, c)).toBe(false);
    expect(matchesOpening({ minTrust: 60 }, c)).toBe(true);
    expect(matchesOpening({ maxTrust: 59 }, c)).toBe(false);
    expect(matchesOpening({ minSuspicion: 50 }, c)).toBe(true);
    expect(matchesOpening({ minMeetings: 3 }, c)).toBe(false);
  });

  it('the scripted provider is swappable: game logic only sees the interface', async () => {
    // A stand-in "AI" provider that always offers the same three lines.
    const fake = {
      name: 'fake',
      begin: async () => ({ sessionId: 'x', speakerName: 'Test', opening: 'Hello.', exchange: { index: 0, prompt: 'Well?', replies: [{ id: 'a', text: 'Charm', tier: 'best' as const }, { id: 'b', text: 'Rude', tier: 'insult' as const }, { id: 'c', text: 'Meh', tier: 'neutral' as const }] } }),
      respond: async (_s: string, id: string) => ({ reaction: 'ok', tier: id === 'a' ? ('best' as const) : ('insult' as const), trustDelta: id === 'a' ? 99 : -5, next: null }),
      close: async () => 'Bye.',
    };
    const c = new ConversationController(fake, ctx('legionary'), 0);
    c.state.totalExchanges = 1;
    await c.begin();
    await c.choose('a', 0);
    // The +99 claimed by the provider is clamped to the +15 ceiling.
    expect(c.state.trust).toBe(15);
    expect(c.outcome).toBe('failure');
  });

  it('every charm-only pick exists for every exchange', () => {
    for (const s of [...content.legionary, ...content.trooper, ...content.lucca, ...content.lucretia]) {
      for (const ex of s.exchanges) expect(charmOnlyPick(ex, s.speaker)).not.toBe(null);
    }
  });
});
