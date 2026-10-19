import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { colToLetters, MAX_COLS, MAX_ROWS, normalizeRange, type RangeBounds } from '../../engine';
import {
  HEADER_HEIGHT,
  ROW_HEADER_WIDTH,
  ROW_HEIGHT,
  selectionBounds,
  useSheet,
  type Pos,
} from '../../state/store';
import { acceptsReference } from '../../ui/formulaAssist';
import { CellEditor } from './CellEditor';
import { GridCells } from './GridCells';
import { columnAt, columnOffsets, focusGrid, registerGridElement, type VisibleWindow } from './layout';
import { SelectionLayer } from './SelectionLayer';

const OVERSCAN_ROWS = 6;
const OVERSCAN_COLS = 2;

type Region = 'corner' | 'colHeader' | 'rowHeader' | 'cell' | 'outside';
type DragMode = 'cells' | 'cols' | 'rows' | 'point' | 'fill';

interface Hit extends Pos {
  region: Region;
}

/**
 * The virtualized grid. A single native scroll container holds a sizer as large
 * as the whole sheet (100,000 × 702 cells); only the rows and columns inside the
 * viewport (plus a small overscan) are rendered. Headers are sticky, so they
 * scroll natively with the content without any JS synchronisation.
 */
export function Grid() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const sinkRef = useRef<HTMLTextAreaElement>(null);
  /** Fallback timer for Ctrl+V when the browser doesn't deliver a native paste event. */
  const pendingPaste = useRef(0);
  const colWidths = useSheet((s) => s.colWidths);
  const colX = useMemo(() => columnOffsets(colWidths), [colWidths]);
  const totalWidth = colX[MAX_COLS];
  const totalHeight = MAX_ROWS * ROW_HEIGHT;
  const [win, setWin] = useState<VisibleWindow>({ r0: 0, r1: 40, c0: 0, c1: 12 });
  const [viewportWidth, setViewportWidth] = useState(800);

  const updateWindow = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const top = vp.scrollTop;
    const left = vp.scrollLeft;
    const h = vp.clientHeight - HEADER_HEIGHT;
    const w = vp.clientWidth - ROW_HEADER_WIDTH;
    const next = {
      r0: Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN_ROWS),
      r1: Math.min(MAX_ROWS - 1, Math.floor((top + h) / ROW_HEIGHT) + OVERSCAN_ROWS),
      c0: Math.max(0, columnAt(colX, left) - OVERSCAN_COLS),
      c1: Math.min(MAX_COLS - 1, columnAt(colX, left + w) + OVERSCAN_COLS),
    };
    setWin((prev) =>
      prev.r0 === next.r0 && prev.r1 === next.r1 && prev.c0 === next.c0 && prev.c1 === next.c1 ? prev : next,
    );
    setViewportWidth(vp.clientWidth - ROW_HEADER_WIDTH);
  }, [colX]);

  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    registerGridElement(sinkRef.current);
    updateWindow();
    const ro = new ResizeObserver(updateWindow);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [updateWindow]);

  // Keep the cell targeted by keyboard navigation visible.
  const scrollTarget = useSheet((s) => s.scrollTarget);
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || !scrollTarget) return;
    const { row, col } = scrollTarget.pos;
    const viewH = vp.clientHeight - HEADER_HEIGHT;
    const viewW = vp.clientWidth - ROW_HEADER_WIDTH;
    const cellTop = row * ROW_HEIGHT;
    if (cellTop < vp.scrollTop) vp.scrollTop = cellTop;
    else if (cellTop + ROW_HEIGHT > vp.scrollTop + viewH) vp.scrollTop = cellTop + ROW_HEIGHT - viewH;
    const cellLeft = colX[col];
    const cellRight = colX[col + 1];
    if (cellLeft < vp.scrollLeft) vp.scrollLeft = cellLeft;
    else if (cellRight > vp.scrollLeft + viewW) vp.scrollLeft = Math.min(cellLeft, cellRight - viewW);
  }, [scrollTarget, colX]);

  // ------------------------------------------------------------ hit testing

  const hitTest = useCallback(
    (clientX: number, clientY: number): Hit => {
      const vp = viewportRef.current!;
      const rect = vp.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const gx = x - ROW_HEADER_WIDTH + vp.scrollLeft;
      const gy = y - HEADER_HEIGHT + vp.scrollTop;
      const row = Math.max(0, Math.min(MAX_ROWS - 1, Math.floor(gy / ROW_HEIGHT)));
      const col = Math.max(0, Math.min(MAX_COLS - 1, columnAt(colX, gx)));
      let region: Region;
      if (x < 0 || y < 0 || x >= vp.clientWidth || y >= vp.clientHeight) region = 'outside';
      else if (y < HEADER_HEIGHT && x < ROW_HEADER_WIDTH) region = 'corner';
      else if (y < HEADER_HEIGHT) region = 'colHeader';
      else if (x < ROW_HEADER_WIDTH) region = 'rowHeader';
      else region = 'cell';
      return { region, row, col };
    },
    [colX],
  );

  // ------------------------------------------------------------ dragging

  const startDrag = useCallback(
    (mode: DragMode, origin: Pos, start: { x: number; y: number }, sourceRange?: RangeBounds) => {
      const vp = viewportRef.current!;
      let pointer = start;
      let timer = 0;

      const update = () => {
        const s = useSheet.getState();
        const h = hitTest(pointer.x, pointer.y);
        switch (mode) {
          case 'cells':
            s.select(h, true);
            break;
          case 'cols':
            s.setSelection({ row: 0, col: origin.col }, { row: MAX_ROWS - 1, col: h.col });
            break;
          case 'rows':
            s.setSelection({ row: origin.row, col: 0 }, { row: h.row, col: MAX_COLS - 1 });
            break;
          case 'point':
            s.insertReference(normalizeRange(origin.row, origin.col, h.row, h.col));
            break;
          case 'fill': {
            const src = sourceRange!;
            const below = h.row - src.bottom;
            const above = src.top - h.row;
            const right = h.col - src.right;
            const left = src.left - h.col;
            const v = Math.max(below, above, 0);
            const hz = Math.max(right, left, 0);
            let target: RangeBounds | null = null;
            if (v > 0 && v >= hz) target = below > 0 ? { ...src, bottom: h.row } : { ...src, top: h.row };
            else if (hz > 0) target = right > 0 ? { ...src, right: h.col } : { ...src, left: h.col };
            s.setFillPreview(target);
            break;
          }
        }
      };

      // Auto-scroll while the pointer is held beyond the edges of the grid.
      const tick = () => {
        const rect = vp.getBoundingClientRect();
        let dx = 0;
        let dy = 0;
        if (pointer.y > rect.top + vp.clientHeight - 4) dy = pointer.y - (rect.top + vp.clientHeight - 4);
        else if (pointer.y < rect.top + HEADER_HEIGHT && mode !== 'cols') dy = pointer.y - (rect.top + HEADER_HEIGHT);
        if (pointer.x > rect.left + vp.clientWidth - 4) dx = pointer.x - (rect.left + vp.clientWidth - 4);
        else if (pointer.x < rect.left + ROW_HEADER_WIDTH && mode !== 'rows') dx = pointer.x - (rect.left + ROW_HEADER_WIDTH);
        if (dx || dy) {
          vp.scrollTop += Math.sign(dy) * Math.min(80, Math.abs(dy));
          vp.scrollLeft += Math.sign(dx) * Math.min(80, Math.abs(dx));
          update();
        }
      };

      const onMove = (ev: globalThis.MouseEvent) => {
        pointer = { x: ev.clientX, y: ev.clientY };
        update();
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.clearInterval(timer);
        const s = useSheet.getState();
        if (mode === 'fill') {
          if (s.fillPreview) s.fill(s.fillPreview);
          else s.setFillPreview(null);
        }
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      timer = window.setInterval(tick, 40);
    },
    [hitTest],
  );

  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const h = hitTest(e.clientX, e.clientY);
    if (h.region === 'outside') return; // scrollbar
    const s = useSheet.getState();
    const ed = s.editing;

    if (ed && h.region === 'cell' && ((ed.pointRef && ed.pointRef.end === ed.caret) || acceptsReference(ed.draft, ed.caret))) {
      // Point mode: clicking a cell while typing a formula inserts its reference.
      e.preventDefault();
      s.insertReference({ top: h.row, left: h.col, bottom: h.row, right: h.col });
      startDrag('point', h, { x: e.clientX, y: e.clientY });
      return;
    }
    if (ed) s.commitEdit('none');
    e.preventDefault();
    focusGrid();

    switch (h.region) {
      case 'corner':
        s.setSelection({ row: 0, col: 0 }, { row: MAX_ROWS - 1, col: MAX_COLS - 1 });
        return;
      case 'colHeader': {
        const origin = { row: 0, col: e.shiftKey ? s.selection.anchor.col : h.col };
        s.setSelection(origin, { row: MAX_ROWS - 1, col: h.col });
        startDrag('cols', origin, { x: e.clientX, y: e.clientY });
        return;
      }
      case 'rowHeader': {
        const origin = { row: e.shiftKey ? s.selection.anchor.row : h.row, col: 0 };
        s.setSelection(origin, { row: h.row, col: MAX_COLS - 1 });
        startDrag('rows', origin, { x: e.clientX, y: e.clientY });
        return;
      }
      default:
        s.select(h, e.shiftKey);
        startDrag('cells', h, { x: e.clientX, y: e.clientY });
    }
  };

  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    const h = hitTest(e.clientX, e.clientY);
    if (h.region !== 'cell') return;
    const s = useSheet.getState();
    if (s.editing) return;
    s.select(h);
    s.startEdit({ mode: 'edit', source: 'cell' });
  };

  const onFillHandleDown = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const s = useSheet.getState();
      startDrag('fill', s.selection.anchor, { x: e.clientX, y: e.clientY }, selectionBounds(s.selection));
    },
    [startDrag],
  );

  // ------------------------------------------------------------ keyboard & clipboard

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    const s = useSheet.getState();
    const ctrl = e.ctrlKey || e.metaKey;
    const vp = viewportRef.current!;
    const pageRows = Math.max(1, Math.floor((vp.clientHeight - HEADER_HEIGHT) / ROW_HEIGHT) - 1);
    const arrows: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (arrows[e.key]) {
      e.preventDefault();
      const [dr, dc] = arrows[e.key];
      if (ctrl) s.jump(dr, dc, e.shiftKey);
      else s.move(dr, dc, e.shiftKey);
      return;
    }
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        s.move(e.shiftKey ? -1 : 1, 0);
        return;
      case 'Tab':
        e.preventDefault();
        s.move(0, e.shiftKey ? -1 : 1);
        return;
      case 'F2':
        e.preventDefault();
        s.startEdit({ mode: 'edit', source: 'cell' });
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        s.clearSelection();
        return;
      case 'PageDown':
      case 'PageUp':
        e.preventDefault();
        s.move(e.key === 'PageDown' ? pageRows : -pageRows, 0, e.shiftKey);
        return;
      case 'Home': {
        e.preventDefault();
        const target = ctrl ? { row: 0, col: 0 } : { row: s.selection.anchor.row, col: 0 };
        s.setSelection(target, target, true);
        return;
      }
      case 'End':
        if (ctrl) {
          e.preventDefault();
          const { maxRow, maxCol } = s.engine.usedBounds();
          const target = { row: Math.max(0, maxRow), col: Math.max(0, maxCol) };
          s.setSelection(target, target, true);
        }
        return;
      case 'Escape':
        s.clearClipboard();
        return;
      case 'F9':
        e.preventDefault();
        s.recalculateAll();
        return;
      default:
        break;
    }
    if (ctrl) {
      const k = e.key.toLowerCase();
      if (k === 'c' || k === 'x') {
        // The native copy/cut event (handled below) normally follows; this also covers
        // environments where it doesn't fire, via the async Clipboard API.
        const text = s.copy(k === 'x');
        navigator.clipboard?.writeText(text).catch(() => undefined);
        return;
      }
      if (k === 'v') {
        pendingPaste.current = window.setTimeout(() => {
          pendingPaste.current = 0;
          const internal = useSheet.getState().clipboard;
          const pasteText = (text: string) => text && useSheet.getState().paste(text);
          if (navigator.clipboard?.readText) {
            navigator.clipboard.readText().then(pasteText, () => internal && pasteText(internal.text));
          } else if (internal) {
            pasteText(internal.text);
          }
        }, 80);
        return;
      }
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (k === 'y') {
        e.preventDefault();
        s.redo();
      } else if (k === 'b' || k === 'i') {
        e.preventDefault();
        s.toggleFormat(k === 'b' ? 'bold' : 'italic');
      } else if (k === 'a') {
        e.preventDefault();
        s.setSelection({ row: 0, col: 0 }, { row: MAX_ROWS - 1, col: MAX_COLS - 1 });
      }
    }
    // Printable characters are not handled here: they land in the textarea and arrive via onInput.
  };

  /** Text typed (or composed with an IME) while the grid has focus starts editing the active cell. */
  const onSinkInput = (e: FormEvent<HTMLTextAreaElement>) => {
    const sink = e.currentTarget;
    if ((e.nativeEvent as InputEvent).isComposing) return;
    const text = sink.value;
    sink.value = '';
    if (text) useSheet.getState().startEdit({ draft: text, mode: 'enter', source: 'cell' });
  };

  useEffect(() => {
    const ours = () => document.activeElement === sinkRef.current;
    const onCopy = (e: ClipboardEvent) => {
      if (!ours()) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', useSheet.getState().copy(false));
    };
    const onCut = (e: ClipboardEvent) => {
      if (!ours()) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', useSheet.getState().copy(true));
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!ours()) return;
      window.clearTimeout(pendingPaste.current);
      pendingPaste.current = 0;
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text) useSheet.getState().paste(text);
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  return (
    <div
      ref={viewportRef}
      className="grid-viewport"
      role="grid"
      aria-label="Spreadsheet"
      aria-rowcount={MAX_ROWS}
      aria-colcount={MAX_COLS}
      onScroll={updateWindow}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
    >
      <div className="grid-sizer" style={{ width: ROW_HEADER_WIDTH + totalWidth, height: HEADER_HEIGHT + totalHeight }}>
        <ColumnHeaders c0={win.c0} c1={win.c1} colX={colX} width={ROW_HEADER_WIDTH + totalWidth} />
        <RowHeaders r0={win.r0} r1={win.r1} height={totalHeight} />
        <div className="cells-layer" style={{ top: HEADER_HEIGHT, left: ROW_HEADER_WIDTH, width: totalWidth, height: totalHeight }}>
          <GridCells win={win} colX={colX} />
          <SelectionLayer colX={colX} onFillHandleDown={onFillHandleDown} />
          <CellEditor colX={colX} viewportWidth={viewportWidth} />
          <KeySink ref={sinkRef} colX={colX} onKeyDown={onKeyDown} onInput={onSinkInput} />
        </div>
      </div>
    </div>
  );
}

