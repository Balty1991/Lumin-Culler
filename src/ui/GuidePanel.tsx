import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, ChevronUpIcon } from './icons';
import { t } from '../i18n';

/**
 * Manualul aplicatiei.
 *
 * De ce e nevoie de el: sectiunea Ajutor avea scurtaturile de tastatura si o
 * fraza despre confidentialitate. Intre timp aplicatia a ajuns sa faca lucruri
 * pe care nimeni nu le poate ghici din butoane — ce inseamna "Candidat" fata de
 * "De verificat", de ce un cadru cu TEHNIC mic poate avea SERIE 100, ce se
 * intampla cand rezolvi o serie, sau de ce Auto lumineaza o poza pe care
 * histograma o arata stralucitoare.
 *
 * Textul e scris pe CE FACE aplicatia asta, nu pe ce scrie in orice manual de
 * aplicatie foto: fiecare sectiune raspunde la o intrebare pe care si-o pune
 * cineva care deja foloseste produsul si nu intelege ceva anume.
 *
 * Sectiunile sunt pliate implicit — un manual deschis tot deodata e un perete
 * de text prin care nimeni nu cauta nimic. Prima e deschisa, ca sa se vada din
 * ce e facut.
 */
const SECTIONS = [
  'basics', 'decisions', 'verdict', 'why', 'learning', 'series', 'editing', 'cleanup', 'people', 'privacy'
] as const;

/** Cate paragrafe are fiecare sectiune — cheile sunt `guide.<sectiune>.p1..pN`. */
const PARAGRAPHS: Record<(typeof SECTIONS)[number], number> = {
  basics: 3, decisions: 4, verdict: 4, why: 4, learning: 4,
  series: 3, editing: 4, cleanup: 3, people: 2, privacy: 2
};

export function GuidePanel() {
  const open = useStore(s => s.guideOpen);
  const setOpen = useStore(s => s.setGuideOpen);
  const locale = useStore(s => s.locale);
  const tr = (key: string) => t(locale, key);
  const containerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<string>(SECTIONS[0]);
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
      <div className="detail-inner narrow guide-panel" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('guide.title')} tabIndex={-1}>
        <header className="detail-head">
          <span>{tr('guide.title')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        <p className="guide-lead">{tr('guide.lead')}</p>

        {SECTIONS.map(key => {
          const isOpen = expanded === key;
          return (
            <section className={isOpen ? 'guide-section open' : 'guide-section'} key={key}>
              <button
                type="button"
                className="guide-section-head"
                aria-expanded={isOpen}
                onClick={() => setExpanded(isOpen ? '' : key)}
              >
                <span className="guide-section-title">{tr(`guide.${key}.title`)}</span>
                <ChevronUpIcon className="guide-section-chevron" aria-hidden="true" />
              </button>
              {isOpen && (
                <div className="guide-section-body">
                  {Array.from({ length: PARAGRAPHS[key] }, (_, i) => (
                    <p key={i}>{tr(`guide.${key}.p${i + 1}`)}</p>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
