/**
 * ui/noticeTone.ts
 * Clasifica un mesaj de notificare (store.notice) dupa continut — nu exista un
 * camp de tip in store (notice e doar text), asa ca deducem tonul din cuvinte
 * pentru iconita/culoarea toast-ului si pentru auto-inchidere (vezi Toast si
 * efectul de auto-dismiss din App.tsx).
 *
 * Extras din App.tsx ca sa poata fi testat direct: bug real raportat de
 * utilizator, cu captura — "Ștergerea a eșuat: ..." aparea cu BIFA VERDE de
 * succes, si disparea singura dupa 10 secunde ca orice mesaj reusit. Cauza:
 * potrivirile se faceau pe text fara diacritice ('esuat'), iar toate mesajele
 * romanesti scriu "eșuat" cu ș — deci nu se potrivea NICIODATA niciun esec.
 * Aceeasi gaura in engleza: nici "failed", nici "error" nu erau cautate, deci
 * pe locale-ul englez orice eroare se arata tot ca succes.
 *
 * De aceea potrivirea se face acum pe text NORMALIZAT (fara diacritice), in
 * ambele limbi. Un test (noticeTone.test.ts) trece chiar prin cheile din i18n,
 * ca o traducere noua sa nu poata reintroduce acelasi mod de esec.
 */

export type NoticeTone = 'error' | 'warn' | 'progress' | 'success';

/**
 * Fara diacritice si cu litere mici: "Ștergerea a eșuat" -> "stergerea a esuat".
 * NFD desface ș/ț/ă/î in litera de baza + semn combinat, iar semnele combinate
 * (blocul U+0300-U+036F) sunt apoi sterse.
 */
function normalize(message: string): string {
  return message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * "Nu am putut" (nu si "nu au putut"): al doilea apare in mesajele de succes
 * PARTIAL, ex. "{deleted} poze șterse... {skipped} poze nu au putut fi șterse"
 * — acela ramane un succes cu o precizare, nu un esec. Din acelasi motiv nu
 * cautam "could not" in engleza (apare in exact aceeasi propozitie).
 */
const ERROR_PATTERNS = [/esuat/, /eroare/, /nu am putut/, /\bfailed\b/, /\berror\b/, /couldn['’]t/];

/**
 * Verificat INAINTEA erorilor: mesajul de spatiu plin spune si "originalul nu a
 * putut fi salvat" / "the original couldn't be saved", dar e un avertisment
 * (poza a fost marcata, doar originalul lipseste), nu un esec.
 *
 * Ancorat la inceputul mesajului: un "full" venit din textul unei erori
 * interpolate ({error}, ex. o cotă de stocare raportata de browser) n-are voie
 * sa retrogradeze o eroare reala la avertisment — acolo mesajul incepe mereu cu
 * "Import eșuat: ...".
 */
const LEADING_WARN_PATTERNS = [/^spatiu de stocare plin/, /^storage full/];

/**
 * O anulare nu e nici eroare, nici succes — fara ea, "Export anulat..." ar primi
 * bifa verde de succes, exact mesajul gresit pentru un export care n-a livrat
 * nimic. `\bfull\b` cu delimitare de cuvant, nu `full`: "imported successfully"
 * il contine ca subsir, si mesajul de import reusit ar fi devenit avertisment.
 */
const WARN_PATTERNS = [/anulat/, /\bcancell?ed\b/, /\bplin/, /aproape/, /\bfull\b/, /almost/];

/**
 * 'progress' (mesaje "Se exporta...", "Se restaureaza backup-ul...", etc. —
 * conventia existenta in i18n e mereu suspensie de puncte la finalul unei
 * actiuni inca in desfasurare) NU trebuie sa dispara automat dupa 10s ca un
 * succes obisnuit: bug real raportat de utilizator (export nativ Android,
 * confirmat pe device) — "Se exporta..." disparea la 10s in timp ce munca
 * async continua inca (poate dura pana la 30s pe calea nativa de partajare),
 * lasand un gol tacut in care parea ca nu s-a intamplat NIMIC, desi rezultatul
 * (succes SAU eroare) tot urma sa apara mai tarziu.
 */
export function noticeTone(message: string): NoticeTone {
  const text = normalize(message);
  if (LEADING_WARN_PATTERNS.some(p => p.test(text))) return 'warn';
  if (ERROR_PATTERNS.some(p => p.test(text))) return 'error';
  if (WARN_PATTERNS.some(p => p.test(text))) return 'warn';
  if (message.endsWith('...') || message.endsWith('…')) return 'progress';
  return 'success';
}
