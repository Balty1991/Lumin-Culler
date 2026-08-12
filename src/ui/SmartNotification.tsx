import { useEffect } from 'react';
import { useStore } from '../state/store';
import {
  shouldShowSmartNotification, readSmartNotificationLastShown, writeSmartNotificationLastShown
} from '../state/smartNotification';
import { t, plural } from '../i18n';

/**
 * "Notificare inteligenta" (plan modernizare, ecran m-notif) — fara UI
 * propriu, doar un efect montat permanent (ca MenuDrawer) care verifica, de
 * fiecare data cand biblioteca se schimba, daca merita o notificare reala de
 * browser/PWA. LIMITARE REALA (vezi state/smartNotification.ts): se
 * declanseaza doar cat timp aplicatia ruleaza (deschisa/adusa in prim-plan),
 * nu si cu aplicatia complet inchisa — un push adevarat de fundal ar cere
 * server + abonament push + service worker dedicat, in afara acestei schimbari.
 */
export function SmartNotification() {
  const enabled = useStore(s => s.smartNotificationsEnabled);
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);

  useEffect(() => {
    if (!enabled) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const unsortedCount = photos.filter(p => p.status === 'pending' || p.status === 'review').length;
    const now = Date.now();
    if (!shouldShowSmartNotification({ now, enabled, unsortedCount, lastShown: readSmartNotificationLastShown() })) return;
    writeSmartNotificationLastShown(now);
    try {
      new Notification('Lumin Culler', {
        body: t(locale, plural(unsortedCount, 'notif.body.one', 'notif.body.other'), { count: unsortedCount }),
        icon: 'icon-192.png'
      });
    } catch {
      // unele platforme (ex. Safari iOS) nu suporta deloc Notification din pagina — degradare tacuta
    }
  }, [enabled, photos, locale]);

  return null;
}
