import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, SparkleIcon } from './icons';
import { clipManifestState, runClipMatrix, releaseClip, type ClipMatrixRow } from '../core/clip/clipPool';
import { BENCHMARK_SAMPLES } from '../core/clip/clipBenchmark';
import type { ClipManifestRead } from '../core/clip/clipManifest';
import { isClipEnabled, setClipEnabled } from '../state/clipOptIn';
import { formatSpan } from '../core/formatTime';
import { db } from '../core/db';
import { measuredMsPerPhoto } from '../core/importOutcome';
import { t } from '../i18n';

/**
 * ui/ClipLabPanel.tsx
 * Motorul nou: ce e, cat costa pe TELEFONUL TAU, si abia apoi pornirea lui.
 *
 * DE CE ECRANUL ASTA EXISTA INAINTEA FUNCTIEI. Aplicatia are o regula pe care o
 * respecta peste tot: nu afirma cifre pe care nu le-a masurat (core/decisionPace.ts,
 * core/sessionOutcome.ts). Motorul nou e prima ocazie in care regula se aplica
 * asupra PROPRIEI implementari — codul lui a fost scris fara telefon si fara
 * model la indemana, deci nimeni nu stie inca daca o poza costa 15 ms sau 400.
 *
 * Deci ordinea e: intai masori pe telefonul tau, vezi cifra, si abia apoi
 * hotarasti. Comutatorul de pornire nici nu apare pana n-a rulat o masuratoare —
 * nu ca sa fie greu de pornit, ci fiindca a-l porni orbeste ar insemna sa ceri
 * cuiva sa descarce ~39 MB pe baza increderii, exact lucrul pe care aplicatia
 * refuza sa-l ceara in alta parte.
 *
 * Ce se vede aici nu e o reclama pentru functia noua: e fisa ei tehnica, cu
 * partile neplacute la vedere (marimea descarcarii, backend-ul chiar folosit,
 * cea mai lenta poza — nu doar mediana favorabila).
 */
