/**
 * Cell addressing helpers.
 *
 * Internally a cell is identified by a zero-based (row, col) pair, packed into a
 * single integer key (`row * MAX_COLS + col`) so that maps and sets stay cheap
 * and keys sort in row-major order.
 */

/** Number of rows in the sheet (1-based labels 1..MAX_ROWS). */
export const MAX_ROWS = 100_000;
/** Number of columns in the sheet (A..ZZ). */
export const MAX_COLS = 702;

export interface CellPos {
  row: number;
  col: number;
}

export interface RangeBounds {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export function toKey(row: number, col: number): number {
  return row * MAX_COLS + col;
}

export function keyRow(key: number): number {
  return Math.floor(key / MAX_COLS);
}

export function keyCol(key: number): number {
  return key % MAX_COLS;
}

export function fromKey(key: number): CellPos {
  return { row: keyRow(key), col: keyCol(key) };
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA" */
export function colToLetters(col: number): string {
  let n = col + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** "A" -> 0, "AA" -> 26. Returns -1 for anything that is not 1+ letters. */
export function lettersToCol(letters: string): number {
  if (!/^[A-Za-z]+$/.test(letters)) return -1;
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

export function isValidPos(row: number, col: number): boolean {
  return row >= 0 && row < MAX_ROWS && col >= 0 && col < MAX_COLS;
}

export function formatAddress(row: number, col: number, absRow = false, absCol = false): string {
  return `${absCol ? '$' : ''}${colToLetters(col)}${absRow ? '$' : ''}${row + 1}`;
}

export function keyToAddress(key: number): string {
  return formatAddress(keyRow(key), keyCol(key));
}

export function formatRange(r: RangeBounds): string {
  if (r.top === r.bottom && r.left === r.right) return formatAddress(r.top, r.left);
  if (r.top === 0 && r.bottom === MAX_ROWS - 1) return `${colToLetters(r.left)}:${colToLetters(r.right)}`;
  if (r.left === 0 && r.right === MAX_COLS - 1) return `${r.top + 1}:${r.bottom + 1}`;
  return `${formatAddress(r.top, r.left)}:${formatAddress(r.bottom, r.right)}`;
}

const ADDRESS_RE = /^\$?([A-Za-z]{1,3})\$?([0-9]{1,7})$/;

/** Parses "B12" / "$B$12" into a position; returns null when malformed or out of bounds. */
export function parseAddress(text: string): CellPos | null {
  const m = ADDRESS_RE.exec(text.trim());
  if (!m) return null;
  const col = lettersToCol(m[1]);
  const row = Number(m[2]) - 1;
  return isValidPos(row, col) ? { row, col } : null;
}

/** Parses "A1", "A1:C3", "A:C" or "2:5" into normalized bounds. */
export function parseRange(text: string): RangeBounds | null {
  const t = text.trim();
  const parts = t.split(':');
  if (parts.length === 1) {
    const p = parseAddress(t);
    return p ? { top: p.row, left: p.col, bottom: p.row, right: p.col } : null;
  }
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  const pa = parseAddress(a);
  const pb = parseAddress(b);
  if (pa && pb) return normalizeRange(pa.row, pa.col, pb.row, pb.col);
  const ca = lettersToCol(a.replace(/\$/g, ''));
  const cb = lettersToCol(b.replace(/\$/g, ''));
  if (ca >= 0 && cb >= 0 && ca < MAX_COLS && cb < MAX_COLS) return normalizeRange(0, ca, MAX_ROWS - 1, cb);
  if (/^\$?\d+$/.test(a) && /^\$?\d+$/.test(b)) {
    const ra = Number(a.replace('$', '')) - 1;
    const rb = Number(b.replace('$', '')) - 1;
    if (ra >= 0 && rb >= 0 && ra < MAX_ROWS && rb < MAX_ROWS) return normalizeRange(ra, 0, rb, MAX_COLS - 1);
  }
  return null;
}

export function normalizeRange(r1: number, c1: number, r2: number, c2: number): RangeBounds {
  return {
    top: Math.min(r1, r2),
    left: Math.min(c1, c2),
    bottom: Math.max(r1, r2),
    right: Math.max(c1, c2),
  };
}

export function rangeContains(r: RangeBounds, row: number, col: number): boolean {
  return row >= r.top && row <= r.bottom && col >= r.left && col <= r.right;
}

export function rangeArea(r: RangeBounds): number {
  return (r.bottom - r.top + 1) * (r.right - r.left + 1);
}
