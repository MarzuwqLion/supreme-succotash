import type { V3 } from '../../core/vec';
import type { HostileKind } from '../damage';

/** Data produced by the generator. Pure data, consumed by sim and presentation. */

export type AreaType = 'porto' | 'spaccanapoli' | 'quartieri' | 'castel';
export const AREA_NAMES: Record<AreaType, string> = {
  porto: 'Porto',
  spaccanapoli: 'Spaccanapoli',
  quartieri: 'Quartieri',
  castel: 'Castel garrison',
};

/**
 * Doc pieces (street, alley, courtyard, piazza) plus solid buildings and a
 * canal piece for riverwalks.
 */
export type CellType = 'building' | 'street' | 'alley' | 'courtyard' | 'piazza' | 'canal';

/** N = -z, E = +x, S = +z, W = -x. */
export type Dir = 0 | 1 | 2 | 3;
export const DIRS: readonly { di: number; dj: number }[] = [
  { di: 0, dj: -1 },
  { di: 1, dj: 0 },
  { di: 0, dj: 1 },
  { di: -1, dj: 0 },
];
export const opposite = (d: Dir): Dir => ((d + 2) % 4) as Dir;

export type BuildingStyle = 'palazzo' | 'tower' | 'warehouse' | 'fortress' | 'mass';

export interface Cell {
  i: number;
  j: number;
  type: CellType;
  /** Open connections to neighbours, indexed by Dir. */
  conn: [boolean, boolean, boolean, boolean];
  tag?: 'entrance' | 'exit' | 'keep' | 'quay';
  /** Canal direction ('x' runs east-west). */
  axis?: 'x' | 'z';
  style?: BuildingStyle;
  /** Sides (Dir) with an elevated promenade deck along them. */
  decks?: Dir[];
  /** Canal cells: a bridge crosses here. */
  bridge?: boolean;
  /** Piazza with a central fountain. */
  fountain?: boolean;
}

/**
 * How a box looks. Collision ignores this; presentation uses it to pick
 * materials and add detail.
 */
export type BoxLook =
  | 'palazzo'
  | 'tower'
  | 'podium'
  | 'warehouse'
  | 'fortress'
  | 'attic'
  | 'cornice'
  | 'marble'
  | 'deck'
  | 'step'
  | 'parapet'
  | 'planter'
  | 'hedge'
  | 'crate'
  | 'bench'
  | 'basin'
  | 'column'
  | 'bollard'
  | 'perimeter'
  | 'sea'
  | 'none';

export interface Box {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  look: BoxLook;
  /** Collides (default true). */
  solid?: boolean;
  /** Drawn (default true). */
  visible?: boolean;
  /** Vertical cylinder of radius hx (collision and drawing). */
  cylinder?: boolean;
  /** Tilted slab for stairs: rotation about the x or z axis in radians. */
  tilt?: { axis: 'x' | 'z'; angle: number };
  /** Colour variation seed for presentation. */
  tint?: number;
}

export type DecorKind =
  | 'column'
  | 'rose'
  | 'cypress'
  | 'tree'
  | 'lamp'
  | 'statue'
  | 'dome'
  | 'drum'
  | 'water'
  | 'channel'
  | 'jet'
  | 'arch'
  | 'flag'
  | 'balusters'
  | 'boat'
  | 'crane'
  | 'obelisk'
  | 'merlons'
  | 'gate'
  | 'awning';

/** Visual-only detail. Sizes are in metres; `yaw` rotates about +Y. */
export interface Decor {
  kind: DecorKind;
  x: number;
  y: number;
  z: number;
  /** Width / radius. */
  w: number;
  /** Height. */
  h: number;
  /** Depth (for boxes like arches, water, balusters). */
  d?: number;
  yaw?: number;
  tint?: number;
}

export interface NavGraph {
  /** Node positions (feet height). */
  nodes: V3[];
  /** Adjacency lists. */
  links: number[][];
}

export interface HostileSpawn {
  kind: HostileKind;
  pos: V3;
  yaw: number;
  route: V3[];
  /** Index (into hostiles) of the hostile this one escorts. */
  escortOf?: number;
}

export interface CivilianSpawn {
  pos: V3;
  yaw: number;
  /** Appearance seed. */
  look: number;
  /** Knows about a stash and will mention it when talked to. */
  rumor: boolean;
  /** Stays put (sitting or chatting) instead of wandering. */
  idle: boolean;
}

export interface PointSpawn {
  pos: V3;
  cell: number;
}

export interface AreaLayout {
  type: AreaType;
  index: number;
  seed: number;
  gridSize: number;
  blockSize: number;
  cells: Cell[];
  boxes: Box[];
  decor: Decor[];
  nav: NavGraph;
  entrance: V3;
  entranceYaw: number;
  exit: V3 | null;
  /** Guaranteed path from entrance to exit (or to Hale's keep), as cell indices. */
  pathCells: number[];
  hostiles: HostileSpawn[];
  civilians: CivilianSpawn[];
  caches: PointSpawn[];
  intel: PointSpawn | null;
  castSpots: { lucca: PointSpawn | null; lucretia: PointSpawn | null };
  haleIndex: number;
  keepCells: number[];
}
