# Architecture

Gridline is split into two layers with a one-way dependency:

```
src/engine/   Pure TypeScript formula engine — no DOM, no React. Fully unit-tested.
src/ui/       Small UI helpers (value display, editor assistance) built on the engine.
src/state/    Zustand store: selection, editing, undo/redo, clipboard, documents.
src/components/  React components: virtualized grid, formula bar, panels.
```

```mermaid
flowchart LR
  input["Cell input<br/>'=SUM(A1:A3)*2'"] --> literal{starts with '='?}
  literal -- no --> lit["parseLiteral<br/>number / bool / text"]
  literal -- yes --> tok[Tokenizer] --> parse[Pratt parser] --> validate[Validation<br/>functions, arity, names] --> refs[Reference extraction]
  refs --> graph[(Dependency graph<br/>cell edges + range index)]
  lit --> recalc
  graph --> recalc["Recalculation<br/>iterative Tarjan SCC"]
  recalc --> eval[Evaluator] --> values[(Cell values)]
  recalc -- cycle --> circ["#CIRC! with path"]
```

## 1. Tokenizer — `src/engine/tokenizer.ts`

A hand-written scanner that turns the formula text into tokens: numbers, strings (with `""` escapes),
booleans, error literals (`#N/A`, ...), cell references (`A1`, `$B$2`), whole-column (`A:C`) and
whole-row (`2:5`) ranges, function names, identifiers, operators and punctuation.

Design choices:

- **It never throws.** Malformed input becomes an `invalid` token or a flagged token (e.g. an
  unterminated string). This lets the parser give a precise diagnostic, and lets editor features
  (autocomplete, reference highlighting, formula shifting) work on half-typed formulas.
- **Offsets are positions in the full input** (including the leading `=`), so a diagnostic can put a
  caret exactly under the problem.
- A word followed directly by `(` is a function name, otherwise it is checked against the cell
  reference pattern — so `LOG10(100)` is a call while `LOG10` alone is a cell reference, as in Excel.

## 2. Parser — `src/engine/parser.ts`

A recursive-descent parser using **Pratt (binding power) parsing** for operators. Precedence matches
Excel:

| Level | Operators | Associativity |
| --- | --- | --- |
| 1 (lowest) | `=` `<>` `<` `>` `<=` `>=` | left |
| 2 | `&` | left |
| 3 | `+` `-` | left |
| 4 | `*` `/` | left |
| 5 | `^` | left (Excel: `2^3^2 = 64`) |
| 6 | postfix `%` | — |
| 7 | prefix `-` `+` | binds tighter than `^` (Excel: `-2^2 = 4`) |
| 8 | literals, references, ranges, calls, `( … )` | — |

Each infix operator has a `[left, right]` binding power; `right = left + 1` makes it
left-associative. Every AST node records its `start`/`end` offsets, which later lets runtime errors
(like `#DIV/0!`) point at the exact sub-expression that failed.

### Syntax diagnostics

The parser stops at the first error and returns a `SheetError` with:

- `message` — e.g. *Missing closing parenthesis.*
- `start` / `end` — the offending span (a zero-width span at the end for "missing" errors),
- `suggestion` — e.g. *Add ')' at the end of the formula.*,
- `fix` — a corrected formula where one can be derived.

The error handlers know the context they are in (top level, inside parentheses, inside an
argument list) and the previous token, which produces targeted messages: a missing comma between
arguments (`=SUM(A1 B1)` → fix `=SUM(A1, B1)`), `!=` → `<>`, `==` → `=`, `=>` → `>=`, `**` → `^`,
`;` → `,`, extra `)`, dangling operators, unterminated strings, empty parentheses, incomplete
ranges, out-of-range references (`A0`, `AAA1` → `#REF!`) and absurdly deep nesting (guarded, so the
parser itself can never overflow the stack).

### Validation and verified fixes — `src/engine/compile.ts`

After a successful parse, a validation pass walks the AST in source order:

- unknown functions → `#NAME?` with a *Did you mean …?* suggestion (Levenshtein distance against
  the registry, plus an alias table: `AVG → AVERAGE`, `LENGTH → LEN`, `CEIL → CEILING`, …),
- wrong argument counts → `#ERROR!` with the function's usage line,
- bare identifiers → `#NAME?`, suggesting quotes for text or `()` for function names (`=PI`).

Fixes are **verified**: `compileFormula` re-compiles each proposed fix and follows the chain of
fixes (e.g. close the quote, then close the parenthesis: `=CONCAT("abc` → `=CONCAT("abc")`). A fix
is only offered if the final candidate compiles cleanly.

