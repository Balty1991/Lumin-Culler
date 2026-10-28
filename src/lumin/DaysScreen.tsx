import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { groupDays, type Day } from './days';
import { usePeopleFaces } from './faces';
import { buildCoverage, useGalleryMonths } from './coverage';
import { dayLabel, daySummary, monthLabel } from './format';
import { useLx, type GalleryView } from './lxStore';
import { useLxActions, useTr } from './context';
import { Thumb } from './Thumb';
import { PeopleGrid } from './People';
import { CleanupCard } from './Cleanup';
import { GalleryWall } from './GalleryWall';
import { canMakePhoneAlbums, copyToPhoneAlbum } from './phoneAlbums';
import { MomentsView } from './MomentsView';
import type { PhotoView } from '../state/store';

const VIEWS: GalleryView[] = ['wall', 'moments', 'days', 'months', 'people', 'aside'];

/**
 * lumin/DaysScreen.tsx
 * „Galerie”: pozele tale văzute în patru feluri — pe zile (ce a ales AI-ul în
 * fiecare), pe luni (cât din galeria telefonului e sortat și ce nu — raportat:
 * „nu știi ce ai sortat și ce nu”), pe oameni (cu fața lor, și cei fără nume)
 * și ce a pus AI-ul deoparte (bonuri, capturi, documente).
 */
export function DaysScreen() {
  const photos = useStore(s => s.photos);
  const persons = useStore(s => s.persons);
  const openDay = useLx(s => s.openDay);
  const setOpenDay = useLx(s => s.setOpenDay);
  const openSort = useLx(s => s.openSort);
  const view = useLx(s => s.galleryView);
  const setView = useLx(s => s.setGalleryView);
  const tr = useTr();
  const { pick } = useLxActions();
  const [person, setPerson] = useState<string | null>(null);
  const days = useMemo(() => groupDays(photos), [photos]);
  const { people } = usePeopleFaces(persons, 0);
  const aside = useMemo(() => photos.filter(p => !!p.aside), [photos]);
  const day = openDay !== null ? days.find(d => d.start === openDay) : undefined;

  if (day) return <DayView day={day} onBack={() => setOpenDay(null)} />;

  if (person) {
    const face = people.find(p => p.name === person);
    const ids = new Set(face?.photoIds ?? []);
    const list = photos.filter(p => ids.has(p.id) || p.personNames.includes(person));
    return (
      <div className="lx-screen">
        <header className="lx-head">
          <button className="lx-icon-btn" onClick={() => setPerson(null)} aria-label={tr('lx.back')}>‹</button>
          <h1 className="lx-title small">{person}</h1>
          <span />
        </header>
        <PhotoGrid list={list} title={person} />
      </div>
    );
  }

  return (
    <div className="lx-screen">
      <header className="lx-head">
        <h1 className="lx-title">{tr('lx.days.title')}</h1>
        <button className="lx-btn ghost small" onClick={pick}>{tr('lx.addPhotos')}</button>
      </header>

      <div className="lx-seg scroll" role="tablist">
        {VIEWS.map(v => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
            {tr(`lx.days.view.${v}`)}
          </button>
        ))}
      </div>

      {view === 'wall' && <GalleryWall />}
      {view === 'moments' && <MomentsView />}

      {view === 'days' && (days.length === 0 ? (
        <p className="lx-empty">{tr('lx.days.empty')}</p>
      ) : (
        <div className="lx-days">
          <DayCards days={days} />
        </div>
      ))}

      {view === 'months' && <MonthsView days={days} />}

      {view === 'people' && <PeopleGrid onOpen={setPerson} />}

      {view === 'aside' && (aside.length === 0 ? (
        <p className="lx-empty">{tr('lx.days.asideEmpty')}</p>
      ) : (
        <>
          <p className="lx-hint">{tr('lx.days.asideHint')}</p>
          <PhotoGrid list={aside} title={tr('lx.day.aside')} />
          <button className="lx-btn ghost wide" onClick={() => openSort(aside.map(p => p.id), tr('lx.day.aside'))}>{tr('lx.days.asideReview')}</button>
        </>
      ))}
    </div>
  );
}

