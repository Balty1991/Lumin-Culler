import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useStore, type PhotoView } from '../state/store';
import { photoTime } from './days';
import { monthLabel } from './format';
import { monthStart } from './coverage';
import { reasonsFor } from './reasons';
import { useTr } from './context';
import { Thumb } from './Thumb';
import { searchPhotos } from './textSearch';

type Filter = 'all' | 'kept' | 'notToday';
const PAGE = 60;

/**
 * lumin/GalleryWall.tsx
 * Galeria ca galerie: un zid de poze în coloane, pe luni, care se ridică
 * plutind pe ecran. O atingere deschide poza mare, cu ce a văzut AI-ul în ea,
 * și de acolo glisezi la următoarea, păstrezi, scoți sau trimiți.
 */
export function GalleryWall() {
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);
  const tr = useTr();
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(PAGE);
  const [viewer, setViewer] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const sentinel = useRef<HTMLDivElement>(null);

  const list = useMemo(() => {
    // Cu o căutare: și documentele (bonul de benzină se caută), în ordinea potrivirii.
    if (query.trim()) return searchPhotos(photos, query);
    return photos
      .filter(p => !p.aside)
      .filter(p => filter === 'all' || (filter === 'kept' ? p.status === 'selected' : p.status === 'rejected'))
      .sort((a, b) => photoTime(b) - photoTime(a));
  }, [photos, filter, query]);

  useEffect(() => { setShown(PAGE); }, [filter, query]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) setShown(n => Math.min(list.length, n + PAGE));
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [list.length]);

  const visible = list.slice(0, shown);
  const months: { start: number; items: { p: PhotoView; i: number }[] }[] = [];
  visible.forEach((p, i) => {
    const m = monthStart(photoTime(p));
    const last = months[months.length - 1];
    if (last && last.start === m) last.items.push({ p, i });
    else months.push({ start: m, items: [{ p, i }] });
  });

  return (
    <div className="lx-wall-wrap">
      <label className="lx-search">
        <span aria-hidden="true">⌕</span>
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={tr('lx.search.placeholder')} aria-label={tr('lx.search.placeholder')} />
        {query && <button onClick={() => setQuery('')} aria-label={tr('lx.close')}>✕</button>}
      </label>
      {query.trim() && <p className="lx-hint">{tr('lx.search.results', { count: list.length })}</p>}
      {!query.trim() && <div className="lx-chips lx-wall-filters">
        {(['all', 'kept', 'notToday'] as Filter[]).map(f => (
          <button key={f} className={filter === f ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setFilter(f)}>
            {tr(`lx.wall.${f}`)} <b>{f === 'all' ? photos.filter(p => !p.aside).length : photos.filter(p => !p.aside && p.status === (f === 'kept' ? 'selected' : 'rejected')).length}</b>
          </button>
        ))}
      </div>}
      {list.length === 0 && <p className="lx-empty">{tr('lx.wall.empty')}</p>}
      {months.map(m => (
        <section key={m.start} className="lx-wall-month">
          <h3 className="lx-wall-head">{monthLabel(m.start, locale)}</h3>
          <div className="lx-wall">
            {m.items.map(({ p, i }) => (
              <button key={p.id} className={`lx-tile ${p.status}`} style={{ animationDelay: `${(i % PAGE) * 28}ms`, ['--float' as string]: `${(i % 7) * 0.6}s` }}
                onClick={() => setViewer(i)}>
                <Thumb id={p.id} lqip={p.lqip} />
                {p.status === 'selected' && <span className="lx-tile-star">★</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
      <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
      {viewer !== null && list[viewer] && (
        <Viewer list={list} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />
      )}
    </div>
  );
}

/** Poza mare: glisezi stânga/dreapta între poze, în jos ca să închizi. */
export function Viewer({ list, index, onIndex, onClose }: {
  list: PhotoView[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const setStatus = useStore(s => s.setStatus);
  const exportSelection = useStore(s => s.exportSelection);
  const live = useStore(s => s.photos);
  const p = live.find(x => x.id === list[index].id) ?? list[index];
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dir, setDir] = useState<'next' | 'prev' | null>(null);

  const go = (step: number) => {
    const next = index + step;
    if (next < 0 || next >= list.length) return;
    setDir(step > 0 ? 'next' : 'prev');
    onIndex(next);
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => { start.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); };
  const onMove = (e: PointerEvent<HTMLDivElement>) => { if (start.current) setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y }); };
  const onUp = () => {
    if (!start.current) return;
    start.current = null;
    if (drag.y > 120 && Math.abs(drag.y) > Math.abs(drag.x)) onClose();
    else if (drag.x < -70) go(1);
    else if (drag.x > 70) go(-1);
    setDrag({ x: 0, y: 0 });
  };
  const date = new Date(photoTime(p)).toLocaleString(locale === 'en' ? 'en-GB' : 'ro-RO', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="lx-viewer" role="dialog" aria-modal="true" style={{ ['--fade' as string]: `${Math.max(0.35, 1 - Math.max(0, drag.y) / 400)}` }}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{date}</span>
        <span className="lx-viewer-count">{index + 1}/{list.length}</span>
      </header>
      <div className="lx-viewer-stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div key={p.id} className={`lx-viewer-photo ${dir ?? ''}`}
          style={{ transform: `translate(${drag.x}px, ${Math.max(0, drag.y)}px) scale(${1 - Math.max(0, drag.y) / 1600})` }}>
          <Thumb id={p.id} lqip={p.lqip} full />
        </div>
      </div>
      <div className="lx-viewer-info">
        <div className="lx-chips">
          <span className={`lx-chip ${p.status === 'selected' ? 'good' : p.status === 'rejected' ? 'bad' : 'info'}`}>
            {tr(p.status === 'selected' ? 'lx.wall.state.kept' : p.status === 'rejected' ? 'lx.wall.state.notToday' : 'lx.wall.state.waiting')}
          </span>
          <span className="lx-chip info">AI {p.aiScore}</span>
          {reasonsFor(p).map(r => <span key={r.key} className={`lx-chip ${r.tone}`}>{tr(r.key)}</span>)}
        </div>
        <div className="lx-viewer-actions">
          <button className={p.status === 'rejected' ? 'lx-round drop on' : 'lx-round drop'} onClick={() => void setStatus(p.id, 'rejected')} aria-label={tr('lx.notToday')}>
            <span>✕</span><small>{tr('lx.notToday')}</small>
          </button>
          <button className="lx-round" onClick={() => void exportSelection('apps', [p.id])} aria-label={tr('lx.wall.share')}>
            <span>↗</span><small>{tr('lx.wall.share')}</small>
          </button>
          <button className={p.status === 'selected' ? 'lx-round keep on' : 'lx-round keep'} onClick={() => void setStatus(p.id, 'selected')} aria-label={tr('lx.keep')}>
            <span>✓</span><small>{tr('lx.keep')}</small>
          </button>
        </div>
      </div>
    </div>
  );
}
