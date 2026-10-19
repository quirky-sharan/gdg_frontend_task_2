import { useEffect, useState } from 'react';
import { useSheet } from '../state/store';

const SHORTCUTS: Array<[string, string]> = [
  ['Arrow keys', 'Move the active cell'],
  ['Shift + Arrow', 'Extend the selection'],
  ['Ctrl + Arrow', 'Jump to the edge of the data region'],
  ['Enter / Shift + Enter', 'Commit and move down / up'],
  ['Tab / Shift + Tab', 'Commit and move right / left'],
  ['F2 or double-click', 'Edit the active cell'],
  ['Type anything', 'Replace the cell content'],
  ['Escape', 'Cancel editing'],
  ['Delete / Backspace', 'Clear the selected cells'],
  ['Ctrl + C / X / V', 'Copy / cut / paste (formulas adjust their references)'],
  ['Ctrl + Z / Ctrl + Y', 'Undo / redo'],
  ['Ctrl + B / Ctrl + I', 'Bold / italic'],
  ['Ctrl + A', 'Select all'],
  ['Ctrl + Home / Ctrl + End', 'Go to A1 / last used cell'],
  ['Page Up / Page Down', 'Move one screen'],
  ['F9', 'Recalculate everything'],
  ['Drag the ■ handle', 'Fill down / right (series and formulas)'],
  ['Click a cell while typing a formula', 'Insert its reference (drag for a range)'],
  ['Tab in the suggestion list', 'Insert the highlighted function'],
];

export function ShortcutsDialog() {
  const open = useSheet((s) => s.shortcutsOpen);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useSheet.getState().setShortcutsOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={() => useSheet.getState().setShortcutsOpen(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Keyboard shortcuts</h2>
          <button className="btn btn-icon" aria-label="Close" onClick={() => useSheet.getState().setShortcutsOpen(false)}>
            ×
          </button>
        </div>
        <table className="shortcuts">
          <tbody>
            {SHORTCUTS.map(([keys, what]) => (
              <tr key={keys}>
                <td>
                  <kbd>{keys}</kbd>
                </td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Toast() {
  const notice = useSheet((s) => s.notice);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!notice) return;
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 3500);
    return () => window.clearTimeout(t);
  }, [notice]);
  if (!notice || !visible) return null;
  return (
    <div className="toast" role="status">
      {notice.text}
    </div>
  );
}
