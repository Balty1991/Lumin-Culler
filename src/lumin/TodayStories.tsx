import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useLxPhotos } from './useLxPhotos';
import { useLx } from './lxStore';
import { useTr } from './context';
import { Thumb } from './Thumb';
import { dayLabel } from './format';
import { photoTime } from './days';
import { buildStories, type Story } from './stories';
import { readRitualDays } from '../core/ritualStreak';
import { startOfDay } from '../core/todayDigest';

/**
 * lumin/TodayStories.tsx
 * Azi începe cu poveștile pe tot ecranul: poza ocupă tot, textul stă peste ea, o
 * singură acțiune pe cadru. Atingi dreapta/stânga sau glisezi; trece singur la
 * următorul. Întoarce `null` când nu are din ce face povești (galerie goală).
 */
export function useStories(): Story[] {
  const photos = useLxPhotos();
  // Ritualul de azi dispare după ce l-ai terminat: recitim când se închide sortarea.
  const sorting = useLx(s => !!s.sortIds);
  return useMemo(() => {
    const now = Date.now();
    const done = !sorting && readRitualDays().some(d => startOfDay(d) === startOfDay(now));
    return buildStories(photos, now, done);
  }, [photos, sorting]);
}

const STORY_MS = 7000;

export function TodayStories({ stories, greeting, date, streak }: { stories: Story[]; greeting: string; date: string; streak?: string }) {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const i = Math.min(index, stories.length - 1);
  const story = stories[i];
  // Lista s-a schimbat (o poză nouă, o decizie): rămânem pe un cadru valid.
  useEffect(() => { if (index > stories.length - 1) setIndex(0); }, [index, stories.length]);
  if (!story) return null;

  const go = (d: number) => setIndex(n => Math.max(0, Math.min(stories.length - 1, Math.min(n, stories.length - 1) + d)));
  const ids = story.photos.map(p => p.id);
  const count = story.photos.length;
  const day = dayLabel(photoTime(story.cover), locale);
  const text = {
    today: { badge: tr('lx.ritual60.badge'), title: tr('lx.ritual60.title'), sub: tr('lx.ritual60.sub', { count }), cta: tr('lx.ritual60.cta') },
    memory: { badge: tr(story.years === 1 ? 'lx.onThisDay' : 'lx.onThisDay.other', { years: story.years ?? 1 }), title: day, sub: tr('lx.story.count', { count }), cta: tr('lx.story.see') },
    best: { badge: tr(story.recent ? 'lx.hero.weekBest' : 'lx.hero.fromGallery'), title: day, sub: tr('lx.story.count', { count }), cta: tr('lx.story.see') },
    waiting: { badge: tr('lx.story.waiting.badge'), title: tr('lx.story.waiting.title', { count }), sub: tr('lx.story.waiting.sub'), cta: tr('lx.story.waiting.cta') },
    series: { badge: tr('lx.story.series.badge'), title: tr('lx.story.series.title', { count }), sub: tr('lx.story.series.sub', { sets: story.sets ?? 1 }), cta: tr('lx.story.series.cta') },
    person: { badge: tr('lx.story.person.badge'), title: story.person ?? '', sub: tr('lx.story.count', { count }), cta: tr('lx.story.see') },
    forgotten: { badge: tr('lx.story.forgotten.badge'), title: day, sub: tr('lx.story.forgotten.sub'), cta: tr('lx.story.see') }
  }[story.kind];
  const act = () => {
    if (story.kind === 'today') useLx.getState().openSort(ids, tr('lx.ritual60.title'), true);
    else if (story.kind === 'waiting') useLx.getState().openSort(ids, text.title);
    else if (story.kind === 'series') useLx.getState().openSort(ids, tr('lx.story.series.badge'));
    else useLx.getState().openViewer(ids, 0);
  };

  return (
    <section className="lx-stories" aria-roledescription="carousel" aria-label={tr('lx.story.label')}
      onTouchStart={e => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; setPaused(true); }}
      onTouchEnd={e => {
        setPaused(false);
        const t = touch.current; touch.current = null;
        if (!t) return;
        const dx = e.changedTouches[0].clientX - t.x, dy = e.changedTouches[0].clientY - t.y;
        if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? 1 : -1);
      }}>
      {/* Doar cadrul curent și vecinii lui sunt în pagină: restul nu se decodează degeaba. */}
      {stories.map((s, k) => Math.abs(k - i) <= 1 && (
        <span key={s.id} className={k === i ? 'lx-story-media on' : 'lx-story-media'} aria-hidden="true">
          <Thumb id={s.cover.id} lqip={s.cover.lqip} edits={s.cover.edits} full />
        </span>
      ))}
      <span className="lx-story-shade" aria-hidden="true" />
      <button className="lx-story-tap prev" onClick={() => go(-1)} aria-label={tr('lx.story.prev')} disabled={i === 0} />
      <button className="lx-story-tap next" onClick={() => go(1)} aria-label={tr('lx.story.next')} disabled={i === stories.length - 1} />

      <div className="lx-story-top">
        {stories.length > 1 && (
          <div className="lx-story-bars" aria-hidden="true">
            {stories.map((s, k) => (
              <i key={s.id} className={k < i ? 'done' : k === i ? 'on' : ''}>
                {k === i && <b key={`${s.id}-${i}`} style={{ animationDuration: `${STORY_MS}ms`, animationPlayState: paused ? 'paused' : 'running' }}
                  onAnimationEnd={() => { if (i < stories.length - 1) go(1); }} />}
              </i>
            ))}
          </div>
        )}
        <div className="lx-story-greet">
          <div><b>{greeting}</b><span>{date}</span></div>
          {streak && <span className="lx-story-streak">{streak}</span>}
        </div>
      </div>

      <div className="lx-story-caption" key={story.id}>
        <span className="lx-story-badge">{text.badge}</span>
        <h1>{text.title}</h1>
        <p>{text.sub}</p>
        <button className="lx-story-cta" onClick={act}>{text.cta} <span aria-hidden="true">→</span></button>
      </div>
    </section>
  );
}
