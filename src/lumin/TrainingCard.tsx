import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { useLx } from './lxStore';
import { useTr } from './context';
import { useLxPhotos } from './useLxPhotos';
import { MIN_LESSONS, countLessons, redecideIfJustTrained, trainingSample } from './trainingGate';

/**
 * lumin/TrainingCard.tsx
 * Pe Azi, cât AI-ul n-a primit destule exemple pentru o galerie mare:
 * „Ca să sortez singur 1.498 de poze, am nevoie de 30 de alegeri (ai 4)”,
 * cu antrenamentul la un buton. La prag, deciziile se refac pe toată biblioteca.
 */
export function TrainingCard() {
  const tr = useTr();
  const photos = useLxPhotos();
  const setNotice = useStore(s => s.setNotice);
  const openSort = useLx(s => s.openSort);
  const sorting = useLx(s => s.sortIds !== null);
  const [lessons, setLessons] = useState<number | null>(null);

  // Recitit după fiecare sortare închisă: poate tocmai s-a atins pragul.
  useEffect(() => {
    if (sorting) return;
    let alive = true;
    void countLessons().then(async n => {
      if (!alive) return;
      setLessons(n);
      if (n >= MIN_LESSONS && await redecideIfJustTrained()) setNotice(tr('lx.train.done'));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorting]);

  if (lessons === null || lessons >= MIN_LESSONS || photos.length < 50) return null;
  const left = MIN_LESSONS - lessons;
  return (
    <section className="lx-card lx-train" role="status">
      <span className="lx-eyebrow">{tr('lx.train.eyebrow')}</span>
      <b>{tr('lx.train.title', { total: photos.length, need: MIN_LESSONS })}</b>
      <span>{tr('lx.train.sub', { done: lessons, left })}</span>
      <div className="lx-progress small"><i style={{ width: `${Math.round((lessons / MIN_LESSONS) * 100)}%` }} /></div>
      <button className="lx-btn primary" onClick={() => openSort(trainingSample(photos, Math.min(20, Math.max(10, left))), tr('lx.train.sortTitle'))}>
        {tr('lx.train.go')}
      </button>
    </section>
  );
}
