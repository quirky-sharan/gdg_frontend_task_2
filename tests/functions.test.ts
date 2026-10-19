import { describe, expect, it } from 'vitest';
import { FUNCTION_LIST } from '../src/engine';
import { errorCode, evaluate } from './helpers';

/** Data used by most cases: a small product table in A1:D6. */
const TABLE: Record<string, string> = {
  A1: 'Product', B1: 'Region', C1: 'Units', D1: 'Price',
  A2: 'Apple', B2: 'East', C2: '10', D2: '1.5',
  A3: 'Banana', B3: 'West', C3: '25', D3: '0.25',
  A4: 'Cherry', B4: 'East', C4: '7', D4: '4',
  A5: 'Date', B5: 'North', C5: '12', D5: '3',
  A6: 'Elder', B6: 'East', C6: 'n/a', D6: '2',
  F1: '1', F2: '3', F3: '5', F4: '7',
};

type Case = [formula: string, expected: unknown];

function check(cases: Case[]) {
  for (const [formula, expected] of cases) {
    it(`${formula} → ${String(expected)}`, () => {
      const v = evaluate(formula, TABLE);
      if (typeof expected === 'string' && expected.startsWith('#')) {
        expect(errorCode(v)).toBe(expected);
      } else if (typeof expected === 'number') {
        expect(typeof v).toBe('number');
        expect(v as number).toBeCloseTo(expected, 9);
      } else {
        expect(v).toEqual(expected);
      }
    });
  }
}

describe('library size', () => {
  it('provides well over 30 functions, each documented', () => {
    expect(FUNCTION_LIST.length).toBeGreaterThanOrEqual(30);
    for (const f of FUNCTION_LIST) {
      expect(f.description.length, f.name).toBeGreaterThan(5);
      expect(f.example.startsWith('='), f.name).toBe(true);
    }
  });

  it('every documented example compiles', () => {
    for (const f of FUNCTION_LIST) {
      const v = evaluate(f.example, TABLE);
      expect(errorCode(v) === '#ERROR!' || errorCode(v) === '#NAME?', `${f.name}: ${f.example}`).toBe(false);
    }
  });
});

describe('operators and coercion', () => {
  check([
    ['=1+2*3', 7],
    ['=(1+2)*3', 9],
    ['=-2^2', 4],
    ['=2^3^2', 64],
    ['=10/4', 2.5],
    ['=50%', 0.5],
    ['=0.1+0.2', 0.3],
    ['=0.1+0.2=0.3', true],
    ['="a"&"b"&1', 'ab1'],
    ['=1/0', '#DIV/0!'],
    ['=C2/Z99', '#DIV/0!'],
    ['="abc"+1', '#VALUE!'],
    ['="5"+1', 6],
    ['=TRUE+1', 2],
    ['=Z99+1', 1],
    ['=A1:A3+1', '#VALUE!'],
    ['="apple"="APPLE"', true],
    ['=2<"a"', true],
    ['=TRUE>1', true],
    ['=3>=3', true],
    ['=1<>1', false],
    ['=#N/A', '#N/A'],
    ['=(-8)^(1/3)', '#NUM!'],
  ]);
});