interface KeySinkProps {
  colX: Float64Array;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onInput: (e: FormEvent<HTMLTextAreaElement>) => void;
}

/** Hidden textarea kept at the active cell so IME candidate windows appear in the right place. */
const KeySink = memo(
  forwardRef<HTMLTextAreaElement, KeySinkProps>(function KeySink({ colX, onKeyDown, onInput }, ref) {
    const anchor = useSheet((s) => s.selection.anchor);
    return (
      <textarea
        ref={ref}
        className="key-sink"
        style={{ left: colX[anchor.col], top: anchor.row * ROW_HEIGHT }}
        aria-label="Spreadsheet keyboard input"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onKeyDown={onKeyDown}
        onInput={onInput}
        onCompositionEnd={(e) => onInput(e as unknown as FormEvent<HTMLTextAreaElement>)}
      />
    );
  }),
);

const ColumnHeaders = memo(function ColumnHeaders({ c0, c1, colX, width }: { c0: number; c1: number; colX: Float64Array; width: number }) {
  const selection = useSheet((s) => s.selection);
  const b = selectionBounds(selection);
  const wholeCols = b.top === 0 && b.bottom === MAX_ROWS - 1;

  const startResize = (e: MouseEvent, col: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colX[col + 1] - colX[col];
    const onMove = (ev: globalThis.MouseEvent) => useSheet.getState().setColWidth(col, startWidth + ev.clientX - startX);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const cells = [];
  for (let c = c0; c <= c1; c++) {
    const inSel = c >= b.left && c <= b.right;
    cells.push(
      <div
        key={c}
        className={`col-header${inSel ? (wholeCols ? ' selected-full' : ' selected') : ''}`}
        style={{ left: ROW_HEADER_WIDTH + colX[c], width: colX[c + 1] - colX[c] }}
      >
        {colToLetters(c)}
        <div className="col-resize" onMouseDown={(e) => startResize(e, c)} title="Drag to resize" />
      </div>,
    );
  }
  return (
    <div className="col-headers" style={{ width }}>
      <div className="corner" title="Select all" />
      {cells}
    </div>
  );
});

const RowHeaders = memo(function RowHeaders({ r0, r1, height }: { r0: number; r1: number; height: number }) {
  const selection = useSheet((s) => s.selection);
  const b = selectionBounds(selection);
  const wholeRows = b.left === 0 && b.right === MAX_COLS - 1;
  const cells = [];
  for (let r = r0; r <= r1; r++) {
    const inSel = r >= b.top && r <= b.bottom;
    cells.push(
      <div key={r} className={`row-header${inSel ? (wholeRows ? ' selected-full' : ' selected') : ''}`} style={{ top: r * ROW_HEIGHT }}>
        {r + 1}
      </div>,
    );
  }
  return (
    <div className="row-headers" style={{ height }}>
      {cells}
    </div>
  );
});
