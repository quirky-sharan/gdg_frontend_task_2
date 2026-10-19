/**
 * Application state (Zustand).
 *
 * The formula engine is a mutable object held by the store; React components
 * subscribe to cheap counters (`version`, `formatVersion`, `layoutVersion`)
 * that are bumped whenever the engine, formats or column layout change.
 *
 * Every user edit goes through `applyChanges`, which records a reversible
 * transaction (cell input + format, before and after) for undo/redo.
 */
import { create } from 'zustand';
import {
  computeFill,
  formatAddress,
  fromKey,
  MAX_COLS,
  MAX_ROWS,
  normalizeRange,
  shiftFormula,
  SpreadsheetEngine,
  toKey,
  type CellInput,
  type RangeBounds,
  type RecalcResult,
} from '../engine';
import { displayValue, type CellFormat } from '../ui/display';
import { parseDelimited, toDelimited } from './csv';
import type { SheetDocument } from './samples';

export const ROW_HEIGHT = 24;
export const HEADER_HEIGHT = 26;
export const ROW_HEADER_WIDTH = 60;
export const DEFAULT_COL_WIDTH = 100;
export const MIN_COL_WIDTH = 32;
const MAX_UNDO = 200;

export interface Pos {
  row: number;
  col: number;
}

/** `anchor` is the active cell; `focus` is the opposite corner of the selected range. */
export interface Selection {
  anchor: Pos;
  focus: Pos;
}

export interface EditState {
  row: number;
  col: number;
  draft: string;
  caret: number;
  /** "enter": started by typing (arrows commit); "edit": F2 / double-click / formula bar. */
  mode: 'enter' | 'edit';
  source: 'cell' | 'bar';
  /** Span of a reference inserted by clicking a cell, replaced by the next click. */
  pointRef: { start: number; end: number } | null;
}

interface Snapshot {
  input: string;
  format?: CellFormat;
}

export interface CellChange {
  row: number;
  col: number;
  /** New input; undefined keeps the current one. */
  input?: string;
  /** New format; undefined keeps it, null clears it. */
  format?: CellFormat | null;
}

interface Transaction {
  label: string;
  changes: Array<{ key: number; before: Snapshot; after: Snapshot }>;
  selBefore: Selection;
  selAfter: Selection;
}

export interface RecalcInfo {
  label: string;
  updated: number;
  evaluated: number;
  cycles: number;
  ms: number;
}

interface Clipboard {
  bounds: RangeBounds;
  snaps: Snapshot[][];
  text: string;
  cut: boolean;
}

export type SidePanel = 'inspector' | 'functions' | 'errors';

export interface SheetState {
  engine: SpreadsheetEngine;
  version: number;
  formats: Map<number, CellFormat>;
  formatVersion: number;
  colWidths: number[];
  layoutVersion: number;
  selection: Selection;
  editing: EditState | null;
  undoStack: Transaction[];
  redoStack: Transaction[];
  lastRecalc: RecalcInfo | null;
  panel: SidePanel | null;
  fillPreview: RangeBounds | null;
  clipboard: Clipboard | null;
  scrollTarget: { pos: Pos; tick: number } | null;
  notice: { text: string; tick: number } | null;
  shortcutsOpen: boolean;

  select(pos: Pos, extend?: boolean): void;
  setSelection(anchor: Pos, focus: Pos, scroll?: boolean): void;
  move(dRow: number, dCol: number, extend?: boolean): void;
  jump(dRow: number, dCol: number, extend?: boolean): void;
  scrollTo(pos: Pos): void;

  startEdit(opts: { draft?: string; mode: EditState['mode']; source: EditState['source'] }): void;
  setDraft(draft: string, caret: number): void;
  setCaret(caret: number): void;
  setEditSource(source: EditState['source']): void;
  insertReference(bounds: RangeBounds): void;
  commitEdit(move?: 'down' | 'up' | 'right' | 'left' | 'none'): void;
  cancelEdit(): void;