describe('math', () => {
  check([
    ['=SUM(C2:C5)', 54],
    ['=SUM(C2:C6, 1)', 55],
    ['=SUM(C:C)', 54],
    ['=SUM(A1:D6)', 54 + 10.75],
    ['=SUM(F1:F4, F1)', 17],
    ['=SUM("abc")', '#VALUE!'],
    ['=PRODUCT(F1:F3)', 15],
    ['=ABS(-3)', 3],
    ['=ROUND(2.5)', 3],
    ['=ROUND(-2.5)', -3],
    ['=ROUND(1.005, 2)', 1.01],
    ['=ROUND(1234.5, -2)', 1200],
    ['=ROUNDUP(3.141, 1)', 3.2],
    ['=ROUNDDOWN(-3.149, 2)', -3.14],
    ['=INT(-3.5)', -4],
    ['=TRUNC(-3.9)', -3],
    ['=MOD(10, 3)', 1],
    ['=MOD(-1, 3)', 2],
    ['=MOD(1, 0)', '#DIV/0!'],
    ['=POWER(2, 10)', 1024],
    ['=SQRT(16)', 4],
    ['=SQRT(-1)', '#NUM!'],
    ['=EXP(0)', 1],
    ['=LN(EXP(2))', 2],
    ['=LOG(8, 2)', 3],
    ['=LOG10(1000)', 3],
    ['=PI()', Math.PI],
    ['=SIGN(-7)', -1],
    ['=CEILING(4.3, 0.5)', 4.5],
    ['=FLOOR(4.7, 0.5)', 4.5],
    ['=FACT(5)', 120],
    ['=SUMPRODUCT(C2:C5, D2:D5)', 15 + 6.25 + 28 + 36],
    ['=SUMPRODUCT(C2:C5, D2:D4)', '#VALUE!'],
    ['=SUMSQ(3, 4)', 25],
    ['=SUMIF(B2:B6, "East", C2:C6)', 17],
    ['=SUMIF(C2:C6, ">10")', 37],
    ['=SUMIF(A2:A6, "?a*", C2:C6)', 37],
    ['=SUMIFS(C2:C6, B2:B6, "East", D2:D6, ">1")', 17],
    ['=RADIANS(180)', Math.PI],
    ['=DEGREES(PI())', 180],
    ['=COS(0)', 1],
  ]);
});

describe('statistical', () => {
  check([
    ['=AVERAGE(F1:F4)', 4],
    ['=AVERAGE(A1:A3)', '#DIV/0!'],
    ['=AVERAGEIF(B2:B6, "East", D2:D6)', 2.5],
    ['=MIN(F1:F4)', 1],
    ['=MAX(F1:F4, 10)', 10],
    ['=MAX(A1:A3)', 0],
    ['=MEDIAN(F1:F4)', 4],
    ['=MEDIAN(1, 9, 3)', 3],
    ['=MODE(1, 2, 2, 3)', 2],
    ['=STDEV(F1:F4)', Math.sqrt(20 / 3)],
    ['=STDEVP(F1:F4)', Math.sqrt(5)],
    ['=VAR(F1:F4)', 20 / 3],
    ['=VARP(F1:F4)', 5],
    ['=COUNT(C2:C6)', 4],
    ['=COUNT(1, "2", "x")', 2],
    ['=COUNTA(A1:A6)', 6],
    ['=COUNTA(C:C)', 6],
    ['=COUNTBLANK(A1:B10)', 8],
    ['=COUNTIF(B2:B6, "East")', 3],
    ['=COUNTIF(C2:C6, ">=10")', 3],
    ['=COUNTIF(B2:B6, "<>East")', 2],
    ['=COUNTIF(A1:A10, "")', 4],
    ['=COUNTIFS(B2:B6, "East", C2:C6, ">8")', 1],
    ['=LARGE(F1:F4, 2)', 5],
    ['=SMALL(F1:F4, 1)', 1],
    ['=SMALL(F1:F4, 9)', '#NUM!'],
  ]);
});

describe('logical', () => {
  check([
    ['=IF(C2>5, "big", "small")', 'big'],
    ['=IF(FALSE, 1)', false],
    ['=IF(TRUE, , 1)', 0],
    ['=IF(TRUE, 1, 1/0)', 1],
    ['=IF("x", 1, 2)', '#VALUE!'],
    ['=IFS(C2>20, "a", C2>5, "b")', 'b'],
    ['=IFS(FALSE, 1)', '#N/A'],
    ['=AND(TRUE, 1, C2>5)', true],
    ['=AND(TRUE, FALSE)', false],
    ['=OR(FALSE, C3>20)', true],
    ['=XOR(TRUE, TRUE, TRUE)', true],
    ['=NOT(C2>5)', false],
    ['=TRUE()', true],
    ['=FALSE()', false],
    ['=IFERROR(1/0, "oops")', 'oops'],
    ['=IFERROR(5, "oops")', 5],
    ['=IFNA(MATCH("zzz", A1:A6, 0), "none")', 'none'],
    ['=IFNA(1/0, "none")', '#DIV/0!'],
    ['=SWITCH(2, 1, "one", 2, "two", "many")', 'two'],
    ['=SWITCH(9, 1, "one", "many")', 'many'],
    ['=SWITCH(9, 1, "one")', '#N/A'],
  ]);
});

