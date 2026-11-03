import { content } from '../content/dialogue';
import { ScriptedDialogueProvider, type ConversationContext, type DialogueProvider } from '../content/dialogue/provider';
import { INTEL_IDS, type IntelId, type SpeakerKind } from '../content/dialogue/types';
import { FixedLoop } from '../core/loop';
import { Rng, hashSeed, randomSeed } from '../core/rng';
import { forwardFromYaw, v3 } from '../core/vec';
import { tuning } from '../data/tuning';
import { InputSystem, type InputFrame } from '../input/input';
import { beginRun, buy, earnCash, endRun as finishRun, sanitizeLoadout, shopItem, spendCash, type ShopItemId } from '../meta/economy';
import { haleExtraEscorts, haleOnDefeat, haleOnEncounter, haleOnExtraction, recordMeeting } from '../meta/memory';
import { browserStorage, SaveStore, type Loadout, type OwnedGearId, type RunRecord } from '../meta/save';
import type { CameraMode } from '../render/camera';
import { GameView } from '../render/view';
import { outcomeHelps } from '../sim/conversation';
import { castAppears, generateArea } from '../sim/gen/generator';
import { AREA_NAMES } from '../sim/gen/layout';
import { initPhysics, type Rapier } from '../sim/physics';
import { PICKUP_NAMES } from '../sim/treasure';
import { SimWorld, type SimEvent } from '../sim/world';
import { DebugPanel } from '../ui/debug';
import { MenuNav } from '../ui/dom';
import { Hud } from '../ui/hud';
import { cardScreen, conversationScreen, endScreen, fobScreen, intelScreen, luccaShopScreen, pauseScreen, type ShopEntry } from '../ui/screens';
import { ConversationController } from './conversationController';
import { intelForArea, newRunSession, type RunSession } from './run';

/**
 * Top-level state machine: FOB menu -> run (three areas) -> end screen.
 * Owns the fixed-step loop; the simulation only advances while playing.
 */

type Mode = 'fob' | 'playing' | 'conversation' | 'shop' | 'modal' | 'paused' | 'card' | 'ended';

const INTEL_NAMES: Record<IntelId, string> = { patrolCodes: 'patrol codes', halesSchedule: "Hale's schedule", transportManifest: 'a transport manifest' };

export class Game {
  readonly save = new SaveStore(browserStorage());
  readonly input: InputSystem;
  readonly view: GameView;
  readonly hud: Hud;
  readonly overlay: HTMLElement;
  readonly nav: MenuNav;
  readonly debug: DebugPanel;
  provider: DialogueProvider = new ScriptedDialogueProvider(content);
  private loop: FixedLoop;
  private R!: Rapier;
  mode: Mode = 'fob';
  run: RunSession | null = null;
  world: SimWorld | null = null;
  private loadout: Loadout;
  private conversation: ConversationController | null = null;
  private convTarget: { speaker: 'hostile'; hostileId: number } | { speaker: 'lucca' | 'lucretia' } | null = null;
  private pendingEvents: SimEvent[] = [];
  private cardFrames = 0;
  private endTimer = -1;
  private endOutcome: 'win' | 'extracted' | null = null;
  private fobNotice: string | null = null;
  private lastDevice: 'pad' | 'kbm' = 'kbm';
  private barkRng = new Rng(1);
  readonly info: Record<string, string | number> = {
    mode: 'fob',
    seed: '-',
    area: '-',
    frame: 0,
    suspicion: 0,
    trustNow: '-',
    luccaTrust: 0,
    lucretiaTrust: 0,
    haleGrudge: 0,
    hostilesAlive: 0,
    provider: 'scripted',
  };

  constructor(root: HTMLElement) {
    const canvas = root.querySelector<HTMLCanvasElement>('#view')!;
    this.overlay = root.querySelector<HTMLElement>('#overlay')!;
    this.view = new GameView(canvas);
    this.hud = new Hud(root.querySelector<HTMLElement>('#hud')!);
    this.input = new InputSystem(canvas);
    this.nav = new MenuNav(this.overlay);
    this.loadout = sanitizeLoadout(this.save.data, this.save.data.lastLoadout);
    this.debug = new DebugPanel(this.debugActions());
    canvas.addEventListener('click', () => {
      if (this.mode === 'playing') this.input.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      // Losing pointer lock mid-run (Esc in the browser) pauses the game.
      if (!this.input.pointerLocked && this.mode === 'playing' && this.lastDevice === 'kbm') this.pause();
    });
    window.addEventListener('beforeunload', (e) => {
      if (this.run) e.preventDefault();
    });
    this.loop = new FixedLoop(
      { step: () => this.step(), render: (a, dt) => this.render(a, dt) },
      () => tuning.sim.hz,
      () => tuning.sim.maxStepsPerFrame,
    );
  }

