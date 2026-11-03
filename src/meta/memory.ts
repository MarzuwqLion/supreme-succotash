import type { HaleTaunts } from '../content/dialogue/types';
import { tuning } from '../data/tuning';
import type { Outcome } from '../sim/conversation';
import type { HaleMemory, NpcMemory } from './save';

/** What Lucca, Lucretia, and Hale remember between runs. */

/** Meeting stage 1-3 from how many times they've met the agent. */
export function npcStage(mem: NpcMemory): 1 | 2 | 3 {
  return Math.min(3, mem.meetings + 1) as 1 | 2 | 3;
}

export function recordMeeting(mem: NpcMemory, outcome: Outcome, finalTrust: number): void {
  mem.meetings += 1;
  mem.lastResult = outcome;
  mem.trust = Math.max(tuning.trust.min, Math.min(tuning.trust.max, finalTrust));
}

export function haleExtraEscorts(h: HaleMemory): number {
  return Math.max(0, Math.min(tuning.gen.maxGrudgeEscorts, h.grudge));
}

/** Hale was involved in an extraction: he holds a grudge and taunts next time. */
export function haleOnExtraction(h: HaleMemory): void {
  h.extractionsInvolved += 1;
  h.grudge = Math.min(tuning.gen.maxGrudgeEscorts, h.grudge + 1);
  h.pendingTaunt = true;
  h.lastOutcome = 'agentExtracted';
}

/** Beating Hale clears the grudge. */
export function haleOnDefeat(h: HaleMemory): void {
  h.defeats += 1;
  h.grudge = 0;
  h.pendingTaunt = false;
  h.lastOutcome = 'defeated';
}

/** Which taunt set to use when Hale first sees the agent this run. */
export function haleTauntKey(h: HaleMemory): keyof HaleTaunts {
  if (h.pendingTaunt && h.grudge >= 2) return 'grudge2';
  if (h.pendingTaunt && h.grudge >= 1) return 'grudge1';
  if (h.defeats > 0) return 'rematch';
  return 'firstEncounter';
}

export function haleOnEncounter(h: HaleMemory): keyof HaleTaunts {
  const key = haleTauntKey(h);
  h.encounters += 1;
  h.pendingTaunt = false;
  return key;
}
