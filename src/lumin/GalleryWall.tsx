import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { canVoiceSearch, haptic, isUltraHdr, setHdrMode, voiceSearch } from '../core/device';
import { useLx } from './lxStore';
import { closeWithTransition, openWithTransition } from './viewTransition';
import { useLxPhotos } from './useLxPhotos';
import { flushSync } from 'react-dom';
import { createPortal } from 'react-dom';
import { useStore, type PhotoView } from '../state/store';
import { photoTime } from './days';
import { monthLabel } from './format';
import { monthStart } from './coverage';
import { reasonsFor } from './reasons';
import { personalWhy, useWhyContext } from './why';
import { learnFromOpen, learnFromShare } from './signals';
import { findVisuallySimilar } from './visualSimilar';
import { InstaSheet } from './InstaSheet';
import { folderCounts, inFolder, SMART_FOLDERS, type SmartFolder } from './smartFolders';
import { MagicSheet } from './MagicSheet';
import { TextSheet } from './TextSheet';
import { hidePhotos } from './PrivatePhotos';
import { CaptionSheet, CloudLine } from './CloudParts';
import { cloudAvailable, cloudConcepts, cloudEnabled, cloudSearchText, readVerdicts } from './cloud';
import { translateSceneTag } from '../core/sceneTagLabels';
import { useTr } from './context';
import { Thumb } from './Thumb';
import { searchPhotos } from './textSearch';
import { db } from '../core/db';
import { findSimilarPhotos } from '../core/similarPhotos';
import { EnhanceSheet } from './Enhance';
import { SCREEN_SIZE, originalUri, sharpUrl, sizeFor } from './sharp';
import { CleanupCard } from './Cleanup';

type Filter = 'all' | 'kept' | 'notToday';
const PAGE = 60;

/**
 * Pozele intră în scenă când ajung pe ecran (nu toate odată, la încărcare):
 * un singur observator pentru tot zidul, care pune clasa `in`.
 */
function useReveal(): (el: HTMLElement | null) => void {
  const io = useRef<IntersectionObserver | null>(null);
  useEffect(() => () => io.current?.disconnect(), []);
  // Aceeași funcție la fiecare randare: altfel React o re-leagă pe fiecare dală
  // la orice schimbare. Observatorul, creat la prima folosire (ref-urile se leagă înaintea efectelor).
  return useCallback((el: HTMLElement | null) => {
    if (!el || el.classList.contains('in')) return;
    if (typeof IntersectionObserver === 'undefined') { el.classList.add('in'); return; }
    io.current ??= new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.current?.unobserve(e.target); }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
    io.current.observe(el);
  }, []);
}

/**
 * lumin/GalleryWall.tsx
 * Galeria ca galerie profesională: un mozaic fără goluri (pozele păstrate
 * mari, unele înalte), zoom cu două degete între 2 și 5 coloane, coperta
 * fiecărei luni cu adâncime la derulare, pozele care intră în scenă în 3D și
 * o bară de timp în dreapta pentru a sări la orice lună. O atingere: poza
 * „zboară” din grilă pe tot ecranul.
 *
 * Doar transform și opacitate în animații — filtrele mari (blur) făceau
 * straturi negre pe telefoanele mai slabe.
 */
type Density = 2 | 3 | 4 | 5;
const DENSITY_KEY = 'lumin-wall-density';
const GAP = 6;

function readDensity(): Density {
  try { const n = Number(localStorage.getItem(DENSITY_KEY)); if (n >= 2 && n <= 5) return n as Density; } catch { /* fără stocare */ }
  return 3;
}

/** Cât ocupă o poză în mozaic: păstratele mari, câte una înaltă pentru ritm. */
/**
 * Mărimea fiecărei dale, pe toată luna deodată, ca mozaicul să nu lase goluri.
 * Raportat: la început mozaic, apoi poze mari una sub alta cu coloana din dreapta
 * goală — când multe poze la rând erau „mari”, nu mai rămâneau poze mici care să
 * umple locul de lângă ele. Acum, după o poză mare sau înaltă urmează mereu
 * destule poze mici cât să umple exact golul lăsat lângă ea.
 */
export function computeSpans(list: readonly PhotoView[], density: Density): ('big' | 'tall' | '')[] {
  const out: ('big' | 'tall' | '')[] = [];
  let need = 0; // câte dale mici mai trebuie până la următoarea mare/înaltă
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const left = list.length - i - 1;
    let span: 'big' | 'tall' | '' = '';
    if (need === 0) {
      if (density === 2) {
        // Pe două coloane, o poză înaltă lasă o coloană × 2 rânduri: 2 mici.
        if (p.status === 'selected' && i % 3 === 0 && left >= 2) { span = 'tall'; need = 2; }
      } else if (p.status === 'selected' && p.aiScore >= 60 && left >= 2 * density - 4) {
        span = 'big'; need = 2 * density - 4;
      } else if (i % 7 === 3 && left >= 2 * density - 2) {
        span = 'tall'; need = 2 * density - 2;
      }
    } else need--;
    out.push(span);
  }
  return out;
}

