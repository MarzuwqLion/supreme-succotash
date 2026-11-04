import { Rng, hashSeed } from '../../core/rng';
import { v3, type V3 } from '../../core/vec';
import { tuning } from '../../data/tuning';
import type { HostileKind } from '../damage';
import {
  Builder,
  buildAlley,
  buildBuilding,
  buildCanal,
  buildCourtyard,
  buildPerimeter,
  buildPiazza,
  buildStreet,
  stairPlan,
  type DeckPlan,
  type NodeHint,
  type OpenCellPlan,
} from './build';
import {
  ALL_DIRS,
  blockS,
  carvePath,
  cellCenter,
  connCount,
  connect,
  findCellPath,
  gridN,
  idx,
  isOpen,
  makeGrid,
  neighbor,
  reachableCells,
  walkable,
} from './grid';
import { opposite, type AreaLayout, type AreaType, type Cell, type CivilianSpawn, type Dir, type HostileSpawn, type PointSpawn } from './layout';
import { buildNavGraph, NavChecker, nearestNode, pruneGraph, reachableNodes, type NavBuildResult } from './navbuild';

/**
 * Seeded generator for an expansive marble Napoli. Areas are a 6 x 6 grid of
 * blocks built from street, alley, courtyard, and piazza pieces (plus
 * buildings and riverwalk canals), with elevated promenades, stairs, and
 * bridges. The entrance and exit are at least 50 m apart with a guaranteed
 * path. Same options -> same layout.
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

export { cellCenter, findCellPath, idx as cellIndex };

const S = () => blockS();
const N = () => gridN();

// ---------------------------------------------------------------- styles

interface StyleResult {
  entrance: Cell;
  exit: Cell | null;
  keep: Cell[];
}

function connectOpenNeighbours(cells: Cell[], filter: (a: Cell, b: Cell, d: Dir) => boolean = () => true): void {
  for (const c of cells) {
    if (!walkable(c)) continue;
    for (const d of [1, 2] as Dir[]) {
      const n = neighbor(cells, c, d);
      if (n && walkable(n) && filter(c, n, d)) connect(cells, c, d);
    }
  }
}

/** Canal cells link along their axis to canal cells, and sideways to anything walkable. */
function canalFilter(a: Cell, b: Cell, d: Dir): boolean {
  const along = (c: Cell, dd: Dir) => (c.axis === 'x' ? dd === 1 || dd === 3 : dd === 0 || dd === 2);
  if (a.type === 'canal' && along(a, d)) return b.type === 'canal' && b.axis === a.axis;
  if (b.type === 'canal' && along(b, opposite(d))) return a.type === 'canal' && a.axis === b.axis;
  return true;
}

function stylePorto(cells: Cell[], rng: Rng): StyleResult {
  const canal = rng.int(1, N() - 2);
  for (const c of cells) {
    if (c.i === canal) {
      c.type = 'canal';
      c.axis = 'z';
    } else if (c.j === 0) {
      c.type = 'piazza';
      c.tag = 'quay';
    } else c.type = rng.chance(0.28) ? 'building' : rng.chance(0.6) ? 'piazza' : 'street';
  }
  connectOpenNeighbours(cells, canalFilter);
  const canals = cells.filter((c) => c.type === 'canal');
  for (const c of canals) c.bridge = c.j > 0 && rng.chance(tuning.gen.canalBridgeChance);
  // At least two crossings, one of them in the city half.
  const inner = canals.filter((c) => c.j >= 1 && c.j <= 3);
  rng.pick(inner).bridge = true;
  rng.pick(canals.filter((c) => c.j >= 1)).bridge = true;
  const ei = rng.pick([...Array(N()).keys()].filter((i) => i !== canal));
  const entrance = cells[idx(ei, N() - 1)]!;
  const exit = cells[idx(rng.pick([0, N() - 1]), rng.int(0, 2))]!;
  for (const c of [entrance, exit]) if (c.type === 'building') c.type = 'street';
  return { entrance, exit, keep: [] };
}

