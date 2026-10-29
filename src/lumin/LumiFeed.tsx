import { useMemo, useState, type ReactNode } from 'react';
import { useLxPhotos } from './useLxPhotos';
import { formatBytes } from '../core/freedSpace';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { readLastBackupAt } from '../state/backupReminder';
import { useStore, type PhotoView } from '../state/store';
import { useTr } from './context';
import { autoBackupAvailable, autoBackupOn, setAutoBackup } from './autoBackup';
import { cloudAvailable, cloudEnabled, ensureCloud } from './cloud';
import { groupDays, photoTime } from './days';
import { monthLabel } from './format';
import { monthStart } from './coverage';
import { useLx } from './lxStore';
import { buildEvents } from './momentAlbums';
import { Orb } from './Orb';
import { learnFromShare } from './signals';
import { StoryButton } from './Story';
import { nextBirthday, readBirthdays } from './birthdays';
import { makeCollage, shareCollage } from './collage';
import { Thumb } from './Thumb';
import { personalWhy, useWhyContext } from './why';

/**
 * lumin/LumiFeed.tsx
 * „Lumi îți propune”: asistentul care vine el cu treaba, nu așteaptă să-l cauți.
 * Raportat: „legat de asistentul AI, nu prea am văzut mari intervenții sau
 * ajutor din partea lui”. Fiecare propunere spune ce a găsit Lumi în galeria ta
 * și se face dintr-o atingere: o lună de terminat, serii aproape la fel, un
 * eveniment, poza zilei de trimis, capturi vechi, salvarea a ce a învățat.
 *
 * Cel mult trei deodată, cele mai utile întâi; „Nu acum” o ascunde 3 zile.
 */
const DAY = 86_400_000;
const SNOOZE_KEY = 'lumin-feed-snooze';
const isWaiting = (p: PhotoView) => !p.aside && (p.status === 'review' || p.status === 'pending' || p.status === 'candidate');
const bytes = (list: readonly PhotoView[]) => list.reduce((s, p) => s + (p.sizeBytes ?? 0), 0);

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function readSnooze(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? '{}'); } catch { return {}; }
}
function snooze(id: string, days = 3): void {
  const all = readSnooze();
  all[id] = Date.now() + days * DAY;
  try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(all)); } catch { /* fără stocare */ }
}

interface Idea {
  id: string;
  /** Ce spune Lumi (persoana I). */
  text: string;
  sub?: string;
  photoId?: string;
  action: string;
  run: () => void | Promise<unknown>;
  second?: { label: string; run: () => void };
  /** În locul butonului principal (ex. filmul, cu progresul lui). */
  custom?: ReactNode;
}

/** Seriile cu poze aproape la fel: cea mai bună rămâne, restul pot pleca. */
export function seriesExtras(photos: readonly PhotoView[]): { sets: number; extras: PhotoView[] } {
  const groups = new Map<string, PhotoView[]>();
  for (const p of photos) {
    if (!p.groupId || p.aside) continue;
    const g = groups.get(p.groupId);
    if (g) g.push(p); else groups.set(p.groupId, [p]);
  }
  let sets = 0;
  const extras: PhotoView[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const best = g.find(p => p.status === 'selected') ?? [...g].sort((a, b) => b.aiScore - a.aiScore)[0];
    const rest = g.filter(p => p !== best && p.status !== 'selected' && p.mediaUri);
    if (rest.length) { sets++; extras.push(...rest); }
  }
  return { sets, extras };
}

