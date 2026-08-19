import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { db } from '../core/db';
import { buildRescueQueue, type RescueCandidate, type RescueItem } from '../core/rescueQueue';
import { useModalFocusTrap } from './useModalFocusTrap';
import { AdjustedImage } from './AdjustedImage';
import { SparkleIcon, XIcon } from './icons';
import { t, plural } from '../i18n';

/** Miniatura unui cadru din coada. Aceeasi tehnica ca in restul panourilor: din thumbnails, fara re-decodare. */
function RescueThumb({ photoId }: { photoId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    void db.thumbnails.get(photoId).then(rec => {
      if (rec && alive) { url = URL.createObjectURL(rec.blob); setSrc(url); }
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [photoId]);
  return src ? <AdjustedImage className="rescue-thumb" src={src} alt="" /> : <span className="rescue-thumb empty" />;
}

/**
 * Coada de salvare.
 *
 * O aplicatie de triaj care spune doar "asta nu e buna" isi face jumatate din
 * treaba. Ecranul asta arata cadrele care NU sunt ratate, ci nereglate, si ce
 * anume s-ar repara la fiecare. Deschide direct editorul cu corectia ceruta.
 *
 * Nu se calculeaza nimic nou aici: semnalele (highlights arse, umbre infundate,
 * orizont strambat, expunere, incadrare) vin din analiza deja facuta. Analizele
 * se citesc o singura data, la deschiderea panoului.
 */
export function RescueQueuePanel() {
  const open = useStore(s => s.rescueQueueOpen);
  const setOpen = useStore(s => s.setRescueQueueOpen);
  const photos = useStore(s => s.photos);
  const openEdit = useStore(s => s.openEdit);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  const [items, setItems] = useState<RescueItem[]>([]);
  const [loading, setLoading] = useState(false);

  const byId = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    // Candidatii se restrang INAINTE de citirea analizelor: pozele deja
    // pastrate nu intra oricum in coada, iar pe o biblioteca mare a citi tot
    // ar fi cea mai scumpa operatie din ecran, degeaba.
    const candidates = photos.filter(p => p.status !== 'selected');
    void Promise.all(candidates.map(p => db.analyses.get(p.id))).then(analyses => {
      if (!alive) return;
      const input: RescueCandidate[] = candidates.map((p, i) => {
        const a = analyses[i];
        return {
          id: p.id,
          status: p.status,
          aiScore: p.aiScore,
          sharpness: p.sharpness,
          exposure: p.exposure,
          faceCount: p.faceCount,
          ruleOfThirds: p.ruleOfThirds,
          highlightClipping: a?.highlightClipping,
          shadowClipping: a?.shadowClipping,
          horizonTiltDeg: a?.horizonTiltDeg
        };
      });
      setItems(buildRescueQueue(input));
      setLoading(false);
    });
    return () => { alive = false; };
  }, [open, photos]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('rescue.title')} tabIndex={-1}>
        <header className="detail-head">
          <span><SparkleIcon className="inline-icon" aria-hidden="true" /> {tr('rescue.title')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        <p className="hint">{tr('rescue.hint')}</p>

        {loading ? (
          <p className="hint" role="status">{tr('workspace.progress.processing')}</p>
        ) : items.length === 0 ? (
          <p className="hint">{tr('rescue.empty')}</p>
        ) : (
          <>
            <p className="hint">
              {tr(plural(items.length, 'rescue.count.one', 'rescue.count.other'), { count: items.length })}
            </p>
            <div className="rescue-list">
              {items.map(item => {
                const photo = byId.get(item.id);
                if (!photo) return null;
                return (
                  <div key={item.id} className="rescue-row">
                    <RescueThumb photoId={item.id} />
                    <div className="rescue-info">
                      <span className="rescue-name">{photo.fileName}</span>
                      <span className="rescue-fixes">
                        {item.fixes.map(f => (
                          <span key={f} className="rescue-fix-tag">{tr(`rescue.fix.${f}`)}</span>
                        ))}
                      </span>
                      <span className="mono rescue-gain">{tr('rescue.gain', { gain: item.gain, score: photo.aiScore })}</span>
                    </div>
                    {/* Deschide editorul cu auto-fix cerut: utilizatorul vede
                        valorile propuse si le poate schimba sau anula — nimic
                        nu se aplica in spatele lui. */}
                    <button
                      className="btn-accent rescue-cta"
                      onClick={() => { setOpen(false); openEdit(item.id, { autoApply: true }); }}
                    >
                      {tr('rescue.repair')}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
