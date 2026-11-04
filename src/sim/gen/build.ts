import type { Rng } from '../../core/rng';
import { v3, type V3 } from '../../core/vec';
import { tuning } from '../../data/tuning';
import { blockS, cellCenter, gridN, isOpen, neighbor, walkable, ALL_DIRS } from './grid';
import type { AreaType, Box, BoxLook, Cell, Decor, Dir } from './layout';

/**
 * Turns the cell plan into geometry: solid boxes for physics, visual-only
 * decor, raised walkable surfaces, and candidate navigation nodes. Each
 * piece keeps its own lanes clear; the nav builder links whatever is clear.
 */

export interface Surface {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
}

/** Ground rectangles you cannot stand in (canal water) unless a bridge covers them. */
export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface NodeHint {
  pos: V3;
  cell: number;
  /** Prefer for hostile posts / civilian idling. */
  tag?: 'deck' | 'portico' | 'quay' | 'promenade' | 'garden' | 'bench';
}

export class Builder {
  readonly boxes: Box[] = [];
  readonly decor: Decor[] = [];
  readonly surfaces: Surface[] = [];
  readonly voids: Rect[] = [];
  readonly groundBridges: Rect[] = [];
  readonly nodes: NodeHint[] = [];
  readonly ramps: [V3, V3][] = [];

  constructor(
    readonly rng: Rng,
    readonly type: AreaType,
  ) {}

  box(minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number, look: BoxLook, opts: Partial<Box> = {}): Box | null {
    if (maxX - minX < 0.02 || maxY - minY < 0.02 || maxZ - minZ < 0.02) return null;
    const b: Box = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2, hx: (maxX - minX) / 2, hy: (maxY - minY) / 2, hz: (maxZ - minZ) / 2, look, ...opts };
    this.boxes.push(b);
    return b;
  }

  cyl(x: number, z: number, r: number, y0: number, y1: number, look: BoxLook, opts: Partial<Box> = {}): void {
    this.boxes.push({ x, y: (y0 + y1) / 2, z, hx: r, hy: (y1 - y0) / 2, hz: r, look, cylinder: true, ...opts });
  }

  deco(d: Decor): void {
    this.decor.push(d);
  }

  node(x: number, y: number, z: number, cell: number, tag?: NodeHint['tag']): V3 {
    const pos = v3(x, y, z);
    this.nodes.push({ pos, cell, tag });
    return pos;
  }
}

// ------------------------------------------------------------------ side frames

/** Local frame along one side of a cell: u runs along the edge, w goes inward from it. */
export interface SideFrame {
  d: Dir;
  /** World axis that u runs along. */
  along: 'x' | 'z';
  /** Yaw that faces into the cell from this edge. */
  inwardYaw: number;
  map(u: number, w: number): { x: number; z: number };
  rect(u0: number, u1: number, w0: number, w1: number): [number, number, number, number];
}

export function sideFrame(c: Cell, d: Dir): SideFrame {
  const S = blockS();
  const x0 = c.i * S;
  const z0 = c.j * S;
  const cx = x0 + S / 2;
  const cz = z0 + S / 2;
  const map = (u: number, w: number) => {
    switch (d) {
      case 0:
        return { x: cx + u, z: z0 + w };
      case 2:
        return { x: cx + u, z: z0 + S - w };
      case 3:
        return { x: x0 + w, z: cz + u };
      case 1:
        return { x: x0 + S - w, z: cz + u };
    }
  };
  return {
    d,
    along: d === 0 || d === 2 ? 'x' : 'z',
    inwardYaw: d === 0 ? 0 : d === 2 ? Math.PI : d === 3 ? Math.PI / 2 : -Math.PI / 2,
    map,
    rect(u0, u1, w0, w1) {
      const a = map(u0, w0);
      const b = map(u1, w1);
      return [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.z, b.z), Math.max(a.z, b.z)];
    },
  };
}

function boxIn(b: Builder, f: SideFrame, u0: number, u1: number, w0: number, w1: number, y0: number, y1: number, look: BoxLook, opts: Partial<Box> = {}): Box | null {
  const [minX, maxX, minZ, maxZ] = f.rect(u0, u1, w0, w1);
  return b.box(minX, maxX, y0, y1, minZ, maxZ, look, opts);
}

/** Subtract gaps from [a, b]. */
function segmentsWithout(a: number, b: number, gaps: [number, number][]): [number, number][] {
  let segs: [number, number][] = [[a, b]];
  for (const [g0, g1] of gaps) {
    const next: [number, number][] = [];
    for (const [s0, s1] of segs) {
      if (g1 <= s0 || g0 >= s1) next.push([s0, s1]);
      else {
        if (g0 > s0) next.push([s0, g0]);
        if (g1 < s1) next.push([g1, s1]);
      }
    }
    segs = next;
  }
  return segs.filter(([s0, s1]) => s1 - s0 > 0.3);
}

function balusters(b: Builder, f: SideFrame, u0: number, u1: number, w: number, y: number): void {
  const p = f.map((u0 + u1) / 2, w);
  b.deco({ kind: 'balusters', x: p.x, y, z: p.z, w: u1 - u0, h: 1.0, d: 0.3, yaw: f.along === 'x' ? 0 : Math.PI / 2 });
}

// ------------------------------------------------------------------ elevated promenades

