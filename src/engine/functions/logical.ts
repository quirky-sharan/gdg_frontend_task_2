import { compareScalars, describeValue, isError, toBoolean } from '../values';
import type { Args, FunctionSpec } from './args';

/** Collects the logical values of all arguments (ranges contribute booleans and numbers only). */
function logicals(a: Args): boolean[] {
  const out: boolean[] = [];
  a.forEachValue((v, fromRef, i) => {
    if (isError(v)) a.raise(v, i);
    if (v === null) return;
    if (fromRef && typeof v === 'string') return;
    const b = toBoolean(v);
    if (isError(b)) a.fail('#VALUE!', `${a.name} expects logical values, but argument ${i + 1} is ${describeValue(v)}.`, i);
    out.push(b);
  });
  if (out.length === 0) a.fail('#VALUE!', `${a.name} received no logical values.`);
  return out;
}

/** Value of an optional branch: omitted entirely -> `fallback`, left empty as in IF(x,,1) -> 0. */
function branch(a: Args, i: number, fallback: boolean) {
  if (a.has(i)) return a.value(i);
  return i < a.length ? 0 : fallback;
}

export const logicalFunctions: FunctionSpec[] = [
  {
    name: 'IF',
    category: 'Logical',
    minArgs: 2,
    maxArgs: 3,
    args: 'logical_test, value_if_true, [value_if_false]',
    description: 'Returns one value if a condition is TRUE and another if it is FALSE. Only the chosen branch is evaluated.',
    example: '=IF(A1>=50, "Pass", "Fail")',
    impl: (a) => (a.bool(0) ? branch(a, 1, true) : branch(a, 2, false)),
  },
  {
    name: 'IFS',
    category: 'Logical',
    minArgs: 2,
    maxArgs: Infinity,
    args: 'condition1, value1, [condition2, value2], ...',
    description: 'Returns the value for the first condition that is TRUE.',
    example: '=IFS(A1>=90, "A", A1>=80, "B", TRUE, "C")',
    impl: (a) => {
      if (a.length % 2 !== 0) a.fail('#N/A', 'IFS expects condition/value pairs.', a.length - 1);
      for (let i = 0; i < a.length; i += 2) {
        if (a.bool(i)) return a.value(i + 1);
      }
      return a.fail('#N/A', 'None of the IFS conditions is TRUE.', undefined, {
        suggestion: 'Add a final TRUE condition as a catch-all, e.g. IFS(..., TRUE, "Other").',
      });
    },
  },
  {
    name: 'AND',
    category: 'Logical',
    minArgs: 1,
    maxArgs: Infinity,
    args: 'logical1, [logical2], ...',
    description: 'TRUE if all arguments are TRUE.',
    example: '=AND(A1>0, B1>0)',
    impl: (a) => logicals(a).every(Boolean),
  },
  {
    name: 'OR',
    category: 'Logical',
    minArgs: 1,
    maxArgs: Infinity,
    args: 'logical1, [logical2], ...',
    description: 'TRUE if any argument is TRUE.',
    example: '=OR(A1="yes", B1="yes")',
    impl: (a) => logicals(a).some(Boolean),
  },
  {
    name: 'XOR',
    category: 'Logical',
    minArgs: 1,
    maxArgs: Infinity,
    args: 'logical1, [logical2], ...',
    description: 'TRUE if an odd number of arguments are TRUE.',
    example: '=XOR(TRUE, FALSE)',
    impl: (a) => logicals(a).filter(Boolean).length % 2 === 1,
  },
  {
    name: 'NOT',
    category: 'Logical',
    minArgs: 1,
    maxArgs: 1,
    args: 'logical',
    description: 'Reverses a logical value.',
    example: '=NOT(A1>10)',
    impl: (a) => !a.bool(0),
  },
  {
    name: 'TRUE',
    category: 'Logical',
    minArgs: 0,
    maxArgs: 0,
    args: '',
    description: 'The logical value TRUE.',
    example: '=TRUE()',
    impl: () => true,
  },
  {
    name: 'FALSE',
    category: 'Logical',
    minArgs: 0,
    maxArgs: 0,
    args: '',
    description: 'The logical value FALSE.',
    example: '=FALSE()',
    impl: () => false,
  },
  {
    name: 'IFERROR',
    category: 'Logical',
    minArgs: 2,
    maxArgs: 2,
    args: 'value, value_if_error',
    description: 'Returns value_if_error if the first argument is an error, otherwise the first argument.',
    example: '=IFERROR(A1/B1, 0)',
    impl: (a) => {
      const v = a.scalar(0);
      return isError(v) ? branch(a, 1, false) : v;
    },
  },
  {
    name: 'IFNA',
    category: 'Logical',
    minArgs: 2,
    maxArgs: 2,
    args: 'value, value_if_na',
    description: 'Returns value_if_na if the first argument is #N/A, otherwise the first argument.',
    example: '=IFNA(VLOOKUP(D1, A:B, 2, FALSE), "Not found")',
    impl: (a) => {
      const v = a.scalar(0);
      return isError(v) && v.code === '#N/A' ? branch(a, 1, false) : v;
    },
  },
  {
    name: 'SWITCH',
    category: 'Logical',
    minArgs: 3,
    maxArgs: Infinity,
    args: 'expression, case1, value1, [case2, value2], ..., [default]',
    description: 'Compares an expression against a list of cases and returns the value of the first match.',
    example: '=SWITCH(A1, 1, "One", 2, "Two", "Many")',
    impl: (a) => {
      const subject = a.plain(0);
      let i = 1;
      for (; i + 1 < a.length; i += 2) {
        if (compareScalars(subject, a.plain(i)) === 0) return a.value(i + 1);
      }
      if (i < a.length) return a.value(i);
      return a.fail('#N/A', `SWITCH found no case matching ${describeValue(subject)}.`, 0, {
        suggestion: 'Add a default value as the last argument.',
      });
    },
  },
];
