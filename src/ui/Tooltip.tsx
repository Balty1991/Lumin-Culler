import { useRef, useState, type ReactNode } from 'react';

interface TooltipProps {
  label: string;
  shortcut?: string;
  children: ReactNode;
  /** Aliniere fata de element — 'bottom' impicit, 'left' pentru butoane langa marginea dreapta a ecranului. */
  side?: 'bottom' | 'left';
}

/** Cat trebuie tinut apasat pe touch inainte sa apara eticheta — sub acest prag, o
 * atingere normala (tap) nu declanseaza nimic, doar apasarea intentionata. */
const LONG_PRESS_MS = 420;

/**
 * Tooltip minimal, aparitie instant la hover/focus (desktop) — pentru butoanele
 * doar-iconita din bara de unelte. Pe touch, `:hover`/`:focus-within` nu ajuta
 * (nu exista hover, iar focus-ul poate ramane "agatat" dupa un tap, blocand
 * eticheta deschisa — de-aia CSS o dezactiveaza explicit sub `hover: none`).
 * O apasare lunga (long-press) arata totusi eticheta temporar: singurul mod
 * de a intelege o iconita ambigua pe telefon, fara sa consume spatiu vizibil
 * permanent (feedback direct: "nu stiu ce fac iconitele" pe mobil).
 */
export function Tooltip({ label, shortcut, children, side = 'bottom' }: TooltipProps) {
  const [touchVisible, setTouchVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null; }
  };
  const onTouchStart = () => {
    clearTimer();
    timerRef.current = setTimeout(() => setTouchVisible(true), LONG_PRESS_MS);
  };
  const onTouchEnd = () => { clearTimer(); setTouchVisible(false); };

  return (
    <span
      className={`tooltip-wrap${side === 'left' ? ' tooltip-left' : ''}${touchVisible ? ' touch-active' : ''}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      onTouchMove={onTouchEnd}
    >
      {children}
      <span className="tooltip-bubble" role="tooltip">
        {label}
        {shortcut && <kbd>{shortcut}</kbd>}
      </span>
    </span>
  );
}
