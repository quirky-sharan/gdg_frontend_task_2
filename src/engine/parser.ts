/**
 * Recursive-descent / Pratt parser that turns a formula string into an AST.
 *
 * Operator precedence (lowest to highest), matching Excel:
 *   comparison  =  <>  <  >  <=  >=     (left associative)
 *   concatenation &
 *   additive      +  -
 *   multiplicative *  /
 *   exponent      ^                      (left associative, like Excel: 2^3^2 = 64)
 *   percent       postfix %
 *   unary         prefix - +             (binds tighter than ^, like Excel: -2^2 = 4)
 *   primary       literals, references, ranges, function calls, ( ... )
 *
 * On the first syntax error the parser stops and returns a `SheetError` that
 * points at the offending position and, where it can, carries a suggestion and
 * an automatically corrected formula.
 */
import { colToLetters, MAX_COLS, MAX_ROWS } from './address';
import type { BinaryOp, Node } from './ast';
import { tokenize, type Token } from './tokenizer';
import { SheetError, type ErrorCode, type ErrorDetails } from './values';

export type ParseResult =
  | { ok: true; ast: Node; tokens: Token[] }
  | { ok: false; error: SheetError; tokens: Token[] };

class ParseFailure {
  constructor(public readonly error: SheetError) {}
}

/** [left binding power, right binding power]; right > left makes an operator left-associative. */
const INFIX_BP: Record<BinaryOp, [number, number]> = {
  '=': [1, 2],
  '<>': [1, 2],
  '<': [1, 2],
  '>': [1, 2],
  '<=': [1, 2],
  '>=': [1, 2],
  '&': [3, 4],
  '+': [5, 6],
  '-': [5, 6],
  '*': [7, 8],
  '/': [7, 8],
  '^': [9, 10],
};
const PERCENT_BP = 11;
const PREFIX_BP = 12;
const MAX_DEPTH = 100;

const OPERAND_START = new Set<Token['type']>([
  'number',
  'string',
  'bool',
  'error',
  'cell',
  'colrange',
  'rowrange',
  'func',
  'ident',
  'lparen',
]);

export function parseFormula(input: string): ParseResult {
  const tokens = tokenize(input, 1);
  try {
    const ast = new Parser(input, tokens).parse();
    return { ok: true, ast, tokens };
  } catch (e) {
    if (e instanceof ParseFailure) return { ok: false, error: e.error, tokens };
    throw e;
  }
}

function outOfRangeMessage(text: string, row: number | null, col: number | null): string {
  if (row !== null && row < 0) return `Invalid reference ${text}: row numbers start at 1.`;
  if (col !== null && col >= MAX_COLS) {
    return `Invalid reference ${text}: column ${colToLetters(col)} is beyond the last column (${colToLetters(MAX_COLS - 1)}).`;
  }
  return `Invalid reference ${text}: row ${row! + 1} is beyond the last row (${MAX_ROWS}).`;
}

class Parser {
  private pos = 0;
  private depth = 0;

  constructor(
    private readonly input: string,
    private readonly tokens: Token[],
  ) {}

  parse(): Node {
    if (this.peek().type === 'eof') {
      this.fail('The formula is empty.', this.input.length, this.input.length, {
        suggestion: "Type an expression after '=', for example =SUM(A1:A3).",
      });
    }
    const node = this.parseExpression(0);
    const t = this.peek();
    if (t.type !== 'eof') this.unexpectedAfterExpression(t, 'top');
    return node;
  }