  async start(): Promise<void> {
    this.R = await initPhysics();
    this.resolveInterruptedRun();
    this.showFob();
    this.loop.start();
  }

  // ------------------------------------------------------------ save helpers

  private resolveInterruptedRun(): void {
    const active = this.save.data.activeRun;
    if (!active) return;
    // A reload mid-run counts as an extraction: gear locks, cash stays banked.
    const record: RunRecord = {
      runIndex: active.runIndex,
      seed: active.seed,
      outcome: 'extracted',
      timeSec: 0,
      kills: 0,
      takedowns: 0,
      conversationsWon: 0,
      conversationsLost: 0,
      peakSuspicion: 0,
      cashEarned: active.cashEarned,
      areaReached: active.areaIndex,
      interrupted: true,
    };
    let locked: OwnedGearId[] = [];
    this.save.update((d) => {
      if (active.haleInvolved) haleOnExtraction(d.hale);
      locked = finishRun(d, record).lockedNow;
    });
    const names = locked.map((g) => shopItem(g).name);
    this.fobNotice = `Your last run was interrupted, so it counts as an extraction.${names.length ? ` Locked for this run: ${names.join(', ')}.` : ''}`;
  }

  // ------------------------------------------------------------ overlays

  private setOverlay(el: HTMLElement | null): void {
    this.overlay.innerHTML = '';
    if (el) {
      this.overlay.append(el);
      this.nav.setRoot(el);
    }
  }

  private showFob(): void {
    this.mode = 'fob';
    this.hud.show(false);
    this.input.releasePointerLock();
    this.loadout = sanitizeLoadout(this.save.data, this.loadout);
    this.setOverlay(
      fobScreen(this.save.data, this.loadout, this.fobNotice, {
        buy: (id: ShopItemId) => {
          this.save.update((d) => buy(d, id));
          this.refreshFob();
        },
        setLoadout: (l) => {
          this.loadout = l;
          this.refreshFob();
        },
        deploy: (seed) => this.startRun(seed ?? randomSeed()),
        resetSave: () => {
          this.save.reset();
          this.loadout = sanitizeLoadout(this.save.data, this.save.data.lastLoadout);
          this.fobNotice = 'Save reset.';
          this.refreshFob();
        },
      }),
    );
  }

  private refreshFob(): void {
    const scroll = this.overlay.firstElementChild?.scrollTop ?? 0;
    this.showFob();
    if (this.overlay.firstElementChild) this.overlay.firstElementChild.scrollTop = scroll;
  }

  // ------------------------------------------------------------ run flow

  startRun(seed: number): void {
    this.disposeWorld();
    this.fobNotice = null;
    const loadout = sanitizeLoadout(this.save.data, this.loadout);
    let runIndex = 0;
    this.save.update((d) => {
      runIndex = beginRun(d, loadout, seed).runIndex;
    });
    this.run = newRunSession(this.save.data, loadout, seed, runIndex);
    this.barkRng = new Rng(hashSeed(seed, 'barks'));
    this.enterArea(0);
  }

