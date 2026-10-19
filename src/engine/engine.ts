/**
 * SpreadsheetEngine — owns cell contents, the dependency graph and recalculation.
 *
 * Recalculation after an edit:
 *   1. The edited cells are re-compiled and their outgoing edges replaced.
 *   2. Starting from the edited cells (plus volatile cells), an iterative Tarjan
 *      SCC traversal walks precedent -> dependent edges. This visits exactly the
 *      cells affected by the change and nothing else.
 *   3. Tarjan emits strongly connected components in reverse topological order,
 *      so walking the output backwards evaluates every cell after all of its
 *      precedents — each affected cell is evaluated exactly once.
 *   4. Components with more than one cell (or a cell that reads itself) are
 *      circular references: their cells get a #CIRC! error describing the cycle
 *      instead of being evaluated, so cycles can never loop or overflow the stack.
 *
 * Everything is iterative, so chains of 100k+ dependent cells are fine.
 */
import {
  formatAddress,
  formatRange,
  keyCol,
  keyRow,
  keyToAddress,
  rangeArea,
  rangeContains,
  toKey,
  type RangeBounds,
} from './address';
import { walk } from './ast';
import { compileFormula, type CompiledFormula } from './compile';
import { DependencyGraph, type Precedents } from './dependency-graph';
import { Evaluator } from './evaluator';
import type { CellReader } from './range';
import { isError, parseLiteral, SheetError, type CellValue } from './values';

export interface CellRecord {
  /** Exactly what the user typed. */
  readonly input: string;
  /** Computed value (literal value for non-formula cells). */
  value: CellValue;
  /** Compiled formula; absent for literals and formulas that failed to compile. */
  readonly formula?: CompiledFormula;
}

export interface CellInput {
  row: number;
  col: number;
  input: string;
}

export interface RecalcResult {
  /** Keys of every cell that was edited or recomputed. */
  updated: number[];
  /** Number of formula evaluations performed. */
  evaluated: number;
  /** Circular references found during this pass (lists of cell keys). */
  cycles: number[][];
  durationMs: number;
}

