import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * core/backgroundAnalysis.test.ts
 * Regula intregului modul, si singura care poate face rau: NIMIC de aici n-are
 * voie sa arunce si nimic n-are voie sa opreasca un import.
 *
 * Serviciul de prim-plan poate lipsi (web), poate fi refuzat de sistem
 * (restrictii de pornire din fundal, Android 12+), sau plugin-ul poate raspunde
 * cu o eroare. In toate cazurile importul merge exact ca inainte — se opreste
 * daca omul incuie telefonul, adica fix comportamentul de pana la runda asta.
 */
const plugin = {
  start: vi.fn(),
  update: vi.fn(),
  stop: vi.fn()
};
let nativePlatform = true;
let pluginAvailable = true;

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => plugin,
  Capacitor: {
    isNativePlatform: () => nativePlatform,
    isPluginAvailable: () => pluginAvailable
  }
}));

/**
 * Permisiunea de notificari, ceruta de la primul import destul de mare — vezi
 * `ceriVoieDeNotificare`. Mock separat de plugin: aici se verifica CINE cere si
 * cand, nu ce raspunde sistemul.
 */
const acces = {
  check: vi.fn(async () => 'granted' as string),
  request: vi.fn(async () => 'granted' as string)
};
vi.mock('./nativeNotifications', () => ({
  checkNotificationAccess: () => acces.check(),
  requestNotificationAccess: () => acces.request()
}));

beforeEach(() => {
  acces.check.mockReset().mockResolvedValue('granted');
  acces.request.mockReset().mockResolvedValue('granted');
  plugin.start.mockReset();
  plugin.update.mockReset();
  plugin.stop.mockReset();
  nativePlatform = true;
  pluginAvailable = true;
});

afterEach(() => { vi.resetModules(); });

async function modul() {
  return await import('./backgroundAnalysis');
}

describe('analiza in fundal', () => {
  it('pe web nu atinge plugin-ul deloc', async () => {
    nativePlatform = false;
    const { startBackgroundAnalysis, updateBackgroundAnalysis, stopBackgroundAnalysis, isBackgroundAnalysisAvailable } = await modul();

    expect(isBackgroundAnalysisAvailable()).toBe(false);
    expect(await startBackgroundAnalysis(0, 100)).toBe(false);
    await updateBackgroundAnalysis(5, 100);
    await stopBackgroundAnalysis();
    expect(plugin.start).not.toHaveBeenCalled();
    expect(plugin.stop).not.toHaveBeenCalled();
  });

  it('pe Android fara plugin-ul inregistrat, la fel', async () => {
    pluginAvailable = false;
    const { startBackgroundAnalysis } = await modul();
    expect(await startBackgroundAnalysis(0, 100)).toBe(false);
    expect(plugin.start).not.toHaveBeenCalled();
  });

  it('un refuz al sistemului se intoarce ca `false`, nu ca exceptie', async () => {
    plugin.start.mockResolvedValue({ started: false, reason: 'ForegroundServiceStartNotAllowedException' });
    const { startBackgroundAnalysis } = await modul();
    expect(await startBackgroundAnalysis(0, 100)).toBe(false);
  });

  it('o exceptie a plugin-ului nu iese din modul', async () => {
    plugin.start.mockRejectedValue(new Error('plugin mort'));
    plugin.update.mockRejectedValue(new Error('plugin mort'));
    plugin.stop.mockRejectedValue(new Error('plugin mort'));
    const { startBackgroundAnalysis, updateBackgroundAnalysis, stopBackgroundAnalysis } = await modul();

    expect(await startBackgroundAnalysis(0, 100)).toBe(false);
    await expect(updateBackgroundAnalysis(5, 100)).resolves.toBeUndefined();
    await expect(stopBackgroundAnalysis()).resolves.toBeUndefined();
  });

  it('un lot mic nu porneste niciun serviciu — nimeni nu incuie telefonul pentru cinci poze', async () => {
    plugin.start.mockResolvedValue({ started: true });
    const { startBackgroundAnalysis, MIN_PHOTOS_FOR_BACKGROUND } = await modul();

    expect(await startBackgroundAnalysis(0, MIN_PHOTOS_FOR_BACKGROUND - 1)).toBe(false);
    expect(plugin.start).not.toHaveBeenCalled();
    expect(await startBackgroundAnalysis(0, MIN_PHOTOS_FOR_BACKGROUND)).toBe(true);
  });

  it('cand chiar porneste, spune ca a pornit si trimite cifrele', async () => {
    plugin.start.mockResolvedValue({ started: true });
    const { startBackgroundAnalysis } = await modul();

    expect(await startBackgroundAnalysis(0, 437, 'Se pregătește analiza…')).toBe(true);
    expect(plugin.start).toHaveBeenCalledWith(
      { done: 0, total: 437, text: 'Se pregătește analiza…', determinate: false }
    );
  });
});

