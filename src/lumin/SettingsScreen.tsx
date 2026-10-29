import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { buildErrorReport, readErrorLog } from '../core/errorLog';
import { CloudSection } from './CloudParts';
import { AutonomyPicker } from './TwinParts';
import { useStore } from '../state/store';
import type { CullingStrictness } from '../core/scoreThresholds';
import type { Theme } from '../state/theme';
import { requestNotificationAccess, isNativeNotificationsAvailable } from '../core/nativeNotifications';
import { useLx } from './lxStore';
import { useTr } from './context';
import { useEffect, useState } from 'react';
import { openBatterySettings, readBatteryRestriction, type BatteryRestriction } from '../core/backgroundAnalysis';
import { SORT_MODES, readSortMode, writeSortMode, type SortMode } from '../core/sortMode';
import { autoBackupAvailable, autoBackupOn, lastAutoBackupAt, setAutoBackup } from './autoBackup';
import { canMakePhoneAlbums, organizeKeptByMonth, organizeKeptByPeople, peopleAlbumsAuto, setPeopleAlbumsAuto, syncPeopleAlbums } from './phoneAlbums';

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
  const photos = useStore(s => s.photos);
  const exportBackup = useStore(s => s.exportBackup);
  const setTab = useLx(s => s.setTab);

  const [mode, setMode] = useState<SortMode>(readSortMode);
  // Schimbarea modului reia deciziile AI-ului de la zero (ale tale rămân), apoi momentele.
  const chooseMode = async (m: SortMode) => {
    setMode(m);
    writeSortMode(m);
    await setStrictness(strictness);
  };

  const clear = async () => {
    if (!await askConfirm(tr('lx.settings.clearConfirm', { count: photos.length }), { confirmLabel: tr('lx.settings.clear'), danger: true })) return;
    await clearAll();
    setTab('today');
  };

  return (
    <div className="lx-screen">
      <header className="lx-head"><h1 className="lx-title">{tr('lx.settings.title')}</h1></header>

      <button className={premium ? 'lx-card lx-pro-card active' : 'lx-card lx-pro-card'} onClick={() => setPremiumOpen(true)}>
        <span className="lx-pro-badge">PRO</span>
        <div>
          <b>{tr(premium ? 'lx.settings.proActive' : 'lx.settings.pro')}</b>
          <span>{tr('lx.settings.proSub')}</span>
        </div>
        <span className="lx-chev" aria-hidden="true">›</span>
      </button>

      <section className="lx-group">
        <h2>{tr('lx.settings.ai')}</h2>
        <div className="lx-seg" role="radiogroup" aria-label={tr('fr.strict.title')}>
          {STRICTNESS.map(v => (
            <button key={v} role="radio" aria-checked={strictness === v} className={strictness === v ? 'on' : ''} onClick={() => void setStrictness(v)}>
              {tr(`fr.strict.${v}`)}
            </button>
          ))}
        </div>
        <p className="lx-hint">{tr(`fr.strict.${strictness}.sub`)}</p>
      </section>

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
            {(['ro', 'en'] as const).map(l => (
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
      </section>

      <section className="lx-group">
        <h2>{tr('lx.twin.autonomy')}</h2>
        <AutonomyPicker />
      </section>

      <CloudSection />
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
        <h2>{tr('lx.settings.data')}</h2>
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
        <AutoBackupRow />
        <button className="lx-row button" onClick={() => void exportBackup()}>
          <span><b>{tr('lx.settings.backup')}</b><small>{tr('lx.settings.backupSub')}</small></span>
          <span className="lx-chev" aria-hidden="true">›</span>
        </button>
        <button className="lx-row button danger" onClick={() => void clear()} disabled={photos.length === 0}>
          <span><b>{tr('lx.settings.clear')}</b><small>{tr('lx.settings.clearSub')}</small></span>
        </button>
      </section>

      <button className="lx-row button" onClick={() => void sendReport()}>
        <span><b>🛠 {tr('lx.report.title')}</b><small>{tr('lx.report.sub', { count: readErrorLog().length })}</small></span>
        <span className="lx-chev" aria-hidden="true">›</span>
      </button>
      <button className="lx-row button" onClick={() => void recommend(tr('lx.recommend.text'))}>
        <span><b>💌 {tr('lx.recommend.title')}</b><small>{tr('lx.recommend.sub')}</small></span>
        <span className="lx-chev" aria-hidden="true">›</span>
      </button>

      <p className="lx-foot">{tr('lx.settings.privacy')}<br />Cherrypic · {__APP_VERSION__}</p>
    </div>
  );
}

/** „Trimite un raport”: fișier text cu versiunea și ultimele erori, prin foaia de trimitere. */
async function sendReport(): Promise<void> {
  const s = useStore.getState();
  const text = buildErrorReport({
    versiune: __APP_VERSION__,
    poze: s.photos.length,
    persoane: s.persons.length,
    limba: s.locale,
    memorie: String((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? '?')
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
