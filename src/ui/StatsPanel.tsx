import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { readStageStats, resetStageStats } from '../core/stageTiming';
import { summariseOutcomes, resetImportOutcomes } from '../core/importOutcome';
import { summariseFeedback, resetFeedback } from '../core/aiFeedback';
import { db } from '../core/db';
import { computeLibraryStats, computeAgreementStats, computeAgreementTrend, type AgreementStats, type AgreementTrendPoint, type LibraryStats } from '../core/stats';
import { FREE_PHOTOS_PER_MONTH } from '../core/entitlement';
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

const TREND_W = 240;
const TREND_H = 56;
const TREND_PAD = 6;

/**
 * Evolutia ratei de acord AI/utilizator (plan "cat mai pro" — trend, nu doar
 * un numar static). Bucket-urile sunt EGALE CA NUMAR de corectii (vezi
 * computeAgreementTrend), deci axa X e "inceput -> acum" al secventei de
 * decizii, NU o axa calendaristica reala — etichetata explicit ca atare, ca
 * utilizatorul sa nu citeasca gresit distanta orizontala drept timp scurs.
 * Linie unica (fara paleta de status: rata de acord nu e pozitiv/negativ per
 * segment, e o singura serie continua), cu puncte marcate pentru citire exacta.
 */
function AgreementTrendChart({ points }: { points: AgreementTrendPoint[] }) {
  const innerW = TREND_W - TREND_PAD * 2;
  const innerH = TREND_H - TREND_PAD * 2;
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: TREND_PAD + i * stepX,
    y: TREND_PAD + innerH * (1 - p.agreementRate)
  }));
  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${TREND_H - TREND_PAD} L ${coords[0].x.toFixed(1)} ${TREND_H - TREND_PAD} Z`;
  const first = Math.round(points[0].agreementRate * 100);
  const last = Math.round(points[points.length - 1].agreementRate * 100);

  return (
    <div className="stats-trend">
      <svg viewBox={`0 0 ${TREND_W} ${TREND_H}`} className="stats-trend-svg" role="img" aria-label={`${first}% -> ${last}%`}>
        <path d={areaPath} className="stats-trend-area" />
        <path d={linePath} className="stats-trend-line" />
        {coords.map((c, i) => <circle key={i} cx={c.x} cy={c.y} r={2.5} className="stats-trend-dot" />)}
      </svg>
      <div className="stats-trend-axis mono hint">
        <span>{first}%</span>
        <span>{last}%</span>
      </div>
    </div>
  );
}

/** Dashboard de performanta si statistici (plan 3.2.3): stare curenta a bibliotecii + rata de acord AI/utilizator. */
/** Durata pe scurt: sub o secunda in milisecunde, peste in secunde cu o zecimala. */
function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function StatsPanel() {
  const open = useStore(s => s.statsOpen);
  const setOpen = useStore(s => s.setStatsOpen);
  const photos = useStore(s => s.photos);
  const lastImportStats = useStore(s => s.lastImportStats);
  const monthlyUsage = useStore(s => s.monthlyUsage);
  // Din store, nu din entitlement.ts direct: acolo raspunsul e sincron si React
  // n-ar afla ca s-a schimbat dupa un export sau dupa o cumparare. Vezi AppState.premium.
  const premium = useStore(s => s.premium);
  // Citite la deschidere, nu la fiecare randare: se schimba doar in timpul unui
  // import, iar panoul nu e deschis atunci.
  const [stageStats, setStageStats] = useState(() => readStageStats());
  useEffect(() => { if (open) setStageStats(readStageStats()); }, [open]);
  const stageTotal = Math.max(1, stageStats.reduce((sum, st) => sum + st.totalMs, 0));
  const [feedback, setFeedback] = useState(() => summariseFeedback());
  useEffect(() => { if (open) setFeedback(summariseFeedback()); }, [open]);
  // La fel ca mai sus: se schimba doar la sfarsitul unui import.
  const [imports, setImports] = useState(() => summariseOutcomes());
  useEffect(() => { if (open) setImports(summariseOutcomes()); }, [open]);
  const photosUsedThisWindow = useStore(s => s.photosUsedThisWindow);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const [agreement, setAgreement] = useState<AgreementStats | null>(null);
  const [trend, setTrend] = useState<AgreementTrendPoint[]>([]);
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

  useEffect(() => {
    if (!open) { setAgreement(null); setTrend([]); return; }
    let alive = true;
    void db.corrections.toArray().then(rows => {
      if (!alive) return;
      setAgreement(computeAgreementStats(rows));
      setTrend(computeAgreementTrend(rows));
    });
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

        {/* Unde s-a dus timpul la import. Fara defalcare, orice incetinire arata
            la fel din afara; cu ea se vede daca a fost decodarea, analiza AI,
            EXIF-ul, scrierea in baza de date sau gruparea. Numai durate — nimic
            despre continutul pozelor, si nimic nu pleaca de pe dispozitiv. */}
        {stageStats.length > 0 && (
          <div className="batch-section">
            <h3>{tr('stats.stages.title')}</h3>
            <p className="hint">{tr('stats.stages.hint')}</p>
            <div className="stage-timing">
              {stageStats.map(st => (
                <div key={st.stage} className="stage-timing-row">
                  <span className="stage-timing-name">{tr(`stats.stage.${st.stage}`)}</span>
                  <span className="stage-timing-bar" aria-hidden="true">
                    <i style={{ width: `${Math.round((st.totalMs / stageTotal) * 100)}%` }} />
                  </span>
                  <span className="mono stage-timing-value">
                    {tr('stats.stages.value', {
                      share: Math.round((st.totalMs / stageTotal) * 100),
                      median: formatMs(st.p50Ms),
                      slow: formatMs(st.p90Ms)
                    })}
                  </span>
                </div>
              ))}
            </div>
            <button type="button" className="ghost small danger" onClick={() => { resetStageStats(); setStageStats([]); }}>
              {tr('stats.stages.reset')}
            </button>
          </div>
        )}

        {/* Pozele care n-au ajuns in biblioteca. Numarul exista deja la sfarsitul
            importului, ca notificare — dar notificarea trece, si adesea trece in
            timp ce utilizatorul nu se uita la ecran. Aici ramane, si abia asa se
            vede un TIPAR: "de fiecare data esueaza cam atatea, cu motivul asta".
            Sectiunea apare doar cand chiar a esuat sau s-a sarit ceva. */}
        {imports && (imports.totalFailed > 0 || imports.totalSkipped > 0) && (
          <div className="batch-section">
            <h3>{tr('stats.imports.title')}</h3>
            <p className="hint">{tr('stats.imports.hint', { imports: imports.imports, photos: imports.totalPhotos })}</p>
            <div className="stats-grid mono">
              {imports.totalFailed > 0 && (
                <div className="stats-tile">
                  <b>{imports.totalFailed}</b><span>{tr('stats.imports.failed', { rate: imports.failureRate })}</span>
                </div>
              )}
              {imports.totalSkipped > 0 && (
                <div className="stats-tile"><b>{imports.totalSkipped}</b><span>{tr('stats.imports.skipped')}</span></div>
              )}
            </div>
            {imports.lastReason && (
              <p className="stat-note">{tr('stats.imports.lastReason', { reason: imports.lastReason })}</p>
            )}
            <button type="button" className="ghost small danger" onClick={() => { resetImportOutcomes(); setImports(null); }}>
              {tr('stats.imports.reset')}
            </button>
          </div>
        )}

        {/* Ce a raportat utilizatorul din Inspector prin "AI a greșit?".
            Scorul mediu per motiv raspunde la intrebarea utila: se plange de
            pozele judecate cu incredere sau de cele de la limita? */}
        {feedback.length > 0 && (
          <div className="batch-section">
            <h3>{tr('stats.feedback.title')}</h3>
            <p className="hint">{tr('stats.feedback.hint')}</p>
            <div className="feedback-summary">
              {feedback.map(f => (
                <div key={f.reason} className="feedback-summary-row">
                  <span>{tr(`aiFeedback.reason.${f.reason}`)}</span>
                  <span className="mono">
                    {f.avgScore === null
                      ? tr('stats.feedback.rowNoScore', { count: f.count })
                      : tr('stats.feedback.row', { count: f.count, score: f.avgScore })}
                  </span>
                </div>
              ))}
            </div>
            <button type="button" className="ghost small danger" onClick={() => { resetFeedback(); setFeedback([]); }}>
              {tr('stats.feedback.reset')}
            </button>
          </div>
        )}

        {stats.ratingCounts.slice(1).some(n => n > 0) && (
          <div className="batch-section">
            <h3>{tr('stats.ratings.title')}</h3>
            <RatingsBarChart counts={stats.ratingCounts} />
          </div>
        )}

        <div className="batch-section">
          <h3>{tr('stats.agreement.title')}</h3>
          {agreement === null
            ? <p className="hint"><SparkleIcon className="inline-icon spin" /> {tr('insights.loading')}</p>
            : agreement.total === 0
              ? <p className="hint">{tr('stats.agreement.none')}</p>
              : (
                <>
                  <p>
                    {tr('stats.agreement.text', { total: agreement.total, rate: Math.round(agreement.agreementRate * 100) })}
                  </p>
                  {trend.length > 0 && (
                    <>
                      <p className="hint stats-trend-label">{tr('stats.agreement.trend.label')}</p>
                      <AgreementTrendChart points={trend} />
                    </>
                  )}
                </>
              )}
        </div>

        {lastImportStats && (
          <div className="batch-section">
            <h3>{tr('stats.lastImport.title')}</h3>
            <p>
              {tr('stats.lastImport.text', {
                count: lastImportStats.count,
                duration: formatDuration(lastImportStats.durationMs),
                // durationMs poate rotunji la 0 pentru un lot foarte mic/rapid — fara garda,
                // impartirea la 0 producea literalul "Infinity" in text (bug real gasit de
                // auditul QA).
                rate: lastImportStats.durationMs > 0
                  ? (lastImportStats.count / (lastImportStats.durationMs / 1000)).toFixed(1)
                  : '—'
              })}
            </p>
          </div>
        )}

        {/* Doua cifre DIFERITE, si asta e tot rostul sectiunii: cate poze ai
            analizat (nelimitat, gratuit) si cate ai SCOS din aplicatie (singurul
            lucru plafonat). Inainte, aici se arata un al doilea "nivel gratuit"
            de 750 de poze procesate, care nu exista nicaieri in cod ca limita —
            vezi state/usage.ts si core/entitlement.ts. */}
        <div className="batch-section">
          <h3>{tr('stats.usage.title')}</h3>
          <p>{tr('stats.usage.analyzed', { count: monthlyUsage })}</p>
          <p>
            {premium
              ? tr('stats.usage.takenOutPremium', { count: photosUsedThisWindow })
              : tr('stats.usage.takenOut', { count: photosUsedThisWindow, limit: FREE_PHOTOS_PER_MONTH })}
          </p>
        </div>
      </div>
    </div>
  );
}
