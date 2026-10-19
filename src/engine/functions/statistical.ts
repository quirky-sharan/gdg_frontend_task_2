import { isError, normalizeNumber, parseNumericText } from '../values';
import type { Args, FunctionSpec } from './args';
import { Accumulator, criteriaPairs, forEachCriteriaPosition, parseCriteria, preciseSum } from './helpers';

function mean(xs: number[]): number {
  return preciseSum(xs) / xs.length;
}

function variance(a: Args, sample: boolean): number {
  const xs = a.numbers();
  const needed = sample ? 2 : 1;
  if (xs.length < needed) {
    a.fail('#DIV/0!', `${a.name} needs at least ${needed} numeric value${needed > 1 ? 's' : ''}.`);
  }
  const m = mean(xs);
  let ss = 0;
  for (const x of xs) ss += (x - m) * (x - m);
  return ss / (xs.length - (sample ? 1 : 0));
}

function kth(a: Args, largest: boolean): number {
  const xs = a.numbers(0, 1);
  const k = Math.ceil(a.number(1));
  if (xs.length === 0 || k < 1 || k > xs.length) {
    a.fail('#NUM!', `${a.name}: k must be between 1 and the number of values (${xs.length}).`, 1);
  }
  xs.sort((x, y) => (largest ? y - x : x - y));
  return xs[k - 1];
}

