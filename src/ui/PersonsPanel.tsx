import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { StarIcon, TrashIcon, XIcon } from './icons';

/** Inrolare persoane cunoscute (ex. Ami, sotia): nume + 1-4 poze de referinta. */
export function PersonsPanel() {
  const open = useStore(s => s.personsOpen);
  const setOpen = useStore(s => s.setPersonsOpen);
  const persons = useStore(s => s.persons);
  const addPerson = useStore(s => s.addPerson);
  const removePerson = useStore(s => s.removePerson);

  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const submit = async () => {
    const files = Array.from(fileRef.current?.files ?? []);
    if (!name.trim() || !files.length) {
      setMessage('Completeaza numele si alege cel putin o poza de referinta.');
      return;
    }
    setBusy(true);
    setMessage('Se calculeaza amprentele faciale…');
    const result = await addPerson(name.trim(), files);
    setMessage(result.message);
    setBusy(false);
    if (result.ok) { setName(''); if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow">
        <header className="detail-head">
          <span><StarIcon className="inline-icon" /> Persoane cunoscute</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label="Inchide">
            <XIcon />
          </button>
        </header>

        {persons.length === 0 && (
          <p className="hint">Nicio persoana inrolata. Adauga-i pe cei dragi (ex. Ami) cu cateva
          poze clare, frontale — AI-ul ii va recunoaste si va separa strainii automat.</p>
        )}

        <ul className="persons">
          {persons.map(p => (
            <li key={p.id}>
              <span><StarIcon className="inline-icon" /> {p.name} <em className="mono">({p.embeddings.length} referinte)</em></span>
              <button className="ghost icon-btn" onClick={() => void removePerson(p.id)} aria-label={`Sterge ${p.name}`}>
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>

        <div className="enroll">
          <input
            type="text"
            placeholder="Nume (ex. Ami)"
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={busy}
          />
          <input ref={fileRef} type="file" accept="image/*" multiple disabled={busy} />
          <button className="select" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Se proceseaza…' : 'Inroleaza persoana'}
          </button>
          {message && <p className="hint">{message}</p>}
        </div>
      </div>
    </div>
  );
}
