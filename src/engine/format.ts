/**
 * Number and date formatting, shared by the TEXT() function and cell number formats.
 */
import { formatNumberGeneral } from './values';

const MS_PER_DAY = 86_400_000;
/** Serial day 0 in the spreadsheet date system (1899-12-30, the Excel/Sheets epoch). */
const EPOCH_UTC = Date.UTC(1899, 11, 30);

export function dateToSerial(year: number, month: number, day: number): number {
  return (Date.UTC(year, month - 1, day) - EPOCH_UTC) / MS_PER_DAY;
}

export function serialToDate(serial: number): Date {
  return new Date(EPOCH_UTC + Math.round(serial * MS_PER_DAY));
}

export function nowSerial(): number {
  const d = new Date();
  const local = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  return (local - EPOCH_UTC) / MS_PER_DAY;
}

export function todaySerial(): number {
  return Math.floor(nowSerial());
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatDate(serial: number, pattern: string): string {
  const d = serialToDate(serial);
  const hasTime = /h/i.test(pattern);
  // Tokens are matched longest-first; "m" means minutes when it follows "h".
  return pattern.replace(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|am\/pm/gi, (tok, offset: number, all: string) => {
    const lower = tok.toLowerCase();
    const prevChunk = all.slice(0, offset).toLowerCase();
    const isMinute = hasTime && (lower === 'mm' || lower === 'm') && /h[^a-z]*$/.test(prevChunk);
    switch (lower) {
      case 'yyyy':
        return String(d.getUTCFullYear());
      case 'yy':
        return pad(d.getUTCFullYear() % 100);
      case 'mmmm':
        return MONTHS[d.getUTCMonth()];
      case 'mmm':
        return MONTHS[d.getUTCMonth()].slice(0, 3);
      case 'mm':
        return isMinute ? pad(d.getUTCMinutes()) : pad(d.getUTCMonth() + 1);
      case 'm':
        return isMinute ? String(d.getUTCMinutes()) : String(d.getUTCMonth() + 1);
      case 'dddd':
        return DAYS[d.getUTCDay()];
      case 'ddd':
        return DAYS[d.getUTCDay()].slice(0, 3);
      case 'dd':
        return pad(d.getUTCDate());
      case 'd':
        return String(d.getUTCDate());
      case 'hh':
        return pad(/am\/pm/i.test(all) ? ((d.getUTCHours() + 11) % 12) + 1 : d.getUTCHours());
      case 'h':
        return String(/am\/pm/i.test(all) ? ((d.getUTCHours() + 11) % 12) + 1 : d.getUTCHours());
      case 'ss':
        return pad(d.getUTCSeconds());
      case 's':
        return String(d.getUTCSeconds());
      case 'am/pm':
        return d.getUTCHours() < 12 ? 'AM' : 'PM';
      default:
        return tok;
    }
  });
}

function withThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Formats a number with an Excel-style pattern. Supported: 0 # , . % and literal
 * prefix/suffix text (e.g. "$#,##0.00", "0.0%", "#,##0"), plus date/time patterns
 * built from y m d h s tokens (e.g. "yyyy-mm-dd", "dd mmm yyyy", "hh:mm").
 */
export function formatNumberPattern(value: number, pattern: string): string {
  if (pattern === '' || pattern.toLowerCase() === 'general') return formatNumberGeneral(value);
  if (/[yd]/i.test(pattern) || /h/i.test(pattern) || /^m+$/i.test(pattern)) return formatDate(value, pattern);

  // Use only the first section of "positive;negative;zero" patterns.
  const section = pattern.split(';')[0];
  const firstDigit = section.search(/[0#]/);
  if (firstDigit < 0) return section;
  let lastDigit = firstDigit;
  for (let i = firstDigit; i < section.length; i++) if (/[0#.,]/.test(section[i])) lastDigit = i;
  const prefix = section.slice(0, firstDigit);
  const core = section.slice(firstDigit, lastDigit + 1);
  const suffix = section.slice(lastDigit + 1);

  let n = value;
  if (suffix.includes('%') || prefix.includes('%')) n *= 100;
  const [intPattern, decPattern = ''] = core.split('.');
  const decimals = (decPattern.match(/[0#]/g) ?? []).length;
  const minDecimals = (decPattern.match(/0/g) ?? []).length;
  const minInt = (intPattern.match(/0/g) ?? []).length;
  const thousands = intPattern.includes(',');

  const negative = n < 0;
  let fixed = Math.abs(n).toFixed(decimals);
  let [intStr, decStr = ''] = fixed.split('.');
  if (decStr.length > minDecimals) {
    decStr = decStr.replace(/0+$/, '');
    if (decStr.length < minDecimals) decStr = decStr.padEnd(minDecimals, '0');
  }
  intStr = intStr.replace(/^0+/, '');
  if (intStr.length < minInt) intStr = intStr.padStart(minInt, '0');
  if (thousands) intStr = withThousands(intStr);
  fixed = decStr ? `${intStr}.${decStr}` : intStr;
  if (fixed === '') fixed = '0';
  return `${negative ? '-' : ''}${prefix}${fixed}${suffix}`;
}

export type NumberFormat = 'general' | 'number' | 'integer' | 'currency' | 'percent' | 'date' | 'datetime';

export const NUMBER_FORMAT_PATTERNS: Record<NumberFormat, string> = {
  general: 'General',
  number: '#,##0.00',
  integer: '#,##0',
  currency: '$#,##0.00',
  percent: '0.00%',
  date: 'yyyy-mm-dd',
  datetime: 'yyyy-mm-dd hh:mm',
};

export const NUMBER_FORMAT_LABELS: Record<NumberFormat, string> = {
  general: 'General',
  number: 'Number (1,234.56)',
  integer: 'Integer (1,235)',
  currency: 'Currency ($1,234.56)',
  percent: 'Percent (12.34%)',
  date: 'Date (2024-01-31)',
  datetime: 'Date time',
};
