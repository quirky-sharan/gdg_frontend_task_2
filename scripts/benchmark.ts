/**
 * Engine benchmark: `npm run bench`.
 * Measures load and incremental recalculation on the generated sales dataset.
 */
import { SpreadsheetEngine } from '../src/engine';
import { largeSheet } from '../src/state/samples';

function time<T>(fn: () => T): [T, number] {
  const t0 = performance.now();
  const result = fn();
  return [result, performance.now() - t0];
}

function report(label: string, ms: number, extra = '') {
  console.log(`${label.padEnd(48)} ${ms.toFixed(1).padStart(8)} ms  ${extra}`);
}

for (const rows of [10_000, 50_000]) {
  const doc = largeSheet(rows);
  const engine = new SpreadsheetEngine();
  const [load, loadMs] = time(() => engine.setCells(doc.cells));
  console.log(`\nDataset: ${rows.toLocaleString()} rows, ${engine.stats.cells.toLocaleString()} cells, ${engine.stats.formulas.toLocaleString()} formulas`);
  report('Initial load (parse + full calculation)', loadMs, `${load.evaluated.toLocaleString()} evaluations`);

  const [head, headMs] = time(() => engine.setCell(1, 3, '999'));
  report('Edit first price (running total through every row)', headMs, `${head.evaluated.toLocaleString()} evaluations`);

  const mid = Math.floor(rows / 2);
  const [middle, midMs] = time(() => engine.setCell(mid, 3, '5'));
  report('Edit a price halfway down', midMs, `${middle.evaluated.toLocaleString()} evaluations`);

  const [label, labelMs] = time(() => engine.setCell(mid, 1, 'Renamed product'));
  report('Edit a product name (read only by VLOOKUP A:F)', labelMs, `${label.evaluated.toLocaleString()} evaluations`);

  const [note, noteMs] = time(() => engine.setCell(mid, 20, 'note'));
  report('Edit a cell nothing depends on', noteMs, `${note.evaluated.toLocaleString()} evaluations`);

  const [all, allMs] = time(() => engine.recalculateAll());
  report('Full recalculation (F9)', allMs, `${all.evaluated.toLocaleString()} evaluations`);
}