export function LumiFeed() {
  const tr = useTr();
  const photos = useLxPhotos();
  const locale = useStore(s => s.locale);
  const premiumLocked = useStore(s => s.premiumLocked);
  const gatePremium = useStore(s => s.gatePremium);
  const trashPhotos = useStore(s => s.trashPhotos);
  const exportSelection = useStore(s => s.exportSelection);
  const exportBackup = useStore(s => s.exportBackup);
  const askConfirm = useStore(s => s.askConfirm);
  const openSort = useLx(s => s.openSort);
  const openViewer = useLx(s => s.openViewer);
  const setTab = useLx(s => s.setTab);
  const setView = useLx(s => s.setGalleryView);
  const reader = useLx(s => s.reader);
  const why = useWhyContext();
  const [, bump] = useState(0);
  const [busy, setBusy] = useState(false);

  const ideas = useMemo<Idea[]>(() => {
    const out: Idea[] = [];
    const native = isNativeMediaLibraryAvailable();

    // 1. Poza zilei (azi sau ieri): de trimis familiei.
    const days = groupDays(photos);
    const recent = days.find(d => d.kept.length > 0 && d.start >= Date.now() - 2 * DAY);
    const best = recent ? [...recent.kept].sort((a, b) => b.aiScore - a.aiScore)[0] : undefined;
    if (best) {
      out.push({
        id: `pod-${best.id}`, photoId: best.id,
        text: tr('lx.feed.pod', { when: recent!.start >= Date.now() - DAY ? tr('lx.feed.today') : tr('lx.feed.yesterday') }),
        sub: personalWhy(best, why, tr),
        action: tr('lx.feed.podSend'),
        run: () => exportSelection('apps', [best.id]).then(() => learnFromShare([best])),
        second: { label: tr('lx.feed.see'), run: () => openViewer(recent!.kept.map(p => p.id), recent!.kept.indexOf(best)) }
      });
    }

    // 1b. „Două minute”: cele 10 poze la care AI-ul e cel mai nesigur (scor aproape de
    // mijloc), din zile diferite. Din ele învață cel mai mult despre gustul omului.
    const unsure = photos.filter(p => isWaiting(p) && Math.abs(p.aiScore - 50) <= 15)
      .sort((a, b) => Math.abs(a.aiScore - 50) - Math.abs(b.aiScore - 50));
    const seenDays = new Set<number>();
    const lesson: PhotoView[] = [];
    for (const p of unsure) {
      const d = Math.floor(photoTime(p) / DAY);
      if (seenDays.has(d) && unsure.length > 20) continue;
      seenDays.add(d);
      lesson.push(p);
      if (lesson.length === 10) break;
    }
    if (lesson.length >= 6) {
      out.push({
        id: `lesson-${new Date().toDateString()}`, photoId: lesson[0].id,
        text: tr('lx.feed.lesson', { count: lesson.length }),
        sub: tr('lx.feed.lessonSub'),
        action: tr('lx.feed.lessonGo'),
        run: () => openSort(lesson.map(p => p.id), tr('lx.feed.lessonTitle'))
      });
    }

    // 1c. Un om drag, fără poze noi de mult: „N-ai mai făcut poze cu bunica din martie”.
    const lastSeen = new Map<string, { at: number; count: number; best?: PhotoView }>();
    for (const p of photos) {
      if (p.aside) continue;
      for (const n of p.personNames) {
        const e = lastSeen.get(n) ?? { at: 0, count: 0 };
        e.count++;
        if (photoTime(p) > e.at) e.at = photoTime(p);
        if (p.status === 'selected' && (!e.best || p.aiScore > e.best.aiScore)) e.best = p;
        lastSeen.set(n, e);
      }
    }
    const missed = [...lastSeen.entries()]
      .filter(([, e]) => e.count >= 10 && e.at < Date.now() - 150 * DAY && e.at > Date.now() - 3 * 365 * DAY)
      .sort((a, b) => b[1].count - a[1].count)[0];
    if (missed) {
      const [name, e] = missed;
      out.push({
        id: `missed-${name}-${monthStart(Date.now())}`, photoId: e.best?.id,
        text: tr('lx.feed.missed', { name, month: monthLabel(monthStart(e.at), locale) }),
        sub: tr('lx.feed.missedSub'),
        action: tr('lx.feed.missedGo'),
        run: () => {
          const theirs = photos.filter(p => p.personNames.includes(name) && p.status === 'selected').sort((a, b) => photoTime(b) - photoTime(a)).slice(0, 30);
          if (theirs.length) openViewer(theirs.map(p => p.id));
        }
      });
    }

    // 2. O lună de terminat: cea mai recentă cu poze care așteaptă.
    const byMonth = new Map<number, PhotoView[]>();
    for (const p of photos) if (isWaiting(p)) {
      const m = monthStart(photoTime(p));
      const l = byMonth.get(m);
      if (l) l.push(p); else byMonth.set(m, [p]);
    }
    const months = [...byMonth.entries()].filter(([, l]) => l.length >= 5).sort((a, b) => b[0] - a[0]);
    if (months.length) {
      const [m, list] = months[0];
      const minutes = Math.max(1, Math.round(list.length * 2.5 / 60));
      out.push({
        id: `month-${m}-${list.length}`,
        text: tr('lx.feed.month', { month: monthLabel(m, locale), count: list.length, minutes }),
        sub: months.length > 1 ? tr('lx.feed.monthsLeft', { count: months.length }) : undefined,
        action: tr('lx.feed.monthGo'),
        run: () => openSort(list.map(p => p.id), monthLabel(m, locale))
      });
    }

    // 2a. O zi de naștere în următoarele 3 zile: colajul cu persoana din ultimul an.
    const birthdays = readBirthdays();
    for (const [name, b] of Object.entries(birthdays)) {
      const next = nextBirthday(b);
      if (next.days > 3) continue;
      const theirs = photos.filter(p => p.personNames.includes(name) && !p.aside && photoTime(p) >= Date.now() - 366 * DAY);
      if (theirs.length < 3) continue;
      const pick = [...theirs].sort((a, b2) => (b2.status === 'selected' ? 1 : 0) - (a.status === 'selected' ? 1 : 0) || b2.aiScore - a.aiScore).slice(0, 7);
      const when = next.days === 0 ? tr('lx.feed.today') : next.days === 1 ? tr('lx.birthday.tomorrow') : tr('lx.birthday.inDays', { days: next.days });
      out.unshift({
        id: `bday-${name}-${new Date().getFullYear()}`, photoId: pick[0].id,
        text: capitalize(tr(next.turns ? 'lx.feed.birthdayTurns' : 'lx.feed.birthday', { name, when, turns: next.turns ?? 0 })),
        sub: tr('lx.feed.birthdaySub', { count: pick.length }),
        action: tr('lx.feed.birthdayGo'),
        run: async () => {
          const title = tr('lx.birthday.collageTitle', { name });
          const blob = await makeCollage(pick.map(p => p.id), title, tr('lx.birthday.collageSub'));
          if (blob) await shareCollage(blob, `cherrypic-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`, title);
        }
      });
    }

    const today = new Date();
    // 2c. Duminică (și luni dimineață): povestea săptămânii, din cele mai bune păstrate.
    const dow = today.getDay();
    if (dow === 0 || (dow === 1 && today.getHours() < 12)) {
      const weekKept = photos.filter(p => p.status === 'selected' && !p.aside && photoTime(p) >= Date.now() - 7 * DAY);
      if (weekKept.length >= 5) {
        const pick = [...weekKept].sort((a, b) => b.aiScore - a.aiScore).slice(0, 10).sort((a, b) => photoTime(a) - photoTime(b));
        out.push({
          id: `week-${Math.floor(Date.now() / (7 * DAY))}`, photoId: pick[0].id,
          text: tr('lx.feed.week', { count: pick.length }),
          sub: tr('lx.feed.weekSub'),
          action: '', run: () => {},
          custom: <StoryButton className="lx-btn primary small" ids={pick.map(p => p.id)} title={tr('lx.story.weekTitle')} subtitle={tr('lx.story.daySub', { count: pick.length })} />
        });
      }
    }

    // 2b. Filmul lunii trecute (în primele 10 zile din lună): „Octombrie în 30 de secunde”.
    if (today.getDate() <= 10) {
      const prev = monthStart(new Date(today.getFullYear(), today.getMonth() - 1, 15).getTime());
      const next = monthStart(new Date(today.getFullYear(), today.getMonth(), 15).getTime());
      const kept = photos.filter(p => p.status === 'selected' && !p.aside && photoTime(p) >= prev && photoTime(p) < next);
      if (kept.length >= 8) {
        const pick = [...kept].sort((a, b) => b.aiScore - a.aiScore).slice(0, 14).sort((a, b) => photoTime(a) - photoTime(b));
        const month = monthLabel(prev, locale);
        out.push({
          id: `film-${prev}`, photoId: pick[0].id,
          text: tr('lx.feed.film', { month }),
          sub: tr('lx.feed.filmSub', { count: pick.length }),
          action: '', run: () => {},
          custom: <StoryButton className="lx-btn primary small" ids={pick.map(p => p.id)} title={month} subtitle={tr('lx.feed.filmSubtitle', { count: kept.length })} />
        });
      }
    }

    // 3. Serii aproape la fel.
    const series = seriesExtras(photos);
    if (native && series.sets >= 2) {
      out.push({
        id: `series-${series.extras.length}`,
        text: tr('lx.feed.series', { sets: series.sets, count: series.extras.length }),
        sub: bytes(series.extras) ? tr('lx.feed.frees', { size: formatBytes(bytes(series.extras), locale) }) : undefined,
        action: tr('lx.feed.seriesGo'),
        run: () => (gatePremium('cleanup') ? undefined : trashPhotos(series.extras.map(p => p.id))),
        second: { label: tr('lx.feed.see'), run: () => openViewer(series.extras.map(p => p.id)) }
      });
    }

    // 4. Un eveniment din ultimele două luni.
    const event = buildEvents(photos, locale === 'en' ? 'en' : 'ro').find(e => e.end >= Date.now() - 60 * DAY);
    if (event) {
      out.push({
        id: `event-${event.id}`, photoId: event.cover.id,
        text: tr('lx.feed.event', { title: event.title ?? '', count: event.photos.length }),
        action: tr('lx.feed.eventGo'),
        run: () => { setTab('days'); setView('moments'); }
      });
    }

    // 5. Capturi de ecran vechi.
    const shots = photos.filter(p => p.aside === 'screenshot' && p.status !== 'selected' && p.mediaUri && photoTime(p) < Date.now() - 30 * DAY);
    if (native && shots.length >= 8) {
      out.push({
        id: `shots-${shots.length}`,
        text: tr('lx.feed.shots', { count: shots.length }),
        sub: bytes(shots) ? tr('lx.feed.frees', { size: formatBytes(bytes(shots), locale) }) : undefined,
        action: tr('lx.feed.shotsGo'),
        run: () => (gatePremium('cleanup') ? undefined : trashPhotos(shots.map(p => p.id))),
        second: { label: tr('lx.feed.see'), run: () => openViewer(shots.map(p => p.id)) }
      });
    }

    // 6. Ce așteaptă, cu Pro: Lumi decide singură (arătat pe galeria omului, nu ca listă de funcții).
    const waiting = photos.filter(isWaiting).length;
    if (premiumLocked && waiting >= 30) {
      out.push({
        id: `pro-${Math.round(waiting / 50)}`,
        text: tr('lx.feed.pro', { count: waiting }),
        action: tr('lx.feed.proGo'),
        run: () => { gatePremium('acceptAll'); }
      });
    }

    // AI-ul online oprit: ce ar face în plus, pe galeria omului, și pornirea lui (cu acord).
    if (cloudAvailable() && !cloudEnabled() && photos.length >= 20) {
      out.push({
        id: 'cloud-offer',
        text: tr('lx.feed.cloud'),
        sub: tr('lx.feed.cloudSub'),
        action: tr('lx.feed.cloudGo'),
        run: () => ensureCloud(askConfirm, tr)
      });
    }

    // 7. Salvarea a ce a învățat AI-ul: pe telefon, copia automată săptămânală
    // (în copia Google a telefonului); altfel, o dată, din foaia de trimitere.
    const decided = photos.filter(p => p.status === 'selected' || p.status === 'rejected').length;
    const last = readLastBackupAt();
    if (autoBackupAvailable() && !autoBackupOn() && decided >= 30) {
      out.push({
        id: 'auto-backup',
        text: tr('lx.feed.autoBackup', { count: decided }),
        sub: tr('lx.autoBackup.sub'),
        action: tr('lx.autoBackup.turnOn'),
        run: async () => { if (await askConfirm(tr('lx.autoBackup.askBody'), { confirmLabel: tr('lx.autoBackup.turnOn') })) await setAutoBackup(true); }
      });
    } else if (!autoBackupAvailable() && decided >= 50 && (!last || last < Date.now() - 30 * DAY)) {
      out.push({
        id: `backup-${Math.floor(Date.now() / (30 * DAY))}`,
        text: tr('lx.feed.backup', { count: decided }),
        action: tr('lx.feed.backupGo'),
        run: () => exportBackup()
      });
    }

    const now = Date.now();
    const snoozed = readSnooze();
    return out.filter(i => !(snoozed[i.id] > now));
  }, [photos, locale, premiumLocked, why, tr, exportSelection, exportBackup, trashPhotos, gatePremium, askConfirm, openSort, openViewer, setTab, setView]);

  const shown = ideas.slice(0, 3);
  if (!shown.length || reader) return null;

  const act = async (fn: () => void | Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); bump(x => x + 1); } };

  return (
    <section className="lx-feed" aria-label={tr('lx.feed.title')}>
      <div className="lx-feed-head"><Orb mood="idle" size={26} /><b>{tr('lx.feed.title')}</b></div>
      {shown.map(i => (
        <Bubble key={i.id} photoId={i.photoId}>
          <p>{i.text}</p>
          {i.sub && <span>{i.sub}</span>}
          <div className="lx-feed-actions">
            {i.custom ?? <button className="lx-btn primary small" disabled={busy} onClick={() => void act(i.run)}>{i.action}</button>}
            {i.second && <button className="lx-btn ghost small" onClick={i.second.run}>{i.second.label}</button>}
            <button className="lx-link" onClick={() => { snooze(i.id); bump(x => x + 1); }}>{tr('lx.feed.later')}</button>
          </div>
        </Bubble>
      ))}
    </section>
  );
}

function Bubble({ photoId, children }: { photoId?: string; children: ReactNode }) {
  const photo = useStore(s => (photoId ? s.photos.find(p => p.id === photoId) : undefined));
  return (
    <div className="lx-feed-item">
      {photo && <div className="lx-feed-photo"><Thumb id={photo.id} lqip={photo.lqip} edits={photo.edits} /></div>}
      <div className="lx-feed-body">{children}</div>
    </div>
  );
}
