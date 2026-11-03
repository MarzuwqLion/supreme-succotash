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

export type CellType = 'building' | 'street' | 'alley' | 'courtyard' | 'piazza';

/** N = -z, E = +x, S = +z, W = -x. */
export type Dir = 0 | 1 | 2 | 3;
export const DIRS: readonly { di: number; dj: number }[] = [
  { di: 0, dj: -1 },
  { di: 1, dj: 0 },
  { di: 0, dj: 1 },
  { di: -1, dj: 0 },
];
export const opposite = (d: Dir): Dir => ((d + 2) % 4) as Dir;

export interface Cell {
  i: number;
  j: number;
  type: CellType;
  /** Open connections to neighbours, indexed by Dir. */
  conn: [boolean, boolean, boolean, boolean];
  tag?: 'entrance' | 'exit' | 'keep';
}

export interface Box {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  kind: 'building' | 'mass' | 'wall' | 'prop' | 'perimeter';
}

export interface HostileSpawn {
  kind: HostileKind;
  pos: V3;
  yaw: number;
  route: V3[];
  /** Index (into hostiles) of the hostile this one escorts. */
  escortOf?: number;
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
  entrance: V3;
  entranceYaw: number;
  exit: V3 | null;
  /** Guaranteed path from entrance to exit (or to Hale's keep), as cell indices. */
  pathCells: number[];
  hostiles: HostileSpawn[];
  caches: PointSpawn[];
  intel: PointSpawn | null;
  castSpots: { lucca: PointSpawn | null; lucretia: PointSpawn | null };
  haleIndex: number;
  keepCells: number[];
}
