import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { CleanBasket, CleanItem } from '../core/cleanScan';
import { getCachedThumbUrl, peekThumbUrl } from '../core/thumbUrlCache';
import { formatSize } from '../state/storageStats';
import { t } from '../i18n';
import { useStore } from '../state/store';
import { XIcon } from './icons';

/**
 * Un coș, un cadru, o decizie. Stânga îl pune în coșul de șters, dreapta îl
 * păstrează. Ștergerea reală e una singură, la final, prin dialogul sistemului.
 */
export function CleanSwipe(props: {
  basket: CleanBasket;
  onClose: () => void;
  onDeleted: (items: CleanItem[]) => Promise<boolean>;
}) {
  const { basket, onClose, onDeleted } = props;
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const [index, setIndex] = useState(0);
  const [bin, setBin] = useState<CleanItem[]>([]);
  const [history, setHistory] = useState<Array<'keep' | 'delete'>>([]);
  const [drag, setDrag] = useState(0);
  const [origin, setOrigin] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const item = basket.items[index];
  const done = index >= basket.items.length;

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

  const confirm = async () => {
    if (busy || bin.length === 0) { onClose(); return; }
    setBusy(true);
    const ok = await onDeleted(bin);
    setBusy(false);
    if (ok) onClose();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') decide('delete');
      if (event.key === 'ArrowRight') decide('keep');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="clean-swipe" role="dialog" aria-modal="true" aria-label={tr(`clean.basket.${basket.id}`)}>
      <header className="clean-swipe-bar">
        <button type="button" className="ghost" onClick={onClose} aria-label={tr('detail.close')}><XIcon /></button>
        <strong>{tr(`clean.basket.${basket.id}`)}</strong>
        <button type="button" className="ghost" onClick={undo} disabled={history.length === 0}>{tr('clean.undo')}</button>
      </header>

      {done ? (
        <div className="clean-swipe-done">
          <p>{tr('clean.done', { count: bin.length })}</p>
          <p className="clean-muted">{formatSize(bin.reduce((sum, entry) => sum + entry.bytes, 0))}</p>
          <button type="button" className="btn-accent big" disabled={busy} onClick={() => { void confirm(); }}>
            {bin.length === 0 ? tr('detail.close') : tr('clean.confirm', { count: bin.length })}
          </button>
        </div>
      ) : item && (
        <>
          <p className="clean-muted clean-swipe-hint">{tr('clean.swipe.hint')}</p>
          <div
            className="clean-card"
            style={{ transform: `translateX(${drag}px) rotate(${drag / 28}deg)` }}
            onPointerDown={event => { setOrigin(event.clientX); (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); }}
            onPointerMove={event => { if (origin !== null) setDrag(event.clientX - origin); }}
            onPointerUp={() => {
              if (drag <= -80) decide('delete');
              else if (drag >= 80) decide('keep');
              else { setDrag(0); setOrigin(null); }
            }}
          >
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
