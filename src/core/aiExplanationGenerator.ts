/**
 * core/aiExplanationGenerator.ts
 *
 * Genereaza explicatii detaliate pentru decizia AI despre o fotografie — un
 * rationament pe mai multe axe (tehnic, compozitie, subiect/fete, estetica),
 * plus un verdict care compara decizia AI cu cea a utilizatorului si
 * mentioneaza increderea modelului. Nu introduce calcule noi: interpreteaza
 * in propozitii campurile deja calculate in AnalysisRecord
 * (faceAnalysis.worker.ts) si ponderile invatate de ContextEngine — acelasi
 * rol ca `explainFactors` (tag-uri scurte, pentru UI compact), dar in forma
 * de text continuu, mai apropiat de cum ar explica un fotograf uman.
 *
 * Textul traieste in i18n (chei `aiExplain.*` / `aiSuggest.*`) — functiile de
 * mai jos doar aleg CARE cheie se potriveste, pe baza analizei, si le
 * interpoleaza/imbina. `locale` are default 'ro' (nu obligatoriu la apel) ca
 * sa nu schimbe comportamentul apelantilor existenti care nu-l dau explicit.
 *
 * `contextModel` e opt­ional: la "cold start" (inca nu exista model salvat
 * pentru acest tip de scena) nu exista inca niciun ContextModelRecord in DB —
 * explicatia trebuie sa functioneze si atunci, doar ca mentioneaza ca
 * increderea e minima si recomandarea se bazeaza pe reguli generale.
 */
import type { AnalysisRecord, ContextModelRecord } from './db';
import { explainFactors, landscapeSharpness } from './learning/ContextEngine';
import { t, type Locale } from '../i18n';

/**
 * Aceeasi curba de perspectiva atmosferica folosita de ContextEngine.extractFeatures
 * pentru scorare (vezi landscapeSharpness) — bug real gasit de auditul QA:
 * explicatiile/sugestiile foloseau in continuare claritatea BRUTA pentru
 * peisaje/natura, deci un cadru pe care motorul de scor tocmai il trata mai
 * indulgent (perspectiva atmosferica, nu un defect real) tot aparea in text
 * ca "neclar, cu blur vizibil" — contrazicand direct decizia AI-ului pentru
 * acelasi cadru. Pentru poze cu cel putin o fata, comportamentul ramane
 * neschimbat (claritatea bruta, ca inainte).
 */
function effectiveSharpness(a: AnalysisRecord): number {
  return a.faceCount > 0 ? a.sharpness : landscapeSharpness(a.sharpness) * 100;
}

const COLD_START_SAMPLES = 8;   // acelasi prag ca in ContextEngine.ts
const TRAINED_SAMPLES = 40;

// Aceleasi praguri ca HEADROOM_IDEAL_MIN/MAX din faceAnalysis.worker.ts (nu importate direct
// ca sa nu tragem codul/dependintele workerului de AI in bundle-ul principal).
const HEADROOM_IDEAL_MIN = 0.04;
const HEADROOM_IDEAL_MAX = 0.22;

/**
 * a.headroom e un scor "cat de aproape de ideal" (0..1, simetric — scade la fel de mult
 * daca spatiul e prea mic SAU prea mare), deci nu poate spune singur DIRECTIA problemei —
 * bug real gasit de auditul QA: textul presupunea ca headroom mic = "prea strans" mereu,
 * dar un cadru cu mult spatiu gol deasupra capului (topY mare) produce acelasi scor mic,
 * si primea gresit sfatul "aproprie cadrul". Recalculam directia din pozitia bruta a
 * cutiei fetei principale (aceeasi fata folosita la scoreComposition in worker).
 */
function headroomDirection(a: AnalysisRecord): 'tight' | 'loose' | null {
  if (!a.faces?.length) return null;
  const main = a.faces.reduce((x, y) => (x.box[2] * x.box[3] > y.box[2] * y.box[3] ? x : y));
  const topY = main.box[1];
  if (topY < HEADROOM_IDEAL_MIN) return 'tight';
  if (topY > HEADROOM_IDEAL_MAX) return 'loose';
  return null;
}

type Confidence = 'cold' | 'warming' | 'trained';

