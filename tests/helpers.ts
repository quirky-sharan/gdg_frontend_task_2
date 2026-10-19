import { parseAddress, SpreadsheetEngine, type CellValue } from '../src/engine';

export function pos(address: string) {
  const p = parseAddress(address);
  if (!p) throw new Error(`bad address ${address}`);
  return p;
}

/** Creates an engine pre-filled with { A1: '1', B1: '=A1*2', ... }. */
export function sheet(cells: Record<string, string> = {}): SpreadsheetEngine {
  const engine = new SpreadsheetEngine();
  engine.setCells(Object.entries(cells).map(([addr, input]) => ({ ...pos(addr), input })));
  return engine;
}

export function set(engine: SpreadsheetEngine, address: string, input: string) {
  const { row, col } = pos(address);
  return engine.setCell(row, col, input);
}

export function get(engine: SpreadsheetEngine, address: string): CellValue {
  const { row, col } = pos(address);
  return engine.getValue(row, col);
}

/** Evaluates a single formula in an otherwise prepared sheet (written to Z1000). */
export function evaluate(formula: string, cells: Record<string, string> = {}): CellValue {
  const engine = sheet(cells);
  set(engine, 'Z1000', formula);
  return get(engine, 'Z1000');
}

export function errorCode(v: CellValue): string | undefined {
  return v !== null && typeof v === 'object' ? v.code : undefined;
}
