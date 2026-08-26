import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { db } from '../core/db';
import { computePersonRecognitionStats, type PersonRecognitionStats } from '../core/stats';
import { findUnrecognizedFaceClusters, type FaceCluster } from '../core/faceClustering';
import { useModalFocusTrap } from './useModalFocusTrap';
import { FaceCropThumb } from './FaceCropThumb';
import { UserCheckIcon, TrashIcon, XIcon, DownloadIcon, UploadIcon, LayersIcon, SparkleIcon, ShieldIcon } from './icons';
import { t, plural } from '../i18n';

/** Inrolare persoane cunoscute (ex. Ami, sotia): nume + 1-4 poze de referinta. */
export function PersonsPanel() {
  const open = useStore(s => s.personsOpen);
  const protectedPersons = useStore(s => s.protectedPersons);
  const toggleProtectedPerson = useStore(s => s.toggleProtectedPerson);
  const setOpen = useStore(s => s.setPersonsOpen);
  const persons = useStore(s => s.persons);
  const addPerson = useStore(s => s.addPerson);
  const removePerson = useStore(s => s.removePerson);
  const removePersons = useStore(s => s.removePersons);
  const mergePersons = useStore(s => s.mergePersons);
  const exportPersonProfiles = useStore(s => s.exportPersonProfiles);
  const importPersonProfiles = useStore(s => s.importPersonProfiles);
  const enrollFaceCluster = useStore(s => s.enrollFaceCluster);
  const askConfirm = useStore(s => s.askConfirm);
  const askPrompt = useStore(s => s.askPrompt);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [recognitionStats, setRecognitionStats] = useState<Map<string, PersonRecognitionStats> | null>(null);
  const [clusters, setClusters] = useState<FaceCluster[] | null>(null);
  const [scanningClusters, setScanningClusters] = useState(false);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  // Escape-to-close — vezi acelasi tipar in EditPanel.tsx/MenuDrawer.tsx (bug
  // real gasit de auditul QA: acest panou nu avea niciunul).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) { setSelected(new Set()); setRecognitionStats(null); setClusters(null); return; }
    let alive = true;
    void db.analyses.toArray().then(rows => { if (alive) setRecognitionStats(computePersonRecognitionStats(rows)); });
    return () => { alive = false; };
  }, [open]);

  if (!open) return null;

  const scanForClusters = async () => {
    setScanningClusters(true);
    const [photos, analyses] = await Promise.all([db.photos.toArray(), db.analyses.toArray()]);
    const byId = new Map(analyses.map(a => [a.photoId, a]));
    const clusterable = photos
      .map(p => ({ id: p.id, fileName: p.fileName, faces: byId.get(p.id)?.faces ?? [] }))
      .filter(p => p.faces.length > 0);
    setClusters(findUnrecognizedFaceClusters(clusterable).slice(0, 8));
    setScanningClusters(false);
  };

  const enrollCluster = async (cluster: FaceCluster) => {
    const newName = await askPrompt(tr('persons.enrollCluster.prompt', { count: cluster.members.length }));
    if (!newName?.trim()) return;
    void enrollFaceCluster(newName, cluster.members).then(() => {
      setClusters(prev => prev?.filter(c => c !== cluster) ?? null);
    });
  };

  const toggleSelected = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const confirmRemove = async (id: string, personName: string) => {
    if (await askConfirm(tr('persons.confirmRemove', { name: personName }), { danger: true })) {
      void removePerson(id);
    }
  };

  const confirmBulkDelete = async () => {
    const names = persons.filter(p => selected.has(p.id)).map(p => p.name).join(', ');
    if (await askConfirm(tr('persons.confirmBulkDelete', { count: selected.size, names }), { danger: true })) {
      void removePersons(Array.from(selected)).then(() => setSelected(new Set()));
    }
  };

  const runMerge = async () => {
    const chosen = persons.filter(p => selected.has(p.id));
    if (chosen.length < 2) return;
    const keepName = await askPrompt(
      tr('persons.mergePrompt', { count: chosen.length, names: chosen.map(p => p.name).join(', ') }),
      chosen[0].name
    );
    if (!keepName?.trim()) return;
    void mergePersons(Array.from(selected), keepName).then(() => setSelected(new Set()));
  };

  const submit = async () => {
    const files = Array.from(fileRef.current?.files ?? []);
    if (!name.trim() || !files.length) {
      setMessage(tr('persons.validation.missingNameOrFiles'));
      return;
    }
    setBusy(true);
    setMessage(tr('persons.computingEmbeddings'));
    const result = await addPerson(name.trim(), files);
    setMessage(result.message);
    setBusy(false);
    if (result.ok) { setName(''); setFileNames([]); if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('persons.ariaLabel')} tabIndex={-1}>
        <header className="detail-head">
          <span><UserCheckIcon className="inline-icon" /> {tr('persons.ariaLabel')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        {/* Panoul amesteca trei intrebari diferite intr-o singura lista lunga:
            "cine e deja inrolat", "gaseste-mi tu pe cineva" si "adaug eu pe
            cineva" — plus, la coada, un buton care sterge TOATA aplicatia.
            Confirmat de doua audituri independente. Acum fiecare intrebare are
            titlul ei, in ordinea in care si-o pune omul, iar stergerea totala a
            plecat de aici cu totul (vezi MenuDrawer.tsx, sectiunea Setari):
            n-avea ce cauta la un deget distanta de "Inroleaza". */}
        <h4 className="persons-section-head">{tr('persons.section.enrolled')}</h4>

        {persons.length === 0 && (
          <p className="hint">{tr('persons.empty')}</p>
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
                    aria-label={tr('persons.selectAriaLabel', { name: p.name })}
                  />
                  <span>
                    <UserCheckIcon className="inline-icon" /> {p.name}{' '}
                    <em className="mono">
                      ({tr(plural(p.embeddings.length, 'persons.refCount.one', 'persons.refCount'), { count: p.embeddings.length })}
                      {stats ? tr('persons.statsSuffix', {
                        count: stats.matchCount,
                        faceWord: plural(stats.matchCount, tr('persons.faceWord.one'), tr('persons.faceWord.other')),
                        percent: Math.round(stats.avgSimilarity * 100)
                      }) : ''})
                    </em>
                  </span>
                </label>
                {/* Protectia e fata de AUTOMATIZARE, nu fata de utilizator: el
                    poate respinge oricand manual o poza cu persoana protejata.
                    Vezi state/protectedPersons.ts. */}
                <button
                  className={protectedPersons.has(p.name) ? 'ghost small person-protect on' : 'ghost small person-protect'}
                  aria-pressed={protectedPersons.has(p.name)}
                  onClick={() => toggleProtectedPerson(p.name)}
                  title={tr('persons.protect.title')}
                >
                  <ShieldIcon className="inline-icon" aria-hidden="true" />
                  {protectedPersons.has(p.name) ? tr('persons.protect.on') : tr('persons.protect.off')}
                </button>
                <button className="ghost icon-btn" onClick={() => confirmRemove(p.id, p.name)} aria-label={tr('persons.deleteAriaLabel', { name: p.name })}>
                  <TrashIcon />
                </button>
              </li>
            );
          })}
        </ul>

        {selected.size > 0 && (
          <div className="persons-bulk-actions">
            <span className="hint">{tr('persons.selectedCount', { count: selected.size })}</span>
            <button className="ghost small" onClick={() => void exportPersonProfiles(Array.from(selected))}>
              <DownloadIcon className="inline-icon" /> {tr('persons.exportSelection')}
            </button>
            {selected.size >= 2 && (
              <button className="ghost small" onClick={runMerge}>
                <LayersIcon className="inline-icon" /> {tr('persons.mergeSelection')}
              </button>
            )}
            <button className="ghost small danger" onClick={confirmBulkDelete}>
              <TrashIcon className="inline-icon" /> {tr('persons.deleteSelection')}
            </button>
          </div>
        )}

        <h4 className="persons-section-head">{tr('persons.section.discover')}</h4>
        <p className="hint persons-section-sub">{tr('persons.section.discover.sub')}</p>

        <div className="face-suggestions">
          <div className="face-suggestions-head">
            <span className="hint">
              <SparkleIcon className="inline-icon" /> {tr('persons.aiSuggestions')}
            </span>
            <button className="ghost small" onClick={() => void scanForClusters()} disabled={scanningClusters}>
              {scanningClusters ? <><SparkleIcon className="inline-icon spin" /> {tr('persons.scanning')}</> : tr('persons.scanForClusters')}
            </button>
          </div>
          {clusters !== null && clusters.length === 0 && (
            <p className="hint">{tr('persons.noClustersFound')}</p>
          )}
          {clusters && clusters.length > 0 && (
            <ul className="face-cluster-list">
              {clusters.map((c, i) => (
                <li key={i} className="face-cluster-row">
                  <FaceCropThumb photoId={c.members[0].photoId} box={c.members[0].box} />
                  <span className="hint">{tr('persons.clusterAppearance', { count: c.members.length, fileName: c.members[0].fileName })}</span>
                  <button className="ghost small" onClick={() => enrollCluster(c)}>
                    <UserCheckIcon className="inline-icon" /> {tr('persons.enrollCluster')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <h4 className="persons-section-head">{tr('persons.section.manual')}</h4>
        <p className="hint persons-section-sub">{tr('persons.section.manual.sub')}</p>

        <div className="enroll">
          <input
            type="text"
            placeholder={tr('persons.namePlaceholder')}
            aria-label={tr('persons.namePlaceholder')}
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={busy}
          />
          <input
            ref={fileRef} type="file" accept="image/*" multiple disabled={busy} hidden
            aria-label={tr('persons.filesAriaLabel')}
            onChange={e => setFileNames(Array.from(e.target.files ?? []).map(f => f.name))}
          />
          <button type="button" className="ghost small" disabled={busy} onClick={() => fileRef.current?.click()}>
            <UploadIcon className="inline-icon" /> {fileNames.length > 0 ? tr('persons.filesChosen', { count: fileNames.length }) : tr('persons.chooseFiles')}
          </button>
          <p className="hint">
            {tr('persons.reenrollHint')}
          </p>
          {/* eticheta se schimba deja; lipsea doar aria-busy, care spune explicit
              "asteapta, lucreaza" in loc de "dezactivat, indisponibil". */}
          <button className="select" onClick={() => void submit()} disabled={busy} aria-busy={busy}>
            {busy ? <><SparkleIcon className="inline-icon spin" /> {tr('workspace.progress.processing')}</> : tr('persons.enroll')}
          </button>
          {/* role="status" + aria-live — bug real gasit de auditul UI: acesta e
              SINGURUL raspuns pe care il primeste utilizatorul dupa inrolare
              ("se calculeaza amprentele", "adaugat", "nu s-a detectat nicio
              fata in pozele alese"), si aparea doar vizual. Cu un cititor de
              ecran, apasarea pe "Inroleaza" parea ca nu face nimic, inclusiv
              atunci cand esuase. `aria-live` sta pe elementul PERMANENT (nu pe
              cel conditionat), altfel prima aparitie a mesajului nu se anunta —
              regiunea trebuie sa existe in DOM inainte sa i se schimbe textul. */}
          <p className="hint" role="status" aria-live="polite">
            {message && <>{busy && <SparkleIcon className="inline-icon spin" />} {message}</>}
          </p>
        </div>

        {persons.length > 0 && (
          <div className="persons-transfer">
            <button className="ghost small" onClick={() => void exportPersonProfiles(persons.map(p => p.id))}>
              <DownloadIcon className="inline-icon" /> {tr('persons.exportAll')}
            </button>
            <button className="ghost small" onClick={() => importRef.current?.click()}>
              <UploadIcon className="inline-icon" /> {tr('persons.importProfiles')}
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

        <p className="hint persons-local-note">{tr('persons.localDataHint')}</p>
      </div>
    </div>
  );
}
