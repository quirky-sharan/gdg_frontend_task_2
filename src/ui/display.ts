import {
  formatNumberGeneral,
  formatNumberPattern,
  isError,
  NUMBER_FORMAT_PATTERNS,
  type CellValue,
  type NumberFormat,
} from '../engine';

export type Align = 'left' | 'center' | 'right';

export interface CellFormat {
  bold?: boolean;
  italic?: boolean;
  align?: Align;
  numberFormat?: NumberFormat;
}

/** Text shown in a cell for a computed value. */
export function displayValue(v: CellValue, fmt?: CellFormat): string {
  if (v === null) return '';
  if (typeof v === 'number') {
    const nf = fmt?.numberFormat;
    return nf && nf !== 'general' ? formatNumberPattern(v, NUMBER_FORMAT_PATTERNS[nf]) : formatNumberGeneral(v);
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'string') return v;
  return v.code;
}

/** Spreadsheet default alignment: numbers right, booleans and errors centered, text left. */
export function cellAlign(v: CellValue, fmt?: CellFormat): Align {
  if (fmt?.align) return fmt.align;
  if (typeof v === 'number') return 'right';
  if (typeof v === 'boolean' || isError(v)) return 'center';
  return 'left';
}

export function valueType(v: CellValue): string {
  if (v === null) return 'Empty';
  if (typeof v === 'number') return 'Number';
  if (typeof v === 'boolean') return 'Logical';
  if (typeof v === 'string') return 'Text';
  return 'Error';
}