/**
 * Cine derulează de fapt: în aplicație e `body` (nu fereastra), așa că
 * ascultăm pe document, cu captură — prinde derularea oricărui container.
 */
function onAnyScroll(fn: (el: Element) => void): () => void {
  const h = (e: Event) => {
    const t = e.target;
    fn(t instanceof Element ? t : (document.scrollingElement ?? document.documentElement));
  };
  document.addEventListener('scroll', h, { capture: true, passive: true });
  return () => document.removeEventListener('scroll', h, { capture: true });
}

function scrollToTop() {
  for (const el of [document.scrollingElement, document.body]) el?.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Rezerva pentru „Asemănătoare” când poza n-are încă amprentă vizuală: ce se
 * vede în ea (etichetele de scenă) și cine e în ea, potrivite cu restul.
 */
export function similarByContent(photos: readonly PhotoView[], id: string, limit = 40): string[] {
  const src = photos.find(p => p.id === id);
  if (!src) return [];
  const bag = (p: PhotoView) => new Set([...(p.sceneTags ?? []).map(t => t.toLowerCase()), ...p.personNames.map(n => `@${n}`)]);
  const a = bag(src);
  if (!a.size) return [];
  return photos
    .filter(p => p.id !== id && !p.aside)
    .map(p => {
      const b = bag(p);
      let common = 0;
      for (const x of b) if (a.has(x)) common++;
      return { id: p.id, score: common / (a.size + b.size - common || 1) };
    })
    .filter(x => x.score >= 0.34)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map(x => x.id);
}

/** Schimbă ceva cu tranziție animată între stări, unde telefonul o are (View Transitions). */
function withTransition(change: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) doc.startViewTransition(() => flushSync(change));
  else change();
}