## 3. Evaluator — `src/engine/evaluator.ts`, `src/engine/functions/`

A tree-walking interpreter over the AST.

**Value model** (`values.ts`): a cell value is `number | string | boolean | null` (empty) or a
`SheetError`. Errors are first-class values that flow through formulas and carry diagnostics.
Function arguments may also be a `RangeValue`, a lazy view over a rectangle of cells.

**Coercion** follows spreadsheet rules: in arithmetic, empty → 0, `TRUE` → 1, numeric text → number,
other text → `#VALUE!`; `&` converts to text; comparisons order numbers < text < booleans and compare
text case-insensitively; numbers are compared at 15 significant digits so `=0.1+0.2=0.3` is `TRUE`.
Long sums use Neumaier compensated summation.

**Functions** (`functions/*.ts`) are declarative specs — name, category, arity, argument list,
description, example and implementation — collected into one registry. The same registry drives
validation, the in-app function browser, autocomplete, signature help and the generated
[FUNCTIONS.md](FUNCTIONS.md). 112 functions are implemented.

**Lazy arguments.** Implementations receive an `Args` object; an argument is evaluated only when the
function asks for it (and memoized). This gives `IF`, `IFS`, `IFERROR`, `IFNA`, `CHOOSE` and `SWITCH`
short-circuit semantics for free: `=IF(A1=0, 0, 1/A1)` never evaluates the division when `A1` is 0.
Typed accessors (`number(i)`, `text(i)`, `range(i)`, `numbers()`) perform coercion and abort the call
with a positioned error (via an internal `ErrorSignal` exception caught at the call boundary).

**Error propagation with positions.** When a formula reads a cell that holds an error, the
evaluator wraps it: the new error points at the *reference* inside the current formula, names the
cell it came from and the cell where it originated, and keeps the root-cause message:

```
=5+B1    →  #DIV/0!  B1 contains #DIV/0! (originating in A1): Division by zero.
                     ^^ (caret under B1)        [Go to source (A1)]
```

**Ranges are cheap.** A `RangeValue` reads cells on demand and clamps iteration to the used area of
the sheet, so `SUM(A:A)` on a 100,000-row sheet only touches populated rows; very sparse ranges are
walked via the populated cells instead of cell-by-cell.

## 4. Dependency tracking — `src/engine/dependency-graph.ts`

Edges go from a **precedent** (a cell that is read) to a **dependent** (a formula that reads it).

- **Single-cell references** are stored as explicit reverse edges: `cell → Set<formula>`.
- **Range references are not expanded.** `=SUM(A1:A100000)` would otherwise create 100,000 edges.
  Instead each range is registered in a **spatial index**: the sheet is cut into buckets of
  256 rows × 1 column, and a range is added to every bucket it overlaps. "Which formulas read cell
  X?" looks at one bucket and checks containment, so the lookup cost does not depend on range sizes.
- Each formula's outgoing references are stored too, so re-editing a formula removes exactly its old
  edges before adding new ones.

## 5. Recalculation — `src/engine/engine.ts`

When cells change (one edit, a paste, a fill or a whole document load — always as one batch):

1. Each changed cell is re-compiled and its outgoing edges replaced.
2. An **iterative Tarjan strongly-connected-components traversal** starts from the changed cells
   (plus volatile cells such as `NOW()`/`RAND()`) and follows precedent → dependent edges. It visits
   **exactly the cells affected by the change** — nothing else is touched.
3. Tarjan emits components in reverse topological order, so iterating its output backwards gives an
   order in which **every cell is evaluated after all of its precedents, exactly once** (a diamond
   `A1 → B1, C1 → D1` evaluates `D1` once, after `B1` and `C1`).
4. A component with more than one cell, or a cell that reads itself, is a **circular reference**.
   Its cells are not evaluated; they receive `#CIRC!` (see below). Cells downstream of a cycle
   evaluate normally and receive a propagated `#CIRC!` that names the cycle.

The traversal is fully iterative (explicit frame stack, array-backed bookkeeping indexed by visit
order), so dependency chains of 100k+ cells cannot overflow the call stack. The status bar shows how
many formulas each edit recalculated, which makes the incremental behaviour visible.

Measured with `npm run bench` (Node 24, laptop):

| Dataset | Operation | Evaluations | Time |
| --- | --- | ---: | ---: |
| 10k rows / 80k cells / 30k formulas | Initial load (parse + calculate) | 30,008 | ~250 ms |
| | Edit the first price (running total through every row) | 10,009 | ~22 ms |
| | Edit a price halfway down | 5,010 | ~14 ms |
| | Edit a cell nothing depends on | 0 | ~0.1 ms |
| 50k rows / 400k cells / 150k formulas | Initial load | 150,008 | ~1.3 s |
| | Full recalculation (F9) | 150,008 | ~0.46 s |

