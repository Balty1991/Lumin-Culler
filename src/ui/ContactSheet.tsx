import { useEffect, useRef, useState } from 'react';
import { db, type PhotoRecord } from '../core/db';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, PrinterIcon, StarIcon } from './icons';
import { t } from '../i18n';

const STATUS_KEY: Record<PhotoRecord['status'], string> = {
  selected: 'contactSheet.status.selected',
  rejected: 'contactSheet.status.rejected',
  review: 'contactSheet.status.review',
  pending: 'contactSheet.status.pending'
};

/** Miniatura decupata din IndexedDB — identic cu tiparul din PhotoCard/GroupCompare, dar fara nicio logica de interactiune (contact sheet-ul e doar de citit/printat). */
function ContactSheetThumb({ photoId }: { photoId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    void db.thumbnails.get(photoId).then(rec => {
      if (rec && alive) { url = URL.createObjectURL(rec.blob); setSrc(url); }
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [photoId]);
  return src ? <img src={src} alt="" loading="lazy" /> : <span className="contact-sheet-thumb-loading" aria-hidden="true" />;
}

/**
 * Contact sheet printabil (plan "cat mai pro"): grila compacta cu toate
 * miniaturile din filtrul curent + status/rating/scor, gata de window.print()
 * — util pentru revizuire offline cu clientul, fara sa deschizi laptopul.
 * Foloseste `filtered()` (acelasi set afisat in grila la momentul deschiderii),
 * nu intreaga biblioteca — ca sa reflecte exact ce se vede pe ecran.
 *
 * CSS-ul de print (@media print, in styles.css) foloseste tiparul clasic
 * "printeaza doar acest element": visibility:hidden pe tot documentul, apoi
 * visibility:visible + position:absolute doar pe .contact-sheet-scrim, ca sa
 * nu fie nevoie de manipulare DOM sau o fereastra noua pentru print.
 */
export function ContactSheet() {
  const open = useStore(s => s.contactSheetOpen);
  const setOpen = useStore(s => s.setContactSheetOpen);
  const filtered = useStore(s => s.filtered());
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  if (!open) return null;

  return (
    <div className="detail contact-sheet-scrim" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner wide contact-sheet-modal" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('contactSheet.title', { count: filtered.length })} tabIndex={-1}>
        <header className="detail-head contact-sheet-no-print">
          <span><PrinterIcon className="inline-icon" /> {tr('contactSheet.title', { count: filtered.length })}</span>
          <div className="contact-sheet-header-actions">
            <button className="select small-btn" onClick={() => window.print()} disabled={!filtered.length}>
              <PrinterIcon className="inline-icon" /> {tr('contactSheet.print')}
            </button>
            <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
              <XIcon />
            </button>
          </div>
        </header>
        <p className="hint contact-sheet-no-print">{tr('contactSheet.hint')}</p>

        {filtered.length === 0
          ? <p className="hint">{tr('contactSheet.empty')}</p>
          : (
            <div className="contact-sheet-grid">
              {filtered.map((p, i) => (
                <div key={p.id} className="contact-sheet-item">
                  <div className="contact-sheet-thumb">
                    <ContactSheetThumb photoId={p.id} />
                  </div>
                  <div className="contact-sheet-meta mono">
                    <span className="contact-sheet-frame">#{String(i + 1).padStart(3, '0')}</span>
                    <span className={`contact-sheet-status st-${p.status}`}>{tr(STATUS_KEY[p.status])}</span>
                    {p.rating > 0 && (
                      <span className="contact-sheet-rating">
                        <StarIcon fill="currentColor" /> {p.rating}
                      </span>
                    )}
                    <span className="contact-sheet-score">{tr('detail.stat.score')} {p.aiScore}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
