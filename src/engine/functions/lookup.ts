import { compareScalars, describeValue, isError, type CellValue, type Scalar } from '../values';
import type { RangeValue } from '../range';
import type { Args, FunctionSpec } from './args';
import { approximateIndex, exactMatcher } from './helpers';

function notFound(a: Args, lookup: Scalar, where: string, approximate: boolean): never {
  a.fail('#N/A', `${a.name} could not find ${describeValue(lookup)} in ${where}.`, 0, {
    suggestion: approximate
      ? 'Approximate match needs the lookup column sorted ascending. Pass FALSE (or 0) for an exact match.'
      : `Check the lookup value for typos or extra spaces, or provide a fallback with IFNA(${a.ctx.formula.slice(1)}, "Not found").`,
  });
}

function findExact(count: number, get: (i: number) => CellValue, lookup: Scalar, reverse = false): number {
  const matches = exactMatcher(lookup);
  if (reverse) {
    for (let i = count - 1; i >= 0; i--) if (matches(get(i))) return i;
  } else {
    for (let i = 0; i < count; i++) if (matches(get(i))) return i;
  }
  return -1;
}

/** Shared implementation of VLOOKUP (vertical) and HLOOKUP (horizontal). */
function tableLookup(a: Args, vertical: boolean): CellValue {
  const lookup = a.plain(0);
  const table = a.range(1);
  const index = Math.trunc(a.number(2));
  const approximate = a.bool(3, true);
  const span = vertical ? table.cols : table.rows;
  const unit = vertical ? 'column' : 'row';
  if (index < 1) a.fail('#VALUE!', `${a.name}: the ${unit} index must be at least 1 (got ${index}).`, 2);
  if (index > span) {
    a.fail('#REF!', `${a.name}: ${unit} index ${index} is outside the ${span} ${unit}${span > 1 ? 's' : ''} of ${table.label}.`, 2, {
      suggestion: `Use a ${unit} index between 1 and ${span}, or widen the table range.`,
    });
  }
  const count = vertical ? table.effectiveRows() : table.effectiveCols();
  const keyAt = (i: number) => (vertical ? table.get(i, 0) : table.get(0, i));
  const idx = approximate ? approximateIndex(count, keyAt, lookup) : findExact(count, keyAt, lookup);
  if (idx < 0) notFound(a, lookup, `the first ${unit} of ${table.label}`, approximate);
  const v = vertical ? table.get(idx, index - 1) : table.get(index - 1, idx);
  return v === null ? 0 : v;
}

function vector(a: Args, i: number): RangeValue {
  const r = a.range(i);
  if (r.rows !== 1 && r.cols !== 1) {
    a.fail('#N/A', `${a.name} expects a single row or column for argument ${i + 1}, but ${r.label} is ${r.rows}×${r.cols}.`, i);
  }
  return r;
}

const vectorLength = (r: RangeValue) => (r.cols === 1 ? r.effectiveRows() : r.effectiveCols());
const vectorGet = (r: RangeValue, i: number) => (r.cols === 1 ? r.get(i, 0) : r.get(0, i));

