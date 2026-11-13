import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { useTr } from './context';
import { readTasteModel, usableTaste } from '../core/learning/personalTaste';
import { translateSceneTag } from '../core/sceneTagLabels';
import { baseLocale } from '../i18n';

/**
 * lumin/TastePortrait.tsx
 * „Ce am învățat despre tine”: portretul gustului, în cuvinte, din modelul personal (CLIP).
 * Cerut: „arată-mi maximum ce poți scoate din aplicație” — copia ta AI spune ce a înțeles.
 */
export function TastePortrait() {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const [view, setView] = useState<{ likes: string[]; dislikes: string[]; accuracy: number; n: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const m = readTasteModel();
    if (!usableTaste(m)) { setView(null); return; }
    void import('../core/clip/clipEngine').then(({ tasteConcepts }) => {
      if (!alive) return;
      const all = tasteConcepts(m.w);
      const name = (k: string) => translateSceneTag(k, baseLocale(locale));
      const likes = all.filter(x => x.score > 0).slice(0, 5).map(x => name(x.key));
      const dislikes = all.filter(x => x.score < 0).slice(-4).reverse().map(x => name(x.key));
      setView({ likes, dislikes, accuracy: m.accuracy, n: m.n });
    }).catch(() => setView(null));
    return () => { alive = false; };
  }, [locale]);
  if (!view) return null;
  return (
    <section className="lx-card lx-taste">
      <span className="lx-eyebrow">{tr('lx.taste.eyebrow')}</span>
      <b>{tr('lx.taste.title', { percent: Math.round(view.accuracy * 100), count: view.n })}</b>
      {view.likes.length > 0 && <div className="lx-taste-row"><span>{tr('lx.taste.likes')}</span><div className="lx-chips">{view.likes.map(l => <span key={l} className="lx-chip good">{l}</span>)}</div></div>}
      {view.dislikes.length > 0 && <div className="lx-taste-row"><span>{tr('lx.taste.dislikes')}</span><div className="lx-chips">{view.dislikes.map(l => <span key={l} className="lx-chip bad">{l}</span>)}</div></div>}
      <small>{tr('lx.taste.note')}</small>
    </section>
  );
}
