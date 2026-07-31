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
  // Format in ora LOCALA, nu UTC — bug real gasit de auditul QA: capturedAt vine din EXIF,
  // construit cu semantica de ora locala a aparatului (new Date(y, mo, d, h, mi, se) in
  // exifParser.ts), dar toISOString() trece prin UTC; o poza facuta local dupa miezul
  // noptii (ex. o receptie de nunta la 00:20) putea sari pe ZIUA ANTERIOARA in numele
  // exportat, in functie de fusul orar al masinii care ruleaza exportul.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function splitExt(fileName: string): { base: string; ext: string } {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? { base: fileName.slice(0, dot), ext: fileName.slice(dot) } : { base: fileName, ext: '' };
}

/**
 * Token-uri suportate, in romana SI engleza (interfata expune ambele variante dupa
 * locale — bug real gasit de auditul QA: hint-ul din i18n/en.ts sugera token-uri englezesti
 * ca {event}/{sequence}, dar doar cele romanesti erau recunoscute, deci un utilizator pe
 * locale EN scria exact ce i se sugera si obtinea token-ul literal, neexpandat, in numele
 * fisierului): {client} {eveniment}/{event} {locatie}/{location} {data}/{date}
 * {secventa}/{sequence} {nume}/{name}.
 * `secventa`/`sequence` e 1-based, zero-padded la 3 cifre (001, 002, ...) — suficient
 * pentru loturi de pana la 999 poze, peste continua simplu cu mai multe cifre.
 * Extensia fisierului original e mereu pastrata, indiferent de sablon.
 * Sablon gol/doar spatii => numele original, NESCHIMBAT (opt-in real).
 */
export function buildExportFileName(template: string, ctx: RenameContext, sequence: number, originalFileName: string): string {
  if (!template.trim()) return originalFileName;

  const { base, ext } = splitExt(originalFileName);
  const sequenceStr = String(sequence).padStart(3, '0');
  const tokenValues: Record<string, string> = {
    client: ctx.client ?? '',
    eveniment: ctx.event ?? '', event: ctx.event ?? '',
    locatie: ctx.location ?? '', location: ctx.location ?? '',
    data: formatDate(ctx.capturedAt), date: formatDate(ctx.capturedAt),
    secventa: sequenceStr, sequence: sequenceStr,
    nume: base, name: base
  };
  // Inlocuire intr-o singura trecere (regex + callback), nu split/join inlantuit — bug real
  // gasit de auditul QA: split/join succesiv putea re-expanda text care CONTINE literal
  // "{...}" venit dintr-o valoare de token anterioara (client/eveniment/locatie sunt text
  // liber, din metadata proiectului), daca acel text coincidea intamplator cu sintaxa unui
  // token procesat mai tarziu in lant.
  const expanded = template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(tokenValues, key) ? tokenValues[key] : match
  );

  const sanitized = expanded
    .replace(ILLEGAL_PATH_CHARS, '-')
    .trim()
    .replace(/[_\-\s]{2,}/g, '_')
    .replace(/^[_\-\s]+|[_\-\s]+$/g, '');

  return (sanitized || base) + ext;
}
