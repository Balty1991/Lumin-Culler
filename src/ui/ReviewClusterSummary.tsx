import { useMemo } from 'react';
import { useStore } from '../state/store';
import { clusterReviewQueue, worthSummarising, type ReviewCause } from '../core/reviewClusters';
import { t, plural } from '../i18n';

/**
 * ui/ReviewClusterSummary.tsx
 * "Din 47 de verificat: 30 neclare · 12 clipite · 5 în serie" — și fiecare se
 * deschide dintr-o apăsare.
 *
 * DE CE EXISTA. Aplicatia masoara 71 de semnale pe fiecare poza si le strange
 * intr-un scor si o banda de dificultate. Banda spune cat de GREU e cazul; nu
 * spune ce e in neregula. Iar omul care vede "47 de verificat" nu are de unde
 * sti daca il asteapta 47 de decizii diferite sau aceeasi decizie de treizeci
 * de ori. De obicei e a doua: pozele proaste vin in familii — o rafala miscata,
 * un grup in care cineva a clipit, o serie de cadre aproape identice.
 *
 * Spuse ca familii, se rezolva dintr-un gest. Spuse ca lista, una cate una.
 *
 * DESCHIDEREA DUCE EXACT LA POZELE NUMARATE, si asta a fost decizia importanta.
 * Aplicatia are deja filtre "neclare"/"clipite"/"serii", dar ele folosesc alte
 * praguri — sunt facute pentru operatii in masa (ce e SIGUR de respins
 * automat), nu pentru descriere (ce e un defect). Legat de ele, grupul ar fi
 * spus 30 si ar fi aratat 18. O cifra care nu se potriveste cu ce primesti cand
 * o apesi e exact felul de minciuna mica de care aplicatia asta se fereste
 * peste tot. Deci se deschide sortarea rapida chiar pe id-urile numarate.
 *
 * COST ZERO: nicio inferenta noua, niciun octet descarcat, nicio dependinta —
 * doar semnale deja calculate, citite altfel.
 */
const CAUSE_LABEL: Record<ReviewCause, { one: string; other: string }> = {
  blurry: { one: 'review.cluster.blurry.one', other: 'review.cluster.blurry.other' },
  eyesClosed: { one: 'review.cluster.eyesClosed.one', other: 'review.cluster.eyesClosed.other' },
  series: { one: 'review.cluster.series.one', other: 'review.cluster.series.other' },
  exposure: { one: 'review.cluster.exposure.one', other: 'review.cluster.exposure.other' },
  noSubject: { one: 'review.cluster.noSubject.one', other: 'review.cluster.noSubject.other' },
  other: { one: 'review.cluster.other.one', other: 'review.cluster.other.other' }
};

export function ReviewClusterSummary() {
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);
  const openTiktokSortForIds = useStore(s => s.openTiktokSortForIds);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  const clusters = useMemo(
    () => clusterReviewQueue(photos.filter(p => p.status === 'review')),
    [photos]
  );

  if (!worthSummarising(clusters)) return null;
  const total = clusters.reduce((n, c) => n + c.photoIds.length, 0);

  return (
    <section className="review-clusters" aria-label={tr('review.cluster.label')}>
      <h4 className="review-clusters-head mono">{tr('review.cluster.title', { count: total })}</h4>
      <div className="review-clusters-list">
        {clusters.map(c => (
          <button
            key={c.cause}
            className="review-cluster"
            onClick={() => openTiktokSortForIds(c.photoIds)}
          >
            <b>{c.photoIds.length}</b>
            <span>{tr(plural(c.photoIds.length, CAUSE_LABEL[c.cause].one, CAUSE_LABEL[c.cause].other))}</span>
            <i aria-hidden="true">→</i>
          </button>
        ))}
      </div>
    </section>
  );
}
