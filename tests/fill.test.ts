import { describe, expect, it } from 'vitest';
import { computeFill, normalizeRange, shiftFormula } from '../src/engine';
import { pos } from './helpers';

describe('shiftFormula', () => {
  it('moves relative references', () => {
    expect(shiftFormula('=A1+B2', 1, 0)).toBe('=A2+B3');
    expect(shiftFormula('=SUM(A1:B2)', 0, 2)).toBe('=SUM(C1:D2)');
  });

  it('keeps $-anchored parts fixed', () => {
    expect(shiftFormula('=$A$1+$A1+A$1', 3, 3)).toBe('=$A$1+$A4+D$1');
  });

  it('shifts whole-column and whole-row ranges along their axis', () => {
    expect(shiftFormula('=SUM(A:A)', 5, 1)).toBe('=SUM(B:B)');
    expect(shiftFormula('=SUM(1:2)', 1, 5)).toBe('=SUM(2:3)');
  });

  it('turns references pushed off the sheet into #REF!', () => {
    expect(shiftFormula('=A1*2', -1, 0)).toBe('=#REF!*2');
    expect(shiftFormula('=SUM(A1:A3)', -1, 0)).toBe('=SUM(#REF!)');
  });

  it('preserves strings, spacing and function names', () => {
    expect(shiftFormula('=IF(A1 > 0, "A1", LOG10(B1))', 1, 0)).toBe('=IF(A2 > 0, "A1", LOG10(B2))');
  });

  it('leaves literals untouched', () => {
    expect(shiftFormula('A1', 1, 1)).toBe('A1');
  });
});

describe('computeFill', () => {
  const grid = (cells: Record<string, string>) => (row: number, col: number) => {
    const entry = Object.entries(cells).find(([a]) => {
      const p = pos(a);
      return p.row === row && p.col === col;
    });
    return entry ? entry[1] : '';
  };
  const range = (a: string, b: string) => {
    const p = pos(a);
    const q = pos(b);
    return normalizeRange(p.row, p.col, q.row, q.col);
  };
  const inputs = (r: ReturnType<typeof computeFill>) => r.map((c) => c.input);

  it('copies a single number', () => {
    expect(inputs(computeFill(grid({ A1: '5' }), range('A1', 'A1'), range('A1', 'A3')))).toEqual(['5', '5']);
  });

  it('extends arithmetic series', () => {
    expect(inputs(computeFill(grid({ A1: '1', A2: '3' }), range('A1', 'A2'), range('A1', 'A5')))).toEqual(['5', '7', '9']);
    expect(inputs(computeFill(grid({ A1: '10', B1: '20' }), range('A1', 'B1'), range('A1', 'D1')))).toEqual(['30', '40']);
  });

  it('extends series backwards when dragging up', () => {
    expect(inputs(computeFill(grid({ A3: '3', A4: '4' }), range('A3', 'A4'), range('A1', 'A4')))).toEqual(['1', '2']);
  });

  it('increments text with a trailing number', () => {
    expect(inputs(computeFill(grid({ A1: 'Item 1' }), range('A1', 'A1'), range('A1', 'A3')))).toEqual(['Item 2', 'Item 3']);
    expect(inputs(computeFill(grid({ A1: 'Q1', A2: 'Q2' }), range('A1', 'A2'), range('A1', 'A4')))).toEqual(['Q3', 'Q4']);
  });

  it('repeats text patterns', () => {
    expect(inputs(computeFill(grid({ A1: 'a', A2: 'b' }), range('A1', 'A2'), range('A1', 'A5')))).toEqual(['a', 'b', 'a']);
  });

  it('shifts formulas relative to their source cell', () => {
    const r = computeFill(grid({ A1: '=B1*2' }), range('A1', 'A1'), range('A1', 'A3'));
    expect(r).toEqual([
      { row: 1, col: 0, input: '=B2*2' },
      { row: 2, col: 0, input: '=B3*2' },
    ]);
    const h = computeFill(grid({ A1: '=A2+$A$3' }), range('A1', 'A1'), range('A1', 'C1'));
    expect(inputs(h)).toEqual(['=B2+$A$3', '=C2+$A$3']);
  });
});
