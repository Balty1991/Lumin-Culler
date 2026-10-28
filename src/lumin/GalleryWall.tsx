import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore, type PhotoView } from '../state/store';
import { photoTime } from './days';
import { monthLabel } from './format';
import { monthStart } from './coverage';
import { reasonsFor } from './reasons';
import { useTr } from './context';
import { Thumb } from './Thumb';
import { searchPhotos } from './textSearch';
import { db } from '../core/db';
import { findSimilarPhotos } from '../core/similarPhotos';
import { EnhanceSheet } from './Enhance';

type Filter = 'all' | 'kept' | 'notToday';
const PAGE = 60;

/**
 * Pozele intră în scenă când ajung pe ecran (nu toate odată, la încărcare):
 * un singur observator pentru tot zidul, care pune clasa `in`.
 */
function useReveal(): (el: HTMLElement | null) => void {
  const io = useRef<IntersectionObserver | null>(null);
  useEffect(() => () => io.current?.disconnect(), []);
  // Creat la prima folosire: ref-urile se leagă înaintea efectelor.
  return el => {
    if (!el || el.classList.contains('in')) return;
    if (typeof IntersectionObserver === 'undefined') { el.classList.add('in'); return; }
    io.current ??= new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.current?.unobserve(e.target); }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
    io.current.observe(el);
  };
}

/**
 * lumin/GalleryWall.tsx
 * Galeria ca galerie: pe fiecare lună, cea mai bună poză mare (cu mișcare
 * lentă), apoi un zid de poze care intră în scenă pe rând când derulezi.
 * O atingere deschide poza mare, peste tot ecranul, cu ce a văzut AI-ul în ea.
 */
export function GalleryWall() {
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);
  const tr = useTr();
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(PAGE);
  const [viewer, setViewer] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  /** „Asemănătoare”: poza de plecare și cele care seamănă cu ea (după ce se vede, nu după dată). */
  const [similar, setSimilar] = useState<{ source: string; ids: string[] } | null>(null);
  const setNotice = useStore(s => s.setNotice);
  const sentinel = useRef<HTMLDivElement>(null);

  const list = useMemo(() => {
    if (similar) {
      const byId = new Map(photos.map(p => [p.id, p]));
      return [similar.source, ...similar.ids].map(id => byId.get(id)).filter((p): p is PhotoView => !!p);
    }
    // Cu o căutare: și documentele (bonul de benzină se caută), în ordinea potrivirii.
    if (query.trim()) return searchPhotos(photos, query);
    return photos
      .filter(p => !p.aside)
      .filter(p => filter === 'all' || (filter === 'kept' ? p.status === 'selected' : p.status === 'rejected'))
      .sort((a, b) => photoTime(b) - photoTime(a));
  }, [photos, filter, query, similar]);
  const reveal = useReveal();

  useEffect(() => { setShown(PAGE); }, [filter, query, similar]);

  const showSimilar = async (id: string) => {
    const rows = await db.analyses.toArray();
    const ids = findSimilarPhotos(rows.map(a => ({ photoId: a.photoId, imageEmbedding: a.imageEmbedding })), id);
    if (!ids.length) { setNotice(tr('lx.similar.none')); return; }
    setViewer(null);
    setQuery('');
    setSimilar({ source: id, ids });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
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

  const count = (f: Filter) => photos.filter(p => !p.aside && (f === 'all' || p.status === (f === 'kept' ? 'selected' : 'rejected'))).length;

  return (
    <div className="lx-wall-wrap">
      <label className="lx-search">
        <span aria-hidden="true">⌕</span>
        <input type="search" value={query} onChange={e => { setSimilar(null); setQuery(e.target.value); }} placeholder={tr('lx.search.placeholder')} aria-label={tr('lx.search.placeholder')} />
        {query && <button onClick={() => setQuery('')} aria-label={tr('lx.close')}>✕</button>}
      </label>
      {query.trim() && <p className="lx-hint">{tr('lx.search.results', { count: list.length })}</p>}
      {similar && (
        <div className="lx-similar-head">
          <span>{tr('lx.similar.title', { count: list.length - 1 })}</span>
          <button className="lx-chip-btn on" onClick={() => setSimilar(null)}>✕ {tr('lx.similar.clear')}</button>
        </div>
      )}
      {!query.trim() && !similar && (
        <div className="lx-chips lx-wall-filters">
          {(['all', 'kept', 'notToday'] as Filter[]).map(f => (
            <button key={f} className={filter === f ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setFilter(f)}>
              {tr(`lx.wall.${f}`)} <b>{count(f)}</b>
            </button>
          ))}
        </div>
      )}
      {list.length === 0 && <p className="lx-empty">{tr('lx.wall.empty')}</p>}
      {months.map(m => {
        // Coperta lunii: cea mai bună poză păstrată (altfel cea cu scorul cel mai mare).
        const hero = [...m.items].sort((a, b) =>
          Number(b.p.status === 'selected') - Number(a.p.status === 'selected') || b.p.aiScore - a.p.aiScore)[0];
        const rest = m.items.filter(x => x !== hero);
        return (
          <section key={m.start} className="lx-wall-month">
            <h3 className="lx-wall-head"><span>{monthLabel(m.start, locale)}</span><small>{tr('lx.brain.photos', { count: m.items.length })}</small></h3>
            {!query.trim() && !similar && hero && (
              <button className="lx-hero-tile" ref={reveal} onClick={() => setViewer(hero.i)}>
                <Thumb id={hero.p.id} lqip={hero.p.lqip} edits={hero.p.edits} full />
                <span className="lx-hero-shade" />
                <span className="lx-hero-caption">
                  <b>{tr('lx.wall.best')}</b>
                  <span>{reasonsFor(hero.p).filter(r => r.tone === 'good').map(r => tr(r.key)).join(' · ') || `AI ${hero.p.aiScore}`}</span>
                </span>
              </button>
            )}
            <div className="lx-wall">
              {(query.trim() || similar ? m.items : rest).map(({ p, i }) => (
                <button key={p.id} ref={reveal} className={`lx-tile ${p.status}`} style={{ ['--d' as string]: `${(i % 6) * 60}ms`, ['--float' as string]: `${(i % 7) * 0.7}s` }}
                  onClick={() => setViewer(i)}>
                  <Thumb id={p.id} lqip={p.lqip} edits={p.edits} />
                  {p.status === 'selected' && <span className="lx-tile-star">★</span>}
                  {p.status === 'rejected' && <span className="lx-tile-dot" title={tr('lx.wall.state.notToday')} />}
                </button>
              ))}
            </div>
          </section>
        );
      })}
      <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
      {viewer !== null && list[viewer] && (
        <Viewer list={list} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} onSimilar={id => void showSimilar(id)} />
      )}
    </div>
  );
}

