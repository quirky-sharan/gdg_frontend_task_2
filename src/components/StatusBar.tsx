import { useMemo } from 'react';
import { formatNumberGeneral, fromKey, isError, rangeArea } from '../engine';
import { selectionBounds, useSheet } from '../state/store';

function useSelectionStats() {
  const selection = useSheet((s) => s.selection);
  const version = useSheet((s) => s.version);
  return useMemo(() => {
    const { engine } = useSheet.getState();
    const b = selectionBounds(selection);
    if (rangeArea(b) < 2) return null;
    let count = 0;
    let numbers = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const key of engine.keysInRange(b)) {
      const { row, col } = fromKey(key);
      const v = engine.getValue(row, col);
      if (v === null || isError(v)) continue;
      count++;
      if (typeof v === 'number') {
        numbers++;
        sum += v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    return { count, numbers, sum, min, max };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, version]);
}

export function StatusBar() {
  const editing = useSheet((s) => s.editing);
  const recalc = useSheet((s) => s.lastRecalc);
  useSheet((s) => s.version);
  const stats = useSelectionStats();
  const { cells, formulas, errors } = useSheet.getState().engine.stats;
  const pointing = editing && editing.draft.startsWith('=');

  return (
    <footer className="status-bar">
      <span className={`mode mode-${editing ? 'edit' : 'ready'}`}>{editing ? (pointing ? 'Formula' : 'Edit') : 'Ready'}</span>
      {pointing && <span className="muted">Click a cell to insert its reference</span>}
      {stats && (
        <span className="sel-stats">
          {stats.numbers > 0 && (
            <>
              Sum <b>{formatNumberGeneral(stats.sum)}</b> · Average <b>{formatNumberGeneral(stats.sum / stats.numbers)}</b> · Min{' '}
              <b>{formatNumberGeneral(stats.min)}</b> · Max <b>{formatNumberGeneral(stats.max)}</b> ·{' '}
            </>
          )}
          Count <b>{stats.count.toLocaleString()}</b>
        </span>
      )}
      <span className="spacer" />
      {recalc && (
        <span className="recalc" title="Only cells that depend on the change are recalculated">
          {recalc.label}: recalculated <b>{recalc.evaluated.toLocaleString()}</b> formula{recalc.evaluated === 1 ? '' : 's'} (
          {recalc.updated.toLocaleString()} cells touched) in <b>{recalc.ms < 1 ? recalc.ms.toFixed(2) : recalc.ms.toFixed(0)} ms</b>
          {recalc.cycles > 0 && <span className="warn"> · {recalc.cycles} circular reference{recalc.cycles > 1 ? 's' : ''}</span>}
        </span>
      )}
      <span className="muted">
        {cells.toLocaleString()} cells · {formulas.toLocaleString()} formulas
        {errors > 0 && (
          <button className="link warn" onClick={() => useSheet.getState().setPanel('errors')}>
            {' '}
            · {errors} error{errors === 1 ? '' : 's'}
          </button>
        )}
      </span>
    </footer>
  );
}
