/**
 * Built-in documents: a small feature tour and a large generated dataset.
 */
import { parseAddress, type CellInput } from '../engine';
import type { CellFormat } from '../ui/display';

export interface SheetDocument {
  cells: CellInput[];
  formats: Array<[row: number, col: number, format: CellFormat]>;
}

function fromAddresses(entries: Record<string, string>): CellInput[] {
  return Object.entries(entries).map(([address, input]) => {
    const p = parseAddress(address)!;
    return { row: p.row, col: p.col, input };
  });
}

function fmt(address: string, format: CellFormat): [number, number, CellFormat] {
  const p = parseAddress(address)!;
  return [p.row, p.col, format];
}

export function demoSheet(): SheetDocument {
  const products = [
    ['Apple', 'East', 120, 1.2],
    ['Banana', 'West', 340, 0.5],
    ['Cherry', 'East', 85, 6.5],
    ['Dragonfruit', 'North', 40, 4.75],
    ['Elderberry', 'West', 210, 3.1],
    ['Fig', 'East', 64, 2.4],
  ] as const;

  const cells: Record<string, string> = {
    A1: 'Gridline — formula engine demo (edit the Units / Price columns and watch everything update)',
    A3: 'Product',
    B3: 'Region',
    C3: 'Units',
    D3: 'Price',
    E3: 'Revenue',
    F3: 'Status',
    A11: 'Totals',
    C11: '=SUM(C4:C9)',
    E11: '=SUM(E4:E9)',
    A12: 'Average price',
    D12: '=AVERAGE(D4:D9)',
    A13: 'Best revenue',
    E13: '=MAX(E4:E9)',
    A14: 'East revenue',
    E14: '=SUMIF(B4:B9, "East", E4:E9)',
    A15: 'Products in East',
    E15: '=COUNTIF(B4:B9, "East")',
    A16: 'Best seller',
    E16: '=INDEX(A4:A9, MATCH(E13, E4:E9, 0))',

    H3: 'Lookup',
    H4: 'Product',
    I4: 'Cherry',
    H5: 'Revenue',
    I5: '=VLOOKUP(I4, A4:E9, 5, FALSE)',
    H6: 'Share of total',
    I6: '=I5/E11',
    H7: 'Label',
    I7: '=UPPER(I4) & " → " & TEXT(I5, "$#,##0.00")',
    H8: 'Grade',
    I8: '=IFS(I6>=0.3, "A", I6>=0.15, "B", TRUE, "C")',

    H10: 'Error diagnostics (select a cell)',
    H11: 'Division by zero',
    I11: '=E11/H99',
    H12: 'Misspelled function',
    I12: '=SUMM(C4:C9)',
    H13: 'Missing parenthesis',
    I13: '=SUM(C4:C9',
    H14: 'Lookup miss',
    I14: '=VLOOKUP("Kiwi", A4:E9, 5, FALSE)',
    H15: 'Circular (direct)',
    I15: '=I15+1',
    H16: 'Circular (indirect)',
    I16: '=I17*2',
    I17: '=I16+1',
    H18: 'Text in arithmetic',
    I18: '=A4*2',
    H19: 'Handled with IFERROR',
    I19: '=IFERROR(I14, "not stocked")',

    H21: 'Today',
    I21: '=TODAY()',
    H22: 'Days to year end',
    I22: '=DATE(YEAR(I21), 12, 31)-I21',
  };
  products.forEach(([name, region, units, price], i) => {
    const r = 4 + i;
    cells[`A${r}`] = name;
    cells[`B${r}`] = region;
    cells[`C${r}`] = String(units);
    cells[`D${r}`] = String(price);
    cells[`E${r}`] = `=C${r}*D${r}`;
    cells[`F${r}`] = `=IF(E${r}>=300, "Target met", "Below target")`;
  });

  const formats: SheetDocument['formats'] = [fmt('A1', { bold: true })];
  for (const a of ['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'H3', 'H10', 'A11']) formats.push(fmt(a, { bold: true }));
  for (let r = 4; r <= 9; r++) {
    formats.push(fmt(`D${r}`, { numberFormat: 'currency' }));
    formats.push(fmt(`E${r}`, { numberFormat: 'currency' }));
  }
  for (const a of ['E11', 'D12', 'E13', 'E14', 'I5']) formats.push(fmt(a, { numberFormat: 'currency', bold: a === 'E11' }));
  formats.push(fmt('C11', { bold: true }), fmt('I6', { numberFormat: 'percent' }), fmt('I21', { numberFormat: 'date' }));

  return { cells: fromAddresses(cells), formats };
}

/** Deterministic pseudo-random generator so generated datasets are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * A large table: `rows` data rows × 8 columns (~45% formulas), including a running
 * total that forms a dependency chain through every row, plus whole-column summaries.
 */
export function largeSheet(rows = 10_000): SheetDocument {
  const rand = rng(42);
  const categories = ['Hardware', 'Software', 'Services', 'Training'];
  const names = ['Widget', 'Gadget', 'Sprocket', 'Gizmo', 'Doohickey', 'Module', 'Adapter', 'Bracket'];
  const cells: CellInput[] = [];
  const header = ['ID', 'Product', 'Category', 'Price', 'Qty', 'Revenue', 'Tier', 'Running total'];
  header.forEach((h, col) => cells.push({ row: 0, col, input: h }));
  for (let i = 0; i < rows; i++) {
    const row = i + 1;
    const r = row + 1; // 1-based label
    cells.push({ row, col: 0, input: String(i + 1) });
    cells.push({ row, col: 1, input: `${names[Math.floor(rand() * names.length)]} ${i + 1}` });
    cells.push({ row, col: 2, input: categories[Math.floor(rand() * categories.length)] });
    cells.push({ row, col: 3, input: String(Math.round((5 + rand() * 195) * 100) / 100) });
    cells.push({ row, col: 4, input: String(1 + Math.floor(rand() * 50)) });
    cells.push({ row, col: 5, input: `=D${r}*E${r}` });
    cells.push({ row, col: 6, input: `=IF(F${r}>=5000, "High", IF(F${r}>=1000, "Medium", "Low"))` });
    cells.push({ row, col: 7, input: row === 1 ? `=F${r}` : `=H${r - 1}+F${r}` });
  }
  const summary: Array<[string, string]> = [
    ['Total revenue', '=SUM(F:F)'],
    ['Average price', '=AVERAGE(D:D)'],
    ['Hardware rows', '=COUNTIF(C:C, "Hardware")'],
    ['High-tier rows', '=COUNTIF(G:G, "High")'],
    ['Largest order', '=MAX(F:F)'],
    [`Revenue of ID ${Math.ceil(rows / 2)}`, `=VLOOKUP(${Math.ceil(rows / 2)}, A:F, 6, FALSE)`],
    ['Software revenue', '=SUMIF(C:C, "Software", F:F)'],
    ['Final running total', `=INDEX(H:H, ${rows + 1})`],
  ];
  cells.push({ row: 0, col: 9, input: 'Summary (whole-column formulas)' });
  summary.forEach(([label, formula], i) => {
    cells.push({ row: i + 1, col: 9, input: label });
    cells.push({ row: i + 1, col: 10, input: formula });
  });

  const formats: SheetDocument['formats'] = [];
  for (let col = 0; col < 8; col++) formats.push([0, col, { bold: true }]);
  formats.push([0, 9, { bold: true }]);
  for (const i of [0, 1, 4, 5, 6, 7]) formats.push([i + 1, 10, { numberFormat: i === 1 ? 'currency' : 'number' }]);
  return { cells, formats };
}