/**
 * Poza mare, peste tot ecranul: glisezi stânga/dreapta între poze, în jos ca
 * s-o închizi. Randată în afara ecranului animat (portal) — înăuntru, poziția
 * „fixă” se calcula față de toată lista, iar poza ajungea sub bara de jos sau
 * în afara ecranului (raportat: „se vede ciudat”, „respinsa se vede negru”).
 */
export function Viewer({ list, index, onIndex, onClose, onSimilar }: {
  list: PhotoView[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** „Asemănătoare” — doar unde există o listă în care să le arătăm. */
  onSimilar?: (id: string) => void;
}) {
  const [enhancing, setEnhancing] = useState(false);
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const setStatus = useStore(s => s.setStatus);
  const exportSelection = useStore(s => s.exportSelection);
  const live = useStore(s => s.photos);
  const p = live.find(x => x.id === list[index].id) ?? list[index];
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dir, setDir] = useState<'next' | 'prev' | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (enhancing) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
  const fade = Math.max(0.35, 1 - Math.max(0, drag.y) / 400);

  return createPortal(
    <div className="lx lx-viewer" role="dialog" aria-modal="true" style={{ ['--fade' as string]: `${fade}` }}>
      <div className="lx-viewer-backdrop" aria-hidden="true">
        <Thumb key={`bg-${p.id}`} id={p.id} lqip={p.lqip} />
      </div>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{date}</span>
        <span className="lx-viewer-count">{index + 1}/{list.length}</span>
      </header>
      <div className="lx-viewer-stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div key={p.id} className={`lx-viewer-photo ${dir ?? ''}`}
          style={{ transform: `translate(${drag.x}px, ${Math.max(0, drag.y)}px) scale(${1 - Math.max(0, drag.y) / 1600})` }}>
          <Thumb id={p.id} lqip={p.lqip} edits={p.edits} full />
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
        <div className="lx-viewer-tools">
          <button className="lx-chip-btn magic" onClick={() => setEnhancing(true)}>✨ {tr('lx.enhance.button')}</button>
          {onSimilar && <button className="lx-chip-btn" onClick={() => onSimilar(p.id)}>◎ {tr('lx.similar.button')}</button>}
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
      {enhancing && <EnhanceSheet photo={p} onClose={() => setEnhancing(false)} />}
    </div>,
    document.body
  );
}