describe('text', () => {
  check([
    ['=CONCAT(A2, "-", B2)', 'Apple-East'],
    ['=CONCAT(F1:F3)', '135'],
    ['=CONCATENATE("Q", 1, "-", 2024)', 'Q1-2024'],
    ['=TEXTJOIN(", ", TRUE, A2:A4, Z1)', 'Apple, Banana, Cherry'],
    ['=LEN("hello")', 5],
    ['=UPPER("abc")', 'ABC'],
    ['=LOWER("ABC")', 'abc'],
    ['=PROPER("ada lovelace")', 'Ada Lovelace'],
    ['=TRIM("  a   b ")', 'a b'],
    ['=LEFT("Spreadsheet", 6)', 'Spread'],
    ['=LEFT("abc")', 'a'],
    ['=RIGHT("Spreadsheet", 5)', 'sheet'],
    ['=MID("Spreadsheet", 7, 5)', 'sheet'],
    ['=FIND("s", "Sheets")', 6],
    ['=FIND("z", "abc")', '#VALUE!'],
    ['=SEARCH("SHEET", "Spreadsheet")', 7],
    ['=SEARCH("s?eet", "Spreadsheet")', 7],
    ['=SUBSTITUTE("a-b-c", "-", "+")', 'a+b+c'],
    ['=SUBSTITUTE("a-b-c", "-", "+", 2)', 'a-b+c'],
    ['=REPLACE("2023-report", 1, 4, "2024")', '2024-report'],
    ['=REPT("ab", 3)', 'ababab'],
    ['=TEXT(1234.5, "$#,##0.00")', '$1,234.50'],
    ['=TEXT(0.256, "0.0%")', '25.6%'],
    ['=TEXT(3.14159, "0.00")', '3.14'],
    ['=TEXT(DATE(2024, 3, 5), "yyyy-mm-dd")', '2024-03-05'],
    ['=TEXT(DATE(2024, 3, 5), "dd mmm yyyy")', '05 Mar 2024'],
    ['=VALUE("42.5")', 42.5],
    ['=VALUE("abc")', '#VALUE!'],
    ['=EXACT("Word", "word")', false],
    ['=CHAR(65)', 'A'],
    ['=CODE("A")', 65],
  ]);
});

describe('lookup', () => {
  check([
    ['=VLOOKUP("Cherry", A2:D6, 3, FALSE)', 7],
    ['=VLOOKUP("cherry", A2:D6, 4, FALSE)', 4],
    ['=VLOOKUP("Ch*", A2:D6, 2, FALSE)', 'East'],
    ['=VLOOKUP("Zebra", A2:D6, 3, FALSE)', '#N/A'],
    ['=VLOOKUP("Apple", A2:D6, 9, FALSE)', '#REF!'],
    ['=VLOOKUP("Apple", A2:D6, 0, FALSE)', '#VALUE!'],
    ['=VLOOKUP(4, F1:F4, 1)', 3],
    ['=VLOOKUP(7, F1:F4, 1, TRUE)', 7],
    ['=VLOOKUP(0, F1:F4, 1, TRUE)', '#N/A'],
    ['=VLOOKUP("Banana", A:D, 3, FALSE)', 25],
    ['=HLOOKUP("Units", A1:D6, 3, FALSE)', 25],
    ['=XLOOKUP("Date", A2:A6, C2:C6)', 12],
    ['=XLOOKUP("Nope", A2:A6, C2:C6, "missing")', 'missing'],
    ['=XLOOKUP(4, F1:F4, F1:F4, , -1)', 3],
    ['=XLOOKUP(4, F1:F4, F1:F4, , 1)', 5],
    ['=XLOOKUP("East", B2:B6, A2:A6, , 0, -1)', 'Elder'],
    ['=INDEX(A2:D6, 3, 1)', 'Cherry'],
    ['=INDEX(F1:F4, 2)', 3],
    ['=INDEX(A1:D1, 2)', 'Region'],
    ['=SUM(INDEX(C2:D6, 0, 1))', 54],
    ['=INDEX(F1:F4, 9)', '#REF!'],
    ['=MATCH("Cherry", A2:A6, 0)', 3],
    ['=MATCH(6, F1:F4)', 3],
    ['=MATCH(6, F1:F4, 0)', '#N/A'],
    ['=CHOOSE(2, "a", "b", "c")', 'b'],
    ['=CHOOSE(4, "a", "b", "c")', '#VALUE!'],
    ['=ROW(B7)', 7],
    ['=ROW()', 1000],
    ['=COLUMN(D1)', 4],
    ['=COLUMN()', 26],
    ['=ROWS(A1:C10)', 10],
    ['=COLUMNS(A1:C10)', 3],
    ['=ROWS(A:A)', 100000],
  ]);
});

