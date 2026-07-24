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
import { explainFactors } from './learning/ContextEngine';
import { t, type Locale } from '../i18n';

const COLD_START_SAMPLES = 8;   // acelasi prag ca in ContextEngine.ts
const TRAINED_SAMPLES = 40;

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
  const clarity =
    a.sharpness >= 70 ? t(locale, 'aiExplain.clarity.high')
    : a.sharpness >= 45 ? t(locale, 'aiExplain.clarity.mid')
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
    const headroomNote = (a.headroom ?? 0.5) < 0.3
      ? t(locale, 'aiExplain.comp.headroom.tight')
      : (a.headroom ?? 0.5) > 0.8
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

  const smileNote = smileFrac >= 0.6
    ? t(locale, group ? 'aiExplain.smile.groupHigh' : 'aiExplain.smile.soloHigh')
    : smileFrac >= 0.25 ? t(locale, group ? 'aiExplain.smile.groupMid' : 'aiExplain.smile.soloMid')
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

/**
 * Genereaza sugestii concrete, actionabile, pentru o fotografie — spre
 * deosebire de generateExplanation (care explica scorul), aceasta functie
 * raspunde la "ce as putea face diferit". Listă goală = cadru fără defecte
 * clare de semnalat pe criteriile analizate.
 */
export function generateSuggestions(a: AnalysisRecord, locale: Locale = 'ro'): string[] {
  const s: string[] = [];

  if (a.sharpness < 45) {
    s.push(t(locale, 'aiSuggest.blur'));
  }
  const exposureDiff = a.exposure - 50;
  if (exposureDiff < -15) {
    s.push(t(locale, 'aiSuggest.underexposed'));
  } else if (exposureDiff > 15) {
    s.push(t(locale, 'aiSuggest.overexposed'));
  }
  if ((a.highlightClipping ?? 0) > 0.06) {
    s.push(t(locale, 'aiSuggest.highlights'));
  }
  if ((a.shadowClipping ?? 0) > 0.06) {
    s.push(t(locale, 'aiSuggest.shadows'));
  }
  if (a.iso !== undefined && a.iso >= 1600) {
    s.push(t(locale, 'aiSuggest.highIso', { iso: Math.round(a.iso) }));
  }

  if (a.faceCount > 0) {
    if ((a.headroom ?? 0.5) < 0.3) {
      s.push(t(locale, 'aiSuggest.headroomTight'));
    } else if ((a.headroom ?? 0.5) > 0.8) {
      s.push(t(locale, 'aiSuggest.headroomLoose'));
    }
    if ((a.ruleOfThirds ?? 0.5) < 0.4) {
      s.push(t(locale, 'aiSuggest.centered'));
    }
    const group = a.faceCount > 1;
    const eyesFrac = group ? (a.groupEyesOpenRatio ?? (a.allEyesOpen ? 1 : 0)) : (a.allEyesOpen ? 1 : 0);
    if (eyesFrac < 0.999) {
      s.push(t(locale, group ? 'aiSuggest.eyesClosedGroup' : 'aiSuggest.eyesClosedSolo'));
    }
  } else {
    if (!a.leadingLinesDetected && !a.symmetryDetected) {
      s.push(t(locale, 'aiSuggest.noLinesOrSymmetry'));
    }
    if (a.horizonTiltDeg !== undefined && Math.abs(a.horizonTiltDeg) > 2) {
      s.push(t(locale, 'aiSuggest.horizonTilt', { deg: Math.abs(a.horizonTiltDeg).toFixed(1) }));
    }
  }

  if (a.subjectInFocus === false) {
    s.push(t(locale, 'aiSuggest.notInFocus'));
  }
  if (a.colorHarmonyScore !== undefined && a.colorHarmonyScore < 0.35) {
    s.push(t(locale, 'aiSuggest.colorHarmony'));
  }

  return s.slice(0, MAX_SUGGESTIONS);
}
