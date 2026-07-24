import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { db } from '../core/db';
import { computePersonRecognitionStats, type PersonRecognitionStats } from '../core/stats';
import { useModalFocusTrap } from './useModalFocusTrap';
import { UserCheckIcon, TrashIcon, XIcon, DownloadIcon, UploadIcon, LayersIcon } from './icons';

/** Inrolare persoane cunoscute (ex. Ami, sotia): nume + 1-4 poze de referinta. */
export function PersonsPanel() {
  const open = useStore(s => s.personsOpen);
  const setOpen = useStore(s => s.setPersonsOpen);
  const persons = useStore(s => s.persons);
  const addPerson = useStore(s => s.addPerson);
  const removePerson = useStore(s => s.removePerson);
  const removePersons = useStore(s => s.removePersons);
  const mergePersons = useStore(s => s.mergePersons);
  const exportPersonProfiles = useStore(s => s.exportPersonProfiles);
  const importPersonProfiles = useStore(s => s.importPersonProfiles);
  const clearAllIncludingPersons = useStore(s => s.clearAllIncludingPersons);

  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [recognitionStats, setRecognitionStats] = useState<Map<string, PersonRecognitionStats> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  useEffect(() => {
    if (!open) { setSelected(new Set()); setRecognitionStats(null); return; }
    let alive = true;
    void db.analyses.toArray().then(rows => { if (alive) setRecognitionStats(computePersonRecognitionStats(rows)); });
    return () => { alive = false; };
  }, [open]);

  if (!open) return null;

  const toggleSelected = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const confirmRemove = (id: string, personName: string) => {
    if (window.confirm(`Ștergi "${personName}" din persoanele cunoscute? Va trebui reînrolat(ă) pentru ca AI-ul să o mai recunoască.`)) {
      void removePerson(id);
    }
  };

  const confirmBulkDelete = () => {
    const names = persons.filter(p => selected.has(p.id)).map(p => p.name).join(', ');
    if (window.confirm(`Ștergi ${selected.size} persoane (${names})? Vor trebui reînrolate pentru ca AI-ul să le mai recunoască.`)) {
      void removePersons(Array.from(selected)).then(() => setSelected(new Set()));
    }
  };

  const runMerge = () => {
    const chosen = persons.filter(p => selected.has(p.id));
    if (chosen.length < 2) return;
    const keepName = window.prompt(
      `Unești ${chosen.length} profiluri (${chosen.map(p => p.name).join(', ')}) într-unul singur. Ce nume păstrezi?`,
      chosen[0].name
    );
    if (!keepName?.trim()) return;
    void mergePersons(Array.from(selected), keepName).then(() => setSelected(new Set()));
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
          {persons.map(p => {
            const stats = recognitionStats?.get(p.id);
            return (
              <li key={p.id}>
                <label className="person-select-row">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggleSelected(p.id)}
                    aria-label={`Selecteaza ${p.name}`}
                  />
                  <span>
                    <UserCheckIcon className="inline-icon" /> {p.name}{' '}
                    <em className="mono">
                      ({p.embeddings.length} referinte
                      {stats ? ` · recunoscuta in ${stats.matchCount} ${stats.matchCount === 1 ? 'fata' : 'fete'}, incredere medie ${Math.round(stats.avgSimilarity * 100)}%` : ''})
                    </em>
                  </span>
                </label>
                <button className="ghost icon-btn" onClick={() => confirmRemove(p.id, p.name)} aria-label={`Sterge ${p.name}`}>
                  <TrashIcon />
                </button>
              </li>
            );
          })}
        </ul>

        {selected.size > 0 && (
          <div className="persons-bulk-actions">
            <span className="hint">{selected.size} selectate</span>
            <button className="ghost small" onClick={() => void exportPersonProfiles(Array.from(selected))}>
              <DownloadIcon className="inline-icon" /> Exporta selectia
            </button>
            {selected.size >= 2 && (
              <button className="ghost small" onClick={runMerge}>
                <LayersIcon className="inline-icon" /> Uneste in una
              </button>
            )}
            <button className="ghost small danger" onClick={confirmBulkDelete}>
              <TrashIcon className="inline-icon" /> Sterge selectia
            </button>
          </div>
        )}

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

        {persons.length > 0 && (
          <div className="persons-transfer">
            <button className="ghost small" onClick={() => void exportPersonProfiles(persons.map(p => p.id))}>
              <DownloadIcon className="inline-icon" /> Exporta toate profilurile
            </button>
            <button className="ghost small" onClick={() => importRef.current?.click()}>
              <UploadIcon className="inline-icon" /> Importa profiluri
            </button>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void importPersonProfiles(file);
              }}
            />
          </div>
        )}

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
