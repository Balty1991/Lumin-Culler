import { useEffect, useRef, useState } from 'react';

/** Numar care se anima catre valoarea noua (count-up), fara sarituri brutale intre randari. */
export function AnimatedNumber({ value, durationMs = 500 }: { value: number; durationMs?: number }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number>();
  const reducedMotion = useRef(
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(() => {
    if (reducedMotion.current) { setDisplay(value); fromRef.current = value; return; }
    const from = fromRef.current;
    if (from === value) return;
    const start = performance.now();
    cancelAnimationFrame(rafRef.current!);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current!);
  }, [value, durationMs]);

  return <>{display}</>;
}
