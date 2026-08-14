import { describe, it, expect } from 'vitest';
import { noticeTone } from './noticeTone';
import { t, type Locale } from '../i18n';

const LOCALES: Locale[] = ['ro', 'en'];

describe('noticeTone', () => {
  /**
   * Bug real raportat de utilizator, cu captura: "Ștergerea a eșuat: ..." se
   * arata cu bifa VERDE de succes si disparea singura dupa 10s. Potrivirea se
   * facea pe 'esuat' fara diacritice, iar textul romanesc scrie "eșuat".
   */
  it('recunoaste esecul stergerii ca eroare, in ambele limbi', () => {
    for (const locale of LOCALES) {
      const message = t(locale, 'store.deleteRejected.failed', { error: 'MediaProvider: User 10605 does not have read permission' });
      expect(noticeTone(message), `${locale}: ${message}`).toBe('error');
    }
  });

  /** Nicio cheie de esec din i18n nu are voie sa arate ca un succes. */
  it('toate mesajele de esec din i18n sunt erori', () => {
    const failureKeys = [
      'store.deleteRejected.failed',
      'store.import.failed',
      'store.exportSelection.failed',
      'store.exportXmp.failed',
      'store.backup.restoreFailed',
      'store.clientGallery.failed',
      'store.clientFeedback.failed',
      'store.personProfiles.importFailed',
      'store.boot.failed'
    ] as const;
    for (const locale of LOCALES) {
      for (const key of failureKeys) {
        const message = t(locale, key, { error: 'boom', count: 3 });
        expect(noticeTone(message), `${locale}/${key}: ${message}`).toBe('error');
      }
    }
  });

  it('anularea si spatiul plin raman avertismente, nu erori si nici succese', () => {
    for (const locale of LOCALES) {
      expect(noticeTone(t(locale, 'store.exportSelection.cancelled'))).toBe('warn');
      expect(noticeTone(t(locale, 'store.quotaNotice'))).toBe('warn');
    }
  });

  it('un mesaj de succes ramane succes', () => {
    for (const locale of LOCALES) {
      // Succes PARTIAL: "... au fost sterse" + "... nu au putut fi sterse".
      // Precizarea despre pozele omise nu trebuie sa transforme rezultatul in eroare.
      const partial = t(locale, 'store.deleteRejected.notice', { deleted: 8 }) +
        t(locale, 'store.deleteRejected.skippedPart', { skipped: 2 });
      expect(noticeTone(partial), partial).toBe('success');
      expect(noticeTone(t(locale, 'store.import.done', { count: 12 }))).toBe('success');
    }
  });

  it('actiunile in desfasurare raman "progress" (nu se auto-inchid)', () => {
    for (const locale of LOCALES) {
      expect(noticeTone(t(locale, 'store.exportSelection.exporting'))).toBe('progress');
    }
    expect(noticeTone('Se restaurează backup-ul…')).toBe('progress');
  });
});