export interface StairPlan {
  dir: 1 | -1;
  /** Range of u the stair and landing occupy (for conflict checks). */
  u0: number;
  u1: number;
}

export interface DeckPlan {
  side: Dir;
  stair: StairPlan | null;
  /** Deck continues into the neighbouring cell at the u=-12 / u=+12 end. */
  contStart: boolean;
  contEnd: boolean;
  /** Another deck meets this one at the corner. */
  trimStart: boolean;
  trimEnd: boolean;
  bridgeGap: [number, number] | null;
}

export function stairPlan(dir: 1 | -1): StairPlan {
  const g = tuning.gen;
  const run = g.deckHeight / Math.tan((g.stairAngleDeg * Math.PI) / 180);
  const uf = dir === 1 ? -10 : 10;
  const ut = uf + dir * run;
  const land = ut + dir * 3;
  return { dir, u0: Math.min(uf, land) - 1.4, u1: Math.max(uf, land) + 0.2 };
}

/** A raised walkway along one side of an open cell, with an arcade underneath. */
export function buildDeck(b: Builder, c: Cell, ci: number, plan: DeckPlan): void {
  const g = tuning.gen;
  const H = g.deckHeight;
  const D = g.deckDepth;
  const f = sideFrame(c, plan.side);
  boxIn(b, f, -12, 12, 0, D, H - 0.4, H, 'deck');
  const [sx0, sx1, sz0, sz1] = f.rect(-12, 12, 0, D);
  b.surfaces.push({ minX: sx0, maxX: sx1, minZ: sz0, maxZ: sz1, y: H });
  // Arcade columns.
  for (const u of [-9, -3, 3, 9]) {
    const p = f.map(u, D - 0.35);
    b.cyl(p.x, p.z, 0.32, 0, H - 0.4, 'column');
  }
  // Inner parapet with gaps for the stair landing and any bridge.
  const gaps: [number, number][] = [];
  let landing: [number, number] | null = null;
  if (plan.stair) {
    const run = H / Math.tan((g.stairAngleDeg * Math.PI) / 180);
    const dir = plan.stair.dir;
    const ut = (dir === 1 ? -10 : 10) + dir * run;
    landing = dir === 1 ? [ut, ut + 3] : [ut - 3, ut];
    gaps.push(landing);
  }
  if (plan.bridgeGap) gaps.push(plan.bridgeGap);
  const pu0 = plan.trimStart ? -12 + D : -12;
  const pu1 = plan.trimEnd ? 12 - D : 12;
  for (const [s0, s1] of segmentsWithout(pu0, pu1, gaps)) {
    boxIn(b, f, s0, s1, D - 0.25, D, H, H + 1.05, 'parapet');
    balusters(b, f, s0, s1, D - 0.12, H + 1.05);
  }
  if (!plan.contStart && !plan.trimStart) boxIn(b, f, -12, -11.75, 0, D, H, H + 1.05, 'parapet');
  if (!plan.contEnd && !plan.trimEnd) boxIn(b, f, 11.75, 12, 0, D, H, H + 1.05, 'parapet');
  // Nodes along the deck and in the arcade below.
  for (const u of [-9, -3, 3, 9]) {
    const p = f.map(u, D / 2);
    b.node(p.x, H, p.z, ci, 'deck');
  }
  for (const u of [-6, 0, 6]) {
    const p = f.map(u, 1.8);
    b.node(p.x, 0, p.z, ci, 'portico');
  }
  // Roses spilling over the parapet, lamps on the deck.
  for (const u of [-6, 6]) {
    const p = f.map(u, D - 0.6);
    b.deco({ kind: 'rose', x: p.x, y: H + 1.05, z: p.z, w: 1.2, h: 0.5 });
  }
  if (plan.stair && landing) buildStair(b, f, ci, plan.stair.dir, landing);
}

