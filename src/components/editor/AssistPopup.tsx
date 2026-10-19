import { createPortal } from 'react-dom';
import { signature as fullSignature } from '../../engine';
import { signatureParts } from '../../ui/formulaAssist';
import type { FormulaInputState } from './useFormulaInput';

/** Autocomplete list and signature help, positioned under the active formula input. */
export function AssistPopup({ anchor, state }: { anchor: HTMLElement | null; state: FormulaInputState }) {
  const { completion, signature, activeIndex, accept, active } = state;
  if (!active || !anchor || (!completion && !signature)) return null;
  const rect = anchor.getBoundingClientRect();
  const style = { left: Math.max(4, Math.min(rect.left, window.innerWidth - 420)), top: rect.bottom + 4 };

  return createPortal(
    <div className="assist" style={style} onMouseDown={(e) => e.preventDefault()}>
      {signature && !completion && <SignatureLine state={state} />}
      {completion && (
        <ul className="assist-list" role="listbox">
          {completion.items.map((spec, i) => (
            <li
              key={spec.name}
              role="option"
              aria-selected={i === activeIndex}
              className={i === activeIndex ? 'active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                accept(spec);
              }}
            >
              <span className="assist-name">{spec.name}</span>
              <span className="assist-sig">{fullSignature(spec)}</span>
              {i === activeIndex && <span className="assist-desc">{spec.description}</span>}
            </li>
          ))}
          <li className="assist-hint">↑↓ to choose · Tab to insert · Esc to close</li>
        </ul>
      )}
    </div>,
    document.body,
  );
}

function SignatureLine({ state }: { state: FormulaInputState }) {
  const sig = state.signature!;
  const { parts, active } = signatureParts(sig.spec, sig.argIndex);
  return (
    <div className="assist-signature">
      <div>
        <strong>{sig.spec.name}</strong>(
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 && ', '}
            <span className={i === active ? 'arg-active' : undefined}>{p}</span>
          </span>
        ))}
        )
      </div>
      <div className="assist-desc">{sig.spec.description}</div>
    </div>
  );
}