  private enterArea(index: number): void {
    const run = this.run!;
    this.disposeWorld();
    run.areaIndex = index;
    const type = run.plan.areaTypes[index]!;
    const lucca = castAppears(run.plan.seed, 'lucca', index, run.castSeen.lucca);
    const lucretia = castAppears(run.plan.seed, 'lucretia', index, run.castSeen.lucretia);
    run.castSeen.lucca ||= lucca;
    run.castSeen.lucretia ||= lucretia;
    let haleTaunt = null as ReturnType<typeof haleOnEncounter> | null;
    if (type === 'castel') {
      run.haleInvolved = true;
      this.save.update((d) => {
        haleTaunt = haleOnEncounter(d.hale);
        if (d.activeRun) d.activeRun.haleInvolved = true;
      });
    }
    const layout = generateArea({
      type,
      index,
      seed: run.plan.seed,
      luccaPresent: lucca,
      lucretiaPresent: lucretia,
      extraEscorts: type === 'castel' ? haleExtraEscorts(this.save.data.hale) : 0,
    });
    this.save.update((d) => {
      if (d.activeRun) d.activeRun.areaIndex = index;
    });
    this.world = new SimWorld(this.R, {
      layout,
      areaIndex: index,
      runSeed: run.plan.seed,
      carry: run.carry,
      coverIdentity: run.coverIdentity,
      areaIntel: intelForArea(run.plan.seed, index, run.carry.intel),
      haleTaunt,
    });
    this.view.build(this.world);
    this.view.showCones = this.debugCones;
    this.endTimer = -1;
    this.endOutcome = null;
    this.mode = 'card';
    this.cardFrames = Math.round(1.6 * tuning.sim.hz);
    const sub =
      type === 'castel'
        ? 'Walled compound. Commander Hale is here. There is no exit until he is down.'
        : `Find the exit. ${lucca && lucretia ? 'Lucca and Lucretia are both around.' : lucca ? 'Lucca is somewhere in the area.' : lucretia ? 'Lucretia is somewhere in the area.' : ''}`;
    this.setOverlay(cardScreen(`Area ${index + 1}: ${AREA_NAMES[type]}`, sub));
    this.hud.show(true);
    this.info.seed = run.plan.seed;
    this.info.area = `${index + 1} ${type}`;
  }

  private disposeWorld(): void {
    if (this.world) {
      this.world.dispose();
      this.world = null;
    }
    this.view.clear();
  }

  private accumulateAreaStats(): void {
    const run = this.run;
    const w = this.world;
    if (!run || !w) return;
    run.stats.kills += w.stats.kills;
    run.stats.takedowns += w.stats.takedowns;
    run.stats.executions += w.stats.executions;
    run.stats.peakSuspicion = Math.max(run.stats.peakSuspicion, w.suspicion.peak);
  }

  private leaveArea(): void {
    const run = this.run!;
    const w = this.world!;
    w.finished = true;
    run.carry = w.carry();
    this.accumulateAreaStats();
    // Zero out the world's stats so they aren't counted twice.
    w.stats.kills = w.stats.takedowns = w.stats.executions = 0;
    this.enterArea(run.areaIndex + 1);
  }

  private endRun(outcome: 'win' | 'extracted'): void {
    const run = this.run;
    if (!run) return;
    this.accumulateAreaStats();
    const record: RunRecord = {
      runIndex: run.runIndex,
      seed: run.plan.seed,
      outcome,
      timeSec: run.stats.timeFrames / tuning.sim.hz,
      kills: run.stats.kills,
      takedowns: run.stats.takedowns,
      conversationsWon: run.stats.conversationsWon,
      conversationsLost: run.stats.conversationsLost,
      peakSuspicion: run.stats.peakSuspicion,
      cashEarned: run.stats.cashEarned,
      areaReached: run.areaIndex,
    };
    let locked: OwnedGearId[] = [];
    let quote: string | null = null;
    const extractedInCastel = outcome === 'extracted' && run.plan.areaTypes[run.areaIndex] === 'castel';
    this.save.update((d) => {
      if (outcome === 'win') haleOnDefeat(d.hale);
      else if (run.haleInvolved && extractedInCastel) {
        haleOnExtraction(d.hale);
        quote = this.hud.haleLine('agentExtracted', this.barkRng.int(0, 99));
      }
      locked = finishRun(d, record).lockedNow;
    });
    if (outcome === 'win') quote = this.lastHaleLine;
    this.disposeWorld();
    this.run = null;
    this.mode = 'ended';
    this.hud.show(false);
    this.input.releasePointerLock();
    this.setOverlay(endScreen(record, locked, quote, () => this.showFob()));
  }

  private lastHaleLine: string | null = null;

  // ------------------------------------------------------------ loop

