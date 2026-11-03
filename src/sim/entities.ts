import type { IntelId } from '../content/dialogue/types';
import type { V3 } from '../core/vec';
import type { WeaponId } from '../data/tuning';
import type { ContextAction, HostileKind } from './damage';
import type { CharBody } from './physics';

/** Simulation state. Plain data; presentation reads it, never writes it. */

export interface WeaponSlot {
  id: WeaponId;
  mag: number;
  reserve: number;
}

export type PlayerAction =
  | { kind: 'none' }
  | { kind: 'light'; step: number; frame: number; target: number | null; hit: boolean; queued: boolean; pbFired: boolean; pbAt: number }
  | { kind: 'heavy'; frame: number; target: number | null; hit: boolean; pbFired: boolean; pbAt: number }
  | { kind: 'dodge'; frame: number; dir: V3 }
  | { kind: 'takedown'; frame: number; target: number }
  | { kind: 'execution'; frame: number; target: number }
  | { kind: 'throw'; frame: number; target: number; dir: V3; from: V3 }
  | { kind: 'hitstun'; frame: number; duration: number };

export type ItemSlot = 'medkit' | 'smoke' | 'jammer';

export interface Player {
  id: number;
  body: CharBody;
  pos: V3;
  prevPos: V3;
  yaw: number;
  prevYaw: number;
  viewYaw: number;
  viewPitch: number;
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  action: PlayerAction;
  speed: number;
  sprinting: boolean;
  aiming: boolean;
  blocking: boolean;
  /** Frames since block was pressed while a parry window is open, else -1. */
  parryFrame: number;
  parryLockout: number;
  weapons: WeaponSlot[];
  slot: number;
  fireCooldown: number;
  reload: number;
  swap: number;
  lockTarget: number | null;
  items: { medkit: number; smoke: number };
  hasJammer: boolean;
  selectedItem: number;
  useHeldFrames: number;
  intel: Set<IntelId>;
  context: { action: ContextAction; target: number | null };
  interact: Interactable | null;
  /** Melee target chosen for the current strike, for HUD. */
  meleeTarget: number | null;
  lastShotFrame: number;
  dead: boolean;
  /** Recent hit flash for presentation (frames remaining). */
  hurtFlash: number;
}

export type HostileState = 'patrol' | 'challenge' | 'conversation' | 'alert' | 'stoodDown' | 'dead';
export type HostileCombat = 'none' | 'hitstun' | 'stagger' | 'knockdown' | 'grabbed';

export interface HostileAttack {
  kind: 'melee' | 'ranged';
  frame: number;
  shots: number;
  hit: boolean;
}

export interface Hostile {
  id: number;
  kind: HostileKind;
  body: CharBody | null;
  pos: V3;
  prevPos: V3;
  yaw: number;
  prevYaw: number;
  health: number;
  maxHealth: number;
  state: HostileState;
  combat: HostileCombat;
  combatFrames: number;
  /** 0..1 spotting progress while in Patrol. */
  detection: number;
  route: V3[];
  routeIndex: number;
  routeDir: 1 | -1;
  waitFrames: number;
  lookBase: number;
  lastKnown: V3 | null;
  unseenSec: number;
  challengeLostSec: number;
  attack: HostileAttack | null;
  attackCooldown: number;
  token: 'melee' | 'ranged' | null;
  talkable: boolean;
  talkedDown: boolean;
  escortOf: number | null;
  path: V3[];
  pathTarget: V3 | null;
  pathAge: number;
  strafeSign: 1 | -1;
  strafeFrames: number;
  speed: number;
  /** Seconds since this hostile last saw the agent (for HUD indicators). */
  seesPlayer: boolean;
  /** Has spoken their first combat bark (Hale). */
  barked: boolean;
  lowHealthBarked: boolean;
  deathFrame: number;
  aimPoint: V3 | null;
}

export type NpcWho = 'lucca' | 'lucretia';

export interface Npc {
  who: NpcWho;
  pos: V3;
  yaw: number;
  /** 'idle' until talked to; 'helped' after success; 'done' after rebuff; 'gone' after failure. */
  state: 'idle' | 'helped' | 'done' | 'gone';
}

export interface Cache {
  id: number;
  pos: V3;
  opened: boolean;
  revealed: boolean;
}

export interface IntelPickup {
  pos: V3;
  intel: IntelId;
  taken: boolean;
}

export interface Smoke {
  pos: V3;
  radius: number;
  framesLeft: number;
  total: number;
}

export type Interactable =
  | { kind: 'npc'; who: NpcWho; label: string }
  | { kind: 'hostile'; id: number; label: string }
  | { kind: 'cache'; id: number; label: string }
  | { kind: 'intel'; label: string }
  | { kind: 'exit'; label: string };
