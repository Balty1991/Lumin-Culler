import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { CleanBasket, CleanItem } from '../core/cleanScan';
import { getCachedThumbUrl, peekThumbUrl } from '../core/thumbUrlCache';
import { formatSize } from '../state/storageStats';
import { shareCleanResult } from './shareResultCard';
import { t } from '../i18n';
import { useStore } from '../state/store';
import { XIcon } from './icons';

/**
 * Un coș, un cadru, o decizie. Stânga îl pune în coșul de șters, dreapta îl
 * păstrează. La rafale și duplicate restul vin deja marcate: se confirmă o
 * dată, sau se reiau pe rând. Ștergerea reală e tot dialogul sistemului.
 */
export function CleanSwipe(props: {
  basket: CleanBasket;
  onClose: () => void;
  onDeleted: (items: CleanItem[]) => Promise<boolean>;
}) {
  const { basket, onClose, onDeleted } = props;
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const [reviewing, setReviewing] = useState(!basket.premark);
  const [index, setIndex] = useState(0);
  const [bin, setBin] = useState<CleanItem[]>([]);
  const [history, setHistory] = useState<Array<'keep' | 'delete'>>([]);
  const [drag, setDrag] = useState(0);
  const [origin, setOrigin] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [freed, setFreed] = useState<CleanItem[] | null>(null);
  const item = basket.items[index];
  const done = reviewing && index >= basket.items.length;
  const marked = reviewing ? bin : basket.items;

  const decide = (direction: 'keep' | 'delete') => {
    if (!item || done) return;
    if (direction === 'delete') setBin(list => [...list, item]);
    setHistory(list => [...list, direction]);
    setIndex(value => value + 1);
    setDrag(0);
    setOrigin(null);
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory(list => list.slice(0, -1));
    if (last === 'delete') setBin(list => list.slice(0, -1));
    setIndex(value => Math.max(0, value - 1));
  };

  const confirm = async (items: CleanItem[]) => {
    if (busy) return;
    if (items.length === 0) { onClose(); return; }
    setBusy(true);
    const ok = await onDeleted(items);
    setBusy(false);
    if (ok) setFreed(items);
  };

  const share = () => {
    const items = freed ?? marked;
    void shareCleanResult(
      locale,
      formatSize(items.reduce((sum, entry) => sum + entry.bytes, 0)),
      items.length
    );
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (!reviewing || done || freed) return;
      if (event.key === 'ArrowLeft') decide('delete');
      if (event.key === 'ArrowRight') decide('keep');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const reason = basket.keeper ? tr(`clean.best.reason.${basket.keeper.reason}`) : '';

  return (
    <div className="clean-swipe" role="dialog" aria-modal="true" aria-label={tr(`clean.basket.${basket.id}`)}>
      <header className="clean-swipe-bar">
        <button type="button" className="ghost" onClick={onClose} aria-label={tr('detail.close')}><XIcon /></button>
        <strong>{tr(`clean.basket.${basket.id}`)}</strong>
        <button type="button" className="ghost" onClick={undo} disabled={!reviewing || history.length === 0 || freed !== null}>{tr('clean.undo')}</button>
      </header>

      {freed ? (
        <div className="clean-swipe-done">
          <p className="clean-kicker">{tr('clean.share.kicker')}</p>
          <p className="clean-freed-value">{formatSize(freed.reduce((sum, entry) => sum + entry.bytes, 0))}</p>
          <p>{tr('clean.done', { count: freed.length })}</p>
          <button type="button" className="btn-accent big" onClick={share}>{tr('clean.share.card')}</button>
          <button type="button" className="ghost" onClick={onClose}>{tr('detail.close')}</button>
        </div>
      ) : !reviewing ? (
        <div className="clean-swipe-done clean-best">
          <p className="clean-kicker">{tr('clean.best.kept')}</p>
          <h2>{basket.keeper && basket.keeper.groups > 1
            ? tr('clean.best.groups', { count: basket.keeper.groups })
            : tr('clean.best.line', { name: basket.keeper?.name ?? '' })}</h2>
          {reason && <p>{reason}</p>}
          <p className="clean-muted">{tr('clean.best.marked', { count: basket.items.length })} · {formatSize(basket.bytes)}</p>
          <button type="button" className="btn-accent big" disabled={busy} onClick={() => { void confirm(basket.items); }}>
            {tr('clean.confirm', { count: basket.items.length })}
          </button>
          <button type="button" className="ghost" onClick={() => { setReviewing(true); setIndex(0); setBin([]); setHistory([]); }}>
            {tr('clean.best.review')}
          </button>
        </div>
      ) : done ? (
        <div className="clean-swipe-done">
          <p>{tr('clean.done', { count: bin.length })}</p>
          <p className="clean-muted">{formatSize(bin.reduce((sum, entry) => sum + entry.bytes, 0))}</p>
          <button type="button" className="btn-accent big" disabled={busy} onClick={() => { void confirm(bin); }}>
            {bin.length === 0 ? tr('detail.close') : tr('clean.confirm', { count: bin.length })}
          </button>
        </div>
      ) : item && (
        <>
          {basket.keeper && (
            <p className="clean-keeper-note">{tr('clean.best.line', { name: basket.keeper.name })} · {reason}</p>
          )}
          <p className="clean-muted clean-swipe-hint">{tr('clean.swipe.hint')}</p>
          <div
            className={`clean-card${origin !== null ? ' dragging' : ''}`}
            style={{ transform: `translateX(${drag}px) rotate(${drag / 28}deg)` }}
            onPointerDown={event => { setOrigin(event.clientX); (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); }}
            onPointerMove={event => { if (origin !== null) setDrag(event.clientX - origin); }}
            onPointerUp={() => {
              if (drag <= -80) decide('delete');
              else if (drag >= 80) decide('keep');
              else { setDrag(0); setOrigin(null); }
            }}
          >
            <span className={`clean-stamp delete${drag < -36 ? ' on' : ''}`}>{tr('clean.swipe.delete')}</span>
            <span className={`clean-stamp keep${drag > 36 ? ' on' : ''}`}>{tr('clean.swipe.keep')}</span>
            <ItemImage item={item} />
            <span className="clean-card-meta">{item.name} · {formatSize(item.bytes)}</span>
          </div>
          <div className="clean-swipe-actions">
            <button type="button" className="clean-choice delete" onClick={() => decide('delete')}>{tr('clean.swipe.delete')}</button>
            <button type="button" className="clean-choice keep" onClick={() => decide('keep')}>{tr('clean.swipe.keep')}</button>
          </div>
        </>
      )}
    </div>
  );
}

function ItemImage({ item }: { item: CleanItem }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (item.uri.startsWith('content:') || item.uri.startsWith('file:')) {
      setSrc(Capacitor.convertFileSrc(item.uri));
      return;
    }
    if (!item.photoId) return;
    const ready = peekThumbUrl(item.photoId);
    if (ready) { setSrc(ready); return; }
    void getCachedThumbUrl(item.photoId).then(url => { if (alive) setSrc(url); });
    return () => { alive = false; };
  }, [item.uri, item.photoId]);
  if (!src) return <div className="clean-card-fallback">{item.name}</div>;
  return <img src={src} alt="" />;
}
