import { AutonomyPicker } from './TwinParts';
import { useStore } from '../state/store';
import type { CullingStrictness } from '../core/scoreThresholds';
import type { Theme } from '../state/theme';
import { requestNotificationAccess, isNativeNotificationsAvailable } from '../core/nativeNotifications';
import { useLx } from './lxStore';
import { useTr } from './context';
import { useState } from 'react';
import { SORT_MODES, readSortMode, writeSortMode, type SortMode } from '../core/sortMode';
import { canMakePhoneAlbums, organizeKeptByMonth } from './phoneAlbums';

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
        <button className="lx-row button" onClick={() => void exportBackup()}>
          <span><b>{tr('lx.settings.backup')}</b><small>{tr('lx.settings.backupSub')}</small></span>
          <span className="lx-chev" aria-hidden="true">›</span>
        </button>
        <button className="lx-row button danger" onClick={() => void clear()} disabled={photos.length === 0}>
          <span><b>{tr('lx.settings.clear')}</b><small>{tr('lx.settings.clearSub')}</small></span>
        </button>
      </section>

      <p className="lx-foot">{tr('lx.settings.privacy')}<br />Lumin AI · {__APP_VERSION__}</p>
    </div>
  );
}
