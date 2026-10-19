import { formatRange, MAX_COLS, rangeArea, toKey, type RangeBounds } from './address';
import { isError, propagatedError, type CellValue } from './values';

/** Read access to computed cell values; implemented by the engine. */
export interface CellReader {
  getValue(row: number, col: number): CellValue;
  /** Smallest row/col bounds containing every non-empty cell (-1 when the sheet is empty). */
  usedBounds(): { maxRow: number; maxCol: number };
  /** Number of non-empty cells in the sheet. */
  populatedCount(): number;
  /** Visits all non-empty cells (in no particular order). */
  forEachPopulated(cb: (key: number, value: CellValue) => void): void;
}

/**
 * A rectangular block of cells passed to a function (e.g. the A1:B10 in SUM(A1:B10)).
 *
 * Values are read lazily, and iteration is clamped to the used area of the sheet so
 * whole-column references like A:A stay cheap. Error values read through a range are
 * re-wrapped so that diagnostics point at the range inside the current formula.
 */
export class RangeValue {
  constructor(
    readonly bounds: RangeBounds,
    private readonly reader: CellReader,
    private readonly span?: { start: number; end: number },
  ) {}

  get rows(): number {
    return this.bounds.bottom - this.bounds.top + 1;
  }

  get cols(): number {
    return this.bounds.right - this.bounds.left + 1;
  }

  get area(): number {
    return rangeArea(this.bounds);
  }

  get label(): string {
    return formatRange(this.bounds);
  }

  /** Value at a position relative to the top-left corner of the range. */
  get(r: number, c: number): CellValue {
    const row = this.bounds.top + r;
    const col = this.bounds.left + c;
    return this.wrap(this.reader.getValue(row, col), row, col);
  }

  /** A sub-range given relative, inclusive coordinates (used by INDEX). */
  sub(top: number, left: number, bottom: number, right: number): RangeValue {
    const b = this.bounds;
    return new RangeValue(
      { top: b.top + top, left: b.left + left, bottom: b.top + bottom, right: b.left + right },
      this.reader,
      this.span,
    );
  }

  /** Number of rows / columns that can contain data (clamped to the used area). */
  effectiveRows(): number {
    const { maxRow } = this.reader.usedBounds();
    return Math.max(0, Math.min(this.bounds.bottom, maxRow) - this.bounds.top + 1);
  }

  effectiveCols(): number {
    const { maxCol } = this.reader.usedBounds();
    return Math.max(0, Math.min(this.bounds.right, maxCol) - this.bounds.left + 1);
  }

  /**
   * Visits every non-empty cell in row-major order. Large, sparse ranges are
   * walked via the sheet's populated cells instead of cell-by-cell.
   */
  forEachNonEmpty(cb: (value: CellValue, row: number, col: number) => void): void {
    const { top, left } = this.bounds;
    const { maxRow, maxCol } = this.reader.usedBounds();
    const bottom = Math.min(this.bounds.bottom, maxRow);
    const right = Math.min(this.bounds.right, maxCol);
    if (bottom < top || right < left) return;
    const area = (bottom - top + 1) * (right - left + 1);

    if (area <= 4096 || area <= this.reader.populatedCount() * 2) {
      for (let row = top; row <= bottom; row++) {
        for (let col = left; col <= right; col++) {
          const v = this.reader.getValue(row, col);
          if (v !== null) cb(this.wrap(v, row, col), row, col);
        }
      }
      return;
    }

    const hits: Array<[number, CellValue]> = [];
    this.reader.forEachPopulated((key, value) => {
      const row = Math.floor(key / MAX_COLS);
      const col = key % MAX_COLS;
      if (row >= top && row <= bottom && col >= left && col <= right && value !== null) hits.push([key, value]);
    });
    hits.sort((a, b) => a[0] - b[0]);
    for (const [key, value] of hits) {
      const row = Math.floor(key / MAX_COLS);
      const col = key % MAX_COLS;
      cb(this.wrap(value, row, col), row, col);
    }
  }

  private wrap(v: CellValue, row: number, col: number): CellValue {
    if (!isError(v)) return v;
    const start = this.span?.start ?? 0;
    const end = this.span?.end ?? 0;
    return propagatedError(v, toKey(row, col), start, end);
  }
}

export type Value = CellValue | RangeValue;
