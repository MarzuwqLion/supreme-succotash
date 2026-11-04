import type { V3 } from '../core/vec';
import type { AreaLayout, NavGraph } from './gen/layout';

/**
 * Pathfinding over the generator's navigation graph (A*). Nodes carry real
 * heights, so routes climb stairs onto elevated promenades and bridges.
 * `clear` tests a straight walk between two points (the sim passes a
 * physics-backed check), used to pick start and goal nodes.
 */
export class Nav {
  private readonly graph: NavGraph;
  private readonly cost: number[][];

  constructor(
    private readonly layout: AreaLayout,
    private readonly clear: (a: V3, b: V3) => boolean = () => true,
  ) {
    this.graph = layout.nav;
    this.cost = this.graph.links.map((ls, i) => ls.map((j) => dist3(this.graph.nodes[i]!, this.graph.nodes[j]!)));
  }

  get nodes(): readonly V3[] {
    return this.graph.nodes;
  }

  cellOf(p: V3): number {
    const { gridSize: n, blockSize: b } = this.layout;
    const i = Math.floor(p.x / b);
    const j = Math.floor(p.z / b);
    if (i < 0 || j < 0 || i >= n || j >= n) return -1;
    return j * n + i;
  }

  /** Closest node on the same level that can be walked to in a straight line. */
  nearest(p: V3, maxCandidates = 6): number {
    const cands: { i: number; d: number }[] = [];
    this.graph.nodes.forEach((n, i) => {
      if (Math.abs(n.y - p.y) > 1.6) return;
      cands.push({ i, d: Math.hypot(n.x - p.x, n.z - p.z) });
    });
    cands.sort((a, b) => a.d - b.d);
    for (const c of cands.slice(0, maxCandidates)) if (this.clear(p, this.graph.nodes[c.i]!)) return c.i;
    return cands[0]?.i ?? -1;
  }

  /** A* between two node indices; returns node indices or null. */
  path(from: number, to: number): number[] | null {
    if (from < 0 || to < 0) return null;
    if (from === to) return [from];
    const nodes = this.graph.nodes;
    const g = new Map<number, number>([[from, 0]]);
    const prev = new Map<number, number>();
    const open: { i: number; f: number }[] = [{ i: from, f: dist3(nodes[from]!, nodes[to]!) }];
    const closed = new Set<number>();
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (open[k]!.f < open[bi]!.f) bi = k;
      const cur = open.splice(bi, 1)[0]!.i;
      if (cur === to) break;
      if (closed.has(cur)) continue;
      closed.add(cur);
      const links = this.graph.links[cur]!;
      for (let k = 0; k < links.length; k++) {
        const n = links[k]!;
        if (closed.has(n)) continue;
        const ng = g.get(cur)! + this.cost[cur]![k]!;
        if (ng < (g.get(n) ?? Infinity)) {
          g.set(n, ng);
          prev.set(n, cur);
          open.push({ i: n, f: ng + dist3(nodes[n]!, nodes[to]!) });
        }
      }
    }
    if (!prev.has(to)) return null;
    const out: number[] = [];
    for (let cur: number | undefined = to; cur !== undefined; cur = prev.get(cur)) out.push(cur);
    return out.reverse();
  }

  /** Waypoints from `from` to `to`, ending exactly at `to`. */
  waypoints(from: V3, to: V3): V3[] {
    if (this.clear(from, to) && Math.abs(from.y - to.y) < 0.5 && Math.hypot(from.x - to.x, from.z - to.z) < 20) return [to];
    const a = this.nearest(from);
    const b = this.nearest(to);
    const p = this.path(a, b);
    if (!p) return [to];
    return [...p.map((i) => this.graph.nodes[i]!), to];
  }
}

function dist3(a: V3, b: V3): number {
  return Math.hypot(a.x - b.x, (a.y - b.y) * 1.5, a.z - b.z);
}
