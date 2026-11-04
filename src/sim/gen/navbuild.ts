import { v3, type V3 } from '../../core/vec';
import type { Box, NavGraph } from './layout';
import type { NodeHint, Rect, Surface } from './build';

/**
 * Builds the navigation graph from candidate nodes. Nodes inside solid
 * geometry are dropped; pairs on the same level are linked when a
 * capsule-wide straight walk between them is clear (and, up on decks, when
 * there is floor under the whole walk). Stairs add explicit links.
 */

const RADIUS = 0.42;
const LINK_RANGE = 16;

interface AABB {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  cyl: boolean;
  cx: number;
  cz: number;
  r: number;
}

/** World-space bounds of a (possibly tilted) box. */
export function boxBounds(b: Box): AABB {
  if (!b.tilt) {
    return { minX: b.x - b.hx, maxX: b.x + b.hx, minY: b.y - b.hy, maxY: b.y + b.hy, minZ: b.z - b.hz, maxZ: b.z + b.hz, cyl: !!b.cylinder, cx: b.x, cz: b.z, r: b.hx };
  }
  const c = Math.cos(b.tilt.angle);
  const s = Math.sin(b.tilt.angle);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        let x = sx * b.hx;
        let y = sy * b.hy;
        let z = sz * b.hz;
        if (b.tilt.axis === 'z') [x, y] = [x * c - y * s, x * s + y * c];
        else [y, z] = [y * c - z * s, y * s + z * c];
        minX = Math.min(minX, b.x + x);
        maxX = Math.max(maxX, b.x + x);
        minY = Math.min(minY, b.y + y);
        maxY = Math.max(maxY, b.y + y);
        minZ = Math.min(minZ, b.z + z);
        maxZ = Math.max(maxZ, b.z + z);
      }
  return { minX, maxX, minY, maxY, minZ, maxZ, cyl: false, cx: b.x, cz: b.z, r: 0 };
}

/** Does the 2D segment a->b come within `pad` of the box footprint? */
function segHits(a: V3, b: V3, box: AABB, pad: number): boolean {
  if (box.cyl) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((box.cx - a.x) * dx + (box.cz - a.z) * dz) / l2)) : 0;
    const px = a.x + dx * t - box.cx;
    const pz = a.z + dz * t - box.cz;
    return px * px + pz * pz < (box.r + pad) * (box.r + pad);
  }
  const minX = box.minX - pad;
  const maxX = box.maxX + pad;
  const minZ = box.minZ - pad;
  const maxZ = box.maxZ + pad;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const [p, d, lo, hi] of [
    [a.x, dx, minX, maxX],
    [a.z, dz, minZ, maxZ],
  ] as const) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return false;
    } else {
      let ta = (lo - p) / d;
      let tb = (hi - p) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/** Spatial hash of box bounds for fast segment queries. */
class BoxIndex {
  private readonly buckets = new Map<string, number[]>();
  readonly list: AABB[];
  constructor(
    boxes: AABB[],
    private readonly size = 8,
  ) {
    this.list = boxes;
    boxes.forEach((b, i) => {
      for (let gx = Math.floor((b.minX - 1) / size); gx <= Math.floor((b.maxX + 1) / size); gx++)
        for (let gz = Math.floor((b.minZ - 1) / size); gz <= Math.floor((b.maxZ + 1) / size); gz++) {
          const k = `${gx},${gz}`;
          let arr = this.buckets.get(k);
          if (!arr) this.buckets.set(k, (arr = []));
          arr.push(i);
        }
    });
  }
  near(minX: number, maxX: number, minZ: number, maxZ: number): Set<number> {
    const out = new Set<number>();
    for (let gx = Math.floor(minX / this.size); gx <= Math.floor(maxX / this.size); gx++)
      for (let gz = Math.floor(minZ / this.size); gz <= Math.floor(maxZ / this.size); gz++) for (const i of this.buckets.get(`${gx},${gz}`) ?? []) out.add(i);
    return out;
  }
}

export interface NavBuildInput {
  boxes: Box[];
  hints: NodeHint[];
  ramps: [V3, V3][];
  surfaces: Surface[];
  voids: Rect[];
  groundBridges: Rect[];
  extent: number;
}

export interface NavBuildResult extends NavGraph {
  /** Cell index for each node. */
  cells: number[];
  tags: (NodeHint['tag'] | undefined)[];
}

const inRect = (r: { minX: number; maxX: number; minZ: number; maxZ: number }, x: number, z: number, pad = 0) => x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;

export class NavChecker {
  private readonly index: BoxIndex;
  constructor(private readonly input: NavBuildInput) {
    this.index = new BoxIndex(input.boxes.filter((b) => b.solid !== false).map(boxBounds));
  }

  /** Character band [y + 0.15, y + 1.8] overlaps the box vertically. */
  private blocks(box: AABB, y: number): boolean {
    return box.maxY > y + 0.15 && box.minY < y + 1.8;
  }

  pointFree(p: V3): boolean {
    if (p.x < 0.5 || p.z < 0.5 || p.x > this.input.extent - 0.5 || p.z > this.input.extent - 0.5) return false;
    for (const i of this.index.near(p.x - 1, p.x + 1, p.z - 1, p.z + 1)) {
      const box = this.index.list[i]!;
      if (this.blocks(box, p.y) && segHits(p, p, box, RADIUS)) return false;
    }
    if (p.y < 0.5) return !this.inVoid(p.x, p.z);
    return this.supported(p.x, p.z, p.y);
  }

  inVoid(x: number, z: number): boolean {
    return this.input.voids.some((r) => inRect(r, x, z, RADIUS * 0.5)) && !this.input.groundBridges.some((r) => inRect(r, x, z));
  }

  supported(x: number, z: number, y: number): boolean {
    return this.input.surfaces.some((s) => Math.abs(s.y - y) < 0.3 && inRect(s, x, z, -0.1));
  }

  segmentClear(a: V3, b: V3): boolean {
    const y = Math.min(a.y, b.y);
    const near = this.index.near(Math.min(a.x, b.x) - 1, Math.max(a.x, b.x) + 1, Math.min(a.z, b.z) - 1, Math.max(a.z, b.z) + 1);
    for (const i of near) {
      const box = this.index.list[i]!;
      if (this.blocks(box, y) && segHits(a, b, box, RADIUS)) return false;
    }
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(len / 0.75));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      if (a.y < 0.5 ? this.inVoid(x, z) : !this.supported(x, z, a.y)) return false;
    }
    return true;
  }
}

