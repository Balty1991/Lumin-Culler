import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { COLOR_LABELS, type ColorLabel } from '../core/db';
import { useStore } from '../state/store';
import { TagIcon } from './icons';
import { t } from '../i18n';

interface Props {
  value: ColorLabel | null;
  onChange: (c: ColorLabel | null) => void;
}

/**
 * Filtru dupa eticheta de culoare — un singur buton compact, nu 5 bilute
 * mereu vizibile in randul de filtre (aglomerau scroll-ul orizontal pe mobil
 * si n-aveau nicio eticheta text vizibila la atingere, doar un tooltip
 * `title` care nu apare pe touch — feedback direct de la utilizator).
 * Deschide un mic meniu cu nume + swatch pentru fiecare culoare, randat
 * printr-un portal in <body>: randul de filtre (.filters) e orizontal
 * scrollabil (overflow-x: auto), iar CSS forteaza overflow-y tot la 'auto'
 * cand nu e setat explicit — un meniu absolut pozitionat, copil normal al
 * randului, ar fi fost taiat/invizibil (nu doar ascuns de scroll orizontal).
 */
export function ColorLabelFilter({ value, onChange }: Props) {
  const locale = useStore(s => s.locale);
  const tr = (key: string) => t(locale, key);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    if (!open) {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setMenuPos({ top: rect.bottom + 6, left: rect.left });
    }
    setOpen(v => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="color-label-filter">
      <button
        ref={triggerRef}
        type="button"
        className={value ? 'chip color-label-filter-trigger active' : 'chip color-label-filter-trigger'}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={tr('app.colorLabelFilter.ariaLabel')}
      >
        {value ? <span className={`color-label-swatch label-${value}`} aria-hidden="true" /> : <TagIcon className="chip-icon" aria-hidden="true" />}
        {value ? tr(`colorLabel.${value}`) : tr('app.colorLabelFilter.label')}
      </button>
      {open && menuPos && createPortal(
        <div
          className="color-label-filter-menu"
          role="menu"
          aria-label={tr('app.colorLabelFilter.ariaLabel')}
          ref={menuRef}
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {COLOR_LABELS.map(c => (
            <button
              key={c}
              type="button"
              role="menuitemradio"
              aria-checked={value === c}
              className={value === c ? 'color-label-filter-option active' : 'color-label-filter-option'}
              onClick={() => { onChange(value === c ? null : c); setOpen(false); }}
            >
              <span className={`color-label-swatch label-${c}`} aria-hidden="true" />
              {tr(`colorLabel.${c}`)}
            </button>
          ))}
          {value && (
            <button type="button" className="color-label-filter-option color-label-filter-clear" onClick={() => { onChange(null); setOpen(false); }}>
              {tr('app.colorLabelFilter.clear')}
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
