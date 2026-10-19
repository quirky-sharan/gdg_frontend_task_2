import { memo } from 'react';
import { isError, MAX_COLS, toKey } from '../../engine';
import { ROW_HEIGHT, useSheet } from '../../state/store';
import { cellAlign, displayValue } from '../../ui/display';
import type { VisibleWindow } from './layout';

/** How many empty columns a left-aligned text value may spill into. */
const MAX_OVERFLOW_COLS = 8;

interface RowProps {
  row: number;
  c0: number;
  c1: number;
  colX: Float64Array;
  /** Change counters: not read directly, they invalidate the memoized row. */
  version: number;
  formatVersion: number;
}

/**
 * One visible row. Only non-empty cells produce DOM nodes; grid lines come from
 * the row border and the column-line layer, so an empty viewport costs ~40 nodes.
 */
const GridRow = memo(function GridRow({ row, c0, c1, colX }: RowProps) {
  const { engine, formats } = useSheet.getState();
  const cells = [];
  for (let c = c0; c <= c1; c++) {
    const rec = engine.getCell(row, c);
    if (!rec) continue;
    const fmt = formats.get(toKey(row, c));
    const v = rec.value;
    const text = displayValue(v, fmt);
    if (text === '' && !fmt) continue;
    const align = cellAlign(v, fmt);
    let right = colX[c + 1];
    if (typeof v === 'string' && align === 'left') {
      for (let k = c + 1; k < MAX_COLS && k <= c + MAX_OVERFLOW_COLS && !engine.getCell(row, k); k++) right = colX[k + 1];
    }
    const error = isError(v);
    let className = 'cell';
    if (error) className += ' cell-error';
    if (fmt?.bold) className += ' cell-bold';
    if (fmt?.italic) className += ' cell-italic';
    if (rec.formula) className += ' cell-formula';
    cells.push(
      <div
        key={c}
        className={className}
        style={{ left: colX[c], width: right - colX[c] - 1, textAlign: align }}
        title={error ? `${v.code}: ${v.message}` : undefined}
      >
        {text}
      </div>,
    );
  }
  return (
    <div className="grid-row" style={{ top: row * ROW_HEIGHT, width: colX[MAX_COLS] }}>
      {cells}
    </div>
  );
});

export const GridCells = memo(function GridCells({ win, colX }: { win: VisibleWindow; colX: Float64Array }) {
  const version = useSheet((s) => s.version);
  const formatVersion = useSheet((s) => s.formatVersion);
  const rows = [];
  for (let r = win.r0; r <= win.r1; r++) {
    rows.push(<GridRow key={r} row={r} c0={win.c0} c1={win.c1} colX={colX} version={version} formatVersion={formatVersion} />);
  }
  const lines = [];
  const top = win.r0 * ROW_HEIGHT;
  const height = (win.r1 - win.r0 + 1) * ROW_HEIGHT;
  for (let c = win.c0; c <= win.c1; c++) {
    lines.push(<div key={c} className="col-line" style={{ left: colX[c + 1] - 1, top, height }} />);
  }
  return (
    <>
      {lines}
      {rows}
    </>
  );
});
