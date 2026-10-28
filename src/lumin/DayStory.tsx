import { translateSceneTag } from '../core/sceneTagLabels';
import type { PhotoView } from '../state/store';
import { useStore } from '../state/store';
import { useTr } from './context';
import { Thumb } from './Thumb';

/**
 * lumin/DayStory.tsx
 * Ziua, povestită de Lumi, în două-trei propoziții: câte poze, ce a păstrat,
 * cine a fost cel mai des în ele și ce s-a întâmplat. Apare seara (sau când
 * ziua e sortată), ca un mic jurnal.
 */
const GENERIC = new Set(['person', 'people', 'face', 'smile', 'fun', 'selfie', 'child', 'baby', 'girl', 'boy', 'man', 'woman', 'skin', 'hair', 'eyelash', 'jacket', 'sleeve', 'clothing']);

export function storyOf(photos: readonly PhotoView[], locale: 'ro' | 'en') {
  const kept = photos.filter(p => p.status === 'selected');
  const people = new Map<string, number>();
  const tags = new Map<string, number>();
  for (const p of photos) {
    for (const n of p.personNames) people.set(n, (people.get(n) ?? 0) + 1);
    for (const t of p.sceneTags ?? []) if (!GENERIC.has(t.toLowerCase())) tags.set(t, (tags.get(t) ?? 0) + 1);
  }
  const top = <K,>(m: Map<K, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
  return {
    total: photos.length,
    kept: kept.length,
    people: top(people, 2),
    things: top(tags, 2).map(t => translateSceneTag(t, locale).toLowerCase()),
    cover: [...kept].sort((a, b) => b.aiScore - a.aiScore)[0] ?? null
  };
}

export function DayStory({ photos }: { photos: readonly PhotoView[] }) {
  const tr = useTr();
  const locale = useStore(s => s.locale) === 'en' ? 'en' : 'ro';
  const evening = new Date().getHours() >= 17;
  const sorted = photos.length > 0 && photos.every(p => p.status === 'selected' || p.status === 'rejected');
  if (photos.length < 3 || (!evening && !sorted)) return null;
  const s = storyOf(photos, locale);
  const and = tr('lx.why.and');
  const lines = [tr('lx.story.day.count', { total: s.total, kept: s.kept })];
  if (s.people.length) lines.push(tr('lx.story.day.people', { names: s.people.join(and) }));
  if (s.things.length) lines.push(tr('lx.story.day.things', { things: s.things.join(and) }));
  return (
    <section className="lx-card lx-daystory">
      {s.cover && <Thumb id={s.cover.id} lqip={s.cover.lqip} edits={s.cover.edits} className="lx-daystory-img" />}
      <div>
        <span className="lx-eyebrow">{tr('lx.story.day.eyebrow')}</span>
        <p>{lines.join(' ')}</p>
      </div>
    </section>
  );
}
