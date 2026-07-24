import { useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { selectBulkRejectTargets, resolveGroups, selectTopPercent } from '../state/batchOps';
import { listCullingPresets, saveCullingPreset, deleteCullingPreset, type CullingPreset } from '../state/cullingPresets';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, LayersIcon, SparkleIcon, FilterDotIcon, TrashIcon } from './icons';
import { t } from '../i18n';

const DEFAULT_THRESHOLD = 35; // acelasi prag ca REJECT_THRESHOLD din importPipeline.ts
const DEFAULT_CULL_PERCENT = 20;

/** Operatii in masa: respinge sub un prag de scor (cu preview live), rezolva toate seriile deodata si Auto-Cull top-X%. */
export function BatchOpsPanel() {
  const open = useStore(s => s.batchOpsOpen);
  const setOpen = useStore(s => s.setBatchOpsOpen);
  const photos = useStore(s => s.photos);
  const bulkRejectBelow = useStore(s => s.bulkRejectBelow);
  const resolveAllSeries = useStore(s => s.resolveAllSeries);
  const autoCullTopPercent = useStore(s => s.autoCullTopPercent);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [cullPercent, setCullPercent] = useState(DEFAULT_CULL_PERCENT);
  const [busy, setBusy] = useState(false);
  const [presets, setPresets] = useState<CullingPreset[]>(() => listCullingPresets());
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  const applyPreset = (id: string) => {
    const preset = presets.find(p => p.id === id);
    if (!preset) return;
    setThreshold(preset.rejectThreshold);
    setCullPercent(preset.cullPercent);
  };

  const saveCurrentAsPreset = () => {
    const name = window.prompt(tr('batch.presets.namePrompt'));
    if (!name?.trim()) return;
    setPresets(saveCullingPreset(name, cullPercent, threshold));
  };

  const removePreset = (id: string) => setPresets(deleteCullingPreset(id));

  const targets = useMemo(() => selectBulkRejectTargets(photos, threshold), [photos, threshold]);
  const groups = useMemo(() => resolveGroups(photos), [photos]);
  const cull = useMemo(() => selectTopPercent(photos, cullPercent), [photos, cullPercent]);

  if (!open) return null;

  const runReject = async () => {
    if (!targets.length) return;
    const ok = window.confirm(tr('batch.rejectBelow.confirm', { count: targets.length, threshold }));
    if (!ok) return;
    setBusy(true);
    await bulkRejectBelow(threshold);
    setBusy(false);
  };

  const runResolveSeries = async () => {
    if (!groups.length) return;
    const ok = window.confirm(tr('batch.resolveSeries.confirm', { count: groups.length }));
    if (!ok) return;
    setBusy(true);
    await resolveAllSeries();
    setBusy(false);
  };

  const runAutoCull = async () => {
    if (!cull.selectIds.length && !cull.rejectIds.length) return;
    const ok = window.confirm(tr('batch.autoCull.confirm', { percent: cullPercent, keep: cull.selectIds.length, reject: cull.rejectIds.length }));
    if (!ok) return;
    setBusy(true);
    await autoCullTopPercent(cullPercent);
    setBusy(false);
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
          <button className="select batch-cull-btn" onClick={() => void runAutoCull()} disabled={busy || (!cull.selectIds.length && !cull.rejectIds.length)}>
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
          <button className="reject batch-reject-btn" onClick={() => void runReject()} disabled={busy || !targets.length}>
            {targets.length ? tr('batch.rejectBelow.apply', { count: targets.length }) : tr('batch.rejectBelow.none')}
          </button>
        </div>

        <div className="batch-section">
          <h3><span className="batch-section-icon"><LayersIcon /></span> {tr('batch.resolveSeries.title')}</h3>
          <p className="hint">{tr('batch.resolveSeries.hint')}</p>
          <button className="select batch-resolve-btn" onClick={() => void runResolveSeries()} disabled={busy || !groups.length}>
            {groups.length ? tr('batch.resolveSeries.apply', { count: groups.length }) : tr('batch.resolveSeries.none')}
          </button>
        </div>

        {busy && <p className="hint"><SparkleIcon className="inline-icon spin" /> {tr('batch.applying')}</p>}
      </div>
    </div>
  );
}
