import { Capacitor } from '@capacitor/core';
import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { groupDays, type Day } from './days';
import { usePeopleFaces } from './faces';
import { buildCoverage, useGalleryMonths } from './coverage';
import { capitalizeFirst, dayLabel, daySummary, monthLabel } from './format';
import { formatBirthday, parseBirthday, readBirthdays, writeBirthday, type Birthday } from './birthdays';
import { useLx, type GalleryView } from './lxStore';
import { useLxActions, useTr } from './context';
import { Thumb } from './Thumb';
import { StoryButton } from './Story';
import { enhanceAll } from './Enhance';
import { learnFromShare } from './signals';
import { PeopleGrid } from './People';
import { CleanupCard } from './Cleanup';
import { GalleryWall } from './GalleryWall';
import { canMakePhoneAlbums, copyToPhoneAlbum } from './phoneAlbums';
import { MomentsView } from './MomentsView';
import { AsideView } from './AsideView';
import { decideRestIfAllowed } from './autoSort';
import { readWholeGallery } from './galleryReader';
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
  const view = useLx(s => s.galleryView);
  const setView = useLx(s => s.setGalleryView);
  const tr = useTr();
  const { pick } = useLxActions();
  const [person, setPerson] = useState<string | null>(null);
  const days = useMemo(() => groupDays(photos), [photos]);
  const faceVersion = useLx(s => s.faceVersion);
  const { people } = usePeopleFaces(persons, faceVersion);
  const aside = useMemo(() => photos.filter(p => !!p.aside), [photos]);
  const day = openDay !== null ? days.find(d => d.start === openDay) : undefined;

  if (day) return <DayView day={day} onBack={() => setOpenDay(null)} />;

  if (person) {
    const face = people.find(p => p.name === person);
    const ids = new Set(face?.photoIds ?? []);
    const list = photos.filter(p => ids.has(p.id) || p.personNames.includes(person));
    return <PersonView name={person} list={list} onBack={() => setPerson(null)} onRenamed={setPerson} />;
  }

  return (
    <div className="lx-screen">
      <header className="lx-head">
        <h1 className="lx-title">{tr('lx.days.title')}</h1>
        <div className="lx-head-actions">
          <button className="lx-btn ghost small" onClick={pick}>{tr('lx.addPhotos')}</button>
          {Capacitor.isNativePlatform() && <SortAllButton small />}
        </div>
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
        <AsideView aside={aside} />
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
          <button className="lx-btn primary wide" disabled={busy} onClick={() => void importGalleryPeriod({ start: openRow.start, end: openRow.end }).then(() => decideRestIfAllowed())}>
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
        {totals.gallery > totals.seen && <SortAllButton count={totals.gallery - totals.seen} />}
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
                <button className="lx-btn small primary" disabled={busy} onClick={e => { e.stopPropagation(); void importGalleryPeriod({ start: r.start, end: r.end }).then(() => decideRestIfAllowed()); }}>
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

/**
 * Pozele unui om. „Corectează”: atingi pozele în care AI-ul a greșit omul,
 * apoi „Nu e …” (numele pleacă de pe fața aceea și nu mai revine singur) sau
 * „E altcineva…” (fața primește numele corect).
 */
/** „🎂 Ziua lui”: ținută minte, ca Cherrypic să propună colajul cu câteva zile înainte. */
function BirthdayRow({ name }: { name: string }) {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const askPrompt = useStore(s => s.askPrompt);
  const setNotice = useStore(s => s.setNotice);
  const [b, setB] = useState<Birthday | undefined>(() => readBirthdays()[name]);
  const edit = async () => {
    const raw = await askPrompt(tr('lx.birthday.ask', { name }), b ? `${b.day}.${b.month}${b.year ? `.${b.year}` : ''}` : '', { confirmLabel: tr('lx.save') });
    if (raw === null) return;
    if (!raw.trim()) { writeBirthday(name, null); setB(undefined); return; }
    const parsed = parseBirthday(raw);
    if (!parsed) { setNotice(tr('lx.birthday.invalid')); return; }
    writeBirthday(name, parsed);
    setB(parsed);
  };
  return (
    <button className="lx-row button" onClick={() => void edit()}>
      <span><b>🎂 {b ? tr('lx.birthday.is', { name, date: formatBirthday(b, locale) }) : tr('lx.birthday.add', { name })}</b>
        <small>{tr('lx.birthday.sub')}</small></span>
      <span className="lx-chev" aria-hidden="true">›</span>
    </button>
  );
}

function PersonView({ name, list, onBack, onRenamed }: { name: string; list: PhotoView[]; onBack: () => void; onRenamed: (n: string | null) => void }) {
  const tr = useTr();
  const correctPersonFaces = useStore(s => s.correctPersonFaces);
  const askPrompt = useStore(s => s.askPrompt);
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const apply = async (other?: boolean) => {
    const newName = other ? (await askPrompt(tr('lx.people.whoInstead'), '', { confirmLabel: tr('lx.save') }))?.trim() : undefined;
    if (other && !newName) return;
    setBusy(true);
    try {
      await correctPersonFaces(name, [...picked], newName);
      useLx.getState().bumpFaces();
      setPicked(new Set());
      setEditing(false);
      if (picked.size >= list.length) onRenamed(null);
    } finally { setBusy(false); }
  };
  return (
    <div className="lx-screen">
      <header className="lx-head">
        <button className="lx-icon-btn" onClick={onBack} aria-label={tr('lx.back')}>‹</button>
        <h1 className="lx-title small">{name}</h1>
        <button className={editing ? 'lx-btn small primary' : 'lx-btn small ghost'} onClick={() => { setEditing(!editing); setPicked(new Set()); }}>
          {tr(editing ? 'lx.people.done' : 'lx.people.correct')}
        </button>
      </header>
      {editing && <p className="lx-hint">{tr('lx.people.correctHint', { name })}</p>}
      {!editing && <BirthdayRow name={name} />}
      {!editing && canMakePhoneAlbums() && list.some(p => p.status === 'selected') && (
        <button className="lx-btn ghost wide" onClick={() => void copyToPhoneAlbum(name, list.filter(p => p.status === 'selected'))}>{tr('lx.phone.personAlbum', { name })}</button>
      )}
      <div className="lx-grid">
        {list.map(p => (
          <button key={p.id} className={`lx-grid-cell ${p.status}${editing ? ' picking' : ''}${picked.has(p.id) ? ' picked' : ''}`}
            onClick={() => (editing ? toggle(p.id) : useLx.getState().openViewer(list.map(x => x.id), list.indexOf(p)))}>
            <Thumb id={p.id} lqip={p.lqip} edits={p.edits} />
            {editing ? <span className="lx-face-check">{picked.has(p.id) ? '✓' : ''}</span> : <span className="lx-grid-score">{p.aiScore}</span>}
          </button>
        ))}
      </div>
      {editing && picked.size > 0 && (
        <div className="lx-pickbar" role="region" aria-live="polite">
          <span>{tr('lx.people.picked', { count: picked.size })}</span>
          <button className="lx-btn ghost small" disabled={busy} onClick={() => void apply(true)}>{tr('lx.people.someoneElse')}</button>
          <button className="lx-btn primary small" disabled={busy} onClick={() => void apply()}>{tr('lx.people.notHim', { name })}</button>
        </div>
      )}
    </div>
  );
}

function PhotoGrid({ list }: { list: PhotoView[]; title: string }) {
  const openViewer = useLx(s => s.openViewer);
  return (
    <div className="lx-grid">
      {list.map(p => (
        <button key={p.id} className={`lx-grid-cell ${p.status}`} onClick={() => openViewer(list.map(x => x.id), list.indexOf(p))}>
          <Thumb id={p.id} lqip={p.lqip} edits={p.edits} />
          <span className="lx-grid-score">{p.aiScore}</span>
        </button>
      ))}
    </div>
  );
}

/** „✨ Mai frumoase”: toate pozele păstrate ale zilei, cu stilul Natural, ca și copii. */
function EnhanceAllButton({ ids }: { ids: string[] }) {
  const tr = useTr();
  const [progress, setProgress] = useState<string | null>(null);
  if (ids.length < 2) return null;
  return (
    <button className="lx-link" disabled={progress !== null} onClick={() => {
      setProgress('0');
      void enhanceAll(ids, (d, t) => setProgress(`${d}/${t}`)).finally(() => setProgress(null));
    }}>✨ {progress ? tr('lx.enhance.allProgress', { progress }) : tr('lx.enhance.all', { count: ids.length })}</button>
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
              <button className="lx-link" onClick={() => void exportSelection('apps', day.kept.map(p => p.id)).then(() => learnFromShare(day.kept))}>{tr('lx.day.share', { count: day.kept.length })}</button>
              <EnhanceAllButton ids={day.kept.filter(p => !p.edits).map(p => p.id)} />
              <StoryButton ids={day.kept.map(p => p.id)} title={capitalizeFirst(label)} subtitle={tr('lx.story.daySub', { count: day.kept.length })} />
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
              <button key={s.id} className="lx-series" onClick={() => useLx.getState().openViewer(s.photos.map(p => p.id), s.photos.findIndex(p => p.id === s.best.id))}>
                {s.photos.slice(0, 6).map(p => (
                  <span key={p.id} className={p.id === s.best.id ? 'lx-series-frame best' : `lx-series-frame${p.status === 'rejected' ? ' out' : ''}`}>
                    <Thumb id={p.id} lqip={p.lqip} edits={p.edits} />
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
            {(d.kept.length ? d.kept : d.photos).slice(0, 3).map(p => <Thumb key={p.id} id={p.id} lqip={p.lqip} edits={p.edits} />)}
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

/**
 * „Sortează toată galeria”: aduce toate pozele din telefon pe care Lumi nu le-a
 * văzut încă și le sortează (după autonomia aleasă). Cerut: „buton de adăugare
 * și sortare întreagă galerie”.
 */
function SortAllButton({ count, small }: { count?: number; small?: boolean }) {
  const tr = useTr();
  const progress = useStore(s => s.progress);
  const importing = useStore(s => s.supervisorImporting);
  const reader = useLx(s => s.reader);
  const busy = !!reader || importing || (!!progress && progress.phase !== 'finalizat');
  // Același cititor ca la pornire: pe bucăți, fără toată galeria în memorie.
  const run = () => void readWholeGallery(true).then(() => decideRestIfAllowed());
  return (
    <button className={small ? 'lx-btn primary small' : 'lx-btn primary wide'} disabled={busy} onClick={run}>
      {busy ? tr('lx.sortAll.busy') : count ? tr('lx.sortAll.count', { count }) : tr('lx.sortAll.short')}
    </button>
  );
}
