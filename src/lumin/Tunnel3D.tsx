import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PhotoView } from '../state/store';
import { useStore } from '../state/store';
import { useTr } from './context';
import { photoTime } from './days';
import { SCREEN_SIZE, sharpUrl } from './sharp';
import { getCachedThumbUrl } from '../core/thumbUrlCache';
import { weakDevice } from '../core/deviceClass';

/**
 * lumin/Tunnel3D.tsx
 * „Galerie 3D · Tunelul”: o călătorie în timp printre poze. La intrare ești azi;
 * înaintând (tragi în sus) mergi înapoi prin luni și ani. Plăcuțele lunilor și
 * anii trec prin centru, pozele pe lângă tine; o atingere deschide poza.
 *
 * Totul se desenează pe UN canvas, cu perspectiva calculată aici. Înainte, fiecare
 * poză era un element 3D separat; WebView-ul de pe Android le redesena pe bucăți
 * când se măreau și pozele pâlpâiau sau apăreau ca dreptunghiuri goale (raportat
 * de mai multe ori). Pe un singur canvas nu mai există straturi de pierdut.
 */
type Entry = { kind: 'photo'; photo: PhotoView; index: number } | { kind: 'month'; label: string } | { kind: 'year'; label: string };
type Sprite = { canvas: HTMLCanvasElement; readyAt: number };

const DEPTH = 300;        // distanța dintre două elemente
const PERSP = 900;        // distanța camerei (ca perspective: 900px)
const CARD_W = 256, CARD_H = 320; // pozele, pregătite o dată, cu colțuri rotunjite

