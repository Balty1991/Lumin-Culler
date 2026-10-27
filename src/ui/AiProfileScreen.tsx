import { useEffect, useMemo, useRef, useState } from 'react';
import { Share } from '@capacitor/share';
import { useStore } from '../state/store';
import { db } from '../core/db';
import { contextEngine } from '../core/learning/ContextEngine';
import { summarizeAccuracy, MIN_DECISIONS_FOR_ACCURACY, type AccuracySummary } from '../core/learning/accuracy';
import { openTasteQuiz } from '../state/tasteQuiz';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon } from './icons';
import { t } from '../i18n';

/** Secunde de om economisite pe o poză sortată de AI: o privire și o decizie. */
const SECONDS_PER_PHOTO = 3;

interface Weight { label: string; value: number }

/**
 * ui/AiProfileScreen.tsx
 * „AI-ul tău”, al patrulea tab (redesign v3): cât de des alege ca tine, ce a
 * învățat despre gustul tău (ponderile cele mai mari ale modelului), câte
 * poze a sortat și timpul economisit. De aici se recalibrează („Învață-mă”)
 * și se poate distribui profilul — singurul lucru din aplicație care pleacă
 * de pe telefon, și doar ca text, la cererea omului.
 */
export function AiProfileScreen() {
  const open = useStore(s => s.aiProfileOpen);
  const setOpen = useStore(s => s.setAiProfileOpen);
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const [accuracy, setAccuracy] = useState<AccuracySummary | null>(null);
  const [lessons, setLessons] = useState(0);
  const [weights, setWeights] = useState<Weight[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useModalFocusTrap(ref, open);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void db.corrections.toArray().then(rows => {
      if (!alive) return;
      setLessons(rows.length);
      setAccuracy(summarizeAccuracy(rows));
    }).catch(() => {});
    void contextEngine.summarize(locale === 'en' ? 'en' : 'ro').then(models => {
      if (!alive) return;
      const main = [...models].sort((a, b) => b.sampleCount - a.sampleCount)[0];
      const top = (main?.allWeights ?? []).filter(w => w.label).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 4);
      const max = Math.max(1e-6, ...top.map(w => Math.abs(w.weight)));
      setWeights(top.map(w => ({ label: w.label, value: Math.abs(w.weight) / max })));
    }).catch(() => {});
    return () => { alive = false; };
  }, [open, locale]);

  const stats = useMemo(() => {
    const decided = photos.filter(p => p.status !== 'pending').length;
    const kept = photos.filter(p => p.status === 'selected').length;
    const minutes = Math.round((decided * SECONDS_PER_PHOTO) / 60);
    return { decided, kept, time: minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m` };
  }, [photos]);

  if (!open) return null;
  const percent = accuracy ? Math.round(accuracy.agreement * 100) : null;
  const trend = accuracy?.trend ? Math.round((accuracy.trend.recent - accuracy.trend.earlier) * 100) : null;

  const share = async () => {
    const text = tr('aiProfile.shareText', { percent: percent ?? 0, count: stats.decided });
    try {
      await Share.share({ text });
    } catch {
      try { await navigator.clipboard.writeText(text); } catch { /* fără clipboard */ }
    }
  };

  return (
    <div className="v3-screen" role="dialog" aria-modal="true" aria-label={tr('nav.ai')} ref={ref} tabIndex={-1}
      onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}>
      <div className="v3-screen-inner">
        <div className="v3-screen-head">
          <span className="v3-kicker">{tr('aiProfile.kicker', { version: lessons })}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('aiProfile.close')}><XIcon /></button>
        </div>

        <section className="v3-profile-hero">
          <div className="v3-ring" style={{ ['--p' as string]: `${percent ?? 0}` }}>
            <span>{percent ?? '—'}<small>{percent !== null ? '%' : ''}</small></span>
          </div>
          <div className="v3-profile-hero-text">
            <h2>{tr('aiProfile.title')}</h2>
            <p>
              {percent !== null
                ? tr('aiProfile.agreement', { count: lessons })
                : tr('aiProfile.warming', { left: Math.max(0, MIN_DECISIONS_FOR_ACCURACY - lessons) })}
            </p>
            {trend !== null && (
              <span className="v3-mono" style={{ color: trend >= 0 ? 'var(--pick)' : 'var(--reject)' }}>
                {trend >= 0 ? '▲ +' : '▼ '}{trend}% {tr('aiProfile.trend')}
              </span>
            )}
          </div>
        </section>

        {weights.length > 0 && (
          <section className="v3-panel v3-weights">
            <span className="v3-kicker">{tr('aiProfile.weights')}</span>
            {weights.map((w, i) => (
              <div key={w.label} className="v3-weight">
                <div><span>{w.label}</span><span className="v3-mono">{w.value.toFixed(2)}</span></div>
                <div className={i < 2 ? 'v3-bar' : 'v3-bar violet'}><i style={{ width: `${Math.round(w.value * 100)}%` }} /></div>
              </div>
            ))}
          </section>
        )}

        <section className="v3-stats">
          <div><b>{stats.decided.toLocaleString(locale)}</b><span>{tr('aiProfile.sorted')}</span></div>
          <div><b>{stats.kept.toLocaleString(locale)}</b><span>{tr('aiProfile.kept')}</span></div>
          <div><b>{stats.time}</b><span>{tr('aiProfile.saved')}</span></div>
        </section>

        <button className="v3-outline-btn" onClick={() => { setOpen(false); openTasteQuiz(); }}>{tr('aiProfile.recalibrate')}</button>
        <button className="btn-accent v3-wide-btn" onClick={() => void share()}>{tr('aiProfile.share')}</button>
        <p className="v3-kicker v3-center">{tr('aiProfile.private')}</p>
      </div>
    </div>
  );
}
