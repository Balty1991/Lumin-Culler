import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, type PhotoView } from '../state/store';
import { useTr } from './context';
import { Thumb } from './Thumb';
import { photoTime } from './days';
import { useLxPhotos } from './useLxPhotos';
import { Icon } from './icons';
import { makeCollage, shareCollage } from './collage';

/**
 * lumin/FamilyPick.tsx
 * „Alegeți împreună”: dai telefonul cuiva drag (mama, bunica, partenerul),
 * alege din 10 poze recente ce ar păstra el. La final: ce v-a plăcut amândurora,
 * cât de mult seamănă gusturile voastre și colajul preferatelor lui.
 * Fără server: alegerile rămân pe telefon. Nu schimbă gustul învățat al tău.
 */
const KEY = 'lx.familyVotes';
type Votes = Record<string, Record<string, boolean>>;

function readVotes(): Votes {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Votes; } catch { return {}; }
}
function writeVotes(v: Votes): void {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* fără stocare */ }
}

/** Cele 10 poze de ales: recente, frumoase, cel mult una pe oră, amestecate (păstrate și nu). */
export function familyRound(photos: readonly PhotoView[], now = Date.now()): PhotoView[] {
  const recent = photos.filter(p => !p.aside && p.mediaUri !== undefined && photoTime(p) > now - 60 * 86_400_000);
  const pool = recent.length >= 10 ? recent : photos.filter(p => !p.aside);
  const perHour = new Map<number, PhotoView>();
  const score = (p: PhotoView) => p.aesthetic ?? p.aiScore / 12;
  for (const p of pool) {
    const k = Math.floor(photoTime(p) / 3_600_000);
    const cur = perHour.get(k);
    if (!cur || score(p) > score(cur)) perHour.set(k, p);
  }
  return [...perHour.values()].sort((a, b) => score(b) - score(a)).slice(0, 10);
}

export function FamilyPickCard() {
  const tr = useTr();
  const photos = useLxPhotos();
  const [open, setOpen] = useState(false);
  if (photos.filter(p => !p.aside).length < 10) return null;
  return (
    <>
      <button className="lx-card lx-family-card" onClick={() => setOpen(true)}>
        <span className="lx-family-icon"><Icon name="similar" size={22} /></span>
        <div>
          <b>{tr('lx.family.title')}</b>
          <span>{tr('lx.family.sub')}</span>
        </div>
        <span className="lx-chev" aria-hidden="true">›</span>
      </button>
      {open && <FamilyPickSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function FamilyPickSheet({ onClose }: { onClose: () => void }) {
  const tr = useTr();
  const photos = useLxPhotos();
  const askPrompt = useStore(s => s.askPrompt);
  const round = useMemo(() => familyRound(photos), [photos]);
  const [who, setWho] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [picks, setPicks] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const start = async () => {
    const name = (await askPrompt(tr('lx.family.who'), '', { confirmLabel: tr('lx.family.start') }))?.trim();
    if (name) setWho(name);
  };
  const vote = (yes: boolean) => {
    const p = round[i];
    const next = { ...picks, [p.id]: yes };
    setPicks(next);
    if (i + 1 >= round.length) {
      const all = readVotes();
      all[who!] = { ...(all[who!] ?? {}), ...next };
      writeVotes(all);
    }
    setI(i + 1);
  };

  const done = who !== null && i >= round.length;
  const liked = round.filter(p => picks[p.id]);
  const mine = round.filter(p => p.status === 'selected' || p.status === 'rejected');
  const agree = mine.filter(p => (p.status === 'selected') === !!picks[p.id]).length;
  const both = liked.filter(p => p.status === 'selected');
  const share = async () => {
    if (!liked.length) return;
    setBusy(true);
    try {
      const title = tr('lx.family.favTitle', { name: who ?? '' });
      const blob = await makeCollage(liked.slice(0, 9).map(p => p.id), title, '');
      if (blob) await shareCollage(blob, `cherrypic-preferatele-${(who ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`, title);
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="lx lx-sheet-wrap" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lx-sheet lx-family" onClick={e => e.stopPropagation()}>
        {who === null ? (
          <>
            <h2>{tr('lx.family.title')}</h2>
            <p className="lx-hint">{tr('lx.family.intro', { count: round.length })}</p>
            <div className="lx-family-strip">{round.slice(0, 5).map(p => <Thumb key={p.id} id={p.id} lqip={p.lqip} sharp={false} />)}</div>
            <div className="lx-decide-actions">
              <button className="lx-btn ghost" onClick={onClose}>{tr('lx.enhance.cancel')}</button>
              <button className="lx-btn primary" onClick={() => void start()}>{tr('lx.family.start')}</button>
            </div>
          </>
        ) : !done ? (
          <>
            <p className="lx-eyebrow">{tr('lx.family.progress', { name: who, done: i + 1, total: round.length })}</p>
            <div className="lx-family-photo"><Thumb id={round[i].id} lqip={round[i].lqip} edits={round[i].edits} full /></div>
            <div className="lx-viewer-decide">
              <button className="lx-dbtn drop" onClick={() => vote(false)}><span><Icon name="x" /></span>{tr('lx.family.no')}</button>
              <button className="lx-dbtn keep" onClick={() => vote(true)}><span><Icon name="check" /></span>{tr('lx.family.yes')}</button>
            </div>
          </>
        ) : (
          <>
            <h2>{tr('lx.family.favTitle', { name: who })}</h2>
            {mine.length >= 3 && <p className="lx-family-match">{tr('lx.family.match', { percent: Math.round((agree / mine.length) * 100), name: who })}</p>}
            {both.length > 0 && <p className="lx-hint">{tr('lx.family.both', { count: both.length })}</p>}
            <div className="lx-family-strip">{liked.slice(0, 8).map(p => <Thumb key={p.id} id={p.id} lqip={p.lqip} sharp={false} />)}</div>
            <div className="lx-decide-actions">
              <button className="lx-btn ghost" onClick={onClose}>{tr('lx.close')}</button>
              <button className="lx-btn primary" disabled={!liked.length || busy} onClick={() => void share()}>{tr('lx.family.share')}</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
