import { tuning } from '../data/tuning';
import type { ConversationResult, ReplyTier, SpeakerKind } from '../content/dialogue/types';

/**
 * Pure conversation rules: trust math, caps, bribes, and the final result.
 * Content (what is said) comes from a DialogueProvider; this module only
 * decides what a reply is worth and whether the conversation succeeded.
 */

export type Outcome = Exclude<ConversationResult, 'none'>;

export interface ConversationState {
  speaker: SpeakerKind;
  startTrust: number;
  /** Effective trust (after Lucretia's per-conversation cap). */
  trust: number;
  /** Uncapped running total, so the cap applies to the total and not to reply order. */
  rawTrust: number;
  target: number;
  /** Lucretia: running trust may not exceed startTrust + this. */
  maxGain: number | null;
  /** Named cast persist trust and may end in a 'rebuff' instead of a failure. */
  named: boolean;
  exchange: number;
  totalExchanges: number;
  bribed: boolean;
  cashSpent: number;
  chosen: string[];
}

export interface ReplyEffectInput {
  id: string;
  tier: ReplyTier;
  /** Optional explicit delta (an AI provider may supply one). Clamped by tier rules. */
  trustDelta?: number;
}

export interface ReplyApplication {
  ok: boolean;
  reason?: 'finished' | 'cash' | 'bribe-not-allowed';
  trustBefore: number;
  trustAfter: number;
  cashSpent: number;
}

export function isNamed(speaker: SpeakerKind): boolean {
  return speaker === 'lucca' || speaker === 'lucretia';
}

export function targetFor(speaker: SpeakerKind): number {
  const t = tuning.trust;
  switch (speaker) {
    case 'legionary':
      return tuning.hostiles.legionary.talkTarget;
    case 'trooper':
      return tuning.hostiles.trooper.talkTarget;
    case 'lucca':
      return t.luccaTarget;
    case 'lucretia':
      return t.lucretiaTarget;
  }
}

export function bribeCost(speaker: SpeakerKind): number | null {
  const t = tuning.trust;
  switch (speaker) {
    case 'legionary':
      return t.bribeCostLegionary;
    case 'trooper':
      return t.bribeCostTrooper;
    case 'lucretia':
      return t.bribeCostLucretia;
    case 'lucca':
      return null;
  }
}

/** Trust value of a reply tier for a given speaker, from tuning. */
export function tierTrustDelta(tier: ReplyTier, speaker: SpeakerKind): number {
  const t = tuning.trust;
  switch (tier) {
    case 'best':
      return t.tierBest;
    case 'good':
      return t.tierGood;
    case 'neutral':
      return t.tierNeutral;
    case 'bad':
      return t.tierBad;
    case 'insult':
      return t.tierInsult;
    case 'intel':
      return t.intel;
    case 'bribe':
      if (speaker === 'legionary') return t.bribeLegionary;
      if (speaker === 'trooper') return t.bribeTrooper;
      return 0; // Lucretia's bribe buys help, not trust
  }
}

/**
 * Enforce the doc's ceilings regardless of where a delta came from:
 * charm lines gain at most +tierBest, intel at most +intel.
 */
export function clampReplyDelta(tier: ReplyTier, delta: number, speaker: SpeakerKind): number {
  const t = tuning.trust;
  if (tier === 'intel') return Math.min(delta, t.intel);
  if (tier === 'bribe') return Math.min(delta, tierTrustDelta('bribe', speaker));
  return Math.max(-100, Math.min(delta, t.tierBest));
}

export function createConversationState(speaker: SpeakerKind, startTrust = 0): ConversationState {
  const named = isNamed(speaker);
  return {
    speaker,
    startTrust,
    trust: startTrust,
    rawTrust: startTrust,
    target: targetFor(speaker),
    maxGain: speaker === 'lucretia' ? tuning.trust.lucretiaMaxGainPerConversation : null,
    named,
    exchange: 0,
    totalExchanges: tuning.trust.exchanges,
    bribed: false,
    cashSpent: 0,
    chosen: [],
  };
}

const clampRange = (v: number) => Math.max(tuning.trust.min, Math.min(tuning.trust.max, v));

/** Lucretia's cap limits how far the conversation's total can rise. */
function effectiveTrust(state: ConversationState): number {
  let v = clampRange(state.rawTrust);
  if (state.maxGain !== null) v = Math.min(v, state.startTrust + state.maxGain);
  return v;
}

export function isFinished(state: ConversationState): boolean {
  return state.exchange >= state.totalExchanges;
}

/**
 * Apply one chosen reply. Mutates `state`. Bribes need `cash` >= cost; the
 * caller deducts `cashSpent` from the wallet.
 */
export function applyReply(state: ConversationState, reply: ReplyEffectInput, cash: number): ReplyApplication {
  const before = state.trust;
  if (isFinished(state)) return { ok: false, reason: 'finished', trustBefore: before, trustAfter: before, cashSpent: 0 };
  let spent = 0;
  if (reply.tier === 'bribe') {
    const cost = bribeCost(state.speaker);
    if (cost === null) return { ok: false, reason: 'bribe-not-allowed', trustBefore: before, trustAfter: before, cashSpent: 0 };
    if (cash < cost) return { ok: false, reason: 'cash', trustBefore: before, trustAfter: before, cashSpent: 0 };
    spent = cost;
    state.cashSpent += cost;
    if (state.speaker === 'lucretia') state.bribed = true;
  }
  const raw = reply.trustDelta ?? tierTrustDelta(reply.tier, state.speaker);
  const delta = clampReplyDelta(reply.tier, raw, state.speaker);
  state.rawTrust = clampRange(state.rawTrust + delta);
  state.trust = effectiveTrust(state);
  state.exchange += 1;
  state.chosen.push(reply.id);
  return { ok: true, trustBefore: before, trustAfter: state.trust, cashSpent: spent };
}

/** Compare trust with the target once all exchanges are done. */
export function resolveConversation(state: ConversationState): Outcome {
  // Winning her over on merit beats paying for it.
  if (state.trust >= state.target) return 'success';
  if (state.bribed) return 'bribed';
  if (state.named && state.trust > state.startTrust) return 'rebuff';
  return 'failure';
}

/** Did this outcome count as winning the conversation (help given / stood down)? */
export function outcomeHelps(outcome: Outcome): boolean {
  return outcome === 'success' || outcome === 'bribed';
}