type Listener = (result: RecalcResult) => void;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class SpreadsheetEngine implements CellReader {
  private readonly cells = new Map<number, CellRecord>();
  private readonly graph = new DependencyGraph();
  private readonly volatileCells = new Set<number>();
  private readonly errorCells = new Set<number>();
  private readonly evaluator = new Evaluator(this);
  private readonly listeners = new Set<Listener>();
  private maxRow = -1;
  private maxCol = -1;
  private boundsDirty = false;

  // ------------------------------------------------------------------ CellReader

  getValue(row: number, col: number): CellValue {
    const rec = this.cells.get(toKey(row, col));
    return rec ? rec.value : null;
  }

  usedBounds(): { maxRow: number; maxCol: number } {
    if (this.boundsDirty) {
      this.maxRow = -1;
      this.maxCol = -1;
      for (const key of this.cells.keys()) this.extendBounds(key);
      this.boundsDirty = false;
    }
    return { maxRow: this.maxRow, maxCol: this.maxCol };
  }

  populatedCount(): number {
    return this.cells.size;
  }

  forEachPopulated(cb: (key: number, value: CellValue) => void): void {
    for (const [key, rec] of this.cells) cb(key, rec.value);
  }

  // ------------------------------------------------------------------ queries

  getCell(row: number, col: number): CellRecord | undefined {
    return this.cells.get(toKey(row, col));
  }

  getInput(row: number, col: number): string {
    return this.cells.get(toKey(row, col))?.input ?? '';
  }

  getPrecedents(row: number, col: number): Precedents | undefined {
    return this.graph.getPrecedents(toKey(row, col));
  }

  getDependents(row: number, col: number): number[] {
    return [...new Set(this.graph.getDependents(toKey(row, col)))].sort((a, b) => a - b);
  }

  /** Keys of cells currently holding an error value, in row-major order. */
  getErrorCells(): number[] {
    return [...this.errorCells].sort((a, b) => a - b);
  }

  /** Keys of non-empty cells inside `bounds`, in row-major order. */
  keysInRange(bounds: RangeBounds): number[] {
    const out: number[] = [];
    const { maxRow, maxCol } = this.usedBounds();
    const b = {
      top: bounds.top,
      left: bounds.left,
      bottom: Math.min(bounds.bottom, maxRow),
      right: Math.min(bounds.right, maxCol),
    };
    if (b.bottom < b.top || b.right < b.left) return out;
    if (rangeArea(b) <= this.cells.size * 2) {
      for (let r = b.top; r <= b.bottom; r++) {
        for (let c = b.left; c <= b.right; c++) {
          const k = toKey(r, c);
          if (this.cells.has(k)) out.push(k);
        }
      }
      return out;
    }
    for (const k of this.cells.keys()) if (rangeContains(b, keyRow(k), keyCol(k))) out.push(k);
    return out.sort((x, y) => x - y);
  }

  get stats(): { cells: number; formulas: number; errors: number } {
    return { cells: this.cells.size, formulas: this.graph.formulaCount, errors: this.errorCells.size };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ------------------------------------------------------------------ updates

  setCell(row: number, col: number, input: string): RecalcResult {
    return this.setCells([{ row, col, input }]);
  }

  /** Applies a batch of edits and recalculates everything they affect, once. */
  setCells(changes: readonly CellInput[]): RecalcResult {
    const t0 = now();
    const roots: number[] = [];
    for (const ch of changes) {
      const key = toKey(ch.row, ch.col);
      this.applyInput(key, ch.input);
      roots.push(key);
    }
    for (const v of this.volatileCells) roots.push(v);
    const result = this.recalculate(roots);
    result.durationMs = now() - t0;
    for (const l of this.listeners) l(result);
    return result;
  }

  /** Removes all cells and loads new contents (e.g. opening a file). */
  load(contents: readonly CellInput[]): RecalcResult {
    this.cells.clear();
    this.errorCells.clear();
    this.volatileCells.clear();
    for (const key of [...this.allFormulaKeys()]) this.graph.clearPrecedents(key);
    this.maxRow = -1;
    this.maxCol = -1;
    this.boundsDirty = false;
    return this.setCells(contents);
  }

  /** Full recalculation of every cell (F9). */
  recalculateAll(): RecalcResult {
    const t0 = now();
    const result = this.recalculate([...this.cells.keys()]);
    result.durationMs = now() - t0;
    for (const l of this.listeners) l(result);
    return result;
  }

  private *allFormulaKeys(): Generator<number> {
    for (const [key, rec] of this.cells) if (rec.formula) yield key;
  }

  private extendBounds(key: number): void {
    const r = keyRow(key);
    const c = keyCol(key);
    if (r > this.maxRow) this.maxRow = r;
    if (c > this.maxCol) this.maxCol = c;
  }

  private applyInput(key: number, input: string): void {
    this.graph.clearPrecedents(key);
    this.volatileCells.delete(key);
    if (input === '') {
      if (this.cells.delete(key) && (keyRow(key) === this.maxRow || keyCol(key) === this.maxCol)) {
        this.boundsDirty = true;
      }
      this.errorCells.delete(key);
      return;
    }
    let record: CellRecord;
    if (input.startsWith('=')) {
      const compiled = compileFormula(input);
      if (compiled.ok) {
        record = { input, value: null, formula: compiled.formula };
        this.graph.setPrecedents(key, compiled.formula.cells, compiled.formula.ranges);
        if (compiled.formula.volatile) this.volatileCells.add(key);
      } else {
        record = { input, value: compiled.error };
      }
    } else {
      record = { input, value: parseLiteral(input) };
    }
    this.cells.set(key, record);
    if (!this.boundsDirty) this.extendBounds(key);
  }

  // ------------------------------------------------------------------ recalculation

  private recalculate(roots: number[]): RecalcResult {
    const components = this.stronglyConnectedComponents(roots);
    const updated: number[] = [];
    const cycles: number[][] = [];
    let evaluated = 0;

    // Tarjan emits dependents before their precedents; iterate backwards for topological order.
    for (let i = components.length - 1; i >= 0; i--) {
      const scc = components[i];
      if (scc.length > 1 || this.graph.references(scc[0], scc[0])) {
        cycles.push(scc);
        this.markCycle(scc);
        for (const key of scc) {
          updated.push(key);
          this.trackError(key);
        }
        continue;
      }
      const key = scc[0];
      const rec = this.cells.get(key);
      if (rec?.formula) {
        rec.value = this.evaluator.evaluateFormula(rec.formula.ast, {
          row: keyRow(key),
          col: keyCol(key),
          formula: rec.input,
        });
        evaluated++;
      }
      updated.push(key);
      this.trackError(key);
    }
    return { updated, evaluated, cycles, durationMs: 0 };
  }

  private trackError(key: number): void {
    const rec = this.cells.get(key);
    if (rec && isError(rec.value)) this.errorCells.add(key);
    else this.errorCells.delete(key);
  }

  /**
   * Iterative Tarjan over precedent -> dependent edges reachable from `roots`.
   * Visited cells get dense ids (visit order) so the per-edge bookkeeping uses
   * plain arrays instead of hash-map lookups.
   */
  private stronglyConnectedComponents(roots: number[]): number[][] {
    const idOf = new Map<number, number>();
    const keyOf: number[] = [];
    const low: number[] = [];
    const onStack: boolean[] = [];
    const stack: number[] = [];
    const components: number[][] = [];
    const frames: Array<{ id: number; succ: number[]; i: number }> = [];

    const visit = (key: number) => {
      const id = keyOf.length;
      idOf.set(key, id);
      keyOf.push(key);
      low.push(id);
      onStack.push(true);
      stack.push(id);
      frames.push({ id, succ: this.graph.getDependents(key), i: 0 });
    };

    for (const root of roots) {
      if (idOf.has(root)) continue;
      visit(root);
      while (frames.length > 0) {
        const frame = frames[frames.length - 1];
        if (frame.i < frame.succ.length) {
          const w = frame.succ[frame.i++];
          const wid = idOf.get(w);
          if (wid === undefined) visit(w);
          else if (onStack[wid] && wid < low[frame.id]) low[frame.id] = wid;
          continue;
        }
        frames.pop();
        if (low[frame.id] === frame.id) {
          const component: number[] = [];
          let w: number;
          do {
            w = stack.pop()!;
            onStack[w] = false;
            component.push(keyOf[w]);
          } while (w !== frame.id);
          components.push(component);
        }
        if (frames.length > 0) {
          const parent = frames[frames.length - 1];
          if (low[frame.id] < low[parent.id]) low[parent.id] = low[frame.id];
        }
      }
    }
    return components;
  }

  // ------------------------------------------------------------------ circular references

  /** Precedents of `key` that belong to the component `members`. */
  private precedentsWithin(key: number, members: Set<number>): number[] {
    const p = this.graph.getPrecedents(key);
    if (!p) return [];
    const out = p.cells.filter((c) => members.has(c));
    if (p.ranges.length > 0) {
      for (const m of members) {
        if (p.ranges.some((r) => rangeContains(r, keyRow(m), keyCol(m))) && !out.includes(m)) out.push(m);
      }
    }
    return out;
  }

  /** Shortest cycle start -> ... -> start following "depends on" edges inside the component. */
  private findCycle(start: number, members: Set<number>): number[] {
    const parent = new Map<number, number>();
    const queue = [start];
    for (let qi = 0; qi < queue.length; qi++) {
      const u = queue[qi];
      for (const v of this.precedentsWithin(u, members)) {
        if (v === start) {
          const path = [start];
          for (let x = u; x !== start; x = parent.get(x)!) path.push(x);
          // path is [start, u, parent(u), ...] reversed order of discovery; rebuild forwards.
          const forward = [start, ...path.slice(1).reverse()];
          return [...forward, start];
        }
        if (!parent.has(v) && v !== start) {
          parent.set(v, u);
          queue.push(v);
        }
      }
    }
    return [start, start];
  }

  private markCycle(scc: number[]): void {
    const members = new Set(scc);
    const describe = (path: number[]) => {
      const labels = path.map(keyToAddress);
      return labels.length > 9 ? `${labels.slice(0, 4).join(' → ')} → … → ${labels.slice(-2).join(' → ')}` : labels.join(' → ');
    };
    const cycle = this.findCycle(scc[0], members);
    const cyclePos = new Map<number, number>();
    cycle.slice(0, -1).forEach((k, i) => cyclePos.set(k, i));

    for (const key of scc) {
      const rec = this.cells.get(key);
      if (!rec?.formula) continue;
      // Rotate the cycle so it starts at this cell, when the cell is on it.
      let path: number[];
      const pos = cyclePos.get(key);
      if (pos !== undefined) {
        const ring = cycle.slice(0, -1);
        path = [...ring.slice(pos), ...ring.slice(0, pos), key];
      } else {
        path = this.findCycle(key, members);
      }
      const next = path[1];
      const span = this.referenceSpan(rec.formula, next, members);
      const self = scc.length === 1;
      const address = keyToAddress(key);
      let message: string;
      if (self) {
        message =
          span?.kind === 'range'
            ? `Circular reference: ${address} is inside the range ${span.label} that it refers to.`
            : `Circular reference: ${address} refers to itself.`;
      } else {
        message = `Circular reference: ${describe(path)}.`;
      }
      rec.value = new SheetError('#CIRC!', message, {
        start: span?.start,
        end: span?.end,
        suggestion: self
          ? `Remove the reference to ${address}, or move the formula to a cell outside ${span?.label ?? 'the referenced range'}.`
          : `Break the loop: change the formula so it no longer depends on ${keyToAddress(next)}, or move it to a cell outside the cycle.`,
      });
    }
  }

  /** Location of the reference (cell or range) inside a formula that points at `target`. */
  private referenceSpan(
    formula: CompiledFormula,
    target: number,
    members: Set<number>,
  ): { start: number; end: number; kind: 'cell' | 'range'; label: string } | undefined {
    let found: { start: number; end: number; kind: 'cell' | 'range'; label: string } | undefined;
    let fallback: typeof found;
    const tr = keyRow(target);
    const tc = keyCol(target);
    walk(formula.ast, (n) => {
      if (found) return;
      if (n.type === 'cell') {
        const k = toKey(n.row, n.col);
        const hit = { start: n.start, end: n.end, kind: 'cell' as const, label: formatAddress(n.row, n.col) };
        if (k === target) found = hit;
        else if (!fallback && members.has(k)) fallback = hit;
      } else if (n.type === 'range') {
        const hit = { start: n.start, end: n.end, kind: 'range' as const, label: formatRange(n) };
        if (rangeContains(n, tr, tc)) found = hit;
      }
    });
    return found ?? fallback;
  }
}

