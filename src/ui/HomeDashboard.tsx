import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useStore, type PhotoView } from '../state/store';
import { getCachedPreviewUrl } from '../core/previewUrlCache';
import { AdjustedImage } from './AdjustedImage';
import { computeImportStreak } from '../state/streak';
import { countRealLocations } from '../state/locations';
import { selectMonthlyRecap } from '../state/monthlyRecap';
import { selectDeletableRejected } from '../state/batchOps';
import { sumKnownSizeBytes, formatGB } from '../state/storageStats';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { selectPendingShieldReview, readShieldDismissedIds } from '../core/documentShield';
import { selectUnresolvedGroups } from '../state/duplicateGroups';
import { AnimatedNumber } from './AnimatedNumber';
import { GalleryOverviewNote } from './GalleryOverviewNote';
import { SessionOutcome } from './SessionOutcome';
import { SparkleIcon, PinIcon, ChevronUpIcon, ShieldIcon, CopyIcon, ChevronRight, GridIcon } from './icons';
import { t, plural } from '../i18n';

const RECAP_TEASER_MIN_PHOTOS = 5; // sub atat, un "recap" nu chiar inseamna nimic

function greetingKey(hour: number): string {
  if (hour < 5) return 'home.greet.night';
  if (hour < 12) return 'home.greet.morning';
  if (hour < 18) return 'home.greet.afternoon';
  return 'home.greet.evening';
}

/**
 * Zona de "bun venit" de pe Acasa (plan modernizare, cerinta directa a
 * utilizatorului: reorganizare reala vizuala, dupa mockup-ul HTML trimis —
 * card hero de progres + spatiu, card recap, card sterge respinse, rand de
 * mini-statistici). Randata DOAR cand exista poze (nimic de salutat/rezumat
 * pe o biblioteca goala — vezi WelcomeOnboarding pentru acel caz).
 *
 * Toate cifrele sunt reale, nu inventate ca sa semene cu mockup-ul:
 * - "%" organizat = (selectate+respinse)/total, acelasi calcul ca CullGauge.
 * - "GB" ocupate/eliberate = suma reala PhotoView.sizeBytes (File.size la
 *   import) — vezi state/storageStats.ts. Poze importate INAINTE de acest
 *   camp nu au sizeBytes si sunt excluse din suma, nu numarate ca 0.
 * - streak/locatii/recap — vezi state/streak.ts, state/locations.ts,
 *   state/monthlyRecap.ts, deja construite.
 */
function ReviewDeskPreview({ photo }: { photo: PhotoView }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void getCachedPreviewUrl(photo.id).then(url => { if (alive) setSrc(url); });
    return () => { alive = false; };
  }, [photo.id]);

  return (
    <div className="review-desk-preview" aria-hidden="true">
      {src && <AdjustedImage src={src} edits={photo.edits} alt="" />}
    </div>
  );
}

