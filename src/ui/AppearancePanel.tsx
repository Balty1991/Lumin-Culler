import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, SparkleIcon } from './icons';
import type { Theme } from '../state/theme';
import type { AccentTheme } from '../state/accentTheme';
import { t } from '../i18n';

/**
 * ui/AppearancePanel.tsx
 * "Aspect" — ecran dedicat, dupa mockup-urile 15 (accent + previzualizare) si
 * 16 (tema, ca lista de optiuni) din prezentare. Inainte, ambele traiau in
 * Meniu ca doua randuri stranse: un buton care CICLA prin cele 3 teme (nu
 * vedeai niciodata ce optiuni exista, doar pe cea curenta) si un rand de
 * pastile de 22px fara nume si fara efect vizibil pana inchideai meniul.
 *
 * Optiunile de tema sunt acum vizibile TOATE deodata (radiogroup), iar
 * cardul de previzualizare arata pe loc ce fac accentul si tema pe
 * suprafetele reale ale aplicatiei (buton principal, chip AI, text secundar)
 * — se aplica instant, deci previzualizarea e chiar aplicatia, nu o imagine.
 *
 * Ce NU am preluat din mockup: randul "🔒 2 aspecte exclusive Premium". Toate
 * cele 4 accente functioneaza deja gratuit; a le pune in spatele unui lacat
 * ar insemna sa iau ceva ce utilizatorii au deja, nu sa adaug o functie.
 */
const THEMES: { id: Theme; labelKey: string; subKey: string }[] = [
  { id: 'light', labelKey: 'appearance.theme.light', subKey: 'appearance.theme.light.sub' },
  { id: 'dark', labelKey: 'appearance.theme.dark', subKey: 'appearance.theme.dark.sub' },
  { id: 'auto', labelKey: 'appearance.theme.auto', subKey: 'appearance.theme.auto.sub' }
];

/** Previzualizari STATICE (nu variabile CSS): trebuie sa arate toate cele 4
    optiuni simultan, nu de 4 ori accentul activ acum. Vezi :root[data-accent]
    in styles.css pentru valorile chiar aplicate. */
const ACCENTS: { id: AccentTheme; gradient: string }[] = [
  { id: 'classic', gradient: 'linear-gradient(135deg, #2dd4bf, #8b5cf6 55%, #6366f1)' },
  { id: 'teal', gradient: 'linear-gradient(135deg, #2dd4bf, #14b8a6)' },
  { id: 'sunset', gradient: 'linear-gradient(135deg, #ff8a5c, #ff5c8a)' },
  { id: 'holo', gradient: 'linear-gradient(90deg, #00fff2, #7a5cff)' }
];

export function AppearancePanel() {
  const open = useStore(s => s.appearanceOpen);
  const setOpen = useStore(s => s.setAppearanceOpen);
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);
  const accentTheme = useStore(s => s.accentTheme);
  const setAccentTheme = useStore(s => s.setAccentTheme);
  const locale = useStore(s => s.locale);
  const tr = (key: string) => t(locale, key);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div
        className="detail-inner narrow appearance-panel" ref={containerRef}
        role="dialog" aria-modal="true" aria-label={tr('appearance.title')} tabIndex={-1}
      >
        <header className="detail-head">
          <span>{tr('appearance.title')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        <div className="appearance-section-label">{tr('appearance.accent.label')}</div>
        <div className="appearance-swatches" role="radiogroup" aria-label={tr('appearance.accent.label')}>
          {ACCENTS.map(({ id, gradient }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={accentTheme === id}
              aria-label={tr(`menu.accent.${id}`)}
              title={tr(`menu.accent.${id}`)}
              className={accentTheme === id ? 'appearance-swatch active' : 'appearance-swatch'}
              style={{ background: gradient }}
              onClick={() => setAccentTheme(id)}
            />
          ))}
        </div>

        <div className="appearance-preview">
          <span className="appearance-preview-chip">
            <SparkleIcon className="inline-icon" aria-hidden="true" /> {tr('appearance.preview')}
          </span>
          <p className="appearance-preview-body">{tr('appearance.preview.body')}</p>
          <span className="appearance-preview-btn" aria-hidden="true">{tr('appearance.preview.button')}</span>
        </div>

        <div className="appearance-section-label">{tr('appearance.theme.label')}</div>
        <div role="radiogroup" aria-label={tr('appearance.theme.label')}>
          {THEMES.map(({ id, labelKey, subKey }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={theme === id}
              className={theme === id ? 'appearance-option on' : 'appearance-option'}
              onClick={() => setTheme(id)}
            >
              <span className="appearance-option-text">
                <b>{tr(labelKey)}</b>
                <span>{tr(subKey)}</span>
              </span>
              <span className={theme === id ? 'appearance-radio on' : 'appearance-radio'} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
