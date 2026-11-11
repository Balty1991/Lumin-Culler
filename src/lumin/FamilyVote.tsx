import { usePacedPhotos } from './useLxPhotos';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { useTr } from './context';
import { Thumb } from './Thumb';
import { Icon } from './icons';

/**
 * lumin/FamilyVote.tsx
 * „Votul familiei”: telefonul trece din mână în mână; fiecare atinge poza
 * preferată din serie, fără să vadă ce au ales ceilalți. La final, câștigătoarea
 * apare cu animație și rămâne păstrată. Fără cont, fără internet.
 */
type Step = { kind: 'setup' } | { kind: 'vote'; voter: number } | { kind: 'pass'; next: number } | { kind: 'result' };

export function FamilyVote({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const tr = useTr();
  const photos = usePacedPhotos();
  const setStatus = useStore(s => s.setStatus);
  const list = ids.map(id => photos.find(p => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p).slice(0, 6);
  const [voters, setVoters] = useState(3);
  const [step, setStep] = useState<Step>({ kind: 'setup' });
  const [votes, setVotes] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);

  const vote = (id: string) => {
    if (step.kind !== 'vote') return;
    const next = [...votes, id];
    setVotes(next);
    try { navigator.vibrate?.(12); } catch { /* fără */ }
    setStep(step.voter + 1 >= voters ? { kind: 'result' } : { kind: 'pass', next: step.voter + 1 });
  };
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  const ranked = [...list].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
  const top = counts.get(ranked[0]?.id) ?? 0;
  const winners = ranked.filter(p => (counts.get(p.id) ?? 0) === top);
  const keep = async (others: boolean) => {
    for (const w of winners) await setStatus(w.id, 'selected');
    if (others) for (const p of list) if (!winners.includes(p)) await setStatus(p.id, 'rejected');
    setApplied(true);
    useStore.getState().setNotice(tr('lx.vote.kept'));
  };

  return createPortal(
    <div className="lx lx-enhance lx-vote" role="dialog" aria-modal="true" aria-label={tr('lx.vote.title')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.vote.title')}</span>
        <span />
      </header>
      {step.kind === 'setup' && (
        <div className="lx-vote-center">
          <span className="lx-duel-vs big"><Icon name="check" size={40} /></span>
          <b>{tr('lx.vote.howMany')}</b>
          <div className="lx-enhance-styles" role="radiogroup">
            {[2, 3, 4, 5, 6].map(n => <button key={n} role="radio" aria-checked={voters === n} className={voters === n ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setVoters(n)}>{n}</button>)}
          </div>
          <p>{tr('lx.vote.explain', { count: list.length })}</p>
          <button className="lx-btn primary" onClick={() => setStep({ kind: 'vote', voter: 0 })}>{tr('lx.vote.start')}</button>
        </div>
      )}
      {step.kind === 'pass' && (
        <div className="lx-vote-center">
          <span className="lx-duel-vs big">{step.next + 1}</span>
          <b>{tr('lx.vote.pass', { n: step.next + 1 })}</b>
          <p>{tr('lx.vote.secret')}</p>
          <button className="lx-btn primary" onClick={() => setStep({ kind: 'vote', voter: step.next })}>{tr('lx.vote.ready')}</button>
        </div>
      )}
      {step.kind === 'vote' && (
        <>
          <p className="lx-hint center">{tr('lx.vote.turn', { n: step.voter + 1, total: voters })}</p>
          <div className="lx-vote-grid">
            {list.map(p => (
              <button key={p.id} className="lx-duel-photo" onClick={() => vote(p.id)}>
                <Thumb id={p.id} lqip={p.lqip} edits={p.edits} full />
              </button>
            ))}
          </div>
        </>
      )}
      {step.kind === 'result' && (
        <div className="lx-vote-result">
          <b className="lx-vote-crown">{winners.length > 1 ? tr('lx.vote.tie') : tr('lx.vote.winner')}</b>
          <div className="lx-vote-grid">
            {ranked.map((p, i) => {
              const c = counts.get(p.id) ?? 0;
              return (
                <div key={p.id} className={winners.includes(p) ? 'lx-duel-photo win lx-vote-res' : 'lx-duel-photo lose lx-vote-res'} style={{ animationDelay: `${i * 160}ms` }}>
                  <Thumb id={p.id} lqip={p.lqip} edits={p.edits} full />
                  <span className="lx-duel-flash">{tr('lx.vote.votes', { count: c })}</span>
                </div>
              );
            })}
          </div>
          <div className="lx-decide-actions">
            {applied ? <button className="lx-btn primary" onClick={onClose}>{tr('lx.duel.done')}</button> : (
              <>
                <button className="lx-btn ghost" onClick={() => void keep(false)}>{tr('lx.vote.keepWinner')}</button>
                <button className="lx-btn primary" onClick={() => void keep(true)}>{tr('lx.vote.keepOnly')}</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
