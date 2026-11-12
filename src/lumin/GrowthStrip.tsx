/**
 * lumin/GrowthStrip.tsx
 * Banda „Cum a crescut” din albumul unei persoane: o poză pe an (vezi growth.ts),
 * vizibilă direct, fără să deschizi nimic. Atingerea deschide pozele, în ordine.
 */
import { useMemo } from 'react';
import type { PhotoView } from '../state/store';
import { useTr } from './context';
import { useLx } from './lxStore';
import { Thumb } from './Thumb';
import { readBirthdays } from './birthdays';
import { growthTimeline } from './growth';

export function GrowthStrip({ name, list }: { name: string; list: PhotoView[] }) {
  const tr = useTr();
  const steps = useMemo(() => growthTimeline(list, readBirthdays()[name]), [list, name]);
  if (!steps.length) return null;
  const ids = steps.map(s => s.photo.id);
  return (
    <section className="lx-growth-strip" aria-label={tr('lx.growthStrip.title', { name })}>
      <h3 className="lx-wall-head"><span>{tr('lx.growthStrip.title', { name })}</span></h3>
      <div className="lx-growth-row">
        {steps.map((s, i) => (
          <button key={s.key} className="lx-growth-card" onClick={() => useLx.getState().openViewer(ids, i)}>
            <span className="lx-growth-img"><Thumb id={s.photo.id} lqip={s.photo.lqip} edits={s.photo.edits} /></span>
            <b>{'years' in s.label
              ? (s.label.years === 0 ? tr('lx.growthStrip.baby') : s.label.years === 1 ? tr('lx.growthStrip.year1') : tr('lx.growthStrip.years', { count: s.label.years }))
              : String(s.label.year)}</b>
          </button>
        ))}
      </div>
    </section>
  );
}
