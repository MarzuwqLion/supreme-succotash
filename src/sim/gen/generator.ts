import { Rng, hashSeed } from '../../core/rng';
import { v3, type V3 } from '../../core/vec';
import { tuning } from '../../data/tuning';
import type { HostileKind } from '../damage';
import {
  DIRS,
  opposite,
  type AreaLayout,
  type AreaType,
  type Box,
  type Cell,
  type CellType,
  type Dir,
  type HostileSpawn,
  type PointSpawn,
} from './layout';

/**
 * Seeded generator. Builds an area on a 6 x 6 grid of 12 m blocks from
 * street, alley, courtyard, and piazza pieces (plus solid buildings), keeps
 * entrance and exit at least 50 m apart with a guaranteed path, and places
 * hostiles, caches, intel, and cast spots. Same options -> same layout.
 */

export interface GenOptions {
  type: AreaType;
  index: number;
  seed: number;
  luccaPresent?: boolean;
  lucretiaPresent?: boolean;
  /** Hale's grudge escorts (Castel only). */
  extraEscorts?: number;
}

const N = () => tuning.gen.gridSize;
const B = () => tuning.gen.blockSize;
const idx = (i: number, j: number) => j * N() + i;
const inBounds = (i: number, j: number) => i >= 0 && j >= 0 && i < N() && j < N();
export const cellCenter = (c: { i: number; j: number }): V3 => v3((c.i + 0.5) * B(), 0, (c.j + 0.5) * B());

function makeGrid(): Cell[] {
  const cells: Cell[] = [];
  for (let j = 0; j < N(); j++) for (let i = 0; i < N(); i++) cells.push({ i, j, type: 'building', conn: [false, false, false, false] });
  return cells;
}

function neighbor(cells: Cell[], c: Cell, d: Dir): Cell | null {
  const { di, dj } = DIRS[d]!;
  const ni = c.i + di;
  const nj = c.j + dj;
  return inBounds(ni, nj) ? cells[idx(ni, nj)]! : null;
}

function connect(cells: Cell[], a: Cell, d: Dir): void {
  const b = neighbor(cells, a, d);
  if (!b) return;
  a.conn[d] = true;
  b.conn[opposite(d)] = true;
}

const walkable = (c: Cell) => c.type !== 'building';
const connCount = (c: Cell) => c.conn.filter(Boolean).length;

/** BFS over open connections. Returns the cell path (indices) or null. */
export function findCellPath(cells: Cell[], from: number, to: number): number[] | null {
  const prev = new Map<number, number>();
  const q = [from];
  prev.set(from, -1);
  while (q.length) {
    const cur = q.shift()!;
    if (cur === to) break;
    const c = cells[cur]!;
    for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
      if (!c.conn[d]) continue;
      const n = neighbor(cells, c, d);
      if (!n || !walkable(n)) continue;
      const ni = idx(n.i, n.j);
      if (prev.has(ni)) continue;
      prev.set(ni, cur);
      q.push(ni);
    }
  }
  if (!prev.has(to)) return null;
  const path: number[] = [];
  for (let cur = to; cur !== -1; cur = prev.get(cur)!) path.push(cur);
  return path.reverse();
}

function reachable(cells: Cell[], from: number): Set<number> {
  const seen = new Set<number>([from]);
  const q = [from];
  while (q.length) {
    const c = cells[q.shift()!]!;
    for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
      if (!c.conn[d]) continue;
      const n = neighbor(cells, c, d);
      if (!n || !walkable(n)) continue;
      const ni = idx(n.i, n.j);
      if (!seen.has(ni)) {
        seen.add(ni);
        q.push(ni);
      }
    }
  }
  return seen;
}

