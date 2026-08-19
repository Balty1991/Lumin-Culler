import { useEffect, useRef } from 'react';
import { db } from '../core/db';

/**
 * Decupaj patrat in jurul cutiei fetei detectate (box normalizat 0..1), din
 * miniatura DEJA generata — nicio re-decodare a originalului, deci o fasie de
 * zeci de decupaje ramane ieftina.
 *
 * Extras din PersonsPanel ca sa fie folosit si de fasia de comparatie a fetelor
 * (ui/FaceCompareStrip.tsx): aceeasi operatie, aceleasi capcane de curatare a
 * URL-ului de obiect, si nu merita doua copii care sa se abata una de alta.
 */
export function FaceCropThumb({ photoId, box, size = 56, className = 'face-crop-thumb' }: {
  photoId: string;
  box: [number, number, number, number];
  size?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let url: string | null = null;

    void db.thumbnails.get(photoId).then(rec => {
      if (!rec || cancelled) return;
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const [bx, by, bw, bh] = box;
        const pad = 0.2; // marja in jurul cutiei, ca fata sa nu fie taiata prea strans
        const x = Math.max(0, (bx - bw * pad) * img.width);
        const y = Math.max(0, (by - bh * pad) * img.height);
        const w = Math.min(img.width - x, bw * (1 + pad * 2) * img.width);
        const h = Math.min(img.height - y, bh * (1 + pad * 2) * img.height);
        ctx.drawImage(img, x, y, Math.max(1, w), Math.max(1, h), 0, 0, size, size);
      };
      url = URL.createObjectURL(rec.blob);
      img.src = url;
    });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [photoId, box, size]);

  return <canvas ref={canvasRef} className={className} width={size} height={size} aria-hidden="true" />;
}
