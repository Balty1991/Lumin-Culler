import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { selectBulkRejectTargets, resolveGroups, selectTopPercent } from '../state/batchOps';
import { XIcon, LayersIcon, AlertIcon, SparkleIcon, FilterDotIcon } from './icons';

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

  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [cullPercent, setCullPercent] = useState(DEFAULT_CULL_PERCENT);
  const [busy, setBusy] = useState(false);

  const targets = useMemo(() => selectBulkRejectTargets(photos, threshold), [photos, threshold]);
  const groups = useMemo(() => resolveGroups(photos), [photos]);
  const cull = useMemo(() => selectTopPercent(photos, cullPercent), [photos, cullPercent]);

  if (!open) return null;

  const runReject = async () => {
    if (!targets.length) return;
    const ok = window.confirm(
      `Respingi ${targets.length} poze cu scor sub ${threshold}? Nu afecteaza pozele deja selectate manual. ` +
      'Poti anula ulterior cate una din istoricul de decizii (Ctrl+Z), nu ca lot intreg.'
    );
    if (!ok) return;
    setBusy(true);
    await bulkRejectBelow(threshold);
    setBusy(false);
  };

  const runResolveSeries = async () => {
    if (!groups.length) return;
    const ok = window.confirm(
      `Rezolvi toate cele ${groups.length} serii deodata? In fiecare, poza cu scorul cel mai mare ramane, restul se resping.`
    );
    if (!ok) return;
    setBusy(true);
    await resolveAllSeries();
    setBusy(false);
  };

  const runAutoCull = async () => {
    if (!cull.selectIds.length && !cull.rejectIds.length) return;
    const ok = window.confirm(
      `Auto-Cull: pastrezi cele mai bune ${cullPercent}% din pozele nedecise (${cull.selectIds.length} selectate), ` +
      `respingi restul (${cull.rejectIds.length})? Nu afecteaza pozele deja selectate/respinse manual.`
    );
    if (!ok) return;
    setBusy(true);
    await autoCullTopPercent(cullPercent);
    setBusy(false);
  };

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow">
        <header className="detail-head">
          <span><LayersIcon className="inline-icon" /> Operații în masă</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label="Inchide">
            <XIcon />
          </button>
        </header>

        <div className="batch-section">
          <h3><span className="batch-section-icon"><SparkleIcon /></span> Auto-Cull: pastreaza doar cele mai bune X%</h3>
          <p className="hint">Trieaza automat toate pozele nedecise dupa scor — restul se resping. Nu atinge pozele deja selectate/respinse manual.</p>
          <div className="batch-slider-row">
            <input
              type="range" min={0} max={100} step={5} value={cullPercent}
              onChange={e => setCullPercent(Number(e.target.value))}
              disabled={busy}
            />
            <span className="mono batch-threshold-value">{cullPercent}%</span>
          </div>
          <div className="batch-preview mono">
            <span className="batch-preview-chip pos">{cull.selectIds.length} păstrate</span>
            <span className="batch-preview-chip neg">{cull.rejectIds.length} respinse</span>
          </div>
          <button className="select batch-cull-btn" onClick={() => void runAutoCull()} disabled={busy || (!cull.selectIds.length && !cull.rejectIds.length)}>
            {cull.selectIds.length || cull.rejectIds.length
              ? `Pastreaza ${cull.selectIds.length}, respinge ${cull.rejectIds.length}`
              : 'Nicio poza nedecisa'}
          </button>
        </div>

        <div className="batch-section">
          <h3><span className="batch-section-icon"><FilterDotIcon /></span> Respinge sub un prag de scor</h3>
          <p className="hint">Nu atinge pozele deja selectate manual — doar cele „de verificat" sau neatinse.</p>
          <div className="batch-slider-row">
            <input
              type="range" min={0} max={100} value={threshold}
              onChange={e => setThreshold(Number(e.target.value))}
              disabled={busy}
            />
            <span className="mono batch-threshold-value">{threshold}</span>
          </div>
          <button className="reject batch-reject-btn" onClick={() => void runReject()} disabled={busy || !targets.length}>
            {targets.length ? `Respinge ${targets.length} poze` : 'Nicio poza sub acest prag'}
          </button>
        </div>

        <div className="batch-section">
          <h3><span className="batch-section-icon"><LayersIcon /></span> Rezolvă toate seriile</h3>
          <p className="hint">Pentru fiecare serie/duplicat, poza cu scorul cel mai mare rămâne, restul se resping.</p>
          <button className="select batch-resolve-btn" onClick={() => void runResolveSeries()} disabled={busy || !groups.length}>
            {groups.length ? `Rezolvă ${groups.length} serii` : 'Nicio serie găsită'}
          </button>
        </div>

        {busy && <p className="hint"><AlertIcon className="inline-icon" /> Se aplică…</p>}
      </div>
    </div>
  );
}