export function ClipLabPanel() {
  const open = useStore(s => s.clipLabOpen);
  const setOpen = useStore(s => s.setClipLabOpen);
  const locale = useStore(s => s.locale);
  const photos = useStore(s => s.photos);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  /** undefined = inca nu stim. Vezi ClipManifestRead pentru cele trei stari. */
  const [stare, setStare] = useState<ClipManifestRead | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ facut: 0, total: 0 });
  const [rows, setRows] = useState<ClipMatrixRow[] | null>(null);
  const [enabled, setEnabled] = useState(isClipEnabled);
  /**
   * Cat te costa deja o poza la import, masurat la importurile tale. `null`
   * pana exista un import cu durata inregistrata. E NUMITORUL: fara el,
   * "ar adauga 106 ms" e o cifra fara termen de comparatie.
   */
  const [bazaMs] = useState(() => measuredMsPerPhoto());

  useEffect(() => {
    if (!open) return;
    void clipManifestState().then(setStare);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const measure = () => {
    setBusy(true); setRows(null); setProgress({ facut: 0, total: 0 });
    // Pozele TALE, nu o imagine de test: o imagine sintetica masoara acelasi
    // numar de operatii, dar nu si costul real de decodare al unui JPEG facut
    // cu telefonul.
    const ids = photos.slice(0, BENCHMARK_SAMPLES).map(p => p.id);
    void runClipMatrix(ids, (facut, total) => setProgress({ facut, total }))
      .then(setRows)
      .finally(() => setBusy(false));
  };

  const toggle = (on: boolean) => {
    setClipEnabled(on);
    setEnabled(on);
    if (!on) {
      // Oprirea sterge datele functiei, nu doar o ascunde. De-aia vectorii stau
      // in tabela lor — vezi core/db.ts, ClipEmbeddingRecord.
      void db.clipEmbeddings.clear();
      releaseClip();
    }
  };

  const mb = (bytes: number) => (bytes / 1048576).toFixed(1);

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div
        className="detail-inner narrow" ref={containerRef}
        role="dialog" aria-modal="true" aria-label={tr('clip.title')} tabIndex={-1}
      >
        <header className="detail-head">
          <span><SparkleIcon className="inline-icon" /> {tr('clip.title')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        <p className="clip-lead">{tr('clip.lead')}</p>

        {stare === undefined && <p className="premium-soon" role="status">{tr('clip.checking')}</p>}

        {stare?.kind === 'absent' && (
          /* Stare normala, nu eroare: build-urile fara model sunt exact
             aplicatia de pana acum. */
          <p className="premium-soon" role="status">{tr('clip.absent')}</p>
        )}

        {stare?.kind === 'unreadable' && (
          /* ALTCEVA decat "lipseste", si distinctia a costat o runda de testare:
             fisierul E acolo, dar nu-l putem citi — format vechi ramas in cache,
             JSON trunchiat, camp lipsa. Aratat ca lipsa, arata a "nu s-a livrat
             nimic"; aratat asa, se vede ca e un bug si se poate repara. */
          <div role="alert">
            <p className="premium-soon">{tr('clip.unreadable')}</p>
            <p className="clip-reason mono">{stare.raw}</p>
          </div>
        )}

        {stare?.kind === 'ok' && (
          <>
            <div className="clip-spec">
              <h4 className="premium-group-head">{tr('clip.spec.title')}</h4>
              <dl>
                {stare.variants.map(v => (
                  <div key={v.id}>
                    <dt>{v.label}</dt>
                    <dd>{mb(v.bytes)} MB</dd>
                  </div>
                ))}
                <div><dt>{tr('clip.spec.runtime')}</dt><dd>~25 MB</dd></div>
                <div><dt>{tr('clip.spec.vector')}</dt><dd>{tr('clip.spec.vectorValue', { dim: stare.variants[0].dim, px: stare.variants[0].inputSize })}</dd></div>
              </dl>
            </div>

            <button className="btn-accent big" disabled={busy || photos.length === 0} onClick={measure}>
              {busy
                ? tr('clip.measuringOf', { done: progress.facut, total: progress.total })
                : tr('clip.measureAll', { count: Math.min(BENCHMARK_SAMPLES, photos.length), combos: stare.variants.length * 2 })}
            </button>
            {photos.length === 0 && <p className="premium-soon">{tr('clip.needPhotos')}</p>}

            {rows && (
              <div className="clip-result">
                <h4 className="premium-group-head">{tr('clip.result.title')}</h4>
                {/* TABEL, nu o cifra. Un singur numar nu poate raspunde la
                    intrebarea care conteaza: modelul e greu, sau doar prost
                    potrivit cu backend-ul pe care a nimerit? */}
                <table className="clip-table">
                  <thead>
                    <tr>
                      <th>{tr('clip.table.variant')}</th>
                      <th>{tr('clip.table.backend')}</th>
                      <th>{tr('clip.table.perPhoto')}</th>
                      <th>{tr('clip.table.thousand')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className={r.result ? undefined : 'clip-row-failed'}>
                        <td>{r.variant.label}</td>
                        <td className="mono">{r.forced}</td>
                        {/* Un rand picat ramane IN tabel: "varianta asta nu
                            porneste pe placa video" e un rezultat, nu o absenta. */}
                        <td>{r.result ? `${Math.round(r.result.medianMs)} ms` : '—'}</td>
                        <td>{r.result ? formatSpan(r.result.thousandPhotosSeconds) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {/* CE INSEAMNA cifra, raportat la ce te costa deja un import.
                    Fara randul asta, "106 ms pe poza" e un numar fara numitor —
                    106 peste ce? Baza e masurata la importurile tale, nu
                    presupusa. */}
                {bazaMs !== null && rows.some(r => r.result) && (
                  <p className="clip-compare">
                    {tr('clip.compare', {
                      base: Math.round(bazaMs),
                      percent: Math.round((Math.min(...rows.flatMap(r => r.result ? [r.result.medianMs] : [])) / bazaMs) * 100)
                    })}
                  </p>
                )}
                {/* Motivele brute, netraduse: singurul lucru din ecran care poate
                    fi trimis mai departe si chiar reparat. */}
                {rows.filter(r => r.error).map((r, i) => (
                  <p key={i} className="clip-reason mono">{r.variant.label} / {r.forced}: {r.error}</p>
                ))}
              </div>
            )}

            {/* Comutatorul apare DOAR dupa ce o combinatie chiar a mers. Nu ca
                sa fie greu de pornit — ci fiindca altfel i-am cere omului sa
                descarce zeci de MB pe incredere, exact ce aplicatia refuza in
                alta parte. */}
            {rows?.some(r => r.result) && (
              <label className="clip-toggle">
                <input type="checkbox" checked={enabled} onChange={e => toggle(e.target.checked)} />
                <span>
                  <b>{tr('clip.enable')}</b>
                  <span>{tr('clip.enable.sub')}</span>
                </span>
              </label>
            )}

            <p className="clip-note">{tr('clip.note')}</p>
          </>
        )}
      </div>
    </div>
  );
}
