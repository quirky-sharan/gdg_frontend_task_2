/**
 * Dependency graph between cells.
 *
 * Edges point from a precedent (a cell that is read) to a dependent (a formula
 * that reads it). Single-cell references are stored as explicit reverse edges.
 * Range references are *not* expanded cell-by-cell — SUM(A1:A100000) would
 * otherwise create 100k edges — but kept in a spatial index of row blocks, so
 * "which formulas read cell X?" stays fast for both kinds of reference.
 */
import { keyCol, keyRow, MAX_COLS, rangeContains, type RangeBounds } from './address';

interface RangeDependency extends RangeBounds {
  dependent: number;
}

/** Rows per bucket of the range index. */
const BLOCK_ROWS = 256;

class RangeIndex {
  private readonly buckets = new Map<number, Set<RangeDependency>>();

  private *bucketKeys(r: RangeBounds): Generator<number> {
    const firstBlock = Math.floor(r.top / BLOCK_ROWS);
    const lastBlock = Math.floor(r.bottom / BLOCK_ROWS);
    for (let b = firstBlock; b <= lastBlock; b++) {
      for (let c = r.left; c <= r.right; c++) yield b * MAX_COLS + c;
    }
  }

  add(dep: RangeDependency): void {
    for (const k of this.bucketKeys(dep)) {
      let set = this.buckets.get(k);
      if (!set) this.buckets.set(k, (set = new Set()));
      set.add(dep);
    }
  }

  remove(dep: RangeDependency): void {
    for (const k of this.bucketKeys(dep)) {
      const set = this.buckets.get(k);
      if (!set) continue;
      set.delete(dep);
      if (set.size === 0) this.buckets.delete(k);
    }
  }

  /** Appends the formulas whose referenced ranges contain (row, col) to `out` (may repeat a formula). */
  query(row: number, col: number, out: number[]): void {
    const set = this.buckets.get(Math.floor(row / BLOCK_ROWS) * MAX_COLS + col);
    if (!set) return;
    for (const dep of set) {
      if (rangeContains(dep, row, col)) out.push(dep.dependent);
    }
  }
}

export interface Precedents {
  cells: number[];
  ranges: RangeBounds[];
}

export class DependencyGraph {
  private readonly precedents = new Map<number, { cells: number[]; ranges: RangeDependency[] }>();
  private readonly cellDependents = new Map<number, Set<number>>();
  private readonly rangeIndex = new RangeIndex();

  /** Replaces the outgoing references of a formula cell. */
  setPrecedents(key: number, cells: number[], ranges: RangeBounds[]): void {
    this.clearPrecedents(key);
    if (cells.length === 0 && ranges.length === 0) return;
    for (const c of cells) {
      let set = this.cellDependents.get(c);
      if (!set) this.cellDependents.set(c, (set = new Set()));
      set.add(key);
    }
    const rangeDeps = ranges.map((r) => ({ ...r, dependent: key }));
    for (const d of rangeDeps) this.rangeIndex.add(d);
    this.precedents.set(key, { cells: [...cells], ranges: rangeDeps });
  }

  clearPrecedents(key: number): void {
    const prev = this.precedents.get(key);
    if (!prev) return;
    for (const c of prev.cells) {
      const set = this.cellDependents.get(c);
      if (!set) continue;
      set.delete(key);
      if (set.size === 0) this.cellDependents.delete(c);
    }
    for (const d of prev.ranges) this.rangeIndex.remove(d);
    this.precedents.delete(key);
  }

  getPrecedents(key: number): Precedents | undefined {
    const p = this.precedents.get(key);
    if (!p) return undefined;
    return {
      cells: p.cells,
      ranges: p.ranges.map(({ top, left, bottom, right }) => ({ top, left, bottom, right })),
    };
  }

  /**
   * Formula cells that directly read `key` (through a single reference or a range).
   * This is the hot path of recalculation, so it may contain duplicates (a formula
   * that reads the cell both directly and via a range); graph traversal tolerates that.
   */
  getDependents(key: number): number[] {
    const direct = this.cellDependents.get(key);
    const out = direct ? Array.from(direct) : [];
    this.rangeIndex.query(keyRow(key), keyCol(key), out);
    return out;
  }

  /** True when `key` reads `target`, directly or via a range. */
  references(key: number, target: number): boolean {
    const p = this.precedents.get(key);
    if (!p) return false;
    if (p.cells.includes(target)) return true;
    const row = keyRow(target);
    const col = keyCol(target);
    return p.ranges.some((r) => rangeContains(r, row, col));
  }

  get formulaCount(): number {
    return this.precedents.size;
  }
}
