import { describe, expect, it } from 'vitest';
import { keyToAddress, SpreadsheetEngine, toKey } from '../src/engine';
import { errorCode, get, pos, set, sheet } from './helpers';

const addresses = (keys: number[]) => keys.map(keyToAddress).sort();

describe('recalculation', () => {
  it('recomputes dependents when a precedent changes', () => {
    const e = sheet({ A1: '2', B1: '=A1*10', C1: '=B1+1' });
    expect(get(e, 'C1')).toBe(21);
    set(e, 'A1', '5');
    expect(get(e, 'B1')).toBe(50);
    expect(get(e, 'C1')).toBe(51);
  });

  it('only recalculates cells affected by the change', () => {
    const e = sheet({
      A1: '1', B1: '=A1+1', C1: '=B1+1',
      A2: '1', B2: '=A2+1', C2: '=B2+1',
      D1: '=SUM(A2:B2)',
    });
    const r = set(e, 'A1', '10');
    expect(addresses(r.updated)).toEqual(['A1', 'B1', 'C1']);
    expect(r.evaluated).toBe(2);

    const r2 = set(e, 'A2', '3');
    expect(addresses(r2.updated)).toEqual(['A2', 'B2', 'C2', 'D1']);
    expect(get(e, 'D1')).toBe(7);
  });

  it('evaluates each affected cell once, in dependency order (diamond)', () => {
    const e = sheet({ A1: '1', B1: '=A1*2', C1: '=A1*3', D1: '=B1+C1' });
    const r = set(e, 'A1', '2');
    expect(r.evaluated).toBe(3);
    expect(get(e, 'D1')).toBe(10);
    const order = r.updated.map(keyToAddress);
    expect(order.indexOf('D1')).toBeGreaterThan(order.indexOf('B1'));
    expect(order.indexOf('D1')).toBeGreaterThan(order.indexOf('C1'));
  });

  it('tracks range references, including cells added later inside the range', () => {
    const e = sheet({ A1: '1', A2: '2', B1: '=SUM(A1:A5)' });
    expect(get(e, 'B1')).toBe(3);
    const r = set(e, 'A4', '10');
    expect(get(e, 'B1')).toBe(13);
    expect(addresses(r.updated)).toEqual(['A4', 'B1']);
  });

  it('tracks whole-column references', () => {
    const e = sheet({ B1: '=SUM(A:A)' });
    set(e, 'A50000', '7');
    expect(get(e, 'B1')).toBe(7);
  });

  it('rewires dependencies when a formula changes', () => {
    const e = sheet({ A1: '1', A2: '2', B1: '=A1' });
    set(e, 'B1', '=A2');
    const r = set(e, 'A1', '100');
    expect(addresses(r.updated)).toEqual(['A1']);
    expect(get(e, 'B1')).toBe(2);
  });

  it('clearing a cell updates its dependents', () => {
    const e = sheet({ A1: '4', B1: '=A1*2' });
    set(e, 'A1', '');
    expect(get(e, 'B1')).toBe(0);
    expect(e.getCell(0, 0)).toBeUndefined();
  });

  it('applies a batch of edits with a single recalculation pass', () => {
    const e = sheet({ C1: '=A1+B1' });
    const r = e.setCells([
      { ...pos('A1'), input: '1' },
      { ...pos('B1'), input: '2' },
    ]);
    expect(get(e, 'C1')).toBe(3);
    expect(r.evaluated).toBe(1);
  });

  it('exposes precedents and dependents', () => {
    const e = sheet({ A1: '1', B1: '=A1+SUM(C1:C3)', D1: '=B1' });
    const p = e.getPrecedents(0, 1)!;
    expect(p.cells.map(keyToAddress)).toEqual(['A1']);
    expect(p.ranges).toEqual([{ top: 0, left: 2, bottom: 2, right: 2 }]);
    expect(e.getDependents(0, 0).map(keyToAddress)).toEqual(['B1']);
    expect(e.getDependents(1, 2).map(keyToAddress)).toEqual(['B1']);
  });

  it('recalculates volatile functions on every change', () => {
    const e = sheet({ A1: '=RAND()', B1: '=A1' });
    const r = set(e, 'Z1', 'x');
    expect(addresses(r.updated)).toEqual(['A1', 'B1', 'Z1']);
  });

  it('notifies subscribers', () => {
    const e = new SpreadsheetEngine();
    const seen: number[] = [];
    e.subscribe((r) => seen.push(r.updated.length));
    set(e, 'A1', '1');
    expect(seen).toEqual([1]);
  });
});