function buildStair(b: Builder, f: SideFrame, ci: number, dir: 1 | -1, landing: [number, number]): void {
  const g = tuning.gen;
  const H = g.deckHeight;
  const D = g.deckDepth;
  const theta = (g.stairAngleDeg * Math.PI) / 180;
  const run = H / Math.tan(theta);
  const L = run / Math.cos(theta);
  const uf = dir === 1 ? -10 : 10;
  const w0 = D + 0.2;
  const w1 = D + 3.2;
  const wm = (w0 + w1) / 2;
  // Tilted slab (the walkable surface), drawn as steps instead.
  const sm = run / 2 + 0.2 * Math.sin(theta);
  const centre = f.map(uf + dir * sm, wm);
  const cy = H / 2 - 0.2 * Math.cos(theta);
  const runSign = dir; // +1: uphill toward +u
  // World run direction: +u maps to +x (N/S sides) or +z (W/E sides).
  let tilt: Box['tilt'];
  if (f.along === 'x') tilt = { axis: 'z', angle: runSign * theta };
  else tilt = { axis: 'x', angle: -runSign * theta };
  const half = L / 2 + 0.25;
  b.boxes.push(
    f.along === 'x'
      ? { x: centre.x, y: cy, z: centre.z, hx: half, hy: 0.2, hz: 1.5, look: 'step', tilt, visible: false }
      : { x: centre.x, y: cy, z: centre.z, hx: 1.5, hy: 0.2, hz: half, look: 'step', tilt, visible: false },
  );
  // Solid fill under the slab so nobody walks beneath it.
  for (let k = 0; k < 4; k++) {
    const s0 = (k * run) / 4;
    const s1 = ((k + 1) * run) / 4;
    const top = s0 * Math.tan(theta) - 0.3;
    if (top < 0.2) continue;
    const a = uf + dir * s0;
    const c2 = uf + dir * s1;
    boxIn(b, f, Math.min(a, c2), Math.max(a, c2), w0, w1, 0, top, 'step', { visible: false });
  }
  // Visible steps.
  const steps = 14;
  for (let k = 0; k < steps; k++) {
    const a = uf + dir * ((k * run) / steps);
    const c2 = uf + dir * (((k + 1) * run) / steps);
    boxIn(b, f, Math.min(a, c2), Math.max(a, c2), w0, w1, 0, ((k + 1) * H) / steps, 'step', { solid: false });
  }
  // Landing and its pier.
  boxIn(b, f, landing[0], landing[1], D - 0.25, w1, H - 0.4, H, 'deck');
  boxIn(b, f, landing[0], landing[1], w0, w1, 0, H - 0.4, 'step');
  const [lx0, lx1, lz0, lz1] = f.rect(landing[0], landing[1], D - 0.25, w1);
  b.surfaces.push({ minX: lx0, maxX: lx1, minZ: lz0, maxZ: lz1, y: H });
  // Outer railing along the landing and its far end.
  boxIn(b, f, landing[0], landing[1], w1, w1 + 0.25, H, H + 1.05, 'parapet');
  const farU = dir === 1 ? landing[1] : landing[0];
  boxIn(b, f, dir === 1 ? farU - 0.25 : farU, dir === 1 ? farU : farU + 0.25, D, w1 + 0.25, H, H + 1.05, 'parapet');
  // Railing along the stair (tilted like the slab).
  const rc = f.map(uf + dir * (run / 2 + 0.6), w1 + 0.12);
  const railY = H / 2 + 0.55;
  b.boxes.push(
    f.along === 'x'
      ? { x: rc.x, y: railY, z: rc.z, hx: L / 2 - 1.0, hy: 0.5, hz: 0.12, look: 'parapet', tilt }
      : { x: rc.x, y: railY, z: rc.z, hx: 0.12, hy: 0.5, hz: L / 2 - 1.0, look: 'parapet', tilt },
  );
  // Nodes: foot (ground) and top (landing), linked as a ramp.
  const foot = f.map(uf - dir * 1.3, wm);
  const lc = (landing[0] + landing[1]) / 2;
  const top = f.map(lc, wm);
  const footN = b.node(foot.x, 0, foot.z, ci);
  const topN = b.node(top.x, H, top.z, ci, 'deck');
  const junction = f.map(lc, D / 2);
  b.node(junction.x, H, junction.z, ci, 'deck');
  b.ramps.push([footN, topN]);
}

/** Bridge across a street or piazza between decks on opposite sides. */
export function buildDeckBridge(b: Builder, c: Cell, ci: number, sideA: Dir, gap: [number, number]): void {
  const g = tuning.gen;
  const H = g.deckHeight;
  const D = g.deckDepth;
  const S = blockS();
  const f = sideFrame(c, sideA); // sideA is N (0) or W (3); the bridge runs across to the opposite side.
  boxIn(b, f, gap[0], gap[1], D, S - D, H - 0.4, H, 'deck');
  const [x0, x1, z0, z1] = f.rect(gap[0], gap[1], D, S - D);
  b.surfaces.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, y: H });
  boxIn(b, f, gap[0], gap[0] + 0.25, D, S - D, H, H + 1.05, 'parapet');
  boxIn(b, f, gap[1] - 0.25, gap[1], D, S - D, H, H + 1.05, 'parapet');
  balusters(b, f, gap[0], gap[0] + 0.25, S / 2, H + 1.05);
  const um = (gap[0] + gap[1]) / 2;
  for (const w of [D / 2, D + 2, S / 2, S - D - 2, S - D / 2]) {
    const p = f.map(um, w);
    b.node(p.x, H, p.z, ci, 'deck');
  }
  const mid = f.map(um, S / 2);
  b.deco({ kind: 'arch', x: mid.x, y: 0, z: mid.z, w: S - 2 * D, h: H - 0.4, d: gap[1] - gap[0], yaw: f.along === 'x' ? Math.PI / 2 : 0 });
}

// ------------------------------------------------------------------ pieces

const rand = (b: Builder, lo: number, hi: number) => b.rng.range(lo, hi);

function cornerRect(c: Cell) {
  const S = blockS();
  return { x0: c.i * S, z0: c.j * S, x1: c.i * S + S, z1: c.j * S + S, cx: c.i * S + S / 2, cz: c.j * S + S / 2 };
}

