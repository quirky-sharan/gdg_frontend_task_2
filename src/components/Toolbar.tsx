import { useRef, useState, type ReactNode } from 'react';
import { NUMBER_FORMAT_LABELS, toKey, type NumberFormat } from '../engine';
import { toDelimited } from '../state/csv';
import { demoSheet, largeSheet } from '../state/samples';
import { useSheet } from '../state/store';
import type { Align } from '../ui/display';
import { focusGrid } from './grid/layout';

const Icon = {
  undo: (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path d="M9 14 4 9l5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  redo: (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path d="m15 14 5-5-5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  align: (kind: Align) => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      {[5, 10, 15, 20].map((y, i) => {
        const w = i % 2 ? 12 : 18;
        const x = kind === 'left' ? 3 : kind === 'right' ? 21 - w : 12 - w / 2;
        return <line key={y} x1={x} x2={x + w} y1={y} y2={y} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />;
      })}
    </svg>
  ),
};

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      className={`tool${active ? ' active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Toolbar() {
  const canUndo = useSheet((s) => s.undoStack.length > 0);
  const canRedo = useSheet((s) => s.redoStack.length > 0);
  const undoLabel = useSheet((s) => s.undoStack[s.undoStack.length - 1]?.label);
  const redoLabel = useSheet((s) => s.redoStack[s.redoStack.length - 1]?.label);
  const anchor = useSheet((s) => s.selection.anchor);
  useSheet((s) => s.formatVersion);
  const panel = useSheet((s) => s.panel);
  const fmt = useSheet.getState().formats.get(toKey(anchor.row, anchor.col)) ?? {};
  const fileRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const s = () => useSheet.getState();
  const run = (fn: () => void) => () => {
    fn();
    focusGrid();
  };

  const generate = (rows: number) => {
    s().notify(`Generating ${rows.toLocaleString()} rows…`);
    setTimeout(() => {
      s().loadDocument(largeSheet(rows), `Generate ${rows.toLocaleString()} rows`);
      const info = s().lastRecalc;
      if (info) s().notify(`Loaded ${info.updated.toLocaleString()} cells (${info.evaluated.toLocaleString()} formulas) in ${info.ms.toFixed(0)} ms`);
    }, 30);
  };

  const menu: Array<[string, () => void] | null> = [
    ['Load demo sheet', () => s().loadDocument(demoSheet(), 'Load demo')],
    ['Generate 10,000 rows (80k cells)', () => generate(10_000)],
    ['Generate 50,000 rows (400k cells)', () => generate(50_000)],
    null,
    ['Import CSV…', () => fileRef.current?.click()],
    ['Export CSV (values)', () => download('sheet.csv', toDelimited(s().usedRangeValues(), ','), 'text/csv')],
    null,
    ['Recalculate everything (F9)', () => s().recalculateAll()],
    ['Clear sheet', () => s().loadDocument({ cells: [], formats: [] }, 'Clear sheet')],
  ];

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="logo" aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22">
            <rect x="2" y="2" width="20" height="20" rx="5" fill="var(--accent)" />
            <path d="M7 8h10M7 12h10M7 16h6M11 6v12" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
        Gridline
      </div>

      <div className="tool-group">
        <ToolButton label={canUndo ? `Undo ${undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)'} disabled={!canUndo} onClick={run(() => s().undo())}>
          {Icon.undo}
        </ToolButton>
        <ToolButton label={canRedo ? `Redo ${redoLabel} (Ctrl+Y)` : 'Redo (Ctrl+Y)'} disabled={!canRedo} onClick={run(() => s().redo())}>
          {Icon.redo}
        </ToolButton>
      </div>

      <div className="tool-group">
        <ToolButton label="Bold (Ctrl+B)" active={!!fmt.bold} onClick={run(() => s().toggleFormat('bold'))}>
          <strong>B</strong>
        </ToolButton>
        <ToolButton label="Italic (Ctrl+I)" active={!!fmt.italic} onClick={run(() => s().toggleFormat('italic'))}>
          <em className="serif">I</em>
        </ToolButton>
      </div>

      <div className="tool-group">
        {(['left', 'center', 'right'] as const).map((a) => (
          <ToolButton key={a} label={`Align ${a}`} active={fmt.align === a} onClick={run(() => s().applyFormat({ align: fmt.align === a ? undefined : a }))}>
            {Icon.align(a)}
          </ToolButton>
        ))}
      </div>

      <div className="tool-group">
        <select
          className="format-select"
          aria-label="Number format"
          value={fmt.numberFormat ?? 'general'}
          onChange={(e) => {
            s().applyFormat({ numberFormat: e.target.value as NumberFormat });
            focusGrid();
          }}
        >
          {Object.entries(NUMBER_FORMAT_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="tool-group">
        <ToolButton label="Insert function" active={panel === 'functions'} onClick={() => s().setPanel(panel === 'functions' ? 'inspector' : 'functions')}>
          <span className="fx-small">ƒx</span>
        </ToolButton>
      </div>

      <div className="spacer" />

      <div className="menu-wrap">
        <button className="btn" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
          Data ▾
        </button>
        {menuOpen && (
          <>
            <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
            <ul className="menu" role="menu">
              {menu.map((item, i) =>
                item ? (
                  <li key={item[0]} role="menuitem">
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        item[1]();
                        focusGrid();
                      }}
                    >
                      {item[0]}
                    </button>
                  </li>
                ) : (
                  <li key={`sep${i}`} className="menu-sep" role="separator" />
                ),
              )}
            </ul>
          </>
        )}
      </div>
      <button className="btn panel-toggle" onClick={() => s().setPanel(panel ? null : 'inspector')}>
        {panel ? 'Hide panel' : 'Show panel'}
      </button>
      <button className="btn btn-icon" title="Keyboard shortcuts" aria-label="Keyboard shortcuts" onClick={() => s().setShortcutsOpen(true)}>
        ?
      </button>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.tsv,.txt,text/csv"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const text = await file.text();
          s().importDelimited(text, file.name.endsWith('.tsv') ? '\t' : ',', `Import ${file.name}`);
          s().notify(`Imported ${file.name}`);
        }}
      />
    </header>
  );
}
