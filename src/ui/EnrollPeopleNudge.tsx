import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import {
  shouldShowEnrollNudge, readEnrollNudgeDismissed, writeEnrollNudgeDismissed
} from '../state/enrollNudge';
import { UserCheckIcon, XIcon } from './icons';
import { t } from '../i18n';

/**
 * "Spune-i cine conteaza pentru tine."
 *
 * Cat timp nu e inrolat nimeni, motorul nu poate deosebi persoana ta de un
 * trecator. Nu mai penalizeaza pozele pentru asta (vezi extractFeatures in
 * learning/ContextEngine.ts), dar tot nu STIE — iar ecranul de Persoane exista
 * si nimic nu te trimite acolo.
 *
 * Cand apare si de ce tocmai atunci: vezi state/enrollNudge.ts. Pe scurt — dupa
 * ce omul a triat ceva, doar daca biblioteca chiar are oameni in ea, si o
 * singura data: inrolarea se face o data, deci un memento care revine dupa ce
 * ai spus "nu" ar fi insistenta, nu ajutor.
 */
export function EnrollPeopleNudge() {
  const locale = useStore(s => s.locale);
  const tr = (key: string) => t(locale, key);
  const photos = useStore(s => s.photos);
  const persons = useStore(s => s.persons);
  const setPersonsOpen = useStore(s => s.setPersonsOpen);
  const [hidden, setHidden] = useState(() => readEnrollNudgeDismissed());

  const visible = useMemo(() => {
    if (hidden) return false;
    let withFaces = 0, decided = 0;
    for (const p of photos) {
      if (p.faceCount > 0) withFaces++;
      if (p.status !== 'pending') decided++;
    }
    return shouldShowEnrollNudge({
      enrolledPersons: persons.length,
      photosWithFaces: withFaces,
      decidedPhotos: decided,
      dismissed: false
    });
  }, [hidden, photos, persons.length]);

  if (!visible) return null;

  const dismiss = () => { writeEnrollNudgeDismissed(); setHidden(true); };
  const open = () => { writeEnrollNudgeDismissed(); setHidden(true); setPersonsOpen(true); };

  return (
    <div className="install-prompt" role="status">
      <div className="install-prompt-row">
        <UserCheckIcon className="install-prompt-icon" aria-hidden="true" />
        <span className="install-prompt-text mono">{tr('app.enrollNudge.text')}</span>
        <button className="ghost icon-btn install-prompt-close" onClick={dismiss} aria-label={tr('app.enrollNudge.dismiss')}>
          <XIcon />
        </button>
      </div>
      <button className="ghost small install-prompt-install" onClick={open}>
        {tr('app.enrollNudge.action')}
      </button>
    </div>
  );
}