/** Carve a wandering but monotone-ish alley path so a route always exists. */
function carvePath(cells: Cell[], rng: Rng, from: Cell, to: Cell): void {
  let cur = from;
  let guard = 0;
  while ((cur.i !== to.i || cur.j !== to.j) && guard++ < 100) {
    const options: Dir[] = [];
    if (to.i > cur.i) options.push(1);
    if (to.i < cur.i) options.push(3);
    if (to.j > cur.j) options.push(2);
    if (to.j < cur.j) options.push(0);
    const d = rng.pick(options);
    const next = neighbor(cells, cur, d)!;
    if (!walkable(next)) next.type = 'alley';
    connect(cells, cur, d);
    cur = next;
  }
}

// ---------------------------------------------------------------- styles

interface StyleResult {
  entrance: Cell;
  exit: Cell | null;
  keep: Cell[];
}

function stylePorto(cells: Cell[], rng: Rng): StyleResult {
  // Open docks: mostly open quays, a dock road, a few warehouses.
  const road = rng.int(2, 3);
  for (const c of cells) {
    if (c.j === road) c.type = 'street';
    else c.type = rng.chance(0.2) ? 'building' : 'piazza';
  }
  // Long sightlines: open every pair of adjacent walkable cells.
  for (const c of cells) {
    if (!walkable(c)) continue;
    for (const d of [1, 2] as Dir[]) {
      const n = neighbor(cells, c, d);
      if (n && walkable(n)) connect(cells, c, d);
    }
  }
  const entrance = cells[idx(0, rng.int(0, N() - 1))]!;
  const exit = cells[idx(N() - 1, rng.int(0, N() - 1))]!;
  entrance.type = entrance.type === 'building' ? 'piazza' : entrance.type;
  exit.type = exit.type === 'building' ? 'piazza' : exit.type;
  return { entrance, exit, keep: [] };
}

function styleSpaccanapoli(cells: Cell[], rng: Rng): StyleResult {
  // One long street with side passages.
  const row = rng.int(1, N() - 2);
  for (let i = 0; i < N(); i++) {
    const c = cells[idx(i, row)]!;
    c.type = 'street';
    if (i < N() - 1) connect(cells, c, 1);
  }
  const piazzaAt = rng.int(1, N() - 2);
  if (rng.chance(0.75)) cells[idx(piazzaAt, row)]!.type = 'piazza';
  // Side passages north and south, sometimes ending in a courtyard.
  for (let i = 0; i < N(); i++) {
    for (const d of [0, 2] as Dir[]) {
      if (!rng.chance(0.5)) continue;
      const depth = rng.int(1, 2);
      let cur = cells[idx(i, row)]!;
      for (let k = 0; k < depth; k++) {
        const n = neighbor(cells, cur, d);
        if (!n) break;
        if (n.type === 'building') n.type = k === depth - 1 && rng.chance(0.45) ? 'courtyard' : 'alley';
        connect(cells, cur, d);
        cur = n;
      }
    }
  }
  // A back lane links some side passages so there is a way around the main street.
  for (const lane of [row - 2, row + 2]) {
    if (lane < 0 || lane >= N() || !rng.chance(0.7)) continue;
    for (let i = 0; i < N() - 1; i++) {
      const a = cells[idx(i, lane)]!;
      const b = cells[idx(i + 1, lane)]!;
      if (walkable(a) && walkable(b) && rng.chance(0.8)) connect(cells, a, 1);
      else if (walkable(a) && !walkable(b) && rng.chance(0.35)) {
        b.type = 'alley';
        connect(cells, a, 1);
      }
    }
  }
  return { entrance: cells[idx(0, row)]!, exit: cells[idx(N() - 1, row)]!, keep: [] };
}

