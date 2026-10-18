import { useEffect, useRef } from 'react';
import { stepSpring } from './orbPhysics';

/**
 * Sferă mică de stocare. Lichidul e un arc: urcă când se eliberează spațiu
 * și se leagănă după înclinarea telefonului. Un singur canvas, pe GPU.
 * La mișcare redusă se desenează o dată, fără senzor.
 */
export function StorageOrb({ ratio, accent, compact = false }: { ratio: number; accent: string; compact?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ratioRef = useRef(ratio);
  const accentRef = useRef(accent);
  ratioRef.current = ratio;
  accentRef.current = accent;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tilt = { x: 0, y: 0 };
    let spring = { value: ratioRef.current, velocity: 0 };
    let last = performance.now();
    let raf = 0;
    let alive = true;

    const onTilt = (event: DeviceOrientationEvent) => {
      const gx = event.gamma ?? 0;
      const by = event.beta ?? 0;
      tilt.x = Math.max(-1, Math.min(1, gx / 35));
      tilt.y = Math.max(-1, Math.min(1, (by - 40) / 45));
    };
    if (!reduce) window.addEventListener('deviceorientation', onTilt);

    const draw = (now: number) => {
      if (!alive) return;
      const dt = (now - last) / 1000;
      last = now;
      if (!reduce) spring = stepSpring(spring, ratioRef.current, dt);
      else spring = { value: ratioRef.current, velocity: 0 };

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const size = compact ? 52 : 168;
      if (canvas.width !== Math.round(size * dpr)) {
        canvas.width = Math.round(size * dpr);
        canvas.height = Math.round(size * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const cx = size / 2 + (reduce ? 0 : tilt.x * size * 0.04);
      const cy = size / 2 + (reduce ? 0 : tilt.y * size * 0.03);
      const radius = size * 0.38;
      const fill = Math.max(0.08, Math.min(1, spring.value));
      const color = accentRef.current || '#7dfff4';

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.clip();
      const body = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.35, 4, cx, cy, radius);
      body.addColorStop(0, 'rgba(255,255,255,0.45)');
      body.addColorStop(0.4, 'rgba(8, 12, 32, 0.25)');
      body.addColorStop(1, 'rgba(5, 6, 15, 0.05)');
      ctx.fillStyle = body;
      ctx.fillRect(0, 0, size, size);

      const wobble = reduce ? 0 : Math.sin(now / 520) * (1.4 + Math.abs(spring.velocity) * 18);
      const level = cy + radius - fill * radius * 1.9 + wobble + (reduce ? 0 : tilt.y * 4);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      ctx.moveTo(0, size);
      ctx.lineTo(0, level);
      const slope = reduce ? 0 : tilt.x * 6;
      for (let x = 0; x <= size; x += 6) {
        const wave = reduce ? 0 : Math.sin(x / 9 + now / 380) * (1.6 + Math.abs(spring.velocity) * 10);
        ctx.lineTo(x, level + wave + slope * ((x / size) - 0.5));
      }
      ctx.lineTo(size, size);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.34)';
      ctx.lineWidth = 1.25;
      ctx.stroke();

      if (!reduce) raf = requestAnimationFrame(draw);
    };

    draw(performance.now());
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('deviceorientation', onTilt);
    };
  }, [compact]);

  return (
    <figure className={compact ? 'orbit-orb compact' : 'orbit-orb'} aria-hidden="true">
      <canvas ref={canvasRef} />
    </figure>
  );
}