export function GalleryWall() {
  const photos = useLxPhotos();
  const locale = useStore(s => s.locale);
  const tr = useTr();
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(PAGE);
  const [viewer, setViewer] = useState<{ index: number; origin: DOMRect | null } | null>(null);
  const [query, setQuery] = useState('');
  /** Dosarul inteligent deschis („Mașina”, „Mâncare”…), din etichetele pozelor. */
  const [folder, setFolder] = useState<SmartFolder | null>(null);
  /** Ce a înțeles AI-ul online din căutare, când pe telefon nu s-a găsit nimic („tort” → cake). */
  const [aiTerms, setAiTerms] = useState<{ q: string; terms: string[] } | null>(null);
  /** „Asemănătoare”: poza de plecare și cele care seamănă cu ea (după ce se vede, nu după dată). */
  const [similar, setSimilar] = useState<{ source: string; ids: string[] } | null>(null);
  const [density, setDensityState] = useState<Density>(readDensity);
  const setNotice = useStore(s => s.setNotice);
  const sentinel = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState(120);

  const list = useMemo(() => {
    if (similar) {
      const byId = new Map(photos.map(p => [p.id, p]));
      return [similar.source, ...similar.ids].map(id => byId.get(id)).filter((p): p is PhotoView => !!p);
    }
    if (folder) return photos.filter(p => inFolder(p, folder)).sort((a, b) => photoTime(b) - photoTime(a));
    // Cu o căutare: și documentele (bonul de benzină se caută), în ordinea potrivirii.
    if (query.trim()) {
      // Și ce a văzut Lumi Cloud în poză (descriere + etichete), unde există.
      const verdicts = readVerdicts();
      const searchable = photos.map(p => (verdicts[p.id] ? { ...p, aiDescription: `${p.aiDescription ?? ''} ${cloudSearchText(p.id, verdicts)}` } : p));
      const found = searchPhotos(searchable, query);
      if (found.length || aiTerms?.q !== query.trim()) return found;
      const seen = new Set<string>();
      return aiTerms.terms.flatMap(t => searchPhotos(searchable, t)).filter(p => !seen.has(p.id) && !!seen.add(p.id));
    }
    return photos
      .filter(p => !p.aside)
      .filter(p => filter === 'all' || (filter === 'kept' ? p.status === 'selected' : p.status === 'rejected'))
      .sort((a, b) => photoTime(b) - photoTime(a));
  }, [photos, filter, query, similar, aiTerms, folder]);
  const folders = useMemo(() => folderCounts(photos), [photos]);
  const reveal = useReveal();
  // Nimic găsit pe telefon: întreabă AI-ul online ce înseamnă căutarea, în etichetele pe care le avem.
  const nothingFound = !!query.trim() && !similar && list.length === 0;
  useEffect(() => {
    const q = query.trim();
    if (!nothingFound || !cloudEnabled() || aiTerms?.q === q) return;
    const timer = window.setTimeout(() => {
      const vocab = [...new Set(photos.flatMap(p => p.sceneTags ?? []))].slice(0, 600);
      void cloudConcepts(q, vocab).then(terms => setAiTerms({ q, terms }));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [nothingFound, query, photos, aiTerms]);

  const setDensity = (d: Density) => {
    if (d === density) return;
    try { localStorage.setItem(DENSITY_KEY, String(d)); } catch { /* fără stocare */ }
    withTransition(() => setDensityState(d));
  };

  // Latura unei celule, din lățimea reală: rândurile mozaicului sunt pătrate.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setCell(Math.max(40, (el.clientWidth - GAP * (density - 1)) / density));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [density]);

  // Zoom cu două degete: depărtat = mai puține coloane, apropiat = mai multe.
  const pinch = useRef<{ d: number; done: boolean } | null>(null);
  const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const onTouchStart = (e: TouchEvent) => { if (e.touches.length === 2) pinch.current = { d: dist(e.touches), done: false }; };
  const onTouchMove = (e: TouchEvent) => {
    const g = pinch.current;
    if (!g || g.done || e.touches.length !== 2) return;
    const r = dist(e.touches) / g.d;
    if (r > 1.25 && density > 2) { g.done = true; setDensity((density - 1) as Density); }
    else if (r < 0.8 && density < 5) { g.done = true; setDensity((density + 1) as Density); }
  };
  const onTouchEnd = () => { pinch.current = null; };

  // Coperta lunii: adâncime la derulare (o singură ascultare, pe cadru).
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = 0;
      const h = window.innerHeight;
      document.querySelectorAll<HTMLElement>('.lx-hero-tile.in').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > h) return;
        const progress = (r.top + r.height / 2 - h / 2) / h;
        el.style.setProperty('--py', `${(progress * -60).toFixed(1)}px`);
      });
    };
    const off = onAnyScroll(() => { if (!frame) frame = requestAnimationFrame(tick); });
    tick();
    return () => { off(); if (frame) cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => { setShown(PAGE); }, [filter, query, similar]);

  const showSimilar = async (id: string) => {
    const rows = await db.analyses.toArray();
    // Trei căi, una peste alta: amprenta vizuală de la import, ce se vede în ea
    // (etichete, oameni) și comparația directă a miniaturilor — merge pe orice poză.
    const merged = new Set(findSimilarPhotos(rows.map(a => ({ photoId: a.photoId, imageEmbedding: a.imageEmbedding })), id));
    for (const x of similarByContent(photos, id)) merged.add(x);
    if (merged.size < 6) for (const x of await findVisuallySimilar(photos.filter(p => !p.aside || p.id === id).map(p => p.id), id)) merged.add(x);
    const ids = [...merged].slice(0, 40);
    if (!ids.length) { setNotice(tr('lx.similar.none')); return; }
    setViewer(null);
    setQuery('');
    setSimilar({ source: id, ids });
    scrollToTop();
  };
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) setShown(n => Math.min(list.length, n + PAGE));
    }, { rootMargin: '800px' });
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
  // Toate lunile din listă, nu doar cele încărcate — pentru bara de timp.
  const allMonths = useMemo(() => {
    const out: number[] = [];
    for (const p of list) { const m = monthStart(photoTime(p)); if (out[out.length - 1] !== m) out.push(m); }
    return out;
  }, [list]);

  const count = (f: Filter) => photos.filter(p => !p.aside && (f === 'all' || p.status === (f === 'kept' ? 'selected' : 'rejected'))).length;
  const open = (i: number, el: HTMLElement) => openWithTransition(() => setViewer({ index: i, origin: el.getBoundingClientRect() }));
  // Aceeași referință pentru toate dalele: o dală se redesenează doar când se schimbă poza ei.
  const openRef = useRef(open);
  openRef.current = open;
  const plain = !query.trim() && !similar;
  const [focused, setFocused] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchFocus = useLx(s => s.searchFocus);
  useEffect(() => { if (searchFocus) searchInput.current?.focus(); }, [searchFocus]);
  // Căutare vocală: „poze cu Maria la mare”, spus în loc de scris.
  const dictate = async () => {
    haptic('tick');
    const text = await voiceSearch(locale === 'en' ? 'en-US' : 'ro-RO', tr('lx.search.voicePrompt'));
    if (text) { setSimilar(null); setQuery(text); }
  };
  // Sugestii de căutare din oamenii tăi: cei mai des văzuți și perechea cea mai des împreună („Ami și mama”).
  const peopleIdeas = useMemo(() => {
    const one = new Map<string, number>();
    const two = new Map<string, number>();
    for (const p of photos) {
      const names = [...new Set(p.personNames)].sort();
      for (const n of names) one.set(n, (one.get(n) ?? 0) + 1);
      for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
        const k = `${names[i]}\u0000${names[j]}`;
        two.set(k, (two.get(k) ?? 0) + 1);
      }
    }
    const top = [...one.entries()].filter(e => e[1] >= 2).sort((a, b) => b[1] - a[1]).slice(0, 4).map(e => e[0]);
    const pairs = [...two.entries()].filter(e => e[1] >= 2).sort((a, b) => b[1] - a[1]).slice(0, 2)
      .map(e => e[0].split('\u0000').join(locale === 'en' ? ' and ' : ' și '));
    return [...pairs, ...top];
  }, [photos, locale]);

  return (
    <div className="lx-wall-wrap" ref={wrap} onTouchStart={e => onTouchStart(e.nativeEvent)} onTouchMove={e => onTouchMove(e.nativeEvent)} onTouchEnd={onTouchEnd}
      style={{ ['--cols' as string]: density, ['--cell' as string]: `${cell}px`, ['--gap' as string]: `${GAP}px` }}>
      <label className="lx-search">
        <span aria-hidden="true">⌕</span>
        <input ref={searchInput} type="search" value={query} onFocus={() => setFocused(true)} onBlur={() => window.setTimeout(() => setFocused(false), 150)} onChange={e => { setSimilar(null); setQuery(e.target.value); }} placeholder={tr('lx.search.placeholder')} aria-label={tr('lx.search.placeholder')} />
        {query && <button onClick={() => setQuery('')} aria-label={tr('lx.close')}>✕</button>}
        {!query && canVoiceSearch() && (
          <button className="lx-mic" onClick={e => { e.preventDefault(); void dictate(); }} aria-label={tr('lx.search.voice')}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>
          </button>
        )}
      </label>
      {!query.trim() && !similar && (folder ? (
        <div className="lx-chips">
          <button className="lx-chip-btn on" onClick={() => setFolder(null)}>✕ {folder.emoji} {tr(`lx.folder.${folder.id}`)} <b>{list.length}</b></button>
        </div>
      ) : (
        <div className="lx-chips lx-folders">
          {SMART_FOLDERS.filter(f => (folders.get(f.id) ?? 0) >= 3).map(f => (
            <button key={f.id} className="lx-chip-btn" onClick={() => setFolder(f)}>{f.emoji} {tr(`lx.folder.${f.id}`)} <b>{folders.get(f.id)}</b></button>
          ))}
        </div>
      ))}
      {focused && !query.trim() && peopleIdeas.length > 0 && (
        <div className="lx-chips lx-search-ideas">
          {peopleIdeas.map(n => <button key={n} className="lx-chip-btn" onMouseDown={e => e.preventDefault()} onClick={() => { setSimilar(null); setQuery(n); }}>{n}</button>)}
        </div>
      )}
      {query.trim() && <p className="lx-hint">{tr('lx.search.results', { count: list.length })}</p>}
      {query.trim() && aiTerms?.q === query.trim() && aiTerms.terms.length > 0 && list.length > 0 && (
        <p className="lx-hint">☁ {tr('lx.search.ai', { terms: aiTerms.terms.map(t => translateSceneTag(t, locale === 'en' ? 'en' : 'ro')).join(', ') })}</p>
      )}
      {similar && (
        <div className="lx-similar-head">
          <span>{tr('lx.similar.title', { count: list.length - 1 })}</span>
          <button className="lx-chip-btn on" onClick={() => setSimilar(null)}>✕ {tr('lx.similar.clear')}</button>
        </div>
      )}
      {plain && (
        <div className="lx-wall-bar">
          <div className="lx-chips lx-wall-filters">
            {(['all', 'kept', 'notToday'] as Filter[]).map(f => (
              <button key={f} className={filter === f ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => withTransition(() => setFilter(f))}>
                {tr(`lx.wall.${f}`)} <b>{count(f)}</b>
              </button>
            ))}
          </div>
          <div className="lx-density" role="group" aria-label={tr('lx.wall.density')}>
            <button onClick={() => setDensity(Math.min(5, density + 1) as Density)} disabled={density >= 5} aria-label={tr('lx.wall.smaller')}>−</button>
            <span aria-hidden="true">{density}</span>
            <button onClick={() => setDensity(Math.max(2, density - 1) as Density)} disabled={density <= 2} aria-label={tr('lx.wall.bigger')}>+</button>
          </div>
        </div>
      )}
      {filter === 'notToday' && plain && <CleanupCard photos={photos.filter(p => !p.aside)} />}
      {list.length === 0 && <p className="lx-empty">{tr('lx.wall.empty')}</p>}
      {months.map(m => {
        // Coperta lunii: cea mai bună poză păstrată (altfel cea cu scorul cel mai mare).
        const hero = [...m.items].sort((a, b) =>
          Number(b.p.status === 'selected') - Number(a.p.status === 'selected') || b.p.aiScore - a.p.aiScore)[0];
        const rest = plain && density <= 3 ? m.items.filter(x => x !== hero) : m.items;
        const spans = computeSpans(rest.map(x => x.p), density);
        const kept = m.items.filter(x => x.p.status === 'selected').length;
        return (
          <section key={m.start} className="lx-wall-month" data-month={m.start}>
            <h3 className="lx-wall-head">
              <span>{monthLabel(m.start, locale)}</span>
              <small>{tr('lx.wall.monthMeta', { count: m.items.length, kept })}</small>
            </h3>
            {plain && density <= 3 && hero && (
              <button className="lx-hero-tile" ref={reveal} onClick={e => open(hero.i, e.currentTarget)} style={{ viewTransitionName: `h${m.start}` } as CSSProperties}>
                <span className="lx-hero-media"><Thumb id={hero.p.id} lqip={hero.p.lqip} edits={hero.p.edits} full /></span>
                <span className="lx-hero-shade" />
                <span className="lx-hero-caption">
                  <span className="lx-hero-badge">✦ {tr('lx.wall.best')}</span>
                  <b>{monthLabel(m.start, locale)}</b>
                  <span>{reasonsFor(hero.p).filter(r => r.tone === 'good').map(r => tr(r.key)).join(' · ') || `AI ${hero.p.aiScore}`}</span>
                </span>
              </button>
            )}
            <div className={`lx-bento d${density}`}>
              {rest.map(({ p, i }, k) => (
                <Tile key={p.id} p={p} index={i} span={spans[k]} delay={(k % 8) * 45}
                  sharp={sizeFor(cell * (spans[k] === 'big' ? 2 : 1))} reveal={reveal} onOpen={openRef} />
              ))}
            </div>
          </section>
        );
      })}
      <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
      {allMonths.length > 2 && <TimeRail months={allMonths} locale={locale} onPick={start => {
        // Lunile încă neîncărcate: încarcă până la ea, apoi sari.
        const need = list.findIndex(p => monthStart(photoTime(p)) === start);
        if (need >= shown) setShown(Math.min(list.length, need + PAGE));
        requestAnimationFrame(() => document.querySelector(`[data-month="${start}"]`)?.scrollIntoView({ block: 'start' }));
      }} />}
      {viewer !== null && list[viewer.index] && (
        <Viewer list={list} index={viewer.index} origin={viewer.origin}
          onIndex={i => setViewer({ index: i, origin: null })} onClose={() => closeWithTransition(() => setViewer(null), list[viewer.index]?.id)} onSimilar={id => void showSimilar(id)} />
      )}
    </div>
  );
}

