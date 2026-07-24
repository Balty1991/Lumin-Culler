import { useEffect, useRef } from 'react';

/** Poza redusa la aceasta dimensiune pentru calculul histogramei — suficient de precis, ieftin de calculat indiferent de rezolutia reala a preview-ului (2048px). */
const ANALYSIS_SIZE = 160;
const BUCKETS = 64;
const CHART_W = 256;
const CHART_H = 72;

/**
 * Histograma RGB (plan 3.2.2, "Panou de informatii extins") — calculata direct
 * din pixelii preview-ului deja incarcat in DetailView, NU din originalul RAW,
 * pentru o evaluare rapida a expunerii/clipping-ului fara nicio re-decodare.
 */
export function Histogram({ src }: { src: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!src || !canvas || !ctx) return;
    let cancelled = false;

    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const off = document.createElement('canvas');
      const scale = Math.min(1, ANALYSIS_SIZE / Math.max(img.width, img.height));
      off.width = Math.max(1, Math.round(img.width * scale));
      off.height = Math.max(1, Math.round(img.height * scale));
      const octx = off.getContext('2d', { willReadFrequently: true });
      if (!octx) return;
      octx.drawImage(img, 0, 0, off.width, off.height);

      let data: Uint8ClampedArray;
      try {
        data = octx.getImageData(0, 0, off.width, off.height).data;
      } catch {
        return; // sursa "tainted" (CORS) — nu putem citi pixelii, renuntam silentios
      }
      if (cancelled) return;

      const r = new Array(BUCKETS).fill(0);
      const g = new Array(BUCKETS).fill(0);
      const b = new Array(BUCKETS).fill(0);
      const bucketOf = (v: number) => Math.min(BUCKETS - 1, Math.floor(v / (256 / BUCKETS)));
      for (let i = 0; i < data.length; i += 4) {
        r[bucketOf(data[i])]++;
        g[bucketOf(data[i + 1])]++;
        b[bucketOf(data[i + 2])]++;
      }
      const max = Math.max(1, ...r, ...g, ...b);

      ctx.clearRect(0, 0, CHART_W, CHART_H);
      const drawChannel = (bins: number[], color: string) => {
        ctx.beginPath();
        ctx.moveTo(0, CHART_H);
        for (let i = 0; i < BUCKETS; i++) {
          ctx.lineTo((i / (BUCKETS - 1)) * CHART_W, CHART_H - (bins[i] / max) * CHART_H);
        }
        ctx.lineTo(CHART_W, CHART_H);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      };
      ctx.globalCompositeOperation = 'lighter';
      drawChannel(r, 'rgba(251,113,133,0.55)');
      drawChannel(g, 'rgba(74,222,128,0.55)');
      drawChannel(b, 'rgba(96,165,250,0.55)');
      ctx.globalCompositeOperation = 'source-over';
    };
    img.src = src;
    return () => { cancelled = true; };
  }, [src]);

  return <canvas ref={canvasRef} className="histogram-canvas" width={CHART_W} height={CHART_H} role="img" aria-label="Histograma RGB" />;
}
