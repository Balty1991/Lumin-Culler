import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PhotoView } from '../state/store';
import { learnFromShare } from './signals';
import { useStore } from '../state/store';
import { useTr } from './context';
import { cloudAvailable, cloudEnabled, cloudWrite, ensureCloud, readVerdicts, setCloudEnabled, superviseUnsure, cloudBudgetOut } from './cloud';

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
    if (!on && !await askConfirm(tr('lx.cloud.consentAll'), { confirmLabel: tr('lx.cloud.enable') })) return;
    setCloudEnabled(!on);
    setOn(!on);
    if (!on) void runNow();
  };
  const runNow = async () => {
    setBusy(true);
    try {
      const r = await superviseUnsure(12, true);
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

/**
 * „✍ Text”: trei texte pentru postare, scrise de AI-ul online după ce se vede
 * în poză (unul cald, unul amuzant, unul scurt cu emoji). O atingere copiază
 * textul și deschide trimiterea pozei.
 */
export function CaptionSheet({ photo, onClose }: { photo: PhotoView; onClose: () => void }) {
  const tr = useTr();
  const askConfirm = useStore(s => s.askConfirm);
  const setNotice = useStore(s => s.setNotice);
  const exportSelection = useStore(s => s.exportSelection);
  const [captions, setCaptions] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!await ensureCloud(askConfirm, tr)) { onClose(); return; }
      const names = photo.personNames.length ? `People (named by the user): ${photo.personNames.join(', ')}.` : '';
      const r = await cloudWrite('caption', [photo.id], names, true);
      const list = Array.isArray(r?.captions) ? (r!.captions as unknown[]).filter((x): x is string => typeof x === 'string') : [];
      if (!alive) return;
      if (list.length) setCaptions(list); else setFailed(true);
    })();
    return () => { alive = false; };
  }, [photo.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* fără clipboard */ }
    setNotice(tr('lx.caption.copied'));
    onClose();
    await exportSelection('apps', [photo.id]);
    void learnFromShare([photo]);
  };
  return createPortal(
    <div className="lx lx-sheet-wrap" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lx-sheet" onClick={e => e.stopPropagation()}>
        <h2>✍ {tr('lx.caption.title')}</h2>
        {!captions && !failed && <div className="lx-enhance-wait"><span className="lx-spinner" />{tr('lx.caption.working')}</div>}
        {failed && <p className="lx-hint">{tr(cloudBudgetOut() ? 'lx.cloud.budget' : 'lx.caption.failed')}</p>}
        {captions?.map(c => (
          <button key={c} className="lx-caption" onClick={() => void pick(c)}>{c}</button>
        ))}
        {captions && <p className="lx-hint">{tr('lx.caption.hint')}</p>}
        <button className="lx-btn ghost wide" onClick={onClose}>{tr('lx.enhance.cancel')}</button>
      </div>
    </div>,
    document.body
  );
}

/** „✨ Povestea zilei scrisă de AI”: propozițiile scrise online, sau butonul care le cere (cu acord). */
export function useAiStory(ids: readonly string[], context: string): { sentences: string[] | null; ask: (() => void) | null; loading: boolean } {
  const tr = useTr();
  const askConfirm = useStore(s => s.askConfirm);
  const [sentences, setSentences] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const key = ids.join(',');
  const load = async (byUser = false) => {
    setLoading(true);
    try {
      const r = await cloudWrite('story', ids, context, byUser);
      const list = Array.isArray(r?.sentences) ? (r!.sentences as unknown[]).filter((x): x is string => typeof x === 'string') : [];
      if (list.length) setSentences(list);
    } finally { setLoading(false); }
  };
  useEffect(() => {
    setSentences(null);
    if (ids.length && cloudEnabled()) void load();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const ask = !sentences && !loading && cloudAvailable() && !cloudEnabled() && ids.length
    ? () => { void ensureCloud(askConfirm, tr).then(ok => { if (ok) void load(true); }); }
    : null;
  return { sentences, ask, loading };
}
