import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  addCurvePoint, buildCurveLut, findCurvePoint, moveCurvePoint, removeCurvePoint,
  LINEAR_CURVE, type CurvePoint
} from '../core/toneCurve';

/**
 * ui/CurveEditor.tsx
 * Suprafata de desen a curbei tonale. Patrata din constructie: axa X e
 * intrarea, axa Y e iesirea, iar diagonala e "nu schimba nimic" — un dreptunghi
 * ar strica citirea aia, care e tot ce face curba inteligibila dintr-o privire.
 *
 * In spatele curbei se deseneaza histograma pozei. Nu e decor: fara ea,
 * ridicarea unui punct e o ghiceala — cu ea, se vede exact unde stau umbrele
 * si luminile CADRULUI ASTA, deci unde merita pus punctul.
 *
 * Accesibilitate: suprafata e focalizabila si se manevreaza complet de la
 * tastatura (sageti = mutare, Enter = punct nou la mijloc, Delete = sterge
 * punctul selectat). Un canvas pe care se poate desena doar cu degetul ar fi
 * fost o functie inchisa pentru oricine navigheaza cu tastatura.
 */

const SIZE = 260;
const HIT_RADIUS = 0.075;
/** Cat muta o apasare de sageata (in unitati 0..1) — 1/50 din gama, adica un pas vizibil dar fin. */
const KEY_STEP = 0.02;

export interface CurveEditorProps {
  points: CurvePoint[] | undefined;
  onChange: (points: CurvePoint[]) => void;
  /** Histograma luminantei pozei (256 de gale), optionala. */
  histogram?: Uint32Array;
  /** Culoarea liniei — canalul curent (master/rosu/verde/albastru). */
  strokeColor: string;
  label: string;
  hint: string;
}

export function CurveEditor({ points, onChange, histogram, strokeColor, label, hint }: CurveEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState(-1);
  const dragRef = useRef<number>(-1);
  const pts = points && points.length >= 2 ? points : LINEAR_CURVE;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);

    // histograma, in spate
    if (histogram) {
      let max = 0;
      for (let i = 0; i < 256; i++) if (histogram[i] > max) max = histogram[i];
      if (max > 0) {
        ctx.fillStyle = 'rgba(140, 150, 170, 0.28)';
        ctx.beginPath();
        ctx.moveTo(0, SIZE);
        for (let i = 0; i < 256; i++) {
          // radacina patrata: altfel un varf urias (cer alb) turteste tot restul
          const h = Math.sqrt(histogram[i] / max) * SIZE * 0.9;
          ctx.lineTo((i / 255) * SIZE, SIZE - h);
        }
        ctx.lineTo(SIZE, SIZE);
        ctx.closePath();
        ctx.fill();
      }
    }

    // caroiaj + diagonala de referinta
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const p = (i / 4) * SIZE;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(SIZE, p); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, SIZE); ctx.lineTo(SIZE, 0); ctx.stroke();
    ctx.setLineDash([]);

    // curba insasi, desenata din chiar tabelul folosit la randare — ce se vede
    // aici e exact ce se aplica pe poza, nu o aproximare separata
    const lut = buildCurveLut(pts);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * SIZE;
      const y = SIZE - (lut[i] / 255) * SIZE;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // punctele de control
    for (let i = 0; i < pts.length; i++) {
      const x = pts[i].x * SIZE;
      const y = SIZE - pts[i].y * SIZE;
      ctx.beginPath();
      ctx.arc(x, y, i === selected ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = i === selected ? strokeColor : '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.stroke();
    }
  }, [pts, histogram, strokeColor, selected]);

  const toCurveCoords = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: 1 - (e.clientY - rect.top) / rect.height
    };
  };

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const { x, y } = toCurveCoords(e);
    const hit = findCurvePoint(pts, x, y, HIT_RADIUS);
    if (hit >= 0) {
      dragRef.current = hit;
      setSelected(hit);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    const next = addCurvePoint(pts, { x, y });
    if (next === pts) return; // prea aproape de alt punct, sau maxim atins
    onChange(next);
    const idx = findCurvePoint(next, x, y, HIT_RADIUS);
    dragRef.current = idx;
    setSelected(idx);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current < 0) return;
    const { x, y } = toCurveCoords(e);
    onChange(moveCurvePoint(pts, dragRef.current, { x, y }));
  };

  const onUp = () => { dragRef.current = -1; };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLCanvasElement>) => {
    // Tab trebuie sa iasa din widget, nu sa cicleze punctele — altfel
    // utilizatorul de tastatura ramane blocat in curba.
    if (e.key === 'Tab') return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const next = addCurvePoint(pts, { x: 0.5, y: 0.5 });
      if (next !== pts) { onChange(next); setSelected(findCurvePoint(next, 0.5, 0.5, HIT_RADIUS)); }
      return;
    }
    if (selected < 0) {
      if (e.key.startsWith('Arrow')) { e.preventDefault(); setSelected(0); }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const next = removeCurvePoint(pts, selected);
      onChange(next);
      setSelected(Math.min(selected, next.length - 1));
      return;
    }
    const p = pts[selected];
    if (!p) return;
    let dx = 0, dy = 0;
    if (e.key === 'ArrowLeft') dx = -KEY_STEP;
    else if (e.key === 'ArrowRight') dx = KEY_STEP;
    else if (e.key === 'ArrowUp') dy = KEY_STEP;
    else if (e.key === 'ArrowDown') dy = -KEY_STEP;
    else return;
    e.preventDefault();
    onChange(moveCurvePoint(pts, selected, { x: p.x + dx, y: p.y + dy }));
  };

  const selectedPoint = selected >= 0 ? pts[selected] : undefined;

  return (
    <div className="curve-editor">
      <canvas
        ref={canvasRef}
        className="curve-canvas"
        style={{ width: SIZE, height: SIZE }}
        tabIndex={0}
        role="application"
        aria-label={label}
        aria-describedby="curve-editor-hint"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKeyDown}
      />
      <p className="curve-hint" id="curve-editor-hint">{hint}</p>
      {/* Anuntat pentru cititorul de ecran: fara asta, mutarea unui punct cu
          sagetile nu produce niciun raspuns audibil — gestul ar parea ca nu face
          nimic. */}
      <p className="sr-only" role="status" aria-live="polite">
        {selectedPoint ? `${Math.round(selectedPoint.x * 100)} → ${Math.round(selectedPoint.y * 100)}` : ''}
      </p>
    </div>
  );
}
