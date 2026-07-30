import { useEffect, useRef, type CSSProperties } from 'react';
import { drawAdjusted, isNeutral, type EditAdjustments } from '../core/imageAdjust';

/**
 * Inlocuitor drop-in pentru <img src=...> peste tot unde se afiseaza o poza
 * din biblioteca. Bug real gasit de auditul QA: ajustarile din "Editare de
 * baza" (EditPanel) erau vizibile DOAR in canvas-ul propriu al panoului —
 * grila, loupe-ul din Workspace, DetailView, compararea de serii si contact
 * sheet-ul afisau mereu originalul neschimbat, singurul semn ca poza fusese
 * editata fiind o iconita mica de creion. Cazul comun (fara nicio ajustare,
 * marea majoritate a pozelor) ramane exact un <img> simplu, fara nicio
 * schimbare de performanta sau comportament.
 */
export function AdjustedImage({ src, edits, alt, className, style, loading, decoding }: {
  src: string;
  edits?: EditAdjustments;
  alt: string;
  className?: string;
  style?: CSSProperties;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
}) {
  const hasEdits = !isNeutral(edits);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!hasEdits) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx || !edits) return;
      drawAdjusted(ctx, img, canvas.width, canvas.height, edits);
    };
    img.src = src;
    return () => { cancelled = true; };
  }, [src, hasEdits, edits]);

  if (!hasEdits) {
    return <img src={src} alt={alt} className={className} style={style} loading={loading} decoding={decoding} />;
  }
  return <canvas ref={canvasRef} className={className} style={style} role="img" aria-label={alt} />;
}
