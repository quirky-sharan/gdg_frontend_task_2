import { RangeValue } from '../range';
import { compareScalars, isError, parseNumericText, type CellValue, type Scalar } from '../values';
import type { Args } from './args';

/**
 * Neumaier (improved Kahan) compensated summation: keeps long sums such as
 * SUM(A1:A100000) accurate to the last displayed digit.
 */
export class Accumulator {
  private sum = 0;
  private compensation = 0;

  add(x: number): void {
    const t = this.sum + x;
    if (Math.abs(this.sum) >= Math.abs(x)) this.compensation += this.sum - t + x;
    else this.compensation += x - t + this.sum;
    this.sum = t;
  }

  get value(): number {
    return this.sum + this.compensation;
  }
}

export function preciseSum(xs: readonly number[]): number {
  const acc = new Accumulator();
  for (const x of xs) acc.add(x);
  return acc.value;
}

export function hasWildcard(s: string): boolean {
  return /(^|[^~])[*?]/.test(s);
}

/** Converts an Excel wildcard pattern (* ? and ~ escapes) into an anchored, case-insensitive RegExp. */
export function wildcardToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '~' && (pattern[i + 1] === '*' || pattern[i + 1] === '?' || pattern[i + 1] === '~')) {
      re += '\\' + pattern[++i];
    } else if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'is');
}

export type Predicate = (v: CellValue) => boolean;

/**
 * Builds a matcher for COUNTIF/SUMIF-style criteria: 5, ">10", "<>apple", "=", "app*", TRUE, ...
 */
export function parseCriteria(criterion: Scalar): Predicate {
  if (typeof criterion === 'number') {
    return (v) => (typeof v === 'number' ? compareScalars(v, criterion) === 0 : typeof v === 'string' && parseNumericText(v) === criterion);
  }
  if (typeof criterion === 'boolean') return (v) => v === criterion;
  if (criterion === null) return (v) => v === null || v === '';

  const m = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(criterion)!;
  const op = m[1] ?? '=';
  const operand = m[2];
  const num = parseNumericText(operand);

  if (operand === '') {
    if (op === '=') return (v) => v === null || v === '';
    if (op === '<>') return (v) => v !== null && v !== '';
  }

  if (num !== null) {
    const cmpNum = (v: CellValue): number | null => {
      if (typeof v === 'number') return compareScalars(v, num);
      if (typeof v === 'string') {
        const n = parseNumericText(v);
        return n === null ? null : compareScalars(n, num);
      }
      return null;
    };
    const test: Record<string, (c: number) => boolean> = {
      '=': (c) => c === 0,
      '<>': (c) => c !== 0,
      '<': (c) => c < 0,
      '>': (c) => c > 0,
      '<=': (c) => c <= 0,
      '>=': (c) => c >= 0,
    };
    const pass = test[op];
    if (op === '<>') return (v) => cmpNum(v) !== 0;
    return (v) => {
      const c = cmpNum(v);
      return c !== null && pass(c);
    };
  }

  const upper = operand.toUpperCase();
  if (upper === 'TRUE' || upper === 'FALSE') {
    const b = upper === 'TRUE';
    if (op === '=') return (v) => v === b;
    if (op === '<>') return (v) => v !== b;
  }

  if (op === '=' || op === '<>') {
    let test: (s: string) => boolean;
    if (hasWildcard(operand)) {
      const re = wildcardToRegExp(operand);
      test = (s) => re.test(s);
    } else {
      const lower = operand.replace(/~([*?~])/g, '$1').toLowerCase();
      test = (s) => s.toLowerCase() === lower;
    }
    if (op === '=') return (v) => typeof v === 'string' && test(v);
    return (v) => !(typeof v === 'string' && test(v));
  }

  // Text ordering comparisons (<, >, <=, >=) only consider text cells.
  return (v) => {
    if (typeof v !== 'string') return false;
    const c = compareScalars(v, operand);
    return op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
  };
}

/** Equality used by exact-match lookups: case-insensitive text, wildcards allowed in text lookups. */
export function exactMatcher(lookup: Scalar): (v: CellValue) => boolean {
  if (typeof lookup === 'string' && hasWildcard(lookup)) {
    const re = wildcardToRegExp(lookup);
    return (v) => typeof v === 'string' && re.test(v);
  }
  return (v) => !isError(v) && v !== null && typeof v === typeof lookup && compareScalars(v, lookup) === 0;
}

/**
 * Approximate-match search over a sorted sequence: returns the index of the largest
 * value <= lookup (or the smallest value >= lookup when `descending`), or -1.
 */
export function approximateIndex(count: number, get: (i: number) => CellValue, lookup: Scalar, descending = false): number {
  let found = -1;
  for (let i = 0; i < count; i++) {
    const v = get(i);
    if (v === null || isError(v) || typeof v !== typeof lookup) continue;
    const c = compareScalars(v, lookup);
    if (c === 0) return i;
    if (!descending && c < 0) found = i;
    else if (descending && c > 0) found = i;
    else break;
  }
  return found;
}

/**
 * Iterates the relative positions (r, c) that criteria functions need to inspect.
 * When no criterion matches empty cells, only non-empty cells of the first criteria
 * range are visited, which keeps whole-column criteria fast.
 */
export function forEachCriteriaPosition(
  ranges: RangeValue[],
  predicates: Predicate[],
  cb: (r: number, c: number) => void,
): { blanksOutsideUsedArea: number } {
  const first = ranges[0];
  const matchesBlank = predicates.every((p) => p(null));
  if (!matchesBlank) {
    first.forEachNonEmpty((_v, row, col) => {
      const r = row - first.bounds.top;
      const c = col - first.bounds.left;
      for (let k = 0; k < ranges.length; k++) {
        if (!predicates[k](ranges[k].get(r, c))) return;
      }
      cb(r, c);
    });
    return { blanksOutsideUsedArea: 0 };
  }
  const rows = Math.max(...ranges.map((g) => g.effectiveRows()));
  const cols = Math.max(...ranges.map((g) => g.effectiveCols()));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let ok = true;
      for (let k = 0; k < ranges.length && ok; k++) ok = predicates[k](ranges[k].get(r, c));
      if (ok) cb(r, c);
    }
  }
  return { blanksOutsideUsedArea: first.area - rows * cols };
}

/** Reads criteria pairs (range, criterion) starting at argument `from`. */
export function criteriaPairs(a: Args, from: number, sameShapeAs?: RangeValue): { ranges: RangeValue[]; predicates: Predicate[] } {
  const ranges: RangeValue[] = [];
  const predicates: Predicate[] = [];
  if ((a.length - from) % 2 !== 0) {
    a.fail('#VALUE!', `${a.name} expects criteria in pairs of (range, criterion).`, a.length - 1);
  }
  for (let i = from; i < a.length; i += 2) {
    const range = a.range(i);
    const shape = sameShapeAs ?? ranges[0];
    if (shape && (range.rows !== shape.rows || range.cols !== shape.cols)) {
      a.fail('#VALUE!', `All ranges in ${a.name} must be the same size; ${range.label} differs from ${shape.label}.`, i);
    }
    ranges.push(range);
    predicates.push(parseCriteria(a.plain(i + 1)));
  }
  return { ranges, predicates };
}

export function flattenScalars(a: Args, from = 0): CellValue[] {
  const out: CellValue[] = [];
  a.forEachValue((v) => out.push(v), from);
  return out;
}
