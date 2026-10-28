import { useState } from 'react';
import { useStore } from '../state/store';
import { useTr } from './context';
import { cloudAvailable, cloudEnabled, readVerdicts, setCloudEnabled, superviseUnsure } from './cloud';

/**
 * lumin/CloudParts.tsx
 * Lumi Cloud în interfață: pornirea (doar cu acord, spus pe față ce pleacă de
 * pe telefon) și părerea din cloud pe o poză.
 */
export function CloudSection() {
  const tr = useTr();
  const askConfirm = useStore(s => s.askConfirm);
  const setNotice = useStore(s => s.setNotice);
  const [on, setOn] = useState(cloudEnabled);
  const [busy, setBusy] = useState(false);
  if (!cloudAvailable()) return null;
  const checked = Object.keys(readVerdicts()).length;

  const toggle = async () => {
    if (!on && !await askConfirm(tr('lx.cloud.consent'), { confirmLabel: tr('lx.cloud.enable') })) return;
    setCloudEnabled(!on);
    setOn(!on);
    if (!on) void runNow();
  };
  const runNow = async () => {
    setBusy(true);
    try {
      const r = await superviseUnsure(12);
      setNotice(tr(r.checked ? 'lx.cloud.done' : 'lx.cloud.nothing', { checked: r.checked, decided: r.decided }));
    } finally { setBusy(false); }
  };

  return (
    <section className="lx-group">
      <h2>☁ {tr('lx.cloud.title')}</h2>
      <button className="lx-row button" role="switch" aria-checked={on} onClick={() => void toggle()}>
        <span><b>{tr('lx.cloud.row')}</b><small>{tr('lx.cloud.sub')}</small></span>
        <span className={on ? 'lx-switch on' : 'lx-switch'} aria-hidden="true"><i /></span>
      </button>
      {on && (
        <button className="lx-btn ghost wide" disabled={busy} onClick={() => void runNow()}>
          {busy ? tr('lx.cloud.working') : tr('lx.cloud.now', { checked })}
        </button>
      )}
    </section>
  );
}

/** „☁ Lumi Cloud: aș păstra-o — …” pe poza care are deja o a doua părere. */
export function CloudLine({ id }: { id: string }) {
  const tr = useTr();
  const v = readVerdicts()[id];
  if (!v || !v.reason) return null;
  return (
    <p className={v.keep ? 'lx-cloud-line keep' : 'lx-cloud-line drop'}>
      ☁ <b>{tr(v.keep ? 'lx.cloud.keep' : 'lx.cloud.drop')}</b> — {v.reason}
    </p>
  );
}