function styleQuartieri(cells: Cell[], rng: Rng): StyleResult {
  // Tight alleys and courtyards: a randomized maze with a few loops.
  for (const c of cells) c.type = 'alley';
  const start = cells[idx(0, rng.int(0, N() - 1))]!;
  const stack: Cell[] = [start];
  const visited = new Set<Cell>([start]);
  while (stack.length) {
    const cur = stack[stack.length - 1]!;
    const options = ([0, 1, 2, 3] as Dir[]).filter((d) => {
      const n = neighbor(cells, cur, d);
      return n && !visited.has(n);
    });
    if (!options.length) {
      stack.pop();
      continue;
    }
    const d = rng.pick(options);
    const n = neighbor(cells, cur, d)!;
    connect(cells, cur, d);
    visited.add(n);
    stack.push(n);
  }
  // Loops so it isn't a pure tree.
  for (const c of cells) {
    for (const d of [1, 2] as Dir[]) {
      if (!c.conn[d] && neighbor(cells, c, d) && rng.chance(0.14)) connect(cells, c, d);
    }
  }
  const exit = cells[idx(N() - 1, rng.int(0, N() - 1))]!;
  // Dead ends become courtyards; one small piazza somewhere central.
  for (const c of cells) {
    if (c === start || c === exit) continue;
    if (connCount(c) === 1 && rng.chance(0.55)) c.type = 'courtyard';
  }
  const pz = cells[idx(rng.int(2, 3), rng.int(2, 3))]!;
  if (pz !== start && pz !== exit) pz.type = 'piazza';
  return { entrance: start, exit, keep: [] };
}

function styleCastel(cells: Cell[], rng: Rng): StyleResult {
  // Walled compound: ring road, central parade ground, barracks courtyards,
  // gate on the south wall, Hale's keep on the north side.
  const last = N() - 1;
  for (const c of cells) {
    const ring = c.i >= 1 && c.i <= last - 1 && c.j >= 1 && c.j <= last - 1 && (c.i === 1 || c.i === last - 1 || c.j === 1 || c.j === last - 1);
    const center = c.i >= 2 && c.i <= last - 2 && c.j >= 2 && c.j <= last - 2;
    if (ring) c.type = rng.chance(0.3) ? 'alley' : 'street';
    else if (center) c.type = 'piazza';
  }
  // Ring connections.
  for (const c of cells) {
    if (c.type !== 'street' && c.type !== 'alley') continue;
    for (const d of [1, 2] as Dir[]) {
      const n = neighbor(cells, c, d);
      if (n && (n.type === 'street' || n.type === 'alley')) connect(cells, c, d);
    }
  }
  // Parade ground is open inside, linked to the ring at 2-3 points.
  for (const c of cells) {
    if (c.type !== 'piazza') continue;
    for (const d of [0, 1, 2, 3] as Dir[]) {
      const n = neighbor(cells, c, d);
      if (n && n.type === 'piazza') connect(cells, c, d);
    }
  }
  const centerCells = cells.filter((c) => c.type === 'piazza');
  const ringLinks = rng.int(2, 3);
  const edgeLinks: [Cell, Dir][] = [];
  for (const c of centerCells) {
    for (const d of [0, 1, 2, 3] as Dir[]) {
      const n = neighbor(cells, c, d);
      if (n && (n.type === 'street' || n.type === 'alley')) edgeLinks.push([c, d]);
    }
  }
  rng.shuffle(edgeLinks);
  for (let k = 0; k < ringLinks && k < edgeLinks.length; k++) connect(cells, edgeLinks[k]![0], edgeLinks[k]![1]);
  // Gate.
  const gateI = rng.int(2, last - 2);
  const gate = cells[idx(gateI, last)]!;
  gate.type = 'street';
  connect(cells, gate, 0);
  // Keep: two piazza cells on the north edge linked to the ring at one point.
  const keepI = rng.int(1, last - 2);
  const keepA = cells[idx(keepI, 0)]!;
  const keepB = cells[idx(keepI + 1, 0)]!;
  for (const k of [keepA, keepB]) {
    k.type = 'courtyard';
    k.tag = 'keep';
  }
  connect(cells, keepA, 1);
  connect(cells, rng.chance(0.5) ? keepA : keepB, 2);
  // Barracks courtyards on the outer ring of cells.
  for (const c of cells) {
    if (c.type !== 'building' || c.j === 0) continue;
    if (!(c.i === 0 || c.i === last || c.j === last)) continue;
    if (!rng.chance(0.3)) continue;
    const inward = ([0, 1, 2, 3] as Dir[]).filter((d) => {
      const n = neighbor(cells, c, d);
      return n && (n.type === 'street' || n.type === 'alley');
    });
    if (!inward.length) continue;
    c.type = 'courtyard';
    connect(cells, c, rng.pick(inward));
  }
  return { entrance: gate, exit: null, keep: [keepA, keepB] };
}

