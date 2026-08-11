import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../core/db';
import { useStore } from '../state/store';
import { findMemories, readMemoryDismissedDate, writeMemoryDismissedDate, isMemoryDismissedToday } from '../state/memories';
import { useModalFocusTrap } from './useModalFocusTrap';
import { AdjustedImage } from './AdjustedImage';
import { ClockIcon, XIcon } from './icons';
import { t, plural } from '../i18n';

/** Miniatura din IndexedDB — acelasi tipar minimal ca ContactSheetThumb (ContactSheet.tsx). */
function MemoryThumb({ photoId, onClick, label }: { photoId: string; onClick: () => void; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    void db.thumbnails.get(photoId).then(rec => {
      if (rec && alive) { url = URL.createObjectURL(rec.blob); setSrc(url); }
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [photoId]);
  return (
    <button className="memory-thumb" onClick={onClick} aria-label={label}>
      {src ? <AdjustedImage src={src} alt="" loading="lazy" /> : <span className="memory-thumb-loading" aria-hidden="true" />}
    </button>
  );
}

/**
 * "Acum X ani" (plan modernizare, refolosire pura de date deja existente —
 * PhotoView.capturedAt din EXIF). Motor dovedit de revenire zilnica in aplicatii
 * de galerie foto — nu costa nimic tehnic in plus fata de o filtrare pe data,
 * spre deosebire de alte functii noi propuse care cer module/integrari noi.
 * Se ascunde pentru ziua curenta la inchidere (nu permanent — maine continutul
 * se schimba), acelasi tipar de persistenta ca BackupReminder.
 */
export function MemoryBanner() {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const photos = useStore(s => s.photos);
  const openDetail = useStore(s => s.openDetail);
  const [dismissedToday, setDismissedToday] = useState(() => isMemoryDismissedToday(readMemoryDismissedDate()));
  const [modalOpen, setModalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, modalOpen);

  const group = useMemo(() => findMemories(photos)[0] ?? null, [photos]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setModalOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen]);

  if (!group || dismissedToday) return null;

  const dismiss = () => { writeMemoryDismissedDate(); setDismissedToday(true); setModalOpen(false); };
  const cover = group.photos[0];

  return (
    <>
      <div className="memory-banner glass" role="status">
        <button className="memory-banner-main" onClick={() => setModalOpen(true)}>
          <span className="memory-banner-cover">
            <MemoryThumb photoId={cover.id} onClick={() => setModalOpen(true)} label={tr('app.memory.viewAll')} />
          </span>
          <span className="memory-banner-text">
            <span className="memory-banner-title"><ClockIcon className="inline-icon" aria-hidden="true" /> {tr('app.memory.title', { years: group.yearsAgo })}</span>
            <span className="memory-banner-sub">
              {tr(plural(group.photos.length, 'app.memory.count.one', 'app.memory.count.other'), { count: group.photos.length })}
            </span>
          </span>
        </button>
        <button className="ghost icon-btn memory-banner-close" onClick={dismiss} aria-label={tr('app.memory.dismiss')}>
          <XIcon />
        </button>
      </div>

      {modalOpen && (
        <div className="detail" onClick={e => { if (e.target === e.currentTarget) setModalOpen(false); }}>
          <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('app.memory.title', { years: group.yearsAgo })} tabIndex={-1}>
            <header className="detail-head">
              <span><ClockIcon className="inline-icon" aria-hidden="true" /> {tr('app.memory.title', { years: group.yearsAgo })}</span>
              <button className="ghost icon-btn" onClick={() => setModalOpen(false)} aria-label={tr('detail.close')}>
                <XIcon />
              </button>
            </header>
            <div className="memory-grid">
              {group.photos.map(photo => (
                <MemoryThumb
                  key={photo.id}
                  photoId={photo.id}
                  label={photo.fileName}
                  onClick={() => { setModalOpen(false); openDetail(photo.id); }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
