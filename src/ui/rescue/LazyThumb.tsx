import { useEffect, useRef, useState } from 'react';

/** Tiny generated mark. Built only when the row is near the viewport. */
export function thumbSrc(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 33 + id.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><rect width="44" height="44" fill="hsl(${hue} 25% 40%)"/><circle cx="22" cy="18" r="6" fill="hsl(${hue} 45% 82%)"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function LazyThumb({ id }: { id: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSrc(thumbSrc(id));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      setSrc(thumbSrc(id));
      observer.disconnect();
    }, { rootMargin: '120px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [id]);

  return (
    <span className="rescue-thumb" ref={ref} aria-hidden="true">
      {src ? <img src={src} alt="" width={44} height={44} decoding="async" /> : null}
    </span>
  );
}
