import { useLayoutEffect, useMemo, useRef } from 'react';
import { ROW_HEIGHT, useSheet } from '../../state/store';
import { AssistPopup } from '../editor/AssistPopup';
import { useFormulaInput } from '../editor/useFormulaInput';

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 8;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/** The in-cell editor, positioned over the cell being edited. Grows to fit its text. */
export function CellEditor({ colX, viewportWidth }: { colX: Float64Array; viewportWidth: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const state = useFormulaInput('cell', inputRef);
  const { editing } = state;

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el && editing?.source === 'cell' && document.activeElement !== el) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(editing.caret, editing.caret);
    }
  }, [editing?.source, editing?.row, editing?.col, editing]);

  const font = useMemo(() => '13px ' + getComputedStyle(document.body).fontFamily, []);
  if (!editing) return null;

  const left = colX[editing.col];
  const cellWidth = colX[editing.col + 1] - left;
  const width = Math.min(Math.max(cellWidth + 1, textWidth(editing.draft, font) + 20), Math.max(cellWidth + 1, viewportWidth - 20));

  return (
    <>
      <input
        ref={inputRef}
        className={`cell-editor${editing.draft.startsWith('=') ? ' is-formula' : ''}`}
        style={{ left: left - 1, top: editing.row * ROW_HEIGHT - 1, width, height: ROW_HEIGHT + 1 }}
        value={editing.draft}
        spellCheck={false}
        autoComplete="off"
        aria-label="Cell editor"
        onChange={(e) => state.onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onSelect={(e) => state.onSelect(e.currentTarget.selectionStart ?? 0)}
        onFocus={() => useSheet.getState().setEditSource('cell')}
        onKeyDown={state.onKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      />
      <AssistPopup anchor={inputRef.current} state={state} />
    </>
  );
}
