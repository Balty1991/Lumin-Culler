import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { db, type AnalysisRecord } from '../core/db';
import { useStore, type PhotoView } from '../state/store';
import { explainFactors } from '../core/learning/ContextEngine';
import { generateExplanation, generateSuggestions, type Suggestion } from '../core/aiExplanationGenerator';
import { Histogram } from './Histogram';
import { FocusMap } from './FocusMap';
import { AnimatedNumber } from './AnimatedNumber';
import { XIcon, CheckIcon, EyeClosedIcon, SparkleIcon, ClockIcon, SunIcon } from './icons';
import { t, type Locale } from '../i18n';
import { translateSceneTag } from '../core/sceneTagLabels';
import { hasRealGps } from '../core/gpsCoordinates';
import { usePlaceName } from './usePlaceName';

type Tab = 'metrics' | 'why' | 'persons' | 'history';
const TAB_KEYS: { key: Tab; labelKey: string }[] = [
  { key: 'metrics', labelKey: 'detail.tab.metrics' },
  { key: 'why', labelKey: 'detail.tab.why' },
  { key: 'persons', labelKey: 'detail.tab.persons' },
  { key: 'history', labelKey: 'detail.tab.history' }
];

function StatTile({ label, value, warn }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className={warn ? 'stat-tile warn' : 'stat-tile'}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function formatShutter(seconds: number): string {
  if (seconds >= 1) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
  return `1/${Math.round(1 / seconds)}s`;
}

/** Linie compacta EXIF (ISO · diafragma · viteza · focala) — string gol daca nu exista deloc metadate. */
function formatExif(photo: { iso?: number; fNumber?: number; exposureTime?: number; focalLength?: number }): string {
  const parts: string[] = [];
  if (photo.iso !== undefined) parts.push(`ISO ${Math.round(photo.iso)}`);
  if (photo.fNumber !== undefined) parts.push(`f/${photo.fNumber.toFixed(photo.fNumber < 10 ? 1 : 0)}`);
  if (photo.exposureTime !== undefined && photo.exposureTime > 0) parts.push(formatShutter(photo.exposureTime));
  if (photo.focalLength !== undefined) parts.push(`${Math.round(photo.focalLength)}mm`);
  return parts.join(' · ');
}

/** "Panou de informatii extins" (plan 3.2.2) — randuri camera/obiectiv/locatie pentru Metrici, dincolo de linia compacta ISO/diafragma/timp/focala de mai sus. */
function extendedExifRows(photo: {
  cameraMake?: string; cameraModel?: string; lensModel?: string; focalLength35mm?: number;
  exposureBias?: number; meteringMode?: string; flashFired?: boolean; whiteBalance?: 'auto' | 'manual';
  gpsLatitude?: number; gpsLongitude?: number; gpsAccuracyM?: number; exifArtist?: string; exifCopyright?: string; exifSoftware?: string;
}, tr: (key: string, params?: Record<string, string | number>) => string): { key: string; label: string; value: string }[] {
  const rows: { key: string; label: string; value: string }[] = [];
  const camera = [photo.cameraMake, photo.cameraModel].filter(Boolean).join(' ');
  if (camera) rows.push({ key: 'camera', label: tr('detail.exif.camera'), value: camera });
  if (photo.lensModel) rows.push({ key: 'lens', label: tr('detail.exif.lens'), value: photo.lensModel });
  if (photo.focalLength35mm !== undefined) rows.push({ key: 'focalLength35mm', label: tr('detail.exif.focalLength35mm'), value: `${Math.round(photo.focalLength35mm)}mm` });
  if (photo.exposureBias !== undefined && photo.exposureBias !== 0) {
    rows.push({ key: 'exposureBias', label: tr('detail.exif.exposureBias'), value: `${photo.exposureBias > 0 ? '+' : ''}${photo.exposureBias.toFixed(1)} EV` });
  }
  if (photo.meteringMode) rows.push({ key: 'metering', label: tr('detail.exif.metering'), value: photo.meteringMode });
  if (photo.flashFired !== undefined) rows.push({ key: 'flash', label: tr('detail.exif.flash'), value: photo.flashFired ? tr('detail.exif.flash.yes') : tr('detail.exif.flash.no') });
  if (photo.whiteBalance) rows.push({ key: 'whiteBalance', label: tr('detail.exif.whiteBalance'), value: photo.whiteBalance === 'auto' ? tr('detail.exif.whiteBalance.auto') : tr('detail.exif.whiteBalance.manual') });
  // hasRealGps, nu doar "au valoare": bug real raportat de utilizator, cu
  // captura — panoul arata "Locatie GPS: 0.00000, 0.00000" pentru poze carora
  // Android le redactase locatia lasand tag-urile pe zero. Vezi
  // core/gpsCoordinates.ts. Un rand lipsa spune adevarul; 0,0 minte.
  if (hasRealGps(photo.gpsLatitude, photo.gpsLongitude)) {
    rows.push({ key: 'gps', label: tr('detail.exif.gps'), value: `${photo.gpsLatitude!.toFixed(5)}, ${photo.gpsLongitude!.toFixed(5)}` });
  }
  if (photo.exifArtist) rows.push({ key: 'artist', label: tr('detail.exif.artist'), value: photo.exifArtist });
  if (photo.exifCopyright) rows.push({ key: 'copyright', label: tr('detail.exif.copyright'), value: photo.exifCopyright });
  if (photo.exifSoftware) rows.push({ key: 'software', label: tr('detail.exif.software'), value: photo.exifSoftware });
  return rows;
}

/** Randuri IPTC-IIM (segment Photoshop APP13, distinct de EXIF) — vezi core/iptcParser.ts. */
function iptcRows(photo: {
  iptcByline?: string; iptcCaption?: string; iptcHeadline?: string; iptcCredit?: string;
  iptcSource?: string; iptcCopyright?: string; iptcCity?: string; iptcCountry?: string; iptcKeywords?: string[];
}, tr: (key: string, params?: Record<string, string | number>) => string): { key: string; label: string; value: string }[] {
  const rows: { key: string; label: string; value: string }[] = [];
  if (photo.iptcHeadline) rows.push({ key: 'headline', label: tr('detail.iptc.headline'), value: photo.iptcHeadline });
  if (photo.iptcCaption) rows.push({ key: 'caption', label: tr('detail.iptc.caption'), value: photo.iptcCaption });
  if (photo.iptcByline) rows.push({ key: 'byline', label: tr('detail.iptc.byline'), value: photo.iptcByline });
  if (photo.iptcCredit) rows.push({ key: 'credit', label: tr('detail.iptc.credit'), value: photo.iptcCredit });
  if (photo.iptcSource) rows.push({ key: 'source', label: tr('detail.iptc.source'), value: photo.iptcSource });
  const location = [photo.iptcCity, photo.iptcCountry].filter(Boolean).join(', ');
  if (location) rows.push({ key: 'location', label: tr('detail.iptc.location'), value: location });
  if (photo.iptcCopyright) rows.push({ key: 'copyright', label: tr('detail.iptc.copyright'), value: photo.iptcCopyright });
  if (photo.iptcKeywords?.length) rows.push({ key: 'keywords', label: tr('detail.iptc.keywords'), value: photo.iptcKeywords.join(', ') });
  return rows;
}

/** Timp relativ scurt — suficient de precis pentru un istoric de minute/ore, nu o audiere legala. */
function formatRelativeTime(ts: number, locale: Locale): string {
  const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diffSec < 5) return t(locale, 'detail.relativeTime.now');
  if (diffSec < 60) return t(locale, 'detail.relativeTime.seconds', { n: diffSec });
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return t(locale, 'detail.relativeTime.minutes', { n: diffMin });
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return t(locale, 'detail.relativeTime.hours', { n: diffH });
  const diffD = Math.round(diffH / 24);
  return t(locale, 'detail.relativeTime.days', { n: diffD });
}

