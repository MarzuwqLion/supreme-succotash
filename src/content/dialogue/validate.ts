import { tuning } from '../../data/tuning';
import { applyReply, createConversationState, resolveConversation, tierTrustDelta } from '../../sim/conversation';
import type { ConversationScript, HaleTaunts, IntelDoc, ReplyTier, ScriptExchange, SpeakerKind } from './types';
import { INTEL_IDS } from './types';

/**
 * Structural and design-rule checks for conversation content. Used by the
 * vitest suite and safe to call at startup in dev builds.
 */

const CHARM_TIERS: ReplyTier[] = ['best', 'good', 'neutral', 'bad', 'insult'];

export function charmOnlyPick(ex: ScriptExchange, speaker: SpeakerKind) {
  let best = null as ScriptExchange['replies'][number] | null;
  for (const r of ex.replies) {
    if (!CHARM_TIERS.includes(r.tier)) continue;
    if (!best || tierTrustDelta(r.tier, speaker) > tierTrustDelta(best.tier, speaker)) best = r;
  }
  return best;
}

/** Final trust when the player picks the best charm reply in every exchange. */
export function charmOnlyRun(script: ConversationScript, startTrust: number) {
  const st = createConversationState(script.speaker, startTrust);
  for (const ex of script.exchanges) {
    const pick = charmOnlyPick(ex, script.speaker);
    if (!pick) break;
    applyReply(st, { id: pick.id, tier: pick.tier }, 0);
  }
  return { trust: st.trust, outcome: resolveConversation(st) };
}

export function validateScript(script: ConversationScript): string[] {
  const errs: string[] = [];
  const where = `[${script.id}]`;
  if (!script.id) errs.push(`${where} missing id`);
  if (!script.personality) errs.push(`${where} missing personality`);
  if (!script.openings?.length) errs.push(`${where} needs at least one opening`);
  else if (script.openings[script.openings.length - 1]!.when) errs.push(`${where} last opening must be unconditional`);
  if (script.exchanges?.length !== tuning.trust.exchanges)
    errs.push(`${where} needs exactly ${tuning.trust.exchanges} exchanges, has ${script.exchanges?.length}`);
  const ids = new Set<string>();
  script.exchanges?.forEach((ex, i) => {
    if (!ex.prompt) errs.push(`${where} exchange ${i} missing prompt`);
    if (ex.replies.length < 3 || ex.replies.length > 4) errs.push(`${where} exchange ${i} needs 3-4 replies, has ${ex.replies.length}`);
    let bribes = 0;
    let charm = 0;
    for (const r of ex.replies) {
      if (ids.has(r.id)) errs.push(`${where} duplicate reply id ${r.id}`);
      ids.add(r.id);
      if (!r.text || !r.reaction) errs.push(`${where} reply ${r.id} needs text and reaction`);
      if (r.tier === 'intel') {
        if (!r.requiresIntel || !INTEL_IDS.includes(r.requiresIntel)) errs.push(`${where} intel reply ${r.id} needs a valid requiresIntel`);
      } else if (r.requiresIntel) errs.push(`${where} reply ${r.id} has requiresIntel but tier ${r.tier}`);
      if (r.tier === 'bribe') {
        bribes++;
        if (script.speaker === 'lucca') errs.push(`${where} Lucca does not take bribes`);
      }
      if (r.tier === 'best' || r.tier === 'good') charm++;
    }
    if (bribes > 1) errs.push(`${where} exchange ${i} has more than one bribe`);
    if (charm === 0) errs.push(`${where} exchange ${i} has no charm (best/good) reply`);
    // Every exchange needs at least one charm option the player can always see.
    const visible = ex.replies.filter((r) => r.tier !== 'intel' && r.tier !== 'bribe');
    if (visible.length < 2) errs.push(`${where} exchange ${i} needs at least 2 always-visible replies`);
  });
  if (!script.closings?.success || !script.closings?.failure) errs.push(`${where} needs success and failure closings`);
  if ((script.speaker === 'lucca' || script.speaker === 'lucretia') && !script.closings?.rebuff)
    errs.push(`${where} named cast needs a rebuff closing`);
  if (script.speaker === 'lucretia' && !script.closings?.bribed) errs.push(`${where} Lucretia needs a bribed closing`);
  if (script.speaker === 'legionary' || script.speaker === 'trooper') {
    if (script.stage !== undefined) errs.push(`${where} generic hostiles should not have a stage`);
    const run = charmOnlyRun(script, 0);
    if (run.outcome !== 'success') errs.push(`${where} charm-only path fails (trust ${run.trust} < target)`);
  }
  if ((script.speaker === 'lucca' || script.speaker === 'lucretia') && (script.stage ?? 0) < 1)
    errs.push(`${where} named cast scripts need stage 1-3`);
  return errs;
}

/** Lucretia must be winnable by charm alone over a few meetings; Lucca on the first. */
export function validateCastProgression(scripts: ConversationScript[], speaker: 'lucca' | 'lucretia'): string[] {
  const errs: string[] = [];
  const byStage = (n: number) => scripts.find((s) => s.speaker === speaker && s.stage === n);
  for (const n of [1, 2, 3]) if (!byStage(n)) errs.push(`[${speaker}] missing stage ${n}`);
  if (errs.length) return errs;
  let trust = speaker === 'lucca' ? tuning.trust.luccaStart : tuning.trust.lucretiaStart;
  let wonAt = 0;
  for (let meeting = 1; meeting <= 3; meeting++) {
    const run = charmOnlyRun(byStage(meeting)!, trust);
    trust = run.trust;
    if (run.outcome === 'failure') errs.push(`[${speaker}] charm-only path fails at meeting ${meeting}`);
    if (run.outcome === 'success' && !wonAt) wonAt = meeting;
  }
  if (!wonAt) errs.push(`[${speaker}] charm-only path never succeeds within 3 meetings (trust ${trust})`);
  if (speaker === 'lucca' && wonAt !== 1) errs.push(`[lucca] should be winnable by charm on the first meeting`);
  return errs;
}

export function validateHale(t: HaleTaunts): string[] {
  const errs: string[] = [];
  const keys: (keyof HaleTaunts)[] = ['firstEncounter', 'grudge1', 'grudge2', 'rematch', 'combat', 'lowHealth', 'agentExtracted', 'defeated'];
  for (const k of keys) if (!Array.isArray(t[k]) || t[k].length === 0) errs.push(`[hale] needs lines for ${k}`);
  return errs;
}

export function validateIntel(docs: IntelDoc[]): string[] {
  const errs: string[] = [];
  for (const id of INTEL_IDS) if (!docs.find((d) => d.id === id)) errs.push(`[intel] missing ${id}`);
  return errs;
}
