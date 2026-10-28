import { useMemo, useState, type ReactNode } from 'react';
import { formatBytes } from '../core/freedSpace';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { readLastBackupAt } from '../state/backupReminder';
import { useStore, type PhotoView } from '../state/store';
import { useTr } from './context';
import { groupDays, photoTime } from './days';
import { monthLabel } from './format';
import { monthStart } from './coverage';
import { useLx } from './lxStore';
import { buildEvents } from './momentAlbums';
import { Orb } from './Orb';
import { learnFromShare } from './signals';
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
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);
  const premiumLocked = useStore(s => s.premiumLocked);
  const gatePremium = useStore(s => s.gatePremium);
  const trashPhotos = useStore(s => s.trashPhotos);
  const exportSelection = useStore(s => s.exportSelection);
  const exportBackup = useStore(s => s.exportBackup);
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

    // 3. Serii aproape la fel.
    const series = seriesExtras(photos);
    if (native && series.sets >= 2) {
      out.push({
        id: `series-${series.extras.length}`,
        text: tr('lx.feed.series', { sets: series.sets, count: series.extras.length }),
        sub: bytes(series.extras) ? tr('lx.feed.frees', { size: formatBytes(bytes(series.extras), locale) }) : undefined,
        action: tr('lx.feed.seriesGo'),
        run: () => trashPhotos(series.extras.map(p => p.id)),
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
        run: () => trashPhotos(shots.map(p => p.id)),
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

    // 7. Salvarea a ce a învățat Lumi (în Drive, din foaia de trimitere).
    const decided = photos.filter(p => p.status === 'selected' || p.status === 'rejected').length;
    const last = readLastBackupAt();
    if (decided >= 50 && (!last || last < Date.now() - 30 * DAY)) {
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
  }, [photos, locale, premiumLocked, why, tr, exportSelection, exportBackup, trashPhotos, gatePremium, openSort, openViewer, setTab, setView]);

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
            <button className="lx-btn primary small" disabled={busy} onClick={() => void act(i.run)}>{i.action}</button>
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
