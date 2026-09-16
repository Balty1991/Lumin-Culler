import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * core/appPermissions.test.ts
 * Doua reguli apara tot modulul:
 *  - o permisiune care NU EXISTA pe platforma curenta nu se numara (altfel web-ul
 *    ar raporta o problema inventata);
 *  - accesul limitat la galerie se numara ca LIPSA, fiindca exact el face
 *    aplicatia sa para stricata fara sa spuna de ce.
 */
const media = {
  getPhotosAccess: vi.fn(async () => 'full' as string),
  readGalleryOverview: vi.fn(async () => ({ granted: true, totalCount: 0 })),
  openAppSettings: vi.fn(async () => undefined)
};
const notif = {
  check: vi.fn(async () => 'granted' as string),
  request: vi.fn(async () => 'granted' as string)
};

vi.mock('./nativeMediaLibrary', () => ({
  getPhotosAccess: () => media.getPhotosAccess(),
  readGalleryOverview: () => media.readGalleryOverview(),
  openAppSettings: () => media.openAppSettings()
}));
vi.mock('./nativeNotifications', () => ({
  checkNotificationAccess: () => notif.check(),
  requestNotificationAccess: () => notif.request()
}));

beforeEach(() => {
  media.getPhotosAccess.mockReset().mockResolvedValue('full');
  media.readGalleryOverview.mockReset().mockResolvedValue({ granted: true, totalCount: 0 });
  media.openAppSettings.mockReset().mockResolvedValue(undefined);
  notif.check.mockReset().mockResolvedValue('granted');
  notif.request.mockReset().mockResolvedValue('granted');
});
afterEach(() => { vi.resetModules(); });

async function modul() {
  return await import('./appPermissions');
}

describe('numaraPermisiuni', () => {
  it('pe Android, cu tot dat: doua din doua', async () => {
    const { numaraPermisiuni } = await modul();
    expect(numaraPermisiuni({ galerie: 'full', notificari: 'granted' })).toEqual({ date: 2, total: 2 });
  });

  it('accesul limitat la galerie se numara ca lipsa', async () => {
    // Android 14+ evidentiaza vizual "Permite cu acces limitat", si cu el
    // Supervizorul galeriei si "Adu pe perioade" n-au ce citi.
    const { numaraPermisiuni } = await modul();
    expect(numaraPermisiuni({ galerie: 'limited', notificari: 'granted' })).toEqual({ date: 1, total: 2 });
  });

  it('notificarile lipsa se vad — cazul raportat cu X pe ecranul de intampinare', async () => {
    const { numaraPermisiuni } = await modul();
    expect(numaraPermisiuni({ galerie: 'full', notificari: 'denied' })).toEqual({ date: 1, total: 2 });
    expect(numaraPermisiuni({ galerie: 'full', notificari: 'blocked' })).toEqual({ date: 1, total: 2 });
  });

  it('ce nu exista pe platforma nu se numara deloc', async () => {
    const { numaraPermisiuni, permisiuniRelevante, toatePermisiunileDate } = await modul();
    const web = { galerie: 'unavailable', notificari: 'unsupported' } as const;
    expect(numaraPermisiuni(web)).toEqual({ date: 0, total: 0 });
    // Pe web rubrica nu se arata; daca s-ar arata, ar spune "0 din 0", adica o
    // problema inventata.
    expect(permisiuniRelevante(web)).toBe(false);
    expect(toatePermisiunileDate(web)).toBe(true);
  });
});

describe('requestMissingPermissions', () => {
  it('nu deranjeaza cu nimic cand totul e deja dat', async () => {
    const { requestMissingPermissions } = await modul();
    const { complet } = await requestMissingPermissions();

    expect(complet).toBe(true);
    expect(media.readGalleryOverview).not.toHaveBeenCalled();
    expect(notif.request).not.toHaveBeenCalled();
  });

  it('cere doar ce lipseste', async () => {
    notif.check.mockResolvedValue('denied');
    const { requestMissingPermissions } = await modul();
    await requestMissingPermissions();

    expect(notif.request).toHaveBeenCalled();
    expect(media.readGalleryOverview).not.toHaveBeenCalled();
  });

  it('accesul limitat declanseaza si el cererea pentru galerie', async () => {
    media.getPhotosAccess.mockResolvedValue('limited');
    const { requestMissingPermissions } = await modul();
    await requestMissingPermissions();

    expect(media.readGalleryOverview).toHaveBeenCalled();
  });

  it('spune ca n-a mers cand refuzul ramane definitiv', async () => {
    // Dupa un refuz definitiv Android raspunde pe loc si fara dialog — de-aia
    // apelantul are nevoie de raspunsul asta ca sa deschida Setarile.
    notif.check.mockResolvedValue('blocked');
    notif.request.mockResolvedValue('blocked');
    const { requestMissingPermissions } = await modul();
    const { complet, stare } = await requestMissingPermissions();

    expect(complet).toBe(false);
    expect(stare.notificari).toBe('blocked');
  });

  it('o eroare de plugin nu arunca mai departe', async () => {
    media.getPhotosAccess.mockRejectedValue(new Error('plugin lipsa'));
    notif.check.mockRejectedValue(new Error('plugin lipsa'));
    const { requestMissingPermissions } = await modul();

    await expect(requestMissingPermissions()).resolves.toEqual(
      { stare: { galerie: 'unavailable', notificari: 'unsupported' }, complet: true }
    );
  });

  it('un dialog care crapa nu opreste cererea urmatoare', async () => {
    media.getPhotosAccess.mockResolvedValue('denied');
    media.readGalleryOverview.mockRejectedValue(new Error('activitate inchisa'));
    notif.check.mockResolvedValue('denied');
    const { requestMissingPermissions } = await modul();

    await requestMissingPermissions();
    expect(notif.request).toHaveBeenCalled();
  });
});