  private step(): void {
    const f = this.input.sample();
    if (f.move.x || f.move.y || f.look.x || f.look.y) this.lastDevice = f.device;
    if (f.pressed.debug) this.debug.toggle();
    this.info.mode = this.mode;
    this.info.luccaTrust = this.save.data.cast.lucca.trust;
    this.info.lucretiaTrust = this.save.data.cast.lucretia.trust;
    this.info.haleGrudge = this.save.data.hale.grudge;
    switch (this.mode) {
      case 'playing':
        this.stepPlaying(f);
        break;
      case 'card':
        if (--this.cardFrames <= 0) {
          this.mode = 'playing';
          this.setOverlay(null);
          this.flushPending();
        }
        break;
      case 'conversation':
        this.stepConversationInput(f);
        break;
      case 'paused':
        if (f.pressed.pause || f.pressed.back) this.resume();
        else this.nav.handle(f);
        break;
      case 'shop':
      case 'modal':
        if (f.pressed.back) this.closeModal();
        else this.nav.handle(f);
        break;
      case 'fob':
      case 'ended':
        this.nav.handle(f);
        break;
    }
  }

  private stepPlaying(f: InputFrame): void {
    const w = this.world;
    const run = this.run;
    if (!w || !run) return;
    if (f.pressed.pause) {
      this.pause();
      return;
    }
    if (this.endTimer >= 0) {
      // Let the final moment breathe before the end screen.
      if (--this.endTimer <= 0 && this.endOutcome) {
        this.endRun(this.endOutcome);
        return;
      }
      w.tick(emptyInput(f));
      this.handleEvents(w.drainEvents());
      return;
    }
    run.stats.timeFrames++;
    w.tick(f);
    this.info.frame = w.frame;
    this.info.suspicion = Math.round(w.suspicion.value);
    this.info.hostilesAlive = w.hostiles.filter((h) => h.state !== 'dead').length;
    this.handleEvents(w.drainEvents());
  }

  private flushPending(): void {
    const evs = this.pendingEvents.splice(0);
    if (evs.length) this.handleEvents(evs, false);
  }

