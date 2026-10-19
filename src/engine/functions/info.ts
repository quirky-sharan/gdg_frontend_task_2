import { RangeValue } from '../range';
import { isError } from '../values';
import type { FunctionSpec } from './args';

export const infoFunctions: FunctionSpec[] = [
  {
    name: 'ISBLANK',
    category: 'Information',
    minArgs: 1,
    maxArgs: 1,
    args: 'value',
    description: 'TRUE if the referenced cell is empty.',
    example: '=ISBLANK(A1)',
    impl: (a) => a.scalar(0) === null,
  },
  {
    name: 'ISNUMBER',
    category: 'Information',
    minArgs: 1,
    maxArgs: 1,
    args: 'value',
    description: 'TRUE if the value is a number.',
    example: '=ISNUMBER(A1)',
    impl: (a) => typeof a.scalar(0) === 'number',
  },
  {
    name: 'ISTEXT',
    category: 'Information',
    minArgs: 1,
    maxArgs: 1,
    args: 'value',
    description: 'TRUE if the value is text.',
    example: '=ISTEXT(A1)',
    impl: (a) => typeof a.scalar(0) === 'string',
  },
  {
    name: 'ISLOGICAL',
    category: 'Information',
    minArgs: 1,
    maxArgs: 1,
    args: 'value',
    description: 'TRUE if the value is TRUE or FALSE.',
    example: '=ISLOGICAL(A1)',
    impl: (a) => typeof a.scalar(0) === 'boolean',
  },
  {
    name: 'ISERROR',
    category: 'Information',
    minArgs: 1,
    maxArgs: 1,
    args: 'value',
    description: 'TRUE if the value is any error (#N/A, #DIV/0!, #VALUE!, ...).',
    example: '=ISERROR(A1/B1)',
    impl: (a) => isError(a.scalar(0)),
  },
  {
    name: 'ISERR',
    category: 'Information',
    minArgs: 1,
    maxArgs: 1,
    args: 'value',
    description: 'TRUE if the value is an error other than #N/A.',
    example: '=ISERR(A1)',
    impl: (a) => {
      const v = a.scalar(0);
      return isError(v) && v.code !== '#N/A';
    },
  },
  {
    name: 'ISNA',
    category: 'Information',
    minArgs: 1,
    maxArgs: 1,
    args: 'value',
    description: 'TRUE if the value is the #N/A error.',
    example: '=ISNA(MATCH("x", A:A, 0))',
    impl: (a) => {
      const v = a.scalar(0);
      return isError(v) && v.code === '#N/A';
    },
  },
  {
    name: 'ISEVEN',
    category: 'Information',
    minArgs: 1,
    maxArgs: 1,
    args: 'number',
    description: 'TRUE if the integer part of the number is even.',
    example: '=ISEVEN(4)',
    impl: (a) => Math.trunc(a.number(0)) % 2 === 0,
  },
  {
    name: 'ISODD',
    category: 'Information',
    minArgs: 1,
    maxArgs: 1,
    args: 'number',
    description: 'TRUE if the integer part of the number is odd.',
    example: '=ISODD(3)',
    impl: (a) => Math.abs(Math.trunc(a.number(0)) % 2) === 1,
  },
  {
    name: 'TYPE',
    category: 'Information',
    minArgs: 1,
    maxArgs: 1,
    args: 'value',
    description: 'Type code of a value: 1 number (or empty), 2 text, 4 logical, 16 error, 64 range.',
    example: '=TYPE("abc")',
    impl: (a) => {
      const v = a.value(0);
      if (v instanceof RangeValue) return v.area === 1 ? typeCode(v.get(0, 0)) : 64;
      return typeCode(v);
    },
  },
  {
    name: 'NA',
    category: 'Information',
    minArgs: 0,
    maxArgs: 0,
    args: '',
    description: 'Returns the #N/A error, used to mark missing data.',
    example: '=NA()',
    impl: (a) => a.fail('#N/A', 'Value marked as not available with NA().'),
  },
];

function typeCode(v: unknown): number {
  if (typeof v === 'string') return 2;
  if (typeof v === 'boolean') return 4;
  if (isError(v)) return 16;
  return 1;
}
