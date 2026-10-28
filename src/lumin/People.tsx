import { useState } from 'react';
import { useStore } from '../state/store';
import { FaceCropThumb } from '../ui/FaceCropThumb';
import { getDisplayUrl } from '../core/previewUrlCache';
import type { FaceCluster } from '../core/faceClustering';
import { usePeopleFaces, faceFile, rememberPersonFace, type LooseFace } from './faces';
import { useTr } from './context';

/**
 * lumin/People.tsx
 * Oamenii tăi, cu fața lor: cei numiți, grupurile de fețe fără nume și, cât
 * încă nu e numit nimeni (deci fețele n-au amprentă), fețele așa cum sunt.
 * O atingere pe o față fără nume îi dă un nume.
 */
export function PeopleGrid({ onOpen }: { onOpen?: (name: string) => void }) {
  const tr = useTr();
  const persons = useStore(s => s.persons);
  const askPrompt = useStore(s => s.askPrompt);
  const enrollFaceCluster = useStore(s => s.enrollFaceCluster);
  const addPerson = useStore(s => s.addPerson);
  const setNotice = useStore(s => s.setNotice);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
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
  const nameLoose = async (face: LooseFace) => {
    const value = await ask();
    if (!value) return;
    setBusy(true);
    try {
      const url = await getDisplayUrl(face.photoId);
      const file = url ? await faceFile(face, url) : null;
      if (!file) { setNotice(tr('lx.people.failed')); return; }
      const result = await addPerson(value, [file]);
      if (result.ok) {
        rememberPersonFace(value, face);
        setNotice(tr('lx.people.named', { name: value }));
      } else {
        setNotice(result.message);
      }
    } finally { setBusy(false); setRefresh(n => n + 1); }
  };

  if (!people.length && !unknown.length && !loose.length) return <p className="lx-empty small">{tr('lx.brain.peopleNone')}</p>;

  return (
    <>
      <div className="lx-faces">
        {people.map(p => (
          <button key={p.name} className="lx-face" onClick={() => onOpen?.(p.name)} disabled={!onOpen}>
            <FaceCropThumb photoId={p.photoId} box={p.box} size={72} className="lx-face-img" />
            <b>{p.name}</b>
            <span>{tr('lx.brain.photos', { count: p.photoIds.length })}</span>
          </button>
        ))}
        {unknown.map((c, i) => (
          <button key={`c-${c.members[0].photoId}-${i}`} className="lx-face unknown" disabled={busy} onClick={() => void nameCluster(c)}>
            <FaceCropThumb photoId={c.members[0].photoId} box={c.members[0].box} size={72} className="lx-face-img" />
            <b>{tr('lx.brain.whoIs')}</b>
            <span>{tr('lx.brain.photos', { count: c.members.length })}</span>
          </button>
        ))}
        {loose.map(f => (
          <button key={`l-${f.photoId}`} className="lx-face unknown" disabled={busy} onClick={() => void nameLoose(f)}>
            <FaceCropThumb photoId={f.photoId} box={f.box} size={72} className="lx-face-img" />
            <b>{tr('lx.brain.whoIs')}</b>
          </button>
        ))}
      </div>
      {(unknown.length > 0 || loose.length > 0) && <p className="lx-hint">{tr(loose.length ? 'lx.people.looseHint' : 'lx.brain.peopleHint')}</p>}
    </>
  );
}
