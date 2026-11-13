import { jankSummary } from '../core/jankLog';
import { readTextScale, setTextScale, TEXT_SCALES, type TextScale } from './textSize';
import { usePacedPhotos } from './useLxPhotos';
import { DEV_UNLIMITED_KEY, devUnlimited, devUnlimitedAvailable } from '../core/entitlement';
import { Capacitor } from '@capacitor/core';
import { LOCALES } from '../i18n';
import { Share } from '@capacitor/share';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { buildErrorReport, readErrorLog } from '../core/errorLog';
import { countLessons } from './trainingGate';
import { cloudEnabled } from './cloud';
import { readerStopped } from './galleryReader';
import { PrivatePhotosRow } from './PrivatePhotos';
import { AutoArchiveRow } from './ArchiveView';
import { AutonomyPicker } from './TwinParts';
import { useStore } from '../state/store';
import type { CullingStrictness } from '../core/scoreThresholds';
import type { Theme } from '../state/theme';
import { PALETTES, applyPalette, phonePaletteAvailable, readStoredPalette, type Palette } from '../state/palette';
import { haptic, hapticsOn, setHapticsOn } from '../core/device';
import { requestNotificationAccess, isNativeNotificationsAvailable } from '../core/nativeNotifications';
import { useLx } from './lxStore';
import { refreshModels, useModelsState } from './aiModels';
import { downloadAllEngines, enginesFor, downloadEngine, engineReady, refreshEngines, useEngines } from './engines';
import { useTr } from './context';
import { useEffect, useState } from 'react';
import { LicensesSheet } from './LicensesSheet';
import { openBatterySettings, readBatteryRestriction, type BatteryRestriction } from '../core/backgroundAnalysis';
import { SORT_MODES, readSortMode, writeSortMode, type SortMode } from '../core/sortMode';
import { autoBackupAvailable, autoBackupOn, lastAutoBackupAt, setAutoBackup } from './autoBackup';
import { canMakePhoneAlbums, organizeKeptByMonth, organizeKeptByPeople, peopleAlbumsAuto, setPeopleAlbumsAuto, syncPeopleAlbums } from './phoneAlbums';
import { readPaywallLog } from './paywallMoment';

const STRICTNESS: CullingStrictness[] = ['lax', 'balanced', 'strict'];
const THEMES: Theme[] = ['dark', 'light', 'auto'];
const MODE_ICON: Record<SortMode, string> = { everyday: '☀', parent: '♡', seller: '◫', creator: '✦' };

/**
 * lumin/SettingsScreen.tsx
 * „Setări”: tot ce ține de om, pe un singur ecran — cât de strict e AI-ul,
 * limba, tema, seara, abonamentul, copia memoriei AI și golirea sesiunii.
 */
