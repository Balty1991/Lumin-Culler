import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, SparkleIcon } from './icons';
import { clipAvailability, runClipBenchmark, releaseClip, lastClipError } from '../core/clip/clipPool';
import { BENCHMARK_SAMPLES, type ClipBenchmarkResult } from '../core/clip/clipBenchmark';
import type { ClipManifest } from '../core/clip/clipManifest';
import { isClipEnabled, setClipEnabled } from '../state/clipOptIn';
import { formatSpan } from '../core/formatTime';
import { db } from '../core/db';
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

  /** undefined = inca nu stim; null = build-ul asta n-are model. */
  const [manifest, setManifest] = useState<ClipManifest | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ClipBenchmarkResult | null>(null);
  const [failed, setFailed] = useState(false);
  /** Motivul brut, in cuvintele runtime-ului — vezi lastClipError. */
  const [reason, setReason] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(isClipEnabled);

  useEffect(() => {
    if (!open) return;
    void clipAvailability().then(setManifest);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const measure = () => {
    setBusy(true); setFailed(false);
    // Pozele TALE, nu o imagine de test: o imagine sintetica masoara acelasi
    // numar de operatii, dar nu si costul real de decodare al unui JPEG facut
    // cu telefonul.
    const ids = photos.slice(0, BENCHMARK_SAMPLES).map(p => p.id);
    void runClipBenchmark(ids)
      .then(r => { setResult(r); if (!r) { setFailed(true); setReason(lastClipError); } })
      .catch(err => { setFailed(true); setReason(err instanceof Error ? err.message : String(err)); })
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

        {manifest === undefined && <p className="premium-soon" role="status">{tr('clip.checking')}</p>}

        {manifest === null && (
          /* Stare normala, nu eroare: build-urile fara model sunt exact
             aplicatia de pana acum. */
          <p className="premium-soon" role="status">{tr('clip.absent')}</p>
        )}

        {manifest && (
          <>
            <div className="clip-spec">
              <h4 className="premium-group-head">{tr('clip.spec.title')}</h4>
              <dl>
                <div><dt>{tr('clip.spec.model')}</dt><dd className="mono">{manifest.id}</dd></div>
                <div><dt>{tr('clip.spec.download')}</dt><dd>{tr('clip.spec.downloadValue', { model: mb(manifest.bytes) })}</dd></div>
                <div><dt>{tr('clip.spec.vector')}</dt><dd>{tr('clip.spec.vectorValue', { dim: manifest.dim, px: manifest.inputSize })}</dd></div>
              </dl>
            </div>

            <button className="btn-accent big" disabled={busy || photos.length === 0} onClick={measure}>
              {busy ? tr('clip.measuring') : tr('clip.measure', { count: Math.min(BENCHMARK_SAMPLES, photos.length) })}
            </button>
            {photos.length === 0 && <p className="premium-soon">{tr('clip.needPhotos')}</p>}
            {failed && (
              <div role="alert">
                <p className="premium-soon">{tr('clip.failed')}</p>
                {/* Motivul brut, netradus si netrunchiat. Nu e frumos, dar e
                    singurul lucru din ecran care poate fi trimis mai departe si
                    chiar reparat — vezi lastClipError. */}
                {reason && <p className="clip-reason mono">{reason}</p>}
              </div>
            )}

            {result && (
              <div className="clip-result">
                <h4 className="premium-group-head">{tr('clip.result.title')}</h4>
                {/* Cifra care conteaza cu adevarat nu e milisecunda pe poza, ci
                    ce inseamna ea la un import obisnuit. */}
                <b className="clip-result-hero">
                  {tr('clip.result.thousand', { time: formatSpan(result.thousandPhotosSeconds) })}
                </b>
                <dl>
                  <div><dt>{tr('clip.result.median')}</dt><dd>{Math.round(result.medianMs)} ms</dd></div>
                  {/* Cea mai lenta poza sta langa mediana cu buna stiinta: de
                      obicei e prima, care plateste compilarea shaderelor. Ascunsa,
                      ar face cifra sa para mai buna decat e la pornire. */}
                  <div><dt>{tr('clip.result.slowest')}</dt><dd>{Math.round(result.slowestMs)} ms</dd></div>
                  <div><dt>{tr('clip.result.backend')}</dt><dd className="mono">{result.backend}</dd></div>
                  <div><dt>{tr('clip.result.load')}</dt><dd>{(result.loadMs / 1000).toFixed(1)} s</dd></div>
                  <div><dt>{tr('clip.result.samples')}</dt><dd>{result.samples}</dd></div>
                </dl>
                {result.backend === 'wasm' && <p className="premium-soon">{tr('clip.result.wasmNote')}</p>}
              </div>
            )}

            {/* Comutatorul apare DOAR dupa o masuratoare reusita. Nu ca sa fie
                greu de pornit — ci fiindca altfel i-am cere omului sa descarce
                zeci de MB pe incredere, exact ce aplicatia refuza in alta parte. */}
            {result && (
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