function modelConfidence(model: ContextModelRecord | null): Confidence {
  if (!model) return 'cold';
  if (model.sampleCount < COLD_START_SAMPLES) return 'cold';
  if (model.sampleCount < TRAINED_SAMPLES) return 'warming';
  return 'trained';
}

function joinNatural(parts: string[], locale: Locale): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(', ') + t(locale, 'aiExplain.and') + parts[parts.length - 1];
}

// ── Axa tehnica: claritate, expunere, ISO ───────────────────────────────────

function technicalSentence(a: AnalysisRecord, locale: Locale): string {
  const sharpness = effectiveSharpness(a);
  const clarity =
    sharpness >= 70 ? t(locale, 'aiExplain.clarity.high')
    : sharpness >= 45 ? t(locale, 'aiExplain.clarity.mid')
    : t(locale, 'aiExplain.clarity.low');

  const exposureDiff = a.exposure - 50;
  const exposure =
    Math.abs(exposureDiff) <= 10 ? t(locale, 'aiExplain.exposure.balanced')
    : exposureDiff < -10 ? t(locale, 'aiExplain.exposure.under')
    : t(locale, 'aiExplain.exposure.over');

  const flaws: string[] = [];
  if ((a.highlightClipping ?? 0) > 0.06) flaws.push(t(locale, 'aiExplain.flaw.highlights'));
  if ((a.shadowClipping ?? 0) > 0.06) flaws.push(t(locale, 'aiExplain.flaw.shadows'));
  if (a.iso !== undefined && a.iso >= 1600) flaws.push(t(locale, 'aiExplain.flaw.highIso', { iso: Math.round(a.iso) }));

  const flawsSuffix = flaws.length ? `, ${joinNatural(flaws, locale)}` : '';
  return t(locale, 'aiExplain.technical.sentence', { clarity, exposure, flawsSuffix });
}

// ── Axa compozitie ───────────────────────────────────────────────────────────

function compositionSentence(a: AnalysisRecord, locale: Locale): string | null {
  const hasFaces = a.faceCount > 0;
  if (hasFaces) {
    if (a.ruleOfThirds === undefined && a.headroom === undefined) return null;
    const thirds = (a.ruleOfThirds ?? 0.5) >= 0.6
      ? t(locale, 'aiExplain.comp.thirds.good')
      : t(locale, 'aiExplain.comp.thirds.centered');
    const direction = headroomDirection(a);
    const headroomNote = direction === 'tight'
      ? t(locale, 'aiExplain.comp.headroom.tight')
      : direction === 'loose'
        ? t(locale, 'aiExplain.comp.headroom.loose')
        : '';
    return t(locale, 'aiExplain.comp.faces.sentence', { thirds, headroomNote });
  }
  const notes: string[] = [];
  if (a.leadingLinesDetected) notes.push(t(locale, 'aiExplain.comp.leadingLines'));
  if (a.symmetryDetected) notes.push(t(locale, 'aiExplain.comp.symmetry'));
  if (a.horizonTiltDeg !== undefined && Math.abs(a.horizonTiltDeg) > 2) {
    notes.push(t(locale, 'aiExplain.comp.horizonTilt', { deg: Math.abs(a.horizonTiltDeg).toFixed(1) }));
  }
  if (!notes.length) return null;
  return t(locale, 'aiExplain.comp.scene.sentence', { notes: joinNatural(notes, locale) });
}

// ── Axa subiect / fete ───────────────────────────────────────────────────────

