import type { HaleTaunts, IntelId } from '../content/dialogue/types';
import { Rng, hashSeed } from '../core/rng';
import { angleDiff, clone, distXZ, segmentHitsSphere, v3, yawTo, type V3 } from '../core/vec';
import { tuning } from '../data/tuning';
import type { InputFrame } from '../input/input';
import { applyAgentDamage, applyHostileDamage, contextActionFor, resolveMeleeDefense, type ContextAction, type HostileKind } from './damage';
import type { Cache, Hostile, Interactable, IntelPickup, Npc, NpcWho, Player, Smoke, WeaponSlot } from './entities';
import type { AreaLayout } from './gen/layout';
import { updateHostile } from './hostiles';
import { Nav } from './nav';
import { Physics, type Rapier } from './physics';
import { updatePlayer } from './player';
import { SuspicionMeter, type SuspicionChange } from './suspicion';
import { rollCache, type CacheLoot } from './treasure';

/** What the agent carries from area to area within a run. */
export interface PlayerCarry {
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  weapons: WeaponSlot[];
  items: { medkit: number; smoke: number };
  hasJammer: boolean;
  intel: IntelId[];
}

export interface AreaContext {
  layout: AreaLayout;
  areaIndex: number;
  runSeed: number;
  carry: PlayerCarry;
  coverIdentity: boolean;
  /** Which intel the pickup in this area holds (Areas 1 and 2). */
  areaIntel: IntelId | null;
  /** Hale's radio taunt when entering the Castel. */
  haleTaunt: keyof HaleTaunts | null;
}

export type KillMethod = 'takedown' | 'execution' | 'melee' | 'gun' | 'throw';

export type SimEvent =
  | { type: 'conversation'; speaker: 'hostile'; hostileId: number; kind: 'legionary' | 'trooper' }
  | { type: 'conversation'; speaker: NpcWho }
  | { type: 'shop'; who: 'lucca' }
  | { type: 'loot'; cacheId: number; loot: CacheLoot }
  | { type: 'intel'; intel: IntelId }
  | { type: 'exit' }
  | { type: 'playerDown' }
  | { type: 'haleDown'; method: KillMethod }
  | { type: 'kill'; hostileId: number; method: KillMethod; kind: HostileKind }
  | { type: 'message'; text: string; tone: 'info' | 'warn' | 'good' | 'bad' }
  | { type: 'suspicion'; change: SuspicionChange }
  | { type: 'maxSuspicion' }
  | { type: 'haleBark'; key: keyof HaleTaunts }
  | { type: 'shot'; from: V3; to: V3; loud: boolean; byPlayer: boolean; hit: boolean }
  | { type: 'impact'; pos: V3; kind: 'melee' | 'gun' | 'parry' | 'block' | 'dodge' }
  | { type: 'smoke'; pos: V3 }
  | { type: 'alert'; hostileId: number };

export interface WorldStats {
  kills: number;
  takedowns: number;
  executions: number;
}

export class SimWorld {
  /** Per-world id counter so a seed replays identically no matter what ran before. */
  private nextId = 1;
  readonly physics: Physics;
  readonly nav: Nav;
  readonly rng: Rng;
  readonly suspicion: SuspicionMeter;
  readonly player: Player;
  readonly hostiles: Hostile[] = [];
  readonly npcs: Npc[] = [];
  readonly caches: Cache[] = [];
  readonly intelPickup: IntelPickup | null;
  readonly exit: { pos: V3; revealed: boolean; open: boolean } | null;
  readonly smokes: Smoke[] = [];
  readonly events: SimEvent[] = [];
  readonly stats: WorldStats = { kills: 0, takedowns: 0, executions: 0 };
  readonly tokens = { melee: new Set<number>(), ranged: new Set<number>() };
  readonly layout: AreaLayout;
  readonly areaIndex: number;
  /** Simulation frame counter (60 per second). */
  frame = 0;
  haleId: number | null = null;
  haleMarked = false;
  godMode = false;
  /** True once the area is resolved (exit, win, or extraction) so the sim stops emitting. */
  finished = false;