describe('circular references', () => {
  it('detects a self reference', () => {
    const e = sheet({ A1: '=A1+1' });
    const v = get(e, 'A1');
    expect(errorCode(v)).toBe('#CIRC!');
    expect(v).toMatchObject({ message: 'Circular reference: A1 refers to itself.', start: 1, end: 3 });
  });

  it('detects a range that contains its own cell', () => {
    const e = sheet({ A1: '1', A3: '=SUM(A1:A5)' });
    expect(get(e, 'A3')).toMatchObject({
      code: '#CIRC!',
      message: 'Circular reference: A3 is inside the range A1:A5 that it refers to.',
    });
  });

  it('detects indirect cycles and describes the path from each cell', () => {
    const e = sheet({ A1: '=B1+1', B1: '=C1+1' });
    const r = set(e, 'C1', '=A1+1');
    expect(r.cycles).toHaveLength(1);
    expect(get(e, 'A1')).toMatchObject({ code: '#CIRC!', message: 'Circular reference: A1 → B1 → C1 → A1.' });
    expect(get(e, 'B1')).toMatchObject({ message: 'Circular reference: B1 → C1 → A1 → B1.' });
    expect(get(e, 'C1')).toMatchObject({ message: 'Circular reference: C1 → A1 → B1 → C1.', start: 1, end: 3 });
  });

  it('propagates the cycle error to cells that depend on the cycle', () => {
    const e = sheet({ A1: '=B1', B1: '=A1', C1: '=A1*2' });
    expect(errorCode(get(e, 'C1'))).toBe('#CIRC!');
    expect((get(e, 'C1') as { message: string }).message).toMatch(/^A1 contains #CIRC!/);
  });

  it('recovers when the cycle is broken', () => {
    const e = sheet({ A1: '=B1+1', B1: '=A1+1', C1: '=A1' });
    set(e, 'B1', '10');
    expect(get(e, 'A1')).toBe(11);
    expect(get(e, 'C1')).toBe(11);
    expect(e.stats.errors).toBe(0);
  });

  it('handles long cycles without recursion problems', () => {
    const cells: Record<string, string> = {};
    for (let i = 1; i < 5000; i++) cells[`A${i}`] = `=A${i + 1}`;
    cells.A5000 = '=A1';
    const e = sheet(cells);
    expect(errorCode(get(e, 'A2500'))).toBe('#CIRC!');
    expect((get(e, 'A1') as { message: string }).message).toContain('…');
  });
});

describe('errors and diagnostics in cells', () => {
  it('keeps parse errors with position, suggestion and fix', () => {
    const e = sheet({ A1: '=SUM(A2, B2' });
    expect(get(e, 'A1')).toMatchObject({
      code: '#ERROR!',
      message: 'Missing closing parenthesis.',
      start: 11,
      suggestion: "Add ')' at the end of the formula.",
      fix: '=SUM(A2, B2)',
    });
  });

  it('suggests the closest function for a misspelled name', () => {
    const e = sheet({ A1: '=SUMM(B1:B3)', A2: '=VLOKUP(1, B1:C3, 2)', A3: '=AVG(B1:B3)' });
    expect(get(e, 'A1')).toMatchObject({ code: '#NAME?', suggestion: 'Did you mean SUM?', fix: '=SUM(B1:B3)', start: 1, end: 5 });
    expect(get(e, 'A2')).toMatchObject({ fix: '=VLOOKUP(1, B1:C3, 2)' });
    expect(get(e, 'A3')).toMatchObject({ fix: '=AVERAGE(B1:B3)' });
  });

  it('reports wrong argument counts with the function signature', () => {
    const e = sheet({ A1: '=IF(1, 2, 3, 4)', A2: '=VLOOKUP(1)' });
    expect(get(e, 'A1')).toMatchObject({
      code: '#ERROR!',
      message: 'IF expects 2 to 3 arguments, but got 4.',
      suggestion: 'Usage: IF(logical_test, value_if_true, [value_if_false])',
      start: 13,
    });
    expect(get(e, 'A2')).toMatchObject({ message: 'VLOOKUP expects 3 to 4 arguments, but got 1.' });
  });

  it('treats unknown bare words as #NAME? and offers quoting', () => {
    const e = sheet({ A1: '=hello & " world"', A2: '=PI' });
    expect(get(e, 'A1')).toMatchObject({ code: '#NAME?', fix: '="hello" & " world"' });
    expect(get(e, 'A2')).toMatchObject({ code: '#NAME?', fix: '=PI()' });
  });

  it('chains fixes: closing quote then closing parenthesis', () => {
    const e = sheet({ A1: '=CONCAT("abc' });
    expect(get(e, 'A1')).toMatchObject({ message: 'Missing closing quote.', fix: '=CONCAT("abc")' });
  });

  it('explains division by zero at the divisor', () => {
    const e = sheet({ A1: '10', B1: '0', C1: '=A1/B1' });
    expect(get(e, 'C1')).toMatchObject({
      code: '#DIV/0!',
      message: 'Division by zero: B1 is 0.',
      start: 4,
      end: 6,
      fix: '=IFERROR(A1/B1, 0)',
    });
  });

  it('explains text used in arithmetic at the operand', () => {
    const e = sheet({ A1: 'abc', B1: '=A1*2' });
    expect(get(e, 'B1')).toMatchObject({ code: '#VALUE!', start: 1, end: 3 });
  });

  it('points propagated errors at the reference and names the source', () => {
    const e = sheet({ A1: '=1/0', B1: '=A1', C1: '=5+B1' });
    expect(get(e, 'C1')).toMatchObject({
      code: '#DIV/0!',
      start: 3,
      end: 5,
      sourceKey: toKey(0, 0),
      message: 'B1 contains #DIV/0! (originating in A1): Division by zero.',
    });
  });

  it('suggests SUM for a range used as a single value', () => {
    const e = sheet({ A1: '=B1:B3*2' });
    expect(get(e, 'A1')).toMatchObject({ code: '#VALUE!', fix: '=SUM(B1:B3)*2' });
  });

  it('reports VLOOKUP misses with a suggestion', () => {
    const e = sheet({ A1: 'x', B1: '1', C1: '=VLOOKUP("y", A1:B1, 2, FALSE)' });
    expect(get(e, 'C1')).toMatchObject({ code: '#N/A', message: 'VLOOKUP could not find the text "y" in the first column of A1:B1.' });
  });

  it('tracks the set of error cells', () => {
    const e = sheet({ A1: '=1/0', A2: '=A1', A3: '1' });
    expect(e.getErrorCells().map(keyToAddress)).toEqual(['A1', 'A2']);
    set(e, 'A1', '2');
    expect(e.getErrorCells()).toEqual([]);
  });
});

describe('literals', () => {
  it('parses numbers, percentages, booleans and forced text', () => {
    const e = sheet({ A1: '42', A2: ' -3.5 ', A3: '12%', A4: 'true', A5: "'123", A6: 'hello', A7: '1e3' });
    expect(get(e, 'A1')).toBe(42);
    expect(get(e, 'A2')).toBe(-3.5);
    expect(get(e, 'A3')).toBe(0.12);
    expect(get(e, 'A4')).toBe(true);
    expect(get(e, 'A5')).toBe('123');
    expect(get(e, 'A6')).toBe('hello');
    expect(get(e, 'A7')).toBe(1000);
  });
});

describe('performance', () => {
  it('handles a 10,000-cell dependency chain and partial recalculation', () => {
    const cells = [{ row: 0, col: 0, input: '1' }];
    for (let r = 1; r < 10_000; r++) cells.push({ row: r, col: 0, input: `=A${r}+1` });
    const e = new SpreadsheetEngine();
    const t0 = performance.now();
    e.setCells(cells);
    const loadMs = performance.now() - t0;
    expect(e.getValue(9_999, 0)).toBe(10_000);

    const r = e.setCell(5_000, 0, '0');
    expect(r.evaluated).toBe(4_999);
    expect(e.getValue(9_999, 0)).toBe(4_999);
    expect(loadMs).toBeLessThan(2_000);
  });

  it('loads 100,000 cells with 20,000 range formulas quickly', () => {
    const cells = [];
    for (let r = 0; r < 20_000; r++) {
      for (let c = 0; c < 4; c++) cells.push({ row: r, col: c, input: String(r * 4 + c) });
      cells.push({ row: r, col: 4, input: `=SUM(A${r + 1}:D${r + 1})` });
    }
    const e = new SpreadsheetEngine();
    const t0 = performance.now();
    e.setCells(cells);
    const ms = performance.now() - t0;
    expect(e.stats.cells).toBe(100_000);
    expect(e.getValue(19_999, 4)).toBe(4 * 79_996 + 6);
    expect(ms).toBeLessThan(3_000);

    const r = e.setCell(10, 2, '0');
    expect(r.evaluated).toBe(1);
  });
});
