/**
 * Tree-walking evaluator for formula ASTs.
 *
 * The evaluator is pure with respect to the sheet: it reads already-computed
 * cell values through a `CellReader` and returns a value. Ordering (making sure
 * precedents are computed first) is the engine's job.
 */
import { formatRange, toKey } from './address';
import type { BinaryNode, Node } from './ast';
import { Args, type EvalContext } from './functions/args';
import { FUNCTIONS } from './functions';
import { RangeValue, type CellReader, type Value } from './range';
import {
  compareScalars,
  describeValue,
  ErrorSignal,
  isError,
  normalizeNumber,
  propagatedError,
  SheetError,
  toNumber,
  toText,
  type CellValue,
} from './values';

export class Evaluator {
  constructor(private readonly reader: CellReader) {}

  /** Evaluates a whole formula and reduces the result to a single cell value. */
  evaluateFormula(ast: Node, ctx: EvalContext): CellValue {
    let result: CellValue;
    try {
      const v = this.evaluate(ast, ctx);
      result = v instanceof RangeValue ? this.rangeToScalar(v, ast, ctx) : v;
    } catch (e) {
      if (e instanceof ErrorSignal) result = e.error;
      else if (e instanceof RangeError) {
        result = new SheetError('#NUM!', 'The calculation is too complex to evaluate.');
      } else throw e;
    }
    if (typeof result === 'number') {
      if (!Number.isFinite(result)) {
        result = new SheetError('#NUM!', 'The result is not a finite number.', {
          suggestion: 'Check for overflowing values or invalid math such as dividing huge numbers.',
        });
      } else if (Object.is(result, -0)) {
        result = 0;
      }
    }
    if (isError(result) && result.start === undefined) {
      result = result.withDetails({ start: ast.start, end: ast.end });
    }
    return result;
  }

  private rangeToScalar(v: RangeValue, ast: Node, ctx: EvalContext): CellValue {
    if (v.area === 1) return v.get(0, 0);
    const body = ctx.formula.slice(1);
    return new SheetError('#VALUE!', `The formula returns the range ${v.label} instead of a single value.`, {
      start: ast.start,
      end: ast.end,
      suggestion: `Wrap the range in an aggregate function, e.g. =SUM(${body}).`,
      fix: `=SUM(${body})`,
    });
  }

  evaluate(node: Node, ctx: EvalContext): Value {
    switch (node.type) {
      case 'number':
        return node.value;
      case 'string':
        return node.value;
      case 'boolean':
        return node.value;
      case 'missing':
        return null;
      case 'error':
        if (node.code === '#REF!') {
          return new SheetError('#REF!', 'The formula contains #REF!: a reference that no longer points to a valid cell.', {
            start: node.start,
            end: node.end,
            suggestion: 'This usually happens when a formula is copied or filled past the edge of the sheet. Replace #REF! with a valid cell reference.',
          });
        }
        return new SheetError(node.code, `The formula contains the error value ${node.code}.`, {
          start: node.start,
          end: node.end,
        });
      case 'cell': {
        const v = this.reader.getValue(node.row, node.col);
        return isError(v) ? propagatedError(v, toKey(node.row, node.col), node.start, node.end) : v;
      }
      case 'range':
        return new RangeValue(node, this.reader, node);
      case 'name':
        // Rejected during compilation; kept for completeness.
        return new SheetError('#NAME?', `Unknown name '${node.name}'.`, { start: node.start, end: node.end });
      case 'unary': {
        const v = this.scalar(node.operand, ctx);
        if (isError(v)) return v;
        const n = this.toNumberAt(v, node.operand);
        if (isError(n)) return n;
        return node.op === '-' ? -n : n;
      }
      case 'percent': {
        const v = this.scalar(node.operand, ctx);
        if (isError(v)) return v;
        const n = this.toNumberAt(v, node.operand);
        return isError(n) ? n : n / 100;
      }
      case 'binary':
        return this.binary(node, ctx);
      case 'call':
        return this.call(node, ctx);
    }
  }