  constructor(R: Rapier, ctx: AreaContext) {
    this.layout = ctx.layout;
    this.areaIndex = ctx.areaIndex;
    this.physics = new Physics(R, ctx.layout.boxes);
    this.nav = new Nav(ctx.layout);
    this.rng = new Rng(hashSeed(ctx.runSeed, ctx.areaIndex, 'sim'));
    this.suspicion = new SuspicionMeter(ctx.coverIdentity);
    const p = tuning.player;
    const pid = this.nextId++;
    const body = this.physics.addCharacter(pid, ctx.layout.entrance, p.capsuleRadius, p.capsuleHalfHeight);
    const c = ctx.carry;
    this.player = {
      id: pid,
      body,
      pos: clone(ctx.layout.entrance),
      prevPos: clone(ctx.layout.entrance),
      yaw: ctx.layout.entranceYaw,
      prevYaw: ctx.layout.entranceYaw,
      viewYaw: ctx.layout.entranceYaw,
      viewPitch: -0.15,
      health: c.health,
      maxHealth: c.maxHealth,
      armor: c.armor,
      maxArmor: c.maxArmor,
      action: { kind: 'none' },
      speed: 0,
      sprinting: false,
      aiming: false,
      blocking: false,
      parryFrame: -1,
      parryLockout: 0,
      weapons: c.weapons.map((w) => ({ ...w })),
      slot: 0,
      fireCooldown: 0,
      reload: 0,
      swap: 0,
      lockTarget: null,
      items: { ...c.items },
      hasJammer: c.hasJammer,
      selectedItem: 0,
      useHeldFrames: -1,
      intel: new Set(c.intel),
      context: { action: null, target: null },
      interact: null,
      meleeTarget: null,
      lastShotFrame: -1000,
      dead: false,
      hurtFlash: 0,
    };

    for (const s of ctx.layout.hostiles) this.spawnHostile(s.kind, s.pos, s.yaw, s.route);
    // Escorts reference spawn indices; map them to ids.
    ctx.layout.hostiles.forEach((s, i) => {
      if (s.escortOf !== undefined) this.hostiles[i]!.escortOf = this.hostiles[s.escortOf]!.id;
    });
    if (ctx.layout.haleIndex >= 0) this.haleId = this.hostiles[ctx.layout.haleIndex]!.id;

    ctx.layout.caches.forEach((cs, i) => this.caches.push({ id: i, pos: clone(cs.pos), opened: false, revealed: false }));
    this.intelPickup = ctx.layout.intel && ctx.areaIntel ? { pos: clone(ctx.layout.intel.pos), intel: ctx.areaIntel, taken: false } : null;
    this.exit = ctx.layout.exit ? { pos: clone(ctx.layout.exit), revealed: false, open: true } : null;
    for (const who of ['lucca', 'lucretia'] as const) {
      const spot = ctx.layout.castSpots[who];
      if (spot) this.npcs.push({ who, pos: clone(spot.pos), yaw: 0, state: 'idle' });
    }
    if (this.player.intel.has('halesSchedule') && this.haleId !== null) this.haleMarked = true;
    if (ctx.haleTaunt) this.emit({ type: 'haleBark', key: ctx.haleTaunt });
    this.physics.step();
  }

  private spawnHostile(kind: HostileKind, pos: V3, yaw: number, route: V3[]): Hostile {
    const id = this.nextId++;
    const ht = tuning.hostiles;
    const health = kind === 'legionary' ? ht.legionary.health : kind === 'trooper' ? ht.trooper.health : kind === 'escort' ? ht.escort.health : ht.hale.health;
    const speed = kind === 'legionary' ? ht.legionary.speed : kind === 'hale' ? ht.hale.speed : ht.trooper.speed;
    const body = this.physics.addCharacter(id, pos, ht.capsuleRadius, ht.capsuleHalfHeight);
    const h: Hostile = {
      id,
      kind,
      body,
      pos: clone(pos),
      prevPos: clone(pos),
      yaw,
      prevYaw: yaw,
      health,
      maxHealth: health,
      state: 'patrol',
      combat: 'none',
      combatFrames: 0,
      detection: 0,
      route: route.length ? route.map(clone) : [clone(pos)],
      routeIndex: 0,
      routeDir: 1,
      waitFrames: this.rng.int(0, 90),
      lookBase: yaw,
      lastKnown: null,
      unseenSec: 0,
      challengeLostSec: 0,
      attack: null,
      attackCooldown: 0,
      token: null,
      talkable: kind === 'legionary' || kind === 'trooper',
      talkedDown: false,
      escortOf: null,
      path: [],
      pathTarget: null,
      pathAge: 0,
      strafeSign: this.rng.chance(0.5) ? 1 : -1,
      strafeFrames: 0,
      speed,
      seesPlayer: false,
      barked: false,
      lowHealthBarked: false,
      deathFrame: 0,
      aimPoint: null,
    };
    this.hostiles.push(h);
    return h;
  }