function subjectSentence(a: AnalysisRecord, locale: Locale): string | null {
  if (a.faceCount === 0) return null;
  const group = a.faceCount > 1;
  const smileFrac = group ? (a.groupSmileRatio ?? a.bestSmile) : a.bestSmile;
  const eyesFrac = group ? (a.groupEyesOpenRatio ?? (a.allEyesOpen ? 1 : 0)) : (a.allEyesOpen ? 1 : 0);

  // Bug real raportat de utilizator la testare: textul spunea "zambeste natural"
  // pentru orice zambet LARG (smileFrac mare), o afirmatie despre AUTENTICITATE
  // pe care nu o masura de fapt — doar cat de mult zambeste cineva, nu cat de
  // sincer pare. groupGenuineSmileRatio (calibrat pe date reale — vezi worker)
  // masoara exact asta (marker Duchenne: zambet + ochi usor ingustati); il
  // folosim ca sa decidem daca chiar putem sustine cuvantul "natural", altfel
  // descriem zambetul fara sa facem o afirmatie nesustinuta.
  const genuineAmongSmilers = smileFrac > 0 && a.groupGenuineSmileRatio !== undefined
    ? a.groupGenuineSmileRatio / smileFrac
    : undefined;
  const looksGenuine = genuineAmongSmilers !== undefined && genuineAmongSmilers >= 0.6;

  // Bug real raportat: pentru un grup de EXACT 2 persoane, "cativa zambesc" (plural
  // vag, sugereaza 3+) suna gresit cand de fapt inseamna mereu "unul din doi" —
  // singurul mod de a cadea in intervalul mediu [0.25, 0.6) cu faceCount === 2.
  const isPairMid = group && a.faceCount === 2 && smileFrac >= 0.25 && smileFrac < 0.6;

  const smileNote = smileFrac >= 0.6
    ? (looksGenuine
        ? t(locale, group ? 'aiExplain.smile.groupHigh' : 'aiExplain.smile.soloHigh')
        : t(locale, group ? 'aiExplain.smile.groupHighUnsure' : 'aiExplain.smile.soloHighUnsure'))
    : smileFrac >= 0.25
      ? (isPairMid ? t(locale, 'aiExplain.smile.groupMidPair') : t(locale, group ? 'aiExplain.smile.groupMid' : 'aiExplain.smile.soloMid'))
      : t(locale, group ? 'aiExplain.smile.groupLow' : 'aiExplain.smile.soloLow');

  const eyesNote = eyesFrac >= 0.999
    ? t(locale, group ? 'aiExplain.eyes.groupAll' : 'aiExplain.eyes.soloOpen')
    : eyesFrac >= 0.6
      ? t(locale, 'aiExplain.eyes.oneClosed')
      : t(locale, 'aiExplain.eyes.manyClosed');

  const parts = [smileNote, eyesNote];
  if (a.avgEyeContact !== undefined) {
    parts.push(t(locale, a.avgEyeContact >= 0.6 ? 'aiExplain.eyeContact.direct' : 'aiExplain.eyeContact.away'));
  }
  if (a.strangerCount > 0 && a.knownFaceCount > 0) {
    parts.push(t(locale, 'aiExplain.strangers', { count: a.strangerCount }));
  }
  const joined = joinNatural(parts, locale);
  return group
    ? t(locale, 'aiExplain.subject.group', { count: a.faceCount, parts: joined })
    : t(locale, 'aiExplain.subject.solo', { parts: joined });
}

// ── Axa estetica: lumina, culoare, bokeh ────────────────────────────────────

function aestheticSentence(a: AnalysisRecord, locale: Locale): string | null {
  const notes: string[] = [];
  if (a.lightQuality === 'hard') notes.push(t(locale, 'aiExplain.light.hard'));
  else if (a.lightQuality === 'soft') notes.push(t(locale, 'aiExplain.light.soft'));
  if (a.goldenHourDetected) notes.push(t(locale, 'aiExplain.goldenHour'));
  if (a.colorHarmonyScore !== undefined) {
    if (a.colorHarmonyScore >= 0.7) notes.push(t(locale, 'aiExplain.colorHarmony.good'));
    else if (a.colorHarmonyScore < 0.35) notes.push(t(locale, 'aiExplain.colorHarmony.poor'));
  }
  if (a.bokehQuality === 'good') notes.push(t(locale, 'aiExplain.bokeh.good'));
  else if (a.subjectInFocus === false) notes.push(t(locale, 'aiExplain.subjectNotInFocus'));
  if (!notes.length) return null;
  return t(locale, 'aiExplain.aesthetic.sentence', { notes: joinNatural(notes, locale) });
}

// ── Verdict: decizia AI vs. decizia utilizatorului + increderea modelului ──

function confidenceNote(locale: Locale, confidence: Confidence): string {
  return t(locale, `aiExplain.confidence.${confidence}`);
}

