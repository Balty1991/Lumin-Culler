import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../core/db';
import { useStore, type PhotoView } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { AdjustedImage } from './AdjustedImage';
import { SearchIcon, XIcon, SparkleIcon } from './icons';
import { translateSceneTag } from '../core/sceneTagLabels';
import { t, plural } from '../i18n';

const TOP_TAGS_COUNT = 8;
/** Rezultatele nu sunt virtualizate (spre deosebire de grila principala, VirtualPhotoGrid) —
    o interogare specifica (text/eticheta) rareori depaseste cateva zeci de poze; plafonul de
    mai jos ramane doar o plasa de siguranta pentru cazul rar al unei etichete foarte comune
    pe o biblioteca mare (ex. "persoana" pe 3000 de poze), unde ar incarca simultan mult prea
    multe miniaturi din IndexedDB deodata. */
const MAX_RESULTS_SHOWN = 60;

/** Miniatura unui rezultat — acelasi tipar de incarcare ca MemoryThumbImage/PhotoCard (fiecare
    ecran isi are propria copie mica, nu o abstractie comuna — vezi comentariile din acele fisiere). */
function SearchResultThumb({ photo, onOpen }: { photo: PhotoView; onOpen: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    void db.thumbnails.get(photo.id).then(rec => {
      if (rec && alive) { url = URL.createObjectURL(rec.blob); setSrc(url); }
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [photo.id]);
  return (
    <button type="button" className="search-result-thumb" onClick={onOpen} aria-label={photo.fileName}>
      {photo.lqip && !src && <img className="search-result-lqip" src={photo.lqip} alt="" />}
      {src && <AdjustedImage src={src} edits={photo.edits} alt="" loading="lazy" />}
    </button>
  );
}

/**
 * "Cautare vizuala" (plan modernizare, ecran m-search din mockup) — ecran
 * dedicat pe deasupra a ceea ce exista deja (App.tsx are un camp de cautare
 * text in antet, combinabil cu filtrele din grila): aici doar reutilizam
 * searchText/sceneTagFilter + secondaryFiltered() (potrivire deja facuta in
 * store.ts, inclusiv pe etichetele de scena/obiect AI traduse — vezi
 * matchesSearch), cu chips-uri de sugestii pentru cele mai frecvente
 * etichete din biblioteca curenta, in loc de o lista fixa ca in mockup.
 */
export function SearchPanel() {
  const open = useStore(s => s.searchPanelOpen);
  const setOpen = useStore(s => s.setSearchPanelOpen);
  const searchText = useStore(s => s.searchText);
  const setSearchText = useStore(s => s.setSearchText);
  const sceneTagFilter = useStore(s => s.sceneTagFilter);
  const setSceneTagFilter = useStore(s => s.setSceneTagFilter);
  const photos = useStore(s => s.photos);
  const results = useStore(s => s.secondaryFiltered());
  const openDetail = useStore(s => s.openDetail);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useModalFocusTrap(containerRef, open);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const topTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of photos) for (const tag of p.sceneTags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_TAGS_COUNT).map(([tag]) => tag);
  }, [photos]);

  if (!open) return null;

  const hasQuery = !!searchText.trim() || !!sceneTagFilter;
  const shown = results.slice(0, MAX_RESULTS_SHOWN);

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow search-panel" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('search.title')} tabIndex={-1}>
        <header className="detail-head">
          <span>{tr('search.title')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        <label className="search-panel-bar glass">
          <SearchIcon className="inline-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={searchText}
            placeholder={tr('search.placeholder')}
            onChange={e => setSearchText(e.target.value)}
            aria-label={tr('search.placeholder')}
          />
        </label>

        {topTags.length > 0 && (
          <div className="search-panel-chips">
            {topTags.map(tag => (
              <button
                key={tag}
                type="button"
                className={sceneTagFilter === tag ? 'chip active' : 'chip'}
                onClick={() => setSceneTagFilter(sceneTagFilter === tag ? null : tag)}
              >
                {translateSceneTag(tag, locale)}
              </button>
            ))}
          </div>
        )}

        {hasQuery && (
          <div className="search-panel-results-label mono">
            <SparkleIcon className="inline-icon" aria-hidden="true" />
            {tr(plural(results.length, 'search.results.one', 'search.results.other'), { count: results.length })}
          </div>
        )}

        {hasQuery && results.length === 0 && (
          <p className="hint search-panel-empty">{tr('search.empty')}</p>
        )}

        {hasQuery && shown.length > 0 && (
          <div className="search-panel-grid">
            {shown.map(photo => (
              <SearchResultThumb key={photo.id} photo={photo} onOpen={() => { setOpen(false); openDetail(photo.id); }} />
            ))}
          </div>
        )}

        {hasQuery && results.length > MAX_RESULTS_SHOWN && (
          <p className="hint search-panel-more">{tr('search.moreResults', { count: results.length - MAX_RESULTS_SHOWN })}</p>
        )}
      </div>
    </div>
  );
}
