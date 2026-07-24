import { useMemo, useRef, useState } from 'react';
import { useStore, NO_PROJECT_KEY } from '../state/store';
import { computeProjectStats } from '../core/stats';
import { getProjectMetadata, setProjectMetadata, type ProjectMetadata } from '../state/projectMetadata';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, LayersIcon, FilterDotIcon } from './icons';

function formatDate(ts?: number): string {
  return ts ? new Date(ts).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

/**
 * Metadate personalizate de proiect (plan 2.3.5): client, tip eveniment, locatie —
 * salvate per nume de proiect (state/projectMetadata.ts), incluse apoi in exportul
 * XMP (locatia ca photoshop:Location, camp standard vazut de Lightroom). Editare
 * inline, fara modal separat — sunt doar 3 campuri text, opuse complexitatii.
 */
function ProjectMetaEditor({ project }: { project: string }) {
  const [meta, setMeta] = useState<ProjectMetadata>(() => getProjectMetadata(project));
  const [saved, setSaved] = useState(false);

  const save = () => {
    setProjectMetadata(project, meta);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="project-meta-form">
      <input
        className="mono" placeholder="Client" title="Client (ex. Ana & Mihai)"
        value={meta.client ?? ''} onChange={e => setMeta(m => ({ ...m, client: e.target.value }))}
      />
      <input
        className="mono" placeholder="Eveniment" title="Eveniment (ex. Nunta)"
        value={meta.event ?? ''} onChange={e => setMeta(m => ({ ...m, event: e.target.value }))}
      />
      <input
        className="mono" placeholder="Locatie" title="Locatie (ex. Brasov)"
        value={meta.location ?? ''} onChange={e => setMeta(m => ({ ...m, location: e.target.value }))}
      />
      <button className="ghost small" onClick={save}>{saved ? 'Salvat' : 'Salveaza metadate'}</button>
    </div>
  );
}

/**
 * "Modulul Proiecte" (plan 3.2.3): fiecare poza retine numele proiectului activ la
 * import (ProjectNameField din antet) — acest panou agrega biblioteca dupa acel
 * camp si iti permite sa treci direct la o singura sesiune/eveniment, fara sa
 * cauti manual dupa data sau nume de fisier.
 */
export function ProjectsPanel() {
  const open = useStore(s => s.projectsOpen);
  const setOpen = useStore(s => s.setProjectsOpen);
  const photos = useStore(s => s.photos);
  const projectFilter = useStore(s => s.projectFilter);
  const setProjectFilter = useStore(s => s.setProjectFilter);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  const projects = useMemo(() => computeProjectStats(photos, NO_PROJECT_KEY), [photos]);

  if (!open) return null;

  const applyFilter = (key: string | null) => {
    setProjectFilter(key);
    setOpen(false);
  };

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label="Proiecte" tabIndex={-1}>
        <header className="detail-head">
          <span><LayersIcon className="inline-icon" /> Proiecte</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label="Inchide">
            <XIcon />
          </button>
        </header>

        {projectFilter && (
          <button className="ghost small" onClick={() => applyFilter(null)}>
            <FilterDotIcon className="inline-icon" /> Elimina filtrul de proiect curent
          </button>
        )}

        {projects.length === 0 && <p className="hint">Nicio poza importata inca.</p>}

        <ul className="insights">
          {projects.map(p => (
            <li key={p.key} className="insight">
              <div className="insight-head">
                <b>{p.label}</b>
                <span className="mono confidence-tag">{p.total} poze</span>
              </div>
              <p className="hint">
                {formatDate(p.firstCapturedAt)} – {formatDate(p.lastCapturedAt)} ·{' '}
                {p.selected} selectate · {p.rejected} respinse · {p.review} de verificat
              </p>
              {p.key !== NO_PROJECT_KEY && <ProjectMetaEditor project={p.key} />}
              <div className="insight-actions">
                <button
                  className="ghost small"
                  onClick={() => applyFilter(p.key)}
                  disabled={projectFilter === p.key}
                >
                  {projectFilter === p.key ? 'Filtru activ' : 'Arata doar acest proiect'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