export function buildNavGraph(input: NavBuildInput): NavBuildResult {
  const check = new NavChecker(input);
  const nodes: V3[] = [];
  const cells: number[] = [];
  const tags: (NodeHint['tag'] | undefined)[] = [];
  const find = (p: V3) => nodes.findIndex((n) => Math.abs(n.x - p.x) < 0.6 && Math.abs(n.z - p.z) < 0.6 && Math.abs(n.y - p.y) < 0.4);
  for (const h of input.hints) {
    if (find(h.pos) >= 0) continue;
    if (!check.pointFree(h.pos)) continue;
    nodes.push(v3(h.pos.x, h.pos.y, h.pos.z));
    cells.push(h.cell);
    tags.push(h.tag);
  }
  const links: number[][] = nodes.map(() => []);
  const link = (i: number, j: number) => {
    if (i === j || links[i]!.includes(j)) return;
    links[i]!.push(j);
    links[j]!.push(i);
  };
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]!;
      if (Math.abs(a.y - b.y) > 0.3) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > LINK_RANGE || d < 0.1) continue;
      if (check.segmentClear(a, b)) link(i, j);
    }
  }
  for (const [foot, top] of input.ramps) {
    const i = find(foot);
    const j = find(top);
    if (i >= 0 && j >= 0) link(i, j);
  }
  return { nodes, links, cells, tags };
}

/** Breadth-first reachability over the graph. */
export function reachableNodes(g: NavGraph, from: number): Set<number> {
  const seen = new Set<number>([from]);
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    for (const n of g.links[cur]!) {
      if (!seen.has(n)) {
        seen.add(n);
        q.push(n);
      }
    }
  }
  return seen;
}

/** Keep only `keep` nodes, re-indexing links. */
export function pruneGraph(g: NavBuildResult, keep: Set<number>): NavBuildResult {
  const map = new Map<number, number>();
  const nodes: V3[] = [];
  const cells: number[] = [];
  const tags: (NodeHint['tag'] | undefined)[] = [];
  g.nodes.forEach((n, i) => {
    if (!keep.has(i)) return;
    map.set(i, nodes.length);
    nodes.push(n);
    cells.push(g.cells[i]!);
    tags.push(g.tags[i]);
  });
  const links = nodes.map(() => [] as number[]);
  g.links.forEach((ls, i) => {
    const a = map.get(i);
    if (a === undefined) return;
    for (const j of ls) {
      const b = map.get(j);
      if (b !== undefined) links[a]!.push(b);
    }
  });
  return { nodes, links, cells, tags };
}

export function nearestNode(g: NavGraph, p: V3, maxDy = 1.6): number {
  let best = -1;
  let bd = Infinity;
  g.nodes.forEach((n, i) => {
    if (Math.abs(n.y - p.y) > maxDy) return;
    const d = Math.hypot(n.x - p.x, n.z - p.z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}