/** O dală din mozaic. Memo: la „Păstrez” se redesenează doar dala schimbată, nu toată galeria. */
const Tile = memo(function Tile({ p, index, span, delay, sharp, reveal, onOpen }: {
  p: PhotoView; index: number; span: string; delay: number; sharp: number;
  reveal: (el: HTMLElement | null) => void;
  onOpen: { current: (i: number, el: HTMLElement) => void };
}) {
  const tr = useTr();
  return (
    <button ref={reveal} className={`lx-tile ${p.status} ${span}`}
      style={{ ['--d' as string]: `${delay}ms`, viewTransitionName: `t${p.id.replace(/[^a-zA-Z0-9_-]/g, '')}` } as CSSProperties}
      onClick={e => onOpen.current(index, e.currentTarget)}>
      <Thumb id={p.id} lqip={p.lqip} edits={p.edits} sharp={sharp} />
      {p.status === 'selected' && <span className="lx-tile-star">★</span>}
      {p.status === 'rejected' && <span className="lx-tile-dot" title={tr('lx.wall.state.notToday')} />}
    </button>
  );
});

/**
 * Bara de timp, în dreapta (ca la galeriile mari): apare când derulezi; o
 * tragi și sari la orice lună, cu numele lunii într-o bulă lângă deget.
 */