  applyChanges(changes: CellChange[], label: string, selAfter?: Selection): void;
  setCellInput(row: number, col: number, input: string): void;
  clearSelection(): void;
  applyFormat(patch: Partial<CellFormat>): void;
  toggleFormat(flag: 'bold' | 'italic'): void;
  undo(): void;
  redo(): void;

  copy(cut: boolean): string;
  paste(text: string): void;
  clearClipboard(): void;
  setFillPreview(range: RangeBounds | null): void;
  fill(target: RangeBounds): void;

  setColWidth(col: number, width: number): void;
  setPanel(panel: SidePanel | null): void;
  setShortcutsOpen(open: boolean): void;
  notify(text: string): void;

  loadDocument(doc: SheetDocument, label: string): void;
  loadInitial(doc: SheetDocument, colWidths?: Record<number, number>): void;
  recalculateAll(): void;
  usedRangeValues(): string[][];
  importDelimited(text: string, delimiter: string, label: string): void;
}

export function selectionBounds(sel: Selection): RangeBounds {
  return normalizeRange(sel.anchor.row, sel.anchor.col, sel.focus.row, sel.focus.col);
}

const clampPos = (p: Pos): Pos => ({
  row: Math.max(0, Math.min(MAX_ROWS - 1, p.row)),
  col: Math.max(0, Math.min(MAX_COLS - 1, p.col)),
});

const sameFormat = (a?: CellFormat, b?: CellFormat) =>
  a === b ||
  (!!a && !!b && a.bold === b.bold && a.italic === b.italic && a.align === b.align && a.numberFormat === b.numberFormat);

function cleanFormat(f: CellFormat): CellFormat | undefined {
  const out: CellFormat = {};
  if (f.bold) out.bold = true;
  if (f.italic) out.italic = true;
  if (f.align) out.align = f.align;
  if (f.numberFormat && f.numberFormat !== 'general') out.numberFormat = f.numberFormat;
  return Object.keys(out).length ? out : undefined;
}

/** Ctrl+Arrow target: the edge of the current data block, or the next non-empty cell. */
function findEdge(engine: SpreadsheetEngine, from: Pos, dRow: number, dCol: number): Pos {
  const inBounds = (r: number, c: number) => r >= 0 && r < MAX_ROWS && c >= 0 && c < MAX_COLS;
  const filled = (r: number, c: number) => engine.getCell(r, c) !== undefined;
  const { maxRow, maxCol } = engine.usedBounds();
  let r = from.row;
  let c = from.col;
  if (!inBounds(r + dRow, c + dCol)) return from;
  if (filled(r, c) && filled(r + dRow, c + dCol)) {
    while (inBounds(r + dRow, c + dCol) && filled(r + dRow, c + dCol)) {
      r += dRow;
      c += dCol;
    }
    return { row: r, col: c };
  }
  r += dRow;
  c += dCol;
  while (!filled(r, c) && inBounds(r + dRow, c + dCol)) {
    if ((dRow > 0 && r > maxRow) || (dCol > 0 && c > maxCol)) {
      return { row: dRow > 0 ? MAX_ROWS - 1 : r, col: dCol > 0 ? MAX_COLS - 1 : c };
    }
    r += dRow;
    c += dCol;
  }
  return { row: r, col: c };
}

function recalcInfo(label: string, r: RecalcResult): RecalcInfo {
  return { label, updated: r.updated.length, evaluated: r.evaluated, cycles: r.cycles.length, ms: r.durationMs };
}

