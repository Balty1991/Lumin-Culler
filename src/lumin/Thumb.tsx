import { useEffect, useState } from 'react';
import { getCachedThumbUrl, peekThumbUrl } from '../core/thumbUrlCache';
import { getCachedPreviewUrl, getDisplayUrl } from '../core/previewUrlCache';
import { canSharpen, SCREEN_SIZE, sharpUrl, TILE_SIZE } from './sharp';
import { isNeutral, type EditAdjustments } from '../core/imageAdjust';
import { AdjustedImage } from '../ui/AdjustedImage';

/**
 * lumin/Thumb.tsx
 * O poză din bibliotecă: miniatura din cache, cu LQIP până vine. `full`
 * citește fișierul original (pentru ecranele mari: sortare, ziua deschisă).
 * Cu `edits` (copia „mai frumoasă”), ajustările se văd și aici.
 */
export function Thumb({ id, lqip, full = false, sharp = false, className, alt = '', edits }: {
  id: string;
  edits?: EditAdjustments;
  lqip?: string;
  full?: boolean;
  /** Pe telefon: după miniatură, o variantă clară (true = 768 px, sau latura cerută în px). */
  sharp?: boolean | number;
  className?: string;
  alt?: string;
}) {
  const [src, setSrc] = useState<string | null>(() => peekThumbUrl(id));
  useEffect(() => {
    let alive = true;
    const show = (url: string | null) => { if (alive && url) setSrc(url); };
    setSrc(peekThumbUrl(id));
    if (full && canSharpen()) {
      // Întâi ce avem deja (preview), apoi poza clară făcută de Android — doar
      // dacă s-a încărcat. Originalul direct prin URI ieșea negru pe unele telefoane.
      void getCachedPreviewUrl(id).then(show).catch(() => {});
      void sharpUrl(id, SCREEN_SIZE).then(show);
    } else if (full) {
      void getDisplayUrl(id).then(show).catch(() => {});
    } else {
      void getCachedThumbUrl(id).then(url => {
        show(url);
        if (sharp) void sharpUrl(id, typeof sharp === 'number' ? sharp : TILE_SIZE).then(show);
      }).catch(() => {});
    }
    return () => { alive = false; };
  }, [id, full, sharp]);
  const shown = src ?? lqip;
  if (src && edits && !isNeutral(edits)) return <AdjustedImage className={className} src={src} edits={edits} alt={alt} />;
  return shown
    ? <img className={className} src={shown} alt={alt} draggable={false} />
    : <span className={className ? `${className} lx-thumb-empty` : 'lx-thumb-empty'} aria-hidden="true" />;
}
