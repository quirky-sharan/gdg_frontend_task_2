/**
 * Runtime value model shared by the evaluator, the function library and the UI.
 */
import { keyToAddress } from './address';

export type ErrorCode =
  | '#DIV/0!'
  | '#VALUE!'
  | '#REF!'
  | '#NAME?'
  | '#N/A'
  | '#NUM!'
  | '#NULL!'
  | '#CIRC!'
  | '#ERROR!';

export const ERROR_CODES: readonly ErrorCode[] = [
  '#DIV/0!',
  '#VALUE!',
  '#REF!',
  '#NAME?',
  '#N/A',
  '#NUM!',
  '#NULL!',
  '#CIRC!',
  '#ERROR!',
];

export interface ErrorDetails {
  /** Start offset (inclusive) of the offending part of the formula text. */
  start?: number;
  /** End offset (exclusive). */
  end?: number;
  /** Human readable hint on how to fix the problem. */
  suggestion?: string;
  /** A corrected formula that can be applied with one click, when one can be derived. */
  fix?: string;
  /** Key of the cell the error originally came from (for propagated errors). */
  sourceKey?: number;
  /** The root-cause message of a propagated error. */
  cause?: string;
}

/**
 * A spreadsheet error value (#DIV/0!, #VALUE!, ...). Errors are first-class values:
 * they flow through formulas and carry diagnostics explaining what went wrong.
 */
export class SheetError implements ErrorDetails {
  start?: number;
  end?: number;
  suggestion?: string;
  fix?: string;
  sourceKey?: number;
  cause?: string;

  constructor(
    public readonly code: ErrorCode,
    public readonly message: string,
    details: ErrorDetails = {},
  ) {
    Object.assign(this, details);
  }

  withDetails(details: ErrorDetails): SheetError {
    return new SheetError(this.code, this.message, {
      start: this.start,
      end: this.end,
      suggestion: this.suggestion,
      fix: this.fix,
      sourceKey: this.sourceKey,
      cause: this.cause,
      ...details,
    });
  }

  toString(): string {
    return this.code;
  }
}

/** Empty cells are represented by `null`. */
export type Scalar = number | string | boolean | null;
export type CellValue = Scalar | SheetError;

export function isError(v: unknown): v is SheetError {
  return v instanceof SheetError;
}

/**
 * Thrown inside function implementations / coercion helpers to abort evaluation
 * with an error value. Caught at the function-call boundary in the evaluator.
 */
export class ErrorSignal {
  constructor(public readonly error: SheetError) {}
}

export function fail(code: ErrorCode, message: string, details?: ErrorDetails): never {
  throw new ErrorSignal(new SheetError(code, message, details));
}

/** Round to 15 significant digits, the precision spreadsheets display and compare with. */
export function normalizeNumber(n: number): number {
  if (!Number.isFinite(n) || n === 0) return n;
  return Number(n.toPrecision(15));
}

export function describeValue(v: CellValue): string {
  if (v === null) return 'an empty cell';
  if (typeof v === 'string') return `the text "${v.length > 30 ? v.slice(0, 30) + '…' : v}"`;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(normalizeNumber(v));
  return v.code;
}

const NUMERIC_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** Parses text that looks like a number ("12", " -3.5 ", "1e3", "45%"); returns null otherwise. */
export function parseNumericText(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  if (t.endsWith('%')) {
    const inner = t.slice(0, -1).trim();
    if (NUMERIC_RE.test(inner)) return Number(inner) / 100;
    return null;
  }
  if (NUMERIC_RE.test(t)) return Number(t);
  return null;
}

/** Arithmetic coercion: empty -> 0, TRUE -> 1, numeric text -> number, other text -> #VALUE!. */
export function toNumber(v: CellValue): number | SheetError {
  if (typeof v === 'number') return v;
  if (v === null) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = parseNumericText(v);
    if (n === null) {
      return new SheetError('#VALUE!', `Expected a number but got ${describeValue(v)}.`, {
        suggestion: 'Use a numeric value, or convert text with VALUE().',
      });
    }
    return n;
  }
  return v;
}

/** Text coercion used by `&` and text functions. */
export function toText(v: CellValue): string | SheetError {
  if (v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return formatNumberGeneral(v);
  return v;
}

/** Logical coercion: numbers are TRUE unless 0, "TRUE"/"FALSE" text is accepted. */
export function toBoolean(v: CellValue): boolean | SheetError {
  if (typeof v === 'boolean') return v;
  if (v === null) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const u = v.trim().toUpperCase();
    if (u === 'TRUE') return true;
    if (u === 'FALSE') return false;
    return new SheetError('#VALUE!', `Expected TRUE or FALSE but got ${describeValue(v)}.`);
  }
  return v;
}

/** "General" number format: up to 15 significant digits, exponent for very large/small values. */
export function formatNumberGeneral(n: number): string {
  if (Number.isNaN(n)) return '#NUM!';
  if (!Number.isFinite(n)) return '#NUM!';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e15 || abs < 1e-9) {
    return n.toExponential(9).replace(/\.?0+e/, 'e');
  }
  return String(normalizeNumber(n));
}

/**
 * Spreadsheet comparison: numbers < text < booleans; text compares case-insensitively.
 * Empty cells compare as 0 against numbers, "" against text and FALSE against booleans.
 * Returns negative / 0 / positive.
 */
export function compareScalars(a: Scalar, b: Scalar): number {
  if (a === null && b === null) return 0;
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const rank = (v: Scalar) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'number' && typeof b === 'number') {
    const na = normalizeNumber(a);
    const nb = normalizeNumber(b);
    return na === nb ? 0 : na < nb ? -1 : 1;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    return la === lb ? 0 : la < lb ? -1 : 1;
  }
  return a === b ? 0 : a ? 1 : -1;
}

/** Converts a raw (non-formula) cell input into its literal value. */
export function parseLiteral(input: string): Scalar {
  if (input === '') return null;
  if (input.startsWith("'")) return input.slice(1);
  const n = parseNumericText(input);
  if (n !== null) return n;
  const upper = input.trim().toUpperCase();
  if (upper === 'TRUE') return true;
  if (upper === 'FALSE') return false;
  return input;
}

/**
 * Wraps an error read from another cell so that it points at the reference inside the
 * current formula while still naming the cell where the problem originated.
 */
export function propagatedError(source: SheetError, sourceKey: number, start: number, end: number): SheetError {
  const origin = source.sourceKey ?? sourceKey;
  const where = keyToAddress(sourceKey);
  const rootCause = source.cause ?? source.message;
  const via = origin !== sourceKey ? ` (originating in ${keyToAddress(origin)})` : '';
  return new SheetError(source.code, `${where} contains ${source.code}${via}: ${rootCause}`, {
    start,
    end,
    sourceKey: origin,
    cause: rootCause,
    suggestion: `Fix the error in ${keyToAddress(origin)}, or handle it with IFERROR(${where}, ...).`,
  });
}
