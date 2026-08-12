import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../core/db';
import { useStore } from '../state/store';
import { selectUnresolvedGroups } from '../state/duplicateGroups';
import { useModalFocusTrap } from './useModalFocusTrap';
import { AdjustedImage } from './AdjustedImage';
import { CopyIcon, XIcon, RibbonIcon } from './icons';
import { t, plural } from '../i18n';

function DupThumb({ photoId }: { photoId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    void db.thumbnails.get(photoId).then(rec => { if (rec && alive) { url = URL.createObjectURL(rec.blob); setSrc(url); } });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [photoId]);
  return src ? <AdjustedImage src={src} alt="" loading="lazy" /> : <span className="memory-thumb-loading" aria-hidden="true" />;
}

/**
 * "Duplicate gasite oriunde" (plan modernizare, ecran m-cross din mockup) —
 * NU un detector nou: gruparea dHash existenta (core/importPipeline.ts,
 * hashCompare.worker.ts) compara deja fiecare import cu TOATA biblioteca
 * negrupata, indiferent de sursa/data — exact scenariul din mockup (aceeasi
 * poza reimportata din WhatsApp si din Camera ajunge in acelasi groupId).
 * Ce lipsea era o LISTA a acestor grupuri inca nerezolvate, dintr-un singur
 * loc (pana acum erau accesibile doar unul cate unul, din filtrul "Serii" al
 * grilei) — vezi GroupCompare.tsx pentru comparatia detaliata la care
 * "Compara" de mai jos duce.
 */
export function DuplicatesPanel() {
  const open = useStore(s => s.duplicatesPanelOpen);
  const setOpen = useStore(s => s.setDuplicatesPanelOpen);
  const photos = useStore(s => s.photos);
  const openCompare = useStore(s => s.openCompare);
  const keepOnlyInGroup = useStore(s => s.keepOnlyInGroup);
  const selectBestPhotoInGroup = useStore(s => s.selectBestPhotoInGroup);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);
  const [recommended, setRecommended] = useState<Record<string, string | null>>({});
  const [busyGroup, setBusyGroup] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const groups = useMemo(() => selectUnresolvedGroups(photos), [photos]);

  useEffect(() => {
    if (!open || !groups.length) { setRecommended({}); return; }
    let alive = true;
    void Promise.all(groups.map(async ([groupId]) => [groupId, await selectBestPhotoInGroup(groupId)] as const))
      .then(pairs => { if (alive) setRecommended(Object.fromEntries(pairs)); });
    return () => { alive = false; };
  }, [open, groups, selectBestPhotoInGroup]);

  if (!open) return null;

  const resolve = async (groupId: string) => {
    const keepId = recommended[groupId];
    if (!keepId || busyGroup) return;
    setBusyGroup(groupId);
    try { await keepOnlyInGroup(groupId, keepId); } finally { setBusyGroup(null); }
  };

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow duplicates-panel" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('duplicates.title')} tabIndex={-1}>
        <header className="detail-head">
          <span><CopyIcon className="inline-icon" aria-hidden="true" /> {tr('duplicates.title')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        {groups.length === 0 ? (
          <p className="hint">{tr('duplicates.empty')}</p>
        ) : (
          <>
            <p className="hint">{tr(plural(groups.length, 'duplicates.count.one', 'duplicates.count.other'), { count: groups.length })}</p>
            <div className="duplicates-list">
              {groups.map(([groupId, members]) => {
                const keepId = recommended[groupId];
                return (
                  <div key={groupId} className="duplicates-group glass">
                    <div className="duplicates-pair">
                      {members.slice(0, 2).map(m => (
                        <span key={m.id} className="duplicates-thumb">
                          <DupThumb photoId={m.id} />
                          {m.id === keepId && <b className="duplicates-best" title={tr('duplicates.best')}><RibbonIcon /></b>}
                        </span>
                      ))}
                    </div>
                    <div className="duplicates-group-info">
                      <span className="mono">{tr(plural(members.length, 'duplicates.members.one', 'duplicates.members.other'), { count: members.length })}</span>
                      <div className="duplicates-group-actions">
                        <button className="ghost small" onClick={() => { setOpen(false); openCompare(groupId); }}>{tr('duplicates.compare')}</button>
                        <button className="btn-accent" disabled={!keepId || busyGroup === groupId} onClick={() => void resolve(groupId)}>
                          {tr('duplicates.keepBest')}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
