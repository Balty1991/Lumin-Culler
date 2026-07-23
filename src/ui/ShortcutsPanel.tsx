import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { KeyboardIcon } from './icons';

interface Shortcut { keys: string; label: string; }
interface Section { title: string; shortcuts: Shortcut[]; }

const SECTIONS: Section[] = [
  {
    title: 'Global',
    shortcuts: [
      { keys: 'Ctrl/Cmd+K', label: 'Deschide paleta de comenzi' },
      { keys: 'Ctrl/Cmd+Z', label: 'Anuleaza ultima decizie' },
      { keys: '?', label: 'Deschide acest ecran de scurtaturi' }
    ]
  },
  {
    title: 'Spatiu de lucru (Workspace)',
    shortcuts: [
      { keys: '← →', label: 'Navigheaza intre poze' },
      { keys: 'P', label: 'Selecteaza poza curenta' },
      { keys: 'X', label: 'Respinge poza curenta' },
      { keys: '0-5', label: 'Rating cu stele (0 = fara rating)' },
      { keys: 'I', label: 'Arata/ascunde statisticile pe imagine' },
      { keys: 'Esc', label: 'Iesi din spatiul de lucru' }
    ]
  },
  {
    title: 'Vizualizare detaliu',
    shortcuts: [
      { keys: '← →', label: 'Poza anterioara / urmatoare' },
      { keys: 'P', label: 'Selecteaza' },
      { keys: 'X', label: 'Respinge' },
      { keys: '0-5', label: 'Rating cu stele (0 = fara rating)' },
      { keys: 'Z', label: 'Zoom 100%' },
      { keys: 'Esc', label: 'Inchide' }
    ]
  },
  {
    title: 'Paleta de comenzi',
    shortcuts: [
      { keys: '↑ ↓', label: 'Navigheaza in lista de rezultate' },
      { keys: 'Enter', label: 'Executa comanda selectata' },
      { keys: 'Esc', label: 'Inchide paleta' }
    ]
  }
];

/** Ecran de ajutor cu toate scurtaturile de tastatura, grupate pe context — deschis cu "?" sau din Paleta de comenzi. */
export function ShortcutsPanel() {
  const open = useStore(s => s.shortcutsOpen);
  const setOpen = useStore(s => s.setShortcutsOpen);
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
      <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label="Scurtaturi de tastatura" tabIndex={-1}>
        <header className="detail-head">
          <span><KeyboardIcon className="inline-icon" /> Scurtaturi de tastatura</span>
          <button className="ghost" onClick={() => setOpen(false)}>Inchide</button>
        </header>

        {SECTIONS.map(section => (
          <div className="shortcuts-section" key={section.title}>
            <h3>{section.title}</h3>
            <ul className="shortcuts-list">
              {section.shortcuts.map(s => (
                <li key={s.keys + s.label}>
                  <kbd className="mono">{s.keys}</kbd>
                  <span>{s.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
