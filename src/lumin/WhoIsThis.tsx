import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { FaceThumb } from './FaceThumb';
import { usePeopleFaces } from './faces';
import { autoNameFaces, suggestFaces, type FaceSuggestion } from './faceIdentity';
import { useTr } from './context';
import { useLx } from './lxStore';

/**
 * lumin/WhoIsThis.tsx
 * „Pe cine văd cel mai des?”: Cherrypic întreabă singur, pe Azi, numele omului
 * care apare în cele mai multe poze și n-are încă nume. Cu un nume, recunoașterea,
 * căutarea („Ami și mama”), poveștile și albumele devin personale.
 * „Nu acum” îl ascunde o săptămână.
 */
const SNOOZE_KEY = 'lumin-who-snooze';
const MIN_PHOTOS = 4;

function snoozed(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? '{}'); } catch { return {}; }
}

export function WhoIsThis() {
  const tr = useTr();
  const persons = useStore(s => s.persons);
  const askPrompt = useStore(s => s.askPrompt);
  const enrollFaceCluster = useStore(s => s.enrollFaceCluster);
  const setNotice = useStore(s => s.setNotice);
  const faceVersion = useLx(s => s.faceVersion);
  const bumpFaces = useLx(s => s.bumpFaces);
  const reader = useLx(s => s.reader);
  const [, bump] = useState(0);
  const [busy, setBusy] = useState(false);
  const { unknown } = usePeopleFaces(persons, faceVersion);
  if (reader) return null; // fețele se grupează după ce se termină citirea galeriei

  const hidden = snoozed();
  const now = Date.now();
  const cluster = [...unknown]
    .filter(c => new Set(c.members.map(m => m.photoId)).size >= MIN_PHOTOS)
    .filter(c => !(hidden[c.members[0].photoId] > now))
    .sort((a, b) => b.members.length - a.members.length)[0];
  if (!cluster) return null;
  const face = cluster.members[0];
  const count = new Set(cluster.members.map(m => m.photoId)).size;

  const name = async () => {
    const value = (await askPrompt(tr('lx.brain.namePrompt'), '', { confirmLabel: tr('lx.save') }))?.trim();
    if (!value) return;
    setBusy(true);
    try {
      await enrollFaceCluster(value, cluster.members.map(m => ({ photoId: m.photoId, faceIndex: m.faceIndex, embedding: m.embedding })));
      const more = await autoNameFaces().catch(() => 0);
      setNotice(tr('lx.people.tagged', { name: value, count: cluster.members.length + more }));
      bumpFaces();
    } finally { setBusy(false); }
  };
  const later = () => {
    const all = snoozed();
    all[face.photoId] = now + 7 * 86_400_000;
    try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(all)); } catch { /* fără stocare */ }
    bump(x => x + 1);
  };

  return (
    <section className="lx-card lx-who" role="region" aria-label={tr('lx.who.title', { count })}>
      <FaceThumb photoId={face.photoId} box={face.box} size={72} className="lx-who-face" />
      <div className="lx-who-body">
        <b>{tr('lx.who.title', { count })}</b>
        <span>{tr('lx.who.sub')}</span>
        <div className="lx-feed-actions">
          <button className="lx-btn primary small" disabled={busy} onClick={() => void name()}>{tr('lx.who.name')}</button>
          <button className="lx-link" onClick={later}>{tr('lx.feed.later')}</button>
        </div>
      </div>
    </section>
  );
}

/**
 * „E tot Ami?”: fețele pe care recunoașterea nu le-a putut pune singură, dar
 * care seamănă cu cineva numit. Un „Da” le pune numele (și învață din ele),
 * un „Nu” nu mai întreabă de fața asta.
 */
const ASKED_KEY = 'lumin-isit-answered';
function answered(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(ASKED_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}
function remember(key: string): void {
  const all = [...answered(), key].slice(-3000);
  try { localStorage.setItem(ASKED_KEY, JSON.stringify(all)); } catch { /* fără stocare */ }
}

export function IsItThem() {
  const tr = useTr();
  const enrollFaceCluster = useStore(s => s.enrollFaceCluster);
  const faceVersion = useLx(s => s.faceVersion);
  const bumpFaces = useLx(s => s.bumpFaces);
  const reader = useLx(s => s.reader);
  const [list, setList] = useState<FaceSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (reader) return;
    let alive = true;
    void suggestFaces(answered()).then(r => { if (alive) setList(r); }).catch(() => {});
    return () => { alive = false; };
  }, [faceVersion, reader]);
  const current = list[0];
  if (!current || reader) return null;
  const key = `${current.face.photoId}:${current.face.faceIndex}`;
  const next = () => { remember(key); setList(l => l.slice(1)); };
  const yes = async () => {
    setBusy(true);
    try {
      await enrollFaceCluster(current.name, [{ photoId: current.face.photoId, faceIndex: current.face.faceIndex, embedding: current.face.embedding }]);
      next();
      bumpFaces();
    } finally { setBusy(false); }
  };
  return (
    <section className="lx-card lx-who" role="region" aria-label={tr('lx.isit.title', { name: current.name })}>
      <FaceThumb photoId={current.face.photoId} box={current.face.box} size={72} className="lx-who-face" />
      <div className="lx-who-body">
        <b>{tr('lx.isit.title', { name: current.name })}</b>
        <span>{tr('lx.isit.sub', { left: list.length })}</span>
        <div className="lx-feed-actions">
          <button className="lx-btn primary small" disabled={busy} onClick={() => void yes()}>{tr('lx.isit.yes')}</button>
          <button className="lx-btn ghost small" disabled={busy} onClick={next}>{tr('lx.isit.no')}</button>
        </div>
      </div>
    </section>
  );
}