/** Planters, cypresses, and lamps along a side that faces a building. */
function planterRow(b: Builder, c: Cell, d: Dir): void {
  const f = sideFrame(c, d);
  for (const u of [-7.5, 7.5]) {
    boxIn(b, f, u - 2, u + 2, 2.4, 3.4, 0, 0.95, 'planter');
    const p = f.map(u, 2.9);
    b.deco({ kind: 'rose', x: p.x, y: 0.95, z: p.z, w: 3.6, h: 0.6, d: 0.9, yaw: f.along === 'x' ? 0 : Math.PI / 2 });
  }
  for (const u of [-11, -3.2, 3.2, 11]) {
    const p = f.map(u, 2.9);
    b.cyl(p.x, p.z, 0.35, 0, 2.2, 'none', { visible: false });
    b.deco({ kind: 'cypress', x: p.x, y: 0, z: p.z, w: 0.9, h: rand(b, 6.5, 9) });
  }
  for (const u of [-5.2, 5.2]) {
    const p = f.map(u, 3.6);
    b.cyl(p.x, p.z, 0.14, 0, 4.4, 'none', { visible: false });
    b.deco({ kind: 'lamp', x: p.x, y: 0, z: p.z, w: 0.2, h: 4.6 });
  }
}

function hedgeWall(b: Builder, c: Cell, d: Dir): void {
  const f = sideFrame(c, d);
  boxIn(b, f, -12, 12, 0, 1.0, 0, 2.6, 'hedge');
  for (const u of [-8, 0, 8]) {
    const p = f.map(u, 1.0);
    b.deco({ kind: 'rose', x: p.x, y: 1.4, z: p.z, w: 5, h: 0.8, d: 0.4, yaw: f.along === 'x' ? 0 : Math.PI / 2 });
  }
}

function portNodes(b: Builder, cells: Cell[], c: Cell, ci: number): void {
  const { cx, cz } = cornerRect(c);
  const S = blockS();
  for (const d of ALL_DIRS) {
    if (!c.conn[d]) continue;
    const n = neighbor(cells, c, d);
    if (!n) continue;
    if (c.type === 'canal' && n.type === 'canal') continue; // canal ports are added by the canal piece
    if (n.type === 'canal' && ((n.axis === 'x' && (d === 1 || d === 3)) || (n.axis === 'z' && (d === 0 || d === 2)))) continue;
    const px = d === 1 ? cx + S / 2 : d === 3 ? cx - S / 2 : cx;
    const pz = d === 0 ? cz - S / 2 : d === 2 ? cz + S / 2 : cz;
    b.node(px, 0, pz, ci);
  }
}

export interface OpenCellPlan {
  decks: DeckPlan[];
  bridge: { side: Dir; gap: [number, number] } | null;
}

function openSides(b: Builder, cells: Cell[], c: Cell, ci: number, plan: OpenCellPlan): void {
  for (const d of ALL_DIRS) {
    if (c.conn[d]) continue;
    if (c.type === 'canal' && ((c.axis === 'x' && (d === 1 || d === 3)) || (c.axis === 'z' && (d === 0 || d === 2)))) continue;
    const deck = plan.decks.find((p) => p.side === d);
    if (deck) continue;
    const n = neighbor(cells, c, d);
    if (n && walkable(n)) hedgeWall(b, c, d);
    else if (c.tag === 'quay' && d === 0) quayEdge(b, c, ci);
    else if (c.type !== 'canal') planterRow(b, c, d);
  }
  for (const p of plan.decks) buildDeck(b, c, ci, p);
  if (plan.bridge) buildDeckBridge(b, c, ci, plan.bridge.side, plan.bridge.gap);
}

function quayEdge(b: Builder, c: Cell, ci: number): void {
  const f = sideFrame(c, 0);
  for (let u = -10; u <= 10; u += 5) {
    const p = f.map(u, 1.2);
    b.cyl(p.x, p.z, 0.24, 0, 0.8, 'bollard');
  }
  if (b.rng.chance(0.5)) {
    const p = f.map(b.rng.pick([-7, 7]), 3.2);
    b.box(p.x - 1.2, p.x + 1.2, 0, 1.2, p.z - 1.2, p.z + 1.2, 'crate');
    b.deco({ kind: 'crane', x: p.x, y: 1.2, z: p.z, w: 1.2, h: 22, yaw: b.rng.range(-0.6, 0.6) });
  }
  const q = f.map(0, 4);
  b.node(q.x, 0, q.z, ci, 'quay');
}

function crates(b: Builder, c: Cell, count: number): void {
  const { cx, cz } = cornerRect(c);
  const spots: [number, number][] = b.rng.shuffle([
    [7, 3.5],
    [-7, 3.5],
    [7, -3.5],
    [-7, -3.5],
    [3.5, 7],
    [-3.5, 7],
    [3.5, -7],
    [-3.5, -7],
  ]);
  for (let k = 0; k < count; k++) {
    const [ox, oz] = spots[k]!;
    const h = b.rng.chance(0.55) ? 1.15 : 2.4;
    b.box(cx + ox - 1.1, cx + ox + 1.1, 0, h, cz + oz - 1.1, cz + oz + 1.1, 'crate', { tint: b.rng.int(0, 3) });
  }
}

export function buildStreet(b: Builder, cells: Cell[], c: Cell, ci: number, plan: OpenCellPlan): void {
  const { cx, cz } = cornerRect(c);
  b.node(cx, 0, cz, ci);
  for (const [sx, sz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]] as const) b.node(cx + sx, 0, cz + sz, ci);
  portNodes(b, cells, c, ci);
  openSides(b, cells, c, ci, plan);
  if (b.type === 'porto') crates(b, c, b.rng.int(0, 2));
}