// ---------------------------------------------------------------- geometry

function buildGeometry(cells: Cell[], rng: Rng, type: AreaType, reserved: V3[]): Box[] {
  const g = tuning.gen;
  const size = B();
  const half = size / 2;
  const boxes: Box[] = [];
  const total = N() * size;
  const wallH = type === 'castel' ? g.wallHeight + 3 : g.wallHeight;
  const height = () => rng.range(g.buildingHeightMin, g.buildingHeightMax);
  const addBox = (minX: number, maxX: number, minZ: number, maxZ: number, h: number, kind: Box['kind']) => {
    if (maxX - minX < 0.05 || maxZ - minZ < 0.05) return;
    boxes.push({ x: (minX + maxX) / 2, y: h / 2, z: (minZ + maxZ) / 2, hx: (maxX - minX) / 2, hy: h / 2, hz: (maxZ - minZ) / 2, kind });
  };
  const nearReserved = (x: number, z: number, r: number) => reserved.some((p) => Math.hypot(p.x - x, p.z - z) < r);

  // Perimeter.
  const t = 1;
  const perimH = type === 'castel' ? wallH + 2 : wallH + 4;
  addBox(-t, total + t, -t, 0, perimH, 'perimeter');
  addBox(-t, total + t, total, total + t, perimH, 'perimeter');
  addBox(-t, 0, 0, total, perimH, 'perimeter');
  addBox(total, total + t, 0, total, perimH, 'perimeter');

  for (const c of cells) {
    const cx = (c.i + 0.5) * size;
    const cz = (c.j + 0.5) * size;
    const x0 = cx - half;
    const x1 = cx + half;
    const z0 = cz - half;
    const z1 = cz + half;
    if (c.type === 'building') {
      addBox(x0, x1, z0, z1, type === 'castel' ? wallH + rng.range(0, 4) : height(), 'building');
      continue;
    }
    if (c.type === 'street' || c.type === 'alley') {
      const w = c.type === 'street' ? g.streetWidth : g.alleyWidth;
      const hw = w / 2;
      const hMass = type === 'castel' ? wallH : height();
      // Four corner masses.
      addBox(x0, cx - hw, z0, cz - hw, hMass, 'mass');
      addBox(cx + hw, x1, z0, cz - hw, hMass, 'mass');
      addBox(x0, cx - hw, cz + hw, z1, hMass, 'mass');
      addBox(cx + hw, x1, cz + hw, z1, hMass, 'mass');
      // Close arms that don't connect.
      if (!c.conn[0]) addBox(cx - hw, cx + hw, z0, cz - hw, hMass, 'mass');
      if (!c.conn[2]) addBox(cx - hw, cx + hw, cz + hw, z1, hMass, 'mass');
      if (!c.conn[3]) addBox(x0, cx - hw, cz - hw, cz + hw, hMass, 'mass');
      if (!c.conn[1]) addBox(cx + hw, x1, cz - hw, cz + hw, hMass, 'mass');
      // Street cover: parked cars beside the lanes, off the centre line.
      if (c.type === 'street') {
        for (const d of [0, 1, 2, 3] as Dir[]) {
          if (!c.conn[d] || !rng.chance(0.45)) continue;
          const side = rng.chance(0.5) ? 1 : -1;
          const along = 3.6;
          if (d === 0 || d === 2) {
            const z = cz + (d === 0 ? -along : along);
            const x = cx + side * 2.6;
            if (!nearReserved(x, z, 2.2)) addBox(x - 0.9, x + 0.9, z - 2.0, z + 2.0, 1.5, 'prop');
          } else {
            const x = cx + (d === 3 ? -along : along);
            const z = cz + side * 2.6;
            if (!nearReserved(x, z, 2.2)) addBox(x - 2.0, x + 2.0, z - 0.9, z + 0.9, 1.5, 'prop');
          }
        }
      }
      continue;
    }
    if (c.type === 'courtyard') {
      const th = 0.6;
      const door = 4;
      const wall = (d: Dir) => {
        const open = c.conn[d];
        if (d === 0 || d === 2) {
          const z = d === 0 ? z0 : z1 - th;
          if (open) {
            addBox(x0, cx - door / 2, z, z + th, wallH, 'wall');
            addBox(cx + door / 2, x1, z, z + th, wallH, 'wall');
          } else addBox(x0, x1, z, z + th, wallH, 'wall');
        } else {
          const x = d === 3 ? x0 : x1 - th;
          if (open) {
            addBox(x, x + th, z0 + th, cz - door / 2, wallH, 'wall');
            addBox(x, x + th, cz + door / 2, z1 - th, wallH, 'wall');
          } else addBox(x, x + th, z0 + th, z1 - th, wallH, 'wall');
        }
      };
      for (const d of [0, 1, 2, 3] as Dir[]) wall(d);
      // Cover at the corners (keeps the centre lines clear for navigation).
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        if (!rng.chance(0.5)) continue;
        const x = cx + sx * 3.4;
        const z = cz + sz * 3.4;
        if (nearReserved(x, z, 2.0)) continue;
        const h = rng.chance(0.5) ? 1.1 : 2.2;
        addBox(x - 0.8, x + 0.8, z - 0.8, z + 0.8, h, 'prop');
      }
      continue;
    }
    // Piazza: open, with walls only where it meets an unconnected walkable cell.
    for (const d of [0, 1, 2, 3] as Dir[]) {
      if (c.conn[d]) continue;
      const n = neighbor(cells, c, d);
      if (!n || n.type === 'building') continue;
      if (n.type === 'piazza' && n.conn[opposite(d)]) continue;
      const th = 0.5;
      if (d === 0) addBox(x0, x1, z0, z0 + th, wallH * 0.6, 'wall');
      if (d === 2) addBox(x0, x1, z1 - th, z1, wallH * 0.6, 'wall');
      if (d === 3) addBox(x0, x0 + th, z0, z1, wallH * 0.6, 'wall');
      if (d === 1) addBox(x1 - th, x1, z0, z1, wallH * 0.6, 'wall');
    }
    const quads = rng.shuffle([[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]);
    const props = type === 'porto' ? rng.int(2, 3) : rng.int(1, 2);
    for (let k = 0; k < props; k++) {
      const [sx, sz] = quads[k]!;
      const x = cx + sx * 3.2;
      const z = cz + sz * 3.2;
      if (nearReserved(x, z, 2.4)) continue;
      if (type === 'porto') {
        // Container stacks: tall enough to break sightlines.
        const long = rng.chance(0.5);
        const hx = long ? 1.6 : 1.2;
        const hz = long ? 1.2 : 1.6;
        addBox(x - hx, x + hx, z - hz, z + hz, rng.chance(0.6) ? 2.6 : 5.2, 'prop');
      } else {
        addBox(x - 1.0, x + 1.0, z - 1.0, z + 1.0, rng.chance(0.5) ? 1.2 : 2.6, 'prop');
      }
    }
  }
  return boxes;
}

