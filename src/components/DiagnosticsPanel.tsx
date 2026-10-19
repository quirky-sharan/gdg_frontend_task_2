import { useEffect, useLayoutEffect, useState } from 'react';
import { caretLine, compileFormula, ERROR_EXPLANATIONS, formatDiagnostic, fromKey, isError, keyToAddress, toKey, type SheetError } from '../engine';
import { useSheet } from '../state/store';
import { focusGrid } from './grid/layout';

interface Diagnostic {
  formula: string;
  error: SheetError;
  live: boolean;
}

/** Live syntax check of the formula being typed (debounced so it doesn't flicker). */
function useLiveDiagnostic(): Diagnostic | null {
  const draft = useSheet((s) => s.editing?.draft);
  const [diag, setDiag] = useState<Diagnostic | null>(null);
  useEffect(() => {
    if (draft === undefined || !draft.startsWith('=') || draft.length < 2) {
      setDiag(null);
      return;
    }
    const t = window.setTimeout(() => {
      const r = compileFormula(draft);
      const caret = useSheet.getState().editing?.caret;
      // A name still being typed at the caret is handled by autocomplete, not reported as an error.
      const typingName = !r.ok && r.error.code === '#NAME?' && r.error.end === caret;
      setDiag(r.ok || typingName ? null : { formula: draft, error: r.error, live: true });
    }, 350);
    return () => window.clearTimeout(t);
  }, [draft]);
  return draft === undefined ? null : diag;
}

/**
 * Explains the error in the active cell (or in the formula being typed): message,
 * a caret under the offending part of the formula, a suggestion and — when one
 * can be derived — a one-click fix.
 */
export function DiagnosticsPanel() {
  const anchor = useSheet((s) => s.selection.anchor);
  const editing = useSheet((s) => s.editing);
  useSheet((s) => s.version);
  const live = useLiveDiagnostic();
  const [collapsed, setCollapsed] = useState(false);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom');

  const rec = useSheet.getState().engine.getCell(anchor.row, anchor.col);
  let diag: Diagnostic | null = null;
  if (editing) diag = live;
  else if (rec && isError(rec.value)) diag = { formula: rec.input, error: rec.value, live: false };

  // Float the card on the half of the grid that doesn't contain the active cell.
  useLayoutEffect(() => {
    const area = document.querySelector('.grid-area')?.getBoundingClientRect();
    const cell = document.querySelector('.sel-active')?.getBoundingClientRect();
    if (!area || !cell) return;
    setPlacement(cell.top - area.top > area.height * 0.5 ? 'top' : 'bottom');
  }, [anchor.row, anchor.col, diag?.error]);

  if (!diag) return null;

  const { error, formula } = diag;
  const activeKey = toKey(anchor.row, anchor.col);
  const source = error.sourceKey !== undefined && error.sourceKey !== activeKey ? error.sourceKey : undefined;

  const applyFix = () => {
    const s = useSheet.getState();
    if (!error.fix) return;
    if (s.editing) {
      s.setDraft(error.fix, error.fix.length);
    } else {
      s.setCellInput(anchor.row, anchor.col, error.fix);
      focusGrid();
    }
  };

  const goToSource = () => {
    if (source === undefined) return;
    const p = fromKey(source);
    const s = useSheet.getState();
    s.setSelection(p, p, true);
    focusGrid();
  };

  if (collapsed) {
    return (
      <button className={`diagnostics-pill ${placement}${diag.live ? ' live' : ''}`} onClick={() => setCollapsed(false)} title="Show error details">
        <span className="diag-code small">{error.code}</span> {error.message.length > 70 ? error.message.slice(0, 70) + '…' : error.message}
      </button>
    );
  }

  return (
    <section className={`diagnostics ${placement}${diag.live ? ' live' : ''}`} aria-live="polite" aria-label="Error diagnostics">
      <div className="diag-head">
        <span className="diag-code">{error.code}</span>
        <span className="diag-title">
          {diag.live ? 'Formula problem' : `Error in ${keyToAddress(activeKey)}`}
          <span className="diag-explain"> — {ERROR_EXPLANATIONS[error.code]}</span>
        </span>
        <span className="diag-actions">
          {error.fix && (
            <button className="btn btn-primary" onMouseDown={(e) => e.preventDefault()} onClick={applyFix} title={error.fix}>
              Apply fix: <code>{error.fix.length > 40 ? error.fix.slice(0, 40) + '…' : error.fix}</code>
            </button>
          )}
          {source !== undefined && (
            <button className="btn" onClick={goToSource}>
              Go to source ({keyToAddress(source)})
            </button>
          )}
          <button className="btn btn-icon" title="Collapse" aria-label="Collapse diagnostics" onMouseDown={(e) => e.preventDefault()} onClick={() => setCollapsed(true)}>
            –
          </button>
        </span>
      </div>
      <div className="diag-body" title={formatDiagnostic(formula, error)}>
        <div>
          Formula: <span className="diag-formula">{formula}</span>
        </div>
        <div className="diag-gap">Error: {error.message}</div>
        {formula.startsWith('=') && error.start !== undefined && (
          <pre className="diag-caret">{`${formula}
${caretLine(error.start, error.end ?? error.start + 1)}`}</pre>
        )}
        {error.suggestion && <div className="diag-gap">Suggestion: {error.suggestion}</div>}
      </div>
    </section>
  );
}
