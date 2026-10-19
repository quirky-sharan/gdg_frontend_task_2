import { dateToSerial, nowSerial, serialToDate, todaySerial } from '../format';
import { parseNumericText } from '../values';
import type { Args, FunctionSpec } from './args';

/** Reads a date argument: a serial number, or text such as "2024-03-15" / "March 15, 2024". */
function serial(a: Args, i: number): number {
  const v = a.plain(i);
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseNumericText(v);
    if (n !== null) return n;
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v.trim());
    if (iso) return dateToSerial(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    const parsed = Date.parse(v);
    if (!Number.isNaN(parsed)) {
      const d = new Date(parsed);
      return dateToSerial(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
  }
  if (v === null) return 0;
  return a.fail('#VALUE!', `${a.name} expects a date for argument ${i + 1}.`, i, {
    suggestion: 'Use DATE(year, month, day) or text like "2024-03-15".',
  });
}

const part = (a: Args, pick: (d: Date) => number) => pick(serialToDate(serial(a, 0)));

export const dateFunctions: FunctionSpec[] = [
  {
    name: 'DATE',
    category: 'Date',
    minArgs: 3,
    maxArgs: 3,
    args: 'year, month, day',
    description: 'Serial number of a date. Months and days outside their range roll over (e.g. month 13 = January next year). Format the cell as Date to display it.',
    example: '=DATE(2024, 12, 31)',
    impl: (a) => {
      let y = Math.trunc(a.number(0));
      if (y >= 0 && y < 1900) y += 1900;
      const s = dateToSerial(y, Math.trunc(a.number(1)), Math.trunc(a.number(2)));
      if (s < 0) a.fail('#NUM!', 'DATE results before 1900 are not supported.', 0);
      return s;
    },
  },
  {
    name: 'TODAY',
    category: 'Date',
    minArgs: 0,
    maxArgs: 0,
    args: '',
    description: "Serial number of today's date. Recalculated on every change.",
    example: '=TODAY()',
    volatile: true,
    impl: () => todaySerial(),
  },
  {
    name: 'NOW',
    category: 'Date',
    minArgs: 0,
    maxArgs: 0,
    args: '',
    description: 'Serial number of the current date and time. Recalculated on every change.',
    example: '=NOW()',
    volatile: true,
    impl: () => nowSerial(),
  },
  {
    name: 'YEAR',
    category: 'Date',
    minArgs: 1,
    maxArgs: 1,
    args: 'date',
    description: 'Year of a date.',
    example: '=YEAR(TODAY())',
    impl: (a) => part(a, (d) => d.getUTCFullYear()),
  },
  {
    name: 'MONTH',
    category: 'Date',
    minArgs: 1,
    maxArgs: 1,
    args: 'date',
    description: 'Month (1-12) of a date.',
    example: '=MONTH("2024-03-15")',
    impl: (a) => part(a, (d) => d.getUTCMonth() + 1),
  },
  {
    name: 'DAY',
    category: 'Date',
    minArgs: 1,
    maxArgs: 1,
    args: 'date',
    description: 'Day of the month (1-31) of a date.',
    example: '=DAY(DATE(2024, 3, 15))',
    impl: (a) => part(a, (d) => d.getUTCDate()),
  },
  {
    name: 'HOUR',
    category: 'Date',
    minArgs: 1,
    maxArgs: 1,
    args: 'time',
    description: 'Hour (0-23) of a date/time serial number.',
    example: '=HOUR(NOW())',
    impl: (a) => part(a, (d) => d.getUTCHours()),
  },
  {
    name: 'MINUTE',
    category: 'Date',
    minArgs: 1,
    maxArgs: 1,
    args: 'time',
    description: 'Minute (0-59) of a date/time serial number.',
    example: '=MINUTE(NOW())',
    impl: (a) => part(a, (d) => d.getUTCMinutes()),
  },
  {
    name: 'WEEKDAY',
    category: 'Date',
    minArgs: 1,
    maxArgs: 2,
    args: 'date, [return_type]',
    description: 'Day of the week. return_type 1 (default): Sunday=1..Saturday=7; 2: Monday=1..Sunday=7; 3: Monday=0..Sunday=6.',
    example: '=WEEKDAY("2024-03-15", 2)',
    impl: (a) => {
      const day = serialToDate(serial(a, 0)).getUTCDay();
      const type = Math.trunc(a.number(1, 1));
      if (type === 1) return day + 1;
      if (type === 2) return ((day + 6) % 7) + 1;
      if (type === 3) return (day + 6) % 7;
      return a.fail('#NUM!', 'WEEKDAY return_type must be 1, 2 or 3.', 1);
    },
  },
  {
    name: 'DAYS',
    category: 'Date',
    minArgs: 2,
    maxArgs: 2,
    args: 'end_date, start_date',
    description: 'Number of days between two dates.',
    example: '=DAYS("2024-12-25", TODAY())',
    impl: (a) => Math.trunc(serial(a, 0)) - Math.trunc(serial(a, 1)),
  },
  {
    name: 'EDATE',
    category: 'Date',
    minArgs: 2,
    maxArgs: 2,
    args: 'start_date, months',
    description: 'The date a number of months before or after a start date.',
    example: '=EDATE(DATE(2024, 1, 31), 1)',
    impl: (a) => {
      const d = serialToDate(serial(a, 0));
      const months = Math.trunc(a.number(1));
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + months;
      const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      return dateToSerial(y, m + 1, Math.min(d.getUTCDate(), lastDay));
    },
  },
];
