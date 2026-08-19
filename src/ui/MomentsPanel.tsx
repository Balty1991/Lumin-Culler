import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { db } from '../core/db';
import { buildMomentStacks } from '../core/momentStacks';
import { useModalFocusTrap } from './useModalFocusTrap';
import { AdjustedImage } from './AdjustedImage';
import { ClockIcon, XIcon } from './icons';
import { t, plural } from '../i18n';

function MomentThumb({ photoId, top }: { photoId: string; top?: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    void db.thumbnails.get(photoId).then(rec => {
      if (rec && alive) { url = URL.createObjectURL(rec.blob); setSrc(url); }
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [photoId]);
  const cls = 'moment-thumb' + (top ? ' top' : '');
  return src ? <AdjustedImage className={cls} src={src} alt="" /> : <span className={cls + ' empty'} />;
}

/**
 * "Ziua de sambata", nu "437 de poze".
 *
 * Grila arata o biblioteca; oamenii tin minte intamplari. Momentele sunt
 * decupate din pauzele dintre declansari (vezi core/momentStacks.ts), deci nu
 * cer nicio analiza noua si nicio citire de imagine — doar ora capturii, care
 * e deja pe fiecare poza. De asta ecranul asta nu incetineste cu nimic
 * importul: nu atinge nimic din drumul lui.
 *
 * Ecranul NU decide nimic singur. Propune 1-3 cadre din serii diferite si duce
 * utilizatorul in grila cu ele deja selectate, ca decizia sa ramana un gest al
 * lui, luat cu toate optiunile obisnuite la indemana.
 */
export function MomentsPanel() {
  const open = useStore(s => s.momentsOpen);
  const setOpen = useStore(s => s.setMomentsOpen);
  const photos = useStore(s => s.photos);
  const revealInGrid = useStore(s => s.revealInGrid);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  // Calculat doar cat e panoul deschis: `photos` se schimba la fiecare decizie,
  // iar gruparea peste toata biblioteca n-are de ce sa ruleze in fundal.
  const stacks = useMemo(() => {
    if (!open) return [];
    return buildMomentStacks(photos.map(p => ({
      id: p.id, capturedAt: p.capturedAt, aiScore: p.aiScore, status: p.status, groupId: p.groupId
    })));
  }, [open, photos]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  /** Duce in grila cu `ids` deja in selectia multipla — de acolo se aplica orice operatie obisnuita. */
  const openInGrid = (ids: string[]) => { revealInGrid(ids); setOpen(false); };

  /** "12 mar. 2024, 14:30 – 16:05" sau, peste zile diferite, cu data la ambele capete. */
  const formatSpan = (startMs: number, endMs: number) => {
    const start = new Date(startMs);
    const end = new Date(endMs);
    const day = start.toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const hm = (d: Date) => d.toLocaleTimeString(locale === 'ro' ? 'ro-RO' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
    const sameDay = start.toDateString() === end.toDateString();
    return sameDay ? `${day}, ${hm(start)} – ${hm(end)}` : `${day} ${hm(start)} – ${end.toLocaleDateString()} ${hm(end)}`;
  };

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('moments.title')} tabIndex={-1}>
        <header className="detail-head">
          <span><ClockIcon className="inline-icon" aria-hidden="true" /> {tr('moments.title')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        <p className="hint">{tr('moments.hint')}</p>

        {stacks.length === 0 ? (
          <p className="hint">{tr('moments.empty')}</p>
        ) : (
          stacks.map(stack => (
            <div key={stack.key} className="batch-section moment-card">
              <h3>{formatSpan(stack.startMs, stack.endMs)}</h3>
              <p className="hint">
                {tr(plural(stack.ids.length, 'moments.count.one', 'moments.count.other'), { count: stack.ids.length })}
                {stack.undecided > 0 && ' · ' + tr('moments.undecided', { count: stack.undecided })}
              </p>
              <div className="moment-strip">
                {stack.topPicks.map(id => <MomentThumb key={id} photoId={id} top />)}
                {stack.ids.filter(id => !stack.topPicks.includes(id)).slice(0, 8).map(id => (
                  <MomentThumb key={id} photoId={id} />
                ))}
              </div>
              <div className="moment-actions">
                <button className="primary small" onClick={() => openInGrid(stack.topPicks)}>
                  {tr(plural(stack.topPicks.length, 'moments.selectTop.one', 'moments.selectTop.other'), { count: stack.topPicks.length })}
                </button>
                <button className="ghost small" onClick={() => openInGrid(stack.ids)}>
                  {tr('moments.openAll')}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
