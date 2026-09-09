import { useId, type ReactNode } from 'react';

/**
 * ui/EngineRing.tsx
 * Inelul motorului — redesign "Camera obscura".
 *
 * E singurul loc de pe ecranul principal care are voie sa poarte spectralul
 * violet->cyan, si asta e chiar regula redesignului: gradientul inseamna "aici
 * vorbeste masina". Inelul arata cat de des a fost motorul de acord cu tine —
 * o masuratoare a lui despre el insusi, nu o decoratie.
 *
 * De ce NU si inelul de progres de pe acelasi ecran (.home-hero-ring): acela
 * numara cate poze ai decis TU. Daca ar purta acelasi semn, semnul n-ar mai
 * insemna nimic. Ramane pe accentul ales de utilizator in Aspect.
 *
 * Vezi styles.vision.test.ts — `.engine-ring` e una din cele patru suprafete
 * din lista scurta care pot cere token-ii motorului.
 */

const RADIUS = 18;
const STROKE = 1.8;
/** Lungimea cercului. Constanta, nu calculata la fiecare randare — raza e fixa. */
export const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Cat din cerc ramane NEdesenat, pentru un procent dat. Marunt, dar e chiar
 * locul unde un inel se poate insela tacut: la 0 arata plin daca inversezi
 * scaderea, iar la valori din afara intervalului deseneaza un arc mai lung
 * decat cercul (dashoffset negativ), care se suprapune peste el insusi.
 */
export function arcOffset(percent: number): number {
  const clamped = Math.max(0, Math.min(100, percent));
  return CIRCUMFERENCE * (1 - clamped / 100);
}

export interface EngineRingProps {
  /** 0..100. In afara intervalului se strange la capete, nu deseneaza aiurea. */
  percent: number;
  /**
   * Ce scrie in mijloc. Nod, nu text: cifra din inel e in continuare cea care
   * se numara crescator la intrare (AnimatedNumber), iar unitatea sta langa ea.
   * Absent = inel gol, doar arcul.
   */
  label?: ReactNode;
  size?: number;
}

export function EngineRing({ percent, label, size = 52 }: EngineRingProps) {
  // Doua inele pe acelasi ecran ar imparti acelasi <linearGradient id> si al
  // doilea l-ar suprascrie pe primul — un defect care nu apare niciodata pe un
  // ecran cu un singur inel, adica exact cand testezi.
  const gradientId = useId();
  const c = size / 2;
  const scale = size / 52;
  return (
    <span className="engine-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--engine-1)" />
            <stop offset="0.55" stopColor="var(--engine-2)" />
            <stop offset="1" stopColor="var(--engine-3)" />
          </linearGradient>
        </defs>
        <circle cx={c} cy={c} r={RADIUS * scale} fill="none" stroke="var(--edge-strong)" strokeWidth={STROKE} />
        <circle
          cx={c} cy={c} r={RADIUS * scale} fill="none" stroke={`url(#${gradientId})`}
          strokeWidth={STROKE} strokeLinecap="round"
          // Cercul incepe la ora 3; rotit ca sa porneasca de sus, de unde
          // se asteapta oricine sa inceapa un indicator de progres.
          strokeDasharray={CIRCUMFERENCE * scale}
          strokeDashoffset={arcOffset(percent) * scale}
          transform={`rotate(-90 ${c} ${c})`}
        />
      </svg>
      {label !== undefined && label !== null && <b className="mono">{label}</b>}
    </span>
  );
}
