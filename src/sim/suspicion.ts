import { tuning } from '../data/tuning';

/**
 * Per-area suspicion meter (0-100). It never decays during an area; the
 * only way down is the signal jammer. A new area starts a new meter.
 */
export type SuspicionCause = 'loudGunfire' | 'silencedSeen' | 'silencedUnseen' | 'failedConversation' | 'jammer' | 'melee' | 'debug';

export interface SuspicionChange {
  cause: SuspicionCause;
  delta: number;
  value: number;
  reachedMax: boolean;
}

export class SuspicionMeter {
  value = 0;
  peak = 0;
  private lastLoudSec = -Infinity;
  private failedConversations = 0;
  private jammerUsed = false;

  constructor(private readonly coverIdentity = false) {}

  get atMax(): boolean {
    return this.value >= tuning.suspicion.max;
  }

  get jammerAvailable(): boolean {
    return !this.jammerUsed;
  }

  private change(cause: SuspicionCause, delta: number): SuspicionChange {
    const wasMax = this.atMax;
    this.value = Math.max(0, Math.min(tuning.suspicion.max, this.value + delta));
    this.peak = Math.max(this.peak, this.value);
    return { cause, delta, value: this.value, reachedMax: !wasMax && this.atMax };
  }

  /** Loud gunfire: +20 at most once every 3 seconds. */
  loudGunfire(nowSec: number): SuspicionChange {
    if (nowSec - this.lastLoudSec < tuning.suspicion.loudGunfireCooldownSec) return this.change('loudGunfire', 0);
    this.lastLoudSec = nowSec;
    return this.change('loudGunfire', tuning.suspicion.loudGunfire);
  }

  silencedShot(seen: boolean): SuspicionChange {
    return seen ? this.change('silencedSeen', tuning.suspicion.silencedSeen) : this.change('silencedUnseen', tuning.suspicion.silencedUnseen);
  }

  /** Melee strikes, Takedowns, and Executions never add suspicion. */
  melee(): SuspicionChange {
    return this.change('melee', 0);
  }

  /** +15, except Cover identity makes the first failure in each area free. */
  failedConversation(): SuspicionChange {
    this.failedConversations++;
    if (this.coverIdentity && this.failedConversations === 1) return this.change('failedConversation', 0);
    return this.change('failedConversation', tuning.suspicion.failedConversation);
  }

  /** Signal jammer: -25, once per area. Returns null when already used. */
  jammer(): SuspicionChange | null {
    if (this.jammerUsed) return null;
    this.jammerUsed = true;
    return this.change('jammer', -tuning.suspicion.jammer);
  }

  set(value: number): SuspicionChange {
    return this.change('debug', value - this.value);
  }
}