function styleSpaccanapoli(cells: Cell[], rng: Rng): StyleResult {
  const row = rng.int(1, N() - 2);
  for (let i = 0; i < N(); i++) cells[idx(i, row)]!.type = 'street';
  const piazzaAt = rng.int(1, N() - 2);
  cells[idx(piazzaAt, row)]!.type = 'piazza';
  let canalRow = -1;
  if (rng.chance(0.45)) {
    const options = [row - 2, row + 2].filter((r) => r >= 0 && r < N());
    if (options.length) {
      canalRow = rng.pick(options);
      for (let i = 0; i < N(); i++) {
        const c = cells[idx(i, canalRow)]!;
        c.type = 'canal';
        c.axis = 'x';
        c.bridge = rng.chance(tuning.gen.canalBridgeChance);
      }
      cells[idx(rng.int(1, N() - 2), canalRow)]!.bridge = true;
    }
  }
  for (let i = 0; i < N() - 1; i++) connect(cells, cells[idx(i, row)]!, 1);
  // Side passages north and south, ending in courtyards or small piazzas.
  for (let i = 0; i < N(); i++) {
    for (const d of [0, 2] as Dir[]) {
      if (!rng.chance(0.75)) continue;
      const depth = rng.int(1, 3);
      let cur = cells[idx(i, row)]!;
      for (let k = 0; k < depth; k++) {
        const n = neighbor(cells, cur, d);
        if (!n) break;
        if (n.type === 'canal') {
          connect(cells, cur, d);
          break;
        }
        if (n.type === 'building') n.type = k === depth - 1 ? (rng.chance(0.4) ? 'courtyard' : rng.chance(0.55) ? 'piazza' : 'alley') : rng.chance(0.3) ? 'street' : 'alley';
        connect(cells, cur, d);
        cur = n;
      }
    }
  }
  // Canal promenades connect to whatever touches them.
  if (canalRow >= 0) {
    for (let i = 0; i < N() - 1; i++) connect(cells, cells[idx(i, canalRow)]!, 1);
    for (let i = 0; i < N(); i++) {
      const c = cells[idx(i, canalRow)]!;
      for (const d of [0, 2] as Dir[]) {
        const n = neighbor(cells, c, d);
        if (n && walkable(n) && n.type !== 'canal') connect(cells, c, d);
      }
    }
  }
  // A back lane links some passages so there is a way around the boulevard.
  for (const lane of [row - 2, row + 2]) {
    if (lane < 0 || lane >= N() || lane === canalRow || !rng.chance(0.7)) continue;
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
  for (const c of cells) c.type = 'alley';
  const start = cells[idx(0, rng.int(0, N() - 1))]!;
  const stack: Cell[] = [start];
  const visited = new Set<Cell>([start]);
  while (stack.length) {
    const cur = stack[stack.length - 1]!;
    const options = ALL_DIRS.filter((d) => {
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
  for (const c of cells) {
    for (const d of [1, 2] as Dir[]) {
      if (!c.conn[d] && neighbor(cells, c, d) && rng.chance(0.16)) connect(cells, c, d);
    }
  }
  const exit = cells[idx(N() - 1, rng.int(0, N() - 1))]!;
  for (const c of cells) {
    if (c === start || c === exit) continue;
    if (connCount(c) === 1 && rng.chance(0.6)) c.type = 'courtyard';
  }
  // A small piazza (two cells when possible) where the lanes open up.
  const pi = rng.int(1, N() - 3);
  const pj = rng.int(1, N() - 2);
  for (const c of [cells[idx(pi, pj)]!, cells[idx(pi + 1, pj)]!]) {
    if (c !== start && c !== exit) c.type = 'piazza';
  }
  const a = cells[idx(pi, pj)]!;
  if (a.type === 'piazza' && cells[idx(pi + 1, pj)]!.type === 'piazza') connect(cells, a, 1);
  return { entrance: start, exit, keep: [] };
}

function styleCastel(cells: Cell[], rng: Rng): StyleResult {
  const last = N() - 1;
  const keepI = rng.int(1, last - 2);
  for (const c of cells) {
    const outer = c.i === 0 || c.j === 0 || c.i === last || c.j === last;
    const center = c.i >= 2 && c.i <= last - 2 && c.j >= 2 && c.j <= last - 2;
    if (outer) c.type = 'street';
    else if (center) c.type = 'piazza';
    else {
      c.type = 'building';
      c.style = rng.chance(0.7) ? 'fortress' : 'palazzo';
    }
  }
  const keepA = cells[idx(keepI, 0)]!;
  const keepB = cells[idx(keepI + 1, 0)]!;
  for (const k of [keepA, keepB]) {
    k.type = 'courtyard';
    k.tag = 'keep';
  }
  // Bailey ring along the walls.
  for (const c of cells) {
    if (!(c.i === 0 || c.j === 0 || c.i === last || c.j === last)) continue;
    for (const d of [1, 2] as Dir[]) {
      const n = neighbor(cells, c, d);
      if (n && walkable(n) && (n.i === 0 || n.j === 0 || n.i === last || n.j === last)) connect(cells, c, d);
    }
  }
  // Parade ground.
  for (const c of cells) {
    if (c.type !== 'piazza') continue;
    for (const d of [1, 2] as Dir[]) {
      const n = neighbor(cells, c, d);
      if (n && n.type === 'piazza') connect(cells, c, d);
    }
  }
  cells[idx(2, 2)]!.fountain = true; // the monument
  // Passages through the inner ring: gate side, keep side, and one or two more.
  const gateI = rng.int(2, last - 2);
  const passage = (i: number, j: number, d: Dir) => {
    const c = cells[idx(i, j)]!;
    c.type = 'street';
    c.style = undefined;
    connect(cells, c, d);
    connect(cells, c, opposite(d));
  };
  passage(gateI, last - 1, 2);
  passage(rng.pick([keepI, keepI + 1].filter((i) => i >= 2 && i <= last - 2).concat([2])), 1, 0);
  if (rng.chance(0.7)) passage(1, rng.int(2, last - 2), 3);
  if (rng.chance(0.7)) passage(last - 1, rng.int(2, last - 2), 1);
  return { entrance: cells[idx(gateI, last)]!, exit: null, keep: [keepA, keepB] };
}

// ---------------------------------------------------------------- plans

function assignStyles(cells: Cell[], type: AreaType, rng: Rng, entrance: Cell, exit: Cell | null): void {
  for (const c of cells) {
    if (c.type === 'building' && !c.style) {
      if (type === 'porto') c.style = rng.chance(0.55) ? 'warehouse' : rng.chance(0.8) ? 'palazzo' : 'tower';
      else if (type === 'spaccanapoli') c.style = rng.chance(0.75) ? 'palazzo' : 'tower';
      else if (type === 'castel') c.style = rng.chance(0.7) ? 'fortress' : 'palazzo';
      else c.style = 'palazzo';
    }
    if (c.type === 'piazza' && c.tag !== 'quay' && c !== entrance && c !== exit && type !== 'castel') {
      const nb = ALL_DIRS.some((d) => neighbor(cells, c, d)?.fountain);
      c.fountain = !nb && rng.chance(tuning.gen.fountainChance);
    }
    if (c === entrance || c === exit) c.fountain = false;
  }
}

const deckSideAllowed = (cells: Cell[], c: Cell, d: Dir): boolean => {
  if (!isOpen(c) || c.conn[d]) return false;
  if (c.type === 'canal' && ((c.axis === 'x' && (d === 1 || d === 3)) || (c.axis === 'z' && (d === 0 || d === 2)))) return false;
  if (c.tag === 'quay' && d === 0) return false;
  const n = neighbor(cells, c, d);
  return !n || n.type === 'building';
};

/** Decide elevated promenades, stairs, and bridges for every open cell. */
function planDecks(cells: Cell[], type: AreaType, rng: Rng, noDecks: boolean): Map<number, OpenCellPlan> {
  const plans = new Map<number, OpenCellPlan>();
  for (const c of cells) if (isOpen(c)) plans.set(idx(c.i, c.j), { decks: [], bridge: null });
  if (noDecks) return plans;
  const chance = tuning.gen.deckChance[type];
  const has = (c: Cell | null, d: Dir) => !!c && !!plans.get(idx(c.i, c.j))?.decks.some((p) => p.side === d);
  for (const c of cells) {
    if (!isOpen(c)) continue;
    for (const d of ALL_DIRS) {
      if (!deckSideAllowed(cells, c, d)) continue;
      const prev = neighbor(cells, c, d === 0 || d === 2 ? 3 : 0);
      const p = has(prev, d) ? Math.min(0.95, chance * 1.6) : chance;
      if (rng.chance(p)) plans.get(idx(c.i, c.j))!.decks.push({ side: d, stair: null, contStart: false, contEnd: false, trimStart: false, trimEnd: false, bridgeGap: null });
    }
  }
  // Continuity and corner trims.
  for (const c of cells) {
    const plan = plans.get(idx(c.i, c.j));
    if (!plan) continue;
    for (const dp of plan.decks) {
      const alongX = dp.side === 0 || dp.side === 2;
      const startN = neighbor(cells, c, alongX ? 3 : 0);
      const endN = neighbor(cells, c, alongX ? 1 : 2);
      dp.contStart = has(startN, dp.side);
      dp.contEnd = has(endN, dp.side);
      dp.trimStart = plan.decks.some((o) => o.side === (alongX ? 3 : 0));
      dp.trimEnd = plan.decks.some((o) => o.side === (alongX ? 1 : 2));
    }
  }
  // Runs of decks along a line: each needs at least one stair.
  const runs: { cell: Cell; deck: DeckPlan }[][] = [];
  const seen = new Set<DeckPlan>();
  for (const c of cells) {
    const plan = plans.get(idx(c.i, c.j));
    if (!plan) continue;
    for (const dp of plan.decks) {
      if (seen.has(dp) || dp.contStart) continue;
      const run: { cell: Cell; deck: DeckPlan }[] = [];
      let cur: Cell | null = c;
      let curDeck: DeckPlan | undefined = dp;
      while (cur && curDeck) {
        seen.add(curDeck);
        run.push({ cell: cur, deck: curDeck });
        if (!curDeck.contEnd) break;
        cur = neighbor(cells, cur, curDeck.side === 0 || curDeck.side === 2 ? 1 : 2);
        curDeck = cur ? plans.get(idx(cur.i, cur.j))?.decks.find((o) => o.side === dp.side) : undefined;
      }
      runs.push(run);
    }
  }
  const stairCells = new Set<number>();
  for (const run of runs) {
    let placed = 0;
    run.forEach((r, k) => {
      if (k % 3 !== 0 && placed > 0) return;
      const ci = idx(r.cell.i, r.cell.j);
      if (stairCells.has(ci)) return;
      const dir: 1 | -1 | null = !r.deck.trimStart ? 1 : !r.deck.trimEnd ? -1 : null;
      if (dir === null) return;
      r.deck.stair = stairPlan(dir);
      stairCells.add(ci);
      placed++;
    });
    if (!placed) for (const r of run) plans.get(idx(r.cell.i, r.cell.j))!.decks = plans.get(idx(r.cell.i, r.cell.j))!.decks.filter((o) => o !== r.deck);
  }
  // Bridges across streets and piazzas with decks on opposite sides.
  for (const c of cells) {
    if (c.type !== 'street' && c.type !== 'piazza') continue;
    const plan = plans.get(idx(c.i, c.j))!;
    for (const [a, b] of [
      [0, 2],
      [3, 1],
    ] as [Dir, Dir][]) {
      const da = plan.decks.find((p) => p.side === a);
      const db = plan.decks.find((p) => p.side === b);
      if (!da || !db || !rng.chance(tuning.gen.bridgeChance)) continue;
      const stairs = [da.stair, db.stair].filter((x): x is NonNullable<typeof x> => !!x);
      const gap = ([[4, 8], [-8, -4]] as [number, number][]).find(([g0, g1]) => stairs.every((s) => g1 <= s.u0 || g0 >= s.u1));
      if (!gap) continue;
      da.bridgeGap = gap;
      db.bridgeGap = gap;
      plan.bridge = { side: a, gap };
      break;
    }
  }
  return plans;
}

// ---------------------------------------------------------------- build

interface Built {
  builder: Builder;
  nav: NavBuildResult;
  entranceNode: number;
  goalNode: number;
}

function buildAll(cells: Cell[], type: AreaType, seed: number, style: StyleResult, plans: Map<number, OpenCellPlan>, noProps: boolean): Built | null {
  const b = new Builder(new Rng(hashSeed(seed, 'geometry')), type);
  const deckedFacing = (c: Cell, d: Dir) => {
    const n = neighbor(cells, c, d);
    return !!n && !!plans.get(idx(n.i, n.j))?.decks.some((p) => p.side === opposite(d));
  };
  for (const c of cells) {
    const ci = idx(c.i, c.j);
    const plan = plans.get(ci) ?? { decks: [], bridge: null };
    switch (c.type) {
      case 'building':
        buildBuilding(b, cells, c, ci, (d) => deckedFacing(c, d));
        break;
      case 'street':
        buildStreet(b, cells, c, ci, plan);
        break;
      case 'piazza':
        buildPiazza(b, cells, c, ci, plan);
        break;
      case 'courtyard':
        buildCourtyard(b, cells, c, ci);
        break;
      case 'alley':
        buildAlley(b, cells, c, ci);
        break;
      case 'canal':
        buildCanal(b, cells, c, ci, plan);
        break;
    }
  }
  const gates: { cell: Cell; side: Dir }[] = [];
  for (const c of [style.entrance, style.exit].filter((x): x is Cell => !!x)) {
    const side = ALL_DIRS.find((d) => !neighbor(cells, c, d));
    if (side !== undefined && !(type === 'porto' && side === 0)) gates.push({ cell: c, side });
  }
  buildPerimeter(b, type, gates);
  if (noProps) {
    const drop = new Set(['planter', 'crate', 'bench', 'bollard']);
    for (let k = b.boxes.length - 1; k >= 0; k--) if (drop.has(b.boxes[k]!.look)) b.boxes.splice(k, 1);
  }
  const extent = N() * S();
  const raw = buildNavGraph({ boxes: b.boxes, hints: b.nodes, ramps: b.ramps, surfaces: b.surfaces, voids: b.voids, groundBridges: b.groundBridges, extent });
  const ec = cellCenter(style.entrance);
  const e = nearestNode(raw, ec, 0.5);
  if (e < 0) return null;
  const reach = reachableNodes(raw, e);
  const nav = pruneGraph(raw, reach);
  const entranceNode = nearestNode(nav, ec, 0.5);
  const goalCell = style.exit ?? style.keep[0]!;
  const gc = cellCenter(goalCell);
  const goalNode = nearestNode(nav, gc, 0.5);
  if (goalNode < 0) return null;
  // The goal must actually be inside its cell, not just "nearest".
  const gn = nav.nodes[goalNode]!;
  if (Math.hypot(gn.x - gc.x, gn.z - gc.z) > S() * 0.6) return null;
  return { builder: b, nav, entranceNode, goalNode };
}

// ---------------------------------------------------------------- placement

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

/** Random walk over the graph on one level, for patrol routes. */
function routeFrom(nav: NavBuildResult, start: number, rng: Rng, steps: number, avoid: Set<number>): V3[] {
  const route = [nav.nodes[start]!];
  let cur = start;
  const used = new Set([start]);
  for (let k = 0; k < steps; k++) {
    const options = nav.links[cur]!.filter((n) => !used.has(n) && !avoid.has(n) && Math.abs(nav.nodes[n]!.y - nav.nodes[cur]!.y) < 0.3 && Math.hypot(nav.nodes[n]!.x - nav.nodes[cur]!.x, nav.nodes[n]!.z - nav.nodes[cur]!.z) > 4);
    if (!options.length) break;
    cur = rng.pick(options);
    used.add(cur);
    route.push(nav.nodes[cur]!);
  }
  return route;
}

export function generateArea(opts: GenOptions): AreaLayout {
  const g = tuning.gen;
  const seed = hashSeed(opts.seed, opts.type, opts.index);
  let built: Built | null = null;
  let cells: Cell[] = [];
  let style!: StyleResult;
  let pathCells: number[] = [];
  for (let attempt = 0; attempt < 6 && !built; attempt++) {
    const layoutRng = new Rng(hashSeed(seed, 'layout', attempt));
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
    const ec = cellCenter(style.entrance);
    const gc = cellCenter(goal);
    if (Math.hypot(ec.x - gc.x, ec.z - gc.z) < g.minEntranceExitDistance) continue;
    style.entrance.tag = style.entrance.tag ?? 'entrance';
    if (style.exit) style.exit.tag = 'exit';
    for (const c of [style.entrance, goal]) if (c.type === 'canal' || c.type === 'building') c.type = 'street';
    const ei = idx(style.entrance.i, style.entrance.j);
    const gi = idx(goal.i, goal.j);
    if (!findCellPath(cells, ei, gi)) carvePath(cells, layoutRng, style.entrance, goal);
    const reach = reachableCells(cells, ei);
    for (const c of cells) {
      if (walkable(c) && !reach.has(idx(c.i, c.j))) {
        c.type = 'building';
        c.conn = [false, false, false, false];
        c.bridge = false;
      }
    }
    for (const c of cells) {
      for (const d of ALL_DIRS) {
        const n = neighbor(cells, c, d);
        if (c.conn[d] && (!n || !walkable(n) || !walkable(c))) c.conn[d] = false;
      }
    }
    // Later attempts get more forgiving: every canal crossing bridged, then no decks, then no props.
    if (attempt >= 1) for (const c of cells) if (c.type === 'canal') c.bridge = true;
    assignStyles(cells, opts.type, layoutRng, style.entrance, style.exit);
    pathCells = findCellPath(cells, ei, gi) ?? [ei];
    const plans = planDecks(cells, opts.type, layoutRng, attempt >= 3);
    built = buildAll(cells, opts.type, seed, style, plans, attempt >= 4);
  }
  if (!built) throw new Error(`generator failed for ${opts.type} seed ${opts.seed}`);
  const { builder, nav, entranceNode, goalNode } = built;
  const placeRng = new Rng(hashSeed(seed, 'place'));
  const extent = N() * S();
  const checker = new NavChecker({ boxes: builder.boxes, hints: [], ramps: [], surfaces: builder.surfaces, voids: builder.voids, groundBridges: builder.groundBridges, extent });
  const entrancePos = { ...nav.nodes[entranceNode]! };
  const exitPos = style.exit ? { ...nav.nodes[goalNode]! } : null;
  const isKeep = (n: number) => cells[nav.cells[n]!]?.tag === 'keep';
  const dist = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.z - b.z);
  const ground = [...nav.nodes.keys()].filter((n) => nav.nodes[n]!.y < 0.5);
  const used = new Set<number>([entranceNode, goalNode]);

  /** A spot near a node, nudged off the walkway when there is room. */
  const spotNear = (n: number): V3 => {
    const p = nav.nodes[n]!;
    for (let k = 0; k < 8; k++) {
      const a = placeRng.range(0, Math.PI * 2);
      const r = placeRng.range(0.8, 1.6);
      const q = v3(p.x + Math.cos(a) * r, p.y, p.z + Math.sin(a) * r);
      if (checker.pointFree(q)) return q;
    }
    return { ...p };
  };
  /** Pick spread-out nodes; relaxes spacing and the entrance buffer if the area is tight. */
  const pickNodes = (pool: number[], count: number, minDistEntrance: number, score: (n: number) => number): number[] => {
    const out: number[] = [];
    for (const [spacing, entranceScale] of [
      [10, 1],
      [6, 0.75],
      [3, 0.5],
      [0, 0.3],
    ] as const) {
      const cands = placeRng.shuffle(pool.filter((n) => !used.has(n) && dist(nav.nodes[n]!, entrancePos) >= minDistEntrance * entranceScale));
      cands.sort((a, b) => score(b) - score(a));
      for (const n of cands) {
        if (out.length >= count) break;
        if (out.some((o) => dist(nav.nodes[o]!, nav.nodes[n]!) < spacing)) continue;
        out.push(n);
        used.add(n);
      }
      if (out.length >= count) break;
    }
    return out;
  };
  const pathSet = new Set(pathCells);
  const cellOfNode = (n: number) => cells[nav.cells[n]!]!;

  // Caches prefer gardens, porticos, quays, and cells off the main path.
  const cacheScore = (n: number) => {
    const c = cellOfNode(n);
    const t = nav.tags[n];
    return (t === 'garden' || t === 'portico' || t === 'quay' ? 2 : 0) + (c.type === 'courtyard' ? 1.5 : 0) + (pathSet.has(nav.cells[n]!) ? -1 : 1) + (connCount(c) === 1 ? 1 : 0) + placeRng.next();
  };
  const nCaches = placeRng.int(g.cachesMin, g.cachesMax);
  const caches: PointSpawn[] = pickNodes(ground.filter((n) => !isKeep(n)), nCaches, 20, cacheScore).map((n) => ({ pos: spotNear(n), cell: nav.cells[n]! }));
  let intel: PointSpawn | null = null;
  if (opts.type !== 'castel') {
    const n = pickNodes(ground, 1, 25, cacheScore)[0];
    if (n !== undefined) intel = { pos: spotNear(n), cell: nav.cells[n]! };
  }
  const castScore = (n: number) => (nav.tags[n] === 'portico' || nav.tags[n] === 'promenade' || nav.tags[n] === 'garden' ? 2 : 0) + placeRng.next();
  const castSpot = (present: boolean | undefined): PointSpawn | null => {
    if (!present) return null;
    const n = pickNodes(ground.filter((x) => !isKeep(x)), 1, 18, castScore)[0];
    return n === undefined ? null : { pos: spotNear(n), cell: nav.cells[n]! };
  };
  const lucca = castSpot(opts.luccaPresent);
  const lucretia = castSpot(opts.lucretiaPresent);

  // Hostiles.
  const hostiles: HostileSpawn[] = [];
  let haleIndex = -1;
  const isCastel = opts.type === 'castel';
  const total = isCastel ? placeRng.int(g.hostilesMinArea3, g.hostilesMaxArea3) : placeRng.int(g.hostilesMinArea12, g.hostilesMaxArea12);
  if (isCastel) {
    const keepNodes = [...nav.nodes.keys()].filter(isKeep);
    // Rounds: a long, readable walk between the two keep courts, pausing at each end.
    const route = style.keep.map((k) => nav.nodes[nearestNode(nav, cellCenter(k), 0.5)]!).filter(Boolean);
    const start = route[0] ?? nav.nodes[goalNode]!;
    haleIndex = 0;
    hostiles.push({ kind: 'hale', pos: { ...start }, yaw: 0, route: route.length ? route : [start] });
    const escorts = g.baseEscorts + Math.max(0, Math.min(g.maxGrudgeEscorts, opts.extraEscorts ?? 0));
    for (let k = 0; k < escorts; k++) {
      const ang = (k / escorts) * Math.PI * 2;
      hostiles.push({ kind: 'escort', pos: v3(start.x + Math.cos(ang) * 1.8, start.y, start.z + Math.sin(ang) * 1.8), yaw: 0, route: [], escortOf: 0 });
    }
    for (const n of keepNodes) used.add(n);
  }
  const regulars = isCastel ? Math.max(0, total - 1 - g.baseEscorts) : total;
  const decks = [...nav.nodes.keys()].filter((n) => nav.tags[n] === 'deck');
  const sentries = Math.min(decks.length ? Math.round(regulars * g.sentryShare) : 0, Math.floor(decks.length / 3));
  // The occupation watches the routes: posts favour the main path, its neighbours, and canal bridges.
  const nearPath = new Set<number>();
  for (const ci of pathCells) {
    nearPath.add(ci);
    const c = cells[ci]!;
    for (const d of ALL_DIRS) {
      const n = neighbor(cells, c, d);
      if (n && c.conn[d]) nearPath.add(idx(n.i, n.j));
    }
  }
  const postScore = (n: number) => {
    const ci = nav.cells[n]!;
    const c = cells[ci]!;
    return (pathSet.has(ci) ? 1.6 : nearPath.has(ci) ? 0.9 : 0) + (c.type === 'canal' && c.bridge ? 0.6 : 0) + placeRng.next();
  };
  const posts = [
    ...pickNodes(decks, sentries, 30, (n) => postScore(n)),
    ...pickNodes(
      ground.filter((n) => !isKeep(n)),
      regulars - sentries,
      30,
      postScore,
    ),
  ];
  for (const n of posts) {
    const stationary = placeRng.chance(0.25);
    const route = stationary ? [nav.nodes[n]!] : routeFrom(nav, n, placeRng, placeRng.int(1, 3), new Set());
    hostiles.push({ kind: hostileKindFor(opts.type, placeRng), pos: { ...nav.nodes[n]! }, yaw: placeRng.range(-Math.PI, Math.PI), route: route.map((p) => ({ ...p })) });
  }

  // Civilians: the city keeps living around the occupation.
  const civ = tuning.civilians;
  const civCount = civ[opts.type];
  const civPool = placeRng.shuffle(ground.filter((n) => !isKeep(n) && dist(nav.nodes[n]!, entrancePos) > 8));
  const civilians: CivilianSpawn[] = [];
  const rumorAt = new Set([placeRng.int(0, Math.max(0, civCount - 1)), placeRng.int(0, Math.max(0, civCount - 1))]);
  for (let k = 0; k < civCount && civPool.length; k++) {
    const n = civPool[k % civPool.length]!;
    const p = spotNear(n);
    civilians.push({ pos: p, yaw: placeRng.range(-Math.PI, Math.PI), look: placeRng.int(0, 1 << 20), rumor: rumorAt.has(k), idle: placeRng.chance(civ.idleShare) || nav.tags[n] === 'bench' });
  }

  // Face into the area from the entrance.
  const next = nav.links[entranceNode]!.map((n) => nav.nodes[n]!).sort((a, b) => dist(a, nav.nodes[goalNode]!) - dist(b, nav.nodes[goalNode]!))[0];
  const entranceYaw = next ? Math.atan2(next.x - entrancePos.x, next.z - entrancePos.z) : 0;

  return {
    type: opts.type,
    index: opts.index,
    seed,
    gridSize: N(),
    blockSize: S(),
    cells,
    boxes: builder.boxes,
    decor: builder.decor,
    nav: { nodes: nav.nodes, links: nav.links },
    entrance: entrancePos,
    entranceYaw,
    exit: exitPos,
    pathCells,
    hostiles,
    civilians,
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

export type { NodeHint };
