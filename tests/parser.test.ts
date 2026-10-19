import { describe, expect, it } from 'vitest';
import { parseFormula, tokenize, type Token } from '../src/engine';
import type { Node } from '../src/engine/ast';

/** Compact S-expression rendering of an AST, for precedence tests. */
function show(n: Node): string {
  switch (n.type) {
    case 'number':
      return String(n.value);
    case 'string':
      return JSON.stringify(n.value);
    case 'boolean':
      return n.value ? 'TRUE' : 'FALSE';
    case 'cell':
      return `R${n.row}C${n.col}`;
    case 'range':
      return `[${n.top},${n.left}:${n.bottom},${n.right}]`;
    case 'unary':
      return `(${n.op}${show(n.operand)})`;
    case 'percent':
      return `(${show(n.operand)}%)`;
    case 'binary':
      return `(${show(n.left)} ${n.op} ${show(n.right)})`;
    case 'call':
      return `${n.name}(${n.args.map(show).join(', ')})`;
    case 'missing':
      return '_';
    case 'name':
      return `?${n.name}`;
    case 'error':
      return n.code;
  }
}

function ast(formula: string): string {
  const r = parseFormula(formula);
  if (!r.ok) throw new Error(`parse failed: ${r.error.message}`);
  return show(r.ast);
}

function parseError(formula: string) {
  const r = parseFormula(formula);
  if (r.ok) throw new Error(`expected a parse error for ${formula}`);
  return r.error;
}

describe('tokenizer', () => {
  const types = (s: string) => tokenize(s, 1).map((t: Token) => t.type);

  it('recognizes all token kinds', () => {
    expect(types('=SUM(A1:$B$2, 3.5e2, "x""y", TRUE, #N/A) <> 4%')).toEqual([
      'func', 'lparen', 'cell', 'colon', 'cell', 'comma', 'number', 'comma', 'string', 'comma',
      'bool', 'comma', 'error', 'rparen', 'op', 'number', 'op', 'eof',
    ]);
  });

  it('distinguishes function names from cell-like words', () => {
    const [t] = tokenize('=LOG10(100)', 1);
    expect(t.type).toBe('func');
    const [c] = tokenize('=LOG10', 1);
    expect(c.type).toBe('cell');
  });

  it('reads whole-column and whole-row ranges', () => {
    expect(types('=SUM(A:C)')).toEqual(['func', 'lparen', 'colrange', 'rparen', 'eof']);
    expect(types('=SUM(2:5)')).toEqual(['func', 'lparen', 'rowrange', 'rparen', 'eof']);
  });

  it('flags unterminated strings and keeps offsets relative to the full input', () => {
    const [s] = tokenize('="abc', 1);
    expect(s).toMatchObject({ type: 'string', unterminated: true, start: 1, end: 5 });
  });

  it('decodes escaped quotes', () => {
    const [s] = tokenize('="say ""hi"""', 1);
    expect(s).toMatchObject({ type: 'string', value: 'say "hi"' });
  });
});

describe('parser precedence and associativity', () => {
  it('multiplication binds tighter than addition', () => {
    expect(ast('=1+2*3')).toBe('(1 + (2 * 3))');
  });

  it('subtraction and division are left associative', () => {
    expect(ast('=10-4-3')).toBe('((10 - 4) - 3)');
    expect(ast('=8/4/2')).toBe('((8 / 4) / 2)');
  });

  it('exponent is left associative like Excel', () => {
    expect(ast('=2^3^2')).toBe('((2 ^ 3) ^ 2)');
  });

  it('unary minus binds tighter than ^ (Excel semantics)', () => {
    expect(ast('=-2^2')).toBe('((-2) ^ 2)');
    expect(ast('=2^-1')).toBe('(2 ^ (-1))');
  });

  it('comparison has the lowest precedence, then concatenation', () => {
    expect(ast('=1+1=2')).toBe('((1 + 1) = 2)');
    expect(ast('="a"&1+2')).toBe('("a" & (1 + 2))');
    expect(ast('=A1&B1<>"x"')).toBe('((R0C0 & R0C1) <> "x")');
  });

  it('postfix percent', () => {
    expect(ast('=50%*2')).toBe('((50%) * 2)');
  });

  it('parentheses override precedence', () => {
    expect(ast('=(1+2)*3')).toBe('((1 + 2) * 3)');
  });

  it('parses nested function calls, ranges and missing arguments', () => {
    expect(ast('=IF(SUM(A1:B2)>10, MAX(C1, 3), )')).toBe('IF((SUM([0,0:1,1]) > 10), MAX(R0C2, 3), _)');
    expect(ast('=PI()')).toBe('PI()');
  });

  it('normalizes reversed ranges', () => {
    expect(ast('=SUM(B5:A1)')).toBe('SUM([0,0:4,1])');
  });

  it('records source spans for diagnostics', () => {
    const r = parseFormula('=1 + SUM(A1)');
    expect(r.ok).toBe(true);
    if (r.ok && r.ast.type === 'binary') {
      expect(r.ast.right).toMatchObject({ type: 'call', start: 5, end: 12, nameEnd: 8 });
      expect(r.ast.opStart).toBe(3);
    }
  });
});

