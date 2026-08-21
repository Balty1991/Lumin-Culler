import { useEffect } from 'react';
import { useStore } from '../state/store';
import {
  shouldShowSmartNotification, readSmartNotificationLastShown, writeSmartNotificationLastShown
} from '../state/smartNotification';
import { checkNotificationAccess, showNotification } from '../core/nativeNotifications';
import { t, plural } from '../i18n';

/**
 * "Notificare inteligenta" (plan modernizare, ecran m-notif) — fara UI propriu,
 * doar un efect montat permanent (ca MenuDrawer) care verifica, de fiecare data
 * cand biblioteca se schimba, daca merita o notificare reala.
 *
 * Pe Android notificarea e a SISTEMULUI (vezi core/nativeNotifications.ts si
 * plugins/NotificationsPlugin.kt): apare in bara de sus, ca oricare alta, si la
 * atingere deschide aplicatia. Pe web ramane Notification API.
 *
 * LIMITARE REALA, aceeasi pe ambele (vezi state/smartNotification.ts): momentul
 * se decide cat timp aplicatia ruleaza, nu cu ea complet inchisa — un push de
 * fundal ar cere server plus abonament push, adica exact ce aplicatia asta nu
 * are si nu vrea.
 */
export function SmartNotification() {
  const enabled = useStore(s => s.smartNotificationsEnabled);
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);
  const nextPeriod = useStore(s => s.supervisorNextPeriod());
  const setSupervisorPanelOpen = useStore(s => s.setSupervisorPanelOpen);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const unsortedCount = photos.filter(p => p.status === 'pending' || p.status === 'review').length;
    const hasNextPeriod = nextPeriod !== null;
    const now = Date.now();
    if (!shouldShowSmartNotification({ now, enabled, unsortedCount, hasNextPeriod, lastShown: readSmartNotificationLastShown() })) return;

    void (async () => {
      if ((await checkNotificationAccess()) !== 'granted' || !alive) return;
      // Cand nu mai e nimic de sortat, dar supervizorul galeriei are o perioada
      // noua pregatita, contextul concret devine perioada, nu "0 poze" (idee
      // proprie — vezi state/smartNotification.ts:hasNextPeriod).
      const body = unsortedCount > 0
        ? t(locale, plural(unsortedCount, 'notif.body.one', 'notif.body.other'), { count: unsortedCount })
        : t(locale, 'notif.body.nextPeriod');
      const shown = await showNotification({
        title: 'Lumin Culler',
        body,
        channelName: t(locale, 'notif.channel'),
        onClick: () => { window.focus(); setSupervisorPanelOpen(true); }
      });
      // Ziua se marcheaza doar daca notificarea chiar a plecat — altfel o
      // permisiune retrasa intre timp ar consuma in tacere fereastra de azi.
      if (shown) writeSmartNotificationLastShown(now);
    })();

    return () => { alive = false; };
  }, [enabled, photos, locale, nextPeriod, setSupervisorPanelOpen]);

  return null;
}
