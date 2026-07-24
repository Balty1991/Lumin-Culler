import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { KeyboardIcon, XIcon } from './icons';
import { t } from '../i18n';

interface Shortcut { keys: string; labelKey: string; }
interface Section { titleKey: string; shortcuts: Shortcut[]; }

const SECTIONS: Section[] = [
  {
    titleKey: 'shortcuts.section.global',
    shortcuts: [
      { keys: 'Ctrl/Cmd+K', labelKey: 'shortcuts.openPalette' },
      { keys: 'Ctrl/Cmd+Z', labelKey: 'shortcuts.undo' },
      { keys: '?', labelKey: 'shortcuts.openShortcuts' }
    ]
  },
  {
    titleKey: 'shortcuts.section.workspace',
    shortcuts: [
      { keys: '← →', labelKey: 'shortcuts.navigate' },
      { keys: 'P', labelKey: 'shortcuts.select' },
      { keys: 'X', labelKey: 'shortcuts.reject' },
      { keys: '0-5', labelKey: 'shortcuts.rating' },
      { keys: 'I', labelKey: 'shortcuts.toggleStats' },
      { keys: 'Esc', labelKey: 'shortcuts.exitWorkspace' }
    ]
  },
  {
    titleKey: 'shortcuts.section.detail',
    shortcuts: [
      { keys: '← →', labelKey: 'shortcuts.prevNext' },
      { keys: 'P', labelKey: 'shortcuts.selectShort' },
      { keys: 'X', labelKey: 'shortcuts.rejectShort' },
      { keys: '0-5', labelKey: 'shortcuts.rating' },
      { keys: 'Z', labelKey: 'shortcuts.zoom' },
      { keys: 'Esc', labelKey: 'shortcuts.close2' }
    ]
  },
  {
    titleKey: 'shortcuts.section.palette',
    shortcuts: [
      { keys: '↑ ↓', labelKey: 'shortcuts.paletteNav' },
      { keys: 'Enter', labelKey: 'shortcuts.paletteRun' },
      { keys: 'Esc', labelKey: 'shortcuts.paletteClose' }
    ]
  }
];

/** Ecran de ajutor cu toate scurtaturile de tastatura, grupate pe context — deschis cu "?" sau din Paleta de comenzi. */
export function ShortcutsPanel() {
  const open = useStore(s => s.shortcutsOpen);
  const setOpen = useStore(s => s.setShortcutsOpen);
  const locale = useStore(s => s.locale);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  // "?" global — ignora tastarea din campuri text (acelasi gardian ca in
  // Workspace/DetailView), altfel scrierea unui "?" intr-o cautare ar
  // deschide accidental acest panou peste ea
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label={t(locale, 'shortcuts.title')} tabIndex={-1}>
        <header className="detail-head">
          <span><KeyboardIcon className="inline-icon" /> {t(locale, 'shortcuts.title')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={t(locale, 'shortcuts.close')}>
            <XIcon />
          </button>
        </header>

        {SECTIONS.map(section => (
          <div className="shortcuts-section" key={section.titleKey}>
            <h3>{t(locale, section.titleKey)}</h3>
            <ul className="shortcuts-list">
              {section.shortcuts.map(s => (
                <li key={s.keys + s.labelKey}>
                  <kbd className="mono">{s.keys}</kbd>
                  <span>{t(locale, s.labelKey)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
