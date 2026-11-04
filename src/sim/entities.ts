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

/** Agent in cover: hugging a wall (high) or crouched behind something low. */
export interface CoverState {
  /** Surface normal, pointing out of the cover toward the agent. */
  normal: V3;
  low: boolean;
  /** -1 / +1 when at the left / right end of the cover, else 0. */
  edge: -1 | 0 | 1;
  /** 0..1: how far the agent has popped up (low) or leaned out (high) to shoot. */
  expose: number;
  /** Frames the stick has been held away from the cover. */
  pullAway: number;
  /** Frames since entering (used to slide into place). */
  frames: number;
  /** Where the agent is snapping to. */
  snap: V3 | null;
  /** Metres leaned out past a high-cover edge (along the cover). */
  lean: number;
}

export type CameraStyle = 'classic' | 'shoulder';

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
  cover: CoverState | null;
  /** A cover surface within reach, for the HUD prompt. */
  coverHint: { low: boolean } | null;
  /** Crouched behind low cover (smaller silhouette). */
  crouched: boolean;
  /** Third-person style; 'shoulder' is the over-the-shoulder shooter camera. */
  viewStyle: CameraStyle;
  /** Which shoulder the shoulder camera sits over (1 = right). */
  shoulder: 1 | -1;
  /** In a conversation (the world keeps running; the agent stands still). */
  talking: boolean;
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

export type CivilianState = 'wander' | 'idle' | 'flee' | 'cower';

/** Ambient city dweller. Never hostile, never blocks anyone, can be talked to. */
export interface Civilian {
  id: number;
  body: CharBody;
  pos: V3;
  prevPos: V3;
  yaw: number;
  prevYaw: number;
  state: CivilianState;
  /** Stays near home (sitting, chatting) instead of wandering. */
  idle: boolean;
  home: V3;
  path: V3[];
  target: V3 | null;
  pathAge: number;
  /** Frames to wait (wander pause) or to stay hidden (cower). */
  timer: number;
  speed: number;
  look: number;
  rumor: boolean;
  talked: boolean;
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
  | { kind: 'civilian'; id: number; label: string }
  | { kind: 'exit'; label: string };
