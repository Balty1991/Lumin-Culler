import { useHoldAnalysis } from './useHoldAnalysis';
import { AiRetouch } from './AiRetouch';
import { onDeviceEditAvailable } from '../core/onDeviceEdit';
import { memo, useCallback, useContext, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { canVoiceSearch, haptic, isUltraHdr, setHdrMode, voiceSearch } from '../core/device';
import { useLx } from './lxStore';
import { closeWithTransition, openWithTransition } from './viewTransition';
import { PaneActive, useLxPhotos } from './useLxPhotos';
import { flushSync } from 'react-dom';
import { createPortal } from 'react-dom';
import { useStore, type PhotoView } from '../state/store';
import { photoTime } from './days';
import { monthLabel } from './format';
import { monthStart } from './coverage';
import { reasonsFor } from './reasons';
import { personalWhy, useWhyContext } from './why';
import { TwinCompare, betterTwin } from './TwinCompare';
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
import { isTextOnlyMatch, searchPhotos } from './textSearch';
import { clipSearch } from '../core/clip/clipSearch';
import { db } from '../core/db';
import { findSimilarPhotos } from '../core/similarPhotos';
import { Icon } from './icons';
import { planBestTake, renderBestTake, type BestTakeFix } from './bestTake';
import { burstFilmAvailable } from './burstFilm';
import { FilmCreator } from './FilmCreator';
import { CapsuleCreator } from './Capsule';
import { useShieldedShare } from './ShareShield';
import { LivePhotoSheet } from './LivePhoto';
import { livePhotoAvailable } from './livePhoto';
import { RephotoSheet, canRephoto } from './Rephoto';
import { FamilyVote } from './FamilyVote';
import { Tunnel3D } from './Tunnel3D';
import { logError } from '../core/errorLog';
import { saveEditedBlob } from './saveEdited';
import { EnhanceSheet } from './Enhance';
import { SCREEN_SIZE, ZOOM_SIZE, originalUri, sharpUrl, sizeFor } from './sharp';
import { CleanupCard } from './Cleanup';
import { intlTag, baseLocale } from '../i18n';
import { selectBlinks, selectBlurry } from '../state/batchOps';

type Filter = 'all' | 'kept' | 'notToday' | 'blinks' | 'blurry';
const PAGE = 60;

/**
 * Pozele intră în scenă când ajung pe ecran (nu toate odată, la încărcare):
 * un singur observator pentru tot zidul, care pune clasa `in`.
 */
/**
 * Dalele deja arătate, după poză. Clasa „in” pusă de observator se pierdea când
 * React rescria className-ul dalei (starea pozei se schimbă la sortare/import):
 * dala rămânea invizibilă — goluri negre în galerie (raportat cu capturi).
 * Acum dala își cere singură „in” la randare, dacă a mai fost văzută.
 */
const revealed = new Set<string>();

function useReveal(): (el: HTMLElement | null) => void {
  const io = useRef<IntersectionObserver | null>(null);
  useEffect(() => () => io.current?.disconnect(), []);
  // Aceeași funcție la fiecare randare: altfel React o re-leagă pe fiecare dală
  // la orice schimbare. Observatorul, creat la prima folosire (ref-urile se leagă înaintea efectelor).
  return useCallback((el: HTMLElement | null) => {
    if (!el || el.classList.contains('in')) return;
    if (typeof IntersectionObserver === 'undefined') { el.classList.add('in'); return; }
    io.current ??= new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) {
        e.target.classList.add('in');
        const id = (e.target as HTMLElement).dataset.revealId;
        if (id) revealed.add(id);
        io.current?.unobserve(e.target);
      }
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

export function GalleryWall({ toolbar, actions }: { toolbar?: ReactNode; /** Butoanele din dreapta căutării (ex. „+”): antetul galeriei stă pe un singur rând. */ actions?: ReactNode }) {
  const photos = useLxPhotos();
  const locale = useStore(s => s.locale);
  const tr = useTr();
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(PAGE);
  const [viewer, setViewer] = useState<{ index: number; origin: DOMRect | null } | null>(null);
  const [tunnel, setTunnel] = useState(false);
  const [query, setQuery] = useState('');
  const [withDocs, setWithDocs] = useState(false);
  const docCount = useRef(0);
  const visualCount = useRef(0);
  useEffect(() => { setWithDocs(false); }, [query]);
  /** Dosarul inteligent deschis („Mașina”, „Mâncare”…), din etichetele pozelor. */
  const [folder, setFolder] = useState<SmartFolder | null>(null);
  /** Ce a înțeles AI-ul online din căutare, când pe telefon nu s-a găsit nimic („tort” → cake). */
  const [aiTerms, setAiTerms] = useState<{ q: string; terms: string[] } | null>(null);
  /** „Asemănătoare”: poza de plecare și cele care seamănă cu ea (după ce se vede, nu după dată). */
  const [similar, setSimilar] = useState<{ source: string; ids: string[] } | null>(null);
  /** Ce se VEDE în poze (CLIP, pe telefon), pentru cuvintele căutării: „copii la mare la apus”. */
  const [visual, setVisual] = useState<{ q: string; ids: string[] } | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) { setVisual(null); return; }
    let alive = true;
    const timer = window.setTimeout(() => {
      void clipSearch(q).then(ids => { if (alive) setVisual({ q, ids }); });
    }, 450);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [query]);
  const [density, setDensityState] = useState<Density>(readDensity);
  const setNotice = useStore(s => s.setNotice);
  const sentinel = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  // La revenirea în tab, încă o măsurare (lățimea era 0 cât a stat ascuns).
  const paneActive = useContext(PaneActive);
  const [cell, setCell] = useState(() => Math.max(40, (Math.min(window.innerWidth, 720) - 32 - GAP * (density - 1)) / density));

  // Căutarea rulează pe valoarea amânată: tastarea rămâne fluidă pe 1.600+ poze.
  const searchQuery = useDeferredValue(query);
  const list = useMemo(() => {
    if (similar) {
      const byId = new Map(photos.map(p => [p.id, p]));
      return [similar.source, ...similar.ids].map(id => byId.get(id)).filter((p): p is PhotoView => !!p);
    }
    if (folder) return photos.filter(p => inFolder(p, folder)).sort((a, b) => photoTime(b) - photoTime(a));
    // Cu o căutare: și documentele (bonul de benzină se caută), în ordinea potrivirii.
    if (searchQuery.trim()) {
      // Și ce a văzut Lumi Cloud în poză (descriere + etichete), unde există.
      const verdicts = readVerdicts();
      const searchable = photos.map(p => (verdicts[p.id] ? { ...p, aiDescription: `${p.aiDescription ?? ''} ${cloudSearchText(p.id, verdicts)}` } : p));
      const all = searchPhotos(searchable, searchQuery);
      // Pozele întâi; documentele și potrivirile doar din textul citit, separat, la cerere.
      const docs = all.filter(p => isTextOnlyMatch(p, searchQuery));
      const found = docs.length && docs.length < all.length && !withDocs ? all.filter(p => !docs.includes(p)) : all;
      docCount.current = docs.length < all.length ? docs.length : 0;
      // Pe luni, cele mai noi întâi: galeria grupează pe luni, iar ordinea după scor
      // făcea aceeași lună să apară de două ori (auditul).
      const byText = [...found].sort((a, b) => photoTime(b) - photoTime(a));
      // Apoi ce se vede în poze, în ordinea potrivirii, fără documente și fără dubluri.
      if (visual?.q === searchQuery.trim() && visual.ids.length) {
        const have = new Set(byText.map(p => p.id));
        const byId = new Map(searchable.map(p => [p.id, p]));
        const seen = visual.ids.map(id => byId.get(id)).filter((p): p is PhotoView => !!p && !have.has(p.id) && (withDocs || !p.aside));
        visualCount.current = seen.length;
        // Toate după dată: altfel galeria (grupată pe luni) arăta aceeași lună de mai multe ori (raportat).
        return [...byText, ...seen].sort((a, b) => photoTime(b) - photoTime(a));
      }
      visualCount.current = 0;
      if (found.length || aiTerms?.q !== searchQuery.trim()) return byText;
      const seen = new Set<string>();
      return aiTerms.terms.flatMap(t => searchPhotos(searchable, t)).filter(p => !seen.has(p.id) && !!seen.add(p.id));
    }
    const base = photos
      .filter(p => !p.aside)
      .filter(p => filter === 'kept' ? p.status === 'selected' : filter === 'notToday' ? p.status === 'rejected' : true)
      .sort((a, b) => photoTime(b) - photoTime(a));
    if (filter === 'blinks') return selectBlinks(base);
    if (filter === 'blurry') return selectBlurry(base);
    return base;
  }, [photos, filter, searchQuery, similar, aiTerms, folder, withDocs, visual]);
  const folders = useMemo(() => folderCounts(photos), [photos]);
  const issues = useMemo(() => {
    const base = photos.filter(p => !p.aside);
    return { blinks: selectBlinks(base).length, blurry: selectBlurry(base).length };
  }, [photos]);
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

  /**
   * Raportat: la +/− galeria sărea uneori la mijloc. Cauza: browserul își „ancorează”
   * derularea pe o poză de mai jos, iar poza își schimbă locul când se schimbă
   * mărimea. Acum ancora e chiar butonul apăsat: rămâne exact unde era.
   */
  const setDensity = (d: Density, anchor?: Element | null) => {
    if (d === density) return;
    try { localStorage.setItem(DENSITY_KEY, String(d)); } catch { /* fără stocare */ }
    const before = anchor?.getBoundingClientRect().top;
    const root = document.documentElement;
    root.style.overflowAnchor = 'none';
    flushSync(() => setDensityState(d));
    if (anchor && before !== undefined) window.scrollBy(0, anchor.getBoundingClientRect().top - before);
    requestAnimationFrame(() => { root.style.overflowAnchor = ''; });
  };

  // Latura unei celule, din lățimea reală: rândurile mozaicului sunt pătrate.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    // Cât tabul e ascuns, lățimea e 0: rândurile ajungeau la 40 px și pozele apăreau
    // turtite câteva secunde la intrarea în Galerie (raportat cu captură). Atunci se ia
    // lățimea ecranului, nu zero.
    const measure = () => {
      const width = el.clientWidth || Math.min(window.innerWidth, 720) - 32;
      setCell(Math.max(40, (width - GAP * (density - 1)) / density));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [density, paneActive]);

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
    const merged = new Set(findSimilarPhotos(rows.map(a => ({ photoId: a.photoId, imageEmbedding: a.imageEmbedding, clipEmbedding: a.clipEmbedding })), id));
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
      // Fără plafon la lungimea de acum: la import lista crește, iar plafonul oprea grila (raportat).
      if (entries.some(e => e.isIntersecting)) setShown(n => n + PAGE);
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

  const asideCount = useMemo(() => photos.reduce((n, p) => n + (p.aside ? 1 : 0), 0), [photos]);
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
    const text = await voiceSearch(intlTag(locale), tr('lx.search.voicePrompt'));
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
      <div className="lx-search-row">
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
      {actions}
      </div>
      {toolbar}
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
      {query.trim() && (
        <p className="lx-hint lx-search-count">
          {tr('lx.search.results', { count: list.length })}
          {docCount.current > 0 && (
            <button className="lx-link" onClick={() => setWithDocs(v => !v)}>
              {withDocs ? tr('lx.search.hideDocs') : tr('lx.search.showDocs', { count: docCount.current })}
            </button>
          )}
        </p>
      )}
      {query.trim() && visualCount.current > 0 && (
        <p className="lx-hint">👁 {tr('lx.search.visual', { count: visualCount.current })}</p>
      )}
      {query.trim() && aiTerms?.q === query.trim() && aiTerms.terms.length > 0 && list.length > 0 && (
        <p className="lx-hint">☁ {tr('lx.search.ai', { terms: aiTerms.terms.map(t => translateSceneTag(t, baseLocale(locale))).join(', ') })}</p>
      )}
      {similar && (
        <div className="lx-similar-head">
          <span>{tr('lx.similar.title', { count: list.length - 1 })}</span>
          <button className="lx-chip-btn on" onClick={() => setSimilar(null)}>✕ {tr('lx.similar.clear')}</button>
        </div>
      )}
      {plain && (
        <div className="lx-wall-bar">
          <div className="lx-wall-seg" role="tablist">
            {(['all', 'kept', 'notToday'] as Filter[]).map(f => (
              <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => withTransition(() => setFilter(f))}>
                <span>{tr(`lx.wall.${f}`)}</span><b>{count(f)}</b>
              </button>
            ))}
          </div>
          {/* Galerie 3D: călătoria în timp printre pozele din filtrul ales. */}
          <button className="lx-density-btn lx-3d-btn" onClick={() => setTunnel(true)} aria-label={tr('lx.tunnel.open')} disabled={list.length === 0}>
            <b>3D</b>
          </button>
          {/* Mărimea grilei: un singur buton care trece prin 2→5 coloane (și ciupitul merge). */}
          <button className="lx-density-btn" aria-label={`${tr('lx.wall.density')}: ${density}`}
            onClick={e => setDensity((density >= 5 ? 2 : density + 1) as Density, e.currentTarget)}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" d="M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z"/></svg>
            <b>{density}</b>
          </button>
        </div>
      )}
      {plain && (issues.blinks > 0 || issues.blurry > 0 || asideCount > 0) && (
        <div className="lx-chips">
          {/* „Toate” nu numără capturile și documentele: le spunem unde sunt (raportat:
              „De ce în Galerie apar 364, dar ele sunt 1615?”). */}
          {asideCount > 0 && filter === 'all' && (
            <button className="lx-chip-btn" onClick={() => useLx.getState().setGalleryView('aside')}>
              {tr('lx.wall.asideHint')} <b>{asideCount}</b>
            </button>
          )}
          {issues.blinks > 0 && (
            <button className={filter === 'blinks' ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => withTransition(() => setFilter(f => f === 'blinks' ? 'all' : 'blinks'))}>
              {tr('lx.wall.blinks')} <b>{issues.blinks}</b>
            </button>
          )}
          {issues.blurry > 0 && (
            <button className={filter === 'blurry' ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => withTransition(() => setFilter(f => f === 'blurry' ? 'all' : 'blurry'))}>
              {tr('lx.wall.blurry')} <b>{issues.blurry}</b>
            </button>
          )}
        </div>
      )}
      {/* Seriile de ordonat stau în Curățenie: aici galeria începe direct cu pozele (auditul de interfață). */}
      {filter === 'notToday' && plain && <CleanupCard photos={photos.filter(p => !p.aside)} />}
      {list.length === 0 && <p className="lx-empty">{tr(filter === 'blinks' || filter === 'blurry' ? 'lx.wall.kindEmpty' : 'lx.wall.empty')}</p>}
      {months.map(m => {
        // Coperta lunii: doar dintre pozele păstrate, cu oamenii înaintea obiectelor
        // (raportat: „cea mai bună din lună” era un fierbător, într-o lună cu 0 păstrate).
        const hero = m.items.filter(x => x.p.status === 'selected' && !x.p.aside).sort((a, b) =>
          Number((b.p.faceCount ?? 0) > 0) - Number((a.p.faceCount ?? 0) > 0) || b.p.aiScore - a.p.aiScore)[0];
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
              <button className={`lx-hero-tile${revealed.has(`h${m.start}`) ? ' in' : ''}`} data-reveal-id={`h${m.start}`} ref={reveal} onClick={e => open(hero.i, e.currentTarget)}>
                <span className="lx-hero-media"><Thumb id={hero.p.id} lqip={hero.p.lqip} edits={hero.p.edits} full /></span>
                <span className="lx-hero-shade" />
                <span className="lx-hero-caption">
                  <span className="lx-hero-badge">✦ {tr('lx.wall.best')}</span>
                  {/* Luna e deja în titlul secțiunii; aici ziua pozei (nu același titlu de două ori). */}
                  <b>{new Date(photoTime(hero.p)).toLocaleDateString(intlTag(locale), { weekday: 'long', day: 'numeric', month: 'long' })}</b>
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
      {tunnel && <Tunnel3D list={list} onOpen={i => setViewer({ index: i, origin: null })} onClose={() => setTunnel(false)} />}
      {viewer !== null && list[viewer.index] && (
        <Viewer list={list} index={viewer.index} origin={viewer.origin}
          onIndex={i => setViewer({ index: i, origin: null })} onClose={() => (tunnel ? setViewer(null) : closeWithTransition(() => setViewer(null), list[viewer.index]?.id))} onSimilar={id => void showSimilar(id)} />
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
    <button ref={reveal} data-reveal-id={p.id} className={`lx-tile ${p.status} ${span}${revealed.has(p.id) ? ' in' : ''}`}
      style={{ ['--d' as string]: `${delay}ms` } as CSSProperties}
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
/** Panoul de sub poză: rămâne cum l-a lăsat omul, de la o poză la alta. */
let viewerDetailsOpen = false;

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
  // Cât te uiți la o poză, citirea galeriei așteaptă: poza clară vine imediat, nu după rând
  // (văzut într-o înregistrare: ecran gol câteva secunde la deschidere, în timpul citirii).
  useHoldAnalysis();
  const [enhancing, setEnhancing] = useState<boolean | 'perfect'>(false);
  const [writing, setWriting] = useState(false);
  const [insta, setInsta] = useState(false);
  const [magic, setMagic] = useState(false);
  const [more, setMore] = useState(false);
  // „Vinde”: poza produsului pe fundal alb, gata pentru Vinted/OLX (doar unde decupajul rulează pe telefon).
  const [selling, setSelling] = useState(false);
  const [canSell, setCanSell] = useState(false);
  useEffect(() => { void onDeviceEditAvailable().then(a => setCanSell(a.cutout)); }, []);
  const [texting, setTexting] = useState(false);
  const [comparing, setComparing] = useState(false);
  const tr = useTr();
  const why = useWhyContext();
  const locale = useStore(s => s.locale);
  const setStatus = useStore(s => s.setStatus);
  const exportSelection = useStore(s => s.exportSelection);
  const deleteRejectedPhotos = useStore(s => s.deleteRejectedPhotos);
  // Doar poza asta din magazin: viewerul nu se redesenează la orice altă schimbare.
  const id = list[index].id;
  const p = useStore(s => s.photos.find(x => x.id === id)) ?? list[index];
  useEffect(() => { setMore(false); }, [id]);
  // „Poza perfectă din serie”: fețe cu ochii închiși înlocuite din alt cadru al seriei.
  const [bestFix, setBestFix] = useState<BestTakeFix[]>([]);
  const [bestBusy, setBestBusy] = useState(false);
  const groupIds = useStore(s => (p.groupId && p.faceCount > 0 ? s.photos.filter(x => x.groupId === p.groupId).map(x => x.id).join(',') : ''));
  useEffect(() => {
    setBestFix([]);
    if (!groupIds) return;
    let alive = true;
    void planBestTake(id, groupIds.split(',')).then(f => { if (alive) setBestFix(f); }).catch(() => {});
    return () => { alive = false; };
  }, [id, groupIds]);
  const burstIds = useStore(s => (p.groupId ? s.photos.filter(x => x.groupId === p.groupId).sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0)).map(x => x.id).slice(0, 6).join(',') : ''));
  const [details, setDetails] = useState(viewerDetailsOpen);
  const sheetY = useRef<number | null>(null);
  const toggleDetails = (v: boolean) => { viewerDetailsOpen = v; setDetails(v); };
  // Mini-film: se deschide creatorul, cu seria pozei deja pusă (omul adaugă, ordonează, alege stilul).
  const [filmOpen, setFilmOpen] = useState(false);
  const [capsuleOpen, setCapsuleOpen] = useState(false);
  const [tool, setTool] = useState<null | 'live' | 'rephoto' | 'vote'>(null);
  // Trimite: cu scutul (fețe străine estompate, fără locație) când e ceva de protejat.
  const shield = useShieldedShare(p, () => void exportSelection('apps', [p.id]).then(() => learnFromShare([p])));
  const makeBestTake = async () => {
    setBestBusy(true);
    try {
      const blob = await renderBestTake(id, bestFix);
      const ok = blob ? await saveEditedBlob(blob, 'perfecta') : false;
      useStore.getState().setNotice(tr(ok ? 'lx.bestTake.saved' : 'lx.magic.failed'));
    } finally { setBestBusy(false); }
  };
  // Doar pozele pe care AI-ul nu le-ar păstra: „mai e una aproape la fel” — și o poți vedea.
  // „Vezi poza mai reușită”: cea mai bună din aceeași serie, și când diferența e mică
  // (raportat: textul spunea că există una mai bună, dar n-o arăta).
  const twin = useStore(s => {
    if (p.status === 'selected') return null;
    const clear = betterTwin(p, s.photos);
    if (clear || !p.groupId) return clear;
    let best: PhotoView | null = null;
    for (const q of s.photos) if (q.id !== p.id && q.groupId === p.groupId && !q.aside && (!best || q.aiScore > best.aiScore)) best = q;
    return best && best.aiScore >= p.aiScore ? best : null;
  });
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
  const date = new Date(photoTime(p)).toLocaleString(intlTag(locale), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

  return createPortal(
    <div className="lx lx-viewer" ref={rootRef} role="dialog" aria-modal="true">
      {/* Fundal „ambient”: culorile pozei, din miniatura ei mică (deja în memorie, fără filtru). */}
      <div className="lx-viewer-bg" aria-hidden="true" style={p.lqip ? { backgroundImage: `linear-gradient(rgb(4 5 10 / .28), rgb(4 5 10 / .78)), url("${p.lqip}")` } : undefined} />
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
          <Thumb id={p.id} lqip={p.lqip} edits={p.edits} full sharp={zoom.s >= 2 ? ZOOM_SIZE : true} />
        </div>
        {/* Săgețile: se vede că poți trece la poza următoare (sau glisezi). */}
        {index > 0 && zoom.s === 1 && (
          <button className="lx-viewer-arrow prev" onPointerDown={e => e.stopPropagation()} onClick={() => go(-1)} aria-label={tr('lx.viewer.prev')}>‹</button>
        )}
        {index < list.length - 1 && zoom.s === 1 && (
          <button className="lx-viewer-arrow next" onPointerDown={e => e.stopPropagation()} onClick={() => go(1)} aria-label={tr('lx.viewer.next')}>›</button>
        )}
      </div>
      <div className={details ? 'lx-viewer-info open' : 'lx-viewer-info'}
        onPointerDown={e => { sheetY.current = e.clientY; }}
        onPointerUp={e => {
          const dy = sheetY.current === null ? 0 : e.clientY - sheetY.current;
          sheetY.current = null;
          if (dy < -36) toggleDetails(true); else if (dy > 36) toggleDetails(false);
        }}>
        {/* Panoul pliabil: strâns arată doar verdictul și acțiunile (poza rămâne mare);
            tras în sus sau atins mânerul, arată și detaliile. */}
        <button className="lx-sheet-handle" onClick={() => toggleDetails(!details)} aria-expanded={details} aria-label={tr(details ? 'lx.viewer.lessInfo' : 'lx.viewer.moreInfo')}>
          <i aria-hidden="true" />
        </button>
        <p className="lx-why">{personalWhy(p, why, tr, !!twin)}</p>
        {bestFix.length > 0 && (
          <button className="lx-twin-link" disabled={bestBusy} onClick={() => void makeBestTake()}>
            <Icon name="sparkle" size={16} /> {tr('lx.bestTake.hint', { count: bestFix.length })}
          </button>
        )}
        {twin && (
          <button className="lx-twin-link" onClick={() => setComparing(true)}>
            <span className="lx-twin-mini"><Thumb id={twin.id} lqip={twin.lqip} edits={twin.edits} /></span>
            {tr('lx.twin.see')} ›
          </button>
        )}
        {details && <>
        <CloudLine id={p.id} />
        {/* Ce vede AI-ul în poză (Florence-2, pe telefon). Modelul scrie în engleză. */}
        {p.aiDescription && p.aiDescription.trim().length > 8 && (() => {
          // Tradusă în limba aplicației, când motorul de traducere a apucat s-o facă.
          const local = p.aiDescriptionTr && p.aiDescriptionLang === locale.slice(0, 2) ? p.aiDescriptionTr.trim() : '';
          return (
            <p className="lx-ai-caption"><Icon name="sparkle" size={14} /> <span><small>{tr(local ? 'lx.viewer.aiSeesLocal' : 'lx.viewer.aiSees')}</small> {local || p.aiDescription.trim()}</span></p>
          );
        })()}
        <div className="lx-chips">
          <span className={`lx-chip ${p.status === 'selected' ? 'good' : p.status === 'rejected' ? 'bad' : 'info'}`}>
            {tr(p.status === 'selected' ? 'lx.wall.state.kept' : p.status === 'rejected' ? 'lx.wall.state.notToday' : 'lx.wall.state.waiting')}
          </span>
          <span className="lx-chip info">AI {p.aiScore}</span>
          {reasonsFor(p).map(r => <span key={r.key} className={`lx-chip ${r.tone}`}>{tr(r.key)}</span>)}
        </div>
        </>}
        {/* Patru acțiuni egale, mereu încăpute (raportat: butoanele ieșeau din ecran);
            restul uneltelor stau sub „Mai mult”, grupate într-o grilă. */}
        <div className="lx-viewer-tools2">
          <button className="lx-tbtn magic" onClick={() => setEnhancing(true)}><span><Icon name="sparkle" /></span>{tr('lx.viewer.enhanceShort')}</button>
          <button className="lx-tbtn" onClick={() => setMagic(true)}><span><Icon name="eraser" /></span>{tr('lx.magic.erase')}</button>
          <button className="lx-tbtn" onClick={shield.share}><span><Icon name="share" /></span>{tr('lx.wall.share')}</button>
          <button className={more ? 'lx-tbtn on' : 'lx-tbtn'} aria-expanded={more} onClick={() => setMore(v => !v)}><span><Icon name="more" /></span>{tr('lx.viewer.more')}</button>
        </div>
        {more && (
          <div className="lx-more-grid">
            <button onClick={() => { setMore(false); setEnhancing('perfect'); }}><span><Icon name="sparkle" /></span>{tr('lx.recipe.oneTap')}</button>
            {bestFix.length > 0 && <button disabled={bestBusy} onClick={() => void makeBestTake()}><span><Icon name="sparkle" /></span>{tr('lx.bestTake.button')}</button>}
            {livePhotoAvailable() && !!p.mediaUri && <button onClick={() => setTool('live')}><span><Icon name="sparkle" /></span>{tr('lx.live.title')}</button>}
            {canRephoto() && p.capturedAt !== undefined && Date.now() - p.capturedAt > 90 * 86_400_000 && <button onClick={() => setTool('rephoto')}><span><Icon name="target" /></span>{tr('lx.rephoto.title')}</button>}
            {burstIds.split(',').length >= 2 && <button onClick={() => setTool('vote')}><span><Icon name="check" /></span>{tr('lx.vote.title')}</button>}
            <button onClick={shield.open}><span><Icon name="lock" /></span>{tr('lx.shield.title')}</button>
            <button onClick={() => setCapsuleOpen(true)}><span><Icon name="lock" /></span>{tr('lx.capsule.button')}</button>
            {burstFilmAvailable() && <button onClick={() => setFilmOpen(true)}><span><Icon name="film" /></span>{tr('lx.burstFilm.button')}</button>}
            {onSimilar && <button onClick={() => onSimilar(p.id)}><span><Icon name="similar" /></span>{tr('lx.viewer.similarShort')}</button>}
            <button onClick={() => setInsta(true)}><span><Icon name="square" /></span>{tr('lx.insta.button')}</button>
            {canSell && <button onClick={() => setSelling(true)}><span><Icon name="tag" /></span>{tr('lx.sell.button')}</button>}
            <button onClick={() => setTexting(true)}><span><Icon name="text" /></span>{tr('lx.text.button')}</button>
            {p.ocrText && p.ocrText.trim().length > 8 && (
              <button onClick={() => { void navigator.clipboard?.writeText(p.ocrText!.trim()).then(() => useStore.getState().setNotice(tr('lx.viewer.textCopied')), () => {}); }}>
                <span><Icon name="copy" /></span>{tr('lx.viewer.copyText')}
              </button>
            )}
            {cloudAvailable() && <button onClick={() => setWriting(true)}><span><Icon name="pen" /></span>{tr('lx.caption.button')}</button>}
            <button onClick={() => void hidePhotos([p.id], tr).then(done => { if (done) { if (list.length <= 1) onClose(); else onIndex(Math.min(index, list.length - 2)); } })}><span><Icon name="lock" /></span>{tr('lx.private.hide')}</button>
            {p.status === 'rejected' && p.mediaUri && (
              <button className="danger" onClick={() => void deleteRejectedPhotos([p.id]).then(r => {
                if (!r.deleted) return;
                if (list.length <= 1) onClose(); else onIndex(Math.min(index, list.length - 2));
              })}><span><Icon name="trash" /></span>{tr('lx.viewer.deleteShort')}</button>
            )}
          </div>
        )}
        <div className="lx-viewer-decide">
          <button className={p.status === 'rejected' ? 'lx-dbtn drop on' : 'lx-dbtn drop'} onClick={() => void setStatus(p.id, 'rejected')}>
            <span><Icon name="x" /></span>{tr('lx.notToday')}
          </button>
          <button className={p.status === 'selected' ? 'lx-dbtn keep on' : 'lx-dbtn keep'} onClick={() => void setStatus(p.id, 'selected')}>
            <span><Icon name="check" /></span>{tr('lx.keep')}
          </button>
        </div>
      </div>
      {enhancing && <EnhanceSheet photo={p} recipe={enhancing === 'perfect' ? 'perfect' : undefined} onClose={() => setEnhancing(false)} />}
      {comparing && twin && <TwinCompare photo={p} twin={twin} onClose={() => setComparing(false)} />}
      {writing && <CaptionSheet photo={p} onClose={() => setWriting(false)} />}
      {insta && <InstaSheet photo={p} onClose={() => setInsta(false)} />}
      {tool === 'live' && <LivePhotoSheet photoId={id} onClose={() => setTool(null)} />}
      {tool === 'rephoto' && <RephotoSheet photoId={id} takenAt={p.capturedAt} onClose={() => setTool(null)} />}
      {tool === 'vote' && <FamilyVote ids={burstIds.split(',')} onClose={() => setTool(null)} />}
      {shield.sheet}
      {capsuleOpen && <CapsuleCreator initialIds={[id]} onClose={() => setCapsuleOpen(false)} />}
      {filmOpen && <FilmCreator startId={id} initialIds={burstIds ? burstIds.split(',') : [id]} onClose={() => setFilmOpen(false)} />}
      {magic && <MagicSheet photo={p} onClose={() => setMagic(false)} />}
      {selling && <AiRetouch photo={p} kind="cutout" onClose={() => setSelling(false)} />}
      {texting && <TextSheet photo={p} onClose={() => setTexting(false)} />}
    </div>,
    document.body
  );
}
