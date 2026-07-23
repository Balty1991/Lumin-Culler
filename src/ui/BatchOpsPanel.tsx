import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { selectBulkRejectTargets, resolveGroups } from '../state/batchOps';
import { XIcon, LayersIcon, AlertIcon } from './icons';

const DEFAULT_THRESHOLD = 35; // acelasi prag ca REJECT_THRESHOLD din importPipeline.ts

/** Operatii in masa: respinge sub un prag de scor (cu preview live) si rezolva toate seriile deodata. */
export function BatchOpsPanel() {
  const open = useStore(s => s.batchOpsOpen);
  const setOpen = useStore(s => s.setBatchOpsOpen);
  const photos = useStore(s => s.photos);
  const bulkRejectBelow = useStore(s => s.bulkRejectBelow);
  const resolveAllSeries = useStore(s => s.resolveAllSeries);

  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [busy, setBusy] = useState(false);

  const targets = useMemo(() => selectBulkRejectTargets(photos, threshold), [photos, threshold]);
  const groups = useMemo(() => resolveGroups(photos), [photos]);

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
          <h3>Respinge sub un prag de scor</h3>
          <p className="hint">Nu atinge pozele deja selectate manual — doar cele „de verificat" sau neatinse.</p>
          <div className="batch-slider-row">
            <input
              type="range" min={0} max={100} value={threshold}
              onChange={e => setThreshold(Number(e.target.value))}
              disabled={busy}
            />
            <span className="mono batch-threshold-value">{threshold}</span>
          </div>
          <button className="reject" onClick={() => void runReject()} disabled={busy || !targets.length}>
            {targets.length ? `Respinge ${targets.length} poze` : 'Nicio poza sub acest prag'}
          </button>
        </div>

        <div className="batch-section">
          <h3>Rezolvă toate seriile</h3>
          <p className="hint">Pentru fiecare serie/duplicat, poza cu scorul cel mai mare rămâne, restul se resping.</p>
          <button className="select" onClick={() => void runResolveSeries()} disabled={busy || !groups.length}>
            {groups.length ? `Rezolvă ${groups.length} serii` : 'Nicio serie găsită'}
          </button>
        </div>

        {busy && <p className="hint"><AlertIcon className="inline-icon" /> Se aplică…</p>}
      </div>
    </div>
  );
}