/** Luni: cât din galeria telefonului a văzut și a sortat AI-ul, cu „Sortează luna” unde lipsește. */
function MonthsView({ days }: { days: Day<PhotoView>[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);
  const progress = useStore(s => s.progress);
  const importGalleryPeriod = useStore(s => s.importGalleryPeriod);
  const openSort = useLx(s => s.openSort);
  const tr = useTr();
  const busy = !!progress && progress.phase !== 'finalizat';
  const counts = useGalleryMonths(busy ? -1 : photos.length);
  const rows = useMemo(() => buildCoverage(counts ?? new Map(), photos), [counts, photos]);
  const totals = rows.reduce((a, r) => ({ gallery: a.gallery + r.inGallery, seen: a.seen + r.seen, waiting: a.waiting + r.waiting }), { gallery: 0, seen: 0, waiting: 0 });
  const percent = totals.gallery ? Math.round(((totals.seen - totals.waiting) / totals.gallery) * 100) : 0;

  if (counts === null) return <p className="lx-empty">{tr('lx.months.loading')}</p>;

  const openRow = open !== null ? rows.find(r => r.start === open) : undefined;
  if (openRow) {
    const monthDays = days.filter(d => d.start >= openRow.start && d.start < openRow.end);
    const kept = monthDays.flatMap(d => d.kept);
    const missing = Math.max(0, openRow.inGallery - openRow.seen);
    return (
      <>
        <div className="lx-head">
          <button className="lx-icon-btn" onClick={() => setOpen(null)} aria-label={tr('lx.back')}>‹</button>
          <h2 className="lx-title small">{monthLabel(openRow.start, locale)}</h2>
          <span />
        </div>
        <section className="lx-stats">
          <div><b>{openRow.inGallery}</b><span>{tr('lx.months.inGallery')}</span></div>
          <div><b className="ok">{kept.length}</b><span>{tr('lx.stat.kept')}</span></div>
          <div><b>{missing}</b><span>{tr('lx.months.untouched')}</span></div>
        </section>
        {missing > 0 && (
          <button className="lx-btn primary wide" disabled={busy} onClick={() => void importGalleryPeriod({ start: openRow.start, end: openRow.end })}>
            {tr('lx.months.sortMissing', { count: missing })}
          </button>
        )}
        {kept.length > 0 && (
          <section className="lx-section">
            <div className="lx-section-head"><h2>{tr('lx.months.best')}</h2></div>
            <PhotoGrid list={kept} title={monthLabel(openRow.start, locale)} />
          </section>
        )}
        {monthDays.length > 0 ? (
          <section className="lx-section">
            <div className="lx-section-head"><h2>{tr('lx.months.days')}</h2></div>
            <DayCards days={monthDays} />
          </section>
        ) : (
          <p className="lx-empty small">{tr('lx.months.noneSeen')}</p>
        )}
      </>
    );
  }

  return (
    <>
      <section className="lx-card lx-coverage">
        <div>
          <b>{tr('lx.months.summary', { percent })}</b>
          <span>{tr('lx.months.summarySub', { sorted: totals.seen - totals.waiting, total: totals.gallery, unsorted: Math.max(0, totals.gallery - totals.seen + totals.waiting) })}</span>
          <div className="lx-progress"><i style={{ width: `${percent}%` }} /></div>
        </div>
      </section>
      <div className="lx-months">
        {rows.map(r => {
          const missing = Math.max(0, r.inGallery - r.seen);
          const state = missing === 0 && r.waiting === 0 ? 'done' : r.seen === 0 ? 'none' : 'partial';
          const ratio = r.inGallery ? Math.round(((r.seen - r.waiting) / r.inGallery) * 100) : 100;
          return (
            <div key={r.start} className={`lx-month ${state}`} role="button" tabIndex={0}
              onClick={() => setOpen(r.start)} onKeyDown={e => { if (e.key === 'Enter') setOpen(r.start); }}>
              <div className="lx-month-text">
                <b>{monthLabel(r.start, locale)}</b>
                <span>{tr(`lx.months.state.${state}`, { seen: r.seen, total: r.inGallery, missing, waiting: r.waiting })}</span>
                <div className="lx-progress small"><i style={{ width: `${ratio}%` }} /></div>
              </div>
              {missing > 0 ? (
                <button className="lx-btn small primary" disabled={busy} onClick={e => { e.stopPropagation(); void importGalleryPeriod({ start: r.start, end: r.end }); }}>
                  {tr('lx.months.sort')}
                </button>
              ) : r.waiting > 0 ? (
                <button className="lx-btn small ghost" onClick={e => {
                  e.stopPropagation();
                  const ids = photos.filter(p => !p.aside && (p.status === 'review' || p.status === 'pending' || p.status === 'candidate')
                    && (p.capturedAt ?? p.importedAt) >= r.start && (p.capturedAt ?? p.importedAt) < r.end).map(p => p.id);
                  openSort(ids, monthLabel(r.start, locale));
                }}>{tr('lx.today.check')}</button>
              ) : (
                <span className="lx-pill ok">✓</span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function PhotoGrid({ list, title }: { list: PhotoView[]; title: string }) {
  const openSort = useLx(s => s.openSort);
  return (
    <div className="lx-grid">
      {list.map(p => (
        <button key={p.id} className={`lx-grid-cell ${p.status}`} onClick={() => openSort(list.map(x => x.id), title)}>
          <Thumb id={p.id} lqip={p.lqip} />
          <span className="lx-grid-score">{p.aiScore}</span>
        </button>
      ))}
    </div>
  );
}

function DayView({ day, onBack }: { day: Day<PhotoView>; onBack: () => void }) {
  const locale = useStore(s => s.locale);
  const exportSelection = useStore(s => s.exportSelection);
  const openSort = useLx(s => s.openSort);
  const tr = useTr();
  const label = dayLabel(day.start, locale);

  return (
    <div className="lx-screen">
      <header className="lx-head">
        <button className="lx-icon-btn" onClick={onBack} aria-label={tr('lx.back')}>‹</button>
        <h1 className="lx-title small">{label}</h1>
        <span />
      </header>

      <section className="lx-stats">
        <div><b>{day.photos.length - day.aside.length}</b><span>{tr('lx.stat.total')}</span></div>
        <div><b className="ok">{day.kept.length}</b><span>{tr('lx.stat.kept')}</span></div>
        <div><b>{day.series.length}</b><span>{tr('lx.stat.series')}</span></div>
      </section>

      {day.waiting.length > 0 && (
        <section className="lx-card lx-decide">
          <div>
            <b>{tr('lx.day.waiting', { count: day.waiting.length })}</b>
            <span>{tr('lx.day.waitingSub')}</span>
          </div>
          <div className="lx-decide-actions">
            <button className="lx-btn primary" onClick={() => openSort(day.waiting.map(p => p.id), label)}>{tr('lx.today.check')}</button>
          </div>
        </section>
      )}

      {day.kept.length > 0 && (
        <section className="lx-section">
          <div className="lx-section-head">
            <h2>{tr('lx.day.kept')}</h2>
            <span className="lx-links">
              {canMakePhoneAlbums() && <button className="lx-link" onClick={() => void copyToPhoneAlbum(label, day.kept)}>{tr('lx.phone.toAlbum')}</button>}
              <button className="lx-link" onClick={() => void exportSelection('apps', day.kept.map(p => p.id))}>{tr('lx.day.share', { count: day.kept.length })}</button>
            </span>
          </div>
          <PhotoGrid list={day.kept} title={tr('lx.day.kept')} />
        </section>
      )}

      {day.series.length > 0 && (
        <section className="lx-section">
          <div className="lx-section-head"><h2>{tr('lx.day.seriesTitle')}</h2></div>
          <div className="lx-series-list">
            {day.series.map(s => (
              <button key={s.id} className="lx-series" onClick={() => openSort(s.photos.map(p => p.id), tr('lx.day.seriesOne', { count: s.photos.length }))}>
                {s.photos.slice(0, 6).map(p => (
                  <span key={p.id} className={p.id === s.best.id ? 'lx-series-frame best' : `lx-series-frame${p.status === 'rejected' ? ' out' : ''}`}>
                    <Thumb id={p.id} lqip={p.lqip} />
                    {p.id === s.best.id && <b>★</b>}
                  </span>
                ))}
                {s.photos.length > 6 && <span className="lx-series-more">+{s.photos.length - 6}</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      {day.rejected.length > 0 && (
        <section className="lx-section">
          <div className="lx-section-head"><h2>{tr('lx.day.notToday')}</h2></div>
          <PhotoGrid list={day.rejected} title={tr('lx.day.notToday')} />
          <CleanupCard photos={day.rejected} />
        </section>
      )}

      {day.aside.length > 0 && (
        <section className="lx-section">
          <div className="lx-section-head"><h2>{tr('lx.day.aside')}</h2></div>
          <PhotoGrid list={day.aside} title={tr('lx.day.aside')} />
        </section>
      )}
    </div>
  );
}

function DayCards({ days }: { days: Day<PhotoView>[] }) {
  const locale = useStore(s => s.locale);
  const setOpenDay = useLx(s => s.setOpenDay);
  const tr = useTr();
  return (
    <div className="lx-days">
      {days.map((d, i) => (
        <button key={d.start} className="lx-daycard" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }} onClick={() => setOpenDay(d.start)}>
          <div className={`lx-mosaic n${Math.min(3, Math.max(1, (d.kept.length || d.photos.length)))}`} aria-hidden="true">
            {(d.kept.length ? d.kept : d.photos).slice(0, 3).map(p => <Thumb key={p.id} id={p.id} lqip={p.lqip} />)}
          </div>
          <div className="lx-daycard-text">
            <b>{dayLabel(d.start, locale)}</b>
            <span>{daySummary(d, tr)}</span>
          </div>
          {d.waiting.length > 0 ? <span className="lx-pill warm">{d.waiting.length}</span> : <span className="lx-pill ok">✓</span>}
        </button>
      ))}
    </div>
  );
}
