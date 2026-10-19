/**
 * Formula compilation = parse + semantic validation + dependency extraction.
 *
 * Validation catches problems a pure syntax check cannot: unknown functions,
 * wrong argument counts and unknown names. Every diagnostic carries a position,
 * and when a correction can be derived it is verified by recompiling it before
 * being offered as a one-click fix.
 */
import { toKey, type RangeBounds } from './address';
import { walk, type CallNode, type Node } from './ast';
import { FUNCTIONS, signature, suggestFunction } from './functions';
import { parseFormula } from './parser';
import { SheetError } from './values';

export interface CompiledFormula {
  ast: Node;
  /** Keys of individually referenced cells (deduplicated). */
  cells: number[];
  /** Referenced ranges (deduplicated). */
  ranges: RangeBounds[];
  /** True when the formula calls a volatile function (NOW, RAND, ...). */
  volatile: boolean;
}

export type CompileResult = { ok: true; formula: CompiledFormula } | { ok: false; error: SheetError };

const MAX_FIX_STEPS = 4;

export function compileFormula(input: string): CompileResult {
  const result = compileOnce(input);
  if (result.ok || !result.error.fix) return result;

  // Follow the chain of fixes (e.g. close a quote, then a parenthesis) and only offer
  // the final candidate if it actually compiles.
  let candidate = result.error.fix;
  for (let step = 0; step < MAX_FIX_STEPS; step++) {
    const next = compileOnce(candidate);
    if (next.ok) return { ok: false, error: result.error.withDetails({ fix: candidate }) };
    if (!next.error.fix || next.error.fix === candidate) break;
    candidate = next.error.fix;
  }
  return { ok: false, error: result.error.withDetails({ fix: undefined }) };
}

function compileOnce(input: string): CompileResult {
  const parsed = parseFormula(input);
  if (!parsed.ok) return parsed;
  const error = validate(parsed.ast, input);
  if (error) return { ok: false, error };
  return { ok: true, formula: extract(parsed.ast) };
}

function arityText(min: number, max: number): string {
  const plural = (n: number) => `${n} argument${n === 1 ? '' : 's'}`;
  if (min === max) return plural(min);
  if (max === Infinity) return `at least ${plural(min)}`;
  return `${min} to ${max} arguments`;
}

function validateCall(node: CallNode, input: string): SheetError | undefined {
  const spec = FUNCTIONS.get(node.name);
  const nameText = input.slice(node.start, node.nameEnd);
  if (!spec) {
    const guess = suggestFunction(node.name);
    return new SheetError('#NAME?', `Unknown function '${nameText}'.`, {
      start: node.start,
      end: node.nameEnd,
      suggestion: guess
        ? `Did you mean ${guess}?`
        : 'Check the spelling, or open the Functions panel to see every supported function.',
      fix: guess ? input.slice(0, node.start) + guess + input.slice(node.nameEnd) : undefined,
    });
  }
  const n = node.args.length;
  if (n < spec.minArgs || n > spec.maxArgs) {
    const tooMany = n > spec.maxArgs;
    const start = tooMany ? node.args[spec.maxArgs].start : node.end - 1;
    const end = tooMany ? node.args[n - 1].end : node.end;
    return new SheetError('#ERROR!', `${spec.name} expects ${arityText(spec.minArgs, spec.maxArgs)}, but got ${n}.`, {
      start,
      end,
      suggestion: `Usage: ${signature(spec)}`,
    });
  }
  return undefined;
}

function validate(ast: Node, input: string): SheetError | undefined {
  let error: SheetError | undefined;
  walk(ast, (node) => {
    if (error) return;
    if (node.type === 'call') {
      error = validateCall(node, input);
    } else if (node.type === 'name') {
      const upper = node.name.toUpperCase();
      if (FUNCTIONS.has(upper)) {
        error = new SheetError('#NAME?', `${upper} is a function and needs parentheses.`, {
          start: node.start,
          end: node.end,
          suggestion: `Write ${upper}(...) to call it.`,
          fix: input.slice(0, node.end) + '()' + input.slice(node.end),
        });
      } else if (/^\$?[A-Za-z]+\$?\d+$/.test(node.name)) {
        error = new SheetError('#REF!', `Invalid reference ${node.name}: the column is beyond the last column (ZZ).`, {
          start: node.start,
          end: node.end,
        });
      } else {
        const quoted = `"${node.name.replace(/"/g, '""')}"`;
        error = new SheetError('#NAME?', `Unknown name '${node.name}'.`, {
          start: node.start,
          end: node.end,
          suggestion: `To use text, wrap it in double quotes: ${quoted}`,
          fix: input.slice(0, node.start) + quoted + input.slice(node.end),
        });
      }
    }
  });
  return error;
}

function extract(ast: Node): CompiledFormula {
  const cells = new Set<number>();
  const ranges = new Map<string, RangeBounds>();
  let volatile = false;
  walk(ast, (node) => {
    if (node.type === 'cell') cells.add(toKey(node.row, node.col));
    else if (node.type === 'range') {
      const r = { top: node.top, left: node.left, bottom: node.bottom, right: node.right };
      ranges.set(`${r.top},${r.left},${r.bottom},${r.right}`, r);
    } else if (node.type === 'call' && FUNCTIONS.get(node.name)?.volatile) {
      volatile = true;
    }
  });
  return { ast, cells: [...cells], ranges: [...ranges.values()], volatile };
}