describe('backgroundPhaseNotice', () => {
  it('da un text pentru fiecare faza care inca lucreaza', async () => {
    const { backgroundPhaseNotice } = await modul();
    // Bug raportat: notificarea se actualiza doar in faza 'analiza', asa ca
    // pregatirea si gruparea — minute intregi la un lot mare — aratau ca o
    // analiza inghetata.
    expect(backgroundPhaseNotice('citire')?.key).toBe('store.background.starting');
    expect(backgroundPhaseNotice('incarcare')?.key).toBe('store.background.starting');
    expect(backgroundPhaseNotice('pregatire')?.key).toBe('store.background.preparing');
    expect(backgroundPhaseNotice('analiza')?.key).toBe('store.background.progress');
    expect(backgroundPhaseNotice('grupare')?.key).toBe('store.background.grouping');
  });

  it('bara reala doar la analiza — altfel ar merge inapoi', async () => {
    const { backgroundPhaseNotice } = await modul();
    // Vazut pe telefon: pregatirea umplea bara pana la jumatate, apoi analiza o
    // lua de la 2%. O bara care merge inapoi inseamna, pentru oricine, "a luat-o
    // de la capat".
    expect(backgroundPhaseNotice('analiza')?.determinate).toBe(true);
    for (const faza of ['citire', 'incarcare', 'pregatire', 'grupare'] as const) {
      expect(backgroundPhaseNotice(faza)?.determinate, faza).toBe(false);
    }
  });

  it('nu atinge notificarea la final — oricum urmeaza oprirea serviciului', async () => {
    const { backgroundPhaseNotice } = await modul();
    expect(backgroundPhaseNotice('finalizat')).toBeNull();
  });

  it('toate cheile exista in ambele limbi', async () => {
    const { backgroundPhaseNotice } = await modul();
    const { ro } = await import('../i18n/ro');
    const { en } = await import('../i18n/en');
    for (const faza of ['citire', 'incarcare', 'pregatire', 'analiza', 'grupare'] as const) {
      const cheie = backgroundPhaseNotice(faza)!.key;
      expect(ro, faza).toHaveProperty(cheie);
      expect(en, faza).toHaveProperty(cheie);
    }
  });

  it('pornirea nu arata o bara reala goala', async () => {
    const { startBackgroundAnalysis } = await modul();
    plugin.start.mockResolvedValue({ started: true });
    await startBackgroundAnalysis(0, 86, 'Se pregătește analiza…');
    expect(plugin.start).toHaveBeenCalledWith(
      expect.objectContaining({ determinate: false })
    );
  });
});

describe('permisiunea de notificari la pornirea importului', () => {
  it('o cere cand lipseste', async () => {
    // Raportat de utilizator: cu X pe ecranul de intampinare, permisiunea de
    // galerie tot apare (are un declansator natural), dar cea de notificari nu
    // mai apare niciodata. Importul e declansatorul ei natural.
    acces.check.mockResolvedValue('denied');
    plugin.start.mockResolvedValue({ started: true });
    const { startBackgroundAnalysis } = await modul();

    expect(await startBackgroundAnalysis(0, 86)).toBe(true);
    expect(acces.request).toHaveBeenCalled();
  });

  it('nu insista cand e deja data', async () => {
    plugin.start.mockResolvedValue({ started: true });
    const { startBackgroundAnalysis } = await modul();

    await startBackgroundAnalysis(0, 86);
    expect(acces.request).not.toHaveBeenCalled();
  });

  it('un refuz nu opreste serviciul — analiza merge, doar fara sa spuna cat', async () => {
    acces.check.mockResolvedValue('denied');
    acces.request.mockResolvedValue('blocked');
    plugin.start.mockResolvedValue({ started: true });
    const { startBackgroundAnalysis } = await modul();

    expect(await startBackgroundAnalysis(0, 86)).toBe(true);
    expect(plugin.start).toHaveBeenCalled();
  });

  it('o eroare la verificare nu opreste nimic', async () => {
    acces.check.mockRejectedValue(new Error('plugin lipsa'));
    plugin.start.mockResolvedValue({ started: true });
    const { startBackgroundAnalysis } = await modul();

    await expect(startBackgroundAnalysis(0, 86)).resolves.toBe(true);
  });

  it('sub prag nu deranjeaza pe nimeni: fara serviciu, fara dialog', async () => {
    acces.check.mockResolvedValue('denied');
    const { startBackgroundAnalysis, MIN_PHOTOS_FOR_BACKGROUND } = await modul();

    expect(await startBackgroundAnalysis(0, MIN_PHOTOS_FOR_BACKGROUND - 1)).toBe(false);
    expect(acces.check).not.toHaveBeenCalled();
    expect(acces.request).not.toHaveBeenCalled();
  });

  it('pe web nu se cere nimic', async () => {
    nativePlatform = false;
    acces.check.mockResolvedValue('denied');
    const { startBackgroundAnalysis } = await modul();

    expect(await startBackgroundAnalysis(0, 86)).toBe(false);
    expect(acces.request).not.toHaveBeenCalled();
  });
});