describe('information', () => {
  check([
    ['=ISBLANK(Z1)', true],
    ['=ISBLANK(A1)', false],
    ['=ISNUMBER(C2)', true],
    ['=ISNUMBER(C6)', false],
    ['=ISTEXT(A2)', true],
    ['=ISLOGICAL(1=1)', true],
    ['=ISERROR(1/0)', true],
    ['=ISERR(NA())', false],
    ['=ISNA(NA())', true],
    ['=ISEVEN(4)', true],
    ['=ISODD(-3)', true],
    ['=TYPE("a")', 2],
    ['=TYPE(A1:B2)', 64],
    ['=NA()', '#N/A'],
  ]);
});

describe('date', () => {
  check([
    ['=DATE(2024, 1, 1)', 45292],
    ['=DATE(2024, 13, 1)', 45658],
    ['=YEAR(DATE(2024, 3, 15))', 2024],
    ['=MONTH("2024-03-15")', 3],
    ['=DAY(DATE(2024, 3, 15))', 15],
    ['=WEEKDAY(DATE(2024, 3, 15))', 6],
    ['=WEEKDAY(DATE(2024, 3, 15), 2)', 5],
    ['=DAYS("2024-12-25", "2024-12-01")', 24],
    ['=EDATE(DATE(2024, 1, 31), 1)', 45351],
    ['=YEAR("not a date")', '#VALUE!'],
  ]);

  it('TODAY and NOW are close to the current date', () => {
    const today = evaluate('=TODAY()') as number;
    const now = evaluate('=NOW()') as number;
    expect(now - today).toBeGreaterThanOrEqual(0);
    expect(now - today).toBeLessThan(1);
    expect(today).toBeGreaterThan(45000);
  });
});

describe('errors inside function arguments', () => {
  it('propagates referenced errors and names their origin', () => {
    const v = evaluate('=SUM(A1:A2)', { A1: '=1/0', A2: '5' });
    expect(errorCode(v)).toBe('#DIV/0!');
    expect((v as { message: string }).message).toContain('A1');
  });

  it('positions argument errors on the offending argument', () => {
    const v = evaluate('=SQRT(-4)');
    expect(v).toMatchObject({ code: '#NUM!', start: 6, end: 8 });
  });

  it('short-circuits IF so the unused branch cannot fail', () => {
    expect(evaluate('=IF(A1="", 0, 1/A1)', {})).toBe(0);
  });
});

describe('numeric accuracy', () => {
  it('SUM uses compensated summation over long ranges', () => {
    const cells: Record<string, string> = {};
    for (let i = 1; i <= 2000; i++) cells[`A${i}`] = '0.1';
    expect(evaluate('=SUM(A1:A2000)', cells)).toBe(200);
  });
});