  // ---------------------------------------------------------------- helpers

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const t = this.tokens[this.pos];
    if (t.type !== 'eof') this.pos++;
    return t;
  }

  private prev(): Token | undefined {
    return this.pos > 0 ? this.tokens[this.pos - 1] : undefined;
  }

  private fail(message: string, start: number, end: number, details: ErrorDetails = {}, code: ErrorCode = '#ERROR!'): never {
    throw new ParseFailure(new SheetError(code, message, { start, end, ...details }));
  }

  /** The formula with the text between `start` and `end` replaced. */
  private edit(start: number, end: number, replacement: string): string {
    return this.input.slice(0, start) + replacement + this.input.slice(end);
  }

  private unclosedParens(): number {
    let depth = 0;
    for (const t of this.tokens) {
      if (t.type === 'lparen') depth++;
      else if (t.type === 'rparen') depth = Math.max(0, depth - 1);
    }
    return Math.max(1, depth);
  }

  // ---------------------------------------------------------------- grammar

  private parseExpression(minBp: number): Node {
    if (++this.depth > MAX_DEPTH) {
      const t = this.peek();
      this.fail('The formula is nested too deeply.', t.start, t.end, {
        suggestion: 'Split the calculation across several cells.',
      });
    }
    let left = this.parsePrefix();
    for (;;) {
      const t = this.peek();
      if (t.type !== 'op') break;
      if (t.op === '%') {
        if (PERCENT_BP < minBp) break;
        this.next();
        left = { type: 'percent', operand: left, start: left.start, end: t.end };
        continue;
      }
      const [lbp, rbp] = INFIX_BP[t.op];
      if (lbp < minBp) break;
      this.next();
      const right = this.parseExpression(rbp);
      left = { type: 'binary', op: t.op, left, right, opStart: t.start, start: left.start, end: right.end };
    }
    this.depth--;
    return left;
  }

  private parsePrefix(): Node {
    const t = this.peek();
    if (t.type === 'op' && (t.op === '-' || t.op === '+')) {
      this.next();
      const operand = this.parseExpression(PREFIX_BP);
      return { type: 'unary', op: t.op, operand, start: t.start, end: operand.end };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const t = this.peek();
    switch (t.type) {
      case 'number':
        this.next();
        return { type: 'number', value: t.value, start: t.start, end: t.end };
      case 'string':
        this.next();
        if (t.unterminated) {
          this.fail('Missing closing quote.', t.start, t.start + 1, {
            suggestion: 'Add a closing " after the text.',
            fix: this.input + '"',
          });
        }
        return { type: 'string', value: t.value, start: t.start, end: t.end };
      case 'bool':
        this.next();
        return { type: 'boolean', value: t.value, start: t.start, end: t.end };
      case 'error':
        this.next();
        return { type: 'error', code: t.code, start: t.start, end: t.end };
      case 'cell': {
        this.next();
        if (t.outOfRange) this.fail(outOfRangeMessage(t.text, t.row, t.col), t.start, t.end, {}, '#REF!');
        if (this.peek().type !== 'colon') {
          return { type: 'cell', row: t.row, col: t.col, absRow: t.absRow, absCol: t.absCol, start: t.start, end: t.end };
        }
        this.next(); // ':'
        const t2 = this.peek();
        if (t2.type !== 'cell') {
          this.fail("Expected a cell reference after ':'.", t2.start, Math.max(t2.end, t2.start + 1), {
            suggestion: `Complete the range, for example ${t.text}:${colToLetters(t.col)}${t.row + 10}.`,
          });
        }
        this.next();
        if (t2.outOfRange) this.fail(outOfRangeMessage(t2.text, t2.row, t2.col), t2.start, t2.end, {}, '#REF!');
        return {
          type: 'range',
          top: Math.min(t.row, t2.row),
          bottom: Math.max(t.row, t2.row),
          left: Math.min(t.col, t2.col),
          right: Math.max(t.col, t2.col),
          start: t.start,
          end: t2.end,
        };
      }
      case 'colrange':
        this.next();
        if (t.outOfRange) this.fail(outOfRangeMessage(t.text, null, Math.max(t.left, t.right)), t.start, t.end, {}, '#REF!');
        return { type: 'range', top: 0, bottom: MAX_ROWS - 1, left: t.left, right: t.right, start: t.start, end: t.end };
      case 'rowrange':
        this.next();
        if (t.outOfRange) {
          this.fail(outOfRangeMessage(t.text, t.top < 0 ? -1 : Math.max(t.top, t.bottom), null), t.start, t.end, {}, '#REF!');
        }
        return { type: 'range', top: t.top, bottom: t.bottom, left: 0, right: MAX_COLS - 1, start: t.start, end: t.end };
      case 'func':
        return this.parseCall();
      case 'ident':
        this.next();
        return { type: 'name', name: t.name, start: t.start, end: t.end };
      case 'lparen': {
        this.next();
        if (this.peek().type === 'rparen') {
          const r = this.peek();
          this.fail('Empty parentheses.', t.start, r.end, {
            suggestion: 'Put an expression inside the parentheses, or remove them.',
          });
        }
        const inner = this.parseExpression(0);
        const close = this.peek();
        if (close.type === 'rparen') {
          this.next();
          return { ...inner, start: t.start, end: close.end };
        }
        if (close.type === 'eof') this.failMissingParen();
        return this.unexpectedAfterExpression(close, 'paren');
      }
      default:
        return this.expectedOperand(t);
    }
  }

  private parseCall(): Node {
    const nameTok = this.next();
    if (nameTok.type !== 'func') throw new Error('parseCall called on a non-function token');
    this.next(); // '(' — guaranteed by the tokenizer
    const args: Node[] = [];
    if (this.peek().type === 'rparen') {
      const r = this.next();
      return { type: 'call', name: nameTok.name, args, start: nameTok.start, end: r.end, nameEnd: nameTok.end };
    }
    for (;;) {
      const a = this.peek();
      if (a.type === 'comma' || a.type === 'rparen') {
        args.push({ type: 'missing', start: a.start, end: a.start });
      } else if (a.type === 'eof') {
        const prev = this.prev();
        if (prev?.type === 'comma') {
          this.fail("Expected another argument after ','.", a.start, a.start, {
            suggestion: "Add another argument, or remove the trailing ',' and close the parenthesis.",
            fix: this.input.slice(0, prev.start).trimEnd() + ')'.repeat(this.unclosedParens()),
          });
        }
        this.failMissingParen();
      } else {
        args.push(this.parseExpression(0));
      }
      const sep = this.peek();
      if (sep.type === 'comma') {
        this.next();
        continue;
      }
      if (sep.type === 'rparen') {
        this.next();
        return { type: 'call', name: nameTok.name, args, start: nameTok.start, end: sep.end, nameEnd: nameTok.end };
      }
      if (sep.type === 'eof') this.failMissingParen();
      this.unexpectedAfterExpression(sep, 'args');
    }
  }

  // ---------------------------------------------------------------- diagnostics

  private failMissingParen(): never {
    const count = this.unclosedParens();
    const parens = ')'.repeat(count);
    const at = this.input.length;
    this.fail('Missing closing parenthesis.', at, at, {
      suggestion: `Add '${parens}' at the end of the formula.`,
      fix: this.input.trimEnd() + parens,
    });
  }

  /** An operand (number, reference, function, ...) was required but `t` was found. */
  private expectedOperand(t: Token): never {
    const prev = this.prev();
    const afterOp = prev && prev.type === 'op' ? prev : undefined;
    const removeOp = afterOp ? this.edit(afterOp.start, afterOp.end, '').replace(/\s+$/, '') : undefined;

    switch (t.type) {
      case 'eof':
        if (afterOp) {
          this.fail(`Expected a value after '${afterOp.text}'.`, t.start, t.start, {
            suggestion: `Add a number, cell reference or function after '${afterOp.text}', or remove the '${afterOp.text}'.`,
            fix: removeOp,
          });
        }
        if (prev?.type === 'lparen') this.failMissingParen();
        this.fail('Unexpected end of formula.', t.start, t.start);
        break;
      case 'rparen':
        if (afterOp) {
          this.fail(`Expected a value after '${afterOp.text}' but found ')'.`, t.start, t.end, {
            suggestion: `Add a value after '${afterOp.text}', or remove the '${afterOp.text}'.`,
            fix: this.edit(afterOp.start, afterOp.end, ''),
          });
        }
        this.fail("Unexpected ')'.", t.start, t.end, {
          suggestion: "Remove the extra ')'.",
          fix: this.edit(t.start, t.end, ''),
        });
        break;
      case 'op':
        if (afterOp) {
          const adjacent = afterOp.end === t.start;
          if (adjacent && afterOp.text === '=' && (t.text === '>' || t.text === '<')) {
            this.fail(`'=${t.text}' is not an operator.`, afterOp.start, t.end, {
              suggestion: `Did you mean '${t.text}='?`,
              fix: this.edit(afterOp.start, t.end, `${t.text}=`),
            });
          }
          if (adjacent && afterOp.text === '*' && t.text === '*') {
            this.fail("'**' is not an operator.", afterOp.start, t.end, {
              suggestion: "Use '^' for exponentiation, e.g. =2^3.",
              fix: this.edit(afterOp.start, t.end, '^'),
            });
          }
          this.fail(`Unexpected '${t.text}' after '${afterOp.text}'.`, t.start, t.end, {
            suggestion: 'Remove one of the two operators.',
            fix: this.edit(t.start, t.end, ''),
          });
        }
        this.fail(`Unexpected '${t.text}': expected a value before it.`, t.start, t.end, {
          suggestion: `Add a value before '${t.text}', or remove it.`,
          fix: this.edit(t.start, t.end, ''),
        });
        break;
      case 'comma':
        if (afterOp) {
          this.fail(`Expected a value after '${afterOp.text}' but found ','.`, t.start, t.end, {
            suggestion: `Add a value after '${afterOp.text}'.`,
          });
        }
        this.fail("Unexpected ','.", t.start, t.end, {
          suggestion: 'Commas separate function arguments, e.g. =SUM(A1, B1).',
        });
        break;
      case 'colon':
        this.fail("Unexpected ':'.", t.start, t.end, {
          suggestion: 'A range needs a cell reference on each side, e.g. A1:B5.',
        });
        break;
      case 'invalid':
        this.invalidToken(t);
        break;
      default:
        break;
    }
    this.fail(`Unexpected '${t.text}'.`, t.start, t.end);
  }

  /** A complete expression was parsed but `t` cannot follow it. */
  private unexpectedAfterExpression(t: Token, context: 'top' | 'paren' | 'args'): never {
    const prev = this.prev();
    if (t.type === 'invalid') this.invalidToken(t);
    if (t.type === 'rparen') {
      this.fail("Unexpected ')' without a matching '('.", t.start, t.end, {
        suggestion: "Remove the extra ')'.",
        fix: this.edit(t.start, t.end, ''),
      });
    }
    if (t.type === 'comma') {
      this.fail("Unexpected ','.", t.start, t.end, {
        suggestion:
          context === 'paren'
            ? "Commas only separate function arguments. Did you forget a function name before '('?"
            : 'Commas separate function arguments, e.g. =SUM(A1, B1).',
      });
    }
    if (t.type === 'colon') {
      this.fail("Unexpected ':'.", t.start, t.end, {
        suggestion: 'Ranges are written between two cell references, e.g. A1:B5.',
      });
    }
    if (OPERAND_START.has(t.type) && prev) {
      if (context === 'args') {
        this.fail(`Missing ',' between '${prev.text}' and '${t.text}'.`, t.start, t.end, {
          suggestion: 'Separate function arguments with commas.',
          fix: this.input.slice(0, prev.end) + ', ' + this.input.slice(t.start),
        });
      }
      this.fail(`Missing operator between '${prev.text}' and '${t.text}'.`, t.start, t.end, {
        suggestion: 'Add an operator such as +, -, *, / or & between them.',
      });
    }
    this.fail(`Unexpected '${t.text}'.`, t.start, t.end);
  }

  private invalidToken(t: Token): never {
    const at = (message: string, details: ErrorDetails = {}) => this.fail(message, t.start, t.end, details);
    switch (t.text) {
      case ';':
        return at("Unexpected ';'.", {
          suggestion: "Use ',' to separate function arguments.",
          fix: this.edit(t.start, t.end, ','),
        });
      case '!=':
        return at("'!=' is not a valid operator.", {
          suggestion: "Use '<>' for 'not equal to'.",
          fix: this.edit(t.start, t.end, '<>'),
        });
      case '==':
        return at("'==' is not a valid operator.", {
          suggestion: "Use a single '=' to compare values.",
          fix: this.edit(t.start, t.end, '='),
        });
      case '{':
      case '}':
        return at('Array constants like {1,2,3} are not supported.', {
          suggestion: 'Put the values in cells and use a range such as A1:A3 instead.',
        });
      case '!':
        return at('Sheet references like Sheet1!A1 are not supported.', {
          suggestion: 'This workbook has a single sheet; reference cells directly, e.g. A1.',
        });
      case "'":
        return at("Unexpected \"'\".", { suggestion: 'Text must be wrapped in double quotes, e.g. "text".' });
      case '#':
        return at("Unknown error value starting with '#'.", {
          suggestion: 'Valid error values are #N/A, #DIV/0!, #VALUE!, #REF!, #NAME?, #NUM! and #NULL!.',
        });
      default:
        return at(`Unexpected character '${t.text}'.`, {
          suggestion: `Remove '${t.text}'.`,
          fix: this.edit(t.start, t.end, ''),
        });
    }
  }
}
