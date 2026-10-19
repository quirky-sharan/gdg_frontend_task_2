import { memo, useMemo, type MouseEvent } from 'react';
import { selectionBounds, useSheet } from '../../state/store';
import { referencesIn } from '../../ui/formulaAssist';
import { rangeRect } from './layout';

interface Props {
  colX: Float64Array;
  onFillHandleDown: (e: MouseEvent) => void;
}

/** Selection, active cell, fill handle, fill preview, copy marquee and formula reference highlights. */
export const SelectionLayer = memo(function SelectionLayer({ colX, onFillHandleDown }: Props) {
  const selection = useSheet((s) => s.selection);
  const editingDraft = useSheet((s) => s.editing?.draft);
  const fillPreview = useSheet((s) => s.fillPreview);
  const clipboard = useSheet((s) => s.clipboard);

  const bounds = selectionBounds(selection);
  const range = rangeRect(colX, bounds);
  const active = rangeRect(colX, { top: selection.anchor.row, left: selection.anchor.col, bottom: selection.anchor.row, right: selection.anchor.col });
  const multi = bounds.top !== bounds.bottom || bounds.left !== bounds.right;
  const refs = useMemo(() => (editingDraft ? referencesIn(editingDraft) : []), [editingDraft]);

  return (
    <>
      {refs.map((ref, i) => (
        <div key={i} className={`ref-highlight ref-color-${ref.color}`} style={rangeRect(colX, ref.bounds)} />
      ))}
      {multi && <div className="sel-range" style={range} />}
      <div className="sel-active" style={active} />
      {clipboard && <div className={`clip-marquee${clipboard.cut ? ' cut' : ''}`} style={rangeRect(colX, clipboard.bounds)} />}
      {fillPreview && <div className="fill-preview" style={rangeRect(colX, fillPreview)} />}
      {editingDraft === undefined && (
        <div
          className="fill-handle"
          title="Drag to fill"
          style={{ left: range.left + range.width - 4, top: range.top + range.height - 4 }}
          onMouseDown={onFillHandleDown}
        />
      )}
    </>
  );
});
