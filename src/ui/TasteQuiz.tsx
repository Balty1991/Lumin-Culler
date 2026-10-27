import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { buildTastePairs, TASTE_QUIZ_MIN_PHOTOS, type TasteAnswer, type TastePair } from '../core/tastePairs';
import { getDisplayUrl } from '../core/previewUrlCache';
import { contextEngine } from '../core/learning/ContextEngine';
import { readTasteQuizDone, writeTasteQuizDone, TASTE_QUIZ_OPEN_EVENT } from '../state/tasteQuiz';
import { useModalFocusTrap } from './useModalFocusTrap';
import { SparkleIcon, XIcon } from './icons';
import { t } from '../i18n';

/**
 * ui/TasteQuiz.tsx
 * „Învață-mă”: AI-ul îți arată două poze din galeria ta și tu alegi pe care o
 * păstrezi. ~12 întrebări, ~2 minute. Fiecare răspuns e o lecție pentru motor
 * (ContextEngine.recordPreference / recordCorrection); la final biblioteca se
 * reclasifică după gustul tău.
 *
 * Se deschide singur o dată, după primul import terminat, și oricând din
 * cardul de pe Acasă (evenimentul TASTE_QUIZ_OPEN_EVENT). Nu schimbă
 * statusul niciunei poze direct: doar învață, apoi rescorePhotos hotărăște.
 */
export function TasteQuiz() {
  const photos = useStore(s => s.photos);
  const progress = useStore(s => s.progress);
  const welcomeSeen = useStore(s => s.welcomeSeen);
  const locale = useStore(s => s.locale);
  const learnTastePair = useStore(s => s.learnTastePair);
  const rescorePhotos = useStore(s => s.rescorePhotos);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  const [open, setOpen] = useState(false);
  const [pairs, setPairs] = useState<TastePair[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  const analysing = !!progress && progress.phase !== 'finalizat';
  const candidates = useMemo(() => photos.map(p => ({
    id: p.id, aiScore: p.aiScore, sharpness: p.sharpness, exposure: p.exposure,
    faceCount: p.faceCount, groupId: p.groupId, aside: p.aside
  })), [photos]);

  const start = () => {
    const next = buildTastePairs(candidates);
    if (!next.length) return;
    setPairs(next);
    setIndex(0);
    setSummary(null);
    setOpen(true);
  };

  // O singură dată, singur: după primul import terminat, cu destule poze.
  useEffect(() => {
    if (open || analysing || !welcomeSeen || readTasteQuizDone()) return;
    if (photos.length < TASTE_QUIZ_MIN_PHOTOS) return;
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysing, welcomeSeen, photos.length]);

  useEffect(() => {
    const onOpen = () => start();
    window.addEventListener(TASTE_QUIZ_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(TASTE_QUIZ_OPEN_EVENT, onOpen);
  });

  const pair = pairs[index];
  // Pozele perechii curente și ale următoarei, ca trecerea să fie instantanee.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const ids = [pair?.aId, pair?.bId, pairs[index + 1]?.aId, pairs[index + 1]?.bId].filter((x): x is string => !!x);
    for (const id of ids) {
      if (urls[id]) continue;
      void getDisplayUrl(id).then(url => {
        if (alive && url) setUrls(prev => ({ ...prev, [id]: url }));
      });
    }
    return () => { alive = false; };
  }, [open, index, pairs, pair, urls]);

  const close = () => {
    writeTasteQuizDone();
    setOpen(false);
  };

  const finish = async () => {
    setBusy(true);
    writeTasteQuizDone();
    try {
      await rescorePhotos();
      const models = await contextEngine.summarize(locale === 'en' ? 'en' : 'ro');
      const notes = [...new Set(models.flatMap(m => m.notes))].slice(0, 3);
      setSummary(notes);
    } catch {
      setSummary([]);
    } finally {
      setBusy(false);
    }
  };

  const answer = async (choice: TasteAnswer) => {
    if (!pair || busy) return;
    setBusy(true);
    try {
      await learnTastePair(pair.aId, pair.bId, choice);
    } catch {
      // o lecție pierdută nu oprește testul
    }
    setBusy(false);
    if (index + 1 < pairs.length) setIndex(index + 1);
    else await finish();
  };

  if (!open) return null;
  const photoById = (id: string) => photos.find(p => p.id === id);

  return (
    <div className="welcome-screen taste-quiz-screen">
      <div className="welcome-onboarding taste-quiz" ref={containerRef} role="dialog" aria-modal="true"
        aria-label={tr('taste.title')} tabIndex={-1}
        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); close(); } }}
      >
        <button className="ghost icon-btn welcome-onboarding-skip" onClick={close} aria-label={tr('taste.skip')}>
          <XIcon />
        </button>

        {summary === null ? (
          <>
            <p className="taste-quiz-step mono">{tr('taste.step', { n: index + 1, total: pairs.length })}</p>
            <h2>{tr('taste.question.' + pair.kind)}</h2>
            <div className="taste-quiz-pair">
              {(['a', 'b'] as const).map(side => {
                const id = side === 'a' ? pair.aId : pair.bId;
                const p = photoById(id);
                const src = urls[id] ?? p?.lqip;
                return (
                  <button key={id} className="taste-quiz-photo" disabled={busy} onClick={() => void answer(side)}
                    aria-label={tr(side === 'a' ? 'taste.keepLeft' : 'taste.keepRight')}>
                    {src && <img src={src} alt="" />}
                  </button>
                );
              })}
            </div>
            <div className="taste-quiz-more">
              <button className="ghost small" disabled={busy} onClick={() => void answer('both')}>{tr('taste.both')}</button>
              <button className="ghost small" disabled={busy} onClick={() => void answer('none')}>{tr('taste.none')}</button>
            </div>
            <div className="taste-quiz-bar" aria-hidden="true">
              <span style={{ width: `${Math.round((index / pairs.length) * 100)}%` }} />
            </div>
          </>
        ) : (
          <>
            <div className="welcome-onboarding-icon" aria-hidden="true"><SparkleIcon /></div>
            <h2>{tr('taste.done.title')}</h2>
            <p className="welcome-onboarding-body">{tr('taste.done.body')}</p>
            {summary.length > 0 && (
              <ul className="taste-quiz-notes">
                {summary.map(note => <li key={note}>{note}</li>)}
              </ul>
            )}
            <button className="btn-accent" onClick={() => setOpen(false)}>{tr('taste.done.cta')}</button>
          </>
        )}
        {busy && summary === null && index + 1 >= pairs.length && (
          <p className="hint">{tr('taste.learning')}</p>
        )}
      </div>
    </div>
  );
}
