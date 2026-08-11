import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../core/db';
import { useStore } from '../state/store';
import { selectDeletableRejected } from '../state/batchOps';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { useModalFocusTrap } from './useModalFocusTrap';
import { AdjustedImage } from './AdjustedImage';
import { TrashIcon, XIcon } from './icons';
import { t, plural } from '../i18n';

/** Miniatura din IndexedDB — acelasi tipar minimal ca in MemoryBanner/TripsPanel. */
function RejectedThumbImage({ photoId }: { photoId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    void db.thumbnails.get(photoId).then(rec => {
      if (rec && alive) { url = URL.createObjectURL(rec.blob); setSrc(url); }
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [photoId]);
  return src ? <AdjustedImage src={src} alt="" loading="lazy" /> : <span className="memory-thumb-loading" aria-hidden="true" />;
}

/**
 * Card dedicat "Sterge pozele respinse" (plan modernizare) — versiune scurta,
 * la vedere, a functiei care exista deja in BatchOpsPanel (ingropata acolo
 * printre praguri/Auto-Cull/presetari). Refoloseste EXACT aceeasi actiune
 * (deleteRejectedPhotos) si acelasi text de avertizare deja validat
 * (batch.deleteRejected.hint) — nu inventez o promisiune noua de genul
 * "ramane 30 de zile in Cosul de gunoi", pentru ca textul existent
 * documenteaza explicit ca multe telefoane NU permit recuperarea.
 */
export function DeleteRejectedBanner() {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const photos = useStore(s => s.photos);
  const deleteRejectedPhotos = useStore(s => s.deleteRejectedPhotos);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, modalOpen);

  const { deletable } = useMemo(() => selectDeletableRejected(photos), [photos]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setModalOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen]);

  if (!isNativeMediaLibraryAvailable() || deletable.length === 0) return null;

  const confirmDelete = async () => {
    setBusy(true);
    try {
      const result = await deleteRejectedPhotos();
      if (result.deleted > 0) setModalOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="memory-banner delete-rejected-banner glass" role="status">
        <button className="memory-banner-main" onClick={() => setModalOpen(true)}>
          <span className="delete-rejected-icon"><TrashIcon /></span>
          <span className="memory-banner-text">
            <span className="memory-banner-title">
              {tr(plural(deletable.length, 'deleteRejected.banner.title.one', 'deleteRejected.banner.title.other'), { count: deletable.length })}
            </span>
            <span className="memory-banner-sub">{tr('deleteRejected.banner.sub')}</span>
          </span>
        </button>
      </div>

      {modalOpen && (
        <div className="detail" onClick={e => { if (e.target === e.currentTarget) setModalOpen(false); }}>
          <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('batch.deleteRejected.title')} tabIndex={-1}>
            <header className="detail-head">
              <span><TrashIcon className="inline-icon" aria-hidden="true" /> {tr('batch.deleteRejected.title')}</span>
              <button className="ghost icon-btn" onClick={() => setModalOpen(false)} aria-label={tr('detail.close')}>
                <XIcon />
              </button>
            </header>
            <p className="hint">{tr('batch.deleteRejected.hint')}</p>
            <div className="memory-grid delete-rejected-grid">
              {deletable.slice(0, 12).map(photo => <RejectedThumbImage key={photo.id} photoId={photo.id} />)}
              {deletable.length > 12 && <span className="delete-rejected-more">+{deletable.length - 12}</span>}
            </div>
            <button className="reject big delete-rejected-cta" disabled={busy} onClick={() => void confirmDelete()}>
              {tr('batch.deleteRejected.apply', { count: deletable.length })}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
