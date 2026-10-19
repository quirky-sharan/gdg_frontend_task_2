import type { FunctionCategory, FunctionSpec } from './args';
import { dateFunctions } from './date';
import { infoFunctions } from './info';
import { logicalFunctions } from './logical';
import { lookupFunctions } from './lookup';
import { mathFunctions } from './math';
import { statisticalFunctions } from './statistical';
import { textFunctions } from './text';

export type { FunctionCategory, FunctionSpec } from './args';

export const FUNCTION_LIST: readonly FunctionSpec[] = [
  ...mathFunctions,
  ...statisticalFunctions,
  ...logicalFunctions,
  ...textFunctions,
  ...lookupFunctions,
  ...infoFunctions,
  ...dateFunctions,
];

/** Function registry keyed by upper-case name. */
export const FUNCTIONS: ReadonlyMap<string, FunctionSpec> = new Map(FUNCTION_LIST.map((f) => [f.name, f]));

export const CATEGORY_ORDER: readonly FunctionCategory[] = ['Math', 'Statistical', 'Logical', 'Text', 'Lookup', 'Information', 'Date'];

export function signature(spec: FunctionSpec): string {
  return `${spec.name}(${spec.args})`;
}

/** Common names from other tools / languages mapped to the spreadsheet equivalent. */
const ALIASES: Record<string, string> = {
  AVG: 'AVERAGE',
  MEAN: 'AVERAGE',
  LENGTH: 'LEN',
  STRLEN: 'LEN',
  UPPERCASE: 'UPPER',
  LOWERCASE: 'LOWER',
  SUBSTR: 'MID',
  SUBSTRING: 'MID',
  CEIL: 'CEILING',
  POW: 'POWER',
  STDDEV: 'STDEV',
  IFELSE: 'IF',
  JOIN: 'TEXTJOIN',
  LOOKUP: 'VLOOKUP',
  TOTAL: 'SUM',
  CONCATINATE: 'CONCATENATE',
};

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Closest known function name for a misspelled one, or undefined if nothing is close. */
export function suggestFunction(name: string): string | undefined {
  const upper = name.toUpperCase();
  if (ALIASES[upper]) return ALIASES[upper];
  let best: string | undefined;
  let bestDist = Infinity;
  for (const f of FUNCTION_LIST) {
    const d = levenshtein(upper, f.name);
    if (d < bestDist) {
      bestDist = d;
      best = f.name;
    }
  }
  const limit = upper.length <= 4 ? 1 : upper.length <= 7 ? 2 : 3;
  return bestDist <= limit ? best : undefined;
}
