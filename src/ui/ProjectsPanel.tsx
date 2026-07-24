import { useMemo, useRef, useState } from 'react';
import { useStore, NO_PROJECT_KEY } from '../state/store';
import { computeProjectStats } from '../core/stats';
import { getProjectMetadata, setProjectMetadata, type ProjectMetadata } from '../state/projectMetadata';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, LayersIcon, FilterDotIcon } from './icons';
import { t, type Locale } from '../i18n';

function formatDate(ts: number | undefined, locale: Locale): string {
  const intlLocale = locale === 'en' ? 'en-US' : 'ro-RO';
  return ts ? new Date(ts).toLocaleDateString(intlLocale, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

/**
 * Metadate personalizate de proiect (plan 2.3.5): client, tip eveniment, locatie —
 * salvate per nume de proiect (state/projectMetadata.ts), incluse apoi in exportul
 * XMP (locatia ca photoshop:Location, camp standard vazut de Lightroom). Editare
 * inline, fara modal separat — sunt doar 3 campuri text, opuse complexitatii.
 */
function ProjectMetaEditor({ project }: { project: string }) {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
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
        className="mono" placeholder={tr('projects.meta.client')} title={tr('projects.meta.client.title')}
        value={meta.client ?? ''} onChange={e => setMeta(m => ({ ...m, client: e.target.value }))}
      />
      <input
        className="mono" placeholder={tr('projects.meta.event')} title={tr('projects.meta.event.title')}
        value={meta.event ?? ''} onChange={e => setMeta(m => ({ ...m, event: e.target.value }))}
      />
      <input
        className="mono" placeholder={tr('projects.meta.location')} title={tr('projects.meta.location.title')}
        value={meta.location ?? ''} onChange={e => setMeta(m => ({ ...m, location: e.target.value }))}
      />
      <button className="ghost small" onClick={save}>{saved ? tr('projects.meta.saved') : tr('projects.meta.save')}</button>
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
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
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
      <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('menu.projects')} tabIndex={-1}>
        <header className="detail-head">
          <span><LayersIcon className="inline-icon" /> {tr('menu.projects')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        {projectFilter && (
          <button className="ghost small" onClick={() => applyFilter(null)}>
            <FilterDotIcon className="inline-icon" /> {tr('projects.clearFilter')}
          </button>
        )}

        {projects.length === 0 && <p className="hint">{tr('projects.empty')}</p>}

        <ul className="insights">
          {projects.map(p => (
            <li key={p.key} className="insight">
              <div className="insight-head">
                <b>{p.label}</b>
                <span className="mono confidence-tag">{tr('projects.photoCount', { count: p.total })}</span>
              </div>
              <p className="hint">
                {tr('projects.summary', {
                  from: formatDate(p.firstCapturedAt, locale),
                  to: formatDate(p.lastCapturedAt, locale),
                  selected: p.selected, rejected: p.rejected, review: p.review
                })}
              </p>
              {p.key !== NO_PROJECT_KEY && <ProjectMetaEditor project={p.key} />}
              <div className="insight-actions">
                <button
                  className="ghost small"
                  onClick={() => applyFilter(p.key)}
                  disabled={projectFilter === p.key}
                >
                  {projectFilter === p.key ? tr('projects.filterActive') : tr('projects.showOnly')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