export function Tunnel3D({ list, onOpen, onClose }: { list: PhotoView[]; onOpen: (index: number) => void; onClose: () => void }) {
  const tr = useTr();
  const locale = useStore(s => s.locale);

  // „Doar o persoană”: oamenii recunoscuți în pozele din tunel, cei mai des întâi.
  const [who, setWho] = useState<string | null>(null);
  const people = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of list) for (const name of p.personNames ?? []) n.set(name, (n.get(name) ?? 0) + 1);
    return [...n.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 16);
  }, [list]);

  // Pozele, de la cea mai nouă spre trecut, cu o plăcuță la fiecare lună nouă și anii.
  const entries = useMemo<Entry[]>(() => {
    const fmt = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
    const sorted = list.map((photo, index) => ({ photo, index })).filter(it => !who || (it.photo.personNames ?? []).includes(who)).sort((a, b) => photoTime(b.photo) - photoTime(a.photo));
    const out: Entry[] = [];
    let last = '', lastYear = '';
    for (const it of sorted) {
      const t = photoTime(it.photo);
      const key = t ? fmt.format(new Date(t)) : '';
      const year = t ? String(new Date(t).getFullYear()) : '';
      if (year && lastYear && year !== lastYear) out.push({ kind: 'year', label: year });
      if (year) lastYear = year;
      if (key && key !== last) { out.push({ kind: 'month', label: key[0].toUpperCase() + key.slice(1) }); last = key; }
      out.push({ kind: 'photo', ...it });
    }
    return out;
  }, [list, locale, who]);
  const shown = useMemo(() => entries.filter(e => e.kind === 'photo').length, [entries]);

  const canvas = useRef<HTMLCanvasElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const pos = useRef(-1.6);
  const vel = useRef(0);
  // Altă persoană: călătoria o ia de la capăt (de azi).
  useEffect(() => { pos.current = -1.6; vel.current = 0; }, [who]);
  const sway = useRef({ x: 0, y: 0 });
  const passed = useRef(-1);
  const sprites = useRef(new Map<string, Sprite | 'loading'>());
  /** Ce s-a desenat în ultimul cadru (pentru atingere), din spate în față. */
  const drawn = useRef<Array<{ index: number; x: number; y: number; w: number; h: number }>>([]);
  const windowSize = useRef(30);
  useEffect(() => { void weakDevice().then(w => { windowSize.current = w ? 20 : 30; }); }, []);

  // Poza, pregătită o singură dată: decupată ca o carte de joc, colțuri rotunjite, reflex fin.
  const ensureSprite = (photo: PhotoView) => {
    if (sprites.current.has(photo.id)) return;
    sprites.current.set(photo.id, 'loading');
    void getCachedThumbUrl(photo.id).then(url => {
      if (!url) { sprites.current.delete(photo.id); return; }
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = CARD_W; c.height = CARD_H;
        const g = c.getContext('2d')!;
        const r = 26;
        g.beginPath();
        g.moveTo(r, 0); g.arcTo(CARD_W, 0, CARD_W, CARD_H, r); g.arcTo(CARD_W, CARD_H, 0, CARD_H, r); g.arcTo(0, CARD_H, 0, 0, r); g.arcTo(0, 0, CARD_W, 0, r);
        g.closePath(); g.save(); g.clip();
        const k = Math.max(CARD_W / img.naturalWidth, CARD_H / img.naturalHeight);
        const w = img.naturalWidth * k, h = img.naturalHeight * k;
        g.drawImage(img, (CARD_W - w) / 2, (CARD_H - h) / 2, w, h);
        const sheen = g.createLinearGradient(0, 0, CARD_W * 0.6, CARD_H * 0.5);
        sheen.addColorStop(0, 'rgba(255,255,255,0.16)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = sheen; g.fillRect(0, 0, CARD_W, CARD_H);
        g.restore();
        g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 2; g.stroke();
        sprites.current.set(photo.id, { canvas: c, readyAt: performance.now() });
      };
      img.onerror = () => sprites.current.delete(photo.id);
      img.src = url;
    }).catch(() => sprites.current.delete(photo.id));
  };

  // Mișcarea: tras cu degetul (în sus = înainte), rotița, săgețile; atingerea deschide poza.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let drag = false, ly = 0, lx = 0, moved = 0;
    const down = (e: PointerEvent) => { drag = true; moved = 0; ly = e.clientY; lx = e.clientX; vel.current = 0; el.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const dy = e.clientY - ly, dx = e.clientX - lx;
      ly = e.clientY; lx = e.clientX; moved += Math.abs(dy) + Math.abs(dx);
      const d = -dy * 0.0065;
      pos.current += d; vel.current = vel.current * 0.4 + d * 0.6;
      sway.current.x = Math.max(-40, Math.min(40, sway.current.x + dx * 0.25));
      sway.current.y = Math.max(-24, Math.min(24, sway.current.y + dy * 0.08));
    };
    const up = (e: PointerEvent) => {
      if (!drag) return;
      drag = false;
      vel.current = Math.max(-0.12, Math.min(0.12, vel.current));
      if (moved >= 8) return;
      // Atingere: cea mai din față poză de sub deget.
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const hit = [...drawn.current].reverse().find(d => x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h);
      if (!hit) return;
      const id = list[hit.index]?.id;
      // Poza clară se pregătește întâi (cel mult ~350 ms), ca vizualizatorul să n-o arate goală.
      const ready = id ? Promise.race([sharpUrl(id, SCREEN_SIZE).catch(() => null), new Promise(res => setTimeout(res, 350))]) : Promise.resolve();
      void ready.then(() => onOpen(hit.index));
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); vel.current += e.deltaY * 0.0007; };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') vel.current += 0.08;
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') vel.current -= 0.08;
      if (e.key === 'Escape') onClose();
    };
    const cancel = () => { drag = false; };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', key);
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('wheel', wheel); window.removeEventListener('keydown', key);
    };
  }, [onOpen, onClose, list]);

  // Cadrul: cerul, stelele, pozele și plăcuțele, toate pe același canvas.
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cv = canvas.current!;
    const cx = cv.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let W = 0, H = 0, vw = 0, vh = 0;
    let stars: Array<{ x: number; y: number; z: number }> = [];
    const resize = () => {
      vw = window.innerWidth; vh = window.innerHeight;
      W = cv.width = vw * dpr; H = cv.height = vh * dpr;
      cv.style.width = `${vw}px`; cv.style.height = `${vh}px`;
      stars = Array.from({ length: 180 }, () => ({ x: (Math.random() - 0.5) * W, y: (Math.random() - 0.5) * H, z: Math.random() }));
    };
    resize();
    window.addEventListener('resize', resize);
    const dayFont = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim() || 'system-ui';
    let raf = 0, lastPos = pos.current;
    const max = Math.max(0, entries.length - 1);
    type Item = { k: number; e: Entry; z: number; sx: number; sy: number; s: number; o: number };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      // Poza deschisă deasupra: tunelul stă (nu consumă baterie în spate).
      if (document.body.classList.contains('lx-viewer-open')) return;
      vel.current *= 0.92;
      if (!reduce && Math.abs(vel.current) < 0.0015 && pos.current < max - 1) pos.current += 0.0035;
      pos.current += vel.current;
      if (pos.current < -2) { pos.current = -2; vel.current = 0; }
      if (pos.current > max) { pos.current = max; vel.current = 0; }
      const p = pos.current;
      const dp = p - lastPos; lastPos = p;
      sway.current.x *= 0.94; sway.current.y *= 0.94;
      const warp = Math.max(0, Math.min(1, (Math.abs(dp) - 0.03) * 10));

      // Fundal black rose cu contrast + vignetă.
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.globalAlpha = 1;
      cx.fillStyle = '#020102'; cx.fillRect(0, 0, W, H);
      const R = Math.max(W, H);
      const g = cx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, R * 0.42);
      g.addColorStop(0, `rgba(255,46,110,${0.2 + warp * 0.08})`);
      g.addColorStop(0.35, `rgba(196,24,82,${0.09 + warp * 0.04})`);
      g.addColorStop(1, 'rgba(120,10,50,0)');
      cx.fillStyle = g; cx.fillRect(0, 0, W, H);
      const v = cx.createRadialGradient(W / 2, H / 2, R * 0.3, W / 2, H / 2, R * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.7)');
      cx.fillStyle = v; cx.fillRect(0, 0, W, H);

      // Stelele (warp discret la viteză mare).
      cx.lineCap = 'round';
      for (const st of stars) {
        const f = 1 + dp * 0.22 * (0.4 + st.z);
        st.x *= f; st.y *= f;
        if (Math.abs(st.x) > W / 2 || Math.abs(st.y) > H / 2 || (Math.abs(st.x) < 2 && Math.abs(st.y) < 2)) {
          st.x = (Math.random() - 0.5) * W * (dp >= 0 ? 0.3 : 1); st.y = (Math.random() - 0.5) * H * (dp >= 0 ? 0.3 : 1);
        }
        const sz = (0.6 + st.z * 1.5) * dpr;
        if (warp > 0 && st.z > 0.45) {
          const len = warp * 0.12 * (0.5 + st.z);
          const x0 = W / 2 + st.x, y0 = H / 2 + st.y, x1 = W / 2 + st.x * (1 - len), y1 = H / 2 + st.y * (1 - len);
          const gr = cx.createLinearGradient(x0, y0, x1, y1);
          gr.addColorStop(0, `rgba(255,214,226,${0.3 + 0.4 * st.z * warp})`); gr.addColorStop(1, 'rgba(255,214,226,0)');
          cx.strokeStyle = gr; cx.lineWidth = dpr * (0.6 + st.z * 0.7);
          cx.beginPath(); cx.moveTo(x0, y0); cx.lineTo(x1, y1); cx.stroke();
        } else {
          cx.fillStyle = st.z > 0.9 ? `rgba(255,179,200,${0.4 + st.z * 0.6})` : `rgba(255,246,249,${0.25 + st.z * 0.6})`;
          cx.fillRect(W / 2 + st.x, H / 2 + st.y, sz, sz);
        }
      }

      // Pozele și plăcuțele din jurul poziției, cu perspectivă (ca înainte, în CSS).
      const rad = Math.min(vw, vh) * 0.4;
      const cardW = Math.min(vw * 0.38, 190), cardH = cardW * 1.25;
      const n = windowSize.current;
      const from = Math.max(0, Math.floor(p) - 2);
      const items: Item[] = [];
      const now = performance.now();
      for (let k = from; k < Math.min(entries.length, from + n); k++) {
        const e = entries[k];
        const rel = k - p;
        const pass = rel < 0.9 ? (0.9 - rel) / 0.9 : 0;
        const z = Math.min(-rel * DEPTH + 120, 220);
        let o = 1;
        if (rel > n - 8) o = Math.max(0, (n - 2 - rel) / 6);
        if (pass > 0) o = Math.min(o, Math.max(0, 1 - pass * pass * 1.6));
        let x = 0, y = 0;
        if (e.kind === 'photo') {
          ensureSprite(e.photo);
          const a = k * 2.39996;
          const r = rad * (0.85 + (k % 3) * 0.14) * (1 + pass * pass * 2.2);
          x = Math.cos(a) * r; y = Math.sin(a) * r * 0.72;
        } else {
          y = -pass * pass * vh * 0.5;
          if (rel < 0.15 && rel > -0.2 && passed.current !== k) { passed.current = k; try { navigator.vibrate?.(e.kind === 'year' ? 18 : 8); } catch { /* fără */ } }
        }
        if (o <= 0.01) continue;
        const s = PERSP / (PERSP - z); // mai aproape → mai mare
        // Camera înclinată după deget: ce e aproape se mișcă mai mult (paralaxă).
        const sx = vw / 2 + x * s + sway.current.x * (s - 0.6);
        const sy = vh / 2 + y * s + sway.current.y * (s - 0.6);
        items.push({ k, e, z, sx, sy, s, o });
      }
      items.sort((a, b) => a.z - b.z); // din spate în față

      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const hits: Array<{ index: number; x: number; y: number; w: number; h: number }> = [];
      for (const it of items) {
        if (it.e.kind === 'photo') {
          const sp = sprites.current.get(it.e.photo.id);
          if (!sp || sp === 'loading') continue;
          // Apare treptat după ce e gata (fără „sărituri”).
          const fade = Math.min(1, (now - sp.readyAt) / 220);
          const w = cardW * it.s, h = cardH * it.s;
          cx.globalAlpha = it.o * fade;
          cx.drawImage(sp.canvas, it.sx - w / 2, it.sy - h / 2, w, h);
          if (it.o * fade > 0.6) hits.push({ index: it.e.index, x: it.sx - w / 2, y: it.sy - h / 2, w, h });
        } else {
          const big = it.e.kind === 'year';
          const fs = (big ? 92 : 30) * it.s;
          cx.globalAlpha = it.o;
          cx.font = `650 ${fs}px ${dayFont}`;
          cx.textAlign = 'center'; cx.textBaseline = 'middle';
          if (!big) {
            const tw = cx.measureText(it.e.label).width + 52 * it.s, th = fs + 28 * it.s;
            cx.fillStyle = 'rgba(255,79,127,0.12)';
            cx.strokeStyle = 'rgba(255,79,127,0.6)'; cx.lineWidth = 1.2 * it.s;
            cx.shadowColor = 'rgba(255,79,127,0.7)'; cx.shadowBlur = 30 * it.s;
            cx.beginPath();
            const x0 = it.sx - tw / 2, y0 = it.sy - th / 2, rr = th / 2;
            cx.moveTo(x0 + rr, y0); cx.arcTo(x0 + tw, y0, x0 + tw, y0 + th, rr); cx.arcTo(x0 + tw, y0 + th, x0, y0 + th, rr);
            cx.arcTo(x0, y0 + th, x0, y0, rr); cx.arcTo(x0, y0, x0 + tw, y0, rr); cx.closePath();
            cx.fill(); cx.stroke();
            cx.fillStyle = '#fff6f9';
          } else {
            const gt = cx.createLinearGradient(it.sx - fs, it.sy, it.sx + fs, it.sy);
            gt.addColorStop(0, '#ff4f7f'); gt.addColorStop(0.5, '#ff7f9f'); gt.addColorStop(1, '#ffb3c8');
            cx.fillStyle = gt;
            cx.shadowColor = 'rgba(255,79,127,0.75)'; cx.shadowBlur = 28 * it.s;
          }
          cx.fillText(it.e.label, it.sx, it.sy);
          cx.shadowBlur = 0; cx.shadowColor = 'transparent';
        }
      }
      cx.globalAlpha = 1;
      drawn.current = hits;

      // Luna în care ești acum, sus.
      if (label.current) {
        let lab = '';
        for (let k = Math.max(0, Math.round(p)); k >= 0; k--) { const e = entries[k]; if (e?.kind === 'month') { lab = e.label; break; } }
        if (label.current.textContent !== lab) label.current.textContent = lab;
      }
      // Memoria: pozele departe de fereastră se eliberează.
      if (sprites.current.size > n * 4) {
        const keep = new Set(entries.slice(Math.max(0, from - n), from + n * 2).flatMap(e => (e.kind === 'photo' ? [e.photo.id] : [])));
        for (const id of sprites.current.keys()) if (!keep.has(id)) sprites.current.delete(id);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [entries]); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div className="lx lx-tunnel" role="dialog" aria-modal="true" aria-label={tr('lx.tunnel.title')}>
      <canvas ref={canvas} className="lx-tunnel-sky lx-tunnel-canvas" aria-label={tr('lx.tunnel.hint')} />
      <header className="lx-tunnel-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <button className="lx-tunnel-now" onClick={() => {
          // Salt la luna următoare (mai în trecut): un impuls lin până la plăcuța ei.
          const from = Math.max(0, Math.ceil(pos.current + 0.5));
          const next = entries.findIndex((e, k) => k > from && e.kind === 'month');
          if (next > 0) vel.current = Math.min(1.2, (next - pos.current) * 0.07);
        }} aria-label={tr('lx.tunnel.next')}><small>{tr('lx.tunnel.title')} · ⇣</small><span ref={label} /></button>
        <span className="lx-tunnel-count">{shown}</span>
      </header>
      {people.length > 0 && (
        <div className="lx-tunnel-people" role="radiogroup" aria-label={tr('lx.tunnel.people')}>
          <button role="radio" aria-checked={!who} className={!who ? 'on' : undefined} onClick={() => setWho(null)}>{tr('lx.tunnel.everyone')}</button>
          {people.map(([name, c]) => (
            <button key={name} role="radio" aria-checked={who === name} className={who === name ? 'on' : undefined} onClick={() => setWho(w => (w === name ? null : name))}>
              {name} <small>{c}</small>
            </button>
          ))}
        </div>
      )}
      <p className={people.length > 0 ? 'lx-tunnel-hint with-people' : 'lx-tunnel-hint'}>{tr('lx.tunnel.hint')}</p>
    </div>,
    document.body
  );
}
