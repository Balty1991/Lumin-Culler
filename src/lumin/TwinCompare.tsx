import { createPortal } from 'react-dom';
import { useStore, type PhotoView } from '../state/store';
import { useTr } from './context';
import { Thumb } from './Thumb';

/**
 * lumin/TwinCompare.tsx
 * „Mai e una aproape la fel, mai reușită” — și o poți vedea (cerut: „când spune
 * că e alta la fel, să ai opțiunea s-o vezi”). Cele două una sub alta, cu scorul,
 * și alegerea direct de aici.
 */
export function betterTwin(p: Pick<PhotoView, 'id' | 'groupId' | 'aiScore'>, photos: readonly PhotoView[]): PhotoView | null {
  if (!p.groupId) return null;
  let best: PhotoView | null = null;
  for (const q of photos) {
    if (q.id === p.id || q.groupId !== p.groupId || q.aside) continue;
    if (!best || q.aiScore > best.aiScore) best = q;
  }
  return best && best.aiScore > p.aiScore + 3 ? best : null;
}

export function TwinCompare({ photo, twin, onClose }: { photo: PhotoView; twin: PhotoView; onClose: () => void }) {
  const tr = useTr();
  const setStatus = useStore(s => s.setStatus);
  const choose = async (keep: 'twin' | 'both' | 'this') => {
    if (keep === 'twin') { await setStatus(twin.id, 'selected'); await setStatus(photo.id, 'rejected'); }
    if (keep === 'both') { await setStatus(twin.id, 'selected'); await setStatus(photo.id, 'selected'); }
    if (keep === 'this') { await setStatus(photo.id, 'selected'); await setStatus(twin.id, 'rejected'); }
    onClose();
  };
  return createPortal(
    <div className="lx lx-twin-compare" role="dialog" aria-modal="true" aria-label={tr('lx.twin.title')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.twin.title')}</span>
        <span />
      </header>
      <div className="lx-twin-pair">
        <figure>
          <Thumb id={twin.id} lqip={twin.lqip} edits={twin.edits} full />
          <figcaption><b>{tr('lx.twin.better')}</b> · AI {twin.aiScore}</figcaption>
        </figure>
        <figure>
          <Thumb id={photo.id} lqip={photo.lqip} edits={photo.edits} full />
          <figcaption><b>{tr('lx.twin.this')}</b> · AI {photo.aiScore}</figcaption>
        </figure>
      </div>
      <div className="lx-twin-actions">
        <button className="lx-btn primary" onClick={() => void choose('twin')}>{tr('lx.twin.keepBetter')}</button>
        <div className="lx-decide-actions">
          <button className="lx-btn ghost" onClick={() => void choose('both')}>{tr('lx.twin.keepBoth')}</button>
          <button className="lx-btn ghost" onClick={() => void choose('this')}>{tr('lx.twin.keepThis')}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