  /** Evaluates a node in a context that needs one value (operators). */
  private scalar(node: Node, ctx: EvalContext): CellValue {
    const v = this.evaluate(node, ctx);
    if (!(v instanceof RangeValue)) return v;
    if (v.area === 1) return v.get(0, 0);
    const text = ctx.formula.slice(node.start, node.end);
    return new SheetError('#VALUE!', `The range ${formatRange(v.bounds)} can't be used as a single value here.`, {
      start: node.start,
      end: node.end,
      suggestion: `Use a single cell, or a function that accepts ranges such as SUM(${text}).`,
      fix: ctx.formula.slice(0, node.start) + `SUM(${text})` + ctx.formula.slice(node.end),
    });
  }

  private toNumberAt(v: CellValue, node: Node): number | SheetError {
    const n = toNumber(v);
    if (!isError(n)) return n;
    if (n.start !== undefined) return n;
    return new SheetError('#VALUE!', `Expected a number but got ${describeValue(v)}.`, {
      start: node.start,
      end: node.end,
      suggestion:
        typeof v === 'string'
          ? 'Use a number here. To join text use & instead, e.g. =A1 & " units". VALUE() converts numeric text.'
          : undefined,
    });
  }

  private binary(node: BinaryNode, ctx: EvalContext): CellValue {
    const left = this.scalar(node.left, ctx);
    if (isError(left)) return left;
    const right = this.scalar(node.right, ctx);
    if (isError(right)) return right;

    switch (node.op) {
      case '&': {
        const a = toText(left);
        const b = toText(right);
        if (isError(a)) return a;
        if (isError(b)) return b;
        return a + b;
      }
      case '=':
        return compareScalars(left, right) === 0;
      case '<>':
        return compareScalars(left, right) !== 0;
      case '<':
        return compareScalars(left, right) < 0;
      case '>':
        return compareScalars(left, right) > 0;
      case '<=':
        return compareScalars(left, right) <= 0;
      case '>=':
        return compareScalars(left, right) >= 0;
      default:
        break;
    }

    const a = this.toNumberAt(left, node.left);
    if (isError(a)) return a;
    const b = this.toNumberAt(right, node.right);
    if (isError(b)) return b;

    switch (node.op) {
      case '+':
        return normalizeNumber(a + b);
      case '-':
        return normalizeNumber(a - b);
      case '*':
        return a * b;
      case '/': {
        if (b === 0) {
          const divisor = ctx.formula.slice(node.right.start, node.right.end);
          const kind = node.right.type;
          const message =
            kind === 'number'
              ? 'Division by zero.'
              : kind === 'cell'
                ? `Division by zero: ${divisor} is ${right === null ? 'empty' : '0'}.`
                : `Division by zero: ${divisor} evaluates to 0.`;
          return new SheetError('#DIV/0!', message, {
            start: node.right.start,
            end: node.right.end,
            suggestion: `Make sure ${divisor} is not zero or empty, or handle it with IFERROR.`,
            fix: `=IFERROR(${ctx.formula.slice(1)}, 0)`,
          });
        }
        return a / b;
      }
      case '^': {
        if (a === 0 && b < 0) {
          return new SheetError('#DIV/0!', 'Zero raised to a negative power is a division by zero.', {
            start: node.opStart,
            end: node.opStart + 1,
          });
        }
        const r = Math.pow(a, b);
        if (Number.isNaN(r)) {
          return new SheetError('#NUM!', `Cannot raise the negative number ${a} to the fractional power ${b}.`, {
            start: node.start,
            end: node.end,
          });
        }
        return r;
      }
    }
  }

  private call(node: Extract<Node, { type: 'call' }>, ctx: EvalContext): Value {
    const spec = FUNCTIONS.get(node.name);
    if (!spec) {
      return new SheetError('#NAME?', `Unknown function '${node.name}'.`, { start: node.start, end: node.nameEnd });
    }
    const args = new Args(node, (n) => this.evaluate(n, ctx), ctx);
    try {
      const result = spec.impl(args);
      if (typeof result === 'number' && !Number.isFinite(result)) {
        return new SheetError('#NUM!', `${node.name} produced a number that is too large or undefined.`, {
          start: node.start,
          end: node.end,
        });
      }
      return result;
    } catch (e) {
      if (e instanceof ErrorSignal) {
        const err = e.error;
        return err.start === undefined ? err.withDetails({ start: node.start, end: node.nameEnd }) : err;
      }
      throw e;
    }
  }
}
