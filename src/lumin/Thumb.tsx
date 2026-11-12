import { useEffect, useRef, useState } from 'react';
import { getCachedThumbUrl, peekThumbUrl } from '../core/thumbUrlCache';
import { getCachedPreviewUrl, getDisplayUrl } from '../core/previewUrlCache';
import { canSharpen, peekSharpUrl, SCREEN_SIZE, sharpUrl, sizeFor, TILE_SIZE } from './sharp';
import { isNeutral, type EditAdjustments } from '../core/imageAdjust';
import { AdjustedImage } from '../ui/AdjustedImage';

/**
 * lumin/Thumb.tsx
 * O poză din bibliotecă: miniatura din cache, cu LQIP până vine. `full`
 * citește fișierul original (pentru ecranele mari: sortare, ziua deschisă).
 * Cu `edits` (copia „mai frumoasă”), ajustările se văd și aici.
 */
export function Thumb({ id, lqip, full = false, sharp = true, className, alt = '', edits }: {
  id: string;
  edits?: EditAdjustments;
  lqip?: string;
  full?: boolean;
  /**
   * Pe telefon: după miniatură, o variantă clară. Implicit (true) mărimea se
   * măsoară din ce ocupă poza pe ecran; un număr o fixează; false o oprește.
   */
  sharp?: boolean | number;
  className?: string;
  alt?: string;
}) {
  // Poza deschisă: dacă varianta clară e deja gata, o arătăm direct (fără să treacă
  // prin miniatură și preview — fiecare schimbare clipea pe Android, raportat).
  const [src, setSrcRaw] = useState<string | null>(() => (full ? peekSharpUrl(id, SCREEN_SIZE) : null) ?? peekThumbUrl(id));
  // Ce calitate se vede acum (0 miniatură, 1 preview, 2 clară). O variantă mai
  // slabă, sosită mai târziu, nu o mai înlocuiește pe una mai bună — raportat:
  // pozele pregătite din timp (clare) erau acoperite apoi de preview-ul neclar.
  const level = useRef(0);
  const setSrc = (url: string, lvl = 2) => { if (lvl >= level.current) { level.current = lvl; setSrcRaw(url); } };
  useEffect(() => {
    let alive = true;
    level.current = 0;
    const show = (lvl: number) => (url: string | null) => { if (alive && url) setSrc(url, lvl); };
    const ready = full ? peekSharpUrl(id, SCREEN_SIZE) : null;
    if (ready) { level.current = 2; setSrcRaw(ready); return () => { alive = false; }; }
    setSrcRaw(peekThumbUrl(id));
    if (full && canSharpen()) {
      // Întâi ce avem deja (preview), apoi poza clară făcută de Android — doar
      // dacă s-a încărcat. Originalul direct prin URI ieșea negru pe unele telefoane.
      void getCachedPreviewUrl(id).then(show(1)).catch(() => {});
      void sharpUrl(id, SCREEN_SIZE).then(show(2));
    } else if (full) {
      void getDisplayUrl(id).then(show(2)).catch(() => {});
    } else {
      void getCachedThumbUrl(id).then(show(0)).catch(() => {});
    }
    return () => { alive = false; };
  }, [id, full]);

  // La mărire: o copie mai mare, peste cea de ecran. Nu se cere la fiecare cadru.
  useEffect(() => {
    if (!full || typeof sharp !== 'number' || !canSharpen()) return;
    let alive = true;
    void sharpUrl(id, sharp).then(url => { if (alive && url) setSrc(url, 3); });
    return () => { alive = false; };
  }, [id, full, sharp]);

  // Varianta clară a dalei: doar când dala ajunge (aproape) pe ecran — altfel
  // zeci de poze mari stau în memoria grafică degeaba.
  // Elementul ca stare, nu ca ref: dala apare întâi goală (<span>) și devine <img> când vine
  // miniatura. Cu ref, observatorul rămânea pe <span>-ul scos din pagină și poza clară nu se
  // mai cerea niciodată — exact pozele noi din timpul citirii (raportat: „poze neclarificate”).
  const [node, setNode] = useState<HTMLElement | null>(null);
  const box = useRef<HTMLElement | null>(null);
  box.current = node;
  useEffect(() => {
    if (!sharp || full || !canSharpen()) return;
    const el = node;
    let alive = true;
    const load = () => {
      let size = typeof sharp === 'number' ? sharp : TILE_SIZE;
      if (sharp === true && el) {
        const r = el.getBoundingClientRect();
        const long = Math.max(r.width, r.height);
        if (long > 0 && long < 90) return; // mică: miniatura ajunge
        if (long > 0) size = sizeFor(long * 1.15);
      }
      void sharpUrl(id, size).then(url => { if (alive && url) setSrc(url, 2); });
    };
    if (!el || typeof IntersectionObserver === 'undefined') { load(); return () => { alive = false; }; }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { io.disconnect(); load(); }
    }, { rootMargin: '300px' });
    io.observe(el);
    return () => { alive = false; io.disconnect(); };
  }, [id, full, sharp, node]);
  const shown = src ?? lqip;
  if (src && edits && !isNeutral(edits)) return <AdjustedImage className={className} src={src} edits={edits} alt={alt} />;
  // Doar previzualizarea de 24 px (miniatura încă se încarcă): estompată, nu pătrățele
  // pixelate (raportat cu video: „poze neclarificate” la derulare în timpul citirii).
  const tiny = !src && !!lqip;
  return shown
    ? <img ref={setNode} className={tiny ? `${className ?? ''} lx-lqip`.trim() : className} src={shown} alt={alt} draggable={false} data-photo-id={full ? undefined : id} />
    : <span ref={setNode} className={className ? `${className} lx-thumb-empty` : 'lx-thumb-empty'} aria-hidden="true" data-photo-id={full ? undefined : id} />;
}
