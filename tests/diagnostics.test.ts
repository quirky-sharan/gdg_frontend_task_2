import { describe, expect, it } from 'vitest';
import { caretLine, compileFormula, formatDiagnostic } from '../src/engine';

function diagnose(formula: string): string {
  const r = compileFormula(formula);
  if (r.ok) throw new Error('expected an error');
  return formatDiagnostic(formula, r.error);
}

describe('formatDiagnostic', () => {
  it('reproduces the example diagnostic from the specification', () => {
    expect(diagnose('=SUM(A1, B2')).toBe(
      [
        'Formula: =SUM(A1, B2',
        '',
        'Error: Missing closing parenthesis.',
        '',
        '=SUM(A1, B2',
        '           ^',
        '',
        "Suggestion: Add ')' at the end of the formula.",
      ].join('\n'),
    );
  });

  it('underlines multi-character spans', () => {
    expect(diagnose('=SUMM(A1)')).toContain('=SUMM(A1)\n ^^^^\n');
    expect(caretLine(2, 5)).toBe('  ^^^');
  });

  it('places the caret under an unexpected token', () => {
    const text = diagnose('=1 + * 2');
    expect(text).toContain("Error: Unexpected '*' after '+'.");
    expect(text).toContain('=1 + * 2\n     ^');
  });
});