  private handleEvents(events: SimEvent[], fx = true): void {
    const w = this.world;
    const run = this.run;
    if (!w || !run) return;
    if (fx) this.view.handleEvents(events);
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      // Anything that pauses play defers the rest of the batch until play resumes.
      if (this.mode !== 'playing' && this.mode !== 'card') {
        this.pendingEvents.push(e);
        continue;
      }
      switch (e.type) {
        case 'message':
          this.hud.message(e.text, e.tone);
          break;
        case 'suspicion':
          if (e.change.delta !== 0) {
            const why = { loudGunfire: 'loud gunfire', silencedSeen: 'silenced shot was seen', silencedUnseen: '', failedConversation: 'failed conversation', jammer: 'signal jammer', melee: '', debug: 'debug' }[e.change.cause];
            this.hud.message(`${e.change.delta > 0 ? '+' : ''}${e.change.delta} suspicion: ${why}`, e.change.delta > 0 ? 'warn' : 'good', 3);
          }
          break;
        case 'haleBark': {
          const line = this.hud.haleLine(e.key, this.barkRng.int(0, 99));
          this.lastHaleLine = line;
          this.hud.say(e.key === 'firstEncounter' || e.key === 'grudge1' || e.key === 'grudge2' || e.key === 'rematch' ? 'Hale (radio)' : 'Hale', line, 6);
          break;
        }
        case 'loot':
          if (e.loot.kind === 'cash') {
            const amount = e.loot.amount;
            this.save.update((d) => earnCash(d, amount));
            run.stats.cashEarned += amount;
            this.hud.message(`Valuables: +${amount} cash (banked)`, 'good');
          } else this.hud.message(`Found: ${PICKUP_NAMES[e.loot.item]}`, 'good');
          break;
        case 'intel':
          this.hud.message(`Intel: ${INTEL_NAMES[e.intel]}`, 'good');
          this.openModal(intelScreen(e.intel, () => this.closeModal()));
          break;
        case 'exit':
          if (run.areaIndex < 2) {
            this.leaveArea();
            return;
          }
          break;
        case 'playerDown':
          this.hud.message('Health zero. The FOB is pulling you out.', 'bad', 6);
          this.endTimer = Math.round(tuning.run.extractionDelaySec * tuning.sim.hz);
          this.endOutcome = 'extracted';
          break;
        case 'haleDown':
          this.hud.message(`Commander Hale is down (${e.method}).`, 'good', 6);
          this.endTimer = Math.round(tuning.run.winDelaySec * tuning.sim.hz);
          this.endOutcome = 'win';
          break;
        case 'kill':
          if (e.method === 'takedown') this.hud.message('Takedown', 'good', 2);
          else if (e.method === 'execution') this.hud.message('Execution', 'good', 2);
          break;
        case 'conversation':
          if (e.speaker === 'hostile') void this.startConversation(e.kind, { speaker: 'hostile', hostileId: e.hostileId });
          else void this.startConversation(e.speaker, { speaker: e.speaker });
          break;
        case 'shop':
          this.openLuccaShop();
          break;
        default:
          break;
      }
    }
  }

  // ------------------------------------------------------------ pause / modal

  private pause(): void {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.input.releasePointerLock();
    this.setOverlay(pauseScreen(() => this.resume()));
  }

  private resume(): void {
    this.mode = 'playing';
    this.setOverlay(null);
    if (this.lastDevice === 'kbm') this.input.requestPointerLock();
    this.flushPending();
  }

  private openModal(el: HTMLElement): void {
    this.mode = 'modal';
    this.input.releasePointerLock();
    this.setOverlay(el);
  }

  private closeModal(): void {
    this.resume();
  }

  // ------------------------------------------------------------ conversations

  private async startConversation(speaker: SpeakerKind, target: NonNullable<Game['convTarget']>): Promise<void> {
    const w = this.world!;
    const run = this.run!;
    this.mode = 'conversation';
    this.input.releasePointerLock();
    const named = speaker === 'lucca' || speaker === 'lucretia';
    const memory = named ? this.save.data.cast[speaker] : null;
    const ctx: ConversationContext = {
      speaker,
      speakerKey: target.speaker === 'hostile' ? `${run.areaIndex}-${target.hostileId}` : speaker,
      memory: memory ? { ...memory } : null,
      intel: [...w.player.intel],
      suspicion: w.suspicion.value,
      cash: this.save.data.cash,
      areaName: AREA_NAMES[w.layout.type],
      runSeed: run.plan.seed,
    };
    const c = new ConversationController(this.provider, ctx, memory ? memory.trust : 0);
    this.conversation = c;
    this.convTarget = target;
    const focus = target.speaker === 'hostile' ? w.hostile(target.hostileId)?.pos : w.npc(target.speaker)?.pos;
    this.view.conversationFocus = focus ?? null;
    await c.begin();
    this.renderConversation();
  }

  private renderConversation(): void {
    const c = this.conversation;
    if (!c) return;
    this.info.trustNow = `${c.state.trust} / ${c.state.target}`;
    this.setOverlay(
      conversationScreen(
        c,
        this.save.data.cash,
        this.lastDevice,
        (id) => void this.chooseReply(id),
        () => this.finishConversation(),
      ),
    );
  }

  private stepConversationInput(f: InputFrame): void {
    const c = this.conversation;
    if (!c || c.busy) return;
    if (!c.done) {
      const choices = c.visibleReplies(this.save.data.cash);
      const keys = [f.pressed.choice1, f.pressed.choice2, f.pressed.choice3, f.pressed.choice4];
      for (let i = 0; i < keys.length; i++) {
        if (keys[i] && choices[i]?.avail.enabled) {
          void this.chooseReply(choices[i]!.reply.id);
          return;
        }
      }
    }
    this.nav.handle(f);
  }

  private async chooseReply(id: string): Promise<void> {
    const c = this.conversation;
    if (!c || c.busy) return;
    const spent = await c.choose(id, this.save.data.cash);
    if (spent > 0) {
      this.save.update((d) => spendCash(d, spent));
      this.hud.message(`Paid ${spent} cash`, 'info');
    }
    this.renderConversation();
  }

  private finishConversation(): void {
    const c = this.conversation;
    const target = this.convTarget;
    const w = this.world;
    const run = this.run;
    if (!c || !target || !w || !run || !c.outcome) return;
    const outcome = c.outcome;
    const helped = outcomeHelps(outcome);
    if (helped) run.stats.conversationsWon++;
    else if (outcome === 'failure') run.stats.conversationsLost++;
    else run.stats.conversationsPending++;
    this.conversation = null;
    this.convTarget = null;
    this.view.conversationFocus = null;
    this.info.trustNow = '-';
    this.mode = 'playing';
    this.setOverlay(null);

    if (target.speaker === 'hostile') {
      if (helped) {
        w.endHostileConversation(target.hostileId, true);
        this.giveHostileReward(w);
      } else {
        w.applySuspicion(w.suspicion.failedConversation());
        w.endHostileConversation(target.hostileId, false);
      }
    } else {
      const who = target.speaker;
      this.save.update((d) => recordMeeting(d.cast[who], outcome, c.state.trust));
      const npc = w.npc(who);
      if (outcome === 'failure') {
        w.applySuspicion(w.suspicion.failedConversation());
        if (npc) npc.state = 'gone';
        this.hud.message(`${who === 'lucca' ? 'Lucca' : 'Lucretia'} walks away.`, 'bad');
      } else if (outcome === 'rebuff') {
        if (npc) npc.state = 'done';
        this.hud.message(`${who === 'lucca' ? 'Lucca' : 'Lucretia'} isn't won over yet, but will remember this.`, 'info', 5);
      } else if (who === 'lucca') {
        if (npc) npc.state = 'helped';
        this.openLuccaShop();
      } else {
        if (npc) npc.state = 'done';
        this.lucretiaHelps(w);
      }
    }
    this.handleEvents(w.drainEvents());
    this.flushPending();
    // Only grab the mouse again if nothing else (shop, intel) took over the screen.
    if (this.mode === 'playing' && this.lastDevice === 'kbm') this.input.requestPointerLock();
  }

  /** A talked-down hostile may reveal the exit, reveal a cache, or hand over intel. */
  private giveHostileReward(w: SimWorld): void {
    const options: ('exit' | 'cache' | 'intel')[] = [];
    if (w.exit && !w.exit.revealed) options.push('exit');
    if (w.caches.some((c) => !c.opened && !c.revealed)) options.push('cache');
    const missing = INTEL_IDS.filter((i) => !w.player.intel.has(i));
    if (missing.length) options.push('intel');
    if (!options.length) {
      this.hud.message('They stand down.', 'good');
      return;
    }
    const pick = w.rng.pick(options);
    if (pick === 'exit') {
      w.revealExit();
      this.hud.message('They stand down and point you to the exit (marked).', 'good', 5);
    } else if (pick === 'cache') {
      w.revealCache();
      this.hud.message('They stand down and mention a stash nearby (marked).', 'good', 5);
    } else {
      const id = w.rng.pick(missing);
      this.hud.message(`They stand down and hand over ${INTEL_NAMES[id]}.`, 'good', 5);
      w.giveIntel(id);
    }
  }

  /** Lucretia's help: intel, the exit, and the caches. */
  private lucretiaHelps(w: SimWorld): void {
    const missing = INTEL_IDS.filter((i) => !w.player.intel.has(i));
    const parts: string[] = [];
    if (w.revealExit()) parts.push('the exit');
    const n = w.revealAllCaches();
    if (n) parts.push(`${n} cache${n > 1 ? 's' : ''}`);
    if (missing.length) {
      const id = new Rng(hashSeed(this.run!.plan.seed, 'lucretia', this.run!.areaIndex)).pick(missing);
      parts.push(INTEL_NAMES[id]);
      this.hud.message(`Lucretia marks ${parts.join(', ')}.`, 'good', 6);
      w.giveIntel(id);
    } else this.hud.message(parts.length ? `Lucretia marks ${parts.join(' and ')}.` : 'Lucretia has nothing new for you.', 'good', 6);
  }

  private luccaEntries(): { entries: ShopEntry[]; discount: boolean } {
    const discount = this.save.data.cast.lucca.trust >= tuning.trust.luccaDiscountTrust;
    const f = discount ? 1 - tuning.trust.luccaDiscount : 1;
    const s = tuning.shop;
    return {
      discount,
      entries: [
        { id: 'ammo', name: `Ammo (+${tuning.weapons.ammoPickupMagazines} magazines per weapon)`, price: Math.round(s.luccaAmmo * f) },
        { id: 'medkit', name: 'Medkit (+50 health)', price: Math.round(s.luccaMedkit * f) },
        { id: 'smoke', name: 'Smoke grenade', price: Math.round(s.luccaSmoke * f) },
      ],
    };
  }

  private openLuccaShop(): void {
    const render = () => {
      const { entries, discount } = this.luccaEntries();
      this.setOverlay(
        luccaShopScreen(
          entries,
          this.save.data.cash,
          discount,
          (id) => {
            const e = entries.find((x) => x.id === id)!;
            let ok = false;
            this.save.update((d) => (ok = spendCash(d, e.price)));
            if (ok && this.world) {
              this.world.addPickup(id);
              this.hud.message(`Bought ${e.name}`, 'good');
            }
            render();
          },
          () => this.closeModal(),
        ),
      );
    };
    this.mode = 'shop';
    this.input.releasePointerLock();
    render();
  }

  // ------------------------------------------------------------ render

  private render(alpha: number, dt: number): void {
    const w = this.world;
    if (!w) {
      this.view.renderer.render(this.view.scene, this.view.cam.camera);
      return;
    }
    const p = w.player;
    let mode: CameraMode = 'explore';
    if (this.mode === 'conversation') mode = 'conversation';
    else if (p.aiming) mode = 'aim';
    else {
      const close = w.hostiles.some((h) => h.state === 'alert' && Math.hypot(h.pos.x - p.pos.x, h.pos.z - p.pos.z) < tuning.camera.meleeModeRange);
      const meleeAction = p.action.kind !== 'none' && p.action.kind !== 'dodge';
      if (close || meleeAction) mode = 'melee';
    }
    const a = this.mode === 'playing' || this.mode === 'card' ? alpha : 1;
    this.view.render(w, a, dt, mode);
    this.hud.update(w, this.view, this.lastDevice, this.save.data.cash, this.run?.areaIndex ?? 0);
  }

  // ------------------------------------------------------------ debug

  private debugCones = true;

  private debugActions() {
    const game = this;
    return {
      info: this.info,
      newRun: (seed: number | null) => game.startRun(seed ?? randomSeed()),
      regenerateArea: () => {
        if (game.run) game.enterArea(game.run.areaIndex);
      },
      skipToArea: (i: number) => {
        if (!game.run) game.startRun(randomSeed());
        if (game.world) game.run!.carry = game.world.carry();
        game.enterArea(Math.max(0, Math.min(2, i)));
      },
      addCash: (n: number) => {
        game.save.update((d) => (d.cash += n));
        if (game.mode === 'fob') game.refreshFob();
      },
      setSuspicion: (v: number) => {
        const w = game.world;
        if (w) w.applySuspicion(w.suspicion.set(v));
      },
      revealAll: () => {
        game.world?.revealExit();
        game.world?.revealAllCaches();
      },
      giveAllIntel: () => {
        for (const i of INTEL_IDS) game.world?.giveIntel(i);
      },
      killAllHostiles: () => {
        const w = game.world;
        if (!w) return;
        for (const h of w.hostiles) if (h.state !== 'dead' && h.kind !== 'hale') w.killHostile(h, 'gun');
      },
      teleportToExit: () => {
        const w = game.world;
        if (w?.exit) w.physics.teleport(w.player.body, v3(w.exit.pos.x + 1.5, 0, w.exit.pos.z));
      },
      teleportToHale: () => {
        const w = game.world;
        const hale = w?.hale;
        if (w && hale && hale.state !== 'dead') {
          const f = forwardFromYaw(hale.yaw);
          w.physics.teleport(w.player.body, v3(hale.pos.x - f.x * 1.6, 0, hale.pos.z - f.z * 1.6));
        }
      },
      damageSelf: (n: number) => {
        const w = game.world;
        if (w) {
          w.player.armor = 0;
          w.hostileGunHitsPlayer(n);
        }
      },
      setGodMode: (on: boolean) => {
        if (game.world) game.world.godMode = on;
      },
      setCones: (on: boolean) => {
        game.debugCones = on;
        game.view.showCones = on;
      },
      resetSave: () => {
        game.disposeWorld();
        game.run = null;
        game.save.reset();
        game.fobNotice = 'Save reset.';
        game.showFob();
      },
    };
  }
}

/** Neutral input used while the final moment plays out. */
function emptyInput(f: InputFrame): InputFrame {
  const blank = Object.fromEntries(Object.keys(f.held).map((k) => [k, false])) as InputFrame['held'];
  return { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, held: blank, pressed: { ...blank }, released: { ...blank }, device: f.device };
}
