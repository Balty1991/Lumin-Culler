import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PhotoView } from '../state/store';
import { useStore } from '../state/store';
import { useTr } from './context';
import { photoTime } from './days';
import { Thumb } from './Thumb';
import { weakDevice } from '../core/deviceClass';

/**
 * lumin/Tunnel3D.tsx
 * „Galerie 3D · Tunelul” (ales din machetă): o călătorie în timp printre poze.
 * La intrare ești azi; înaintând (tragi în sus) mergi înapoi prin luni și ani.
 * Plăcuțele cu luna trec prin centru, pozele pe lângă tine. O atingere pe o poză
 * o deschide normal (în vizualizatorul obișnuit).
 *
 * Performanță: un număr fix de „locuri” (DOM) primesc pozele din jurul poziției
 * curente; transformările se scriu direct pe elemente în requestAnimationFrame,
 * fără randări React la fiecare cadru.
 */
type Entry = { kind: 'photo'; photo: PhotoView; index: number } | { kind: 'month'; label: string } | { kind: 'year'; label: string };

const DEPTH = 300; // distanța dintre două elemente, în px

export function Tunnel3D({ list, onOpen, onClose }: { list: PhotoView[]; onOpen: (index: number) => void; onClose: () => void }) {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const [slots, setSlots] = useState(36);
  useEffect(() => { void weakDevice().then(w => setSlots(w ? 22 : 36)); }, []);

  // Pozele, de la cea mai nouă spre trecut, cu o plăcuță la fiecare lună nouă.
  const entries = useMemo<Entry[]>(() => {
    const fmt = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
    const sorted = list.map((photo, index) => ({ photo, index })).sort((a, b) => photoTime(b.photo) - photoTime(a.photo));
    const out: Entry[] = [];
    let last = '', lastYear = '';
    for (const it of sorted) {
      const t = photoTime(it.photo);
      const key = t ? fmt.format(new Date(t)) : '';
      const year = t ? String(new Date(t).getFullYear()) : '';
      // Un an nou (mergând înapoi): un număr uriaș trece primul prin tunel.
      if (year && lastYear && year !== lastYear) out.push({ kind: 'year', label: year });
      if (year) lastYear = year;
      if (key && key !== last) { out.push({ kind: 'month', label: key }); last = key; }
      out.push({ kind: 'photo', ...it });
    }
    return out;
  }, [list, locale]);

  const stage = useRef<HTMLDivElement>(null);
  const slotEls = useRef<Array<HTMLDivElement | null>>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pos = useRef(-1.6);
  const passed = useRef(-1);
  const vel = useRef(0);
  const [base, setBase] = useState(0); // primul element din fereastra randată
  const baseRef = useRef(0);
  const label = useRef<HTMLSpanElement>(null);
  const worldEl = useRef<HTMLDivElement>(null);
  const sway = useRef({ x: 0, y: 0 });

  // Mișcarea: tras cu degetul (în sus = înainte), rotița, săgețile; cu inerție.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let drag = false, ly = 0, lx = 0, moved = 0;
    const down = (e: PointerEvent) => { drag = true; moved = 0; ly = e.clientY; lx = e.clientX; vel.current = 0; el.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const dy = e.clientY - ly, dx = e.clientX - lx;
      ly = e.clientY; lx = e.clientX; moved += Math.abs(dy) + Math.abs(dx);
      const d = -dy * 0.012;
      pos.current += d; vel.current = d;
      // Camera se înclină după deget, ca într-un zbor.
      sway.current.x = Math.max(-14, Math.min(14, sway.current.x + dx * 0.08));
      sway.current.y = Math.max(-8, Math.min(8, sway.current.y - dy * 0.03));
    };
    const up = (e: PointerEvent) => {
      if (!drag) return;
      drag = false;
      if (moved < 8) {
        const card = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-photo-index]');
        if (card) onOpen(Number(card.dataset.photoIndex));
      }
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); vel.current += e.deltaY * 0.0012; };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') vel.current += 0.08;
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') vel.current -= 0.08;
      if (e.key === 'Escape') onClose();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', () => { drag = false; });
    el.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', key);
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up); el.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', key);
    };
  }, [onOpen, onClose]);

  // Cadrul: pozițiile 3D ale locurilor și cerul cu stele.
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cv = canvas.current!;
    const cx = cv.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let W = 0, H = 0;
    let stars: Array<{ x: number; y: number; z: number }> = [];
    const resize = () => {
      W = cv.width = window.innerWidth * dpr; H = cv.height = window.innerHeight * dpr;
      stars = Array.from({ length: 180 }, () => ({ x: (Math.random() - 0.5) * W, y: (Math.random() - 0.5) * H, z: Math.random() }));
    };
    resize();
    window.addEventListener('resize', resize);
    let raf = 0, lastPos = pos.current;
    const max = Math.max(0, entries.length - 1);
    const frame = () => {
      // Poza deschisă deasupra: tunelul stă (nu consumă baterie în spate).
      if (document.body.classList.contains('lx-viewer-open')) { raf = requestAnimationFrame(frame); return; }
      // Inerție; la capete, se oprește lin.
      vel.current *= 0.93;
      if (!reduce && Math.abs(vel.current) < 0.0015 && pos.current < max - 1) pos.current += 0.0035;
      pos.current += vel.current;
      if (pos.current < -2) { pos.current = -2; vel.current = 0; }
      if (pos.current > max) { pos.current = max; vel.current = 0; }
      const p = pos.current;
      // Fereastra randată urmează poziția (React randează doar când se schimbă baza).
      const nb = Math.max(0, Math.floor(p) - 2);
      if (nb !== baseRef.current) { baseRef.current = nb; setBase(nb); }

      const vw = window.innerWidth, vh = window.innerHeight;
      const rad = Math.min(vw, vh) * 0.4;
      slotEls.current.forEach((el, s) => {
        if (!el) return;
        const k = baseRef.current + s;
        const e = entries[k];
        if (!e) { el.style.opacity = '0'; return; }
        const rel = k - p; // câte elemente în față
        // Lângă tine (rel mic), poza nu mai vine spre ecran: zboară spre margine și
        // dispare repede, ca atunci când treci pe lângă ceva. Înainte rămânea uriașă
        // și pe jumătate transparentă peste celelalte (raportat: „tranziție ciudată”).
        const pass = rel < 0.9 ? (0.9 - rel) / 0.9 : 0; // 0 departe → 1 lângă tine
        const z = Math.min(-rel * DEPTH + 120, 220);
        let o = 1;
        if (rel > slots - 8) o = Math.max(0, (slots - 2 - rel) / 6);
        if (pass > 0) o = Math.min(o, Math.max(0, 1 - pass * pass * 1.6));
        if (e.kind === 'month' || e.kind === 'year') {
          el.style.transform = `translate3d(-50%, calc(-50% - ${pass * pass * vh * 0.5}px), ${z}px)`;
          // Trecut prin plăcuță: o vibrație scurtă (unde telefonul o permite).
          if (rel < 0.15 && rel > -0.2 && passed.current !== k) { passed.current = k; try { navigator.vibrate?.(e.kind === 'year' ? 18 : 8); } catch { /* fără */ } }
        } else {
          const a = k * 2.39996;
          const r = rad * (0.85 + (k % 3) * 0.14) * (1 + pass * pass * 2.2);
          el.style.transform = `translate3d(calc(-50% + ${Math.cos(a) * r}px), calc(-50% + ${Math.sin(a) * r * 0.72}px), ${z}px)`;
        }
        el.style.opacity = String(o);
        el.style.zIndex = String(1000 - Math.round(rel * 10));
        el.style.pointerEvents = o > 0.6 ? 'auto' : 'none';
        el.style.visibility = o < 0.01 ? 'hidden' : 'visible';
      });
      // Luna în care ești acum, sus.
      if (label.current) {
        let lab = '';
        for (let k = Math.max(0, Math.round(p)); k >= 0; k--) { const e = entries[k]; if (e?.kind === 'month') { lab = e.label; break; } }
        if (label.current.textContent !== lab) label.current.textContent = lab;
      }
      // Stelele: zboară spre margini cât înaintezi.
      const dp = p - lastPos; lastPos = p;
      sway.current.x *= 0.95; sway.current.y *= 0.95;
      if (worldEl.current) worldEl.current.style.transform = `rotateY(${sway.current.x}deg) rotateX(${sway.current.y}deg)`;
      const warp = Math.min(1, Math.abs(dp) * 9); // 0 liniștit → 1 viteza luminii
      cx.fillStyle = '#050305'; cx.fillRect(0, 0, W, H);
      const g = cx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6);
      g.addColorStop(0, 'rgba(255,79,127,0.10)'); g.addColorStop(1, 'rgba(255,79,127,0)');
      cx.fillStyle = g; cx.fillRect(0, 0, W, H);
      for (const st of stars) {
        const f = 1 + dp * 0.25 * (0.4 + st.z);
        st.x *= f; st.y *= f;
        if (Math.abs(st.x) > W / 2 || Math.abs(st.y) > H / 2 || (Math.abs(st.x) < 2 && Math.abs(st.y) < 2)) {
          st.x = (Math.random() - 0.5) * W * (dp >= 0 ? 0.3 : 1); st.y = (Math.random() - 0.5) * H * (dp >= 0 ? 0.3 : 1);
        }
        const sz = (0.6 + st.z * 1.6) * dpr;
        const col = st.z > 0.9 ? `rgba(255,179,200,${0.4 + st.z * 0.6})` : `rgba(255,246,249,${0.25 + st.z * 0.6})`;
        if (warp > 0.15) {
          // Viteză mare: dâre de lumină spre centru (efectul de „warp”).
          const len = warp * (0.25 + st.z) * 0.35;
          cx.strokeStyle = col; cx.lineWidth = sz * 0.8;
          cx.beginPath(); cx.moveTo(W / 2 + st.x, H / 2 + st.y); cx.lineTo(W / 2 + st.x * (1 - len), H / 2 + st.y * (1 - len)); cx.stroke();
        } else {
          cx.fillStyle = col;
          cx.fillRect(W / 2 + st.x, H / 2 + st.y, sz, sz);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [entries, slots]);

  const count = list.length;
  return createPortal(
    <div className="lx lx-tunnel" role="dialog" aria-modal="true" aria-label={tr('lx.tunnel.title')}>
      <canvas ref={canvas} className="lx-tunnel-sky" aria-hidden="true" />
      <div ref={stage} className="lx-tunnel-stage">
        <div ref={worldEl} className="lx-tunnel-world">
          {Array.from({ length: slots }, (_, s) => {
            const e = entries[base + s];
            return (
              <div key={base + s} ref={el => { slotEls.current[s] = el; }} className={e?.kind === 'month' ? 'lx-tunnel-month' : e?.kind === 'year' ? 'lx-tunnel-month lx-tunnel-year' : 'lx-tunnel-card'}
                data-photo-index={e?.kind === 'photo' ? e.index : undefined} style={{ opacity: 0 }}>
                {e?.kind === 'photo' && <Thumb id={e.photo.id} lqip={e.photo.lqip} edits={e.photo.edits} />}
                {(e?.kind === 'month' || e?.kind === 'year') && <span>{e.label}</span>}
              </div>
            );
          })}
        </div>
      </div>
      <header className="lx-tunnel-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <button className="lx-tunnel-now" onClick={() => {
          // Salt la luna următoare (mai în trecut): un impuls lin până la plăcuța ei.
          const from = Math.max(0, Math.ceil(pos.current + 0.5));
          const next = entries.findIndex((e, k) => k > from && e.kind === 'month');
          if (next > 0) vel.current = Math.min(1.2, (next - pos.current) * 0.07);
        }} aria-label={tr('lx.tunnel.next')}><small>{tr('lx.tunnel.title')} · ⇣</small><span ref={label} /></button>
        <span className="lx-tunnel-count">{count}</span>
      </header>
      <p className="lx-tunnel-hint">{tr('lx.tunnel.hint')}</p>
    </div>,
    document.body
  );
}