export const useSheet = create<SheetState>()((set, get) => {
  /** Writes one side of a transaction into the engine and format map. */
  function applySnapshots(changes: Transaction['changes'], side: 'before' | 'after', label: string) {
    const { engine, formats } = get();
    const inputs: CellInput[] = [];
    let formatsChanged = false;
    for (const ch of changes) {
      const snap = ch[side];
      const { row, col } = fromKey(ch.key);
      if (engine.getInput(row, col) !== snap.input) inputs.push({ row, col, input: snap.input });
      if (!sameFormat(formats.get(ch.key), snap.format)) {
        if (snap.format) formats.set(ch.key, snap.format);
        else formats.delete(ch.key);
        formatsChanged = true;
      }
    }
    const result = inputs.length ? engine.setCells(inputs) : null;
    set((s) => ({
      version: result ? s.version + 1 : s.version,
      formatVersion: formatsChanged ? s.formatVersion + 1 : s.formatVersion,
      lastRecalc: result ? recalcInfo(label, result) : s.lastRecalc,
    }));
  }

  function clampedSelection(): RangeBounds {
    const { engine, selection } = get();
    const b = selectionBounds(selection);
    const { maxRow, maxCol } = engine.usedBounds();
    return {
      top: b.top,
      left: b.left,
      bottom: Math.max(b.top, Math.min(b.bottom, Math.max(maxRow, selection.anchor.row))),
      right: Math.max(b.left, Math.min(b.right, Math.max(maxCol, selection.anchor.col))),
    };
  }

  return {
    engine: new SpreadsheetEngine(),
    version: 0,
    formats: new Map(),
    formatVersion: 0,
    colWidths: new Array(MAX_COLS).fill(DEFAULT_COL_WIDTH),
    layoutVersion: 0,
    selection: { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
    editing: null,
    undoStack: [],
    redoStack: [],
    lastRecalc: null,
    panel: 'inspector',
    fillPreview: null,
    clipboard: null,
    scrollTarget: null,
    notice: null,
    shortcutsOpen: false,

    // ---------------------------------------------------------------- selection

    select(pos, extend = false) {
      const p = clampPos(pos);
      set((s) => ({ selection: extend ? { anchor: s.selection.anchor, focus: p } : { anchor: p, focus: p } }));
    },

    setSelection(anchor, focus, scroll = false) {
      set({ selection: { anchor: clampPos(anchor), focus: clampPos(focus) } });
      if (scroll) get().scrollTo(focus);
    },

    move(dRow, dCol, extend = false) {
      const { selection } = get();
      const base = extend ? selection.focus : selection.anchor;
      const next = clampPos({ row: base.row + dRow, col: base.col + dCol });
      set({ selection: extend ? { anchor: selection.anchor, focus: next } : { anchor: next, focus: next } });
      get().scrollTo(next);
    },

    jump(dRow, dCol, extend = false) {
      const { selection, engine } = get();
      const base = extend ? selection.focus : selection.anchor;
      const next = findEdge(engine, base, dRow, dCol);
      set({ selection: extend ? { anchor: selection.anchor, focus: next } : { anchor: next, focus: next } });
      get().scrollTo(next);
    },

    scrollTo(pos) {
      set((s) => ({ scrollTarget: { pos, tick: (s.scrollTarget?.tick ?? 0) + 1 } }));
    },

    // ---------------------------------------------------------------- editing

    startEdit({ draft, mode, source }) {
      const { selection, engine, editing } = get();
      if (editing) {
        set({ editing: { ...editing, source } });
        return;
      }
      const { row, col } = selection.anchor;
      const text = draft ?? engine.getInput(row, col);
      set({ editing: { row, col, draft: text, caret: text.length, mode, source, pointRef: null } });
    },

    setDraft(draft, caret) {
      const e = get().editing;
      if (e) set({ editing: { ...e, draft, caret, pointRef: null } });
    },

    setCaret(caret) {
      const e = get().editing;
      if (e && e.caret !== caret) set({ editing: { ...e, caret, pointRef: e.pointRef && e.pointRef.end === caret ? e.pointRef : null } });
    },

    setEditSource(source) {
      const e = get().editing;
      if (e && e.source !== source) set({ editing: { ...e, source } });
    },

    insertReference(bounds) {
      const e = get().editing;
      if (!e) return;
      const single = bounds.top === bounds.bottom && bounds.left === bounds.right;
      const text = single
        ? formatAddress(bounds.top, bounds.left)
        : `${formatAddress(bounds.top, bounds.left)}:${formatAddress(bounds.bottom, bounds.right)}`;
      const reuse = e.pointRef && e.pointRef.end === e.caret;
      const start = reuse ? e.pointRef!.start : e.caret;
      const end = reuse ? e.pointRef!.end : e.caret;
      const draft = e.draft.slice(0, start) + text + e.draft.slice(end);
      set({ editing: { ...e, draft, caret: start + text.length, pointRef: { start, end: start + text.length } } });
    },

    commitEdit(move = 'none') {
      const { editing, engine } = get();
      if (!editing) return;
      set({ editing: null });
      const { row, col, draft } = editing;
      if (draft !== engine.getInput(row, col)) {
        get().applyChanges([{ row, col, input: draft }], `Edit ${formatAddress(row, col)}`);
      }
      const step = { down: [1, 0], up: [-1, 0], right: [0, 1], left: [0, -1], none: null }[move];
      if (step) get().move(step[0], step[1]);
    },

    cancelEdit() {
      set({ editing: null });
    },

    // ---------------------------------------------------------------- changes & history

    applyChanges(changes, label, selAfter) {
      const { engine, formats, selection } = get();
      const tx: Transaction = { label, changes: [], selBefore: selection, selAfter: selAfter ?? selection };
      const seen = new Map<number, number>();
      for (const ch of changes) {
        if (ch.row < 0 || ch.col < 0 || ch.row >= MAX_ROWS || ch.col >= MAX_COLS) continue;
        const key = toKey(ch.row, ch.col);
        const beforeInput = engine.getInput(ch.row, ch.col);
        const beforeFormat = formats.get(key);
        const afterInput = ch.input ?? beforeInput;
        const afterFormat = ch.format === undefined ? beforeFormat : ch.format === null ? undefined : cleanFormat(ch.format);
        const entry = { key, before: { input: beforeInput, format: beforeFormat }, after: { input: afterInput, format: afterFormat } };
        const prev = seen.get(key);
        if (prev !== undefined) {
          // Later changes to the same cell win, but keep the original "before".
          tx.changes[prev].after = entry.after;
          continue;
        }
        if (afterInput === beforeInput && sameFormat(afterFormat, beforeFormat)) continue;
        seen.set(key, tx.changes.length);
        tx.changes.push(entry);
      }
      if (selAfter) set({ selection: selAfter });
      if (tx.changes.length === 0) return;
      applySnapshots(tx.changes, 'after', label);
      set((s) => ({ undoStack: [...s.undoStack, tx].slice(-MAX_UNDO), redoStack: [] }));
    },

    setCellInput(row, col, input) {
      get().applyChanges([{ row, col, input }], `Edit ${formatAddress(row, col)}`);
    },

    clearSelection() {
      const { engine, selection } = get();
      const keys = engine.keysInRange(selectionBounds(selection));
      if (keys.length === 0) return;
      get().applyChanges(
        keys.map((k) => ({ ...fromKey(k), input: '' })),
        'Clear cells',
      );
    },

    applyFormat(patch) {
      const { formats } = get();
      const b = clampedSelection();
      const changes: CellChange[] = [];
      for (let r = b.top; r <= b.bottom; r++) {
        for (let c = b.left; c <= b.right; c++) {
          changes.push({ row: r, col: c, format: { ...formats.get(toKey(r, c)), ...patch } });
        }
      }
      get().applyChanges(changes, 'Format cells');
    },

    toggleFormat(flag) {
      const { formats, selection } = get();
      const current = formats.get(toKey(selection.anchor.row, selection.anchor.col))?.[flag] ?? false;
      get().applyFormat({ [flag]: !current });
    },

    undo() {
      const { undoStack, editing } = get();
      if (editing) set({ editing: null });
      const tx = undoStack[undoStack.length - 1];
      if (!tx) return;
      applySnapshots(tx.changes, 'before', `Undo: ${tx.label}`);
      set((s) => ({ undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, tx], selection: tx.selBefore }));
      get().scrollTo(tx.selBefore.anchor);
    },

    redo() {
      const { redoStack, editing } = get();
      if (editing) set({ editing: null });
      const tx = redoStack[redoStack.length - 1];
      if (!tx) return;
      applySnapshots(tx.changes, 'after', `Redo: ${tx.label}`);
      set((s) => ({ redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, tx], selection: tx.selAfter }));
      get().scrollTo(tx.selAfter.anchor);
    },

    // ---------------------------------------------------------------- clipboard & fill

    copy(cut) {
      const { engine, formats } = get();
      const b = clampedSelection();
      const text: string[][] = [];
      const snaps: Snapshot[][] = [];
      for (let r = b.top; r <= b.bottom; r++) {
        const textRow: string[] = [];
        const snapRow: Snapshot[] = [];
        for (let c = b.left; c <= b.right; c++) {
          const key = toKey(r, c);
          const fmt = formats.get(key);
          textRow.push(displayValue(engine.getValue(r, c), fmt));
          snapRow.push({ input: engine.getInput(r, c), format: fmt });
        }
        text.push(textRow);
        snaps.push(snapRow);
      }
      const tsv = toDelimited(text, '\t');
      set({ clipboard: { bounds: b, snaps, text: tsv, cut } });
      return tsv;
    },

    paste(text) {
      const { selection, clipboard } = get();
      const target = selectionBounds(selection);
      const at = { row: target.top, col: target.left };
      const changes: CellChange[] = [];
      const norm = (s: string) => s.replace(/\r\n/g, '\n').replace(/\n$/, '');
      let height = 1;
      let width = 1;
      if (clipboard && norm(text) === norm(clipboard.text)) {
        const dRow = at.row - clipboard.bounds.top;
        const dCol = at.col - clipboard.bounds.left;
        height = clipboard.snaps.length;
        width = clipboard.snaps[0]?.length ?? 1;
        if (clipboard.cut) {
          for (let r = clipboard.bounds.top; r <= clipboard.bounds.bottom; r++) {
            for (let c = clipboard.bounds.left; c <= clipboard.bounds.right; c++) changes.push({ row: r, col: c, input: '', format: null });
          }
        }
        clipboard.snaps.forEach((row, i) =>
          row.forEach((snap, j) =>
            changes.push({
              row: at.row + i,
              col: at.col + j,
              input: clipboard.cut ? snap.input : shiftFormula(snap.input, dRow, dCol),
              format: snap.format ?? null,
            }),
          ),
        );
        if (clipboard.cut) set({ clipboard: null });
      } else {
        const rows = parseDelimited(norm(text), '\t');
        height = rows.length;
        rows.forEach((row, i) => {
          width = Math.max(width, row.length);
          row.forEach((v, j) => changes.push({ row: at.row + i, col: at.col + j, input: v }));
        });
      }
      const focus = clampPos({ row: at.row + height - 1, col: at.col + width - 1 });
      get().applyChanges(changes, 'Paste', { anchor: at, focus });
    },

    clearClipboard() {
      if (get().clipboard) set({ clipboard: null });
    },

    setFillPreview(range) {
      set({ fillPreview: range });
    },

    fill(target) {
      const { engine, formats, selection } = get();
      const source = selectionBounds(selection);
      const inputs = computeFill((r, c) => engine.getInput(r, c), source, target);
      const h = source.bottom - source.top + 1;
      const w = source.right - source.left + 1;
      const changes: CellChange[] = inputs.map((ch) => {
        const sr = source.top + ((((ch.row - source.top) % h) + h) % h);
        const sc = source.left + ((((ch.col - source.left) % w) + w) % w);
        return { ...ch, format: formats.get(toKey(sr, sc)) ?? null };
      });
      // Select the whole filled block, keeping the active cell when it is a corner of it.
      const isCorner = (p: Pos) =>
        (p.row === target.top || p.row === target.bottom) && (p.col === target.left || p.col === target.right);
      const anchor = isCorner(selection.anchor) ? selection.anchor : { row: target.top, col: target.left };
      const focus = {
        row: anchor.row === target.top ? target.bottom : target.top,
        col: anchor.col === target.left ? target.right : target.left,
      };
      set({ fillPreview: null });
      get().applyChanges(changes, 'Fill', { anchor, focus });
    },

    // ---------------------------------------------------------------- layout & misc

    setColWidth(col, width) {
      set((s) => {
        const colWidths = s.colWidths.slice();
        colWidths[col] = Math.max(MIN_COL_WIDTH, Math.round(width));
        return { colWidths, layoutVersion: s.layoutVersion + 1 };
      });
    },

    setPanel(panel) {
      set({ panel });
    },

    setShortcutsOpen(open) {
      set({ shortcutsOpen: open });
    },

    notify(text) {
      set((s) => ({ notice: { text, tick: (s.notice?.tick ?? 0) + 1 } }));
    },

    // ---------------------------------------------------------------- documents

    loadDocument(doc, label) {
      const { engine, formats } = get();
      set({ editing: null, clipboard: null });
      const changes = new Map<number, CellChange>();
      for (const key of engine.keysInRange({ top: 0, left: 0, bottom: MAX_ROWS - 1, right: MAX_COLS - 1 })) {
        changes.set(key, { ...fromKey(key), input: '', format: null });
      }
      for (const key of formats.keys()) changes.set(key, { ...fromKey(key), input: changes.get(key)?.input, format: null });
      for (const c of doc.cells) changes.set(toKey(c.row, c.col), { row: c.row, col: c.col, input: c.input, format: null });
      for (const [row, col, format] of doc.formats) {
        const key = toKey(row, col);
        changes.set(key, { ...(changes.get(key) ?? { row, col }), format });
      }
      const origin = { row: 0, col: 0 };
      get().applyChanges([...changes.values()], label, { anchor: origin, focus: origin });
      get().scrollTo(origin);
    },

    loadInitial(doc, colWidths) {
      const { engine, formats } = get();
      formats.clear();
      for (const [row, col, format] of doc.formats) {
        const f = cleanFormat(format);
        if (f) formats.set(toKey(row, col), f);
      }
      const result = engine.load(doc.cells);
      const widths = new Array(MAX_COLS).fill(DEFAULT_COL_WIDTH);
      if (colWidths) for (const [c, w] of Object.entries(colWidths)) widths[Number(c)] = w;
      set((s) => ({
        version: s.version + 1,
        formatVersion: s.formatVersion + 1,
        colWidths: widths,
        layoutVersion: s.layoutVersion + 1,
        lastRecalc: recalcInfo('Load', result),
        undoStack: [],
        redoStack: [],
      }));
    },

    recalculateAll() {
      const result = get().engine.recalculateAll();
      set((s) => ({ version: s.version + 1, lastRecalc: recalcInfo('Recalculate all', result) }));
    },

    usedRangeValues() {
      const { engine, formats } = get();
      const { maxRow, maxCol } = engine.usedBounds();
      const rows: string[][] = [];
      for (let r = 0; r <= maxRow; r++) {
        const row: string[] = [];
        for (let c = 0; c <= maxCol; c++) row.push(displayValue(engine.getValue(r, c), formats.get(toKey(r, c))));
        rows.push(row);
      }
      return rows;
    },

    importDelimited(text, delimiter, label) {
      const rows = parseDelimited(text, delimiter);
      const cells: CellInput[] = [];
      rows.forEach((row, r) => row.forEach((input, c) => {
        if (input !== '' && r < MAX_ROWS && c < MAX_COLS) cells.push({ row: r, col: c, input });
      }));
      get().loadDocument({ cells, formats: [] }, label);
    },
  };
});