export function SettingsScreen() {
  const tr = useTr();
  const [licOpen, setLicOpen] = useState(false);
  // „Date și unelte”: pliată implicit (ocupa mult loc); ținută minte.
  const [dataOpen, setDataOpen] = useState(() => { try { return localStorage.getItem('lx.settings.dataOpen') === '1'; } catch { return false; } });
  const toggleData = () => setDataOpen(o => { try { localStorage.setItem('lx.settings.dataOpen', o ? '0' : '1'); } catch { /* fără */ } return !o; });
  const strictness = useStore(s => s.cullingStrictness);
  const setStrictness = useStore(s => s.setCullingStrictness);
  const locale = useStore(s => s.locale);
  const setLocale = useStore(s => s.setLocale);
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);
  const premium = useStore(s => s.premium);
  const setPremiumOpen = useStore(s => s.setPremiumOpen);
  const clearAll = useStore(s => s.clearAll);
  const askConfirm = useStore(s => s.askConfirm);
  const photos = usePacedPhotos();
  const exportBackup = useStore(s => s.exportBackup);
  const setTab = useLx(s => s.setTab);

  const [mode, setMode] = useState<SortMode>(readSortMode);
  // Schimbarea modului reia deciziile AI-ului de la zero (ale tale rămân), apoi momentele.
  const chooseMode = async (m: SortMode) => {
    if (m === mode) return;
    setMode(m);
    writeSortMode(m);
    // Același prag, dar momentele se recalculează: altfel modul se salva și galeria rămânea la fel.
    await setStrictness(strictness, true);
  };

  const clear = async () => {
    if (!await askConfirm(tr('lx.settings.clearConfirm', { count: photos.length }), { confirmLabel: tr('lx.settings.clear'), danger: true })) return;
    await clearAll();
    setTab('today');
  };

  return (
    <div className="lx-screen">
      <header className="lx-head">
        <button className="lx-icon-btn" onClick={() => useLx.getState().setTab('today')} aria-label={tr('lx.back')}>‹</button>
        <h1 className="lx-title small">{tr('lx.settings.title')}</h1>
        <span />
      </header>

      <button className={premium ? 'lx-card lx-pro-card active' : 'lx-card lx-pro-card'} onClick={() => setPremiumOpen(true)}>
        <span className="lx-pro-badge">PRO</span>
        <div>
          <b>{tr(premium ? 'lx.settings.proActive' : 'lx.settings.pro')}</b>
          <span>{tr('lx.settings.proSub')}</span>
        </div>
        <span className="lx-chev" aria-hidden="true">›</span>
      </button>

      <section className="lx-group">
        <h2>{tr('lx.twin.autonomy')}</h2>
        <AutonomyPicker />
      </section>

      <section className="lx-group">
        <h2>{tr('lx.settings.ai')}</h2>
        <div className="lx-seg" role="radiogroup" aria-label={tr('fr.strict.title')}>
          {STRICTNESS.map(v => (
            <button key={v} role="radio" aria-checked={strictness === v} className={strictness === v ? 'on' : ''} onClick={() => void setStrictness(v)}>
              {tr(`fr.strict.${v}`)}
            </button>
          ))}
        </div>
        <p className="lx-hint lx-group-hint">{tr(`fr.strict.${strictness}.sub`)}</p>
      </section>

      <AiModelsSection />

      <section className="lx-group">
        <h2>{tr('lx.mode.title')}</h2>
        <div className="lx-modes">
          {SORT_MODES.map(m => (
            <button key={m} className={mode === m ? 'lx-mode on' : 'lx-mode'} onClick={() => void chooseMode(m)}>
              <span className="lx-mode-icon" aria-hidden="true">{MODE_ICON[m]}</span>
              <b>{tr(`lx.mode.${m}`)}</b>
              <small>{tr(`lx.mode.${m}.sub`)}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="lx-group">
        <h2>{tr('lx.settings.look')}</h2>
        <div className="lx-row">
          <span>{tr('lx.settings.language')}</span>
          <div className="lx-seg small">
            {LOCALES.map(l => (
              <button key={l} className={locale === l ? 'on' : ''} onClick={() => setLocale(l)}>{l.toUpperCase()}</button>
            ))}
          </div>
        </div>
        <div className="lx-row">
          <span>{tr('lx.settings.theme')}</span>
          <div className="lx-seg small">
            {THEMES.map(v => (
              <button key={v} className={theme === v ? 'on' : ''} onClick={() => setTheme(v)}>{tr(`lx.settings.theme.${v}`)}</button>
            ))}
          </div>
        </div>
        <PaletteRow />
        <TextSizeRow />
        <HapticsRow />
        {devUnlimitedAvailable && <DevUnlimitedRow />}
        <button className="lx-row button" onClick={() => useLx.getState().setTourOpen(true)}>
          <span><b>{tr('lx.tour.open')}</b><small>{tr('lx.tour.openSub')}</small></span>
          <span aria-hidden="true">›</span>
        </button>
      </section>

      <BackgroundWork />

      {isNativeNotificationsAvailable() && (
        <section className="lx-group">
          <h2>{tr('lx.settings.evening')}</h2>
          <button className="lx-row button" onClick={() => void requestNotificationAccess().catch(() => {})}>
            <span>{tr('lx.settings.eveningSub')}</span>
            <span className="lx-chev" aria-hidden="true">›</span>
          </button>
        </section>
      )}

      <section className="lx-group">
        <button className="lx-fold-head lx-fold-card" onClick={() => toggleData()} aria-expanded={dataOpen}>
          <span><h2>{tr('lx.settings.data')}</h2>{!dataOpen && <small className="lx-fold-hint">{tr('lx.settings.dataHint')}</small>}</span>
          <i aria-hidden="true">›</i>
        </button>
        {dataOpen && (
          <>
          {canMakePhoneAlbums() && (
            <button className="lx-row button" onClick={() => void organizeKeptByMonth()}>
              <span><b>{tr('lx.phone.organize')}</b><small>{tr('lx.phone.organizeSub')}</small></span>
              <span className="lx-chev" aria-hidden="true">›</span>
            </button>
          )}
          {canMakePhoneAlbums() && (
            <button className="lx-row button" onClick={() => void organizeKeptByPeople()}>
              <span><b>{tr('lx.phone.organizePeople')}</b><small>{tr('lx.phone.organizePeopleSub')}</small></span>
              <span className="lx-chev" aria-hidden="true">›</span>
            </button>
          )}
          {canMakePhoneAlbums() && <PeopleAlbumsAutoRow />}
          <PrivatePhotosRow />
          <AutoBackupRow />
          <AutoArchiveRow />
          <button className="lx-row button" onClick={() => void exportBackup()}>
            <span><b>{tr('lx.settings.backup')}</b><small>{tr('lx.settings.backupSub')}</small></span>
            <span className="lx-chev" aria-hidden="true">›</span>
          </button>
          <button className="lx-row button danger" onClick={() => void clear()} disabled={photos.length === 0}>
            <span><b>{tr('lx.settings.clear')}</b><small>{tr('lx.settings.clearSub')}</small></span>
          </button>
          </>
        )}
      </section>

      {devUnlimitedAvailable && <PaywallDiag />}

      <button className="lx-row button" onClick={() => void sendReport()}>
        <span><b>🛠 {tr('lx.report.title')}</b><small>{tr('lx.report.sub', { count: readErrorLog().length })}</small></span>
        <span className="lx-chev" aria-hidden="true">›</span>
      </button>
      <button className="lx-row button" onClick={() => void recommend(tr('lx.recommend.text'))}>
        <span><b>💌 {tr('lx.recommend.title')}</b><small>{tr('lx.recommend.sub')}</small></span>
        <span className="lx-chev" aria-hidden="true">›</span>
      </button>

      <button className="lx-row button" onClick={() => setLicOpen(true)}>
        <span><b>📜 {tr('lx.lic.title')}</b><small>{tr('lx.lic.sub')}</small></span>
        <span className="lx-chev" aria-hidden="true">›</span>
      </button>
      {licOpen && <LicensesSheet onClose={() => setLicOpen(false)} />}

      <p className="lx-foot">{tr('lx.settings.privacy')}<br />Cherrypic · {__APP_VERSION__} · {__BUILD_ID__}</p>
    </div>
  );
}

function PaywallDiag() {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const rows = readPaywallLog();
  return (
    <section className="lx-group">
      <h2>{tr('lx.diag.title')}</h2>
      {rows.length === 0 ? <p className="lx-hint">{tr('lx.diag.empty')}</p> : (
        <ul className="lx-notes">
          {rows.slice(0, 8).map(r => (
            <li key={`${r.at}-${r.event}`}>{tr('lx.diag.line', {
              when: new Date(r.at).toLocaleString(locale === 'ro' ? 'ro-RO' : 'en-GB'),
              event: r.event,
              source: r.source
            })}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** „Trimite un raport”: fișier text cu versiunea și ultimele erori, prin foaia de trimitere. */
async function sendReport(): Promise<void> {
  const s = useStore.getState();
  const text = buildErrorReport({
    versiune: __APP_VERSION__,
    build: __BUILD_ID__,
    poze: s.photos.length,
    persoane: s.persons.length,
    limba: s.locale,
    memorie: String((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? '?'),
    lectii: await countLessons(),
    nesortate: s.photos.filter(p => !p.aside && (p.status === 'review' || p.status === 'pending' || p.status === 'candidate')).length,
    nu_azi: s.photos.filter(p => p.status === 'rejected').length,
    fete_numite: s.photos.filter(p => p.personNames.length > 0).length,
    cloud: cloudEnabled() ? 'pornit' : 'oprit',
    citire_oprita: readerStopped() ? 'da' : 'nu',
    blocaje: jankSummary()
  });
  const name = `cherrypic-raport-${new Date().toISOString().slice(0, 10)}.txt`;
  try {
    if (Capacitor.isNativePlatform()) {
      const written = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
      await Share.share({ files: [written.uri], title: name, text: 'Cherrypic — raport de probleme' });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      a.download = name;
      a.click();
    }
  } catch { /* închisă de om */ }
}

/** „Recomandă unui prieten”: foaia de trimitere a telefonului, cu linkul din Play. */
const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.luminculler.app';
async function recommend(text: string): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) await Share.share({ text: `${text}\n${PLAY_URL}` });
    else await navigator.share?.({ text, url: PLAY_URL });
  } catch { /* închisă de om */ }
}

/**
 * „Copie automată”: o dată pe săptămână, ce a învățat Cherrypic ajunge în copia
 * de rezervă Google a telefonului (vezi autoBackup.ts). Pornită cu acord.
 */
/** Culorile: Cherrypic (cireașa din iconiță), Aurora (vechiul cyan→violet) sau ale telefonului. */
function PaletteRow() {
  const tr = useTr();
  const [palette, setPalette] = useState<Palette>(readStoredPalette);
  const [phone, setPhone] = useState(false);
  useEffect(() => { void phonePaletteAvailable().then(setPhone); }, []);
  const choose = (p: Palette) => { setPalette(p); applyPalette(p); haptic('tick'); };
  return (
    <div className="lx-palettes" role="radiogroup" aria-label={tr('lx.palette.title')}>
      {PALETTES.filter(p => p !== 'phone' || phone).map(p => (
        <button key={p} role="radio" aria-checked={palette === p} className={palette === p ? 'lx-palette on' : 'lx-palette'} onClick={() => choose(p)}>
          <span className={`lx-palette-dot ${p}`} aria-hidden="true" />
          <b>{tr(`lx.palette.${p}`)}</b>
        </button>
      ))}
    </div>
  );
}

function TextSizeRow() {
  const tr = useTr();
  const [scale, setScale] = useState<TextScale>(readTextScale);
  const pick = (v: TextScale) => { setTextScale(v); setScale(v); };
  return (
    <div className="lx-row">
      <span><b>{tr('lx.textSize.title')}</b><small>{tr('lx.textSize.sub')}</small></span>
      <div className="lx-seg small" role="radiogroup" aria-label={tr('lx.textSize.title')}>
        {TEXT_SCALES.map(v => (
          <button key={v} role="radio" aria-checked={scale === v} className={scale === v ? 'on' : ''} onClick={() => pick(v)}>
            <span style={{ fontSize: `${Math.round(13 * v)}px` }}>A</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function HapticsRow() {
  const tr = useTr();
  const [on, setOn] = useState(hapticsOn);
  const toggle = () => { setHapticsOn(!on); setOn(!on); if (!on) haptic('confirm'); };
  return (
    <button className="lx-row button" role="switch" aria-checked={on} onClick={toggle}>
      <span><b>{tr('lx.haptics.title')}</b><small>{tr('lx.haptics.sub')}</small></span>
      <span className={on ? 'lx-pill ok' : 'lx-pill'}>{on ? '✓' : tr('lx.autoBackup.off')}</span>
    </button>
  );
}

/** Doar în APK-ul de test: fără limite și cu tot ce e Premium, cât se lucrează la aplicație. */
function DevUnlimitedRow() {
  const tr = useTr();
  const [on, setOn] = useState(devUnlimited);
  const toggle = () => {
    try { if (on) localStorage.removeItem(DEV_UNLIMITED_KEY); else localStorage.setItem(DEV_UNLIMITED_KEY, '1'); } catch { /* fără stocare */ }
    setOn(!on);
    useStore.getState().syncEntitlement();
  };
  return (
    <button className="lx-row button" role="switch" aria-checked={on} onClick={toggle}>
      <span><b>{tr('lx.dev.unlimited')}</b><small>{tr('lx.dev.unlimitedSub')}</small></span>
      <span className={on ? 'lx-pill ok' : 'lx-pill'}>{on ? '✓' : tr('lx.autoBackup.off')}</span>
    </button>
  );
}

/** „Ține albumele pe oameni la zi”: comutator; pornit, copiază acum ce lipsește. */
function PeopleAlbumsAutoRow() {
  const tr = useTr();
  const [on, setOn] = useState(peopleAlbumsAuto);
  const toggle = () => { setPeopleAlbumsAuto(!on); setOn(!on); if (!on) void syncPeopleAlbums(); };
  return (
    <button className="lx-row button" role="switch" aria-checked={on} onClick={toggle}>
      <span><b>{tr('lx.phone.peopleAuto')}</b><small>{tr('lx.phone.peopleAutoSub')}</small></span>
      <span className={on ? 'lx-pill ok' : 'lx-pill'}>{on ? '✓' : tr('lx.autoBackup.off')}</span>
    </button>
  );
}

function AutoBackupRow() {
  const tr = useTr();
  const askConfirm = useStore(s => s.askConfirm);
  const [on, setOn] = useState(autoBackupOn);
  if (!autoBackupAvailable()) return null;
  const last = lastAutoBackupAt();
  const toggle = async () => {
    if (!on && !(await askConfirm(tr('lx.autoBackup.askBody'), { confirmLabel: tr('lx.autoBackup.turnOn') }))) return;
    await setAutoBackup(!on);
    setOn(!on);
  };
  return (
    <button className="lx-row button" role="switch" aria-checked={on} onClick={() => void toggle()}>
      <span>
        <b>{tr('lx.autoBackup.title')}</b>
        <small>{on && last ? tr('lx.autoBackup.last', { date: new Date(last).toLocaleDateString() }) : tr('lx.autoBackup.sub')}</small>
      </span>
      <span className={on ? 'lx-pill ok' : 'lx-pill'}>{on ? '✓' : tr('lx.autoBackup.off')}</span>
    </button>
  );
}

/**
 * „Lucru în fundal”: pe multe telefoane (Xiaomi, Huawei, Samsung) economia de
 * baterie oprește analiza când ieși din aplicație — raportat: „uneori rămâne
 * blocat în fundal”, 7 din 46 în notificare. Aici se vede starea și drumul
 * direct spre setarea care o deblochează.
 */
function BackgroundWork() {
  const tr = useTr();
  const [state, setState] = useState<BatteryRestriction>('unknown');
  useEffect(() => {
    let alive = true;
    const read = () => { void readBatteryRestriction().then(b => { if (alive) setState(b); }); };
    read();
    document.addEventListener('visibilitychange', read);
    return () => { alive = false; document.removeEventListener('visibilitychange', read); };
  }, []);
  if (state === 'unknown') return null;
  return (
    <section className="lx-group">
      <h2>{tr('lx.settings.background')}</h2>
      <button className="lx-row button" onClick={() => void openBatterySettings()}>
        <span>
          <b>{tr(state === 'unrestricted' ? 'lx.settings.background.ok' : 'lx.settings.background.restricted')}</b>
          <small>{tr(state === 'unrestricted' ? 'lx.settings.background.okSub' : 'lx.settings.background.restrictedSub')}</small>
        </span>
        <span className={state === 'unrestricted' ? 'lx-pill ok' : 'lx-pill warm'}>{state === 'unrestricted' ? '✓' : '!'}</span>
      </button>
    </section>
  );
}

/** Motoarele AI de pe telefon: ce e descărcat, progresul, și butonul de pornire manuală. */
function AiModelsSection() {
  const tr = useTr();
  const m = useModelsState();
  const askConfirm = useStore(st => st.askConfirm);
  useEffect(() => { void refreshModels(); }, []);
  if (m.phase === 'unsupported') return null;
  const all = m.visionReady && m.textReady;
  const start = async () => {
    // Pe date mobile întrebăm o dată: 224 MB nu se iau fără acordul omului.
    const ok = await askConfirm(tr('lx.models.confirm'), { confirmLabel: tr('lx.models.download') });
    if (!ok) return;
    const mod = await import('./clipBackfill');
    void mod.startClipBackfill(true);
  };
  const pct = Number.isFinite(m.progress) ? Math.round(m.progress * 100) : 0;
  return (
    <section className="lx-group">
      <h2>{tr('lx.models.title')}</h2>
      <div className="lx-row">
        <span>
          <b>{m.phase === 'downloading'
            ? tr(m.what === 'text' ? 'lx.models.dlText' : 'lx.models.dlVision', { pct })
            : m.phase === 'scanning' ? tr('lx.models.scanning', { done: m.scanned, total: m.toScan })
            : all ? tr('lx.models.ready') : tr('lx.models.missing')}</b>
          <small>{m.phase === 'metered' ? tr('lx.models.metered') : m.phase === 'error' ? tr('lx.models.error') : tr('lx.models.sub')}</small>
        </span>
        {all ? <span className="lx-pill ok">✓</span> : null}
      </div>
      {(m.phase === 'downloading' || m.phase === 'scanning') && (
        <div className="lx-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={m.phase === 'scanning' ? Math.round((m.scanned / Math.max(1, m.toScan)) * 100) : pct}>
          <i style={{ width: `${m.phase === 'scanning' ? (m.scanned / Math.max(1, m.toScan)) * 100 : pct}%` }} />
        </div>
      )}
      {!all && m.phase !== 'downloading' && m.phase !== 'scanning' && (
        <button className="lx-btn primary" onClick={() => void start()}>{tr('lx.models.download')}</button>
      )}
      <EnginesList />
    </section>
  );
}

/** Toate motoarele, fiecare cu starea lui, și „Descarcă tot”. */
function EnginesList() {
  const tr = useTr();
  const st = useEngines();
  const askConfirm = useStore(x => x.askConfirm);
  useEffect(() => { void refreshEngines(); }, []);
  const locale = useStore(x => x.locale);
  const [open, setOpen] = useState(false);
  const list = enginesFor(locale);
  const missing = list.filter(e => !engineReady(e, st.have));
  const mb = missing.reduce((a, e) => a + e.mb, 0);
  const go = async () => {
    if (!(await askConfirm(tr('lx.engines.confirm', { mb }), { confirmLabel: tr('lx.models.download') }))) return;
    void downloadAllEngines();
  };
  const ready = list.length - missing.length;
  return (
    <div className="lx-engines">
      {/* Pliat: un rând cu starea (raportat: „ocupă mult spațiu”); se deschide la atingere. */}
      <button className="lx-engines-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span><b>{tr('lx.engines.heading')}</b><small>{st.busy ? `${tr(`lx.engines.${st.busy}`)} · ${Number.isFinite(st.progress) ? Math.round(st.progress * 100) : 0}%` : tr('lx.engines.summary', { ready, total: list.length })}</small></span>
        <i aria-hidden="true">{open ? '▴' : '▾'}</i>
      </button>
      {open && list.map(e => {
        const ok = engineReady(e, st.have);
        const now = st.busy === e.id;
        return (
          <div key={e.id} className="lx-engine-row">
            <span className="lx-engine-name">
              <b>{tr(`lx.engines.${e.id}`)}</b>
              <small>{tr(`lx.engines.${e.id}.sub`)} · {e.mb} MB</small>
            </span>
            {ok || now ? (
              <span className={ok ? 'lx-pill ok' : 'lx-pill warm'}>{ok ? '✓' : `${Number.isFinite(st.progress) ? Math.round(st.progress * 100) : 0}%`}</span>
            ) : (
              <button className="lx-pill lx-pill-btn" onClick={() => void downloadEngine(e.id)}>
                {st.error === e.id ? tr('lx.engines.retry') : tr('lx.engines.get')}
              </button>
            )}
          </div>
        );
      })}
      {missing.length > 0 && !st.busy && (
        <button className="lx-btn ghost" onClick={() => void go()}>{tr('lx.engines.all', { mb })}</button>
      )}
      {st.error && <p className="lx-hint">{tr('lx.models.error')}</p>}
    </div>
  );
}