## 6. Circular references

Detection is part of the SCC pass above, so it costs nothing extra and cannot loop. For each cell in
a cycle the engine finds the shortest cycle through it (BFS restricted to the component), rotates it
to start at that cell, and records the span of the reference that leads to the next cell:

```
A1: =B1+1   →  #CIRC!  Circular reference: A1 → B1 → C1 → A1.   (caret under B1)
A3: =SUM(A1:A5)  →  #CIRC!  Circular reference: A3 is inside the range A1:A5 that it refers to.
```

Long cycles are abbreviated (`A1 → A2 → A3 → A4 → … → A5000 → A1`). Breaking any link (editing one
of the cells) makes the next recalculation evaluate the former cycle members normally.

## 7. Error diagnostics in the UI

The diagnostics card shows the active cell's error, or — while typing — a live, debounced syntax
check of the draft formula, in the format required by the specification:

```
Formula: =SUM(A1, B2

Error: Missing closing parenthesis.

=SUM(A1, B2
           ^

Suggestion: Add ')' at the end of the formula.
```

When the error carries a verified `fix`, an **Apply fix** button applies it (as an undoable edit, or
into the editor while typing). Propagated errors offer **Go to source**. The Errors tab lists every
error cell in the sheet (maintained incrementally by the engine).

## 8. Grid and interactions

**Virtualization** (`components/grid/Grid.tsx`). One native scroll container holds a sizer as large
as the whole sheet (100,000 rows × 702 columns ≈ 70 million cells). Only the rows/columns inside the
viewport plus a small overscan are rendered, and within those **only non-empty cells create DOM
nodes** — grid lines come from row borders and one line per visible column. A typical viewport is
~40 row elements plus the occupied cells, regardless of sheet size. Column positions are prefix sums
(binary search to find the visible range), which also makes column resizing cheap. Headers use
`position: sticky`, so they scroll natively with no JavaScript synchronisation. The visible window is
only recomputed (and React only re-renders) when the first/last visible row or column changes;
memoized row components re-render only when their columns or the data version change.

**State** (`state/store.ts`). The engine is a mutable object inside a Zustand store; components
subscribe to cheap counters (`version`, `formatVersion`, `layoutVersion`) and to small slices
(selection, editing state), so moving the selection does not re-render cells.

**Undo/redo.** Every mutation goes through `applyChanges`, which records a transaction of
`{cell, before, after}` snapshots (input + format) plus the selection before/after. Undo and redo
re-apply one side of the transaction as a single engine batch, so they also recalculate
incrementally.

**Editing.** Keyboard focus lives in an invisible textarea positioned at the active cell (as in
Google Sheets) so typing, IME composition and clipboard events all work; the first typed character
opens the in-cell editor. The editor and formula bar share one draft. While typing a formula you can
click or drag on cells to insert references ("point mode"), references are highlighted in colour,
function names autocomplete (↑/↓, Tab) and a signature hint highlights the current argument.

**Copy / paste / fill.** Copy writes TSV of the displayed values to the system clipboard and keeps
the raw inputs internally; pasting back shifts relative references (`shiftFormula`, token-based so
spacing and strings are preserved; `$` anchors respected; references pushed off the sheet become
`#REF!`). Drag-to-fill extends numeric series (least-squares trend), text with trailing numbers
(`Item 1 → Item 2`), repeats patterns, and shifts formulas relative to their source cell, in any of
the four directions.

## 9. Testing

`npm test` runs 280 Vitest tests against the engine: tokenizer and parser (precedence,
associativity, spans, every diagnostic and fix), every function (table-driven cases including error
cases), dependency tracking (only affected cells recalculated, evaluation order, range and
whole-column dependencies, rewiring), circular references (self, range, indirect, downstream,
recovery, 5,000-cell cycles), error propagation, fill/shift logic, the diagnostic format from the
specification, performance budgets, and a check that `docs/FUNCTIONS.md` matches the registry.

## 10. Trade-offs and limitations

- Single sheet; no cross-sheet references, named ranges, array formulas/spilling, `INDIRECT` or
  `OFFSET` (dynamic references would require runtime dependency discovery).
- Dependencies are extracted statically, so `IF(cond, A1, B1)` depends on both `A1` and `B1` even
  though only one is evaluated — the standard, conservative choice.
- Cut + paste moves inputs without rewriting other formulas that referenced the moved cells.
- Autosave uses `localStorage`; very large sheets may exceed its quota (the app then suggests CSV
  export).