export const lookupFunctions: FunctionSpec[] = [
  {
    name: 'VLOOKUP',
    category: 'Lookup',
    minArgs: 3,
    maxArgs: 4,
    args: 'lookup_value, table_array, col_index, [range_lookup]',
    description:
      'Looks for a value in the first column of a table and returns the value in the same row from another column. range_lookup FALSE = exact match; TRUE (default) = approximate match on sorted data.',
    example: '=VLOOKUP("Pears", A2:C10, 3, FALSE)',
    impl: (a) => tableLookup(a, true),
  },
  {
    name: 'HLOOKUP',
    category: 'Lookup',
    minArgs: 3,
    maxArgs: 4,
    args: 'lookup_value, table_array, row_index, [range_lookup]',
    description: 'Looks for a value in the first row of a table and returns the value in the same column from another row.',
    example: '=HLOOKUP("Q2", A1:E3, 2, FALSE)',
    impl: (a) => tableLookup(a, false),
  },
  {
    name: 'XLOOKUP',
    category: 'Lookup',
    minArgs: 3,
    maxArgs: 6,
    args: 'lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode]',
    description:
      'Searches lookup_array and returns the matching item from return_array. match_mode: 0 exact (default), -1 exact or next smaller, 1 exact or next larger, 2 wildcard. search_mode: 1 first-to-last, -1 last-to-first.',
    example: '=XLOOKUP(E2, A2:A100, C2:C100, "Missing")',
    impl: (a) => {
      const lookup = a.plain(0);
      const keys = vector(a, 1);
      const values = a.range(2);
      const vertical = keys.cols === 1;
      const len = vertical ? keys.rows : keys.cols;
      if ((vertical ? values.rows : values.cols) !== len) {
        a.fail('#VALUE!', `XLOOKUP: return_array ${values.label} must have the same length as lookup_array ${keys.label}.`, 2);
      }
      const mode = Math.trunc(a.number(4, 0));
      const reverse = Math.trunc(a.number(5, 1)) < 0;
      const count = vectorLength(keys);
      let idx = -1;
      if (mode === 0 || mode === 2) {
        idx = findExact(count, (i) => vectorGet(keys, i), mode === 2 ? lookup : typeof lookup === 'string' ? lookup.replace(/[*?]/g, '~$&') : lookup, reverse);
      } else if (mode === -1 || mode === 1) {
        let best: Scalar = null;
        for (let k = 0; k < count; k++) {
          const i = reverse ? count - 1 - k : k;
          const v = vectorGet(keys, i);
          if (v === null || isError(v) || typeof v !== typeof lookup) continue;
          const c = compareScalars(v, lookup);
          if (c === 0) {
            idx = i;
            break;
          }
          const better =
            mode === -1
              ? c < 0 && (best === null || compareScalars(v, best) > 0)
              : c > 0 && (best === null || compareScalars(v, best) < 0);
          if (better) {
            best = v;
            idx = i;
          }
        }
      } else {
        a.fail('#VALUE!', 'XLOOKUP match_mode must be 0, -1, 1 or 2.', 4);
      }
      if (idx < 0) {
        if (a.has(3)) return a.value(3);
        notFound(a, lookup, keys.label, false);
      }
      if (vertical) return values.cols === 1 ? values.get(idx, 0) : values.sub(idx, 0, idx, values.cols - 1);
      return values.rows === 1 ? values.get(0, idx) : values.sub(0, idx, values.rows - 1, idx);
    },
  },
  {
    name: 'INDEX',
    category: 'Lookup',
    minArgs: 2,
    maxArgs: 3,
    args: 'array, row_num, [col_num]',
    description: 'The value at a given row and column of a range (1-based). A row or column of 0 returns the whole column or row.',
    example: '=INDEX(A2:C10, 4, 2)',
    impl: (a) => {
      const r = a.range(0);
      let row = Math.trunc(a.number(1));
      let col = Math.trunc(a.number(2, a.has(2) ? 0 : 1));
      // INDEX(single_row_range, n) addresses columns.
      if (!a.has(2) && r.rows === 1 && r.cols > 1) {
        col = row;
        row = 1;
      }
      if (row < 0 || col < 0 || row > r.rows || col > r.cols) {
        a.fail('#REF!', `INDEX position (${row}, ${col}) is outside ${r.label} (${r.rows}×${r.cols}).`, row > r.rows || row < 0 ? 1 : 2);
      }
      if (row === 0 && col === 0) return r;
      if (row === 0) return r.sub(0, col - 1, r.rows - 1, col - 1);
      if (col === 0) return r.sub(row - 1, 0, row - 1, r.cols - 1);
      return r.get(row - 1, col - 1);
    },
  },
  {
    name: 'MATCH',
    category: 'Lookup',
    minArgs: 2,
    maxArgs: 3,
    args: 'lookup_value, lookup_array, [match_type]',
    description: 'Relative position of a value in a row or column. match_type 0 = exact, 1 (default) = largest value ≤ lookup (ascending data), -1 = smallest value ≥ lookup (descending data).',
    example: '=MATCH("Kiwi", A2:A20, 0)',
    impl: (a) => {
      const lookup = a.plain(0);
      const keys = vector(a, 1);
      const type = Math.sign(Math.trunc(a.number(2, 1)));
      const count = vectorLength(keys);
      const get = (i: number) => vectorGet(keys, i);
      const idx = type === 0 ? findExact(count, get, lookup) : approximateIndex(count, get, lookup, type < 0);
      if (idx < 0) notFound(a, lookup, keys.label, type !== 0);
      return idx + 1;
    },
  },
  {
    name: 'CHOOSE',
    category: 'Lookup',
    minArgs: 2,
    maxArgs: Infinity,
    args: 'index_num, value1, [value2], ...',
    description: 'Returns the value at position index_num from the list of values. Only the chosen value is evaluated.',
    example: '=CHOOSE(2, "Low", "Medium", "High")',
    impl: (a) => {
      const i = Math.trunc(a.number(0));
      if (i < 1 || i >= a.length) a.fail('#VALUE!', `CHOOSE index ${i} is out of range (1 to ${a.length - 1}).`, 0);
      return a.value(i);
    },
  },
  {
    name: 'ROW',
    category: 'Lookup',
    minArgs: 0,
    maxArgs: 1,
    args: '[reference]',
    description: 'Row number of a reference, or of the current cell when omitted.',
    example: '=ROW(B7)',
    impl: (a) => {
      if (!a.has(0)) return a.ctx.row + 1;
      const n = a.node(0);
      if (n.type === 'cell') return n.row + 1;
      if (n.type === 'range') return n.top + 1;
      return a.range(0).bounds.top + 1;
    },
  },
  {
    name: 'COLUMN',
    category: 'Lookup',
    minArgs: 0,
    maxArgs: 1,
    args: '[reference]',
    description: 'Column number of a reference, or of the current cell when omitted.',
    example: '=COLUMN(D1)',
    impl: (a) => {
      if (!a.has(0)) return a.ctx.col + 1;
      const n = a.node(0);
      if (n.type === 'cell') return n.col + 1;
      if (n.type === 'range') return n.left + 1;
      return a.range(0).bounds.left + 1;
    },
  },
  {
    name: 'ROWS',
    category: 'Lookup',
    minArgs: 1,
    maxArgs: 1,
    args: 'range',
    description: 'Number of rows in a range.',
    example: '=ROWS(A1:C10)',
    impl: (a) => (a.node(0).type === 'cell' ? 1 : a.range(0).rows),
  },
  {
    name: 'COLUMNS',
    category: 'Lookup',
    minArgs: 1,
    maxArgs: 1,
    args: 'range',
    description: 'Number of columns in a range.',
    example: '=COLUMNS(A1:C10)',
    impl: (a) => (a.node(0).type === 'cell' ? 1 : a.range(0).cols),
  },
];
