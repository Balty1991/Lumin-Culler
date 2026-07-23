import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { UserCheckIcon, TrashIcon, XIcon } from './icons';

/** Inrolare persoane cunoscute (ex. Ami, sotia): nume + 1-4 poze de referinta. */
export function PersonsPanel() {
  const open = useStore(s => s.personsOpen);
  const setOpen = useStore(s => s.setPersonsOpen);
  const persons = useStore(s => s.persons);
  const addPerson = useStore(s => s.addPerson);
  const removePerson = useStore(s => s.removePerson);
  const clearAllIncludingPersons = useStore(s => s.clearAllIncludingPersons);

  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  if (!open) return null;

  const confirmRemove = (id: string, personName: string) => {
    if (window.confirm(`Ștergi "${personName}" din persoanele cunoscute? Va trebui reînrolat(ă) pentru ca AI-ul să o mai recunoască.`)) {
      void removePerson(id);
    }
  };

  const confirmClearEverything = () => {
    if (!window.confirm(
      'Sigur ștergi ABSOLUT TOT? Se șterg ireversibil toate pozele, persoanele cunoscute ' +
      '(amprentele faciale) și tot ce a învățat AI-ul din corecțiile tale. Nu poate fi anulat.'
    )) return;
    if (!window.confirm('Ultima confirmare: chiar tot, inclusiv persoanele inrolate?')) return;
    void clearAllIncludingPersons();
    setOpen(false);
  };

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
      <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label="Persoane cunoscute" tabIndex={-1}>
        <header className="detail-head">
          <span><UserCheckIcon className="inline-icon" /> Persoane cunoscute</span>
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
              <span><UserCheckIcon className="inline-icon" /> {p.name} <em className="mono">({p.embeddings.length} referinte)</em></span>
              <button className="ghost icon-btn" onClick={() => confirmRemove(p.id, p.name)} aria-label={`Sterge ${p.name}`}>
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
          <p className="hint">
            Un nume deja folosit adauga referinte noi la profilul existent (nu creeaza un
            duplicat) — util pentru reinrolare periodica, ex. un copil ale carui trasaturi se schimba.
          </p>
          <button className="select" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Se proceseaza…' : 'Inroleaza persoana'}
          </button>
          {message && <p className="hint">{message}</p>}
        </div>

        <div className="danger-zone">
          <p className="hint">
            Toate datele (poze, persoane, model AI) raman 100% locale, pe acest dispozitiv —
            nimic nu e trimis vreodata pe internet. Pentru stergere completa, inclusiv
            amprentele faciale ale persoanelor inrolate:
          </p>
          <button className="ghost small danger" onClick={confirmClearEverything}>
            <TrashIcon className="inline-icon" /> Sterge tot, inclusiv persoanele si modelul AI
          </button>
        </div>
      </div>
    </div>
  );
}
