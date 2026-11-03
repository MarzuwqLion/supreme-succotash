import { emptyFrame, type InputFrame } from '../src/input/input';
import { v3, type V3 } from '../src/core/vec';
import type { AreaLayout, Cell, HostileSpawn } from '../src/sim/gen/layout';
import { initPhysics } from '../src/sim/physics';
import { SimWorld, type AreaContext, type PlayerCarry } from '../src/sim/world';
import type { HostileKind } from '../src/sim/damage';
import { tuning } from '../src/data/tuning';

/** An open 72 m square (all piazza, fully connected) for deterministic sim tests. */
export function openLayout(hostiles: { kind: HostileKind; pos: V3; yaw: number; route?: V3[]; escortOf?: number }[], opts: Partial<AreaLayout> = {}): AreaLayout {
  const n = 6;
  const cells: Cell[] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) cells.push({ i, j, type: 'piazza', conn: [j > 0, i < n - 1, j < n - 1, i > 0] });
  const spawns: HostileSpawn[] = hostiles.map((h) => ({ kind: h.kind, pos: h.pos, yaw: h.yaw, route: h.route ?? [h.pos], escortOf: h.escortOf }));
  return {
    type: 'porto',
    index: 0,
    seed: 1,
    gridSize: n,
    blockSize: 12,
    cells,
    boxes: [],
    entrance: v3(6, 0, 6),
    entranceYaw: 0,
    exit: v3(66, 0, 66),
    pathCells: [0],
    hostiles: spawns,
    caches: [{ pos: v3(10, 0, 6), cell: 0 }],
    intel: null,
    castSpots: { lucca: null, lucretia: null },
    haleIndex: hostiles.findIndex((h) => h.kind === 'hale'),
    keepCells: [],
    ...opts,
  };
}

export function carry(over: Partial<PlayerCarry> = {}): PlayerCarry {
  const w = tuning.weapons;
  return {
    health: 100,
    maxHealth: 100,
    armor: 50,
    maxArmor: 50,
    weapons: [{ id: 'pistol', mag: w.pistol.magazine, reserve: w.pistol.reserve }],
    items: { medkit: 0, smoke: 0 },
    hasJammer: false,
    intel: [],
    ...over,
  };
}

export async function makeWorld(layout: AreaLayout, ctx: Partial<AreaContext> = {}): Promise<SimWorld> {
  const R = await initPhysics();
  return new SimWorld(R, { layout, areaIndex: 0, runSeed: 7, carry: carry(), coverIdentity: false, areaIntel: null, haleTaunt: null, ...ctx });
}

export function frame(mut: (f: InputFrame) => void = () => {}): InputFrame {
  const f = emptyFrame();
  mut(f);
  return f;
}

export const press = (...actions: (keyof InputFrame['pressed'])[]) =>
  frame((f) => {
    for (const a of actions) {
      f.pressed[a] = true;
      f.held[a] = true;
    }
  });

export const hold = (...actions: (keyof InputFrame['held'])[]) =>
  frame((f) => {
    for (const a of actions) f.held[a] = true;
  });

export function run(w: SimWorld, frames: number, f: () => InputFrame = () => frame()): void {
  for (let i = 0; i < frames; i++) w.tick(f());
}
