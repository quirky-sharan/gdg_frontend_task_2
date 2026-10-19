/**
 * Autosaves the sheet to localStorage and restores it on startup.
 * Storage may be unavailable (private mode, quota): every access is guarded.
 */
import { fromKey, MAX_COLS, MAX_ROWS, toKey } from '../engine';
import type { CellFormat } from '../ui/display';
import type { SheetDocument } from './samples';
import { DEFAULT_COL_WIDTH, useSheet } from './store';

const STORAGE_KEY = 'gridline:sheet:v1';

interface Saved {
  cells: Array<[number, string]>;
  formats: Array<[number, CellFormat]>;
  colWidths: Record<number, number>;
}

export function loadSaved(): { doc: SheetDocument; colWidths: Record<number, number> } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    return {
      doc: {
        cells: saved.cells.map(([key, input]) => ({ ...fromKey(key), input })),
        formats: saved.formats.map(([key, f]) => {
          const { row, col } = fromKey(key);
          return [row, col, f] as [number, number, CellFormat];
        }),
      },
      colWidths: saved.colWidths ?? {},
    };
  } catch {
    return null;
  }
}

function save() {
  const { engine, formats, colWidths, notify } = useSheet.getState();
  const cells: Saved['cells'] = [];
  for (const key of engine.keysInRange({ top: 0, left: 0, bottom: MAX_ROWS - 1, right: MAX_COLS - 1 })) {
    const { row, col } = fromKey(key);
    cells.push([toKey(row, col), engine.getInput(row, col)]);
  }
  const widths: Record<number, number> = {};
  colWidths.forEach((w, c) => {
    if (w !== DEFAULT_COL_WIDTH) widths[c] = w;
  });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ cells, formats: [...formats.entries()], colWidths: widths } satisfies Saved));
  } catch {
    notify('The sheet is too large to autosave in this browser; export it as CSV to keep a copy.');
  }
}

export function startAutosave(): () => void {
  let timer = 0;
  return useSheet.subscribe((s, prev) => {
    if (s.version === prev.version && s.formatVersion === prev.formatVersion && s.layoutVersion === prev.layoutVersion) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(save, 800);
  });
}
