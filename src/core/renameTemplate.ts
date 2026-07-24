/**
 * core/renameTemplate.ts
 * Redenumire in masa la export dupa un sablon (plan 3.2.x): loturi trimise
 * catre clienti/agentii au adesea o conventie de nume ceruta explicit
 * ("client_eveniment_data_secventa"), diferita de numele brute din camera
 * (IMG_1234.jpg). Sablonul e opt-in — gol/absent pastreaza exact
 * comportamentul dinainte (numele original, neschimbat).
 *
 * Persistat simplu in localStorage (acelasi tipar ca state/theme.ts), NU per
 * proiect: e o preferinta de FORMAT de export, nu o metadata legata de un
 * anumit client (aceea ramane in state/projectMetadata.ts si alimenteaza
 * token-ul {client}/{eveniment}/{locatie} de aici).
 */
export type RenameContext = {
  client?: string;
  event?: string;
  location?: string;
  /** epoch ms — data capturii (EXIF) sau, in lipsa, data importului. */
  capturedAt?: number;
};

const STORAGE_KEY = 'lumin-export-rename-template';

export function readStoredRenameTemplate(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeStoredRenameTemplate(template: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, template);
  } catch {
    // stocare indisponibila (mod privat strict etc.) — se aplica doar pentru sesiunea curenta
  }
}

const ILLEGAL_PATH_CHARS = /[\\/:*?"<>|]/g;

function formatDate(epochMs?: number): string {
  const d = epochMs ? new Date(epochMs) : new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function splitExt(fileName: string): { base: string; ext: string } {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? { base: fileName.slice(0, dot), ext: fileName.slice(dot) } : { base: fileName, ext: '' };
}

/**
 * Token-uri suportate: {client} {eveniment} {locatie} {data} {secventa} {nume}.
 * `secventa` e 1-based, zero-padded la 3 cifre (001, 002, ...) — suficient
 * pentru loturi de pana la 999 poze, peste continua simplu cu mai multe cifre.
 * Extensia fisierului original e mereu pastrata, indiferent de sablon.
 * Sablon gol/doar spatii => numele original, NESCHIMBAT (opt-in real).
 */
export function buildExportFileName(template: string, ctx: RenameContext, sequence: number, originalFileName: string): string {
  if (!template.trim()) return originalFileName;

  const { base, ext } = splitExt(originalFileName);
  const sequenceStr = String(sequence).padStart(3, '0');
  const expanded = template
    .split('{client}').join(ctx.client ?? '')
    .split('{eveniment}').join(ctx.event ?? '')
    .split('{locatie}').join(ctx.location ?? '')
    .split('{data}').join(formatDate(ctx.capturedAt))
    .split('{secventa}').join(sequenceStr)
    .split('{nume}').join(base);

  const sanitized = expanded
    .replace(ILLEGAL_PATH_CHARS, '-')
    .trim()
    .replace(/[_\-\s]{2,}/g, '_')
    .replace(/^[_\-\s]+|[_\-\s]+$/g, '');

  return (sanitized || base) + ext;
}
