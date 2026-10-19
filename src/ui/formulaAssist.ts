/**
 * Editor assistance for formulas: function autocomplete, signature help,
 * reference highlighting and "point mode" (click a cell to insert its address).
 */
import { FUNCTION_LIST, FUNCTIONS, MAX_COLS, MAX_ROWS, tokenize, type FunctionSpec, type RangeBounds } from '../engine';

export interface Completion {
  /** Start offset of the partially typed name in the draft. */
  start: number;
  end: number;
  items: FunctionSpec[];
}

function insideString(text: string): boolean {
  let quotes = 0;
  for (const ch of text) if (ch === '"') quotes++;
  return quotes % 2 === 1;
}

/** Function names matching the identifier being typed at the caret. */
export function completionsAt(draft: string, caret: number): Completion | null {
  if (!draft.startsWith('=')) return null;
  const before = draft.slice(0, caret);
  if (insideString(before)) return null;
  const m = /(^=|[(,+\-*/^&<>=:\s])([A-Za-z][A-Za-z0-9.]*)$/.exec(before);
  if (!m) return null;
  const prefix = m[2].toUpperCase();
  if (draft[caret] === '(') return null;
  const items = FUNCTION_LIST.filter((f) => f.name.startsWith(prefix) && f.name !== prefix).slice(0, 8);
  const exact = FUNCTIONS.get(prefix);
  if (exact) items.unshift(exact);
  if (items.length === 0) return null;
  return { start: caret - m[2].length, end: caret, items };
}

export interface SignatureHelp {
  spec: FunctionSpec;
  argIndex: number;
}

/** The innermost function call enclosing the caret, and which argument the caret is in. */
export function signatureAt(draft: string, caret: number): SignatureHelp | null {
  if (!draft.startsWith('=')) return null;
  const tokens = tokenize(draft.slice(0, caret), 1);
  const stack: Array<{ name: string | null; arg: number }> = [];
  let pendingFunc: string | null = null;
  for (const t of tokens) {
    if (t.type === 'func') pendingFunc = t.name;
    else if (t.type === 'lparen') {
      stack.push({ name: pendingFunc, arg: 0 });
      pendingFunc = null;
    } else {
      pendingFunc = null;
      if (t.type === 'comma' && stack.length) stack[stack.length - 1].arg++;
      else if (t.type === 'rparen') stack.pop();
    }
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    const name = stack[i].name;
    const spec = name ? FUNCTIONS.get(name) : undefined;
    if (spec) return { spec, argIndex: stack[i].arg };
  }
  return null;
}

/** Splits "a, [b], ..." into display parts, mapping a variadic argIndex onto the last parts. */
export function signatureParts(spec: FunctionSpec, argIndex: number): { parts: string[]; active: number } {
  const parts = spec.args ? spec.args.split(', ') : [];
  if (parts.length === 0) return { parts, active: -1 };
  const variadic = parts[parts.length - 1] === '...';
  let active = argIndex;
  if (active >= parts.length - (variadic ? 1 : 0)) active = variadic ? Math.max(0, parts.length - 2) : parts.length - 1;
  return { parts, active };
}

export interface FormulaReference {
  bounds: RangeBounds;
  start: number;
  end: number;
  color: number;
}

export const REFERENCE_COLORS = 6;

/** Cell and range references in a (possibly incomplete) formula, with stable colors. */
export function referencesIn(draft: string): FormulaReference[] {
  if (!draft.startsWith('=')) return [];
  const tokens = tokenize(draft, 1);
  const refs: FormulaReference[] = [];
  const colorOf = new Map<string, number>();
  const add = (bounds: RangeBounds, start: number, end: number) => {
    const id = `${bounds.top},${bounds.left},${bounds.bottom},${bounds.right}`;
    let color = colorOf.get(id);
    if (color === undefined) colorOf.set(id, (color = colorOf.size % REFERENCE_COLORS));
    refs.push({ bounds, start, end, color });
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'cell' && !t.outOfRange) {
      const a = tokens[i + 1];
      const b = tokens[i + 2];
      if (a?.type === 'colon' && b?.type === 'cell' && !b.outOfRange) {
        add(
          { top: Math.min(t.row, b.row), left: Math.min(t.col, b.col), bottom: Math.max(t.row, b.row), right: Math.max(t.col, b.col) },
          t.start,
          b.end,
        );
        i += 2;
      } else {
        add({ top: t.row, left: t.col, bottom: t.row, right: t.col }, t.start, t.end);
      }
    } else if (t.type === 'colrange' && !t.outOfRange) {
      add({ top: 0, left: t.left, bottom: MAX_ROWS - 1, right: t.right }, t.start, t.end);
    } else if (t.type === 'rowrange' && !t.outOfRange) {
      add({ top: t.top, left: 0, bottom: t.bottom, right: MAX_COLS - 1 }, t.start, t.end);
    }
  }
  return refs;
}

/** True when clicking a cell should insert a reference at the caret instead of committing. */
export function acceptsReference(draft: string, caret: number): boolean {
  if (!draft.startsWith('=')) return false;
  const before = draft.slice(0, caret);
  if (insideString(before)) return false;
  const trimmed = before.trimEnd();
  return /[=(,+\-*/^&<>:]$/.test(trimmed);
}
