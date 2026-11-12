import { useStore } from '../state/store';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLxPhotos } from './useLxPhotos';
import { useLx } from './lxStore';
import { useLxActions, useTr } from './context';
import { Orb } from './Orb';
import { Thumb } from './Thumb';
import { Icon } from './icons';
import { answer, type AssistantReply } from './assistantBrain';
import { openTasteQuiz } from '../state/tasteQuiz';
import { clipSearch } from '../core/clip/clipSearch';
import { applyFilters } from './assistantQuery';

/**
 * lumin/Assistant.tsx
 * „Întreabă-ți galeria”: butonul din mijlocul barei deschide o conversație cu
 * AI-ul tău. Scrii ce cauți sau ce vrei să faci; răspunde cu poze și cu un buton
 * care face treaba. Totul pe telefon (vezi assistantBrain.ts).
 */
type Msg = { id: number; me: string } | { id: number; reply: AssistantReply };

export function Assistant({ onClose }: { onClose: () => void }) {
  const tr = useTr();
  const photos = useLxPhotos();
  const actions = useLxActions();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const next = useRef(1);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Sugestii din galeria omului: un nume cunoscut, nu exemple inventate.
  const ideas = useMemo(() => {
    const names = new Map<string, number>();
    for (const p of photos) for (const n of p.personNames ?? []) names.set(n, (names.get(n) ?? 0) + 1);
    const top = [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return [
      top ? tr('lx.ask.idea.person', { name: top }) : tr('lx.ask.idea.best'),
      tr('lx.ask.idea.clean'), tr('lx.ask.idea.waiting'), tr('lx.ask.idea.stats'), tr('lx.ask.idea.film'), tr('lx.ask.idea.add')
    ];
  }, [photos, tr]);

  const ask = (q: string) => {
    const clean = q.trim();
    if (!clean) return;
    const a = next.current++, b = next.current++;
    const reply = answer(clean, photos);
    setMsgs(m => [...m, { id: a, me: clean }, { id: b, reply }]);
    setText('');
    // Doar când cuvintele n-au găsit nimic, caută după ce se vede în poze (motorul vizual, tot
    // pe telefon). Completarea rezultatelor existente amesteca subiectele (raportat cu captură:
    // la „pisici” apăreau câini, capturi de ecran și o fetiță).
    if (reply.kind === 'none') {
      // Căutarea CLIP primește doar subiectul („geacă roșie”), fără „ieri”, „păstrate” etc.;
      // timpul și filtrele se aplică apoi pe rezultat.
      const subject = reply.filters?.rest.trim() || clean;
      const showPartial = () => {
        if (reply.partial?.length) setMsgs(m => m.map(x => x.id === b ? { id: b, reply: { kind: 'results', query: clean, photos: reply.partial!, best: false, approx: true } } : x));
      };
      void clipSearch(subject).then(ids => {
        const byId = new Map(photos.map(p => [p.id, p]));
        let found = ids.map(id => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p && !p.aside);
        if (reply.filters) found = applyFilters(found, reply.filters);
        found = found.slice(0, reply.filters?.limit ?? 30);
        if (found.length) setMsgs(m => m.map(x => x.id === b ? { id: b, reply: { kind: 'results', query: clean, photos: found, best: false } } : x));
        else showPartial();
      }).catch(showPartial);
    }
  };
  const lx = useLx.getState;
  const view = (ids: string[], i = 0) => { onClose(); lx().openViewer(ids, i); };
  const sort = (ids: string[], title: string) => { onClose(); lx().openSort(ids, title); };

  const renderReply = (r: AssistantReply) => {
    switch (r.kind) {
      case 'results': {
        const ids = r.photos.map(p => p.id);
        return (
          <>
            <p>{tr(r.approx ? 'lx.ask.foundApprox' : r.best ? 'lx.ask.foundBest' : 'lx.ask.found', { count: r.photos.length, query: r.query })}</p>
            <div className="lx-ask-grid">
              {r.photos.slice(0, 9).map((p, i) => (
                <button key={p.id} onClick={() => view(ids, i)}><Thumb id={p.id} lqip={p.lqip} edits={p.edits} /></button>
              ))}
            </div>
            {r.photos.length > 9 && <button className="lx-btn ghost small" onClick={() => view(ids)}>{tr('lx.ask.seeAll', { count: r.photos.length })}</button>}
          </>
        );
      }
      case 'none': return <p>{tr('lx.ask.none', { query: r.query })}</p>;
      case 'stats': return <p>{[tr('lx.ask.stats', { total: r.total, kept: r.kept, waiting: r.waiting }), r.extras > 0 && tr('lx.ask.statsExtras', { count: r.extras }), r.people > 0 && tr('lx.ask.statsPeople', { count: r.people })].filter(Boolean).join(' ')}</p>;
      case 'cleanup': return r.photos.length ? (
        <>
          <p>{tr('lx.ask.cleanup', { count: r.photos.length, sets: r.sets })}</p>
          <div className="lx-ask-grid">{r.photos.slice(0, 6).map(p => <span key={p.id}><Thumb id={p.id} lqip={p.lqip} edits={p.edits} /></span>)}</div>
          <button className="lx-btn primary small" onClick={() => sort(r.photos.map(p => p.id), tr('lx.story.series.badge'))}>{tr('lx.story.series.cta')}</button>
        </>
      ) : <p>{tr('lx.ask.cleanupNone')}</p>;
      case 'waiting': return r.photos.length ? (
        <>
          <p>{tr('lx.story.waiting.title', { count: r.photos.length })}. {tr('lx.story.waiting.sub')}</p>
          <button className="lx-btn primary small" onClick={() => sort(r.photos.map(p => p.id), tr('lx.story.waiting.badge'))}>{tr('lx.story.waiting.cta')}</button>
        </>
      ) : <p>{tr('lx.ask.waitingNone')}</p>;
      case 'train': return (<><p>{tr('lx.ask.train')}</p><button className="lx-btn primary small" onClick={() => { onClose(); openTasteQuiz(); }}>{tr('lx.brain.train')}</button></>);
      case 'studio': return (<><p>{tr('lx.ask.studio')}</p><button className="lx-btn primary small" onClick={() => { onClose(); lx().setTab('brain'); }}>{tr('lx.ask.openStudio')}</button></>);
      case 'year': return (<><p>{tr('lx.ask.year')}</p><button className="lx-btn primary small" onClick={() => { void import('./yearShare').then(m => m.shareYear(photos, r.year)).then(ok => { if (!ok) useStore.getState().setNotice(tr('lx.ask.yearNone')); }); }}>{tr('lx.year.cta')}</button></>);
      case 'add': return (<><p>{tr('lx.ask.add')}</p><button className="lx-btn primary small" onClick={() => { onClose(); actions.pick(); }}>{tr('lx.addPhotos')}</button></>);
    }
  };

  return createPortal(
    <div className="lx lx-ask" role="dialog" aria-modal="true" aria-label={tr('lx.ask.title')}>
      <header className="lx-ask-head">
        <Orb mood="idle" size={34} />
        <div><b>{tr('lx.ask.title')}</b><span>{tr('lx.ask.private')}</span></div>
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
      </header>
      <div className="lx-ask-body">
        <div className="lx-ask-msg ai"><p>{tr('lx.ask.hello', { count: photos.length })}</p></div>
        {msgs.map(m => 'me' in m
          ? <div key={m.id} className="lx-ask-msg me"><p>{m.me}</p></div>
          : <div key={m.id} className="lx-ask-msg ai">{renderReply(m.reply)}</div>)}
        <div ref={end} />
      </div>
      <div className="lx-ask-ideas">
        {ideas.map(i => <button key={i} className="lx-chip-btn" onClick={() => ask(i)}>{i}</button>)}
      </div>
      <form className="lx-ask-input" onSubmit={e => { e.preventDefault(); ask(text); }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder={tr('lx.ask.placeholder')} aria-label={tr('lx.ask.placeholder')} enterKeyHint="send" />
        <button type="submit" disabled={!text.trim()} aria-label={tr('lx.ask.send')}><Icon name="share" size={20} /></button>
      </form>
    </div>,
    document.body
  );
}
