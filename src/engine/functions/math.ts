import { isError, normalizeNumber } from '../values';
import type { FunctionSpec } from './args';
import { Accumulator, criteriaPairs, forEachCriteriaPosition, parseCriteria, preciseSum } from './helpers';

/** Rounds half away from zero, like spreadsheets do (ROUND(2.5) = 3, ROUND(-2.5) = -3). */
export function roundTo(x: number, digits: number, mode: 'nearest' | 'up' | 'down' = 'nearest'): number {
  const d = Math.trunc(digits);
  const factor = Math.pow(10, Math.abs(d));
  const scaled = normalizeNumber(d >= 0 ? Math.abs(x) * factor : Math.abs(x) / factor);
  const r = mode === 'nearest' ? Math.round(scaled) : mode === 'up' ? Math.ceil(scaled) : Math.floor(scaled);
  const back = d >= 0 ? r / factor : r * factor;
  return Math.sign(x) * normalizeNumber(back);
}

const sum = (xs: number[]) => normalizeNumber(preciseSum(xs));

export const mathFunctions: FunctionSpec[] = [
  {
    name: 'SUM',
    category: 'Math',
    minArgs: 1,
    maxArgs: Infinity,
    args: 'number1, [number2], ...',
    description: 'Adds all numbers in the arguments. Text and logical values inside ranges are ignored.',
    example: '=SUM(A1:A10, 5)',
    impl: (a) => sum(a.numbers()),
  },
  {
    name: 'PRODUCT',
    category: 'Math',
    minArgs: 1,
    maxArgs: Infinity,
    args: 'number1, [number2], ...',
    description: 'Multiplies all numbers in the arguments.',
    example: '=PRODUCT(A1:A3)',
    impl: (a) => {
      const xs = a.numbers();
      return xs.length === 0 ? 0 : xs.reduce((p, x) => p * x, 1);
    },
  },
  {
    name: 'ABS',
    category: 'Math',
    minArgs: 1,
    maxArgs: 1,
    args: 'number',
    description: 'Absolute value of a number.',
    example: '=ABS(-4)',
    impl: (a) => Math.abs(a.number(0)),
  },
  {
    name: 'ROUND',
    category: 'Math',
    minArgs: 1,
    maxArgs: 2,
    args: 'number, [num_digits]',
    description: 'Rounds a number to a number of digits (half away from zero). Negative digits round to the left of the decimal point.',
    example: '=ROUND(3.14159, 2)',
    impl: (a) => roundTo(a.number(0), a.number(1, 0)),
  },
  {
    name: 'ROUNDUP',
    category: 'Math',
    minArgs: 1,
    maxArgs: 2,
    args: 'number, [num_digits]',
    description: 'Rounds a number away from zero.',
    example: '=ROUNDUP(3.141, 1)',
    impl: (a) => roundTo(a.number(0), a.number(1, 0), 'up'),
  },
  {
    name: 'ROUNDDOWN',
    category: 'Math',
    minArgs: 1,
    maxArgs: 2,
    args: 'number, [num_digits]',
    description: 'Rounds a number toward zero.',
    example: '=ROUNDDOWN(3.149, 2)',
    impl: (a) => roundTo(a.number(0), a.number(1, 0), 'down'),
  },
  {
    name: 'INT',
    category: 'Math',
    minArgs: 1,
    maxArgs: 1,
    args: 'number',
    description: 'Rounds a number down to the nearest integer.',
    example: '=INT(-3.5)',
    impl: (a) => Math.floor(a.number(0)),
  },
  {
    name: 'TRUNC',
    category: 'Math',
    minArgs: 1,
    maxArgs: 2,
    args: 'number, [num_digits]',
    description: 'Truncates a number by removing its fractional part (or digits beyond num_digits).',
    example: '=TRUNC(8.97, 1)',
    impl: (a) => roundTo(a.number(0), a.number(1, 0), 'down'),
  },
  {
    name: 'MOD',
    category: 'Math',
    minArgs: 2,
    maxArgs: 2,
    args: 'number, divisor',
    description: 'Remainder after division. The result has the same sign as the divisor.',
    example: '=MOD(10, 3)',
    impl: (a) => {
      const n = a.number(0);
      const d = a.number(1);
      if (d === 0) a.fail('#DIV/0!', 'MOD cannot divide by zero.', 1, { suggestion: 'Use a non-zero divisor.' });
      return normalizeNumber(n - d * Math.floor(n / d));
    },
  },
  {
    name: 'POWER',
    category: 'Math',
    minArgs: 2,
    maxArgs: 2,
    args: 'number, power',
    description: 'Raises a number to a power.',
    example: '=POWER(2, 10)',
    impl: (a) => {
      const base = a.number(0);
      const exp = a.number(1);
      if (base === 0 && exp < 0) a.fail('#DIV/0!', 'Zero raised to a negative power is a division by zero.', 1);
      const r = Math.pow(base, exp);
      if (Number.isNaN(r)) a.fail('#NUM!', `Cannot raise ${base} to the fractional power ${exp}.`, 1);
      return r;
    },
  },
  {
    name: 'SQRT',
    category: 'Math',
    minArgs: 1,
    maxArgs: 1,
    args: 'number',
    description: 'Positive square root of a number.',
    example: '=SQRT(16)',
    impl: (a) => {
      const n = a.number(0);
      if (n < 0) a.fail('#NUM!', `SQRT of a negative number (${n}) is undefined.`, 0, { suggestion: 'Use ABS() first if you need the root of the magnitude.' });
      return Math.sqrt(n);
    },
  },
  {
    name: 'EXP',
    category: 'Math',
    minArgs: 1,
    maxArgs: 1,
    args: 'number',
    description: 'e raised to the power of a number.',
    example: '=EXP(1)',
    impl: (a) => Math.exp(a.number(0)),
  },
  {
    name: 'LN',
    category: 'Math',
    minArgs: 1,
    maxArgs: 1,
    args: 'number',
    description: 'Natural logarithm of a positive number.',
    example: '=LN(10)',
    impl: (a) => {
      const n = a.number(0);
      if (n <= 0) a.fail('#NUM!', 'LN is only defined for positive numbers.', 0);
      return Math.log(n);
    },
  },
  {
    name: 'LOG',
    category: 'Math',
    minArgs: 1,
    maxArgs: 2,
    args: 'number, [base]',
    description: 'Logarithm of a number to a base (default 10).',
    example: '=LOG(8, 2)',
    impl: (a) => {
      const n = a.number(0);
      const base = a.number(1, 10);
      if (n <= 0) a.fail('#NUM!', 'LOG is only defined for positive numbers.', 0);
      if (base <= 0 || base === 1) a.fail('#NUM!', 'The base of LOG must be positive and not 1.', 1);
      return normalizeNumber(Math.log(n) / Math.log(base));
    },
  },
  {
    name: 'LOG10',
    category: 'Math',
    minArgs: 1,
    maxArgs: 1,
    args: 'number',
    description: 'Base-10 logarithm of a number.',
    example: '=LOG10(1000)',
    impl: (a) => {
      const n = a.number(0);
      if (n <= 0) a.fail('#NUM!', 'LOG10 is only defined for positive numbers.', 0);
      return Math.log10(n);
    },
  },
  {
    name: 'PI',
    category: 'Math',
    minArgs: 0,
    maxArgs: 0,
    args: '',
    description: 'The number π (3.14159265358979).',
    example: '=PI()*2^2',
    impl: () => Math.PI,
  },
  {
    name: 'SIGN',
    category: 'Math',
    minArgs: 1,
    maxArgs: 1,
    args: 'number',
    description: 'Returns 1 for positive numbers, -1 for negative numbers and 0 for zero.',
    example: '=SIGN(-12)',
    impl: (a) => Math.sign(a.number(0)),
  },
  {
    name: 'CEILING',
    category: 'Math',
    minArgs: 1,
    maxArgs: 2,
    args: 'number, [significance]',
    description: 'Rounds a number up to the nearest multiple of significance (default 1).',
    example: '=CEILING(4.3, 0.5)',
    impl: (a) => {
      const n = a.number(0);
      const s = a.number(1, 1);
      if (s === 0) return 0;
      return normalizeNumber(Math.ceil(normalizeNumber(n / s)) * s);
    },
  },
  {
    name: 'FLOOR',
    category: 'Math',
    minArgs: 1,
    maxArgs: 2,
    args: 'number, [significance]',
    description: 'Rounds a number down to the nearest multiple of significance (default 1).',
    example: '=FLOOR(4.7, 0.5)',
    impl: (a) => {
      const n = a.number(0);
      const s = a.number(1, 1);
      if (s === 0) a.fail('#DIV/0!', 'FLOOR significance cannot be zero.', 1);
      return normalizeNumber(Math.floor(normalizeNumber(n / s)) * s);
    },
  },
  {
    name: 'FACT',
    category: 'Math',
    minArgs: 1,
    maxArgs: 1,
    args: 'number',
    description: 'Factorial of a non-negative integer.',
    example: '=FACT(5)',
    impl: (a) => {
      const n = Math.floor(a.number(0));
      if (n < 0) a.fail('#NUM!', 'FACT is only defined for non-negative numbers.', 0);
      if (n > 170) a.fail('#NUM!', 'FACT overflows for numbers above 170.', 0);
      let r = 1;
      for (let i = 2; i <= n; i++) r *= i;
      return r;
    },
  },
  {
    name: 'RAND',
    category: 'Math',
    minArgs: 0,
    maxArgs: 0,
    args: '',
    description: 'A random number between 0 (inclusive) and 1 (exclusive). Recalculated on every change.',
    example: '=RAND()',
    volatile: true,
    impl: () => Math.random(),
  },
  {
    name: 'RANDBETWEEN',
    category: 'Math',
    minArgs: 2,
    maxArgs: 2,
    args: 'bottom, top',
    description: 'A random integer between bottom and top (inclusive). Recalculated on every change.',
    example: '=RANDBETWEEN(1, 6)',
    volatile: true,
    impl: (a) => {
      const lo = Math.ceil(a.number(0));
      const hi = Math.floor(a.number(1));
      if (hi < lo) a.fail('#NUM!', 'RANDBETWEEN needs bottom to be less than or equal to top.', 1);
      return lo + Math.floor(Math.random() * (hi - lo + 1));
    },
  },
  {
    name: 'SUMPRODUCT',
    category: 'Math',
    minArgs: 1,
    maxArgs: Infinity,
    args: 'array1, [array2], ...',
    description: 'Multiplies corresponding entries of equally sized ranges and returns the sum of the products.',
    example: '=SUMPRODUCT(B2:B5, C2:C5)',
    impl: (a) => {
      const ranges = Array.from({ length: a.length }, (_, i) => a.range(i));
      const first = ranges[0];
      for (let i = 1; i < ranges.length; i++) {
        if (ranges[i].rows !== first.rows || ranges[i].cols !== first.cols) {
          a.fail('#VALUE!', `SUMPRODUCT ranges must be the same size; ${ranges[i].label} differs from ${first.label}.`, i);
        }
      }
      const rows = Math.min(first.rows, Math.max(...ranges.map((r) => r.effectiveRows())));
      const cols = Math.min(first.cols, Math.max(...ranges.map((r) => r.effectiveCols())));
      const total = new Accumulator();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let p = 1;
          for (let k = 0; k < ranges.length; k++) {
            const v = ranges[k].get(r, c);
            if (isError(v)) a.raise(v, k);
            p *= typeof v === 'number' ? v : 0;
          }
          total.add(p);
        }
      }
      return normalizeNumber(total.value);
    },
  },
  {
    name: 'SUMSQ',
    category: 'Math',
    minArgs: 1,
    maxArgs: Infinity,
    args: 'number1, [number2], ...',
    description: 'Sum of the squares of the arguments.',
    example: '=SUMSQ(3, 4)',
    impl: (a) => sum(a.numbers().map((x) => x * x)),
  },
  {
    name: 'SUMIF',
    category: 'Math',
    minArgs: 2,
    maxArgs: 3,
    args: 'range, criterion, [sum_range]',
    description: 'Sums the cells that meet a criterion, e.g. ">10", "apple", "<>0" or "a*".',
    example: '=SUMIF(A2:A10, ">5", B2:B10)',
    impl: (a) => {
      const range = a.range(0);
      const predicate = parseCriteria(a.plain(1));
      const sumRange = a.has(2) ? a.range(2) : range;
      const total = new Accumulator();
      forEachCriteriaPosition([range], [predicate], (r, c) => {
        const v = sumRange.get(r, c);
        if (isError(v)) a.raise(v, 2);
        if (typeof v === 'number') total.add(v);
      });
      return normalizeNumber(total.value);
    },
  },
  {
    name: 'SUMIFS',
    category: 'Math',
    minArgs: 3,
    maxArgs: Infinity,
    args: 'sum_range, criteria_range1, criterion1, [criteria_range2, criterion2], ...',
    description: 'Sums the cells in sum_range where every criteria range meets its criterion.',
    example: '=SUMIFS(C2:C10, A2:A10, "East", B2:B10, ">100")',
    impl: (a) => {
      const sumRange = a.range(0);
      const { ranges, predicates } = criteriaPairs(a, 1, sumRange);
      const total = new Accumulator();
      forEachCriteriaPosition(ranges, predicates, (r, c) => {
        const v = sumRange.get(r, c);
        if (isError(v)) a.raise(v, 0);
        if (typeof v === 'number') total.add(v);
      });
      return normalizeNumber(total.value);
    },
  },
  {
    name: 'SIN',
    category: 'Math',
    minArgs: 1,
    maxArgs: 1,
    args: 'angle',
    description: 'Sine of an angle given in radians.',
    example: '=SIN(PI()/2)',
    impl: (a) => normalizeNumber(Math.sin(a.number(0))),
  },
  {
    name: 'COS',
    category: 'Math',
    minArgs: 1,
    maxArgs: 1,
    args: 'angle',
    description: 'Cosine of an angle given in radians.',
    example: '=COS(0)',
    impl: (a) => normalizeNumber(Math.cos(a.number(0))),
  },
  {
    name: 'TAN',
    category: 'Math',
    minArgs: 1,
    maxArgs: 1,
    args: 'angle',
    description: 'Tangent of an angle given in radians.',
    example: '=TAN(PI()/4)',
    impl: (a) => normalizeNumber(Math.tan(a.number(0))),
  },
  {
    name: 'RADIANS',
    category: 'Math',
    minArgs: 1,
    maxArgs: 1,
    args: 'degrees',
    description: 'Converts degrees to radians.',
    example: '=RADIANS(180)',
    impl: (a) => (a.number(0) * Math.PI) / 180,
  },
  {
    name: 'DEGREES',
    category: 'Math',
    minArgs: 1,
    maxArgs: 1,
    args: 'radians',
    description: 'Converts radians to degrees.',
    example: '=DEGREES(PI())',
    impl: (a) => normalizeNumber((a.number(0) * 180) / Math.PI),
  },
];
