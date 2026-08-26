import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { reasonsFor } from '../core/decisionReasons';
import { XIcon, SparkleIcon } from './icons';
import { t } from '../i18n';

/**
 * ui/ExplainDecisionSheet.tsx
 * "De ce ai decis asa?" — motive apasate, plus o nota scrisa, optionala.
 *
 * Cerinta directa a utilizatorului. Doua zone, si granita dintre ele e tot ce
 * conteaza la ecranul asta:
 *
 *  - BUTOANELE antreneaza. Fiecare motiv trimite catre trasaturi pe care
 *    aplicatia chiar le masoara (bokeh, focus pe subiect, incadrare...), iar
 *    pasul de invatare se redistribuie catre ele — vezi REASON_FEATURE_BOOST.
 *  - NOTA nu antreneaza. Se pastreaza, se cauta, si atat.
 *
 * Scrie asta pe ecran, sub casuta de text. Ar fi fost mai simplu sa nu scriem
 * nimic si sa lasam omul sa creada ca aplicatia ii citeste notele; ar fi fost
 * si singura minciuna din tot produsul.
 */
export function ExplainDecisionSheet() {
  const photoId = useStore(s => s.explainPhotoId);
  const setPhotoId = useStore(s => s.setExplainPhotoId);
  const photos = useStore(s => s.photos);
  const explainDecision = useStore(s => s.explainDecision);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  const photo = photoId ? photos.find(p => p.id === photoId) ?? null : null;
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, !!photo);

  // La fiecare deschidere se porneste de la ce e DEJA salvat pe poza, nu de la
  // gol: cine revine ca sa adauge ceva n-are de ce sa-si piarda ce a spus
  // prima data.
  useEffect(() => {
    if (!photo) return;
    setPicked(photo.decisionReasons ?? []);
    setNote(photo.decisionNote ?? '');
  }, [photoId, photo]);

  useEffect(() => {
    if (!photo) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPhotoId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photo, setPhotoId]);

  if (!photo) return null;

  // Doar pentru o decizie luata. "Nedecisa" n-are ce sa explice, iar
  // "deoparte" e tocmai refuzul de a te pronunta.
  const decision = photo.status === 'selected' || photo.status === 'rejected' ? photo.status : null;
  if (!decision) return null;

  const toggle = (id: string) =>
    setPicked(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setPhotoId(null); }}>
      <div
        className="detail-inner narrow" ref={containerRef}
        role="dialog" aria-modal="true" aria-label={tr('explain.title')} tabIndex={-1}
      >
        <header className="detail-head">
          <span>{tr('explain.title')}</span>
          <button className="ghost icon-btn" onClick={() => setPhotoId(null)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        <p className="hint explain-why">
          <SparkleIcon className="inline-icon" aria-hidden="true" /> {tr('explain.why')}
        </p>

        <div className="explain-reasons" role="group" aria-label={tr('explain.title')}>
          {reasonsFor(decision).map(r => {
            const on = picked.includes(r.id);
            return (
              <button
                key={r.id}
                className={on ? 'chip explain-reason active' : 'chip explain-reason'}
                aria-pressed={on}
                onClick={() => toggle(r.id)}
              >
                {tr(`reason.${r.id}`)}
              </button>
            );
          })}
        </div>

        <label className="explain-note">
          <span className="explain-note-label">{tr('explain.noteLabel')}</span>
          <textarea
            rows={3}
            value={note}
            placeholder={tr('explain.notePlaceholder')}
            onChange={e => setNote(e.target.value)}
          />
        </label>
        {/* Granita, scrisa pe fata. Vezi comentariul din capul fisierului. */}
        <p className="hint explain-note-hint">{tr('explain.noteHint')}</p>

        <div className="explain-actions">
          <button className="ghost" onClick={() => setPhotoId(null)} disabled={busy}>
            {tr('explain.cancel')}
          </button>
          <button
            className="btn-accent"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              setBusy(true);
              void explainDecision(photo.id, picked, note)
                .then(() => setPhotoId(null))
                .finally(() => setBusy(false));
            }}
          >
            {tr('explain.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
