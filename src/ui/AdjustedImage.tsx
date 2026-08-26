import { useEffect, useState, type CSSProperties } from 'react';
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
 *
 * Randam MEREU un <img>, si cand poza are ajustari: versiunea anterioara
 * punea in DOM un <canvas>, iar toate regulile de asezare din foile de stil
 * sunt scrise pe `img` (`.compare-img img`, `.card img`, `.workspace-thumb
 * img`...). Un canvas nu le prindea, deci iesea la dimensiunea lui naturala —
 * de aici cadrul lung de cateva mii de pixeli vazut in compararea unei serii.
 * Asa, orice regula existenta sau viitoare scrisa pe `img` se aplica identic
 * pozelor editate.
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
  const editsSignature = hasEdits ? JSON.stringify(edits) : '';
  /** URL-ul versiunii ajustate. Cat timp e null aratam originalul — fara gol si fara salt de asezare. */
  const [adjustedUrl, setAdjustedUrl] = useState<string | null>(null);

  useEffect(() => {
    setAdjustedUrl(null);
    if (!hasEdits || !edits) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        drawAdjusted(ctx, img, img.naturalWidth, img.naturalHeight, canvas.width, canvas.height, edits);
        canvas.toBlob(blob => {
          if (cancelled || !blob) return;
          objectUrl = URL.createObjectURL(blob);
          setAdjustedUrl(objectUrl);
        }, 'image/jpeg', 0.92);
      } catch {
        // fara canvas (jsdom, memorie epuizata) ramanem pe original — mai bine
        // originalul decat o poza lipsa
      }
    };
    img.src = src;
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // `edits` e un OBIECT: pus direct in dependinte, orice re-randare a
    // parintelui cu un obiect nou dar identic ca valori relua tot lantul —
    // incarcare, canvas, toBlob — pentru un rezultat identic. Pe o grila
    // virtualizata, care re-monteaza carduri la fiecare derulare, asta se
    // simte. Semnatura serializata compara VALORILE, nu referinta.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `editsSignature` E `edits`, comparat pe valori
  }, [src, hasEdits, editsSignature]);

  return (
    <img
      src={adjustedUrl ?? src}
      alt={alt}
      className={className}
      style={style}
      loading={loading}
      decoding={decoding}
    />
  );
}
