import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { classifyPhoto, looksManufactured } from '../core/smartInbox';
import { buildTastePairs, TASTE_QUIZ_MIN_PHOTOS, TASTE_QUIZ_MIN_ANSWERS, type TasteAnswer, type TastePair } from '../core/tastePairs';
import { EMPTY_SCORE, readTasteScore, scoreAnswer, writeTasteScore, type PairGuess, type TasteScore } from '../core/tasteScore';
import { getDisplayUrl } from '../core/previewUrlCache';
import { contextEngine } from '../core/learning/ContextEngine';
import { readTasteQuizDone, writeTasteQuizDone, TASTE_QUIZ_OPEN_EVENT } from '../state/tasteQuiz';
import { useLx } from '../lumin/lxStore';
import { requestNotificationAccess, isNativeNotificationsAvailable } from '../core/nativeNotifications';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon } from './icons';
import { t, baseLocale } from '../i18n';

/** Cât stă pe ecran dezvăluirea „AI-ul a ghicit / ar fi ales-o pe asta”. */
const REVEAL_MS = 650;
const PAYWALL_SHOWN_KEY = 'lumin-onboarding-paywall';

function paywallShown(): boolean {
  try { return localStorage.getItem(PAYWALL_SHOWN_KEY) === '1'; } catch { return true; }
}
function markPaywallShown(): void {
  try { localStorage.setItem(PAYWALL_SHOWN_KEY, '1'); } catch { /* fără stocare */ }
}

/**
 * ui/TasteQuiz.tsx
 * Antrenamentul AI-ului: două poze din galeria ta, alegi pe care o păstrezi.
 * Înainte de fiecare răspuns AI-ul își face alegerea (în secret), iar după
 * răspuns se vede dacă a ghicit: „AI-ul tău: 7 din 10 · generic: 5 din 10”.
 * E o măsurătoare cinstită — modelul n-a văzut răspunsul — și e momentul în
 * care omul vede că aplicația chiar învață de la el.
 *
 * Fiecare răspuns e o lecție (ContextEngine.recordPreference /
 * recordCorrection); la final biblioteca se reclasifică. Se deschide singur o
 * dată, după primul import, și oricând din „AI-ul tău” (TASTE_QUIZ_OPEN_EVENT).
 * După primul antrenament: oferta de notificare de seară și, o singură dată,
 * abonamentul (se poate închide).
 */