export function buildPiazza(b: Builder, cells: Cell[], c: Cell, ci: number, plan: OpenCellPlan): void {
  const { cx, cz } = cornerRect(c);
  if (c.fountain) {
    b.cyl(cx, cz, 3.6, 0, 0.9, 'basin');
    b.deco({ kind: 'water', x: cx, y: 0.7, z: cz, w: 3.25, h: 0.05 });
    if (b.type === 'castel') b.deco({ kind: 'obelisk', x: cx, y: 0.9, z: cz, w: 0.9, h: 12 });
    else {
      b.deco({ kind: 'statue', x: cx, y: 0.9, z: cz, w: 1.1, h: 4.6, tint: b.rng.int(0, 3) });
      b.deco({ kind: 'jet', x: cx, y: 0.9, z: cz, w: 2.8, h: 2.2 });
    }
    for (const [sx, sz] of [[7, 0], [-7, 0], [0, 7], [0, -7]] as const) b.node(cx + sx, 0, cz + sz, ci);
  } else {
    b.node(cx, 0, cz, ci);
    if (c.tag !== 'quay') {
      for (const [sx, sz] of [[-7.5, -7.5], [7.5, -7.5], [-7.5, 7.5], [7.5, 7.5]] as const) {
        b.box(cx + sx - 1.5, cx + sx + 1.5, 0, 0.8, cz + sz - 1.5, cz + sz + 1.5, 'planter');
        b.deco({ kind: 'rose', x: cx + sx, y: 0.8, z: cz + sz, w: 2.8, h: 0.6, d: 2.8 });
      }
    }
  }
  for (const [sx, sz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]] as const) b.node(cx + sx, 0, cz + sz, ci, c.fountain ? 'bench' : undefined);
  portNodes(b, cells, c, ci);
  openSides(b, cells, c, ci, plan);
  if (c.tag === 'quay' || b.type === 'porto') crates(b, c, c.tag === 'quay' ? b.rng.int(1, 3) : b.rng.int(0, 2));
}

export function buildCourtyard(b: Builder, cells: Cell[], c: Cell, ci: number): void {
  const { cx, cz } = cornerRect(c);
  const keep = c.tag === 'keep';
  const wallH = keep ? tuning.gen.wallHeight + 3 : tuning.gen.wallHeight;
  const look: BoxLook = keep || b.type === 'castel' ? 'fortress' : 'marble';
  for (const d of ALL_DIRS) {
    const f = sideFrame(c, d);
    const n = neighbor(cells, c, d);
    // Don't double up walls between two adjoining courtyards (keep cells).
    const shared = n && n.type === 'courtyard' && c.conn[d];
    const segs = c.conn[d] ? (shared ? [] : ([[-12, -2.5], [2.5, 12]] as [number, number][])) : ([[-12, 12]] as [number, number][]);
    for (const [u0, u1] of segs) boxIn(b, f, u0, u1, 0, 1.0, 0, wallH, look);
    for (const u of [-8.5, -4.5, 4.5, 8.5]) {
      const p = f.map(u, 2.6);
      b.cyl(p.x, p.z, 0.3, 0, wallH - 1.2, 'column');
    }
    const e = f.map(0, 2.6);
    b.deco({ kind: 'balusters', x: e.x, y: wallH - 1.2, z: e.z, w: 20, h: 0.7, d: 0.8, yaw: f.along === 'x' ? 0 : Math.PI / 2 });
    if (keep) {
      const fl = f.map(b.rng.pick([-6, 6]), 1.05);
      b.deco({ kind: 'flag', x: fl.x, y: 3.5, z: fl.z, w: 1.6, h: 4, yaw: f.inwardYaw });
    }
  }
  for (const [sx, sz] of [[-6.5, -6.5], [6.5, -6.5], [-6.5, 6.5], [6.5, 6.5]] as const) {
    b.box(cx + sx - 2, cx + sx + 2, 0, 0.8, cz + sz - 2, cz + sz + 2, 'planter');
    b.deco({ kind: 'rose', x: cx + sx, y: 0.8, z: cz + sz, w: 3.6, h: 0.7, d: 3.6 });
    b.deco({ kind: 'cypress', x: cx + sx, y: 0.8, z: cz + sz, w: 0.9, h: rand(b, 5, 7) });
  }
  b.node(cx, 0, cz, ci, 'garden');
  for (const [sx, sz] of [[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5]] as const) b.node(cx + sx, 0, cz + sz, ci, 'garden');
  portNodes(b, cells, c, ci);
}