// acelasi prag ca SELECT_THRESHOLD din core/importPipeline.ts (si train() din state/store.ts) —
// "ce ar recomanda AI-ul" pentru explicatia narativa de mai jos
const AI_SELECT_THRESHOLD = 65;

/**
 * Explicatia narativa (paragrafe) pentru scorul AI — incarcata lenes (AnalysisRecord + ContextModelRecord
 * complete nu fac parte din PhotoView), doar cat timp tab-ul "De ce acest scor" e deschis.
 *
 * Restructurat dupa feedback direct pe device real: o incercare anterioara
 * muta verdictul PRIM si ascundea restul rationamentului sub un toggle
 * "Detalii" — feedback a fost clar ca asta nu era ce se astepta ("au pus sus
 * partea cu deciziile AI din trecut") si ca rationamentul complet ar trebui
 * expus direct, doar afisat mai curat. Acum: ordinea NATURALA (tehnic ->
 * compozitie -> subiect -> estetica -> factori -> verdict), toate randate
 * direct, dar intr-un singur card unitar (nu N cutii separate suprapuse) —
 * verdictul ramane ultimul, distins doar printr-o linie de separare si text
 * ingrosat, ca o concluzie dupa rationament, nu ca titlu. Sugestiile raman
 * impartite explicit intre ce se poate repara ACUM (cu buton "Aplica", vezi
 * openEdit autoApply mai jos) si ce ramane sfat pentru urmatorul cadru.
 */
