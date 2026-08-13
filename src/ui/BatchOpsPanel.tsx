import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { selectBulkRejectTargets, resolveGroups, selectTopPercent, selectDeletableRejected, orderByDeletionRisk } from '../state/batchOps';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { listCullingPresets, saveCullingPreset, deleteCullingPreset, type CullingPreset } from '../state/cullingPresets';
import { buildExportFileName } from '../core/renameTemplate';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, LayersIcon, SparkleIcon, FilterDotIcon, TrashIcon, EditIcon } from './icons';
import { t } from '../i18n';

const DEFAULT_THRESHOLD = 35; // acelasi prag ca REJECT_THRESHOLD din importPipeline.ts
const DEFAULT_CULL_PERCENT = 20;

/** Operatii in masa: respinge sub un prag de scor (cu preview live), rezolva toate seriile deodata si Auto-Cull top-X%. */
/** Cate poze aratam in banda "ce ai pierde" — destule cat sa recunosti tiparul, nu inca o grila de parcurs. */
const DELETION_PREVIEW = 8;

export function BatchOpsPanel() {
  const open = useStore(s => s.batchOpsOpen);
  const setOpen = useStore(s => s.setBatchOpsOpen);
  const photos = useStore(s => s.photos);
  const bulkRejectBelow = useStore(s => s.bulkRejectBelow);
  const resolveAllSeries = useStore(s => s.resolveAllSeries);
  const autoCullTopPercent = useStore(s => s.autoCullTopPercent);
  const rescorePhotos = useStore(s => s.rescorePhotos);
  const deleteRejectedPhotos = useStore(s => s.deleteRejectedPhotos);
  const renameTemplate = useStore(s => s.renameTemplate);
  const setRenameTemplate = useStore(s => s.setRenameTemplate);
  const genre = useStore(s => s.genre);
  const setGenre = useStore(s => s.setGenre);
  const askConfirm = useStore(s => s.askConfirm);
  const askPrompt = useStore(s => s.askPrompt);
  const setNotice = useStore(s => s.setNotice);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [cullPercent, setCullPercent] = useState(DEFAULT_CULL_PERCENT);
  const [busy, setBusy] = useState(false);
  const [presets, setPresets] = useState<CullingPreset[]>(() => listCullingPresets());
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

  // panoul ramane montat tot timpul (vizibilitate prin CSS) — re-citim presetarile
  // la fiecare deschidere, ca sa prindem si cele restaurate dintr-un backup
  // (backupService.ts scrie direct in localStorage, fara sa treaca prin acest state local)
  useEffect(() => {
    if (open) setPresets(listCullingPresets());
  }, [open]);

  /**
   * "Sablon de sesiune" (plan "cat mai pro"): o presetare nu mai e doar
   * pragurile Auto-Cull/Respinge — retine si sablonul de redenumire la
   * export si genul fotografic tipic asociat (ex. presetarea "Nunta" aplica
   * automat si genre="Nunta"), ca un fotograf sa nu reregleze manual 3
   * setari diferite la fiecare sesiune noua de acelasi tip. Campurile absente
   * (presetari mai vechi, salvate inainte de acest camp) raman neschimbate
   * la aplicare, nu resetate la gol.
   */
  const applyPreset = (id: string) => {
    const preset = presets.find(p => p.id === id);
    if (!preset) return;
    setThreshold(preset.rejectThreshold);
    setCullPercent(preset.cullPercent);
    if (preset.renameTemplate !== undefined) setRenameTemplate(preset.renameTemplate);
    if (preset.genre !== undefined) setGenre(preset.genre);
  };

  const saveCurrentAsPreset = async () => {
    const name = await askPrompt(tr('batch.presets.namePrompt'));
    if (!name?.trim()) return;
    setPresets(saveCullingPreset(name, cullPercent, threshold, { renameTemplate, genre }));
  };

  const removePreset = (id: string) => setPresets(deleteCullingPreset(id));

  const targets = useMemo(() => selectBulkRejectTargets(photos, threshold), [photos, threshold]);
  const groups = useMemo(() => resolveGroups(photos), [photos]);
  const cull = useMemo(() => selectTopPercent(photos, cullPercent), [photos, cullPercent]);
  const deletableRejected = useMemo(() => selectDeletableRejected(photos), [photos]);
  // Ce urmeaza sa dispara, cele mai indoielnice primele — vezi orderByDeletionRisk.
  const riskiest = useMemo(() => orderByDeletionRisk(deletableRejected.deletable, DELETION_PREVIEW), [deletableRejected]);
  const openTiktokSortForIds = useStore(s => s.openTiktokSortForIds);

  const renamePreview = useMemo(
    () => buildExportFileName(renameTemplate, { client: 'Ana', event: 'Nunta', capturedAt: Date.now() }, 1, 'IMG_1234.jpg'),
    [renameTemplate]
  );

  if (!open) return null;

  // Bug real gasit de auditul QA: niciun handler de mai jos nu avea
  // try/finally — daca actiunea din store arunca la mijlocul lotului (ex. o
  // eroare Dexie neasteptata pe un singur photo), setBusy(false) era sarit
  // complet, iar cele 4 butoane ramaneau disabled={busy} PENTRU TOTDEAUNA,
  // fara nicio eroare vizibila, pana la un reload de pagina.
  const runReject = async () => {
    if (!targets.length) return;
    const ok = await askConfirm(tr('batch.rejectBelow.confirm', { count: targets.length, threshold }), { danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await bulkRejectBelow(threshold);
    } catch (err) {
      setNotice(tr('batch.operationFailed', { error: String(err) }));
    } finally {
      setBusy(false);
    }
  };

  const runResolveSeries = async () => {
    if (!groups.length) return;
    const ok = await askConfirm(tr('batch.resolveSeries.confirm', { count: groups.length }), { danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await resolveAllSeries();
    } catch (err) {
      setNotice(tr('batch.operationFailed', { error: String(err) }));
    } finally {
      setBusy(false);
    }
  };

  const runAutoCull = async () => {
    if (!cull.selectIds.length && !cull.rejectIds.length) return;
    const ok = await askConfirm(tr('batch.autoCull.confirm', { percent: cullPercent, keep: cull.selectIds.length, reject: cull.rejectIds.length }), { danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await autoCullTopPercent(cullPercent);
    } catch (err) {
      setNotice(tr('batch.operationFailed', { error: String(err) }));
    } finally {
      setBusy(false);
    }
  };

  const runRescore = async () => {
    if (!photos.length) return;
    const ok = await askConfirm(tr('batch.rescore.confirm', { count: photos.length }), { danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await rescorePhotos();
    } catch (err) {
      setNotice(tr('batch.operationFailed', { error: String(err) }));
    } finally {
      setBusy(false);
    }
  };

  const runDeleteRejected = async () => {
    if (!deletableRejected.deletable.length) return;
    const ok = await askConfirm(tr('batch.deleteRejected.confirm', { count: deletableRejected.deletable.length }), { danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteRejectedPhotos();
    } catch (err) {
      setNotice(tr('batch.operationFailed', { error: String(err) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('menu.batchOps')} tabIndex={-1}>
        <header className="detail-head">
          <span><LayersIcon className="inline-icon" /> {tr('menu.batchOps')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        <div className="batch-section">
          <h3><span className="batch-section-icon"><FilterDotIcon /></span> {tr('batch.presets.title')}</h3>
          <p className="hint">{tr('batch.presets.hint')}</p>
          {presets.length > 0 && (
            <ul className="preset-list">
              {presets.map(p => (
                <li key={p.id} className="preset-row">
                  <button className="ghost small preset-apply" onClick={() => applyPreset(p.id)} disabled={busy}>
                    <b>{p.name}</b> <span className="mono hint">{tr('batch.presets.row', { cullPercent: p.cullPercent, threshold: p.rejectThreshold })}</span>
                    {(p.renameTemplate || p.genre) && (
                      <span className="mono hint preset-extra">
                        {p.genre && <span className="preset-extra-chip">{p.genre}</span>}
                        {p.renameTemplate && <span className="preset-extra-chip"><EditIcon className="inline-icon" /></span>}
                      </span>
                    )}
                  </button>
                  <button className="ghost icon-btn small" onClick={() => removePreset(p.id)} aria-label={tr('batch.presets.deleteAriaLabel', { name: p.name })}>
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button className="ghost small" onClick={saveCurrentAsPreset} disabled={busy}>
            {tr('batch.presets.saveNew')}
          </button>
        </div>

        <div className="batch-section">
          <h3><span className="batch-section-icon"><SparkleIcon /></span> {tr('batch.autoCull.title')}</h3>
          <p className="hint">{tr('batch.autoCull.hint')}</p>
          <div className="batch-slider-row">
            <input
              type="range" min={0} max={100} step={5} value={cullPercent}
              onChange={e => setCullPercent(Number(e.target.value))}
              disabled={busy}
              aria-label={tr('batch.autoCull.title')}
            />
            <span className="mono batch-threshold-value">{cullPercent}%</span>
          </div>
          <div className="batch-preview mono">
            <span className="batch-preview-chip pos">{tr('batch.autoCull.kept', { count: cull.selectIds.length })}</span>
            <span className="batch-preview-chip neg">{tr('batch.autoCull.rejected', { count: cull.rejectIds.length })}</span>
          </div>
          <button className="select" onClick={() => void runAutoCull()} disabled={busy || (!cull.selectIds.length && !cull.rejectIds.length)}>
            {cull.selectIds.length || cull.rejectIds.length
              ? tr('batch.autoCull.apply', { keep: cull.selectIds.length, reject: cull.rejectIds.length })
              : tr('batch.autoCull.none')}
          </button>
        </div>

        <div className="batch-section">
          <h3><span className="batch-section-icon"><FilterDotIcon /></span> {tr('batch.rejectBelow.title')}</h3>
          <p className="hint">{tr('batch.rejectBelow.hint')}</p>
          <div className="batch-slider-row">
            <input
              type="range" min={0} max={100} value={threshold}
              onChange={e => setThreshold(Number(e.target.value))}
              disabled={busy}
              aria-label={tr('batch.rejectBelow.title')}
            />
            <span className="mono batch-threshold-value">{threshold}</span>
          </div>
          <button className="reject" onClick={() => void runReject()} disabled={busy || !targets.length}>
            {targets.length ? tr('batch.rejectBelow.apply', { count: targets.length }) : tr('batch.rejectBelow.none')}
          </button>
        </div>

        <div className="batch-section">
          <h3><span className="batch-section-icon"><LayersIcon /></span> {tr('batch.resolveSeries.title')}</h3>
          <p className="hint">{tr('batch.resolveSeries.hint')}</p>
          <button className="select" onClick={() => void runResolveSeries()} disabled={busy || !groups.length}>
            {groups.length ? tr('batch.resolveSeries.apply', { count: groups.length }) : tr('batch.resolveSeries.none')}
          </button>
        </div>

        <div className="batch-section">
          <h3><span className="batch-section-icon"><SparkleIcon /></span> {tr('batch.rescore.title')}</h3>
          <p className="hint">{tr('batch.rescore.hint')}</p>
          <button className="select" onClick={() => void runRescore()} disabled={busy || !photos.length}>
            {photos.length ? tr('batch.rescore.apply', { count: photos.length }) : tr('batch.rescore.none')}
          </button>
        </div>

        {isNativeMediaLibraryAvailable() && (
          <div className="batch-section">
            <h3><span className="batch-section-icon"><TrashIcon /></span> {tr('batch.deleteRejected.title')}</h3>
            <p className="hint">{tr('batch.deleteRejected.hint')}</p>
            {deletableRejected.skippedCount > 0 && (
              <p className="hint mono">{tr('batch.deleteRejected.skippedHint', { count: deletableRejected.skippedCount })}</p>
            )}
            {/* "Ce ai pierde": stergerea din telefon e singura actiune care nu se
                poate lua inapoi, iar un simplu numar ("sterge 214 poze") nu-ti da
                nimic de verificat. Miniaturile sunt LQIP-urile deja incarcate
                (sincron, fara nicio citire noua), asezate cu cele mai indoielnice
                primele. */}
            {riskiest.length > 0 && (
              <div className="deletion-preview">
                <p className="hint">{tr('batch.deleteRejected.previewHint')}</p>
                <ul className="deletion-preview-strip">
                  {riskiest.map(p => (
                    <li key={p.id}>
                      {p.lqip
                        ? <img src={p.lqip} alt="" />
                        : <span className="deletion-preview-blank" />}
                      <b className="mono">{p.aiScore}</b>
                    </li>
                  ))}
                </ul>
                <button
                  className="ghost deletion-preview-check"
                  onClick={() => { openTiktokSortForIds(riskiest.map(p => p.id)); setOpen(false); }}
                >
                  {tr('batch.deleteRejected.checkRiskiest', { count: riskiest.length })}
                </button>
              </div>
            )}
            <button className="reject" onClick={() => void runDeleteRejected()} disabled={busy || !deletableRejected.deletable.length}>
              {deletableRejected.deletable.length
                ? tr('batch.deleteRejected.apply', { count: deletableRejected.deletable.length })
                : tr('batch.deleteRejected.none')}
            </button>
          </div>
        )}

        <div className="batch-section">
          <h3><span className="batch-section-icon"><EditIcon /></span> {tr('batch.rename.title')}</h3>
          <p className="hint">{tr('batch.rename.hint')}</p>
          <input
            type="text"
            className="batch-rename-input"
            value={renameTemplate}
            onChange={e => setRenameTemplate(e.target.value)}
            placeholder="{client}_{eveniment}_{data}_{secventa}"
            aria-label={tr('batch.rename.title')}
          />
          <p className="hint mono batch-rename-preview">{tr('batch.rename.preview', { name: renamePreview })}</p>
        </div>

        {busy && <p className="hint"><SparkleIcon className="inline-icon spin" /> {tr('batch.applying')}</p>}
      </div>
    </div>
  );
}
