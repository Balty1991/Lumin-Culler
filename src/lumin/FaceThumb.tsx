import { useEffect, useRef } from 'react';
import { db } from '../core/db';
import { canSharpen, sharpUrl } from './sharp';

/**
 * lumin/FaceThumb.tsx
 * Fața cuiva, decupată clar. Raportat: fețele de la Oameni erau neclare —
 * decupajul se făcea din miniatura de 256 px (o față avea acolo vreo 40 px)
 * și se desena pe o pânză de 72 px pe un ecran cu densitate ~3.
 *
 * Aici: întâi miniatura (imediat), apoi, pe telefon, aceeași față din poza
 * clară de 1440 px; pânza la densitatea reală a ecranului.
 */
const SOURCE_SIZE = 1440;

export function FaceThumb({ photoId, box, size = 72, className }: {
  photoId: string;
  box: [number, number, number, number];
  size?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dpr = Math.min(3, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const px = Math.round(size * dpr);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let blobUrl: string | null = null;
    const draw = (url: string) => new Promise<void>(resolve => {
      const img = new Image();
      img.onload = () => {
        const ctx = canvas.getContext('2d');
        if (!cancelled && ctx) {
          const [bx, by, bw, bh] = box;
          const side = Math.max(bw * img.width, bh * img.height) * 1.5;
          const cx = (bx + bw / 2) * img.width, cy = (by + bh / 2) * img.height;
          const x = Math.max(0, Math.min(img.width - side, cx - side / 2));
          const y = Math.max(0, Math.min(img.height - side, cy - side / 2));
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, x, y, Math.min(side, img.width), Math.min(side, img.height), 0, 0, px, px);
        }
        resolve();
      };
      img.onerror = () => resolve();
      img.src = url;
    });
    void (async () => {
      const rec = await db.thumbnails.get(photoId);
      if (rec && !cancelled) {
        blobUrl = URL.createObjectURL(rec.blob);
        await draw(blobUrl);
      }
      if (cancelled || !canSharpen()) return;
      const sharp = await sharpUrl(photoId, SOURCE_SIZE);
      if (sharp && !cancelled) await draw(sharp);
    })();
    return () => { cancelled = true; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [photoId, box, px]);

  return <canvas ref={canvasRef} className={className} width={px} height={px} style={{ width: size, height: size }} aria-hidden="true" />;
}
