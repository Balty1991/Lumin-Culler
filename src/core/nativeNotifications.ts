/**
 * core/nativeNotifications.ts
 * Punte catre plugin-ul local Notifications (vezi
 * android/app/src/main/java/com/luminculler/app/plugins/NotificationsPlugin.kt).
 *
 * De ce exista: setarea "Notificari inteligente" folosea Notification API din
 * pagina. In WebView-ul Android acela nu e disponibil, deci comutatorul
 * raspundea cu un mesaj despre "browser" — un cuvant care nu inseamna nimic
 * pentru cineva care a instalat o aplicatie din Play Store — si nu trimitea
 * niciodata nimic. Pe Android trece acum prin sistem; pe web ramane
 * Notification API, unde chiar functioneaza.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';

interface NotificationsPluginApi {
  checkAccess(): Promise<{ granted: boolean }>;
  requestAccess(): Promise<{ granted: boolean }>;
  show(options: { title: string; body: string; channelName: string }): Promise<{ shown: boolean }>;
}

const NotificationsNative = registerPlugin<NotificationsPluginApi>('Notifications');

/** Sigur de apelat si pe web — registerPlugin() nu esueaza la incarcare, doar la apelul efectiv. */
export function isNativeNotificationsAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Notifications');
}

/**
 * Poate aplicatia sa trimita o notificare ACUM, pe orice platforma ruleaza?
 * Trei raspunsuri, nu doua: 'granted' merge, 'blocked' inseamna ca omul (sau
 * sistemul) a spus nu si doar el poate schimba asta, 'unsupported' inseamna ca
 * platforma n-are notificari deloc.
 */
export type NotificationAccess = 'granted' | 'denied' | 'blocked' | 'unsupported';

export async function checkNotificationAccess(): Promise<NotificationAccess> {
  if (isNativeNotificationsAvailable()) {
    try {
      return (await NotificationsNative.checkAccess()).granted ? 'granted' : 'denied';
    } catch {
      return 'unsupported';
    }
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'blocked';
  return 'denied';
}

export async function requestNotificationAccess(): Promise<NotificationAccess> {
  if (isNativeNotificationsAvailable()) {
    try {
      return (await NotificationsNative.requestAccess()).granted ? 'granted' : 'blocked';
    } catch {
      return 'unsupported';
    }
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return (await Notification.requestPermission()) === 'granted' ? 'granted' : 'blocked';
  } catch {
    return 'unsupported';
  }
}

/**
 * Trimite notificarea. Intoarce `false` daca n-a plecat — apelantul decide ce
 * face cu asta (in cazul nostru: nu marcheaza notificarea drept "afisata azi",
 * ca sa poata reincerca maine).
 */
export async function showNotification(opts: { title: string; body: string; channelName: string; onClick?: () => void }): Promise<boolean> {
  if (isNativeNotificationsAvailable()) {
    try {
      return (await NotificationsNative.show({ title: opts.title, body: opts.body, channelName: opts.channelName })).shown;
    } catch {
      return false;
    }
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  try {
    const notification = new Notification(opts.title, { body: opts.body, icon: 'icon-192.png' });
    if (opts.onClick) notification.onclick = opts.onClick;
    return true;
  } catch {
    // unele platforme (ex. Safari iOS) nu suporta deloc Notification din pagina
    return false;
  }
}
