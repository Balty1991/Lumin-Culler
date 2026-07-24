import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { db } from '../core/db';
import { computeLibraryStats, computeAgreementStats, type AgreementStats } from '../core/stats';
import { FREE_TIER_MONTHLY_LIMIT } from '../state/usage';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, SparkleIcon } from './icons';

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
      <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label="Statistici" tabIndex={-1}>
        <header className="detail-head">
          <span><SparkleIcon className="inline-icon" /> Statistici</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label="Inchide">
            <XIcon />
          </button>
        </header>

        <div className="batch-section">
          <h3>Biblioteca curenta</h3>
          {stats.total === 0
            ? <p className="hint">Nicio poza importata inca.</p>
            : (
              <>
                <div className="stats-grid mono">
                  <div className="stat-tile"><b>{stats.total}</b><span>total</span></div>
                  <div className="stat-tile pos"><b>{stats.selected}</b><span>selectate ({pct(stats.selected)}%)</span></div>
                  <div className="stat-tile neg"><b>{stats.rejected}</b><span>respinse ({pct(stats.rejected)}%)</span></div>
                  <div className="stat-tile"><b>{stats.review}</b><span>de verificat ({pct(stats.review)}%)</span></div>
                  <div className="stat-tile"><b>{stats.seriesCount}</b><span>serii/duplicate</span></div>
                  <div className="stat-tile"><b>{stats.avgAiScore}</b><span>scor AI mediu</span></div>
                </div>
              </>
            )}
        </div>

        {stats.ratingCounts.slice(1).some(n => n > 0) && (
          <div className="batch-section">
            <h3>Distributia rating-urilor</h3>
            <div className="stats-grid mono">
              {[1, 2, 3, 4, 5].map(star => (
                <div key={star} className="stat-tile"><b>{stats.ratingCounts[star]}</b><span>{'★'.repeat(star)}</span></div>
              ))}
            </div>
          </div>
        )}

        <div className="batch-section">
          <h3>Acord AI / decizii manuale</h3>
          {agreement === null
            ? <p className="hint">Se incarca…</p>
            : agreement.total === 0
              ? <p className="hint">Inca nicio decizie manuala (Selecteaza/Respinge) inregistrata.</p>
              : (
                <p>
                  Din {agreement.total} decizii manuale, <b>{Math.round(agreement.agreementRate * 100)}%</b> au
                  fost de acord cu recomandarea AI de la momentul respectiv — restul au antrenat motorul sa
                  se ajusteze la preferintele tale.
                </p>
              )}
        </div>

        {lastImportStats && (
          <div className="batch-section">
            <h3>Ultimul import</h3>
            <p>
              {lastImportStats.count} poze in {formatDuration(lastImportStats.durationMs)}
              {' '}({(lastImportStats.count / (lastImportStats.durationMs / 1000)).toFixed(1)} poze/secunda).
            </p>
          </div>
        )}

        <div className="batch-section">
          <h3>Utilizare luna aceasta</h3>
          <p>
            {monthlyUsage} poze procesate din pragul orientativ de {FREE_TIER_MONTHLY_LIMIT} al nivelului gratuit
            (plan de monetizare) — <b>doar informativ</b>, nu blocheaza nicio functionalitate.
          </p>
        </div>
      </div>
    </div>
  );
}