function TimeRail({ months, locale, onPick }: { months: number[]; locale: string; onPick: (start: number) => void }) {
  const [active, setActive] = useState(false);
  const [drag, setDrag] = useState<{ y: number; month: number } | null>(null);
  const [frac, setFrac] = useState(0);
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let t = 0;
    const off = onAnyScroll(el => {
      if (el.scrollHeight <= el.clientHeight + 200) return; // derulări mici (rânduri de butoane), nu pagina
      const max = el.scrollHeight - el.clientHeight;
      setFrac(max > 0 ? Math.min(1, el.scrollTop / max) : 0);
      setActive(true); window.clearTimeout(t); t = window.setTimeout(() => setActive(false), 1400);
    });
    return () => { off(); window.clearTimeout(t); };
  }, []);
  const pick = (clientY: number) => {
    const r = rail.current?.getBoundingClientRect();
    if (!r) return;
    const f = Math.max(0, Math.min(0.999, (clientY - r.top) / r.height));
    const month = months[Math.floor(f * months.length)];
    setDrag(d => (d?.month === month ? { ...d, y: clientY - r.top } : { y: clientY - r.top, month }));
    if (drag?.month !== month) onPick(month);
  };
  return (
    <div ref={rail} className={active || drag ? 'lx-rail on' : 'lx-rail'}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pick(e.clientY); }}
      onPointerMove={e => { if (drag) pick(e.clientY); }}
      onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
      {months.map((m, i) => <i key={m} style={{ top: `${(i / months.length) * 100}%` }} />)}
      <span className="lx-rail-thumb" style={{ top: drag ? drag.y : `${frac * 100}%` }} />
      {drag && <span className="lx-rail-bubble" style={{ top: drag.y }}>{monthLabel(drag.month, locale)}</span>}
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
  /** De unde vine poza (dala din grilă). Păstrat pentru apelanți; apariția nu mai scalează. */
  origin?: DOMRect | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** „Asemănătoare” — doar unde există o listă în care să le arătăm. */
  onSimilar?: (id: string) => void;
}) {
  const [enhancing, setEnhancing] = useState(false);
  const [writing, setWriting] = useState(false);
  const [insta, setInsta] = useState(false);
  const [magic, setMagic] = useState(false);
  const [texting, setTexting] = useState(false);
  const tr = useTr();
  const why = useWhyContext();
  const locale = useStore(s => s.locale);
  const setStatus = useStore(s => s.setStatus);
  const exportSelection = useStore(s => s.exportSelection);
  const deleteRejectedPhotos = useStore(s => s.deleteRejectedPhotos);
  // Doar poza asta din magazin: viewerul nu se redesenează la orice altă schimbare.
  const id = list[index].id;
  const p = useStore(s => s.photos.find(x => x.id === id)) ?? list[index];
  const start = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const [dir, setDir] = useState<'next' | 'prev' | null>(null);

  // Ultra HDR: pe telefoanele care o permit, ecranul trece în modul HDR cât
  // stă deschisă o poză făcută așa, ca luminile ei să arate cum au fost.
  useEffect(() => {
    let alive = true;
    void originalUri(id).then(uri => uri ? isUltraHdr(uri) : false).then(hdr => { if (alive) setHdrMode(hdr); });
    return () => { alive = false; };
  }, [id]);
  useEffect(() => () => setHdrMode(false), []);

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

  const photoRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoomRaw] = useState<{ s: number; x: number; y: number }>({ s: 1, x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  /** Mărimea pozei pe ecran, nemărită — de la ea se calculează mărirea. */
  const baseRef = useRef({ w: 0, h: 0 });
  /**
   * Mărirea: poza primește lățimea și înălțimea reale (de s ori), deci se
   * desenează clar, iar mutarea e ținută în margini — nu fuge din ecran și
   * ajungi în orice colț. (Cu `zoom` din CSS rămânea prinsă în colțul din stânga sus.)
   */
  const setZoom = (next: { s: number; x: number; y: number } | ((z: { s: number; x: number; y: number }) => { s: number; x: number; y: number })) => {
    setZoomRaw(prev => {
      const z = typeof next === 'function' ? next(prev) : next;
      if (z.s <= 1) return { s: 1, x: 0, y: 0 };
      if (prev.s <= 1) {
        const r = photoRef.current?.getBoundingClientRect();
        if (r) baseRef.current = { w: r.width, h: r.height };
      }
      const st = stageRef.current?.getBoundingClientRect();
      const mx = Math.max(0, (baseRef.current.w * z.s - (st?.width ?? 0)) / 2);
      const my = Math.max(0, (baseRef.current.h * z.s - (st?.height ?? 0)) / 2);
      return { s: z.s, x: Math.max(-mx, Math.min(mx, z.x)), y: Math.max(-my, Math.min(my, z.y)) };
    });
  };
  const lastTap = useRef(0);

  // Zborul din grilă: poza pleacă din dala atinsă și crește până la locul ei.
  // Web Animations, fără „fill”: la final rămâne starea normală din CSS, deci
  // nimic nu poate rămâne blocat pe jumătate (cum rămânea pe unele telefoane).
  useLayoutEffect(() => {
    const el = photoRef.current;
    const root = rootRef.current;
    if (!root || typeof root.animate !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    root.querySelector('.lx-viewer-bg')?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
    root.querySelector('.lx-viewer-info')?.animate(
      [{ transform: 'translateY(60px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 480, delay: 120, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    // Poza apare (opacitate + o mică ridicare), FĂRĂ scalare: o animație de
    // mărire îl lăsa pe telefon desenat la mărimea mică de la început — poza
    // ieșea neclară sau pe bucăți (raportat).
    if (!el) return;
    el.animate([{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.9,.25,1)' });
  }, []);
  useEffect(() => { setZoom({ s: 1, x: 0, y: 0 }); learnFromOpen(p); }, [p.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Cât e deschisă poza mare, galeria din spate nu se mai desenează: memoria
  // grafică rămâne pentru poza mare (altfel apărea neclară sau pe bucăți).
  useEffect(() => {
    document.body.classList.add('lx-viewer-open');
    return () => document.body.classList.remove('lx-viewer-open');
  }, []);
  // Pregătește din timp poza clară de dinainte și de după: glisarea nu mai așteaptă.
  useEffect(() => {
    for (const k of [index + 1, index - 1, index + 2]) if (list[k]) void sharpUrl(list[k].id, SCREEN_SIZE);
  }, [index, list]);

  /** Mută poza direct (fără redesenare React la fiecare mișcare a degetului). */
  const place = (dx: number, dy: number, animate = false) => {
    const el = photoRef.current;
    if (!el) return;
    el.style.transition = animate ? 'transform .28s cubic-bezier(.2,.9,.25,1)' : 'none';
    const down = Math.max(0, dy);
    el.style.transform = dx || dy ? `translate3d(${dx}px, ${down}px, 0) scale(${1 - down / 1600})` : '';
    rootRef.current?.style.setProperty('--fade', `${Math.max(0.35, 1 - down / 400)}`);
  };

  const go = (step: number) => {
    const next = index + step;
    if (next < 0 || next >= list.length) return;
    setDir(step > 0 ? 'next' : 'prev');
    onIndex(next);
  };
  // Două degete: mărire liberă (1–4×).
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; s: number } | null>(null);
  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      pinch.current = { d: spread(), s: zoom.s };
      start.current = null;
      if (zoom.s <= 1) place(0, 0);
      return;
    }
    // Dublă atingere: mărește de 2,5× acolo unde ai atins (sau revine).
    const now = Date.now();
    if (now - lastTap.current < 280) {
      lastTap.current = 0;
      const r = photoRef.current?.getBoundingClientRect();
      if (zoom.s > 1 || !r) setZoom({ s: 1, x: 0, y: 0 });
      else setZoom({ s: 2.5, x: (r.left + r.width / 2 - e.clientX) * 1.5, y: (r.top + r.height / 2 - e.clientY) * 1.5 });
      start.current = null;
      return;
    }
    lastTap.current = now;
    start.current = { x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const ratio = spread() / (pinch.current.d || 1);
      const next = Math.max(1, Math.min(5, pinch.current.s * ratio));
      setZoom(z => ({ s: next, x: z.s > 1 ? (z.x * next) / z.s : 0, y: z.s > 1 ? (z.y * next) / z.s : 0 }));
      return;
    }
    if (!start.current) return;
    if (zoom.s > 1) {
      // Mărită: tragi de poză, nu treci la alta.
      const dx = e.clientX - start.current.x, dy = e.clientY - start.current.y;
      start.current = { x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
      if (photoRef.current) photoRef.current.style.transition = 'none'; // poza urmează degetul, fără întârziere
      setZoom(z => ({ ...z, x: z.x + dx, y: z.y + dy }));
      return;
    }
    const g = start.current;
    g.dx = e.clientX - g.x;
    g.dy = e.clientY - g.y;
    place(g.dx, g.dy);
  };
  const onUp = (e?: PointerEvent<HTMLDivElement>) => {
    if (e) pointers.current.delete(e.pointerId);
    if (pinch.current) {
      if (pointers.current.size < 2) {
        pinch.current = null;
        setZoom(z => (z.s < 1.08 ? { s: 1, x: 0, y: 0 } : z));
      }
      return;
    }
    const g = start.current;
    if (!g) return;
    start.current = null;
    if (zoom.s > 1) return;
    if (g.dy > 120 && Math.abs(g.dy) > Math.abs(g.dx)) { onClose(); return; }
    const step = g.dx < -60 ? 1 : g.dx > 60 ? -1 : 0;
    if (step && list[index + step]) { place(0, 0); go(step); return; }
    place(0, 0, true);
  };
  const date = new Date(photoTime(p)).toLocaleString(locale === 'en' ? 'en-GB' : 'ro-RO', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

  return createPortal(
    <div className="lx lx-viewer" ref={rootRef} role="dialog" aria-modal="true">
      <div className="lx-viewer-bg" aria-hidden="true" />
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{date}</span>
        <span className="lx-viewer-count">{index + 1}/{list.length}</span>
      </header>
      <div className="lx-viewer-stage" ref={stageRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div key={p.id} ref={photoRef} className={`lx-viewer-photo ${dir ?? ''}${zoom.s > 1 ? ' zoomed' : ''}`}
          style={zoom.s > 1 ? {
            position: 'absolute', left: '50%', top: '50%', maxWidth: 'none', maxHeight: 'none',
            width: baseRef.current.w * zoom.s, height: baseRef.current.h * zoom.s,
            transform: `translate(calc(-50% + ${zoom.x}px), calc(-50% + ${zoom.y}px))`
          } as CSSProperties : undefined}>
          <Thumb id={p.id} lqip={p.lqip} edits={p.edits} full />
        </div>
        {/* Săgețile: se vede că poți trece la poza următoare (sau glisezi). */}
        {index > 0 && zoom.s === 1 && (
          <button className="lx-viewer-arrow prev" onPointerDown={e => e.stopPropagation()} onClick={() => go(-1)} aria-label={tr('lx.viewer.prev')}>‹</button>
        )}
        {index < list.length - 1 && zoom.s === 1 && (
          <button className="lx-viewer-arrow next" onPointerDown={e => e.stopPropagation()} onClick={() => go(1)} aria-label={tr('lx.viewer.next')}>›</button>
        )}
      </div>
      <div className="lx-viewer-info">
        <p className="lx-why">{personalWhy(p, why, tr)}</p>
        <CloudLine id={p.id} />
        <div className="lx-chips">
          <span className={`lx-chip ${p.status === 'selected' ? 'good' : p.status === 'rejected' ? 'bad' : 'info'}`}>
            {tr(p.status === 'selected' ? 'lx.wall.state.kept' : p.status === 'rejected' ? 'lx.wall.state.notToday' : 'lx.wall.state.waiting')}
          </span>
          <span className="lx-chip info">AI {p.aiScore}</span>
          {reasonsFor(p).map(r => <span key={r.key} className={`lx-chip ${r.tone}`}>{tr(r.key)}</span>)}
        </div>
        {/* O singură bară, butoane mici cu etichetă: poza rămâne mare. */}
        {/* Două rânduri (raportat: textul din butoane nu încăpea): sus uneltele, cu
            pictogramă și text alăturate; jos deciziile, mari. */}
        <div className="lx-viewer-tools2">
          <button className="lx-tbtn magic" onClick={() => setEnhancing(true)}><span>✨</span>{tr('lx.viewer.enhanceShort')}</button>
          {onSimilar && <button className="lx-tbtn" onClick={() => onSimilar(p.id)}><span>◎</span>{tr('lx.viewer.similarShort')}</button>}
          <button className="lx-tbtn" onClick={() => void exportSelection('apps', [p.id]).then(() => learnFromShare([p]))}><span>↗</span>{tr('lx.wall.share')}</button>
          {cloudAvailable() && <button className="lx-tbtn magic" onClick={() => setMagic(true)}><span>🪄</span>{tr('lx.magic.button')}</button>}
          <button className="lx-tbtn" onClick={() => setInsta(true)}><span>▣</span>{tr('lx.insta.button')}</button>
          <button className="lx-tbtn" onClick={() => setTexting(true)}><span>Aa</span>{tr('lx.text.button')}</button>
          {p.ocrText && p.ocrText.trim().length > 8 && (
            <button className="lx-tbtn" onClick={() => { void navigator.clipboard?.writeText(p.ocrText!.trim()).then(() => useStore.getState().setNotice(tr('lx.viewer.textCopied')), () => {}); }}>
              <span>📋</span>{tr('lx.viewer.copyText')}
            </button>
          )}
          {cloudAvailable() && <button className="lx-tbtn" onClick={() => setWriting(true)}><span>✍</span>{tr('lx.caption.button')}</button>}
          <button className="lx-tbtn" onClick={() => void hidePhotos([p.id], tr).then(done => { if (done) { if (list.length <= 1) onClose(); else onIndex(Math.min(index, list.length - 2)); } })}><span>🔒</span>{tr('lx.private.hide')}</button>
          {p.status === 'rejected' && p.mediaUri && (
            <button className="lx-tbtn danger" onClick={() => void deleteRejectedPhotos([p.id]).then(r => {
              if (!r.deleted) return;
              if (list.length <= 1) onClose(); else onIndex(Math.min(index, list.length - 2));
            })}><span>🗑</span>{tr('lx.viewer.deleteShort')}</button>
          )}
        </div>
        <div className="lx-viewer-decide">
          <button className={p.status === 'rejected' ? 'lx-dbtn drop on' : 'lx-dbtn drop'} onClick={() => void setStatus(p.id, 'rejected')}>
            <span>✕</span>{tr('lx.notToday')}
          </button>
          <button className={p.status === 'selected' ? 'lx-dbtn keep on' : 'lx-dbtn keep'} onClick={() => void setStatus(p.id, 'selected')}>
            <span>✓</span>{tr('lx.keep')}
          </button>
        </div>
      </div>
      {enhancing && <EnhanceSheet photo={p} onClose={() => setEnhancing(false)} />}
      {writing && <CaptionSheet photo={p} onClose={() => setWriting(false)} />}
      {insta && <InstaSheet photo={p} onClose={() => setInsta(false)} />}
      {magic && <MagicSheet photo={p} onClose={() => setMagic(false)} />}
      {texting && <TextSheet photo={p} onClose={() => setTexting(false)} />}
    </div>,
    document.body
  );
}
