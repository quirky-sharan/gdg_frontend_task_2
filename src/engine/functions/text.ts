import { formatNumberPattern } from '../format';
import { isError, parseNumericText, toNumber, toText } from '../values';
import type { Args, FunctionSpec } from './args';
import { wildcardToRegExp } from './helpers';

/** All argument values from `from` onward as text, ranges flattened in row-major order. */
function texts(a: Args, from = 0, skipEmpty = false): string[] {
  const out: string[] = [];
  a.forEachValue((v, _fromRef, i) => {
    if (isError(v)) a.raise(v, i);
    const t = toText(v) as string;
    if (skipEmpty && t === '') return;
    out.push(t);
  }, from);
  return out;
}

function positiveInt(a: Args, i: number, defaultValue: number, what: string): number {
  const n = Math.trunc(a.number(i, defaultValue));
  if (n < 0) a.fail('#VALUE!', `${a.name}: ${what} cannot be negative.`, i);
  return n;
}

export const textFunctions: FunctionSpec[] = [
  {
    name: 'CONCAT',
    category: 'Text',
    minArgs: 1,
    maxArgs: Infinity,
    args: 'text1, [text2], ...',
    description: 'Joins text values; ranges are joined in row-major order.',
    example: '=CONCAT(A1, " ", B1)',
    impl: (a) => texts(a).join(''),
  },
  {
    name: 'CONCATENATE',
    category: 'Text',
    minArgs: 1,
    maxArgs: Infinity,
    args: 'text1, [text2], ...',
    description: 'Joins several text values into one.',
    example: '=CONCATENATE("Q", 1, "-", 2024)',
    impl: (a) => texts(a).join(''),
  },
  {
    name: 'TEXTJOIN',
    category: 'Text',
    minArgs: 3,
    maxArgs: Infinity,
    args: 'delimiter, ignore_empty, text1, [text2], ...',
    description: 'Joins text values with a delimiter, optionally skipping empty values.',
    example: '=TEXTJOIN(", ", TRUE, A1:A5)',
    impl: (a) => texts(a, 2, a.bool(1)).join(a.text(0)),
  },
  {
    name: 'LEN',
    category: 'Text',
    minArgs: 1,
    maxArgs: 1,
    args: 'text',
    description: 'Number of characters in a text value.',
    example: '=LEN(A1)',
    impl: (a) => a.text(0).length,
  },
  {
    name: 'UPPER',
    category: 'Text',
    minArgs: 1,
    maxArgs: 1,
    args: 'text',
    description: 'Converts text to upper case.',
    example: '=UPPER("hello")',
    impl: (a) => a.text(0).toUpperCase(),
  },
  {
    name: 'LOWER',
    category: 'Text',
    minArgs: 1,
    maxArgs: 1,
    args: 'text',
    description: 'Converts text to lower case.',
    example: '=LOWER("HELLO")',
    impl: (a) => a.text(0).toLowerCase(),
  },
  {
    name: 'PROPER',
    category: 'Text',
    minArgs: 1,
    maxArgs: 1,
    args: 'text',
    description: 'Capitalizes the first letter of each word.',
    example: '=PROPER("ada lovelace")',
    impl: (a) => a.text(0).toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase()),
  },
  {
    name: 'TRIM',
    category: 'Text',
    minArgs: 1,
    maxArgs: 1,
    args: 'text',
    description: 'Removes leading/trailing spaces and collapses repeated spaces between words.',
    example: '=TRIM("  too   many  spaces ")',
    impl: (a) => a.text(0).trim().replace(/ {2,}/g, ' '),
  },
  {
    name: 'LEFT',
    category: 'Text',
    minArgs: 1,
    maxArgs: 2,
    args: 'text, [num_chars]',
    description: 'The first characters of a text value (default 1).',
    example: '=LEFT("Spreadsheet", 6)',
    impl: (a) => a.text(0).slice(0, positiveInt(a, 1, 1, 'num_chars')),
  },
  {
    name: 'RIGHT',
    category: 'Text',
    minArgs: 1,
    maxArgs: 2,
    args: 'text, [num_chars]',
    description: 'The last characters of a text value (default 1).',
    example: '=RIGHT("Spreadsheet", 5)',
    impl: (a) => {
      const t = a.text(0);
      const n = positiveInt(a, 1, 1, 'num_chars');
      return n === 0 ? '' : t.slice(-n);
    },
  },
  {
    name: 'MID',
    category: 'Text',
    minArgs: 3,
    maxArgs: 3,
    args: 'text, start_num, num_chars',
    description: 'Characters from the middle of a text value, starting at start_num (1-based).',
    example: '=MID("Spreadsheet", 7, 5)',
    impl: (a) => {
      const t = a.text(0);
      const start = Math.trunc(a.number(1));
      if (start < 1) a.fail('#VALUE!', 'MID: start_num must be at least 1.', 1);
      return t.substr(start - 1, positiveInt(a, 2, 0, 'num_chars'));
    },
  },
  {
    name: 'FIND',
    category: 'Text',
    minArgs: 2,
    maxArgs: 3,
    args: 'find_text, within_text, [start_num]',
    description: 'Position (1-based) of find_text in within_text. Case-sensitive.',
    example: '=FIND("s", "Sheets")',
    impl: (a) => {
      const needle = a.text(0);
      const hay = a.text(1);
      const start = Math.trunc(a.number(2, 1));
      if (start < 1 || start > hay.length + 1) a.fail('#VALUE!', 'FIND: start_num is out of range.', 2);
      const idx = hay.indexOf(needle, start - 1);
      if (idx < 0) a.fail('#VALUE!', `FIND could not find "${needle}" in "${hay}".`, 0, { suggestion: 'FIND is case-sensitive; use SEARCH for a case-insensitive match.' });
      return idx + 1;
    },
  },
  {
    name: 'SEARCH',
    category: 'Text',
    minArgs: 2,
    maxArgs: 3,
    args: 'find_text, within_text, [start_num]',
    description: 'Position (1-based) of find_text in within_text. Case-insensitive, supports * and ? wildcards.',
    example: '=SEARCH("sheet", "Spreadsheet")',
    impl: (a) => {
      const needle = a.text(0);
      const hay = a.text(1);
      const start = Math.trunc(a.number(2, 1));
      if (start < 1 || start > hay.length + 1) a.fail('#VALUE!', 'SEARCH: start_num is out of range.', 2);
      const re = wildcardToRegExp(needle);
      const pattern = new RegExp(re.source.slice(1, -1), 'is');
      const m = pattern.exec(hay.slice(start - 1));
      if (!m) return a.fail('#VALUE!', `SEARCH could not find "${needle}" in "${hay}".`, 0);
      return m.index + start;
    },
  },
  {
    name: 'SUBSTITUTE',
    category: 'Text',
    minArgs: 3,
    maxArgs: 4,
    args: 'text, old_text, new_text, [instance_num]',
    description: 'Replaces occurrences of old_text with new_text (all of them, or only the given instance).',
    example: '=SUBSTITUTE("a-b-c", "-", "+")',
    impl: (a) => {
      const t = a.text(0);
      const from = a.text(1);
      const to = a.text(2);
      if (from === '') return t;
      if (!a.has(3)) return t.split(from).join(to);
      const nth = Math.trunc(a.number(3));
      if (nth < 1) a.fail('#VALUE!', 'SUBSTITUTE: instance_num must be at least 1.', 3);
      let idx = -1;
      for (let k = 0; k < nth; k++) {
        idx = t.indexOf(from, idx + 1);
        if (idx < 0) return t;
      }
      return t.slice(0, idx) + to + t.slice(idx + from.length);
    },
  },
  {
    name: 'REPLACE',
    category: 'Text',
    minArgs: 4,
    maxArgs: 4,
    args: 'old_text, start_num, num_chars, new_text',
    description: 'Replaces num_chars characters starting at start_num with new_text.',
    example: '=REPLACE("2023-report", 1, 4, "2024")',
    impl: (a) => {
      const t = a.text(0);
      const start = Math.trunc(a.number(1));
      if (start < 1) a.fail('#VALUE!', 'REPLACE: start_num must be at least 1.', 1);
      const n = positiveInt(a, 2, 0, 'num_chars');
      return t.slice(0, start - 1) + a.text(3) + t.slice(start - 1 + n);
    },
  },
  {
    name: 'REPT',
    category: 'Text',
    minArgs: 2,
    maxArgs: 2,
    args: 'text, number_times',
    description: 'Repeats text a number of times.',
    example: '=REPT("★", 3)',
    impl: (a) => {
      const n = positiveInt(a, 1, 0, 'number_times');
      const t = a.text(0);
      if (t.length * n > 32767) a.fail('#VALUE!', 'REPT result would exceed 32,767 characters.', 1);
      return t.repeat(n);
    },
  },
  {
    name: 'TEXT',
    category: 'Text',
    minArgs: 2,
    maxArgs: 2,
    args: 'value, format_text',
    description: 'Formats a number as text using a pattern such as "0.00", "#,##0", "0%", "$#,##0.00" or "yyyy-mm-dd".',
    example: '=TEXT(1234.5, "$#,##0.00")',
    impl: (a) => {
      const v = a.plain(0);
      const pattern = a.text(1);
      const n = toNumber(v);
      if (isError(n)) return toText(v) as string;
      return formatNumberPattern(n, pattern);
    },
  },
  {
    name: 'VALUE',
    category: 'Text',
    minArgs: 1,
    maxArgs: 1,
    args: 'text',
    description: 'Converts text that looks like a number into a number.',
    example: '=VALUE("42.5")',
    impl: (a) => {
      const v = a.plain(0);
      if (typeof v === 'number') return v;
      const n = parseNumericText(String(v ?? ''));
      if (n === null) a.fail('#VALUE!', `VALUE cannot convert "${v ?? ''}" to a number.`, 0);
      return n;
    },
  },
  {
    name: 'EXACT',
    category: 'Text',
    minArgs: 2,
    maxArgs: 2,
    args: 'text1, text2',
    description: 'TRUE if two text values are exactly the same (case-sensitive).',
    example: '=EXACT("Word", "word")',
    impl: (a) => a.text(0) === a.text(1),
  },
  {
    name: 'CHAR',
    category: 'Text',
    minArgs: 1,
    maxArgs: 1,
    args: 'number',
    description: 'The character with the given character code.',
    example: '=CHAR(65)',
    impl: (a) => {
      const n = Math.trunc(a.number(0));
      if (n < 1 || n > 65535) a.fail('#VALUE!', 'CHAR expects a code between 1 and 65535.', 0);
      return String.fromCharCode(n);
    },
  },
  {
    name: 'CODE',
    category: 'Text',
    minArgs: 1,
    maxArgs: 1,
    args: 'text',
    description: 'Character code of the first character of a text value.',
    example: '=CODE("A")',
    impl: (a) => {
      const t = a.text(0);
      if (t === '') a.fail('#VALUE!', 'CODE needs a non-empty text value.', 0);
      return t.charCodeAt(0);
    },
  },
];
