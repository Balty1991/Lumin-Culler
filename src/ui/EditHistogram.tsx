import { histogramPath, type Histogram as HistogramData } from '../core/histogram';
import { t, type Locale } from '../i18n';

const W = 240;
const H = 46;
/** Peste atata lipit de un capat, meritam sa spunem ca s-a pierdut ceva. */
const CLIP_WARN = 0.02;

/**
 * Histograma live a previzualizarii.
 *
 * Se recalculeaza din CANVAS-ul deja desenat, deci arata poza CU ajustari, nu
 * originalul — adica exact ce trebuie: muti sliderul si vezi silueta miscandu-se
 * si capetele aprinzandu-se cand incepi sa arzi lumini.
 *
 * Cele trei canale se deseneaza suprapuse, cu amestecare aditiva (`screen`):
 * unde toate trei coincid — o poza neutra — iese alb, iar unde se despart se
 * vad culorile care ies din rand. E conventia din orice editor serios, si e
 * mai informativa decat o singura silueta gri.
 */
export function EditHistogram({ data, locale }: { data: HistogramData; locale: Locale }) {
  const shadowsClipped = data.clippedShadows > CLIP_WARN;
  const highlightsClipped = data.clippedHighlights > CLIP_WARN;
  const pct = (v: number) => Math.round(v * 100);

  return (
    <div className="histogram" aria-label={t(locale, 'edit.histogram')}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <g className="histogram-channels">
          <path d={histogramPath(data.r, data.peak, W, H)} fill="#ff4d4d" />
          <path d={histogramPath(data.g, data.peak, W, H)} fill="#4dff88" />
          <path d={histogramPath(data.b, data.peak, W, H)} fill="#4d94ff" />
        </g>
      </svg>
      {/* Capetele se aprind doar cand chiar s-a pierdut ceva. Un semnal mereu
          prezent n-ar mai fi un semnal. */}
      {shadowsClipped && (
        <span className="histogram-clip left" title={t(locale, 'edit.histogram.shadows', { pct: pct(data.clippedShadows) })} />
      )}
      {highlightsClipped && (
        <span className="histogram-clip right" title={t(locale, 'edit.histogram.highlights', { pct: pct(data.clippedHighlights) })} />
      )}
      <span className="sr-only">
        {t(locale, shadowsClipped || highlightsClipped ? 'edit.histogram.clipped' : 'edit.histogram.clean', {
          shadows: pct(data.clippedShadows), highlights: pct(data.clippedHighlights)
        })}
      </span>
    </div>
  );
}
