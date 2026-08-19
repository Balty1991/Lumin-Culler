import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { db } from '../core/db';
import { buildSmartInbox, type InboxCandidate, type InboxGroup } from '../core/smartInbox';
import { useModalFocusTrap } from './useModalFocusTrap';
import { AdjustedImage } from './AdjustedImage';
import { CopyIcon, XIcon } from './icons';
import { t, plural } from '../i18n';

function InboxThumb({ photoId }: { photoId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    void db.thumbnails.get(photoId).then(rec => {
      if (rec && alive) { url = URL.createObjectURL(rec.blob); setSrc(url); }
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [photoId]);
  return src ? <AdjustedImage className="inbox-thumb" src={src} alt="" /> : <span className="inbox-thumb empty" />;
}

/**
 * Ce nu e amintire: capturi de ecran si documente.
 *
 * Ecranul NU sterge nimic si nu decide nimic — separa, ca sa nu mai ceara
 * decizie cadru cu cadru pentru lucruri pe care nimeni nu le judeca dupa
 * claritate. Stergerea automata a unei capturi ar fi exact gestul care
 * distruge increderea: uneori captura aia e lucrul important.
 *
 * Actiunile sunt ambele reversibile: respinge tot grupul (se poate anula cu
 * Ctrl+Z, ca orice operatie in masa) sau pune-le intr-un folder si lasa-le in
 * pace.
 */
export function SmartInboxPanel() {
  const open = useStore(s => s.smartInboxOpen);
  const setOpen = useStore(s => s.setSmartInboxOpen);
  const photos = useStore(s => s.photos);
  const setFilter = useStore(s => s.setFilter);
  const setMultiSelected = useStore(s => s.setMultiSelected);
  const clearMultiSelect = useStore(s => s.clearMultiSelect);
  const setSelectMode = useStore(s => s.setSelectMode);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  const [groups, setGroups] = useState<InboxGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const byId = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    void Promise.all(photos.map(p => db.analyses.get(p.id))).then(analyses => {
      if (!alive) return;
      const input: InboxCandidate[] = photos.map((p, i) => ({
        id: p.id,
        fileName: p.fileName,
        faceCount: p.faceCount,
        textCoverage: p.textCoverage,
        sceneTags: analyses[i]?.sceneTags
        // Fara latime/inaltime: proportia de ecran e semnalul cel mai slab din
        // clasificare (multe poze verticale au aceeasi proportie) si sta in
        // PhotoRecord, deci ar cere inca o citire din baza de date pentru
        // fiecare poza. Numele fisierului si acoperirea cu text decid oricum.
      }));
      setGroups(buildSmartInbox(input));
      setLoading(false);
    });
    return () => { alive = false; };
  }, [open, photos]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  /** Trece grupul in selectia multipla si duce utilizatorul in grila, unde poate decide singur ce face cu el. */
  const reviewGroup = (ids: string[]) => {
    clearMultiSelect();
    setFilter('all');
    setSelectMode(true);
    for (const id of ids) setMultiSelected(id, true);
    setOpen(false);
  };

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('inbox.title')} tabIndex={-1}>
        <header className="detail-head">
          <span><CopyIcon className="inline-icon" aria-hidden="true" /> {tr('inbox.title')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        <p className="hint">{tr('inbox.hint')}</p>

        {loading ? (
          <p className="hint" role="status">{tr('workspace.progress.processing')}</p>
        ) : groups.length === 0 ? (
          <p className="hint">{tr('inbox.empty')}</p>
        ) : (
          groups.map(group => (
            <div key={group.category} className="batch-section inbox-group">
              <h3>{tr(`inbox.category.${group.category}`)}</h3>
              <p className="hint">
                {tr(plural(group.ids.length, 'inbox.count.one', 'inbox.count.other'), { count: group.ids.length })}
              </p>
              <div className="inbox-strip">
                {group.ids.slice(0, 12).map(id => (
                  byId.has(id) ? <InboxThumb key={id} photoId={id} /> : null
                ))}
                {group.ids.length > 12 && (
                  <span className="inbox-more mono">+{group.ids.length - 12}</span>
                )}
              </div>
              <button className="ghost small" onClick={() => reviewGroup(group.ids)}>
                {tr('inbox.review')}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