function verdictSentence(aiDecision: boolean, userDecision: boolean | null, confidence: Confidence, locale: Locale): string {
  const confidenceText = confidenceNote(locale, confidence);
  const aiVerb = t(locale, aiDecision ? 'aiExplain.verb.keep' : 'aiExplain.verb.reject');
  if (userDecision === null) {
    return t(locale, 'aiExplain.verdict.noUser', { verb: aiVerb, confidence: confidenceText });
  }
  if (aiDecision === userDecision) {
    return t(locale, userDecision ? 'aiExplain.verdict.agreeKeep' : 'aiExplain.verdict.agreeReject', { confidence: confidenceText });
  }
  return t(locale, userDecision ? 'aiExplain.verdict.disagreeKept' : 'aiExplain.verdict.disagreeRejected', { confidence: confidenceText });
}

function factorsSentence(a: AnalysisRecord, locale: Locale): string | null {
  const factors = explainFactors(a.aiFactors ?? [], locale);
  if (!factors.length) return null;
  const positive = factors.filter(f => f.positive).map(f => f.label);
  const negative = factors.filter(f => !f.positive).map(f => f.label);
  const bits: string[] = [];
  if (positive.length) bits.push(t(locale, 'aiExplain.factors.positive', { list: joinNatural(positive, locale) }));
  if (negative.length) bits.push(t(locale, 'aiExplain.factors.negative', { list: joinNatural(negative, locale) }));
  if (!bits.length) return null;
  return t(locale, 'aiExplain.factors.sentence', { bits: bits.join('; ') });
}

/**
 * Genereaza un rationament complet, in paragrafe, pentru scorul/decizia AI a
 * unei fotografii — combina axele tehnica, compozitie, subiect si estetica cu
 * un verdict final care compara decizia AI cu cea a utilizatorului.
 *
 * @param analysis     AnalysisRecord complet al fotografiei
 * @param aiDecision   ce a recomandat AI-ul (aiScore >= prag de selectie)
 * @param userDecision ce a decis efectiv utilizatorul (null = inca nicio decizie manuala)
 * @param contextModel modelul invatat pentru contextul acestei poze (null = inca neantrenat/cold start)
 * @param locale       limba textului generat (default 'ro', pentru compatibilitate cu apelantii existenti)
 */
export function generateExplanation(
  analysis: AnalysisRecord,
  aiDecision: boolean,
  userDecision: boolean | null,
  contextModel: ContextModelRecord | null,
  locale: Locale = 'ro'
): string[] {
  const confidence = modelConfidence(contextModel);
  const paragraphs = [
    technicalSentence(analysis, locale),
    compositionSentence(analysis, locale),
    subjectSentence(analysis, locale),
    aestheticSentence(analysis, locale),
    factorsSentence(analysis, locale),
    verdictSentence(aiDecision, userDecision, confidence, locale)
  ].filter((p): p is string => p !== null);
  return paragraphs;
}

// ── Sugestii de imbunatatire ─────────────────────────────────────────────────
// Diferit de paragrafele de mai sus (care descriu STAREA curenta a pozei):
// sugestiile spun ce s-ar putea corecta in editare sau evita la un cadru
// similar data viitoare. Maxim 4, in ordinea in care conteaza — defectele
// tehnice (neclaritate, expunere) nu se mai pot repara in post, asa ca
// preced sugestiile de compozitie/estetica, care macar uneori se pot ajusta.

const MAX_SUGGESTIONS = 4;

/** Ce ar face butonul "Aplica" (EditPanel/imageAdjust.ts) pentru o sugestie "now" — absent pe sugestiile "nextTime" (nimic de aplicat pe poza deja facuta). */
export type SuggestionFix = 'highlights' | 'shadows' | 'crop' | 'straighten' | 'saturation';