describe('parser diagnostics', () => {
  it('reports a missing closing parenthesis at the end (task example)', () => {
    const e = parseError('=SUM(A1, B2');
    expect(e.message).toBe('Missing closing parenthesis.');
    expect(e.start).toBe(11);
    expect(e.suggestion).toBe("Add ')' at the end of the formula.");
    expect(e.fix).toBe('=SUM(A1, B2)');
  });

  it('counts several unclosed parentheses', () => {
    const e = parseError('=ROUND(SUM(A1:A3');
    expect(e.suggestion).toBe("Add '))' at the end of the formula.");
    expect(e.fix).toBe('=ROUND(SUM(A1:A3))');
  });

  it('reports a dangling operator', () => {
    const e = parseError('=A1+');
    expect(e.message).toBe("Expected a value after '+'.");
    expect(e.start).toBe(4);
  });

  it('reports an extra closing parenthesis with a fix', () => {
    const e = parseError('=SUM(A1))');
    expect(e.message).toContain("Unexpected ')'");
    expect(e.start).toBe(8);
    expect(e.fix).toBe('=SUM(A1)');
  });

  it('reports a missing comma between arguments', () => {
    const e = parseError('=SUM(A1 B1)');
    expect(e.message).toBe("Missing ',' between 'A1' and 'B1'.");
    expect(e.start).toBe(8);
    expect(e.fix).toBe('=SUM(A1, B1)');
  });

  it('reports a missing operator between operands', () => {
    const e = parseError('=A1 B1');
    expect(e.message).toBe("Missing operator between 'A1' and 'B1'.");
  });

  it('suggests fixes for common operator mistakes', () => {
    expect(parseError('=A1!=B1').fix).toBe('=A1<>B1');
    expect(parseError('=A1==B1').fix).toBe('=A1=B1');
    expect(parseError('=A1=>B1').fix).toBe('=A1>=B1');
    expect(parseError('=2**3').fix).toBe('=2^3');
    expect(parseError('=SUM(A1;B1)').fix).toBe('=SUM(A1,B1)');
  });

  it('reports unterminated strings at the opening quote', () => {
    const e = parseError('=CONCAT("abc');
    expect(e.message).toBe('Missing closing quote.');
    expect(e.start).toBe(8);
  });

  it('reports out-of-range references as #REF!', () => {
    expect(parseError('=A0+1').code).toBe('#REF!');
    expect(parseError('=AAA1').code).toBe('#REF!');
    expect(parseError('=A100001').code).toBe('#REF!');
  });

  it('reports an empty formula', () => {
    expect(parseError('=').message).toBe('The formula is empty.');
  });

  it('reports incomplete ranges', () => {
    const e = parseError('=SUM(A1:)');
    expect(e.message).toBe("Expected a cell reference after ':'.");
  });

  it('rejects absurdly deep nesting without overflowing the stack', () => {
    const deep = '=' + '('.repeat(500) + '1' + ')'.repeat(500);
    expect(parseError(deep).message).toContain('nested too deeply');
  });
});
