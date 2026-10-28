import { useEffect, useState } from 'react';
import { getCachedThumbUrl, peekThumbUrl } from '../core/thumbUrlCache';
import { getDisplayUrl } from '../core/previewUrlCache';

/**
 * lumin/Thumb.tsx
 * O poză din bibliotecă: miniatura din cache, cu LQIP până vine. `full`
 * citește fișierul original (pentru ecranele mari: sortare, ziua deschisă).
 */
export function Thumb({ id, lqip, full = false, className, alt = '' }: {
  id: string;
  lqip?: string;
  full?: boolean;
  className?: string;
  alt?: string;
}) {
  const [src, setSrc] = useState<string | null>(() => (full ? null : peekThumbUrl(id)));
  useEffect(() => {
    let alive = true;
    setSrc(full ? null : peekThumbUrl(id));
    const load = full ? getDisplayUrl(id) : getCachedThumbUrl(id);
    void load.then(url => { if (alive && url) setSrc(url); }).catch(() => {});
    return () => { alive = false; };
  }, [id, full]);
  const shown = src ?? lqip;
  return shown
    ? <img className={className} src={shown} alt={alt} draggable={false} />
    : <span className={className ? `${className} lx-thumb-empty` : 'lx-thumb-empty'} aria-hidden="true" />;
}
