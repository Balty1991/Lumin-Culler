/**
 * core/export/clientFeedback.ts
 * Citeste inapoi fisierul JSON descarcat de client din galeria statica
 * (buildClientGalleryHtml, vezi clientGallery.ts) — perechea de import a
 * exportului, la fel cum backupService.ts parseaza propriul JSON de backup.
 */

export interface ClientFeedbackEntry {
  id: string;
  fileName: string;
  decision: 'like' | 'dislike';
}

export interface ClientFeedbackData {
  version: number;
  galleryId?: string;
  exportedAt?: string;
  photos: ClientFeedbackEntry[];
}

function isEntry(v: unknown): v is ClientFeedbackEntry {
  return (
    !!v && typeof v === 'object' &&
    typeof (v as ClientFeedbackEntry).id === 'string' &&
    typeof (v as ClientFeedbackEntry).fileName === 'string' &&
    ((v as ClientFeedbackEntry).decision === 'like' || (v as ClientFeedbackEntry).decision === 'dislike')
  );
}

export async function parseClientFeedbackFile(file: File): Promise<ClientFeedbackData> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('Fisierul ales nu este un JSON valid.');
  }
  if (
    !parsed || typeof parsed !== 'object' ||
    (parsed as ClientFeedbackData).version !== 1 ||
    !Array.isArray((parsed as ClientFeedbackData).photos) ||
    !(parsed as ClientFeedbackData).photos.every(isEntry)
  ) {
    throw new Error('Fisier de feedback client nerecunoscut sau dintr-o versiune incompatibila.');
  }
  return parsed as ClientFeedbackData;
}
