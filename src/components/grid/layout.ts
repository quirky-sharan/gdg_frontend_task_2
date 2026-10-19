import { MAX_COLS, type RangeBounds } from '../../engine';
import { ROW_HEIGHT } from '../../state/store';

/** Prefix sums of column widths: colX[c] is the left edge of column c, colX[MAX_COLS] the total width. */
export function columnOffsets(widths: number[]): Float64Array {
  const xs = new Float64Array(MAX_COLS + 1);
  for (let c = 0; c < MAX_COLS; c++) xs[c + 1] = xs[c] + widths[c];
  return xs;
}

/** Index of the column containing x (binary search over the prefix sums). */
export function columnAt(colX: Float64Array, x: number): number {
  if (x <= 0) return 0;
  let lo = 0;
  let hi = MAX_COLS - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (colX[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function rangeRect(colX: Float64Array, r: RangeBounds) {
  return {
    left: colX[r.left],
    top: r.top * ROW_HEIGHT,
    width: colX[r.right + 1] - colX[r.left],
    height: (r.bottom - r.top + 1) * ROW_HEIGHT,
  };
}

export interface VisibleWindow {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

/** The scrollable grid element, so editors can hand keyboard focus back to it. */
let gridElement: HTMLElement | null = null;

export function registerGridElement(el: HTMLElement | null) {
  gridElement = el;
}

export function focusGrid() {
  gridElement?.focus({ preventScroll: true });
}