export function buildAlley(b: Builder, cells: Cell[], c: Cell, ci: number): void {
  const { x0, z0, x1, z1, cx, cz } = cornerRect(c);
  const hw = tuning.gen.alleyWidth / 2;
  const h = () => rand(b, b.type === 'quartieri' ? 20 : 14, b.type === 'quartieri' ? 34 : 24);
  const tint = () => b.rng.int(0, 7);
  const mass = (ax0: number, ax1: number, az0: number, az1: number) => b.box(ax0, ax1, 0, h(), az0, az1, b.type === 'castel' ? 'fortress' : 'palazzo', { tint: tint() });
  mass(x0, cx - hw, z0, cz - hw);
  mass(cx + hw, x1, z0, cz - hw);
  mass(x0, cx - hw, cz + hw, z1);
  mass(cx + hw, x1, cz + hw, z1);
  if (!c.conn[0]) mass(cx - hw, cx + hw, z0, cz - hw);
  if (!c.conn[2]) mass(cx - hw, cx + hw, cz + hw, z1);
  if (!c.conn[3]) mass(x0, cx - hw, cz - hw, cz + hw);
  if (!c.conn[1]) mass(cx + hw, x1, cz - hw, cz + hw);
  b.node(cx, 0, cz, ci);
  for (const d of ALL_DIRS) {
    if (!c.conn[d]) continue;
    const f = sideFrame(c, d);
    // Arm: from the cell edge (w=0) to the centre square (w=12-hw).
    const am = f.map(0, 3.5);
    b.node(am.x, 0, am.z, ci);
    for (const s of [-1, 1]) {
      if (b.rng.chance(0.6)) {
        const p = f.map(s * (hw - 0.8), 3.5);
        b.cyl(p.x, p.z, 0.45, 0, 0.9, 'planter');
        b.deco({ kind: 'rose', x: p.x, y: 0.9, z: p.z, w: 1.0, h: 0.6 });
      }
    }
    if (b.rng.chance(0.45)) {
      const p = f.map(0, 5.5);
      b.deco({ kind: 'arch', x: p.x, y: rand(b, 7, 10), z: p.z, w: hw * 2, h: 1.6, d: 1.2, yaw: f.along === 'x' ? Math.PI / 2 : 0 });
    }
    if (b.rng.chance(0.35)) {
      const p = f.map(0, 4);
      b.deco({ kind: 'awning', x: p.x, y: rand(b, 11, 15), z: p.z, w: hw * 2, h: 1.2, d: 3, yaw: f.along === 'x' ? Math.PI / 2 : 0 });
    }
  }
  for (const [sx, sz] of [[-hw + 0.3, -hw + 0.3], [hw - 0.3, hw - 0.3]] as const) {
    if (b.rng.chance(0.5)) b.deco({ kind: 'lamp', x: cx + sx, y: 0, z: cz + sz, w: 0.2, h: 4.2 });
  }
  portNodes(b, cells, c, ci);
}

export function buildCanal(b: Builder, cells: Cell[], c: Cell, ci: number, plan: OpenCellPlan): void {
  const { cx, cz } = cornerRect(c);
  const S = blockS();
  const half = tuning.gen.canalWidth / 2;
  const pc = (S / 2 + half + 0.4) / 2; // promenade centre line offset from the canal axis
  const along = c.axis ?? 'x';
  // Express everything as (a = along the canal, t = across it).
  const P = (a: number, t: number) => (along === 'x' ? { x: cx + a, z: cz + t } : { x: cx + t, z: cz + a });
  const R = (a0: number, a1: number, t0: number, t1: number) => {
    const p = P(a0, t0);
    const q = P(a1, t1);
    return [Math.min(p.x, q.x), Math.max(p.x, q.x), Math.min(p.z, q.z), Math.max(p.z, q.z)] as const;
  };
  const [vx0, vx1, vz0, vz1] = R(-S / 2, S / 2, -half, half);
  b.voids.push({ minX: vx0, maxX: vx1, minZ: vz0, maxZ: vz1 });
  b.deco({ kind: 'channel', x: cx, y: 0, z: cz, w: along === 'x' ? S : 2 * half, h: 1.6, d: along === 'x' ? 2 * half : S });
  const gap: [number, number][] = c.bridge ? [[-2.6, 2.6]] : [];
  for (const t of [-1, 1]) {
    for (const [a0, a1] of segmentsWithout(-S / 2, S / 2, gap)) {
      const [x0, x1, z0, z1] = R(a0, a1, t * half, t * (half + 0.4));
      b.box(x0, x1, 0, 1.0, z0, z1, 'parapet');
    }
  }
  if (c.bridge) {
    // Railings along both sides of the crossing, joining the bank parapets.
    for (const [a0, a1] of [[-2.6, -2.2], [2.2, 2.6]] as const) {
      const [x0, x1, z0, z1] = R(a0, a1, -half - 0.4, half + 0.4);
      b.box(x0, x1, 0, 1.0, z0, z1, 'parapet');
    }
    const [x0, x1, z0, z1] = R(-2.2, 2.2, -half, half);
    b.groundBridges.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 });
    b.deco({ kind: 'arch', x: cx, y: -1.4, z: cz, w: 2 * half + 0.8, h: 1.6, d: 4.4, yaw: along === 'x' ? Math.PI / 2 : 0 });
    const m = P(0, 0);
    b.node(m.x, 0, m.z, ci);
  }
  // Promenade nodes, including the shared along-canal ports at the cell edge.
  for (const t of [-pc, pc]) {
    for (const a of [-S / 2, -6, 0, 6, S / 2]) {
      const p = P(a, t);
      b.node(p.x, 0, p.z, ci, a === 0 ? 'promenade' : undefined);
    }
  }
  // Boats, benches facing the water, trees on the outer side.
  if (b.rng.chance(0.6)) {
    const p = P(b.rng.range(-8, 8), b.rng.range(-0.8, 0.8));
    b.deco({ kind: 'boat', x: p.x, y: -0.9, z: p.z, w: 1.8, h: 0.8, d: 5, yaw: along === 'x' ? Math.PI / 2 : 0 });
  }
  for (const t of [-1, 1]) {
    const side: Dir = along === 'x' ? (t < 0 ? 0 : 2) : t < 0 ? 3 : 1;
    const hasDeck = plan.decks.some((d) => d.side === side);
    for (const a of [-9, 9]) {
      const p = P(a, t * (half + 1.3));
      if (!hasDeck) b.box(p.x - (along === 'x' ? 1 : 0.3), p.x + (along === 'x' ? 1 : 0.3), 0, 0.55, p.z - (along === 'x' ? 0.3 : 1), p.z + (along === 'x' ? 0.3 : 1), 'bench');
    }
    if (!hasDeck) {
      for (const a of [-9, -3, 3, 9]) {
        if (c.conn[side] && Math.abs(a) < 4) continue;
        const p = P(a, t * (S / 2 - 2.2));
        b.cyl(p.x, p.z, 0.35, 0, 2.2, 'none', { visible: false });
        b.deco({ kind: 'tree', x: p.x, y: 0, z: p.z, w: 2.6, h: rand(b, 6, 8.5) });
      }
      for (const a of [-6, 6]) {
        const p = P(a, t * (half + 0.9));
        b.deco({ kind: 'lamp', x: p.x, y: 0, z: p.z, w: 0.2, h: 4.2 });
      }
    }
  }
  portNodes(b, cells, c, ci);
  openSides(b, cells, c, ci, plan);
}