function WhyExplanation({ photo }: { photo: PhotoView }) {
  const locale = useStore(s => s.locale);
  const openEdit = useStore(s => s.openEdit);
  const [paragraphs, setParagraphs] = useState<string[] | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  useEffect(() => {
    let alive = true;
    setParagraphs(null);
    setSuggestions([]);
    void Promise.all([db.analyses.get(photo.id), db.contextModels.get(photo.contextKey)]).then(
      ([analysis, contextModel]) => {
        if (!alive || !analysis) return;
        const aiDecision = photo.aiScore >= AI_SELECT_THRESHOLD;
        const userDecision = photo.status === 'selected' ? true : photo.status === 'rejected' ? false : null;
        setParagraphs(generateExplanation(analysis as AnalysisRecord, aiDecision, userDecision, contextModel ?? null, locale));
        setSuggestions(generateSuggestions(analysis as AnalysisRecord, locale));
      }
    );
    return () => { alive = false; };
  }, [photo.id, photo.contextKey, photo.aiScore, photo.status, locale]);

  if (paragraphs === null) return <p className="hint"><SparkleIcon className="inline-icon spin" /> {t(locale, 'detail.why.loading')}</p>;
  const now = suggestions.filter(s => s.when === 'now');
  const nextTime = suggestions.filter(s => s.when === 'nextTime');

  return (
    <div className="why-explanation">
      <div className="why-explanation-card">
        {paragraphs.map((p, i) => (
          <p key={i} className={i === paragraphs.length - 1 ? 'why-verdict-line' : undefined}>{p}</p>
        ))}
      </div>
      {(now.length > 0 || nextTime.length > 0) && (
        <div className="why-suggestions">
          <h4 className="why-suggestions-title mono"><SparkleIcon className="inline-icon" /> {t(locale, 'detail.why.suggestions.title')}</h4>
          {now.length > 0 && (
            <div className="why-suggestions-group">
              <span className="why-suggestions-group-label mono">{t(locale, 'detail.why.suggestions.now')}</span>
              <ul>
                {now.map((s, i) => (
                  <li key={i}>
                    <span>{s.text}</span>
                    <button type="button" className="ghost slim why-suggestion-apply" onClick={() => openEdit(photo.id, { autoApply: true })}>
                      {t(locale, 'detail.why.suggestions.apply')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {nextTime.length > 0 && (
            <div className="why-suggestions-group">
              <span className="why-suggestions-group-label mono">{t(locale, 'detail.why.suggestions.nextTime')}</span>
              <ul>
                {nextTime.map((s, i) => <li key={i}>{s.text}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
      {suggestions.length === 0 && (
        <div className="why-suggestions">
          <h4 className="why-suggestions-title mono"><SparkleIcon className="inline-icon" /> {t(locale, 'detail.why.suggestions.title')}</h4>
          <p className="hint">{t(locale, 'detail.why.suggestions.none')}</p>
        </div>
      )}
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 65 ? 'var(--pick)' : score <= 35 ? 'var(--reject)' : 'var(--review)';
  const deg = Math.max(0, Math.min(360, Math.round((score / 100) * 360)));
  return (
    <div className="score-ring" style={{ background: `conic-gradient(${color} ${deg}deg, var(--surface-3) 0)` }}>
      <span className="score-ring-inner" style={{ color }}><AnimatedNumber value={score} /></span>
    </div>
  );
}

/**
 * Tab-urile Metrici/De ce acest scor/Persoane/Istoric — extrase din DetailView ca sa poata
 * fi montate identic si in Workspace (paritate ceruta explicit: "vreau tot asa, sa am
 * informatii complete"), fara sa duplice tile-uri/EXIF/histograma/harta de focalizare.
 */
export function PhotoInfoTabs({ photo, src }: { photo: PhotoView; src: string | null }) {
  const history = useStore(s => s.history);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const [tab, setTab] = useState<Tab>('metrics');
  /**
   * Numele localitatii pentru randul de locatie de mai jos — cerinta directa a
   * utilizatorului: "sa foloseasca orasele sau localitatile, si nu sa arate
   * locatia cod GPS". Coordonatele raman dedesubt, ca informatie exacta.
   */
  const placeName = usePlaceName(photo.gpsLatitude, photo.gpsLongitude);
  /** Prefix unic de id — vezi comentariul de la <nav role="tablist"> mai jos. */
  const tabsId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /**
   * Navigarea ceruta de tiparul ARIA de file: Sageti stanga/dreapta trec la fila
   * urmatoare/precedenta (circular), Home/End sar la prima/ultima. Fila noua
   * primeste si focusul, nu doar selectia — altfel urmatoarea apasare de sageata
   * ar porni tot de la fila veche.
   */
  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    const last = TAB_KEYS.length - 1;
    let next: number;
    switch (e.key) {
      case 'ArrowRight': next = index === last ? 0 : index + 1; break;
      case 'ArrowLeft': next = index === 0 ? last : index - 1; break;
      case 'Home': next = 0; break;
      case 'End': next = last; break;
      default: return;
    }
    // Doar dupa ce stim ca era o tasta de navigare: altfel am fi inghitit
    // Tab-ul si Shift+Tab, adica exact iesirea din grupul de file.
    e.preventDefault();
    setTab(TAB_KEYS[next].key);
    tabRefs.current[next]?.focus();
  };

  useEffect(() => { setTab('metrics'); }, [photo.id]);

  const photoHistory = useMemo(
    () => history.filter(h => h.photoId === photo.id).slice().reverse(),
    [history, photo.id]
  );

  const exif = formatExif(photo);
  const exifRows = extendedExifRows(photo, tr);
  const iptcRowsList = iptcRows(photo, tr);

  return (
    <>
      {/*
        Tiparul ARIA de file era pornit pe jumatate — bug real gasit de auditul UI:
        exista `role="tablist"`/`role="tab"`/`aria-selected`, deci un cititor de
        ecran anunta "fila, 1 din 4" si promite navigare cu sagetile, dar:
          - sagetile nu faceau nimic (niciun handler);
          - toate cele 4 file erau opriri separate de Tab, in loc de UNA singura
            (tabindex rulant), deci pe tastatura trebuia sa treci prin fiecare;
          - continutul de dedesubt nu era legat de nicio fila (fara `tabpanel`,
            fara `aria-controls`), deci nu exista nicio relatie anuntabila intre
            "fila selectata" si ce se vede.
        Zona de continut primeste si `tabIndex={0}`: e un container cu derulare
        proprie, iar un asemenea container trebuie sa poata fi derulat de la
        tastatura chiar si cand nu contine niciun element focusabil.
        `useId()` — cele doua locuri care monteaza componenta (DetailView si
        Workspace) nu coexista azi, dar id-uri generate evita orice coliziune
        daca vreodata ar coexista.
      */}
      <nav className="detail-tabs" role="tablist">
        {TAB_KEYS.map((tabDef, i) => (
          <button
            key={tabDef.key}
            id={`${tabsId}-tab-${tabDef.key}`}
            ref={el => { tabRefs.current[i] = el; }}
            role="tab"
            aria-selected={tab === tabDef.key}
            aria-controls={`${tabsId}-panel`}
            tabIndex={tab === tabDef.key ? 0 : -1}
            className={tab === tabDef.key ? 'detail-tab active' : 'detail-tab'}
            onClick={() => setTab(tabDef.key)}
            onKeyDown={e => onTabKeyDown(e, i)}
          >
            {tr(tabDef.labelKey)}
            {tabDef.key === 'history' && photoHistory.length > 0 && <b className="detail-tab-count mono">{photoHistory.length}</b>}
          </button>
        ))}
      </nav>

      <div
        className="detail-scroll"
        id={`${tabsId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabsId}-tab-${tab}`}
        tabIndex={0}
      >
      {tab === 'metrics' && (
        <>
          <div className="stat-grid">
            <div className="stat-tile score-tile">
              <ScoreRing score={photo.aiScore} />
              <span className="stat-label">{tr('detail.stat.score')}</span>
            </div>
            <StatTile label={tr('detail.stat.sharpness')} value={photo.sharpness} />
            <StatTile label={tr('detail.stat.exposure')} value={photo.exposure} />
            {photo.faceCount > 0 && <StatTile label={tr('detail.stat.faces')} value={photo.faceCount} />}
            {photo.faceCount > 0 && (
              // grup (mai multe fete): procent care zambesc, nu doar cea mai buna fata —
              // altfel un singur zambet mare "ascunde" restul grupului serios/nemultumit
              <StatTile
                label={photo.faceCount > 1 ? tr('detail.stat.smiles') : tr('detail.stat.smile')}
                value={`${Math.round((photo.faceCount > 1 ? photo.groupSmileRatio ?? photo.bestSmile : photo.bestSmile) * 100)}%`}
              />
            )}
            {photo.faceCount > 0 && (
              // grup: procent cu ochii deschisi (nu strict "toti sau niciunul") — problema
              // clasica la poze de grup e mereu cineva care clipeste
              <StatTile
                label={photo.faceCount > 1 ? tr('detail.stat.eyesGroup') : (photo.allEyesOpen ? tr('detail.stat.eyesOk') : tr('detail.stat.blink'))}
                value={
                  photo.faceCount > 1
                    ? `${Math.round((photo.groupEyesOpenRatio ?? (photo.allEyesOpen ? 1 : 0)) * 100)}%`
                    : (photo.allEyesOpen ? <CheckIcon /> : <EyeClosedIcon />)
                }
                warn={photo.faceCount > 1 ? (photo.groupEyesOpenRatio ?? 1) < 1 : !photo.allEyesOpen}
              />
            )}
            {photo.faceCount > 0 && <StatTile label={tr('detail.stat.thirds')} value={`${Math.round(photo.ruleOfThirds * 100)}%`} />}
            {photo.faceCount > 0 && <StatTile label={tr('detail.stat.headroom')} value={`${Math.round(photo.headroom * 100)}%`} />}
            {/* Fara subiect uman, treimile/headroom-ul de mai sus n-au sens (calculate pe cutia fetei
                principale) — aratam in loc liniile directoare/simetria/spatiul negativ (plan 2.2.3),
                deja factorizate in scorul AI dar niciodata afisate separat pana acum. */}
            {photo.faceCount === 0 && photo.symmetryDetected !== undefined && (
              <StatTile label={tr('detail.stat.symmetry')} value={photo.symmetryDetected ? <CheckIcon /> : <XIcon />} />
            )}
            {photo.faceCount === 0 && photo.leadingLinesDetected !== undefined && (
              <StatTile label={tr('detail.stat.leadingLines')} value={photo.leadingLinesDetected ? <CheckIcon /> : <XIcon />} />
            )}
            {photo.faceCount === 0 && photo.negativeSpaceScore !== undefined && (
              <StatTile label={tr('detail.stat.negativeSpace')} value={`${Math.round(photo.negativeSpaceScore * 100)}%`} />
            )}
          </div>
          {(photo.dominantColors?.length || photo.goldenHourDetected) && (
            <div className="color-palette-row">
              {photo.goldenHourDetected && (
                <span className="golden-badge lg" title={tr('palette.filter.goldenHour')}><SunIcon /></span>
              )}
              {photo.dominantColors?.map(c => (
                <span key={c} className="color-swatch" style={{ background: c }} title={c} />
              ))}
            </div>
          )}
          {photo.sceneTags && photo.sceneTags.length > 0 && (
            <div className="scene-tags-row">
              {photo.sceneTags.map(tag => (
                <span key={tag} className="scene-tag">{translateSceneTag(tag, locale)}</span>
              ))}
            </div>
          )}
          {exif && <p className="detail-exif mono">{exif}</p>}
          {exifRows.length > 0 && (
            <dl className="detail-exif-extended">
              {exifRows.map(r => (
                <div className="detail-exif-row" key={r.key}>
                  <dt>{r.label}</dt>
                  <dd>
                    {r.key === 'gps' && hasRealGps(photo.gpsLatitude, photo.gpsLongitude) ? (
                      // Aplicatia se declara "AI local, pozele nu parasesc dispozitivul" —
                      // acest link e SINGURA exceptie (coordonatele GPS sunt trimise catre
                      // openstreetmap.org la click, un serviciu extern). title/aria-label
                      // dezvaluie explicit asta INAINTE de click, nu doar in vreun document
                      // de politica de confidentialitate separat, pe care nimeni nu-l citeste.
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${photo.gpsLatitude}&mlon=${photo.gpsLongitude}#map=15/${photo.gpsLatitude}/${photo.gpsLongitude}`}
                        target="_blank" rel="noreferrer noopener"
                        title={tr('detail.exif.gps.disclosure')}
                        aria-label={`${placeName ?? r.value} — ${tr('detail.exif.gps.disclosure')}`}
                      >
                        {placeName ?? r.value}
                      </a>
                    ) : r.value}
                    {r.key === 'gps' && placeName && (
                      // Coordonatele raman vizibile sub numele localitatii: ele
                      // sunt faptul scris de aparat in poza, iar cand aparatul a
                      // notat si cat de sigur era pe ele, se arata si asta.
                      // Strada NU se afiseaza nicaieri — vezi ui/usePlaceName.ts.
                      <span className="detail-exif-coords mono">
                        {r.value}
                        {photo.gpsAccuracyM !== undefined &&
                          ` · ${tr('locations.accuracy', { m: Math.round(photo.gpsAccuracyM) })}`}
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {iptcRowsList.length > 0 && (
            <dl className="detail-exif-extended">
              {iptcRowsList.map(r => (
                <div className="detail-exif-row" key={r.key}>
                  <dt>{r.label}</dt>
                  <dd>{r.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <Histogram src={src} />
          <p className="detail-section-label mono">{tr('detail.focusMapLabel')}</p>
          <FocusMap src={src} />
        </>
      )}

      {tab === 'why' && (
        photo.aiFactors.length > 0 ? (
          <>
            <WhyExplanation photo={photo} />
            <div className="factor-row">
              <span className="factor-row-label mono"><SparkleIcon className="inline-icon" /> {tr('detail.why.factorsShort')}</span>
              <div className="factor-tags">
                {explainFactors(photo.aiFactors, locale).map(f => (
                  <span key={f.label} className={f.positive ? 'factor-tag pos' : 'factor-tag neg'}>
                    {f.positive ? '+' : '−'} {f.label}
                  </span>
                ))}
              </div>
            </div>
          </>
        ) : (
          <p className="hint">{tr('detail.why.none')}</p>
        )
      )}

      {tab === 'persons' && (
        photo.personMatches.length > 0 ? (
          <ul className="detail-person-list">
            {photo.personMatches.map(m => (
              <li key={m.name}>
                <span className="person-avatar">{m.name.charAt(0).toUpperCase()}</span>
                {m.name}
                <span className="mono person-confidence" title={tr('detail.persons.confidenceTitle')}>{Math.round(m.similarity * 100)}%</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">{tr('detail.persons.none')}</p>
        )
      )}

      {tab === 'history' && (
        photoHistory.length > 0 ? (
          <ul className="detail-history-list">
            {photoHistory.map((h, i) => (
              <li key={h.ts + '-' + i}>
                <span className="mono detail-history-time">{formatRelativeTime(h.ts, locale)}</span>
                <span>{tr(`detail.statusLabel.${h.previousStatus}`)} → <b>{tr(`detail.statusLabel.${h.newStatus}`)}</b></span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">
            <ClockIcon className="inline-icon" /> {tr('detail.history.none')}
          </p>
        )
      )}
      </div>
    </>
  );
}
