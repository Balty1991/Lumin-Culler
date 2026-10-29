import { useState } from 'react';
import { useStore } from '../state/store';
import { FaceThumb as FaceCropThumb } from './FaceThumb';
import type { FaceCluster } from '../core/faceClustering';
import { usePeopleFaces, rememberPersonFace, type LooseFace } from './faces';
import { useTr } from './context';
import { useLx } from './lxStore';
import { PERSON_GROUPS, readPersonGroups, type PersonGroup } from './personGroups';
import { autoNameFaces } from './faceIdentity';

const key = (f: LooseFace) => `${f.photoId}#${f.faceIndex}`;

/**
 * lumin/People.tsx
 * Oamenii tăi, cu fața lor. Pe telefon recunoașterea automată a fețelor e
 * oprită (modelul de identitate nu are o licență bună pentru Play), deci nu
 * putem grupa singuri fețele aceluiași om. (Cu SFace, lumin/faceIdentity.ts,
 * fețele care seamănă vin deja grupate.) Pentru restul: atingi toate fețele
 * cuiva (raportat: „multe fețe sunt aceeași persoană”), apoi „Numește” — toate
 * primesc același nume dintr-o dată, iar pozele lor intră la acel om. Cu fețe
 * selectate, o atingere pe cineva deja numit le adaugă la el.
 */
export function PeopleGrid({ onOpen }: { onOpen?: (name: string) => void }) {
  const tr = useTr();
  const persons = useStore(s => s.persons);
  const askPrompt = useStore(s => s.askPrompt);
  const enrollFaceCluster = useStore(s => s.enrollFaceCluster);
  const setNotice = useStore(s => s.setNotice);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Map<string, LooseFace>>(new Map());
  const faceVersion = useLx(s => s.faceVersion);
  const faceProgress = useLx(s => s.faceProgress);
  const { people, unknown, loose } = usePeopleFaces(persons, refresh + faceVersion);
  const groups = readPersonGroups();
  const [group, setGroup] = useState<PersonGroup | null>(null);

  const ask = async () => (await askPrompt(tr('lx.brain.namePrompt'), '', { confirmLabel: tr('lx.save') }))?.trim() || null;
  const nameCluster = async (cluster: FaceCluster) => {
    const value = await ask();
    if (!value) return;
    setBusy(true);
    try {
      await enrollFaceCluster(value, cluster.members.map(m => ({ photoId: m.photoId, faceIndex: m.faceIndex, embedding: m.embedding })));
      const more = await autoNameFaces().catch(() => 0);
      setNotice(tr('lx.people.tagged', { name: value, count: cluster.members.length + more }));
    } finally { setBusy(false); setRefresh(n => n + 1); }
  };
  const toggle = (f: LooseFace) => setPicked(prev => {
    const next = new Map(prev);
    if (next.has(key(f))) next.delete(key(f)); else next.set(key(f), f);
    return next;
  });
  const namePicked = async (existing?: string) => {
    const faces = [...picked.values()];
    if (!faces.length) return;
    const value = existing ?? await ask();
    if (!value) return;
    setBusy(true);
    try {
      await enrollFaceCluster(value, faces.map(f => ({ photoId: f.photoId, faceIndex: f.faceIndex, embedding: [] })));
      if (!existing) rememberPersonFace(value, faces[0]);
      const more = await autoNameFaces().catch(() => 0);
      setNotice(tr('lx.people.tagged', { name: value, count: faces.length + more }));
      setPicked(new Map());
    } finally { setBusy(false); setRefresh(n => n + 1); }
  };

  const learning = faceProgress && faceProgress.total > 0 && (
    <div className="lx-face-learning" role="status">
      <span>{tr('lx.people.learning', { done: faceProgress.done, total: faceProgress.total })}</span>
      <div className="lx-progress small"><i style={{ width: `${Math.round((faceProgress.done / faceProgress.total) * 100)}%` }} /></div>
    </div>
  );
  if (!people.length && !unknown.length && !loose.length) return <>{learning}<p className="lx-empty small">{tr('lx.brain.peopleNone')}</p></>;

  return (
    <>
      {learning}
      {people.length > 0 && Object.keys(groups).length > 0 && (
        <div className="lx-chips">
          <button className={group === null ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setGroup(null)}>{tr('lx.group.all')}</button>
          {PERSON_GROUPS.filter(g => people.some(p => groups[p.name] === g)).map(g => (
            <button key={g} className={group === g ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setGroup(g)}>{tr(`lx.group.${g}`)}</button>
          ))}
          {group && (
            <button className="lx-chip-btn" onClick={() => {
              const names = new Set(people.filter(p => groups[p.name] === group).map(p => p.name));
              const ids = useStore.getState().photos.filter(ph => ph.status === 'selected' && ph.personNames.some(n => names.has(n))).sort((a, b) => (b.capturedAt ?? 0) - (a.capturedAt ?? 0)).map(ph => ph.id);
              if (ids.length) useLx.getState().openViewer(ids);
            }}>🖼 {tr('lx.group.album')}</button>
          )}
        </div>
      )}
      {people.length > 0 && (
        <div className="lx-faces">
          {people.filter(p => !group || groups[p.name] === group).map(p => (
            <button key={p.name} className={picked.size ? 'lx-face target' : 'lx-face'} disabled={busy}
              onClick={() => (picked.size ? void namePicked(p.name) : onOpen?.(p.name))}>
              <FaceCropThumb photoId={p.photoId} box={p.box} size={72} className="lx-face-img" />
              <b>{p.name}</b>
              <span>{picked.size ? tr('lx.people.addHere') : tr('lx.brain.photos', { count: p.photoIds.length })}</span>
            </button>
          ))}
        </div>
      )}
      {unknown.length > 0 && (
        <div className="lx-faces">
          {unknown.map((c, i) => (
            <button key={`c-${c.members[0].photoId}-${i}`} className="lx-face unknown" disabled={busy} onClick={() => void nameCluster(c)}>
              <FaceCropThumb photoId={c.members[0].photoId} box={c.members[0].box} size={72} className="lx-face-img" />
              <b>{tr('lx.brain.whoIs')}</b>
              <span>{tr('lx.brain.photos', { count: c.members.length })}</span>
            </button>
          ))}
        </div>
      )}
      {loose.length > 0 && (
        <>
          <p className="lx-hint">{tr('lx.people.pickHint')}</p>
          <div className="lx-faces small">
            {loose.map(f => (
              <button key={key(f)} className={picked.has(key(f)) ? 'lx-face pick on' : 'lx-face pick'} disabled={busy}
                onClick={() => toggle(f)} aria-pressed={picked.has(key(f))}>
                <FaceCropThumb photoId={f.photoId} box={f.box} size={64} className="lx-face-img" />
                {picked.has(key(f)) && <span className="lx-face-check">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
      {picked.size > 0 && (
        <div className="lx-pickbar" role="region" aria-live="polite">
          <span>{tr('lx.people.picked', { count: picked.size })}</span>
          <button className="lx-btn ghost small" onClick={() => setPicked(new Map())}>{tr('lx.people.clear')}</button>
          <button className="lx-btn primary small" disabled={busy} onClick={() => void namePicked()}>{tr('lx.people.name')}</button>
        </div>
      )}
    </>
  );
}