// ------------------------------------------------------------------ buildings

export function buildBuilding(b: Builder, cells: Cell[], c: Cell, ci: number, deckedFacing: (d: Dir) => boolean): void {
  const { x0, z0, x1, z1, cx, cz } = cornerRect(c);
  const g = tuning.gen;
  const style = c.style ?? 'palazzo';
  const tint = b.rng.int(0, 7);
  const m = 0.6;
  if (style === 'tower') {
    b.box(x0 + m, x1 - m, 0, 8, z0 + m, z1 - m, 'podium', { tint });
    const hs = rand(b, 5, 7);
    const h = rand(b, g.towerHeightMin, g.towerHeightMax);
    b.box(cx - hs, cx + hs, 8, h, cz - hs, cz + hs, 'tower', { tint, solid: false });
    b.box(cx - hs - 0.4, cx + hs + 0.4, h, h + 1.2, cz - hs - 0.4, cz + hs + 0.4, 'cornice', { solid: false });
    if (b.rng.chance(0.5)) b.deco({ kind: 'obelisk', x: cx, y: h + 1.2, z: cz, w: 0.8, h: rand(b, 6, 12) });
    return;
  }
  if (style === 'warehouse' || style === 'fortress') {
    const h = rand(b, 10, 15);
    b.box(x0 + m, x1 - m, 0, h, z0 + m, z1 - m, style, { tint });
    if (style === 'fortress') {
      for (const d of ALL_DIRS) {
        const f = sideFrame(c, d);
        const p = f.map(0, m + 0.3);
        b.deco({ kind: 'merlons', x: p.x, y: h, z: p.z, w: 22, h: 1.2, d: 0.6, yaw: f.along === 'x' ? 0 : Math.PI / 2 });
      }
    } else {
      for (const d of ALL_DIRS) {
        if (!isOpen(neighbor(cells, c, d))) continue;
        const f = sideFrame(c, d);
        const p = f.map(0, m);
        b.deco({ kind: 'arch', x: p.x, y: 0, z: p.z, w: 6, h: 6.5, d: 0.6, yaw: f.inwardYaw + Math.PI / 2 });
      }
    }
    return;
  }
  // Palazzo with porticos facing open spaces.
  const inset: [number, number, number, number] = [m, m, m, m];
  const portico: Dir[] = [];
  for (const d of ALL_DIRS) {
    const n = neighbor(cells, c, d);
    if (n && (isOpen(n) || n.type === 'courtyard') && !deckedFacing(d) && b.rng.chance(0.8)) {
      portico.push(d);
      inset[d] = 3.2;
    }
  }
  const h = rand(b, b.type === 'quartieri' ? 20 : g.buildingHeightMin, b.type === 'quartieri' ? 34 : g.buildingHeightMax);
  const bx0 = x0 + inset[3];
  const bx1 = x1 - inset[1];
  const bz0 = z0 + inset[0];
  const bz1 = z1 - inset[2];
  b.box(bx0, bx1, 0, h, bz0, bz1, 'palazzo', { tint });
  b.box(bx0 - 0.45, bx1 + 0.45, h - 0.8, h, bz0 - 0.45, bz1 + 0.45, 'cornice', { solid: false, tint });
  const colH = 8.5;
  for (const d of portico) {
    const f = sideFrame(c, d);
    for (let u = -10.5; u <= 10.6; u += 3) {
      const p = f.map(u, 1.25);
      b.cyl(p.x, p.z, 0.34, 0, colH, 'column');
    }
    boxIn(b, f, -12 + m, 12 - m, 0.85, 3.2, colH, colH + 1.3, 'cornice', { solid: false, tint });
    for (const u of [-6, 0, 6]) {
      const p = f.map(u, 2.2);
      b.node(p.x, 0, p.z, ci, 'portico');
    }
  }
  // Roofline: attic storey, dome, statues.
  const roll = b.rng.next();
  if (h > 20 && roll < 0.45) {
    b.box(bx0 + 3, bx1 - 3, h, h + rand(b, 3.5, 6), bz0 + 3, bz1 - 3, 'attic', { solid: false, tint });
  }
  if (roll > 0.55) {
    const r = Math.min(bx1 - bx0, bz1 - bz0) * rand(b, 0.24, 0.34);
    b.deco({ kind: 'drum', x: (bx0 + bx1) / 2, y: h, z: (bz0 + bz1) / 2, w: r, h: rand(b, 3, 6) });
    b.deco({ kind: 'dome', x: (bx0 + bx1) / 2, y: h, z: (bz0 + bz1) / 2, w: r, h: r, tint: b.rng.chance(0.55) ? 1 : 0 });
  }
  if (b.rng.chance(0.35)) {
    for (const [sx, sz] of [[bx0 + 1, bz0 + 1], [bx1 - 1, bz0 + 1], [bx0 + 1, bz1 - 1], [bx1 - 1, bz1 - 1]] as const) {
      b.deco({ kind: 'statue', x: sx, y: h, z: sz, w: 0.7, h: 2.6, tint: 0 });
    }
  }
  b.deco({ kind: 'balusters', x: (bx0 + bx1) / 2, y: h, z: bz0 + 0.3, w: bx1 - bx0 - 1, h: 0.9, d: 0.3, yaw: 0 });
}

