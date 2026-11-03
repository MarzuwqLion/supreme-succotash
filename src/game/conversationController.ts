import type { ConversationContext, DialogueProvider, ExchangeView, ReplyOption } from '../content/dialogue/provider';
import { applyReply, createConversationState, isFinished, resolveConversation, type ConversationState, type Outcome } from '../sim/conversation';

/**
 * Runs one conversation: asks the provider for lines, applies the game's
 * trust rules to each reply, and resolves the result. Owns no content.
 */

export interface LogLine {
  who: 'them' | 'agent' | 'system';
  text: string;
}

export interface ReplyAvailability {
  visible: boolean;
  enabled: boolean;
  reason?: string;
}

export class ConversationController {
  readonly state: ConversationState;
  readonly log: LogLine[] = [];
  speakerName = '';
  exchange: ExchangeView | null = null;
  outcome: Outcome | null = null;
  busy = false;
  private sessionId = '';

  constructor(
    private readonly provider: DialogueProvider,
    readonly ctx: ConversationContext,
    startTrust: number,
  ) {
    this.state = createConversationState(ctx.speaker, startTrust);
  }

  get done(): boolean {
    return this.outcome !== null;
  }

  async begin(): Promise<void> {
    this.busy = true;
    const r = await this.provider.begin(this.ctx);
    this.sessionId = r.sessionId;
    this.speakerName = r.speakerName;
    this.log.push({ who: 'them', text: r.opening });
    this.log.push({ who: 'them', text: r.exchange.prompt });
    this.exchange = r.exchange;
    this.busy = false;
  }

  /** Intel lines only appear with the matching intel; bribes need the cash. */
  availability(reply: ReplyOption, cash: number): ReplyAvailability {
    if (reply.tier === 'intel') {
      const has = !!reply.requiresIntel && this.ctx.intel.includes(reply.requiresIntel);
      return { visible: has, enabled: has };
    }
    if (reply.tier === 'bribe') {
      const cost = reply.cost ?? 0;
      return cash >= cost ? { visible: true, enabled: true } : { visible: true, enabled: false, reason: `Needs ${cost} cash` };
    }
    return { visible: true, enabled: true };
  }

  visibleReplies(cash: number): { reply: ReplyOption; avail: ReplyAvailability }[] {
    if (!this.exchange) return [];
    return this.exchange.replies.map((reply) => ({ reply, avail: this.availability(reply, cash) })).filter((r) => r.avail.visible);
  }

  /** Pick a reply. Returns cash spent (bribes). */
  async choose(replyId: string, cash: number): Promise<number> {
    if (this.busy || this.done || !this.exchange) return 0;
    const reply = this.exchange.replies.find((r) => r.id === replyId);
    if (!reply) return 0;
    const avail = this.availability(reply, cash);
    if (!avail.enabled) return 0;
    this.busy = true;
    this.log.push({ who: 'agent', text: reply.text });
    const res = await this.provider.respond(this.sessionId, replyId);
    const applied = applyReply(this.state, { id: replyId, tier: res.tier, trustDelta: res.trustDelta }, cash);
    this.log.push({ who: 'them', text: res.reaction });
    if (isFinished(this.state) || !res.next) {
      this.outcome = resolveConversation(this.state);
      const closing = await this.provider.close(this.sessionId, this.outcome);
      if (closing) this.log.push({ who: 'them', text: closing });
      this.exchange = null;
    } else {
      this.exchange = res.next;
      this.log.push({ who: 'them', text: res.next.prompt });
    }
    this.busy = false;
    return applied.cashSpent;
  }
}
