import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { db } from '../core/db';
import type { AnalysisRecord } from '../core/db';
import { anchorsFor, formatSmile, type Anchor, type AnchorOptions } from '../core/photoAnchors';
import { t } from '../i18n';

/**
 * ui/PhotoAnchors.tsx
 * Stratul de ancore de deasupra fotografiei — vezi core/photoAnchors.ts pentru
 * geometrie si pentru regula care il tine ("se ancoreaza doar ce are un loc").
 *
 * Aici e doar randarea: masoara containerul, citeste analiza, traduce
 * etichetele. Nicio decizie despre CE se arata nu se ia in acest fisier —
 * altfel regula ar ajunge sa traiasca in doua locuri, si al doilea nu e testat.
 *
 * `pointer-events: none` peste tot (in foaie, pe .lc-anchor): stratul sta chiar
 * peste suprafata care primeste swipe-ul de decizie, iar un strat care ar
 * inghiti un singur pointerdown ar face poza "sa nu mai raspunda" fix in
 * dreptul unei fete.
 */

/** Analiza pozei curente. Un singur read per poza afisata — casetele fetelor nu incap in PhotoView (vezi acolo). */
function useAnalysis(photoId: string): AnalysisRecord | null {
  const [analysis, setAnalysis] = useState<AnalysisRecord | null>(null);
  useEffect(() => {
    let alive = true;
    // Golim inainte de citire: fara asta, ancorele pozei ANTERIOARE raman pe
    // ecran peste poza noua pana se rezolva promisiunea — acelasi bug pe care
    // DetailView il evita deja pentru `src` (vezi setSrc(null) acolo), doar ca
    // aici ar fi mai rau: numele lui Ana peste chipul altcuiva.
    setAnalysis(null);
    void db.analyses.get(photoId).then(a => { if (alive) setAnalysis(a ?? null); });
    return () => { alive = false; };
  }, [photoId]);
  return analysis;
}

interface BoxGeometry {
  w: number;
  h: number;
  /** Marginea de sus a containerului fata de fereastra — vezi safeTop mai jos. */
  top: number;
}

/** Dimensiunea si pozitia containerului, urmarite la redimensionare (rotire, tastatura, split screen). */
function useBoxGeometry(ref: React.RefObject<HTMLElement | null>): BoxGeometry {
  const [box, setBox] = useState<BoxGeometry>({ w: 0, h: 0, top: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox(b => (b.w === r.width && b.h === r.height && b.top === r.top ? b : { w: r.width, h: r.height, top: r.top }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return box;
}

export interface PhotoAnchorsProps {
  photoId: string;
  /** Elementul peste care se deseneaza — se masoara el, nu fereastra. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Doar cand imaginea umple o cutie fixa cu `object-fit: contain` (vezi AnchorOptions). */
  imageW?: number;
  imageH?: number;
  /**
   * Benzile acoperite de comenzi, masurate de la marginile FERESTREI — pentru ca
   * acolo stau ele (antetul sus, motivul si butoanele de decizie jos), pe cand
   * containerul ancorelor e imaginea, care calatoreste cu degetul in timpul
   * swipe-ului si e centrata cu benzi negale. Conversia in coordonatele
   * containerului se face aici, dintr-o singura masuratoare.
   */
  safeTop?: number;
  safeBottom?: number;
}

export function PhotoAnchors({ photoId, containerRef, imageW, imageH, safeTop, safeBottom }: PhotoAnchorsProps) {
  const locale = useStore(s => s.locale);
  const showAnchors = useStore(s => s.showAnchors);
  const analysis = useAnalysis(photoId);
  const box = useBoxGeometry(containerRef);

  const eticheta = (a: Pick<Anchor, 'labelKey' | 'literal' | 'params'>): string =>
    a.literal ?? t(locale, a.labelKey, a.params?.value !== undefined
      ? { value: formatSmile(Number(a.params.value), locale) }
      : a.params);

  if (!showAnchors || !analysis || !box.w || !box.h) return null;
  // Fereastra -> container. Fara `max(0, ...)`, o poza mai scunda decat banda
  // (o panorama intr-un ecran inalt) ar primi o banda negativa, adica ar
  // extinde zona valida in loc s-o restranga.
  const viewportH = typeof window === 'undefined' ? 0 : window.innerHeight;
  const opts: AnchorOptions = {
    boxW: box.w,
    boxH: box.h,
    imageW,
    imageH,
    safeTop: safeTop === undefined ? undefined : Math.max(0, safeTop - box.top),
    safeBottom: safeBottom === undefined || !viewportH
      ? undefined
      : Math.max(0, safeBottom - (viewportH - (box.top + box.h))),
    label: eticheta
  };
  const anchors = anchorsFor(analysis, opts);
  if (!anchors.length) return null;

  return (
    // Ancorele sunt DEJA spuse de restul ecranului (scor, motiv, fila de
    // metrici) pentru cine nu vede poza; repetate aici, un cititor de ecran
    // le-ar citi de doua ori, in dezordine, peste un dialog. Deci strict
    // vizuale.
    <div className="lc-anchors" aria-hidden="true">
      {anchors.map(a => (
        <span
          key={a.id}
          className={a.side === 'left' ? 'lc-anchor left' : 'lc-anchor'}
          style={{ left: `${a.leftPct}%`, top: `${a.topPct}%` }}
        >
          <i /><s /><b>{eticheta(a)}</b>
        </span>
      ))}
    </div>
  );
}

/**
 * Dimensiunea naturala a imaginii afisate — necesara doar acolo unde imaginea
 * umple o cutie fixa si `object-fit: contain` lasa benzi (vezi AnchorOptions).
 * Se reseteaza la schimbarea sursei: altfel prima poza inalta ar aseza ancorele
 * celei late care ii urmeaza.
 */
export function useNaturalSize(src: string | null): {
  w?: number;
  h?: number;
  onLoad: (e: { currentTarget: HTMLImageElement }) => void;
} {
  const [nat, setNat] = useState<{ w?: number; h?: number }>({});
  useEffect(() => { setNat({}); }, [src]);
  return {
    ...nat,
    onLoad: e => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
  };
}
