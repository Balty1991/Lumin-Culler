import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useStore, type PhotoView } from '../state/store';
import { pickResumeTarget } from '../state/resumeProject';
import { getCachedPreviewUrl } from '../core/previewUrlCache';
import { AdjustedImage } from './AdjustedImage';
import { computeImportStreak } from '../state/streak';
import { countRealLocations } from '../state/locations';
import { selectMonthlyRecap } from '../state/monthlyRecap';
import { selectDeletableRejected, isUserDecided } from '../state/batchOps';
import { sumKnownSizeBytes, formatGB } from '../state/storageStats';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { selectPendingShieldReview, readShieldDismissedIds } from '../core/documentShield';
import { selectUnresolvedGroups } from '../state/duplicateGroups';
import { AnimatedNumber } from './AnimatedNumber';
import { GalleryOverviewNote } from './GalleryOverviewNote';
import { QuickScanFind } from './QuickScanFind';
import { CullStrengthBar } from './CullStrengthBar';
import { SessionOutcome } from './SessionOutcome';
import { SparkleIcon, PinIcon, ChevronUpIcon, ShieldIcon, CopyIcon, TrashIcon } from './icons';
import { t, plural } from '../i18n';
import { formatEta } from '../core/formatTime';

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
    <div className="review-desk-media" aria-hidden="true">
      {src ? <AdjustedImage src={src} edits={photo.edits} alt="" /> : <span className="review-desk-media-fallback" />}
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
  const openTiktokSortForIds = useStore(s => s.openTiktokSortForIds);
  const setHomeGridOpen = useStore(s => s.setHomeGridOpen);
  const homeGridOpen = useStore(s => s.homeGridOpen);
  /**
   * Cat timp analiza inca ruleaza, cardul NU are voie sa anunte o coada gata.
   *
   * Raportat de utilizator, cu captura: ecranul de analiza se randeaza SUB
   * cardul asta (vezi App.tsx), deci amandoua sunt pe ecran in acelasi timp —
   * sus scria "4 poze de trecut in revista" ca si cum triajul ar fi gata, in
   * timp ce dedesubt motorul inca citea pozele. Iar numarul era oricum
   * provizoriu: creste cu fiecare poza terminata.
   */
  const progress = useStore(s => s.progress);
  const analysing = !!progress && progress.phase !== 'finalizat';
  const cancelImport = useStore(s => s.cancelImport);
  const importCancelling = useStore(s => s.importCancelling);
  const setDocumentShieldOpen = useStore(s => s.setDocumentShieldOpen);
  const setDuplicatesPanelOpen = useStore(s => s.setDuplicatesPanelOpen);
  const collections = useStore(s => s.collections);
  const deleteRejectedPhotos = useStore(s => s.deleteRejectedPhotos);
  const askConfirm = useStore(s => s.askConfirm);
  const clearAll = useStore(s => s.clearAll);
  const setSupervisorPanelOpen = useStore(s => s.setSupervisorPanelOpen);
  /** Cardul de rezumat e pe ecran — sub-randul din salut ar spune acelasi lucru. */
  const hasOutcome = useStore(s => s.sessionOutcome !== null);
  const [deleting, setDeleting] = useState(false);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const setProjectFilter = useStore(s => s.setProjectFilter);
  const setFilter = useStore(s => s.setFilter);
  // Peste pozele deja in memorie, fara nicio citire: doar proiect + stare.
  const resumeTarget = useMemo(
    () => pickResumeTarget(photos.map(p => ({ project: p.project, status: p.status }))),
    [photos]
  );

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

  // Bug masurat la auditul de interfata: dupa un tap pe "Biblioteca", prima
  // miniatura ajungea la 1058px — peste un ecran intreg (915) sub linia de
  // plutire. Tabul principal spre poze cerea deci o derulare oarba ca sa faca
  // ce promite, iar ce vedeai imediat era acelasi ecran Acasa, cu tabul
  // Biblioteca aprins.
  //
  // Cauza: `homeGridOpen` ascundea doar sectiunea Review Desk de mai jos, nu si
  // restul dashboardului — inelul de progres, cardul de sortare rapida, "Vezi
  // toate fotografiile", chipsurile — care ramaneau stivuite peste grila.
  //
  // Dar ele sunt ecranul ACASA. Cand omul a cerut explicit grila, grila e
  // raspunsul; dashboardul se intoarce la un tap pe "Acasa" (vezi goHome in
  // BottomNav.tsx). Asta e chiar impartirea pe care o descrie comentariul lui
  // homeGridOpen din store.ts: Acasa curat, grila la cerere — doar ca pana
  // acum a doua parte nu se intampla.
  if (photos.length === 0 || homeGridOpen) return null;

  // "de curatat" = tot ce nu e inca decis (pending + review), nu doar 'review'
  // (subsetul ambiguu semnalat de AI) — altfel numarul arata mult mai mic
  // decat coada reala de sortat pe care utilizatorul chiar o are.
  const unsortedCount = photos.filter(p => p.status === 'pending' || p.status === 'review').length;
  // Candidatul se numara ca decizie luata — omul chiar s-a hotarat sa n-o
  // arunce si sa n-o dea inca mai departe. Aceeasi regula ca in
  // state/resumeProject.ts si in inelul din CullGauge.
  const decidedCount = photos.filter(p => isUserDecided(p.status)).length;
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
  /**
   * Textul de sub titlu cat timp motorul lucreaza. Raspunde la singurele doua
   * intrebari pe care le are omul cand se uita la o bara: cate au fost facute
   * si cat mai dureaza. Fara estimare (la inceput, sau la incarcarea modelelor)
   * spune doar unde s-a ajuns — o estimare inventata e mai rea decat niciuna.
   */
  const analysedTotal = progress ? (progress.total || photos.length) : photos.length;
  const analysedPercent = progress
    ? Math.max(3, Math.min(100, Math.round((progress.done / Math.max(1, analysedTotal)) * 100)))
    : 0;
  const analysingLead = !progress
    ? ''
    : progress.phase === 'incarcare'
      ? tr('reviewDesk.lead.loading')
      : progress.etaSeconds !== undefined
        ? tr('reviewDesk.lead.analysingEta', { done: progress.done, total: analysedTotal, eta: formatEta(progress.etaSeconds) })
        : tr('reviewDesk.lead.analysing', { done: progress.done, total: analysedTotal });
  const hasReviewQueue = unsortedCount > 0;

  const selectedCount = photos.filter(p => p.status === 'selected').length;
  const rejectedCount = photos.filter(p => p.status === 'rejected').length;

  /** Aceeasi plasa de siguranta ca in App.tsx: golirea sesiunii e ireversibila. */
  const confirmClearSession = async () => {
    const ok = await askConfirm(tr('app.clearSession.confirm', { count: photos.length }), { danger: true });
    if (ok) await clearAll();
  };

  /**
   * Sortarea rapida peste TOT lotul, in ordine cronologica — nu doar peste
   * coada nedecisa (selectSortQueue, care filtreaza pending/review). Asa se
   * poate reveni si peste o decizie deja luata, cu recomandarea AI si
   * metricile la indemana, fara sa treci prin grila.
   */
  const openQuickSortAll = () => {
    // Bug real gasit la testare pe telefon: cardul anunta "29 poze de trecut in
    // revista" (unsortedCount), iar butonul de sub el deschidea TOATA
    // biblioteca — 77 de poze, adica si cele 48 pe care AI-ul le decisese deja.
    // Utilizatorul era pus sa treaca prin poze despre care nimeni nu-l
    // intrebase nimic, ca sa ajunga la cele 29 promise.
    //
    // Coada urmeaza acum promisiunea de deasupra ei: exact pozele nedecise.
    // Cand nu mai e nimic de decis, butonul isi schimba oricum eticheta in
    // "Deschide" si atunci a trece prin toata biblioteca e chiar ce trebuie —
    // e o revedere, nu o coada.
    const queue = hasReviewQueue
      ? photos.filter(p => p.status === 'pending' || p.status === 'review')
      : photos;
    const ids = queue
      .slice()
      .sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0))
      .map(p => p.id);
    if (ids.length > 0) openTiktokSortForIds(ids);
  };

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

      {/* Intrebarea despre gen a PLECAT de aici, in meniu (vezi MenuDrawer,
          "Genurile mele"). Cerinta utilizatorului: "mai bine il selecteaza
          utilizatorul apoi din meniu... ca sa nu amestece genurile".

          Are dreptate si pe fond, nu doar ca asezare: intrebarea aparea peste
          ecranul de start, inainte ca omul sa fi triat ceva, deci se raspundea
          la ghici. Genul hotaraste pe ce model se invata; un raspuns dat in
          graba amesteca invatarea de la prima sesiune. In meniu, alegerea e
          deliberata si se poate schimba oricand, fara sa fie o poarta prin
          care treci o singura data. */}

      {/* Ce tocmai s-a intamplat, imediat sub salut. Statea la BAZA paginii, sub
          toate butoanele — adica rezumatul unei actiuni terminate acum se citea
          ultimul, dupa ce parcurgeai tot ce ai de facut. */}
      <SessionOutcome />

      {/* Reluarea unui proiect intrerupt. Costul care lasa sesiunile
          neterminate nu e efortul, ci REINTRAREA: la revenire, aplicatia arata
          ce arata oricui, si trebuie sa-ti amintesti singur unde ramasesesi.
          Vezi state/resumeProject.ts pentru cand merita propus si cand nu. */}
      {resumeTarget && (
        <div className="resume-card">
          <div className="resume-copy">
            <span className="resume-kicker mono">{tr('resume.title')}</span>
            <p>{tr('resume.body', {
              project: resumeTarget.project,
              remaining: resumeTarget.remaining,
              percent: resumeTarget.percent
            })}</p>
          </div>
          <button
            className="btn-accent resume-cta"
            onClick={() => { setProjectFilter(resumeTarget.project); setFilter('review'); }}
          >
            {tr('resume.cta')}
          </button>
        </div>
      )}

      {/* Review Desk — structura vine din build-ul de referinta (release
          apk-referinta). Ce era aici inainte purta aceleasi nume de clase, dar
          era alt aranjament: un singur card, fara randul de sesiune cu actiune
          pe respinse, fara subsolul cu numele fisierului si fara lista de
          biblioteca de dedesubt. CSS-ul corespunzator e in styles.concept.css. */}
      {reviewDeskPhoto && (
        <div className="review-desk">
          <header className="review-desk-head">
            <div className="review-desk-head-line">
              <div>
                <span className="review-desk-eyebrow">{tr('reviewDesk.label')}</span>
                <span className="review-desk-session">{decidedCount}/{photos.length} · {donePercent}%</span>
              </div>
              {/* Garda `!homeGridOpen` de aici a disparut fiindca nu mai are ce
                  pazi: dashboardul intreg nu se mai randeaza cand grila e
                  deschisa (vezi iesirea de sus). Grija de dinainte — ca cea mai
                  distructiva actiune din aplicatie sa nu apara de doua ori pe
                  acelasi ecran, si aici, si in CullGauge — se rezolva acum de la
                  sine: cele doua nu mai coexista niciodata. */}
              <button className="review-desk-reset" onClick={() => void confirmClearSession()}>{tr('app.clearSession')}</button>
            </div>
            <div className="review-desk-session-rail" aria-label={tr('reviewDesk.sessionSummary')}>
              <span className="review-desk-session-stat is-selected">
                <b>{selectedCount}</b> {tr('reviewDesk.kept')}
              </span>
              {deletableRejected.length > 0 ? (
                <button className="review-desk-rejected-action" onClick={() => void doDelete()} disabled={deleting}>
                  <TrashIcon aria-hidden="true" />
                  <span>{tr('reviewDesk.deleteRejected', { count: deletableRejected.length })}</span>
                </button>
              ) : (
                <span className="review-desk-session-stat">
                  <b>{rejectedCount}</b> {tr('reviewDesk.rejected')}
                </span>
              )}
            </div>
          </header>

          <section className="review-desk-stage" aria-label={tr('reviewDesk.label')}>
            <ReviewDeskPreview photo={reviewDeskPhoto} />
            <div className="review-desk-overlay" />
            <div className="review-desk-content">
              <span className="review-desk-kicker">{tr(analysing ? 'reviewDesk.kicker.analysing' : hasReviewQueue ? 'reviewDesk.kicker.next' : 'reviewDesk.kicker.ready')}</span>
              <h2>{analysing
                ? tr('reviewDesk.title.analysing')
                : hasReviewQueue
                  ? tr(plural(unsortedCount, 'home.sortCta.sub.one', 'home.sortCta.sub.other'), { count: unsortedCount })
                  : tr('reviewDesk.title.ready')}</h2>
              {/* Cerinta directa a utilizatorului: dupa import, acelasi lucru
                  aparea in doua locuri — cardul asta ("AI-ul citeste
                  fotografiile") si cardul ANALYSIS STUDIO de dedesubt. Studioul
                  a ramas doar pentru biblioteca goala (App.tsx), iar tot ce
                  spunea el — cate poze, cat mai dureaza, cat s-a facut, si
                  anularea — a venit aici, intr-un singur loc. */}
              <p>{analysing ? analysingLead : tr(hasReviewQueue ? 'reviewDesk.lead.next' : 'reviewDesk.lead.ready')}</p>
              {analysing && (
                <div
                  className="review-desk-progress"
                  role="progressbar"
                  aria-valuenow={progress.done}
                  aria-valuemin={0}
                  aria-valuemax={progress.total || photos.length}
                >
                  <span style={{ width: `${analysedPercent}%` }} />
                </div>
              )}
              {/* Primul rezultat concret al importului (copii identice gasite,
                  spatiu irosit) statea pe cardul studio. Se muta odata cu
                  progresul, altfel al doilea import nu l-ar mai fi aratat. */}
              {analysing && <QuickScanFind />}
              <div className="review-desk-actions">
                <button className="review-desk-continue" onClick={() => openQuickSortAll()}>
                  <span>{tr(hasReviewQueue ? 'reviewDesk.continue' : 'reviewDesk.open')}</span>
                  <span aria-hidden="true">→</span>
                </button>
                {/* Anularea importului statea pe cardul studio, care nu mai apare
                    aici — fara ea, un import de mii de poze pornit din greseala
                    n-ar mai fi avut buton de oprire pe ecranul principal. */}
                {analysing && progress.phase === 'analiza' && (
                  <button className="review-desk-cancel" onClick={() => cancelImport()} disabled={importCancelling}>
                    {importCancelling ? tr('app.progress.cancelling') : tr('app.progress.cancel')}
                  </button>
                )}
                {/* Al doilea buton spre biblioteca a fost scos odata cu bara de
                    navigare pe patru spatii: "Bibliotecă" e acum un tab
                    permanent, iar cardul asta avea deja o a doua usa spre
                    acelasi loc, imediat sub el. Cu tab-ul, ecranul de acasa
                    ajunsese sa aiba TREI intrari in aceeasi biblioteca — exact
                    genul de butoane care fac acelasi lucru. Ramane un singur
                    CTA dominant: ce urmeaza de facut. */}
              </div>
            </div>
            {/* Eticheta cardului aparea de DOUA ori pe acelasi card — o data in
                antet, o data aici, la 30px distanta. Ramane numele fisierului,
                singura informatie pe care antetul n-o are deja. */}
            <div className="review-desk-stage-footer">
              <span>{reviewDeskPhoto.fileName}</span>
            </div>
          </section>

          {/* IMEDIAT sub cardul cu poza urmatoare, si inaintea bibliotecii:
              raspunde la intrebarea care apare fix atunci ("de ce imi propune
              astea?"), nu la una pe care ar trebui s-o cauti in meniu. */}
          <CullStrengthBar />

          <section className="review-desk-library" aria-label={tr('reviewDesk.libraryLabel')}>
            <button onClick={() => setHomeGridOpen(true)}>
              <span className="review-desk-library-label">{tr('reviewDesk.libraryLabel')}</span>
              <b>{tr('reviewDesk.library')}</b>
              <span className="review-desk-library-count">{photos.length}</span>
            </button>
            {/* Calea explicita spre urmatoarea perioada, de cand bannerul nu o mai
                propune singur dupa fiecare import. */}
            {isNativeMediaLibraryAvailable() && (
              <button className="review-desk-period-link" onClick={() => setSupervisorPanelOpen(true)}>
                <span>{tr('reviewDesk.nextPeriod')}</span>
                <span aria-hidden="true">→</span>
              </button>
            )}
          </section>
        </div>
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
