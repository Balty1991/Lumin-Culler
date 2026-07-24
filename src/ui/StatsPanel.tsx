import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { db } from '../core/db';
import { computeLibraryStats, computeAgreementStats, type AgreementStats } from '../core/stats';
import { FREE_TIER_MONTHLY_LIMIT } from '../state/usage';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, SparkleIcon } from './icons';
import { t } from '../i18n';

function formatDuration(ms: number): string {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
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
                  <div className="stats-tile pos"><b>{stats.selected}</b><span>{tr('stats.tile.selected', { percent: pct(stats.selected) })}</span></div>
                  <div className="stats-tile neg"><b>{stats.rejected}</b><span>{tr('stats.tile.rejected', { percent: pct(stats.rejected) })}</span></div>
                  <div className="stats-tile"><b>{stats.review}</b><span>{tr('stats.tile.review', { percent: pct(stats.review) })}</span></div>
                  <div className="stats-tile"><b>{stats.seriesCount}</b><span>{tr('stats.tile.series')}</span></div>
                  <div className="stats-tile"><b>{stats.avgAiScore}</b><span>{tr('stats.tile.avgScore')}</span></div>
                </div>
              </>
            )}
        </div>

        {stats.ratingCounts.slice(1).some(n => n > 0) && (
          <div className="batch-section">
            <h3>{tr('stats.ratings.title')}</h3>
            <div className="stats-grid mono">
              {[1, 2, 3, 4, 5].map(star => (
                <div key={star} className="stats-tile"><b>{stats.ratingCounts[star]}</b><span>{'★'.repeat(star)}</span></div>
              ))}
            </div>
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
