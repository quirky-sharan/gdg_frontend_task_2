import type { CallNode, Node } from '../ast';
import { RangeValue, type Value } from '../range';
import {
  describeValue,
  ErrorSignal,
  isError,
  SheetError,
  toBoolean,
  toNumber,
  toText,
  type CellValue,
  type ErrorCode,
  type ErrorDetails,
  type Scalar,
} from '../values';

export interface EvalContext {
  /** Position of the cell whose formula is being evaluated. */
  row: number;
  col: number;
  /** The formula text, used to build one-click fixes. */
  formula: string;
}

export type FunctionCategory = 'Math' | 'Statistical' | 'Logical' | 'Text' | 'Lookup' | 'Information' | 'Date';

export interface FunctionSpec {
  name: string;
  category: FunctionCategory;
  minArgs: number;
  maxArgs: number;
  /** Argument list as shown to users, e.g. "lookup_value, table_array, col_index, [range_lookup]". */
  args: string;
  description: string;
  example: string;
  /** Volatile functions (NOW, RAND, ...) are recalculated on every change. */
  volatile?: boolean;
  impl: (args: Args) => Value;
}

/**
 * Lazy, memoized access to a function call's arguments.
 *
 * Arguments are only evaluated when a function asks for them, which gives IF,
 * IFERROR, CHOOSE, AND/OR, ... short-circuit semantics for free. The typed
 * accessors (`number`, `text`, ...) coerce values spreadsheet-style and abort
 * the call with a positioned error when coercion fails.
 */
export class Args {
  private readonly cache: Array<Value | undefined>;

  constructor(
    readonly call: CallNode,
    private readonly evalNode: (n: Node) => Value,
    readonly ctx: EvalContext,
  ) {
    this.cache = new Array(call.args.length);
  }

  get length(): number {
    return this.call.args.length;
  }

  get name(): string {
    return this.call.name;
  }

  node(i: number): Node {
    return this.call.args[i];
  }

  /** True when argument `i` was supplied (and not left empty, as in IF(A1,,0)). */
  has(i: number): boolean {
    return i < this.length && this.call.args[i].type !== 'missing';
  }

  /** Text of argument `i` exactly as written in the formula. */
  source(i: number): string {
    const n = this.call.args[i];
    return this.ctx.formula.slice(n.start, n.end);
  }

  value(i: number): Value {
    if (i >= this.length) return null;
    let v = this.cache[i];
    if (v === undefined) {
      v = this.evalNode(this.call.args[i]);
      this.cache[i] = v;
    }
    return v;
  }

  // ------------------------------------------------------------ errors

  fail(code: ErrorCode, message: string, argIndex?: number, details: ErrorDetails = {}): never {
    throw new ErrorSignal(new SheetError(code, message, { ...this.spanOf(argIndex), ...details }));
  }

  /** Re-throws an error value, attaching the argument position if it has none. */
  raise(err: SheetError, argIndex?: number): never {
    throw new ErrorSignal(err.start === undefined ? err.withDetails(this.spanOf(argIndex)) : err);
  }

  private spanOf(argIndex?: number): { start: number; end: number } {
    if (argIndex !== undefined && argIndex < this.length) {
      const n = this.call.args[argIndex];
      return { start: n.start, end: Math.max(n.end, n.start + 1) };
    }
    return { start: this.call.start, end: this.call.nameEnd };
  }

  private ordinal(i: number): string {
    return `argument ${i + 1} of ${this.name}`;
  }

  // ------------------------------------------------------------ scalar access

  /** Argument as a single value; a multi-cell range yields #VALUE!. Errors are returned, not thrown. */
  scalar(i: number): CellValue {
    const v = this.value(i);
    if (v instanceof RangeValue) {
      if (v.area === 1) return v.get(0, 0);
      const n = this.call.args[i];
      return new SheetError('#VALUE!', `${this.name} expects a single value for ${this.ordinal(i)}, but got the range ${v.label}.`, {
        start: n.start,
        end: n.end,
        suggestion: `Reference a single cell, or aggregate the range first, e.g. SUM(${v.label}).`,
      });
    }
    return v;
  }

  /** Argument as a non-error scalar (errors abort the call). */
  plain(i: number): Scalar {
    const v = this.scalar(i);
    if (isError(v)) this.raise(v, i);
    return v;
  }

  number(i: number, defaultValue?: number): number {
    if (!this.has(i)) {
      if (defaultValue !== undefined) return defaultValue;
      if (i < this.length) return 0; // explicitly empty argument
      this.fail('#VALUE!', `${this.name} is missing ${this.ordinal(i)}.`);
    }
    const v = this.plain(i);
    const n = toNumber(v);
    if (isError(n)) {
      this.fail('#VALUE!', `${this.name} expects a number for ${this.ordinal(i)}, but got ${describeValue(v)}.`, i, {
        suggestion: 'Use a numeric value, or convert text with VALUE().',
      });
    }
    return n;
  }

  integer(i: number, defaultValue?: number): number {
    return Math.trunc(this.number(i, defaultValue));
  }

  text(i: number, defaultValue?: string): string {
    if (!this.has(i)) {
      if (defaultValue !== undefined) return defaultValue;
      if (i < this.length) return '';
      this.fail('#VALUE!', `${this.name} is missing ${this.ordinal(i)}.`);
    }
    const t = toText(this.plain(i));
    if (isError(t)) this.raise(t, i);
    return t;
  }

  bool(i: number, defaultValue?: boolean): boolean {
    if (!this.has(i)) {
      if (defaultValue !== undefined) return defaultValue;
      if (i < this.length) return false;
      this.fail('#VALUE!', `${this.name} is missing ${this.ordinal(i)}.`);
    }
    const v = this.plain(i);
    const b = toBoolean(v);
    if (isError(b)) {
      this.fail('#VALUE!', `${this.name} expects TRUE or FALSE for ${this.ordinal(i)}, but got ${describeValue(v)}.`, i);
    }
    return b;
  }

  range(i: number): RangeValue {
    const v = this.value(i);
    if (v instanceof RangeValue) return v;
    if (isError(v)) this.raise(v, i);
    this.fail('#VALUE!', `${this.name} expects a cell range for ${this.ordinal(i)}, e.g. A1:B10.`, i);
  }

  // ------------------------------------------------------------ aggregation

  /**
   * Visits the values of arguments [from, to), flattening ranges. `fromRef` is true
   * for values read from cells (ranges or single references), which aggregate
   * functions treat differently from literals typed into the formula.
   */
  forEachValue(cb: (v: CellValue, fromRef: boolean, argIndex: number) => void, from = 0, to = this.length): void {
    for (let i = from; i < to; i++) {
      if (!this.has(i)) continue;
      const v = this.value(i);
      if (v instanceof RangeValue) {
        v.forEachNonEmpty((x) => cb(x, true, i));
      } else {
        cb(v, this.call.args[i].type === 'cell', i);
      }
    }
  }

  /**
   * SUM-style number collection: numbers stored in referenced cells are included while text
   * and booleans in cells are skipped; literal arguments are coerced; errors propagate.
   */
  numbers(from = 0, to = this.length): number[] {
    const out: number[] = [];
    this.forEachValue(
      (v, fromRef, i) => {
        if (isError(v)) this.raise(v, i);
        if (fromRef) {
          if (typeof v === 'number') out.push(v);
          return;
        }
        const n = toNumber(v);
        if (isError(n)) {
          this.fail('#VALUE!', `${this.name} expects numbers, but ${this.ordinal(i)} is ${describeValue(v)}.`, i);
        }
        out.push(n);
      },
      from,
      to,
    );
    return out;
  }
}