export function HomeDashboard() {
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);
  const setPresentationPhotoIds = useStore(s => s.setPresentationPhotoIds);
  const setPresentationOpen = useStore(s => s.setPresentationOpen);
  const setLocationsOpen = useStore(s => s.setLocationsOpen);
  const setTiktokSortOpen = useStore(s => s.setTiktokSortOpen);
  const setHomeGridOpen = useStore(s => s.setHomeGridOpen);
  const openDetail = useStore(s => s.openDetail);
  const setDocumentShieldOpen = useStore(s => s.setDocumentShieldOpen);
  const setDuplicatesPanelOpen = useStore(s => s.setDuplicatesPanelOpen);
  const collections = useStore(s => s.collections);
  const deleteRejectedPhotos = useStore(s => s.deleteRejectedPhotos);
  const askConfirm = useStore(s => s.askConfirm);
  /** Cardul de rezumat e pe ecran — sub-randul din salut ar spune acelasi lucru. */
  const hasOutcome = useStore(s => s.sessionOutcome !== null);
  const [deleting, setDeleting] = useState(false);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  const now = new Date();
  const streak = useMemo(() => computeImportStreak(photos, now), [photos]); // eslint-disable-line react-hooks/exhaustive-deps -- `now` doar ancoreaza calculul, nu trebuie sa retrigger-uiasca la fiecare randare
  const locationCount = useMemo(() => countRealLocations(photos), [photos]);
  const recapPhotos = useMemo(() => selectMonthlyRecap(photos, now), [photos]); // eslint-disable-line react-hooks/exhaustive-deps
  const { deletable: deletableRejected } = useMemo(() => selectDeletableRejected(photos), [photos]);
  const shieldPendingCount = useMemo(() => {
    const vaultIds = new Set(collections.find(c => c.isPrivate)?.memberIds ?? []);
    return selectPendingShieldReview(photos, vaultIds, readShieldDismissedIds()).length;
  }, [photos, collections]);
  const duplicateGroupCount = useMemo(() => selectUnresolvedGroups(photos).length, [photos]);

  if (photos.length === 0) return null;

  // "de curatat" = tot ce nu e inca decis (pending + review), nu doar 'review'
  // (subsetul ambiguu semnalat de AI) — altfel numarul arata mult mai mic
  // decat coada reala de sortat pe care utilizatorul chiar o are.
  const unsortedCount = photos.filter(p => p.status === 'pending' || p.status === 'review').length;
  const decidedCount = photos.filter(p => p.status === 'selected' || p.status === 'rejected').length;
  const donePercent = Math.round((decidedCount / Math.max(1, photos.length)) * 100);
  const knownBytes = sumKnownSizeBytes(photos);
  const totalGB = formatGB(knownBytes);
  const freedBytes = sumKnownSizeBytes(deletableRejected);
  const freedGB = formatGB(freedBytes);
  // "0.0" nu inseamna "zero octeti", inseamna "sub 50 MB" sau "poze importate
  // inainte sa existe campul de marime". In ambele cazuri, nu e o cifra de
  // aratat — vezi state/storageStats.ts.
  const hasKnownSize = totalGB !== '0.0';
  const hasKnownFreed = freedGB !== '0.0';
  // In inel incap trei-patru caractere. Peste o mie de poze, cifrele absolute
  // n-ar mai fi lizibile, iar procentul de langa el le spune oricum.
  const ringLabel = photos.length <= 999 ? `${decidedCount}/${photos.length}` : `${donePercent}%`;
  // Review Desk este punctul central al noii experiente, nu doar un mesaj pentru
  // fotografiile ambigue. Daca AI a decis tot lotul, pastram cardul vizibil cu
  // prima fotografie din sesiune ca intrare spre revedere si biblioteca completa.
  const reviewDeskPhoto = photos.find(p => p.status === 'pending' || p.status === 'review') ?? photos[0] ?? null;
  const hasReviewQueue = unsortedCount > 0;

  const openRecap = () => { setPresentationPhotoIds(recapPhotos.map(p => p.id)); setPresentationOpen(true); };
  const doDelete = async () => {
    const ok = await askConfirm(tr('batch.deleteRejected.confirm', { count: deletableRejected.length }), { confirmLabel: tr('home.delete.cta'), danger: true });
    if (!ok) return;
    setDeleting(true);
    try { await deleteRejectedPhotos(); } finally { setDeleting(false); }
  };

  return (
    <div className="home-dash concept-home">
      <div className="home-greet">
        <span className="home-greet-hello">{tr(greetingKey(now.getHours()))}</span>
        {/* Sub-randul dispare cat timp cardul de rezumat e pe ecran: amandoua
            spuneau acelasi numar cu alte cuvinte ("2 poze de curatat" / "ti-am
            lasat 2 de verificat"), plus butonul de sortare de mai jos — de trei
            ori acelasi lucru pe un ecran de care utilizatorul s-a plans ca e
            "bombardat cu info". */}
        {unsortedCount > 0 && !hasOutcome && (
          <span className="home-greet-sub">
            <SparkleIcon className="inline-icon" aria-hidden="true" />{' '}
            {tr(plural(unsortedCount, 'home.greet.unsorted.one', 'home.greet.unsorted.other'), { count: unsortedCount })}
          </span>
        )}
      </div>

      {/* Ce tocmai s-a intamplat, imediat sub salut. Statea la BAZA paginii, sub
          toate butoanele — adica rezumatul unei actiuni terminate acum se citea
          ultimul, dupa ce parcurgeai tot ce ai de facut. */}
      <SessionOutcome />

      {reviewDeskPhoto && (
        <>
        <div className="review-desk-session" aria-label="Rezumat sesiune">
          <span><b>{photos.filter(p => p.status === 'selected').length}</b> păstrate</span>
          <span><b>{photos.filter(p => p.status === 'rejected').length}</b> respinse</span>
        </div>
        <section className="review-desk-card" aria-label={tr('reviewDesk.label')}>
          <ReviewDeskPreview photo={reviewDeskPhoto} />
          <div className="review-desk-shade" />
          <div className="review-desk-content">
            <div className="review-desk-topline">
              <span className="mono">{tr('reviewDesk.label')}</span>
              <span className="mono">{decidedCount}/{photos.length} · {donePercent}%</span>
            </div>
            <div className="review-desk-file mono">{reviewDeskPhoto.fileName}</div>
            <p className="review-desk-kicker mono">{tr(hasReviewQueue ? 'reviewDesk.kicker.next' : 'reviewDesk.kicker.ready')}</p>
            <h2>{hasReviewQueue
              ? tr(plural(unsortedCount, 'reviewDesk.title.one', 'reviewDesk.title.other'), { count: unsortedCount })
              : tr('reviewDesk.title.ready')}</h2>
            <p>{tr(hasReviewQueue ? 'reviewDesk.lead.next' : 'reviewDesk.lead.ready')}</p>
            <div className="review-desk-actions">
              <button className="review-desk-continue" onClick={() => hasReviewQueue ? setTiktokSortOpen(true) : (setHomeGridOpen(true), openDetail(reviewDeskPhoto.id))}>
                {tr(hasReviewQueue ? 'reviewDesk.continue' : 'reviewDesk.open')} <ChevronRight />
              </button>
              {hasReviewQueue && <button className="review-desk-secondary" onClick={() => setTiktokSortOpen(true)}>
                <ChevronUpIcon /> {tr('menu.quickSort')}
              </button>}
              <button className="review-desk-library" onClick={() => { setHomeGridOpen(true); openDetail(reviewDeskPhoto.id); }}>
                <GridIcon /> {tr('reviewDesk.library')}
              </button>
            </div>
          </div>
        </section>
        </>
      )}

      <div className="home-hero-card glass">
        <div className="home-hero-text">
          <div className="home-hero-num">{donePercent}%</div>
          <div className="home-hero-lbl">{tr('home.hero.label')}</div>
          {/* Doar cand chiar stim niste octeti. Pentru cine tocmai a adus sase
              poze, "0.0GB" nu e o informatie, e zgomot — si, pus intr-un inel
              fara eticheta, arata ca o masura a intregului telefon. */}
          {hasKnownSize && <div className="home-hero-size">{tr('home.hero.size', { gb: totalGB })}</div>}
        </div>
        {/* Inelul arata acelasi progres ca procentul, in cifre absolute: cate
            poze din cate ai decis. */}
        <div
          className="home-hero-ring"
          style={{ '--pct-deg': `${donePercent * 3.6}deg` } as CSSProperties}
          title={tr('home.hero.ringTitle')}
          aria-label={tr('home.hero.ringTitle')}
        >
          <b>{ringLabel}</b>
        </div>
      </div>

      {unsortedCount > 0 && (
        <button className="home-sort-cta" onClick={() => setTiktokSortOpen(true)}>
          <span className="home-sort-icon" aria-hidden="true"><ChevronUpIcon /></span>
          <span className="home-sort-text">
            <b>{tr('home.sortCta.title')}</b>
            <span>{tr(plural(unsortedCount, 'home.sortCta.sub.one', 'home.sortCta.sub.other'), { count: unsortedCount })}</span>
          </span>
          <span className="home-sort-go">{tr('home.sortCta.go')}</span>
        </button>
      )}

      {isNativeMediaLibraryAvailable() && deletableRejected.length > 0 && (
        <div className="home-delete-cta">
          <span className="home-delete-text">
            <b>{tr(plural(deletableRejected.length, 'home.delete.title.one', 'home.delete.title.other'), { count: deletableRejected.length })}</b>
            {/* "eliberezi 0.0 GB" nu e un argument, e o gluma involuntara. */}
            {hasKnownFreed && <span>{tr('home.delete.sub', { gb: freedGB })}</span>}
          </span>
          {/* aria-busy + eticheta care se schimba — bug real gasit de auditul UI:
              stergerea nativa a pozelor respinse poate dura zeci de secunde, iar
              singurul semn ca se intampla ceva era ca butonul se stingea. Pentru
              un cititor de ecran asta e indistinct de "butonul s-a dezactivat,
              actiunea nu mai e disponibila". */}
          <button className="home-delete-go" disabled={deleting} aria-busy={deleting} onClick={() => void doDelete()}>
            {deleting ? tr('workspace.progress.processing') : tr('home.delete.cta')}
          </button>
        </div>
      )}

      {shieldPendingCount > 0 && (
        <button className="home-shield-cta" onClick={() => setDocumentShieldOpen(true)}>
          <span className="home-shield-icon" aria-hidden="true"><ShieldIcon /></span>
          <span className="home-shield-text">
            <b>{tr(plural(shieldPendingCount, 'shield.home.title.one', 'shield.home.title.other'), { count: shieldPendingCount })}</b>
            <span>{tr('shield.home.sub')}</span>
          </span>
        </button>
      )}

      {recapPhotos.length >= RECAP_TEASER_MIN_PHOTOS && (
        <button className="home-recap-card" onClick={openRecap}>
          <span className="home-recap-icon" aria-hidden="true">🎬</span>
          <span className="home-recap-text">
            <b>{tr('home.recap.title')}</b>
            <span>{tr(plural(recapPhotos.length, 'home.recap.sub.one', 'home.recap.sub.other'), { count: recapPhotos.length })}</span>
          </span>
        </button>
      )}

      {/* Randul de jos: cifre secundare, intr-un singur rand de pastile, nu in
          carduri late cat ecranul. Erau trei suprafete de aceeasi greutate
          vizuala ca actiunea principala, pentru informatii pe care le citesti
          din coltul ochiului. */}
      {(streak > 1 || locationCount > 0 || duplicateGroupCount > 0) && (
        <div className="home-stat-row">
          {/* Singura pastila care NU se apasa (nu are ce deschide: e o simpla
              numaratoare) — observatie a utilizatorului: "am apasat si nu s-a
              intamplat nimic". Acum se si vede ca e alta: fara contur de buton. */}
          {streak > 1 && (
            <span className="home-mini-chip home-mini-chip-static" title={tr('home.streak.title')}>
              <span className="home-mini-num">🔥 <AnimatedNumber value={streak} /></span>
              <span className="home-mini-lbl">{tr(plural(streak, 'home.streak.label.one', 'home.streak.label.other'), { count: streak })}</span>
            </span>
          )}
          {locationCount > 0 && (
            <button className="home-mini-chip" onClick={() => setLocationsOpen(true)}>
              <span className="home-mini-num"><PinIcon className="inline-icon" aria-hidden="true" /> <AnimatedNumber value={locationCount} /></span>
              <span className="home-mini-lbl">{tr(plural(locationCount, 'home.locations.label.one', 'home.locations.label.other'), { count: locationCount })}</span>
            </button>
          )}
          {duplicateGroupCount > 0 && (
            <button className="home-mini-chip" onClick={() => setDuplicatesPanelOpen(true)}>
              <span className="home-mini-num"><CopyIcon className="inline-icon" aria-hidden="true" /> <AnimatedNumber value={duplicateGroupCount} /></span>
              <span className="home-mini-lbl">{tr(plural(duplicateGroupCount, 'duplicates.count.one', 'duplicates.count.other'), { count: duplicateGroupCount })}</span>
            </button>
          )}
        </div>
      )}

      {/* Ultimul, nu al treilea rand de sus: e o intrebare optionala despre
          telefon, nu un pas din triajul de acum. */}
      <GalleryOverviewNote />
    </div>
  );
}
