import { distXZ, v3, type V3 } from '../core/vec';
import { cellCenter, findCellPath } from './gen/generator';
import { DIRS, type AreaLayout } from './gen/layout';

/**
 * Coarse navigation over the generator's cell graph. Every piece keeps its
 * centre and the straight lanes to connected edges clear, so routing
 * centre -> edge midpoint -> centre is always walkable.
 */
export class Nav {
  constructor(private readonly layout: AreaLayout) {}

  cellOf(p: V3): number {
    const { gridSize: n, blockSize: b } = this.layout;
    const i = Math.floor(p.x / b);
    const j = Math.floor(p.z / b);
    if (i < 0 || j < 0 || i >= n || j >= n) return -1;
    return j * n + i;
  }

  /** Waypoints from `from` to `to`, ending exactly at `to`. */
  waypoints(from: V3, to: V3): V3[] {
    const a = this.cellOf(from);
    const b = this.cellOf(to);
    if (a < 0 || b < 0 || a === b) return [to];
    const path = findCellPath(this.layout.cells, a, b);
    if (!path) return [to];
    const out: V3[] = [];
    const cells = this.layout.cells;
    const startCenter = cellCenter(cells[a]!);
    if (distXZ(from, startCenter) > 1.0) out.push(startCenter);
    for (let k = 1; k < path.length; k++) {
      const pa = cells[path[k - 1]!]!;
      const pb = cells[path[k]!]!;
      const ca = cellCenter(pa);
      const cb = cellCenter(pb);
      out.push(v3((ca.x + cb.x) / 2, 0, (ca.z + cb.z) / 2));
      if (k < path.length - 1) out.push(cb);
    }
    out.push(to);
    return out;
  }

  /** Are two cells directly connected? */
  connected(a: number, b: number): boolean {
    const ca = this.layout.cells[a];
    const cb = this.layout.cells[b];
    if (!ca || !cb) return false;
    for (let d = 0; d < 4; d++) {
      if (ca.i + DIRS[d]!.di === cb.i && ca.j + DIRS[d]!.dj === cb.j) return ca.conn[d]!;
    }
    return false;
  }
}