export interface Suggestion {
  text: string;
  /**
   * 'now' = reparabil in editorul din aplicatie, pe poza asta; 'nextTime' =
   * sfat pentru urmatorul cadru (stabilizare, incadrare, reshoot) — nu exista
   * nicio editare care sa repare retroactiv o poza neclara sau gresit
   * incadrata la captura. Distinctia conteaza direct pentru UI (PhotoInfoTabs):
   * fara ea, sugestii ca "verifica focalizarea inainte de declansare" apareau
   * amestecate cu altele chiar aplicabile acum, fara sa fie clar care-i care —
   * feedback direct de la utilizator ("sugestiile sunt prea generice").
   */
  when: 'now' | 'nextTime';
  /** Prezent doar cand when === 'now' — vezi computeAutoCrop/computeAutoStraighten/computeAutoAdjustments in core/imageAdjust.ts, care folosesc EXACT aceleasi praguri ca mai jos. */
  fix?: SuggestionFix;
}

/**
 * Genereaza sugestii concrete, actionabile, pentru o fotografie — spre
 * deosebire de generateExplanation (care explica scorul), aceasta functie
 * raspunde la "ce as putea face diferit". Listă goală = cadru fără defecte
 * clare de semnalat pe criteriile analizate. Praguri/ordine NESCHIMBATE fata
 * de versiunea anterioara (doar string[]) — doar metadata when/fix e noua.
 */
export function generateSuggestions(a: AnalysisRecord, locale: Locale = 'ro'): Suggestion[] {
  const s: Suggestion[] = [];

  if (effectiveSharpness(a) < 45) {
    s.push({ text: t(locale, 'aiSuggest.blur'), when: 'nextTime' });
  }
  const exposureDiff = a.exposure - 50;
  if (exposureDiff < -15) {
    s.push({ text: t(locale, 'aiSuggest.underexposed'), when: 'nextTime' });
  } else if (exposureDiff > 15) {
    s.push({ text: t(locale, 'aiSuggest.overexposed'), when: 'nextTime' });
  }
  if ((a.highlightClipping ?? 0) > 0.06) {
    s.push({ text: t(locale, 'aiSuggest.highlights'), when: 'now', fix: 'highlights' });
  }
  if ((a.shadowClipping ?? 0) > 0.06) {
    s.push({ text: t(locale, 'aiSuggest.shadows'), when: 'now', fix: 'shadows' });
  }
  if (a.iso !== undefined && a.iso >= 1600) {
    s.push({ text: t(locale, 'aiSuggest.highIso', { iso: Math.round(a.iso) }), when: 'nextTime' });
  }

  if (a.faceCount > 0) {
    const direction = headroomDirection(a);
    if (direction === 'tight') {
      s.push({ text: t(locale, 'aiSuggest.headroomTight'), when: 'nextTime' });
    } else if (direction === 'loose') {
      s.push({ text: t(locale, 'aiSuggest.headroomLoose'), when: 'nextTime' });
    }
    if ((a.ruleOfThirds ?? 0.5) < 0.4) {
      s.push({ text: t(locale, 'aiSuggest.centered'), when: 'now', fix: 'crop' });
    }
    const group = a.faceCount > 1;
    const eyesFrac = group ? (a.groupEyesOpenRatio ?? (a.allEyesOpen ? 1 : 0)) : (a.allEyesOpen ? 1 : 0);
    if (eyesFrac < 0.999) {
      s.push({ text: t(locale, group ? 'aiSuggest.eyesClosedGroup' : 'aiSuggest.eyesClosedSolo'), when: 'nextTime' });
    }
  } else {
    if (!a.leadingLinesDetected && !a.symmetryDetected) {
      s.push({ text: t(locale, 'aiSuggest.noLinesOrSymmetry'), when: 'nextTime' });
    }
    if (a.horizonTiltDeg !== undefined && Math.abs(a.horizonTiltDeg) > 2) {
      s.push({ text: t(locale, 'aiSuggest.horizonTilt', { deg: Math.abs(a.horizonTiltDeg).toFixed(1) }), when: 'now', fix: 'straighten' });
    }
  }

  if (a.subjectInFocus === false) {
    s.push({ text: t(locale, 'aiSuggest.notInFocus'), when: 'nextTime' });
  }
  if (a.colorHarmonyScore !== undefined && a.colorHarmonyScore < 0.35) {
    s.push({ text: t(locale, 'aiSuggest.colorHarmony'), when: 'now', fix: 'saturation' });
  }

  return s.slice(0, MAX_SUGGESTIONS);
}
