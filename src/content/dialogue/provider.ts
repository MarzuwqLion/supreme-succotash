import { Rng, hashSeed } from '../../core/rng';
import type { NpcMemory } from '../../meta/save';
import type { Outcome } from '../../sim/conversation';
import { bribeCost } from '../../sim/conversation';
import type { DialogueContent } from './index';
import type { ConversationScript, IntelId, OpeningCondition, ReplyTier, SpeakerKind } from './types';

/**
 * The seam between game logic and conversation content. Game logic owns the
 * hidden values (trust, intel flags, suspicion) and the rules; a provider
 * only supplies lines, reply options, and how well each reply landed (as a
 * tier, optionally with a delta the rules will clamp). The scripted provider
 * reads JSON; an AI provider can implement the same interface later without
 * touching game logic. All methods are async so a networked provider fits.
 */

export interface ConversationContext {
  speaker: SpeakerKind;
  /** Stable key for this speaker instance (hostile id, or 'lucca' / 'lucretia'). */
  speakerKey: string;
  /** Saved memory for Lucca and Lucretia; null for generic hostiles. */
  memory: NpcMemory | null;
  intel: IntelId[];
  suspicion: number;
  cash: number;
  areaName: string;
  runSeed: number;
}

export interface ReplyOption {
  id: string;
  text: string;
  tier: ReplyTier;
  requiresIntel?: IntelId;
  /** Cash cost for bribes. */
  cost?: number;
}

export interface ExchangeView {
  index: number;
  /** The character's line that sets up this exchange. */
  prompt: string;
  replies: ReplyOption[];
}

export interface BeginResult {
  sessionId: string;
  speakerName: string;
  opening: string;
  exchange: ExchangeView;
}

export interface RespondResult {
  reaction: string;
  tier: ReplyTier;
  /** Optional explicit trust change; game rules clamp it to the tier's ceiling. */
  trustDelta?: number;
  /** Next exchange, or null when the conversation is over. */
  next: ExchangeView | null;
}

export interface DialogueProvider {
  readonly name: string;
  begin(ctx: ConversationContext): Promise<BeginResult>;
  respond(sessionId: string, replyId: string): Promise<RespondResult>;
  close(sessionId: string, outcome: Outcome): Promise<string>;
}

const SPEAKER_NAMES: Record<SpeakerKind, string> = {
  legionary: 'Legionary',
  trooper: 'Federation Trooper',
  lucca: 'Lucca',
  lucretia: 'Lucretia',
};

export function matchesOpening(when: OpeningCondition | undefined, ctx: ConversationContext): boolean {
  if (!when) return true;
  const mem = ctx.memory;
  if (when.lastResult !== undefined && (mem?.lastResult ?? 'none') !== when.lastResult) return false;
  if (when.minTrust !== undefined && (mem?.trust ?? 0) < when.minTrust) return false;
  if (when.maxTrust !== undefined && (mem?.trust ?? 0) > when.maxTrust) return false;
  if (when.minSuspicion !== undefined && ctx.suspicion < when.minSuspicion) return false;
  if (when.minMeetings !== undefined && (mem?.meetings ?? 0) < when.minMeetings) return false;
  return true;
}

export function pickScript(content: DialogueContent, ctx: ConversationContext): ConversationScript {
  if (ctx.speaker === 'lucca' || ctx.speaker === 'lucretia') {
    const list = content[ctx.speaker];
    const stage = Math.min(3, (ctx.memory?.meetings ?? 0) + 1);
    return list.find((s) => s.stage === stage) ?? list[list.length - 1]!;
  }
  const list = content[ctx.speaker];
  return new Rng(hashSeed(ctx.runSeed, ctx.speakerKey)).pick(list);
}

interface Session {
  script: ConversationScript;
  ctx: ConversationContext;
  exchange: number;
}

export class ScriptedDialogueProvider implements DialogueProvider {
  readonly name = 'scripted';
  private sessions = new Map<string, Session>();
  private counter = 0;

  constructor(private readonly content: DialogueContent) {}

  private view(s: Session): ExchangeView {
    const ex = s.script.exchanges[s.exchange]!;
    return {
      index: s.exchange,
      prompt: ex.prompt,
      replies: ex.replies.map((r) => {
        const cost = r.tier === 'bribe' ? (bribeCost(s.script.speaker) ?? 0) : undefined;
        return {
          id: r.id,
          text: cost !== undefined ? r.text.replace(/\{cost\}/g, `${cost}`) : r.text,
          tier: r.tier,
          requiresIntel: r.requiresIntel,
          cost,
        };
      }),
    };
  }

  async begin(ctx: ConversationContext): Promise<BeginResult> {
    const script = pickScript(this.content, ctx);
    const sessionId = `s${++this.counter}`;
    const session: Session = { script, ctx, exchange: 0 };
    this.sessions.set(sessionId, session);
    const opening = script.openings.find((o) => matchesOpening(o.when, ctx)) ?? script.openings[script.openings.length - 1]!;
    return { sessionId, speakerName: SPEAKER_NAMES[ctx.speaker], opening: opening.text, exchange: this.view(session) };
  }

  async respond(sessionId: string, replyId: string): Promise<RespondResult> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`unknown session ${sessionId}`);
    const ex = s.script.exchanges[s.exchange]!;
    const reply = ex.replies.find((r) => r.id === replyId);
    if (!reply) throw new Error(`unknown reply ${replyId}`);
    s.exchange++;
    const next = s.exchange < s.script.exchanges.length ? this.view(s) : null;
    return { reaction: reply.reaction, tier: reply.tier, next };
  }

  async close(sessionId: string, outcome: Outcome): Promise<string> {
    const s = this.sessions.get(sessionId);
    if (!s) return '';
    this.sessions.delete(sessionId);
    const c = s.script.closings;
    if (outcome === 'success') return c.success;
    if (outcome === 'bribed') return c.bribed ?? c.success;
    if (outcome === 'rebuff') return c.rebuff ?? c.failure;
    return c.failure;
  }

  /** For tests and debug: which script a context would use. */
  scriptFor(ctx: ConversationContext): ConversationScript {
    return pickScript(this.content, ctx);
  }
}
