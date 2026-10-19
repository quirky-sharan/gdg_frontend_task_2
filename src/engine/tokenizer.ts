/**
 * Formula tokenizer.
 *
 * The tokenizer never throws: malformed input produces `invalid` tokens (or
 * flagged tokens such as unterminated strings) so the parser can report a
 * precise diagnostic, and so editor features (autocomplete, reference
 * highlighting, formula shifting) can work on incomplete formulas.
 *
 * All offsets are positions in the *full* input string (including the leading
 * "="), which lets diagnostics place a caret directly under the problem.
 */
import { lettersToCol, MAX_COLS, MAX_ROWS } from './address';
import { ERROR_CODES, type ErrorCode } from './values';

export type Operator = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=' | '%';

interface TokenBase {
  start: number;
  end: number;
  text: string;
}

export type Token = TokenBase &
  (
    | { type: 'number'; value: number }
    | { type: 'string'; value: string; unterminated: boolean }
    | { type: 'bool'; value: boolean }
    | { type: 'error'; code: ErrorCode }
    | { type: 'cell'; row: number; col: number; absRow: boolean; absCol: boolean; outOfRange: boolean }
    | { type: 'colrange'; left: number; right: number; absLeft: boolean; absRight: boolean; outOfRange: boolean }
    | { type: 'rowrange'; top: number; bottom: number; absTop: boolean; absBottom: boolean; outOfRange: boolean }
    | { type: 'func'; name: string }
    | { type: 'ident'; name: string }
    | { type: 'op'; op: Operator }
    | { type: 'lparen' }
    | { type: 'rparen' }
    | { type: 'comma' }
    | { type: 'colon' }
    | { type: 'invalid' }
    | { type: 'eof' }
  );

export type TokenType = Token['type'];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const NUMBER_RE = /(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/iy;
const WORD_RE = /[A-Za-z_$][A-Za-z0-9_.$]*/y;
const CELL_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/;
const COL_RANGE_RE = /(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![A-Za-z0-9_.(])/y;
const ROW_RANGE_RE = /(\$?)(\d+):(\$?)(\d+)(?![\d.A-Za-z_])/y;
const FUNC_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;

function matchAt(re: RegExp, input: string, pos: number): RegExpExecArray | null {
  re.lastIndex = pos;
  return re.exec(input);
}

export function tokenize(input: string, offset = 0): Token[] {
  const tokens: Token[] = [];
  let i = offset;
  const n = input.length;

  const push = (t: DistributiveOmit<Token, 'text'>) => {
    tokens.push({ ...t, text: input.slice(t.start, t.end) } as Token);
  };

  while (i < n) {
    const ch = input[i];

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // Whole-row range: 1:5, $2:$2
    if (ch === '$' || (ch >= '0' && ch <= '9')) {
      const m = matchAt(ROW_RANGE_RE, input, i);
      if (m) {
        const top = Number(m[2]) - 1;
        const bottom = Number(m[4]) - 1;
        const outOfRange = top < 0 || bottom < 0 || top >= MAX_ROWS || bottom >= MAX_ROWS;
        push({
          type: 'rowrange',
          top: Math.min(top, bottom),
          bottom: Math.max(top, bottom),
          absTop: m[1] === '$',
          absBottom: m[3] === '$',
          outOfRange,
          start: i,
          end: i + m[0].length,
        });
        i += m[0].length;
        continue;
      }
    }

    if ((ch >= '0' && ch <= '9') || (ch === '.' && /\d/.test(input[i + 1] ?? ''))) {
      const m = matchAt(NUMBER_RE, input, i)!;
      push({ type: 'number', value: Number(m[0]), start: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      // Whole-column range: A:C, $B:$B
      const cr = matchAt(COL_RANGE_RE, input, i);
      if (cr) {
        const left = lettersToCol(cr[2]);
        const right = lettersToCol(cr[4]);
        push({
          type: 'colrange',
          left: Math.min(left, right),
          right: Math.max(left, right),
          absLeft: cr[1] === '$',
          absRight: cr[3] === '$',
          outOfRange: left >= MAX_COLS || right >= MAX_COLS,
          start: i,
          end: i + cr[0].length,
        });
        i += cr[0].length;
        continue;
      }

      const m = matchAt(WORD_RE, input, i)!;
      const word = m[0];
      const start = i;
      const end = i + word.length;
      i = end;

      if (input[end] === '(' && FUNC_NAME_RE.test(word)) {
        push({ type: 'func', name: word.toUpperCase(), start, end });
        continue;
      }
      const cell = CELL_RE.exec(word);
      if (cell) {
        const col = lettersToCol(cell[2]);
        const row = Number(cell[4]) - 1;
        push({
          type: 'cell',
          row,
          col,
          absCol: cell[1] === '$',
          absRow: cell[3] === '$',
          outOfRange: row < 0 || row >= MAX_ROWS || col >= MAX_COLS,
          start,
          end,
        });
        continue;
      }
      const upper = word.toUpperCase();
      if (upper === 'TRUE' || upper === 'FALSE') {
        push({ type: 'bool', value: upper === 'TRUE', start, end });
        continue;
      }
      push({ type: 'ident', name: word, start, end });
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      let value = '';
      let terminated = false;
      while (j < n) {
        if (input[j] === '"') {
          if (input[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          terminated = true;
          j++;
          break;
        }
        value += input[j];
        j++;
      }
      push({ type: 'string', value, unterminated: !terminated, start: i, end: j });
      i = j;
      continue;
    }

    if (ch === '#') {
      const rest = input.slice(i).toUpperCase();
      const code = ERROR_CODES.find((c) => rest.startsWith(c));
      if (code) {
        push({ type: 'error', code, start: i, end: i + code.length });
        i += code.length;
        continue;
      }
      push({ type: 'invalid', start: i, end: i + 1 });
      i++;
      continue;
    }

    const two = input.slice(i, i + 2);
    if (two === '<>' || two === '<=' || two === '>=') {
      push({ type: 'op', op: two as Operator, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (two === '!=' || two === '==') {
      // Common programming-language habits: reported by the parser with a fix.
      push({ type: 'invalid', start: i, end: i + 2 });
      i += 2;
      continue;
    }

    switch (ch) {
      case '+':
      case '-':
      case '*':
      case '/':
      case '^':
      case '&':
      case '=':
      case '<':
      case '>':
      case '%':
        push({ type: 'op', op: ch as Operator, start: i, end: i + 1 });
        break;
      case '(':
        push({ type: 'lparen', start: i, end: i + 1 });
        break;
      case ')':
        push({ type: 'rparen', start: i, end: i + 1 });
        break;
      case ',':
        push({ type: 'comma', start: i, end: i + 1 });
        break;
      case ':':
        push({ type: 'colon', start: i, end: i + 1 });
        break;
      default:
        push({ type: 'invalid', start: i, end: i + 1 });
    }
    i++;
  }

  tokens.push({ type: 'eof', start: n, end: n, text: '' });
  return tokens;
}
