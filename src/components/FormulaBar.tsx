import { useEffect, useRef, useState } from 'react';
import { formatRange, parseRange } from '../engine';
import { selectionBounds, useSheet } from '../state/store';
import { AssistPopup } from './editor/AssistPopup';
import { useFormulaInput } from './editor/useFormulaInput';
import { focusGrid } from './grid/layout';

function NameBox() {
  const selection = useSheet((s) => s.selection);
  const label = formatRange(selectionBounds(selection));
  const [text, setText] = useState(label);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setText(label), [label]);

  const go = () => {
    const r = parseRange(text);
    if (!r) {
      setInvalid(true);
      useSheet.getState().notify(`"${text}" is not a valid cell or range (try B12 or A1:C20).`);
      return;
    }
    setInvalid(false);
    const s = useSheet.getState();
    s.setSelection({ row: r.top, col: r.left }, { row: r.bottom, col: r.right });
    s.scrollTo({ row: r.top, col: r.left });
    focusGrid();
  };

  return (
    <input
      className={`name-box${invalid ? ' invalid' : ''}`}
      value={text}
      aria-label="Name box: type a cell or range and press Enter"
      title="Go to a cell or range (e.g. B12, A1:C20)"
      spellCheck={false}
      onChange={(e) => {
        setText(e.target.value);
        setInvalid(false);
      }}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') go();
        if (e.key === 'Escape') {
          setText(label);
          focusGrid();
        }
      }}
    />
  );
}

export function FormulaBar() {
  const inputRef = useRef<HTMLInputElement>(null);
  const state = useFormulaInput('bar', inputRef);
  const { editing } = state;
  const anchor = useSheet((s) => s.selection.anchor);
  useSheet((s) => s.version);
  const input = useSheet.getState().engine.getInput(anchor.row, anchor.col);
  const value = editing ? editing.draft : input;

  return (
    <div className="formula-bar">
      <NameBox />
      <span className="fx" aria-hidden>
        ƒx
      </span>
      <input
        ref={inputRef}
        className={`formula-input${value.startsWith('=') ? ' is-formula' : ''}`}
        value={value}
        placeholder="Type a value or a formula such as =SUM(A1:A10)"
        aria-label="Formula bar"
        spellCheck={false}
        autoComplete="off"
        onFocus={() => {
          const s = useSheet.getState();
          if (s.editing) s.setEditSource('bar');
          else s.startEdit({ mode: 'edit', source: 'bar' });
        }}
        onChange={(e) => state.onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onSelect={(e) => state.onSelect(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={state.onKeyDown}
      />
      <AssistPopup anchor={inputRef.current} state={state} />
    </div>
  );
}
