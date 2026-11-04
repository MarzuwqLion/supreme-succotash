import type { Rng } from '../../core/rng';
import { v3, type V3 } from '../../core/vec';
import { tuning } from '../../data/tuning';
import { DIRS, opposite, type Cell, type Dir } from './layout';

/** Grid helpers shared by the generator stages. */

export const gridN = () => tuning.gen.gridSize;
export const blockS = () => tuning.gen.blockSize;
export const idx = (i: number, j: number) => j * gridN() + i;
export const inBounds = (i: number, j: number) => i >= 0 && j >= 0 && i < gridN() && j < gridN();
export const cellCenter = (c: { i: number; j: number }): V3 => v3((c.i + 0.5) * blockS(), 0, (c.j + 0.5) * blockS());
export const ALL_DIRS: readonly Dir[] = [0, 1, 2, 3];

export function makeGrid(): Cell[] {
  const cells: Cell[] = [];
  for (let j = 0; j < gridN(); j++) for (let i = 0; i < gridN(); i++) cells.push({ i, j, type: 'building', conn: [false, false, false, false] });
  return cells;
}

export function neighbor(cells: Cell[], c: Cell, d: Dir): Cell | null {
  const { di, dj } = DIRS[d]!;
  const ni = c.i + di;
  const nj = c.j + dj;
  return inBounds(ni, nj) ? cells[idx(ni, nj)]! : null;
}

export function connect(cells: Cell[], a: Cell, d: Dir): void {
  const b = neighbor(cells, a, d);
  if (!b) return;
  a.conn[d] = true;
  b.conn[opposite(d)] = true;
}

export const walkable = (c: Cell) => c.type !== 'building';
export const isOpen = (c: Cell | null) => !!c && (c.type === 'street' || c.type === 'piazza' || c.type === 'canal');
export const connCount = (c: Cell) => c.conn.filter(Boolean).length;

/** BFS over open connections. Returns the cell path (indices) or null. */
export function findCellPath(cells: Cell[], from: number, to: number): number[] | null {
  const prev = new Map<number, number>();
  const q = [from];
  prev.set(from, -1);
  while (q.length) {
    const cur = q.shift()!;
    if (cur === to) break;
    const c = cells[cur]!;
    for (const d of ALL_DIRS) {
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

export function reachableCells(cells: Cell[], from: number): Set<number> {
  const seen = new Set<number>([from]);
  const q = [from];
  while (q.length) {
    const c = cells[q.shift()!]!;
    for (const d of ALL_DIRS) {
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

/** Carve a monotone-ish lane path so a route always exists. */
export function carvePath(cells: Cell[], rng: Rng, from: Cell, to: Cell): void {
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
    // Canal cells only connect across at bridges, so carving turns them into bridged crossings.
    if (next.type === 'canal') next.bridge = true;
    if (cur.type === 'canal') cur.bridge = true;
    if (!walkable(next)) next.type = 'street';
    connect(cells, cur, d);
    cur = next;
  }
}