// ---------------------------------------------------------------- placement

/** A side spot inside a cell that is off the navigation centre lines. */
function sideSpot(c: Cell, rng: Rng): V3 {
  const ctr = cellCenter(c);
  if (c.type === 'street' || c.type === 'alley') {
    const w = c.type === 'street' ? tuning.gen.streetWidth : tuning.gen.alleyWidth;
    const closed = ([0, 1, 2, 3] as Dir[]).filter((d) => !c.conn[d]);
    if (!closed.length) {
      // Crossroads: tuck into a corner of the centre square, off both lanes.
      const o = w / 2 - 0.6;
      return v3(ctr.x + (rng.chance(0.5) ? o : -o), 0, ctr.z + (rng.chance(0.5) ? o : -o));
    }
    const d = rng.pick(closed);
    const off = w / 2 - 0.7;
    return v3(ctr.x + DIRS[d]!.di * off, 0, ctr.z + DIRS[d]!.dj * off);
  }
  const sx = rng.chance(0.5) ? 1 : -1;
  const sz = rng.chance(0.5) ? 1 : -1;
  return v3(ctr.x + sx * 4.2, 0, ctr.z + sz * 4.2);
}

function routeFrom(cells: Cell[], start: Cell, rng: Rng, maxCells: number): V3[] {
  const route: V3[] = [cellCenter(start)];
  let cur = start;
  const used = new Set<Cell>([start]);
  const len = rng.int(0, maxCells - 1);
  for (let k = 0; k < len; k++) {
    const options = ([0, 1, 2, 3] as Dir[]).filter((d) => {
      if (!cur.conn[d]) return false;
      const n = neighbor(cells, cur, d);
      return n && walkable(n) && !used.has(n) && n.tag !== 'keep';
    });
    if (!options.length) break;
    cur = neighbor(cells, cur, rng.pick(options))!;
    used.add(cur);
    route.push(cellCenter(cur));
  }
  return route;
}