export function TasteQuiz() {
  const photos = useStore(s => s.photos);
  const progress = useStore(s => s.progress);
  const welcomeSeen = useStore(s => s.welcomeSeen);
  const locale = useStore(s => s.locale);
  const premiumLocked = useStore(s => s.premiumLocked);
  const learnTastePair = useStore(s => s.learnTastePair);
  const guessTastePair = useStore(s => s.guessTastePair);
  const rescorePhotos = useStore(s => s.rescorePhotos);
  const setPremiumOpen = useStore(s => s.setPremiumOpen);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  const [open, setOpen] = useState(false);
  const [pairs, setPairs] = useState<TastePair[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [guess, setGuess] = useState<PairGuess | null>(null);
  const [reveal, setReveal] = useState<{ choice: TasteAnswer; guess: PairGuess | null } | null>(null);
  const [score, setScore] = useState<TasteScore>(EMPTY_SCORE);
  const [firstRun, setFirstRun] = useState(false);
  const [notifyAsked, setNotifyAsked] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  const analysing = !!progress && progress.phase !== 'finalizat';
  // Doar amintiri: fără bonuri, documente, capturi (raportat: testul întreba
  // „care bon păstrezi?”). Întâi pozele în care AI-ul a recunoscut ceva.
  const candidates = useMemo(() => {
    const all = photos.map(p => {
      const kind = classifyPhoto({
        id: p.id, fileName: p.fileName, faceCount: p.faceCount,
        textCoverage: p.textCoverage, sceneTags: p.sceneTags
      });
      const notMemory = kind === 'document' || kind === 'screenshot' || kind === 'object';
      return {
        id: p.id, aiScore: p.aiScore, sharpness: p.sharpness, exposure: p.exposure,
        faceCount: p.faceCount, groupId: p.groupId,
        aside: p.aside ?? (notMemory ? 'document' : undefined),
        recognized: p.faceCount > 0 || (!!p.sceneTags?.length && !looksManufactured(p.sceneTags))
      };
    });
    const strict = all.filter(c => c.recognized);
    return buildTastePairs(strict).length >= 6 ? strict : all;
  }, [photos]);

  const start = () => {
    const next = buildTastePairs(candidates);
    if (!next.length) return;
    setFirstRun(!readTasteQuizDone());
    setPairs(next);
    setIndex(0);
    setSummary(null);
    setReveal(null);
    setScore(EMPTY_SCORE);
    setOpen(true);
  };

  // O singură dată, singur: după primul import terminat, cu destule poze. Cât
  // galeria se citește în fundal, așteaptă un lot mai mare (40): după primul
  // pachet de 8 n-ar avea din ce face perechi bune.
  const reading = useLx(s => s.reader);
  useEffect(() => {
    if (open || analysing || !welcomeSeen || readTasteQuizDone()) return;
    if (photos.length < (reading ? 40 : TASTE_QUIZ_MIN_PHOTOS)) return;
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysing, welcomeSeen, photos.length, reading]);

  useEffect(() => {
    const onOpen = () => start();
    window.addEventListener(TASTE_QUIZ_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(TASTE_QUIZ_OPEN_EVENT, onOpen);
  });

  const pair = pairs[index];

  // Alegerea AI-ului pentru perechea curentă, făcută ÎNAINTE de răspuns.
  useEffect(() => {
    if (!open || !pair) return;
    let alive = true;
    setGuess(null);
    void guessTastePair(pair.aId, pair.bId).then(g => { if (alive) setGuess(g); }).catch(() => {});
    return () => { alive = false; };
  }, [open, pair, guessTastePair]);

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

  const finish = async (final: TasteScore) => {
    setBusy(true);
    writeTasteQuizDone();
    // Scorul de antrenament se adună peste cele de dinainte (recalibrările).
    const before = readTasteScore();
    writeTasteScore({
      hits: before.hits + final.hits,
      genericHits: before.genericHits + final.genericHits,
      total: before.total + final.total
    });
    try {
      await rescorePhotos();
      // Mesajul „Re-analizate N poze” acoperea butonul de la final (raportat).
      useStore.getState().clearNotice();
      const models = await contextEngine.summarize(baseLocale(locale));
      setSummary([...new Set(models.flatMap(m => m.notes))].slice(0, 3));
    } catch {
      setSummary([]);
    } finally {
      setBusy(false);
    }
  };

  const answer = async (choice: TasteAnswer) => {
    if (!pair || busy || reveal) return;
    const next = scoreAnswer(score, guess, choice);
    setScore(next);
    setReveal({ choice, guess });
    setBusy(true);
    try {
      await learnTastePair(pair.aId, pair.bId, choice);
    } catch {
      // o lecție pierdută nu oprește antrenamentul
    }
    setBusy(false);
    window.setTimeout(() => {
      setReveal(null);
      if (index + 1 < pairs.length) setIndex(index + 1);
      else void finish(next);
    }, REVEAL_MS);
  };

  const leave = () => {
    setOpen(false);
    // O singură dată, după primul antrenament: abonamentul, cu buton de închidere.
    if (firstRun && premiumLocked && !paywallShown()) {
      markPaywallShown();
      setPremiumOpen(true);
    }
  };

  if (!open || (!pair && summary === null)) return null;
  const photoById = (id: string) => photos.find(p => p.id === id);
  const canStop = index >= TASTE_QUIZ_MIN_ANSWERS && !reveal && !busy;
  const decided = reveal && (reveal.choice === 'a' || reveal.choice === 'b');

  return (
    <div className="v3-screen tq" role="dialog" aria-modal="true" aria-label={tr('taste.title')} ref={containerRef} tabIndex={-1}
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); close(); } }}>
      <div className="v3-screen-inner tq-inner">
        {summary === null ? (
          <>
            <div className="v3-screen-head">
              <span className="v3-kicker">{tr(firstRun ? 'taste.kicker' : 'taste.kickerAgain', { n: index + 1, total: pairs.length })}</span>
              <button className="ghost icon-btn" onClick={close} aria-label={tr('taste.skip')}><XIcon /></button>
            </div>
            <div className="tq-progress" aria-hidden="true">
              <i style={{ width: `${Math.round(((index + (reveal ? 1 : 0)) / pairs.length) * 100)}%` }} />
            </div>
            <div className="tq-score" aria-live="polite">
              <span className="tq-score-dot" />
              <span>{score.total === 0 ? tr('taste.guessing') : tr('taste.live', { hits: score.hits, total: score.total })}</span>
            </div>
            <h2 className="tq-question">{tr('taste.question.' + pair.kind)}</h2>
            <div className="tq-pair" key={index}>
              {(['a', 'b'] as const).map(side => {
                const id = side === 'a' ? pair.aId : pair.bId;
                const p = photoById(id);
                const src = urls[id] ?? p?.lqip;
                const chosen = !!reveal && (reveal.choice === side || reveal.choice === 'both');
                const aiPick = reveal?.guess?.personal === side;
                const cls = ['tq-photo', chosen ? 'chosen' : '', reveal && !chosen ? 'dim' : ''].filter(Boolean).join(' ');
                return (
                  <button key={id} className={cls} disabled={busy || !!reveal} onClick={() => void answer(side)}
                    aria-label={tr(side === 'a' ? 'taste.keepLeft' : 'taste.keepRight')}>
                    {src && <img src={src} alt="" />}
                    {decided && aiPick && (
                      <span className={reveal.choice === side ? 'tq-badge hit' : 'tq-badge miss'}>
                        {reveal.choice === side ? tr('taste.badge.hit') : tr('taste.badge.miss')}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="tq-more">
              <button className="tq-chip" disabled={busy || !!reveal} onClick={() => void answer('both')}>{tr('taste.both')}</button>
              <button className="tq-chip" disabled={busy || !!reveal} onClick={() => void answer('none')}>{tr('taste.none')}</button>
              {canStop && <button className="tq-chip accent" onClick={() => void finish(score)}>{tr('taste.stop')}</button>}
            </div>
            {busy && !reveal && <p className="v3-kicker v3-center">{tr('taste.learning')}</p>}
          </>
        ) : (
          <section className="tq-done">
            <span className="v3-kicker">{tr('taste.done.kicker')}</span>
            <div className="v3-ring" style={{ ['--p' as string]: `${score.total ? Math.round((score.hits / score.total) * 100) : 0}` }}>
              <span>{score.hits}<small>/{score.total}</small></span>
            </div>
            <h2 className="fr-title small v3-center">{tr('taste.done.title')}</h2>
            {score.total > 0 && (
              <div className="tq-compare">
                <div><b className="v3-mono">{score.hits}/{score.total}</b><span>{tr('taste.done.yours')}</span></div>
                <div><b className="v3-mono">{score.genericHits}/{score.total}</b><span>{tr('taste.done.generic')}</span></div>
              </div>
            )}
            <p className="fr-lead v3-center">{tr('taste.done.body')}</p>
            {summary.length > 0 && (
              <ul className="tq-notes">
                {summary.map(note => <li key={note}>{note}</li>)}
              </ul>
            )}
            {firstRun && isNativeNotificationsAvailable() && !notifyAsked && (
              <button className="v3-outline-btn" onClick={() => { setNotifyAsked(true); void requestNotificationAccess().catch(() => {}); }}>
                {tr('taste.done.notify')}
              </button>
            )}
            <button className="v3-cta" onClick={leave}>
              <span>{tr('taste.done.cta')}</span><span className="v3-mono">→</span>
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
