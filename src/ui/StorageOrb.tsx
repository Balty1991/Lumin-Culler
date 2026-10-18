import { useEffect, useRef } from 'react';

/**
 * Sfera de stocare. Lichidul urcă odată cu spațiul eliberat, particulele
 * orbitează. Un singur canvas, transformat pe GPU; la mișcare redusă se
 * desenează o singură dată.
 */
export function StorageOrb({ ratio, label, caption }: { ratio: number; label: string; caption: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dots = Array.from({ length: 28 }, (_, i) => ({
      a: (i / 28) * Math.PI * 2,
      r: 0.62 + (i % 5) * 0.05,
      s: 0.35 + (i % 7) * 0.07,
      size: 1.1 + (i % 3) * 0.45
    }));
    let raf = 0;
    let alive = true;

    const draw = (t: number) => {
      if (!alive) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const size = 168;
      if (canvas.width !== Math.round(size * dpr)) {
        canvas.width = Math.round(size * dpr);
        canvas.height = Math.round(size * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const cx = size / 2;
      const cy = size / 2;
      const fill = Math.max(0.12, Math.min(1, ratioRef.current));

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, 62, 0, Math.PI * 2);
      ctx.clip();
      const body = ctx.createRadialGradient(cx - 16, cy - 22, 6, cx, cy, 70);
      body.addColorStop(0, 'rgba(255,255,255,0.55)');
      body.addColorStop(0.22, 'rgba(90, 70, 255, 0.35)');
      body.addColorStop(0.7, 'rgba(8, 12, 32, 0.2)');
      body.addColorStop(1, 'rgba(5, 6, 15, 0.05)');
      ctx.fillStyle = body;
      ctx.fillRect(0, 0, size, size);

      const wave = reduce ? 0 : Math.sin(t / 680) * 5;
      const level = cy + 62 - fill * 118 + wave;
      const liquid = ctx.createLinearGradient(0, level - 8, 0, cy + 62);
      liquid.addColorStop(0, 'rgba(125, 255, 244, 0.95)');
      liquid.addColorStop(0.45, 'rgba(90, 120, 255, 0.8)');
      liquid.addColorStop(1, 'rgba(255, 77, 170, 0.85)');
      ctx.fillStyle = liquid;
      ctx.beginPath();
      ctx.moveTo(0, size);
      ctx.lineTo(0, level);
      if (!reduce) {
        for (let x = 0; x <= size; x += 8) {
          ctx.lineTo(x, level + Math.sin(x / 14 + t / 420) * 3.2);
        }
      }
      ctx.lineTo(size, size);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(cx, cy, 62, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const sheen = ctx.createRadialGradient(cx - 22, cy - 28, 2, cx - 10, cy - 16, 36);
      sheen.addColorStop(0, 'rgba(255,255,255,0.55)');
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen;
      ctx.beginPath();
      ctx.ellipse(cx - 16, cy - 18, 22, 14, -0.6, 0, Math.PI * 2);
      ctx.fill();

      if (!reduce) {
        for (const dot of dots) {
          const ang = dot.a + t / 3800 * dot.s;
          const rad = 78 * dot.r;
          ctx.globalAlpha = 0.28 + 0.55 * (0.5 + 0.5 * Math.sin(t / 520 + dot.a));
          ctx.fillStyle = dot.a % 2 > 1 ? '#7dfff4' : '#ff4daa';
          ctx.beginPath();
          ctx.arc(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad * 0.62, dot.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        raf = requestAnimationFrame(() => draw(performance.now()));
      }
    };

    draw(reduce ? 0 : performance.now());
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <figure className="orbit-orb" aria-hidden="true">
      <canvas ref={canvasRef} width={336} height={336} />
      <figcaption><b>{label}</b><span>{caption}</span></figcaption>
    </figure>
  );
}
