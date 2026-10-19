/**
 * Copy / paste / drag-to-fill support: relative reference shifting and series detection.
 */
import { colToLetters, formatAddress, isValidPos, MAX_COLS, MAX_ROWS, type RangeBounds } from './address';
import type { CellInput } from './engine';
import { tokenize } from './tokenizer';
import { normalizeNumber, parseNumericText } from './values';

/**
 * Moves the relative references of a formula by (dRow, dCol), exactly like copying
 * the cell that many rows/columns away. `$`-anchored parts stay put; references
 * pushed off the sheet become #REF!. Non-formula inputs are returned unchanged.
 */
export function shiftFormula(input: string, dRow: number, dCol: number): string {
  if (!input.startsWith('=') || (dRow === 0 && dCol === 0)) return input;
  const tokens = tokenize(input, 1);
  let out = '';
  let last = 0;
  const emit = (start: number, end: number, text: string) => {
    out += input.slice(last, start) + text;
    last = end;
  };
  const shiftCell = (t: (typeof tokens)[number]) => {
    if (t.type !== 'cell' || t.outOfRange) return null;
    const row = t.absRow ? t.row : t.row + dRow;
    const col = t.absCol ? t.col : t.col + dCol;
    return isValidPos(row, col) ? formatAddress(row, col, t.absRow, t.absCol) : null;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'cell') {
      const a = tokens[i + 1];
      const b = tokens[i + 2];
      if (a?.type === 'colon' && b?.type === 'cell') {
        const s1 = shiftCell(t);
        const s2 = shiftCell(b);
        emit(t.start, b.end, s1 && s2 ? `${s1}:${s2}` : '#REF!');
        i += 2;
        continue;
      }
      if (!t.outOfRange) emit(t.start, t.end, shiftCell(t) ?? '#REF!');
    } else if (t.type === 'colrange' && !t.outOfRange) {
      const left = t.absLeft ? t.left : t.left + dCol;
      const right = t.absRight ? t.right : t.right + dCol;
      const ok = left >= 0 && right >= 0 && left < MAX_COLS && right < MAX_COLS;
      emit(t.start, t.end, ok ? `${t.absLeft ? '$' : ''}${colToLetters(left)}:${t.absRight ? '$' : ''}${colToLetters(right)}` : '#REF!');
    } else if (t.type === 'rowrange' && !t.outOfRange) {
      const top = t.absTop ? t.top : t.top + dRow;
      const bottom = t.absBottom ? t.bottom : t.bottom + dRow;
      const ok = top >= 0 && bottom >= 0 && top < MAX_ROWS && bottom < MAX_ROWS;
      emit(t.start, t.end, ok ? `${t.absTop ? '$' : ''}${top + 1}:${t.absBottom ? '$' : ''}${bottom + 1}` : '#REF!');
    }
  }
  return out + input.slice(last);
}

type LinePlan = (k: number) => { input: string; source: number };

/**
 * Decides how to extend one line (a column when filling down, a row when filling right)
 * of source inputs. `k` is the position in the extended line: len, len+1, ... going forward,
 * -1, -2, ... going backward. Returns the new input and which source cell it derives from.
 */
function planLine(line: string[]): LinePlan {
  const len = line.length;
  const cyclic = (k: number) => ((k % len) + len) % len;
  const isFormula = (s: string) => s.startsWith('=');

  // Numeric series: 1, 2, 3 -> 4, 5 ... (least-squares trend, exact for arithmetic progressions).
  const nums = line.map((s) => (isFormula(s) ? null : parseNumericText(s)));
  if (len >= 2 && nums.every((n) => n !== null)) {
    const ys = nums as number[];
    const xMean = (len - 1) / 2;
    const yMean = ys.reduce((a, b) => a + b, 0) / len;
    let sxy = 0;
    let sxx = 0;
    ys.forEach((y, x) => {
      sxy += (x - xMean) * (y - yMean);
      sxx += (x - xMean) * (x - xMean);
    });
    const slope = sxy / sxx;
    const intercept = yMean - slope * xMean;
    return (k) => ({ input: String(normalizeNumber(intercept + slope * k)), source: cyclic(k) });
  }

  // Text with a trailing number: "Item 1" -> "Item 2", "Q1", "Q2" -> "Q3".
  const parts = line.map((s) => (isFormula(s) ? null : /^(.*?)(\d+)$/.exec(s)));
  if (parts.every((p) => p !== null && p[1] === parts[0]![1] && p[1] !== '')) {
    const prefix = parts[0]![1];
    const values = parts.map((p) => Number(p![2]));
    const width = parts[0]![2].length;
    const step = len >= 2 ? values[len - 1] - values[len - 2] : 1;
    const base = values[len - 1];
    return (k) => {
      const n = k >= len ? base + step * (k - len + 1) : values[0] + step * k;
      const digits = String(Math.abs(n));
      const padded = parts[0]![2].startsWith('0') ? digits.padStart(width, '0') : digits;
      return { input: n < 0 ? line[cyclic(k)] : prefix + padded, source: cyclic(k) };
    };
  }

  // Otherwise repeat the pattern; formulas are shifted by the distance travelled.
  return (k) => ({ input: line[cyclic(k)], source: cyclic(k) });
}

/**
 * Computes the cell inputs produced by dragging the fill handle from `source`
 * to cover `target` (which contains `source` and extends it along one axis).
 */
export function computeFill(
  getInput: (row: number, col: number) => string,
  source: RangeBounds,
  target: RangeBounds,
): CellInput[] {
  const out: CellInput[] = [];
  const vertical = target.top < source.top || target.bottom > source.bottom;

  if (vertical) {
    const len = source.bottom - source.top + 1;
    for (let col = source.left; col <= source.right; col++) {
      const line = Array.from({ length: len }, (_, i) => getInput(source.top + i, col));
      const plan = planLine(line);
      for (let row = target.top; row <= target.bottom; row++) {
        if (row >= source.top && row <= source.bottom) continue;
        const k = row - source.top;
        const { input, source: si } = plan(k);
        out.push({ row, col, input: shiftFormula(input, row - (source.top + si), 0) });
      }
    }
  } else {
    const len = source.right - source.left + 1;
    for (let row = source.top; row <= source.bottom; row++) {
      const line = Array.from({ length: len }, (_, i) => getInput(row, source.left + i));
      const plan = planLine(line);
      for (let col = target.left; col <= target.right; col++) {
        if (col >= source.left && col <= source.right) continue;
        const k = col - source.left;
        const { input, source: si } = plan(k);
        out.push({ row, col, input: shiftFormula(input, 0, col - (source.left + si)) });
      }
    }
  }
  return out;
}