export const statisticalFunctions: FunctionSpec[] = [
  {
    name: 'AVERAGE',
    category: 'Statistical',
    minArgs: 1,
    maxArgs: Infinity,
    args: 'number1, [number2], ...',
    description: 'Arithmetic mean of the numbers in the arguments.',
    example: '=AVERAGE(B2:B20)',
    impl: (a) => {
      const xs = a.numbers();
      if (xs.length === 0) {
        a.fail('#DIV/0!', 'AVERAGE has no numbers to average.', undefined, {
          suggestion: 'Make sure the range contains numeric values.',
        });
      }
      return normalizeNumber(mean(xs));
    },
  },
  {
    name: 'AVERAGEIF',
    category: 'Statistical',
    minArgs: 2,
    maxArgs: 3,
    args: 'range, criterion, [average_range]',
    description: 'Average of the cells that meet a criterion.',
    example: '=AVERAGEIF(A2:A10, "East", B2:B10)',
    impl: (a) => {
      const range = a.range(0);
      const predicate = parseCriteria(a.plain(1));
      const avgRange = a.has(2) ? a.range(2) : range;
      const total = new Accumulator();
      let count = 0;
      forEachCriteriaPosition([range], [predicate], (r, c) => {
        const v = avgRange.get(r, c);
        if (isError(v)) a.raise(v, 2);
        if (typeof v === 'number') {
          total.add(v);
          count++;
        }
      });
      if (count === 0) a.fail('#DIV/0!', 'No cells matched the AVERAGEIF criterion.', 1);
      return normalizeNumber(total.value / count);
    },
  },
  {
    name: 'MIN',
    category: 'Statistical',
    minArgs: 1,
    maxArgs: Infinity,
    args: 'number1, [number2], ...',
    description: 'Smallest number in the arguments (0 if there are none).',
    example: '=MIN(A1:A100)',
    impl: (a) => {
      const xs = a.numbers();
      let m = Infinity;
      for (const x of xs) if (x < m) m = x;
      return xs.length ? m : 0;
    },
  },
  {
    name: 'MAX',
    category: 'Statistical',
    minArgs: 1,
    maxArgs: Infinity,
    args: 'number1, [number2], ...',
    description: 'Largest number in the arguments (0 if there are none).',
    example: '=MAX(A1:A100)',
    impl: (a) => {
      const xs = a.numbers();
      let m = -Infinity;
      for (const x of xs) if (x > m) m = x;
      return xs.length ? m : 0;
    },
  },
  {
    name: 'MEDIAN',
    category: 'Statistical',
    minArgs: 1,
    maxArgs: Infinity,
    args: 'number1, [number2], ...',
    description: 'Median (middle value) of the numbers.',
    example: '=MEDIAN(A1:A9)',
    impl: (a) => {
      const xs = a.numbers().sort((x, y) => x - y);
      if (xs.length === 0) a.fail('#NUM!', 'MEDIAN has no numbers.');
      const mid = Math.floor(xs.length / 2);
      return xs.length % 2 ? xs[mid] : normalizeNumber((xs[mid - 1] + xs[mid]) / 2);
    },
  },
  {
    name: 'MODE',
    category: 'Statistical',
    minArgs: 1,
    maxArgs: Infinity,
    args: 'number1, [number2], ...',
    description: 'Most frequently occurring number.',
    example: '=MODE(1, 2, 2, 3)',
    impl: (a) => {
      const counts = new Map<number, number>();
      let best: number | null = null;
      let bestCount = 1;
      for (const x of a.numbers()) {
        const c = (counts.get(x) ?? 0) + 1;
        counts.set(x, c);
        if (c > bestCount) {
          bestCount = c;
          best = x;
        }
      }
      if (best === null) a.fail('#N/A', 'MODE found no repeated values.');
      return best;
    },
  },
  {
    name: 'STDEV',
    category: 'Statistical',
    minArgs: 1,
    maxArgs: Infinity,
    args: 'number1, [number2], ...',
    description: 'Sample standard deviation.',
    example: '=STDEV(A1:A10)',
    impl: (a) => normalizeNumber(Math.sqrt(variance(a, true))),
  },
  {
    name: 'STDEVP',
    category: 'Statistical',
    minArgs: 1,
    maxArgs: Infinity,
    args: 'number1, [number2], ...',
    description: 'Population standard deviation.',
    example: '=STDEVP(A1:A10)',
    impl: (a) => normalizeNumber(Math.sqrt(variance(a, false))),
  },
  {
    name: 'VAR',
    category: 'Statistical',
    minArgs: 1,
    maxArgs: Infinity,
    args: 'number1, [number2], ...',
    description: 'Sample variance.',
    example: '=VAR(A1:A10)',
    impl: (a) => normalizeNumber(variance(a, true)),
  },
  {
    name: 'VARP',
    category: 'Statistical',
    minArgs: 1,
    maxArgs: Infinity,
    args: 'number1, [number2], ...',
    description: 'Population variance.',
    example: '=VARP(A1:A10)',
    impl: (a) => normalizeNumber(variance(a, false)),
  },
  {
    name: 'COUNT',
    category: 'Statistical',
    minArgs: 1,
    maxArgs: Infinity,
    args: 'value1, [value2], ...',
    description: 'Counts how many values are numbers.',
    example: '=COUNT(A1:A100)',
    impl: (a) => {
      let n = 0;
      a.forEachValue((v, fromRef) => {
        if (typeof v === 'number') n++;
        else if (!fromRef && (typeof v === 'boolean' || (typeof v === 'string' && parseNumericText(v) !== null))) n++;
      });
      return n;
    },
  },
  {
    name: 'COUNTA',
    category: 'Statistical',
    minArgs: 1,
    maxArgs: Infinity,
    args: 'value1, [value2], ...',
    description: 'Counts values that are not empty (numbers, text, logical values and errors).',
    example: '=COUNTA(A:A)',
    impl: (a) => {
      let n = 0;
      a.forEachValue((v) => {
        if (v !== null) n++;
      });
      return n;
    },
  },
  {
    name: 'COUNTBLANK',
    category: 'Statistical',
    minArgs: 1,
    maxArgs: 1,
    args: 'range',
    description: 'Counts empty cells (and cells containing empty text) in a range.',
    example: '=COUNTBLANK(A1:C10)',
    impl: (a) => {
      const range = a.range(0);
      let filled = 0;
      range.forEachNonEmpty((v) => {
        if (v !== '') filled++;
      });
      return range.area - filled;
    },
  },
  {
    name: 'COUNTIF',
    category: 'Statistical',
    minArgs: 2,
    maxArgs: 2,
    args: 'range, criterion',
    description: 'Counts the cells in a range that meet a criterion, e.g. ">10", "apple" or "a*".',
    example: '=COUNTIF(B2:B100, ">50")',
    impl: (a) => {
      const range = a.range(0);
      const predicate = parseCriteria(a.plain(1));
      let n = 0;
      const { blanksOutsideUsedArea } = forEachCriteriaPosition([range], [predicate], () => n++);
      return n + blanksOutsideUsedArea;
    },
  },
  {
    name: 'COUNTIFS',
    category: 'Statistical',
    minArgs: 2,
    maxArgs: Infinity,
    args: 'criteria_range1, criterion1, [criteria_range2, criterion2], ...',
    description: 'Counts positions where every criteria range meets its criterion.',
    example: '=COUNTIFS(A2:A10, "East", B2:B10, ">100")',
    impl: (a) => {
      const { ranges, predicates } = criteriaPairs(a, 0);
      let n = 0;
      const { blanksOutsideUsedArea } = forEachCriteriaPosition(ranges, predicates, () => n++);
      return n + blanksOutsideUsedArea;
    },
  },
  {
    name: 'LARGE',
    category: 'Statistical',
    minArgs: 2,
    maxArgs: 2,
    args: 'array, k',
    description: 'The k-th largest number in a range.',
    example: '=LARGE(A1:A10, 2)',
    impl: (a) => kth(a, true),
  },
  {
    name: 'SMALL',
    category: 'Statistical',
    minArgs: 2,
    maxArgs: 2,
    args: 'array, k',
    description: 'The k-th smallest number in a range.',
    example: '=SMALL(A1:A10, 2)',
    impl: (a) => kth(a, false),
  },
];
