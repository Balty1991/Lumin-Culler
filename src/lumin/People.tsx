import { useState } from 'react';
import { useStore } from '../state/store';
import { FaceCropThumb } from '../ui/FaceCropThumb';
import type { FaceCluster } from '../core/faceClustering';
import { usePeopleFaces, rememberPersonFace, type LooseFace } from './faces';
import { useTr } from './context';

const key = (f: LooseFace) => `${f.photoId}#${f.faceIndex}`;

/**
 * lumin/People.tsx
 * Oamenii tăi, cu fața lor. Pe telefon recunoașterea automată a fețelor e
 * oprită (modelul de identitate nu are o licență bună pentru Play), deci nu
 * putem grupa singuri fețele aceluiași om. În schimb: atingi toate fețele
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
  const { people, unknown, loose } = usePeopleFaces(persons, refresh);

  const ask = async () => (await askPrompt(tr('lx.brain.namePrompt'), '', { confirmLabel: tr('lx.save') }))?.trim() || null;
  const nameCluster = async (cluster: FaceCluster) => {
    const value = await ask();
    if (!value) return;
    setBusy(true);
    try {
      await enrollFaceCluster(value, cluster.members.map(m => ({ photoId: m.photoId, faceIndex: m.faceIndex, embedding: m.embedding })));
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
      setNotice(tr('lx.people.tagged', { name: value, count: faces.length }));
      setPicked(new Map());
    } finally { setBusy(false); setRefresh(n => n + 1); }
  };

  if (!people.length && !unknown.length && !loose.length) return <p className="lx-empty small">{tr('lx.brain.peopleNone')}</p>;

  return (
    <>
      {people.length > 0 && (
        <div className="lx-faces">
          {people.map(p => (
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
