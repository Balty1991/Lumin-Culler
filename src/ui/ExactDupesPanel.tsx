import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { db } from '../core/db';
import {
  findExactDuplicates, summariseDuplicates, allDuplicateIds,
  type DuplicateCandidate, type DuplicateSet
} from '../core/exactDuplicates';
import { formatSize } from '../state/storageStats';
import { useModalFocusTrap } from './useModalFocusTrap';
import { AdjustedImage } from './AdjustedImage';
import { CopyIcon, XIcon, CheckIcon } from './icons';
import { t, plural } from '../i18n';

function DupeThumb({ photoId, keep }: { photoId: string; keep?: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    void db.thumbnails.get(photoId).then(rec => {
      if (rec && alive) { url = URL.createObjectURL(rec.blob); setSrc(url); }
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [photoId]);
  const cls = 'dupe-thumb' + (keep ? ' keep' : '');
  return src ? <AdjustedImage className={cls} src={src} alt="" /> : <span className={cls + ' empty'} />;
}

/**
 * Copiile identice ale aceleiasi poze.
 *
 * Panoul "Duplicate gasite" arata cadre ASEMANATOARE — rafale, poze la o
 * secunda distanta — unde fiecare cadru e altul si alegerea chiar cere un om.
 * Aici e cazul opus, si cel mai des intalnit intr-o galerie de telefon: exact
 * acelasi fisier, salvat de mai multe ori. Nu e nimic de ales, doar de curatat.
 *
 * Amprenta si dimensiunea se citesc din baza de date la deschidere, nu la
 * fiecare import: niciun cost pe drumul analizei. Vezi core/exactDuplicates.ts.
 */
export function ExactDupesPanel() {
  const open = useStore(s => s.exactDupesOpen);
  const setOpen = useStore(s => s.setExactDupesOpen);
  const photos = useStore(s => s.photos);
  const rejectExactDuplicates = useStore(s => s.rejectExactDuplicates);
  const revealInGrid = useStore(s => s.revealInGrid);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  const [sets, setSets] = useState<DuplicateSet[]>([]);
  const [loading, setLoading] = useState(false);
  const byId = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    // dHash sta pe PhotoRecord, nu pe PhotoView — o singura citire, la
    // deschidere. `toArray()` aduce si campurile mari, dar tabela `photos` nu
    // le are (previzualizarile si embedding-urile stau separat).
    void db.photos.toArray().then(records => {
      if (!alive) return;
      const live = new Set(photos.map(p => p.id));
      const items: DuplicateCandidate[] = records
        .filter(r => live.has(r.id))
        .map(r => ({
          id: r.id, dHash: r.dHash, sizeBytes: r.sizeBytes, fileName: r.fileName,
          capturedAt: r.capturedAt, importedAt: r.importedAt, status: r.status
        }));
      setSets(findExactDuplicates(items));
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

  const summary = summariseDuplicates(sets);
  const applyAll = async () => {
    await rejectExactDuplicates(allDuplicateIds(sets));
    setOpen(false);
  };

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('exactDupes.title')} tabIndex={-1}>
        <header className="detail-head">
          <span><CopyIcon className="inline-icon" aria-hidden="true" /> {tr('exactDupes.title')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        <p className="hint">{tr('exactDupes.hint')}</p>

        {loading ? (
          <p className="hint" role="status">{tr('workspace.progress.processing')}</p>
        ) : sets.length === 0 ? (
          <p className="hint">{tr('exactDupes.empty')}</p>
        ) : (
          <>
            <div className="dupe-summary">
              <b className="mono">
                {tr(plural(summary.duplicates, 'exactDupes.summary.one', 'exactDupes.summary.other'),
                   { count: summary.duplicates, size: formatSize(summary.wastedBytes) })}
              </b>
            </div>

            {sets.map(set => (
              <div key={set.key} className="batch-section dupe-set">
                <p className="hint">
                  {tr('exactDupes.set', {
                    count: set.duplicateIds.length + 1,
                    size: formatSize(byId.get(set.keepId)?.sizeBytes ?? 0)
                  })}
                </p>
                <div className="dupe-strip">
                  <span className="dupe-cell">
                    <DupeThumb photoId={set.keepId} keep />
                    <em><CheckIcon className="inline-icon" aria-hidden="true" /> {tr('exactDupes.keep')}</em>
                  </span>
                  {set.duplicateIds.slice(0, 6).map(id => (
                    byId.has(id) ? <DupeThumb key={id} photoId={id} /> : null
                  ))}
                  {set.duplicateIds.length > 6 && (
                    <span className="dupe-more mono">+{set.duplicateIds.length - 6}</span>
                  )}
                </div>
                <button className="ghost small" onClick={() => revealInGrid([set.keepId, ...set.duplicateIds])}>
                  {tr('inbox.review')}
                </button>
              </div>
            ))}

            <p className="hint">{tr('exactDupes.safety')}</p>
            <button className="primary dupe-apply" onClick={() => void applyAll()}>
              {tr(plural(summary.duplicates, 'exactDupes.applyAll.one', 'exactDupes.applyAll.other'),
                  { count: summary.duplicates })}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