function hostileKindFor(type: AreaType, rng: Rng): HostileKind {
  switch (type) {
    case 'porto':
    case 'quartieri':
      return rng.chance(0.8) ? 'legionary' : 'trooper';
    case 'spaccanapoli':
      return rng.chance(0.5) ? 'legionary' : 'trooper';
    case 'castel':
      return rng.chance(0.8) ? 'trooper' : 'legionary';
  }
}

export function generateArea(opts: GenOptions): AreaLayout {
  const g = tuning.gen;
  const seed = hashSeed(opts.seed, opts.type, opts.index);
  const rng = new Rng(seed);
  const layoutRng = rng.fork('layout');
  const placeRng = rng.fork('place');
  const geoRng = rng.fork('geometry');

  let cells = makeGrid();
  let style: StyleResult;
  let attempts = 0;
  for (;;) {
    cells = makeGrid();
    style =
      opts.type === 'porto'
        ? stylePorto(cells, layoutRng)
        : opts.type === 'spaccanapoli'
          ? styleSpaccanapoli(cells, layoutRng)
          : opts.type === 'quartieri'
            ? styleQuartieri(cells, layoutRng)
            : styleCastel(cells, layoutRng);
    const goal = style.exit ?? style.keep[0]!;
    const d = Math.hypot((style.entrance.i - goal.i) * B(), (style.entrance.j - goal.j) * B());
    if (d >= g.minEntranceExitDistance || attempts++ > 20) break;
  }
  const entrance = style.entrance;
  const goal = style.exit ?? style.keep[0]!;
  entrance.tag = 'entrance';
  if (style.exit) style.exit.tag = 'exit';
  if (entrance.type === 'building') entrance.type = 'alley';
  if (goal.type === 'building') goal.type = 'alley';

  // Guarantee a path, then drop anything the entrance can't reach.
  const ei = idx(entrance.i, entrance.j);
  const gi = idx(goal.i, goal.j);
  if (!findCellPath(cells, ei, gi)) carvePath(cells, layoutRng, entrance, goal);
  const reach = reachable(cells, ei);
  for (const c of cells) {
    const ci = idx(c.i, c.j);
    if (walkable(c) && !reach.has(ci)) {
      c.type = 'building';
      c.conn = [false, false, false, false];
    }
  }
  // Clear connections that point at buildings (keeps geometry consistent).
  for (const c of cells) {
    for (const d of [0, 1, 2, 3] as Dir[]) {
      const n = neighbor(cells, c, d);
      if (c.conn[d] && (!n || !walkable(n) || !walkable(c))) c.conn[d] = false;
    }
  }
  const pathCells = findCellPath(cells, ei, gi) ?? [ei];

  // ---- placement
  const entrancePos = cellCenter(entrance);
  const exitPos = style.exit ? cellCenter(style.exit) : null;
  const walkCells = cells.filter(walkable);
  const pathSet = new Set(pathCells);
  const farFromEntrance = (c: Cell) => Math.hypot(cellCenter(c).x - entrancePos.x, cellCenter(c).z - entrancePos.z) >= 20;

  // Caches prefer dead ends, courtyards, and piazzas off the main path.
  const cacheCandidates = placeRng.shuffle(
    walkCells.filter((c) => c !== entrance && c.tag !== 'exit' && c.tag !== 'keep'),
  );
  cacheCandidates.sort((a, b) => {
    const score = (c: Cell) => (connCount(c) === 1 ? 2 : 0) + (c.type === 'courtyard' ? 1.5 : 0) + (pathSet.has(idx(c.i, c.j)) ? -1 : 1);
    return score(b) - score(a);
  });
  const nCaches = placeRng.int(g.cachesMin, g.cachesMax);
  const usedCells = new Set<Cell>();
  const caches: PointSpawn[] = [];
  for (const c of cacheCandidates) {
    if (caches.length >= nCaches) break;
    if (usedCells.has(c)) continue;
    usedCells.add(c);
    caches.push({ pos: sideSpot(c, placeRng), cell: idx(c.i, c.j) });
  }
  // Fallback: if the area is tiny, reuse cells.
  for (let k = 0; caches.length < nCaches && k < 20; k++) {
    const c = placeRng.pick(walkCells);
    caches.push({ pos: sideSpot(c, placeRng), cell: idx(c.i, c.j) });
  }

  const pickFree = (pred: (c: Cell) => boolean): Cell | null => {
    const opts2 = placeRng.shuffle(walkCells.filter((c) => !usedCells.has(c) && pred(c)));
    const c = opts2[0] ?? placeRng.shuffle(walkCells.filter(pred))[0] ?? null;
    if (c) usedCells.add(c);
    return c;
  };

  let intel: PointSpawn | null = null;
  if (opts.type !== 'castel') {
    const c = pickFree((c) => c !== entrance && c.tag !== 'exit');
    if (c) intel = { pos: sideSpot(c, placeRng), cell: idx(c.i, c.j) };
  }
  const castSpot = (present: boolean | undefined): PointSpawn | null => {
    if (!present) return null;
    const c = pickFree((c) => c !== entrance && c.tag !== 'exit' && c.tag !== 'keep');
    return c ? { pos: sideSpot(c, placeRng), cell: idx(c.i, c.j) } : null;
  };
  const lucca = castSpot(opts.luccaPresent);
  const lucretia = castSpot(opts.lucretiaPresent);

  // Hostiles.
  const hostiles: HostileSpawn[] = [];
  let haleIndex = -1;
  const isCastel = opts.type === 'castel';
  const total = isCastel ? placeRng.int(g.hostilesMinArea3, g.hostilesMaxArea3) : placeRng.int(g.hostilesMinArea12, g.hostilesMaxArea12);
  if (isCastel) {
    const keep = style.keep;
    const halePos = cellCenter(keep[0]!);
    haleIndex = 0;
    hostiles.push({
      kind: 'hale',
      pos: halePos,
      yaw: 0,
      route: keep.map(cellCenter),
    });
    const escorts = g.baseEscorts + Math.max(0, Math.min(g.maxGrudgeEscorts, opts.extraEscorts ?? 0));
    for (let k = 0; k < escorts; k++) {
      const ang = (k / escorts) * Math.PI * 2;
      hostiles.push({
        kind: 'escort',
        pos: v3(halePos.x + Math.cos(ang) * 1.8, 0, halePos.z + Math.sin(ang) * 1.8),
        yaw: 0,
        route: [],
        escortOf: 0,
      });
    }
  }
  const regulars = isCastel ? Math.max(0, total - 1 - g.baseEscorts) : total;
  const spawnCells = placeRng.shuffle(walkCells.filter((c) => farFromEntrance(c) && c.tag !== 'keep'));
  const perCell = new Map<Cell, number>();
  for (let k = 0; k < regulars && spawnCells.length; k++) {
    // Round-robin over cells so hostiles spread out; at most 2 per cell.
    let c: Cell | undefined;
    for (let tries = 0; tries < spawnCells.length; tries++) {
      const cand = spawnCells[(k + tries) % spawnCells.length]!;
      if ((perCell.get(cand) ?? 0) < 2) {
        c = cand;
        break;
      }
    }
    if (!c) break;
    perCell.set(c, (perCell.get(c) ?? 0) + 1);
    const route = routeFrom(cells, c, placeRng, opts.type === 'quartieri' ? 2 : 3);
    const start = route[0]!;
    const jitter = (perCell.get(c) ?? 1) > 1 ? 1.2 : 0;
    hostiles.push({
      kind: hostileKindFor(opts.type, placeRng),
      pos: v3(start.x + jitter, 0, start.z + jitter),
      yaw: placeRng.range(-Math.PI, Math.PI),
      route,
    });
  }

  const reserved: V3[] = [...caches.map((c) => c.pos), entrancePos];
  if (exitPos) reserved.push(exitPos);
  if (intel) reserved.push(intel.pos);
  if (lucca) reserved.push(lucca.pos);
  if (lucretia) reserved.push(lucretia.pos);
  const boxes = buildGeometry(cells, geoRng, opts.type, reserved);

  // Face into the area from the entrance.
  const firstStep = pathCells[1] !== undefined ? cells[pathCells[1]]! : null;
  const entranceYaw = firstStep ? Math.atan2(firstStep.i - entrance.i, firstStep.j - entrance.j) : 0;

  return {
    type: opts.type,
    index: opts.index,
    seed,
    gridSize: N(),
    blockSize: B(),
    cells,
    boxes,
    entrance: entrancePos,
    entranceYaw,
    exit: exitPos,
    pathCells,
    hostiles,
    caches,
    intel,
    castSpots: { lucca, lucretia },
    haleIndex,
    keepCells: style.keep.map((c) => idx(c.i, c.j)),
  };
}

// ---------------------------------------------------------------- run plan

export interface RunPlan {
  seed: number;
  areaTypes: [AreaType, AreaType, AreaType];
}

/** Areas 1 and 2 are drawn from Porto, Spaccanapoli, and Quartieri; Area 3 is always the Castel garrison. */
export function planRun(seed: number): RunPlan {
  const rng = new Rng(hashSeed(seed, 'plan'));
  const pool: AreaType[] = rng.shuffle(['porto', 'spaccanapoli', 'quartieri']);
  return { seed, areaTypes: [pool[0]!, pool[1]!, 'castel'] };
}

/**
 * Lucca and Lucretia each have a 50% chance per area; if one hasn't appeared
 * by Area 2 they're guaranteed there. They don't appear in the Castel.
 */
export function castAppears(seed: number, who: 'lucca' | 'lucretia', areaIndex: number, seenEarlier: boolean): boolean {
  if (areaIndex >= 2) return false;
  if (areaIndex === 1 && !seenEarlier) return true;
  return new Rng(hashSeed(seed, who, areaIndex)).chance(tuning.gen.castAppearChance);
}

export { idx as cellIndex };
export type { CellType };
