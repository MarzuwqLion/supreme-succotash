/**
 * Content schema for scripted conversations. Pure data: no game logic here.
 * The scripted DialogueProvider reads these; an AI provider can produce the
 * same shapes at runtime.
 */

export type IntelId = 'patrolCodes' | 'halesSchedule' | 'transportManifest';
export const INTEL_IDS: readonly IntelId[] = ['patrolCodes', 'halesSchedule', 'transportManifest'];

export type SpeakerKind = 'legionary' | 'trooper' | 'lucca' | 'lucretia';

/**
 * How well a reply lands. The numeric trust change for each tier lives in
 * tuning.ts (trust.tier*), so content never hard-codes numbers.
 *  best    - suits the character's personality (+15 at doc values)
 *  good    - reasonable, mildly persuasive
 *  neutral - no effect
 *  bad     - clashes with who they are
 *  insult  - actively offends
 *  intel   - only shown when the player holds `requiresIntel`
 *  bribe   - spends cash; text may include {cost}
 */
export type ReplyTier = 'best' | 'good' | 'neutral' | 'bad' | 'insult' | 'intel' | 'bribe';

export type ConversationResult = 'success' | 'failure' | 'rebuff' | 'bribed' | 'none';

export interface ScriptReply {
  id: string;
  /** What the agent says. */
  text: string;
  tier: ReplyTier;
  /** What the character says back right after this reply. */
  reaction: string;
  /** Required for tier 'intel'. */
  requiresIntel?: IntelId;
}

export interface ScriptExchange {
  /** Character line that sets up this exchange. */
  prompt: string;
  /** Three or four replies. */
  replies: ScriptReply[];
}

export interface OpeningCondition {
  lastResult?: ConversationResult;
  minTrust?: number;
  maxTrust?: number;
  minSuspicion?: number;
  /** Number of earlier meetings (not counting the current one). */
  minMeetings?: number;
}

export interface ScriptOpening {
  when?: OpeningCondition;
  text: string;
}

export interface ConversationScript {
  id: string;
  speaker: SpeakerKind;
  /** Meeting stage for named cast (1-3). Generic hostiles omit it. */
  stage?: number;
  /** One-line personality note; also what "best" replies play to. */
  personality: string;
  /** First matching opening wins. The last entry should have no `when`. */
  openings: ScriptOpening[];
  exchanges: ScriptExchange[];
  closings: {
    success: string;
    failure: string;
    /** Named cast only: trust rose but is still under the target. */
    rebuff?: string;
    /** Lucretia only: help bought with a bribe. */
    bribed?: string;
  };
}

export interface HaleTaunts {
  /** First time Hale ever sees the agent. */
  firstEncounter: string[];
  /** Next encounter after one extraction he was involved in. */
  grudge1: string[];
  /** Next encounter after two or more. */
  grudge2: string[];
  /** Encounters after he has been beaten before (grudge cleared). */
  rematch: string[];
  /** Combat barks while Alert. */
  combat: string[];
  /** At or below 30% health. */
  lowHealth: string[];
  /** When the agent is extracted in his garrison. */
  agentExtracted: string[];
  /** His last words. */
  defeated: string[];
}

export interface IntelDoc {
  id: IntelId;
  title: string;
  /** Text shown when picked up. */
  body: string;
}

export interface AreaFlavor {
  porto: string;
  spaccanapoli: string;
  quartieri: string;
  castel: string;
}
