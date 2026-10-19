import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { FunctionSpec } from '../../engine';
import { useSheet, type EditState } from '../../state/store';
import { completionsAt, signatureAt, type Completion, type SignatureHelp } from '../../ui/formulaAssist';
import { focusGrid } from '../grid/layout';

export interface FormulaInputState {
  editing: EditState | null;
  active: boolean;
  completion: Completion | null;
  activeIndex: number;
  signature: SignatureHelp | null;
  accept: (spec: FunctionSpec) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onChange: (value: string, caret: number) => void;
  onSelect: (caret: number) => void;
}

/**
 * Shared behaviour of the two places a formula can be typed (the in-cell editor
 * and the formula bar): commit/cancel keys, function autocomplete, signature help
 * and keeping the DOM caret in sync with caret moves made by the store
 * (e.g. when clicking a cell inserts a reference).
 */
export function useFormulaInput(source: EditState['source'], inputRef: RefObject<HTMLInputElement>): FormulaInputState {
  const editing = useSheet((s) => s.editing);
  const active = editing?.source === source;
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedDraft, setDismissedDraft] = useState<string | null>(null);
  const reportedCaret = useRef<number | null>(null);

  const rawCompletion = active && editing ? completionsAt(editing.draft, editing.caret) : null;
  const completion = rawCompletion && dismissedDraft !== editing!.draft ? rawCompletion : null;
  const signature = active && editing ? signatureAt(editing.draft, editing.caret) : null;

  useEffect(() => setActiveIndex(0), [completion?.start, completion?.items.length]);

  // Apply caret positions chosen by the store (not by the user typing).
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || !editing || !active) return;
    if (reportedCaret.current !== editing.caret && document.activeElement === el) {
      el.setSelectionRange(editing.caret, editing.caret);
      reportedCaret.current = editing.caret;
    }
  }, [editing?.caret, editing?.draft, active, inputRef]);

  const accept = (spec: FunctionSpec) => {
    const s = useSheet.getState();
    const ed = s.editing;
    if (!ed || !completion) return;
    const text = `${spec.name}(`;
    const draft = ed.draft.slice(0, completion.start) + text + ed.draft.slice(completion.end);
    s.setDraft(draft, completion.start + text.length);
  };

  const finish = (fn: () => void) => {
    fn();
    focusGrid();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const s = useSheet.getState();
    const ed = s.editing;
    if (!ed) return;
    if (completion) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = completion.items.length;
        setActiveIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.ctrlKey)) {
        e.preventDefault();
        accept(completion.items[activeIndex] ?? completion.items[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissedDraft(ed.draft);
        return;
      }
    }
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        finish(() => s.commitEdit(e.shiftKey ? 'up' : 'down'));
        return;
      case 'Tab':
        e.preventDefault();
        finish(() => s.commitEdit(e.shiftKey ? 'left' : 'right'));
        return;
      case 'Escape':
        e.preventDefault();
        finish(() => s.cancelEdit());
        return;
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight': {
        // Like Excel: while typing a plain value into a cell, arrows commit and move.
        if (ed.mode === 'enter' && source === 'cell' && !ed.draft.startsWith('=')) {
          e.preventDefault();
          const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const;
          finish(() => s.commitEdit(dir[e.key as keyof typeof dir]));
        }
        return;
      }
      default:
        return;
    }
  };

  const onChange = (value: string, caret: number) => {
    reportedCaret.current = caret;
    useSheet.getState().setDraft(value, caret);
  };

  const onSelect = (caret: number) => {
    reportedCaret.current = caret;
    useSheet.getState().setCaret(caret);
  };

  return { editing, active, completion, activeIndex, signature, accept, onKeyDown, onChange, onSelect };
}
