/**
 * Human-readable error diagnostics.
 */
import type { ErrorCode, SheetError } from './values';

/** A line of spaces with carets under [start, end) of the formula. */
export function caretLine(start: number, end: number): string {
  return ' '.repeat(Math.max(0, start)) + '^'.repeat(Math.max(1, end - start));
}

/**
 * Formats an error the way the diagnostics panel shows it:
 *
 *   Formula: =SUM(A1, B2
 *
 *   Error: Missing closing parenthesis.
 *
 *   =SUM(A1, B2
 *              ^
 *
 *   Suggestion: Add ')' at the end of the formula.
 */
export function formatDiagnostic(formula: string, error: SheetError): string {
  const lines = [`Formula: ${formula}`, '', `Error: ${error.message}`];
  if (error.start !== undefined) {
    lines.push('', formula, caretLine(error.start, error.end ?? error.start + 1));
  }
  if (error.suggestion) lines.push('', `Suggestion: ${error.suggestion}`);
  return lines.join('\n');
}

export const ERROR_EXPLANATIONS: Record<ErrorCode, string> = {
  '#DIV/0!': 'A number was divided by zero or by an empty cell.',
  '#VALUE!': 'A value has the wrong type for the operation, e.g. text used in arithmetic.',
  '#REF!': 'A reference points outside the sheet or to a cell that no longer exists.',
  '#NAME?': 'The formula uses a function or name that does not exist.',
  '#N/A': 'A lookup did not find the value it was searching for.',
  '#NUM!': 'A calculation produced an invalid number (e.g. square root of a negative number).',
  '#NULL!': 'Two ranges that do not intersect were combined.',
  '#CIRC!': 'The formula depends on its own result, directly or through other cells.',
  '#ERROR!': 'The formula could not be parsed: it contains a syntax error.',
};
