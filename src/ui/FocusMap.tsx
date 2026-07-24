import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { t } from '../i18n';

/** Poza redusa la aceasta latime maxima pentru analiza — ieftin de calculat indiferent de rezolutia reala a preview-ului. */
const ANALYSIS_MAX_SIDE = 240;
/** Grid de GRID x GRID tile-uri — suficient de fin ca sa distinga subiect/fundal, fara sa fie costisitor. */
const GRID = 12;
const OUT_MAX_SIDE = 220;

/**
 * Harta de focus (plan 3.2.2, "Panou de informatii extins") — claritate LOCALA
 * (varianta Laplaciana pe un grid de tile-uri), nu un singur numar agregat: arata
 * vizual UNDE anume din cadru e clar/neclar (ex. subiectul e ascutit dar fundalul
 * e difuz, sau invers — o zona miscata in mijlocul cadrului), ceva ce scorul
 * "Claritate" din tab-ul Metrici nu poate exprima singur. Acelasi principiu
 * (varianta Laplaciana pe regiuni) ca subjectInFocus/bokehQuality din analiza AI
 * (workers/faceAnalysis.worker.ts), recalculat aici direct pe preview-ul deja
 * incarcat, fara nicio re-decodare.
 */
export function FocusMap({ src }: { src: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const locale = useStore(s => s.locale);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!src || !canvas || !ctx) return;
    let cancelled = false;

    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const off = document.createElement('canvas');
      const scale = Math.min(1, ANALYSIS_MAX_SIDE / Math.max(img.width, img.height));
      const w = Math.max(GRID, Math.round(img.width * scale));
      const h = Math.max(GRID, Math.round(img.height * scale));
      off.width = w;
      off.height = h;
      const octx = off.getContext('2d', { willReadFrequently: true });
      if (!octx) return;
      octx.drawImage(img, 0, 0, w, h);

      let data: Uint8ClampedArray;
      try {
        data = octx.getImageData(0, 0, w, h).data;
      } catch {
        return; // sursa "tainted" (CORS) — nu putem citi pixelii, renuntam silentios
      }
      if (cancelled) return;

      const gray = new Float32Array(w * h);
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }

      const tileW = w / GRID;
      const tileH = h / GRID;
      const variances: number[] = new Array(GRID * GRID).fill(0);
      for (let ty = 0; ty < GRID; ty++) {
        for (let tx = 0; tx < GRID; tx++) {
          const x0 = Math.max(1, Math.floor(tx * tileW));
          const x1 = Math.min(w - 1, Math.floor((tx + 1) * tileW));
          const y0 = Math.max(1, Math.floor(ty * tileH));
          const y1 = Math.min(h - 1, Math.floor((ty + 1) * tileH));
          let sum = 0, sumSq = 0, n = 0;
          // varianta laplaciana (4-vecini) — acelasi calcul ca sharpness-ul global, dar restrans la un singur tile
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              const c = gray[y * w + x];
              const lap = 4 * c - gray[y * w + x - 1] - gray[y * w + x + 1] - gray[(y - 1) * w + x] - gray[(y + 1) * w + x];
              sum += lap; sumSq += lap * lap; n++;
            }
          }
          variances[ty * GRID + tx] = n > 0 ? sumSq / n - (sum / n) ** 2 : 0;
        }
      }

      const max = Math.max(1, ...variances);
      const outW = OUT_MAX_SIDE;
      const outH = Math.max(1, Math.round(OUT_MAX_SIDE * (h / w)));
      canvas.width = outW;
      canvas.height = outH;
      const cellW = outW / GRID;
      const cellH = outH / GRID;
      ctx.clearRect(0, 0, outW, outH);
      for (let i = 0; i < variances.length; i++) {
        const tx = i % GRID;
        const ty = Math.floor(i / GRID);
        // radical: comprima extremele, ca diferentele din mijlocul intervalului sa ramana vizibile pe heatmap
        const norm = Math.min(1, Math.sqrt(variances[i] / max));
        const hue = 220 - norm * 220; // 220 = albastru (neclar) -> 0 = rosu (foarte clar)
        ctx.fillStyle = `hsl(${hue}, 75%, 50%)`;
        ctx.fillRect(tx * cellW, ty * cellH, cellW + 0.5, cellH + 0.5); // +0.5: acopera micile goluri de rotunjire dintre celule
      }
    };
    img.src = src;
    return () => { cancelled = true; };
  }, [src]);

  return <canvas ref={canvasRef} className="focusmap-canvas" width={OUT_MAX_SIDE} height={OUT_MAX_SIDE} role="img" aria-label={t(locale, 'focusMap.ariaLabel')} />;
}
