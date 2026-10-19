import { useMemo, useState } from 'react';
import {
  CATEGORY_ORDER,
  ERROR_EXPLANATIONS,
  formatRange,
  fromKey,
  FUNCTION_LIST,
  isError,
  keyToAddress,
  signature,
  toKey,
  type FunctionSpec,
  type RangeBounds,
} from '../engine';
import { useSheet, type SidePanel as PanelId } from '../state/store';
import { displayValue, valueType } from '../ui/display';
import { focusGrid } from './grid/layout';

function goTo(key: number) {
  const p = fromKey(key);
  useSheet.getState().setSelection(p, p, true);
  focusGrid();
}

function selectRange(r: RangeBounds) {
  const s = useSheet.getState();
  s.setSelection({ row: r.top, col: r.left }, { row: r.bottom, col: r.right });
  s.scrollTo({ row: r.top, col: r.left });
  focusGrid();
}

function Inspector() {
  const anchor = useSheet((s) => s.selection.anchor);
  useSheet((s) => s.version);
  useSheet((s) => s.formatVersion);
  const { engine, formats } = useSheet.getState();
  const rec = engine.getCell(anchor.row, anchor.col);
  const key = toKey(anchor.row, anchor.col);
  const precedents = engine.getPrecedents(anchor.row, anchor.col);
  const dependents = engine.getDependents(anchor.row, anchor.col);
  const value = rec?.value ?? null;

  return (
    <div className="panel-body">
      <h3 className="inspector-address">{keyToAddress(key)}</h3>
      <dl className="props">
        <dt>Input</dt>
        <dd>
          <code className="code-block">{rec?.input || '—'}</code>
        </dd>
        <dt>Value</dt>
        <dd>{rec ? displayValue(value, formats.get(key)) || '""' : '—'}</dd>
        <dt>Type</dt>
        <dd>
          {valueType(value)}
          {rec?.formula ? ' (formula)' : ''}
          {rec?.formula?.volatile ? ' · volatile' : ''}
        </dd>
        {isError(value) && (
          <>
            <dt>Error</dt>
            <dd>
              <strong>{value.code}</strong> {value.message}
              <div className="muted">{ERROR_EXPLANATIONS[value.code]}</div>
            </dd>
          </>
        )}
      </dl>

      <h4>Depends on (precedents)</h4>
      {precedents && (precedents.cells.length > 0 || precedents.ranges.length > 0) ? (
        <ul className="chips">
          {precedents.cells.map((k) => (
            <li key={`c${k}`}>
              <button className="chip" onClick={() => goTo(k)}>
                {keyToAddress(k)}
              </button>
            </li>
          ))}
          {precedents.ranges.map((r, i) => (
            <li key={`r${i}`}>
              <button className="chip chip-range" onClick={() => selectRange(r)}>
                {formatRange(r)}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No references.</p>
      )}

      <h4>Used by (dependents)</h4>
      {dependents.length > 0 ? (
        <ul className="chips">
          {dependents.slice(0, 60).map((k) => (
            <li key={k}>
              <button className="chip" onClick={() => goTo(k)}>
                {keyToAddress(k)}
              </button>
            </li>
          ))}
          {dependents.length > 60 && <li className="muted">+{dependents.length - 60} more</li>}
        </ul>
      ) : (
        <p className="muted">No formulas read this cell.</p>
      )}
      <p className="muted small">
        Editing this cell recalculates only its dependents (transitively) — see the status bar for the count.
      </p>
    </div>
  );
}

function insertFunction(spec: FunctionSpec) {
  const s = useSheet.getState();
  const ed = s.editing;
  if (ed && ed.draft.startsWith('=')) {
    const text = `${spec.name}(`;
    s.setDraft(ed.draft.slice(0, ed.caret) + text + ed.draft.slice(ed.caret), ed.caret + text.length);
  } else {
    if (ed) s.cancelEdit();
    s.startEdit({ draft: `=${spec.name}(`, mode: 'edit', source: 'cell' });
  }
}

function Functions() {
  const [query, setQuery] = useState('');
  const q = query.trim().toUpperCase();
  const groups = useMemo(() => {
    const matches = FUNCTION_LIST.filter(
      (f) => !q || f.name.includes(q) || f.description.toUpperCase().includes(q) || f.category.toUpperCase() === q,
    );
    return CATEGORY_ORDER.map((cat) => [cat, matches.filter((f) => f.category === cat)] as const).filter(([, fs]) => fs.length);
  }, [q]);

  return (
    <div className="panel-body">
      <input
        className="search"
        placeholder={`Search ${FUNCTION_LIST.length} functions…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search functions"
      />
      <p className="muted small">Click a function to insert it into the active cell.</p>
      {groups.map(([cat, fs]) => (
        <section key={cat}>
          <h4>
            {cat} <span className="muted">({fs.length})</span>
          </h4>
          <ul className="fn-list">
            {fs.map((f) => (
              <li key={f.name}>
                <button className="fn-item" onMouseDown={(e) => e.preventDefault()} onClick={() => insertFunction(f)}>
                  <code className="fn-sig">{signature(f)}</code>
                  <span className="fn-desc">{f.description}</span>
                  <code className="fn-example">{f.example}</code>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Errors() {
  useSheet((s) => s.version);
  const { engine } = useSheet.getState();
  const keys = engine.getErrorCells();
  if (keys.length === 0) return <div className="panel-body muted">No errors in the sheet. 🎉</div>;
  return (
    <div className="panel-body">
      <p className="muted small">
        {keys.length} cell{keys.length === 1 ? '' : 's'} with errors. Click one to inspect it.
      </p>
      <ul className="error-list">
        {keys.slice(0, 300).map((k) => {
          const { row, col } = fromKey(k);
          const v = engine.getValue(row, col);
          if (!isError(v)) return null;
          return (
            <li key={k}>
              <button className="error-item" onClick={() => goTo(k)}>
                <span className="error-addr">{keyToAddress(k)}</span>
                <span className="diag-code small">{v.code}</span>
                <span className="error-msg">{v.message}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const TABS: Array<[PanelId, string]> = [
  ['inspector', 'Inspector'],
  ['functions', 'Functions'],
  ['errors', 'Errors'],
];

export function SidePanel() {
  const panel = useSheet((s) => s.panel);
  useSheet((s) => s.version);
  const errorCount = useSheet.getState().engine.stats.errors;
  if (!panel) return null;
  return (
    <aside className="side-panel" aria-label="Side panel">
      <div className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={panel === id} className={`tab${panel === id ? ' active' : ''}`} onClick={() => useSheet.getState().setPanel(id)}>
            {label}
            {id === 'errors' && errorCount > 0 && <span className="badge">{errorCount}</span>}
          </button>
        ))}
        <button className="tab tab-close" title="Close panel" onClick={() => useSheet.getState().setPanel(null)}>
          ×
        </button>
      </div>
      {panel === 'inspector' && <Inspector />}
      {panel === 'functions' && <Functions />}
      {panel === 'errors' && <Errors />}
    </aside>
  );
}
