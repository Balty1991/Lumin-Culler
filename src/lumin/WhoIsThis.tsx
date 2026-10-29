import { useState } from 'react';
import { useStore } from '../state/store';
import { FaceThumb } from './FaceThumb';
import { usePeopleFaces } from './faces';
import { autoNameFaces } from './faceIdentity';
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
