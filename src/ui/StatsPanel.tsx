import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { db } from '../core/db';
import { computeLibraryStats, computeAgreementStats, type AgreementStats, type LibraryStats } from '../core/stats';
import { FREE_TIER_MONTHLY_LIMIT } from '../state/usage';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, SparkleIcon } from './icons';
import { t } from '../i18n';

function formatDuration(ms: number): string {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

type Tr = (key: string, params?: Record<string, string | number>) => string;

/**
 * Compozitie Selectat/De verificat/Respins ca bara stivuita orizontala
 * (plan 3.2.3, "dashboard vizual") — inlocuieste 3 din cele 6 cifre statice
 * de mai jos cu un raport parte-din-intreg de citit dintr-o privire, nu doar
 * numarat. Ordinea segmentelor (selectat -> de verificat -> respins) e cea
 * deja folosita in filtrele din App.tsx, pentru consistenta vizuala intre ecrane.
 * Culorile sunt paleta de status deja existenta in aplicatie (--pick/--review/
 * --reject, folosita pe carduri/rating/factori AI), nu o paleta noua — fiecare
 * segment ramane etichetat direct (numar + procent), nu doar colorat, ca
 * diferenta de culoare intre segmentele apropiate ca luminozitate (verde/galben)
 * sa nu fie singurul semnal.
 */
function StatusBreakdownBar({ stats, pct, tr }: { stats: LibraryStats; pct: (n: number) => number; tr: Tr }) {
  const segments = [
    { key: 'selected', count: stats.selected, color: 'var(--pick)', labelKey: 'stats.tile.selected' },
    { key: 'review', count: stats.review, color: 'var(--review)', labelKey: 'stats.tile.review' },
    { key: 'rejected', count: stats.rejected, color: 'var(--reject)', labelKey: 'stats.tile.rejected' }
  ] as const;
  if (!stats.total) return null;

  return (
    <div className="stats-breakdown">
      <div className="stats-breakdown-bar" role="img" aria-label={tr('stats.breakdown.ariaLabel')}>
        {segments.filter(s => s.count > 0).map(s => (
          <div
            key={s.key}
            className="stats-breakdown-segment"
            style={{ width: `${(s.count / stats.total) * 100}%`, background: s.color }}
            title={`${tr(s.labelKey, { percent: pct(s.count) })}: ${s.count}`}
          />
        ))}
      </div>
      <div className="stats-breakdown-legend mono">
        {segments.map(s => (
          <span key={s.key} className="stats-breakdown-legend-item">
            <b className="stats-breakdown-dot" style={{ background: s.color }} />
            {s.count} {tr(s.labelKey, { percent: pct(s.count) })}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Distributia rating-urilor (1-5 stele) ca bare orizontale, magnitudine ->
 * lungime — inlocuieste grila de cifre statice de dinainte cu un raport
 * vizual direct intre nivele. O singura nuanta (accent, nu paleta de status:
 * rating-ul nu are conotatie pozitiv/negativ ca selectat/respins), pentru ca
 * lungimea barei e deja semnalul de magnitudine, culoarea n-are nevoie sa
 * codifice a doua oara aceeasi informatie.
 */
function RatingsBarChart({ counts }: { counts: LibraryStats['ratingCounts'] }) {
  const max = Math.max(...counts.slice(1), 1);
  return (
    <div className="stats-ratings-chart">
      {[5, 4, 3, 2, 1].map(star => {
        const count = counts[star];
        const widthPct = Math.round((count / max) * 100);
        return (
          <div key={star} className="stats-ratings-row">
            <span className="stats-ratings-label mono">{'★'.repeat(star)}</span>
            <div className="stats-ratings-track">
              <div className="stats-ratings-fill" style={{ width: `${widthPct}%` }} title={String(count)} />
            </div>
            <span className="stats-ratings-value mono">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Dashboard de performanta si statistici (plan 3.2.3): stare curenta a bibliotecii + rata de acord AI/utilizator. */
export function StatsPanel() {
  const open = useStore(s => s.statsOpen);
  const setOpen = useStore(s => s.setStatsOpen);
  const photos = useStore(s => s.photos);
  const lastImportStats = useStore(s => s.lastImportStats);
  const monthlyUsage = useStore(s => s.monthlyUsage);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const [agreement, setAgreement] = useState<AgreementStats | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  useEffect(() => {
    if (!open) { setAgreement(null); return; }
    let alive = true;
    void db.corrections.toArray().then(rows => { if (alive) setAgreement(computeAgreementStats(rows)); });
    return () => { alive = false; };
  }, [open]);

  const stats = useMemo(() => computeLibraryStats(photos), [photos]);

  if (!open) return null;

  const pct = (n: number) => (stats.total ? Math.round((n / stats.total) * 100) : 0);

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('menu.stats')} tabIndex={-1}>
        <header className="detail-head">
          <span><SparkleIcon className="inline-icon" /> {tr('menu.stats')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        <div className="batch-section">
          <h3>{tr('stats.library.title')}</h3>
          {stats.total === 0
            ? <p className="hint">{tr('stats.library.empty')}</p>
            : (
              <>
                <div className="stats-grid mono">
                  <div className="stats-tile"><b>{stats.total}</b><span>{tr('stats.tile.total')}</span></div>
                  <div className="stats-tile"><b>{stats.seriesCount}</b><span>{tr('stats.tile.series')}</span></div>
                  <div className="stats-tile"><b>{stats.avgAiScore}</b><span>{tr('stats.tile.avgScore')}</span></div>
                </div>
                <StatusBreakdownBar stats={stats} pct={pct} tr={tr} />
              </>
            )}
        </div>

        {stats.ratingCounts.slice(1).some(n => n > 0) && (
          <div className="batch-section">
            <h3>{tr('stats.ratings.title')}</h3>
            <RatingsBarChart counts={stats.ratingCounts} />
          </div>
        )}

        <div className="batch-section">
          <h3>{tr('stats.agreement.title')}</h3>
          {agreement === null
            ? <p className="hint">{tr('insights.loading')}</p>
            : agreement.total === 0
              ? <p className="hint">{tr('stats.agreement.none')}</p>
              : (
                <p>
                  {tr('stats.agreement.text', { total: agreement.total, rate: Math.round(agreement.agreementRate * 100) })}
                </p>
              )}
        </div>

        {lastImportStats && (
          <div className="batch-section">
            <h3>{tr('stats.lastImport.title')}</h3>
            <p>
              {tr('stats.lastImport.text', {
                count: lastImportStats.count,
                duration: formatDuration(lastImportStats.durationMs),
                rate: (lastImportStats.count / (lastImportStats.durationMs / 1000)).toFixed(1)
              })}
            </p>
          </div>
        )}

        <div className="batch-section">
          <h3>{tr('stats.usage.title')}</h3>
          <p>
            {tr('stats.usage.text', { count: monthlyUsage, limit: FREE_TIER_MONTHLY_LIMIT })} <b>{tr('stats.usage.infoOnly')}</b>{tr('stats.usage.textEnd')}
          </p>
        </div>
      </div>
    </div>
  );
}