// ------------------------------------------------------------------ perimeter

/** Facades (or the sea, or fortress walls) just outside the grid so the city continues. */
export function buildPerimeter(b: Builder, type: AreaType, gateCells: { cell: Cell; side: Dir }[]): void {
  const S = blockS();
  const N = gridN();
  const T = N * S;
  const D = tuning.gen.perimeterDepth;
  const castel = type === 'castel';
  const wallH = tuning.gen.castelWallHeight;
  for (let k = 0; k < N; k++) {
    for (const side of [0, 1, 2, 3] as Dir[]) {
      if (type === 'porto' && side === 0) {
        // The harbour: a quay edge with the sea beyond.
        b.box(k * S, (k + 1) * S, 0, 1.05, -0.45, 0, 'parapet');
        b.box(k * S, (k + 1) * S, 0, 8, -2.2, -0.45, 'none', { visible: false });
        continue;
      }
      const a0 = k * S;
      const a1 = (k + 1) * S;
      const h = castel ? wallH : rand(b, 18, 38);
      const look: BoxLook = castel ? 'fortress' : 'perimeter';
      const tint = b.rng.int(0, 7);
      const t0 = castel ? 4 : D;
      if (side === 0) b.box(a0, a1, 0, h, -t0, 0, look, { tint });
      if (side === 2) b.box(a0, a1, 0, h, T, T + t0, look, { tint });
      if (side === 3) b.box(-t0, 0, 0, h, a0, a1, look, { tint });
      if (side === 1) b.box(T, T + t0, 0, h, a0, a1, look, { tint });
      if (castel) {
        const p = side === 0 ? v3((a0 + a1) / 2, 0, -2) : side === 2 ? v3((a0 + a1) / 2, 0, T + 2) : side === 3 ? v3(-2, 0, (a0 + a1) / 2) : v3(T + 2, 0, (a0 + a1) / 2);
        b.deco({ kind: 'merlons', x: p.x, y: wallH, z: p.z, w: S, h: 1.3, d: 0.8, yaw: side === 0 || side === 2 ? 0 : Math.PI / 2 });
      } else if (b.rng.chance(0.3)) {
        const p = side === 0 ? v3((a0 + a1) / 2, 0, -D / 2) : side === 2 ? v3((a0 + a1) / 2, 0, T + D / 2) : side === 3 ? v3(-D / 2, 0, (a0 + a1) / 2) : v3(T + D / 2, 0, (a0 + a1) / 2);
        const r = rand(b, 3.5, 5.5);
        b.deco({ kind: 'drum', x: p.x, y: h, z: p.z, w: r, h: 3 });
        b.deco({ kind: 'dome', x: p.x, y: h, z: p.z, w: r, h: r, tint: b.rng.chance(0.5) ? 1 : 0 });
      }
    }
  }
  // Corners.
  const t0 = castel ? 4 : D;
  const ch = castel ? wallH + 4 : 30;
  for (const [x, z] of [[-t0, -t0], [T, -t0], [-t0, T], [T, T]] as const) {
    if (type === 'porto' && z < 0) continue;
    b.box(x, x + t0, 0, ch, z, z + t0, castel ? 'fortress' : 'perimeter');
    if (castel) b.deco({ kind: 'drum', x: x + t0 / 2, y: ch, z: z + t0 / 2, w: 3.2, h: 3 });
  }
  for (const g of gateCells) {
    const cc = cellCenter(g.cell);
    const p = g.side === 0 ? v3(cc.x, 0, 0) : g.side === 2 ? v3(cc.x, 0, T) : g.side === 3 ? v3(0, 0, cc.z) : v3(T, 0, cc.z);
    b.deco({ kind: 'gate', x: p.x, y: 0, z: p.z, w: 9, h: castel ? wallH + 2 : 14, d: 3, yaw: g.side === 0 || g.side === 2 ? 0 : Math.PI / 2 });
  }
}
