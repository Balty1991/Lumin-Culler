import { useMemo, useRef } from 'react';
import { useStore, NO_PROJECT_KEY } from '../state/store';
import { computeProjectStats } from '../core/stats';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, LayersIcon, FilterDotIcon } from './icons';

function formatDate(ts?: number): string {
  return ts ? new Date(ts).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
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