  get timeSec(): number {
    return this.frame / tuning.sim.hz;
  }

  emit(e: SimEvent): void {
    this.events.push(e);
  }

  drainEvents(): SimEvent[] {
    return this.events.splice(0, this.events.length);
  }

  hostile(id: number | null): Hostile | null {
    if (id === null) return null;
    return this.hostiles.find((h) => h.id === id) ?? null;
  }

  get hale(): Hostile | null {
    return this.hostile(this.haleId);
  }

  // ------------------------------------------------------------ tick

  tick(input: InputFrame): void {
    if (this.finished) return;
    this.frame++;
    const p = this.player;
    p.prevPos = clone(p.pos);
    p.prevYaw = p.yaw;
    for (const h of this.hostiles) {
      h.prevPos = clone(h.pos);
      h.prevYaw = h.yaw;
    }
    updatePlayer(this, input);
    for (const h of this.hostiles) updateHostile(this, h);
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i]!;
      if (--s.framesLeft <= 0) this.smokes.splice(i, 1);
    }
    this.physics.step();
    if (!p.dead) p.pos = this.physics.feet(p.body);
    for (const h of this.hostiles) if (h.body) h.pos = this.physics.feet(h.body);
    this.refreshContext();
  }

  // ------------------------------------------------------------ perception

  private smokeBlocks(a: V3, b: V3): boolean {
    for (const s of this.smokes) {
      if (segmentHitsSphere(a, b, v3(s.pos.x, 1.3, s.pos.z), s.radius)) return true;
    }
    return false;
  }

  eye(h: Hostile): V3 {
    return v3(h.pos.x, tuning.hostiles.eyeHeight, h.pos.z);
  }

  /**
   * Can this hostile see the agent right now? Uses a cone in front of the
   * hostile, blocked by walls and smoke.
   */
  canSee(h: Hostile, coneDeg: number = tuning.hostiles.visionConeDeg, range: number = tuning.hostiles.visionRange): boolean {
    const p = this.player;
    if (p.dead || h.state === 'dead') return false;
    const d = distXZ(h.pos, p.pos);
    if (d > range) return false;
    if (coneDeg < 360) {
      const toward = yawTo(h.pos, p.pos);
      if (Math.abs(angleDiff(h.yaw, toward)) > (coneDeg * Math.PI) / 360) return false;
    }
    const eye = this.eye(h);
    for (const y of [1.6, 1.0]) {
      const target = v3(p.pos.x, y, p.pos.z);
      if (this.smokeBlocks(eye, target)) continue;
      if (this.physics.clearLine(eye, target)) return true;
    }
    return false;
  }

  /** Hostiles that would see something the agent does right now. */
  witnesses(exclude: number | null = null): Hostile[] {
    return this.hostiles.filter(
      (h) => h.id !== exclude && h.state !== 'dead' && h.state !== 'conversation' && h.combat !== 'grabbed' && this.canSee(h),
    );
  }

  // ------------------------------------------------------------ alerts

  /** Put a hostile into Alert, optionally pulling in others within 10 m. */
  alert(h: Hostile, known: V3, opts: { propagate?: boolean; force?: boolean } = {}): void {
    if (h.state === 'dead' || h.state === 'conversation') return;
    if (h.state === 'stoodDown' && !opts.force) return;
    const was = h.state;
    if (was === 'stoodDown' && h.body) this.physics.setPassThrough(h.body, false);
    h.state = 'alert';
    h.detection = 1;
    h.unseenSec = 0;
    h.lastKnown = clone(known);
    h.path = [];
    if (was !== 'alert') {
      this.emit({ type: 'alert', hostileId: h.id });
      if (h.kind === 'hale' && !h.barked) {
        h.barked = true;
        this.emit({ type: 'haleBark', key: 'combat' });
      }
    }
    if (opts.propagate !== false) {
      const r = tuning.hostiles.alertJoinRange;
      for (const o of this.hostiles) {
        if (o === h || o.state === 'alert' || o.state === 'dead' || o.state === 'stoodDown' || o.state === 'conversation') continue;
        if (distXZ(o.pos, h.pos) <= r) this.alert(o, known, { propagate: false });
      }
    }
  }

  applySuspicion(change: SuspicionChange): void {
    if (change.delta !== 0) this.emit({ type: 'suspicion', change });
    if (change.reachedMax) this.onMaxSuspicion();
  }

  /** At 100, every hostile in the area knows where the agent is and converges. */
  private onMaxSuspicion(): void {
    this.emit({ type: 'maxSuspicion' });
    this.emit({ type: 'message', text: 'Suspicion maxed: the whole area knows where you are.', tone: 'bad' });
    for (const h of this.hostiles) this.alert(h, this.player.pos, { propagate: false, force: true });
  }

  /** Loud gunfire: every hostile within 30 m goes to Alert. */
  loudNoise(at: V3): void {
    const r = tuning.hostiles.loudGunfireAlertRange;
    for (const h of this.hostiles) {
      if (h.state === 'dead' || h.state === 'stoodDown' || h.state === 'conversation') continue;
      if (distXZ(h.pos, at) <= r) this.alert(h, this.player.pos, { propagate: false });
    }
  }

  // ------------------------------------------------------------ damage

  get playerInvulnerable(): boolean {
    const a = this.player.action;
    const m = tuning.melee;
    if (this.godMode) return true;
    if (a.kind === 'dodge') return a.frame >= m.dodgeInvulnStart && a.frame <= m.dodgeInvulnEnd;
    if (a.kind === 'execution') return a.frame >= m.executionInvulnStart && a.frame <= m.executionInvulnEnd;
    return false;
  }

  /** A hostile's melee attack connects with the agent. */
  hostileMeleeHitsPlayer(h: Hostile, damage: number): void {
    const p = this.player;
    const outcome = resolveMeleeDefense({ parryFrame: p.parryFrame, blocking: p.blocking, invulnerable: this.playerInvulnerable });
    if (outcome === 'invulnerable') {
      this.emit({ type: 'impact', pos: clone(p.pos), kind: 'dodge' });
      return;
    }
    if (outcome === 'parried') {
      this.staggerHostile(h, tuning.melee.parryStagger);
      this.emit({ type: 'impact', pos: v3(p.pos.x, 1.3, p.pos.z), kind: 'parry' });
      this.emit({ type: 'message', text: 'Parry!', tone: 'good' });
      return;
    }
    const res = applyAgentDamage(p, damage, 'melee', outcome === 'blocked');
    this.emit({ type: 'impact', pos: v3(p.pos.x, 1.3, p.pos.z), kind: outcome === 'blocked' ? 'block' : 'melee' });
    if (outcome === 'hit') {
      p.hurtFlash = 12;
      if (p.action.kind === 'light' || p.action.kind === 'heavy' || p.action.kind === 'none') p.action = { kind: 'hitstun', frame: 0, duration: 14 };
    }
    if (res.dead) this.playerDown();
  }

  hostileGunHitsPlayer(damage: number): boolean {
    if (this.playerInvulnerable) return false;
    const res = applyAgentDamage(this.player, damage, 'gun');
    this.player.hurtFlash = 8;
    if (res.dead) this.playerDown();
    return true;
  }

  private playerDown(): void {
    const p = this.player;
    if (p.dead || this.godMode) {
      if (this.godMode) p.health = Math.max(1, p.health);
      return;
    }
    p.dead = true;
    p.health = 0;
    p.action = { kind: 'none' };
    this.emit({ type: 'playerDown' });
  }

  staggerHostile(h: Hostile, frames: number): void {
    if (h.state === 'dead') return;
    this.cancelAttack(h);
    h.combat = 'stagger';
    h.combatFrames = frames;
  }

  cancelAttack(h: Hostile): void {
    h.attack = null;
    h.aimPoint = null;
    if (h.token) {
      this.tokens[h.token].delete(h.id);
      h.token = null;
    }
  }

  /** Damage a hostile. Returns true if it died. */
  damageHostile(h: Hostile, amount: number, method: KillMethod, hitstun = 0): boolean {
    if (h.state === 'dead') return false;
    const res = applyHostileDamage(h, amount);
    if (res.dead) {
      this.killHostile(h, method);
      return true;
    }
    if (hitstun > 0 && h.combat !== 'knockdown' && h.combat !== 'grabbed') {
      if (tuning.hostiles.hitstunInterruptsAttack) this.cancelAttack(h);
      if (h.combat !== 'stagger' || h.combatFrames < hitstun) {
        h.combat = h.combat === 'stagger' ? 'stagger' : 'hitstun';
        h.combatFrames = Math.max(h.combatFrames, hitstun);
      }
    }
    if (h.state !== 'alert') this.alert(h, this.player.pos, { force: true });
    if (h.kind === 'hale' && !h.lowHealthBarked && h.health <= h.maxHealth * tuning.melee.haleExecuteHealthFraction) {
      h.lowHealthBarked = true;
      this.emit({ type: 'haleBark', key: 'lowHealth' });
    }
    return false;
  }

  killHostile(h: Hostile, method: KillMethod): void {
    if (h.state === 'dead') return;
    this.cancelAttack(h);
    h.state = 'dead';
    h.health = 0;
    h.combat = 'none';
    h.deathFrame = this.frame;
    if (h.body) {
      this.physics.removeCharacter(h.body);
      h.body = null;
    }
    if (this.player.lockTarget === h.id) this.player.lockTarget = null;
    this.stats.kills++;
    if (method === 'takedown') this.stats.takedowns++;
    if (method === 'execution') this.stats.executions++;
    this.emit({ type: 'kill', hostileId: h.id, method, kind: h.kind });
    if (h.id === this.haleId) {
      this.emit({ type: 'haleBark', key: 'defeated' });
      this.emit({ type: 'haleDown', method });
    }
  }

  /** Hostiles who see a Takedown or Execution go to Alert; suspicion doesn't rise. */
  witnessKill(victim: Hostile): void {
    for (const w of this.witnesses(victim.id)) {
      if (w.state === 'stoodDown') continue;
      this.alert(w, this.player.pos, { propagate: false });
      this.emit({ type: 'message', text: 'Someone saw that.', tone: 'warn' });
    }
  }

  // ------------------------------------------------------------ context & interaction

  /** Pick the B-button action and the interact prompt for the HUD and next tick. */
  refreshContext(): void {
    const p = this.player;
    p.context = { action: null, target: null };
    p.interact = null;
    if (p.dead) return;
    const order: Record<Exclude<ContextAction, null>, number> = { takedown: 0, execution: 1, throw: 2 };
    let best: { action: Exclude<ContextAction, null>; id: number; d: number } | null = null;
    for (const h of this.hostiles) {
      if (h.state === 'dead' || h.combat === 'grabbed') continue;
      const d = distXZ(h.pos, p.pos);
      if (d > tuning.melee.executionRange + 0.2) continue;
      const action = contextActionFor(
        {
          kind: h.kind,
          health: h.health,
          maxHealth: h.maxHealth,
          unaware: h.state === 'patrol' || h.state === 'stoodDown',
          staggered: h.combat === 'stagger',
          knockedDown: h.combat === 'knockdown',
        },
        d,
      );
      if (!action) continue;
      if (!best || order[action] < order[best.action] || (order[action] === order[best.action] && d < best.d)) best = { action, id: h.id, d };
    }
    if (best) p.context = { action: best.action, target: best.id };

    const range = tuning.player.interactRange;
    let candidate: { it: Interactable; d: number } | null = null;
    const offer = (it: Interactable, d: number) => {
      if (d <= range && (!candidate || d < candidate.d)) candidate = { it, d };
    };
    for (const n of this.npcs) {
      if (n.state === 'gone') continue;
      const name = n.who === 'lucca' ? 'Lucca' : 'Lucretia';
      if (n.state === 'idle') offer({ kind: 'npc', who: n.who, label: `Talk to ${name}` }, distXZ(n.pos, p.pos));
      else if (n.state === 'helped' && n.who === 'lucca') offer({ kind: 'npc', who: 'lucca', label: "Browse Lucca's stock" }, distXZ(n.pos, p.pos));
    }
    for (const h of this.hostiles) {
      if (h.state === 'patrol' && h.talkable && !h.talkedDown && h.combat === 'none') {
        offer({ kind: 'hostile', id: h.id, label: `Talk to ${h.kind === 'legionary' ? 'Legionary' : 'Trooper'}` }, distXZ(h.pos, p.pos));
      }
    }
    for (const c of this.caches) if (!c.opened) offer({ kind: 'cache', id: c.id, label: 'Search cache' }, distXZ(c.pos, p.pos));
    if (this.intelPickup && !this.intelPickup.taken) offer({ kind: 'intel', label: 'Take documents' }, distXZ(this.intelPickup.pos, p.pos));
    if (this.exit && this.exit.open) offer({ kind: 'exit', label: 'Leave area' }, distXZ(this.exit.pos, p.pos) - 1);
    p.interact = candidate ? (candidate as { it: Interactable }).it : null;
  }

  interact(): void {
    const it = this.player.interact;
    if (!it) return;
    switch (it.kind) {
      case 'npc': {
        const n = this.npcs.find((x) => x.who === it.who)!;
        if (n.state === 'helped' && n.who === 'lucca') this.emit({ type: 'shop', who: 'lucca' });
        else this.emit({ type: 'conversation', speaker: it.who });
        break;
      }
      case 'hostile': {
        const h = this.hostile(it.id);
        if (!h || (h.kind !== 'legionary' && h.kind !== 'trooper')) break;
        this.beginHostileConversation(h);
        break;
      }
      case 'cache': {
        const c = this.caches[it.id]!;
        if (c.opened) break;
        c.opened = true;
        c.revealed = true;
        const loot = rollCache(this.rng);
        this.applyLoot(loot);
        this.emit({ type: 'loot', cacheId: c.id, loot });
        break;
      }
      case 'intel': {
        const ip = this.intelPickup!;
        ip.taken = true;
        this.giveIntel(ip.intel);
        break;
      }
      case 'exit':
        this.emit({ type: 'exit' });
        break;
    }
  }

  beginHostileConversation(h: Hostile): void {
    if (h.kind !== 'legionary' && h.kind !== 'trooper') return;
    h.state = 'conversation';
    h.path = [];
    this.cancelAttack(h);
    h.yaw = yawTo(h.pos, this.player.pos);
    this.emit({ type: 'conversation', speaker: 'hostile', hostileId: h.id, kind: h.kind });
  }

  /** Cash is banked by the game layer; items and ammo apply here. */
  applyLoot(loot: CacheLoot): void {
    if (loot.kind === 'cash') return;
    this.addPickup(loot.item);
  }

  addPickup(item: 'medkit' | 'smoke' | 'ammo' | 'armorPlate'): void {
    const p = this.player;
    if (item === 'medkit') p.items.medkit++;
    else if (item === 'smoke') p.items.smoke++;
    else if (item === 'armorPlate') p.armor = Math.min(p.maxArmor, p.armor + tuning.armor.armorPlateRestore);
    else this.addAmmo(tuning.weapons.ammoPickupMagazines);
  }

  addAmmo(magazines: number): void {
    for (const w of this.player.weapons) w.reserve += tuning.weapons[w.id].magazine * magazines;
  }

  giveIntel(id: IntelId): void {
    this.player.intel.add(id);
    if (id === 'halesSchedule' && this.haleId !== null) this.haleMarked = true;
    this.emit({ type: 'intel', intel: id });
  }

  revealExit(): boolean {
    if (!this.exit || this.exit.revealed) return false;
    this.exit.revealed = true;
    return true;
  }

  revealCache(): boolean {
    const c = this.caches.find((x) => !x.opened && !x.revealed);
    if (!c) return false;
    c.revealed = true;
    return true;
  }

  revealAllCaches(): number {
    let n = 0;
    for (const c of this.caches) if (!c.opened && !c.revealed) {
      c.revealed = true;
      n++;
    }
    return n;
  }

  /** Resolve a conversation with a Legionary or Trooper. */
  endHostileConversation(id: number, success: boolean): void {
    const h = this.hostile(id);
    if (!h || h.state === 'dead') return;
    if (success) {
      h.state = 'stoodDown';
      h.talkedDown = true;
      h.detection = 0;
      h.waitFrames = 90;
      // They step aside: don't let a crowd of stood-down hostiles wall the agent in.
      if (h.body) this.physics.setPassThrough(h.body, true);
    } else {
      h.state = 'patrol'; // so alert() treats it as a fresh escalation
      this.alert(h, this.player.pos, { force: true });
    }
  }

  npc(who: NpcWho): Npc | null {
    return this.npcs.find((n) => n.who === who) ?? null;
  }

  spawnSmoke(pos: V3): void {
    const total = Math.round(tuning.items.smokeDurationSec * tuning.sim.hz);
    this.smokes.push({ pos: clone(pos), radius: tuning.items.smokeRadius, framesLeft: total, total });
    this.emit({ type: 'smoke', pos: clone(pos) });
  }

  /** Snapshot what the agent carries into the next area. */
  carry(): PlayerCarry {
    const p = this.player;
    return {
      health: p.health,
      maxHealth: p.maxHealth,
      armor: p.armor,
      maxArmor: p.maxArmor,
      weapons: p.weapons.map((w) => ({ ...w })),
      items: { ...p.items },
      hasJammer: p.hasJammer,
      intel: [...p.intel],
    };
  }

  dispose(): void {
    this.physics.dispose();
  }
}
