/**
 * core/aiExplanationGenerator.ts
 *
 * Genereaza explicatii detaliate, in limba romana, pentru decizia AI despre o
 * fotografie — un rationament pe mai multe axe (tehnic, compozitie, subiect/
 * fete, estetica), plus un verdict care compara decizia AI cu cea a
 * utilizatorului si mentioneaza increderea modelului. Nu introduce calcule
 * noi: interpreteaza in propozitii campurile deja calculate in AnalysisRecord
 * (faceAnalysis.worker.ts) si ponderile invatate de ContextEngine — acelasi
 * rol ca `explainFactors` (tag-uri scurte, pentru UI compact), dar in forma
 * de text continuu, mai apropiat de cum ar explica un fotograf uman.
 *
 * `contextModel` e opt­ional: la "cold start" (inca nu exista model salvat
 * pentru acest tip de scena) nu exista inca niciun ContextModelRecord in DB —
 * explicatia trebuie sa functioneze si atunci, doar ca mentioneaza ca
 * increderea e minima si recomandarea se bazeaza pe reguli generale.
 */
import type { AnalysisRecord, ContextModelRecord } from './db';
import { explainFactors } from './learning/ContextEngine';

const COLD_START_SAMPLES = 8;   // acelasi prag ca in ContextEngine.ts
const TRAINED_SAMPLES = 40;

type Confidence = 'cold' | 'warming' | 'trained';

function modelConfidence(model: ContextModelRecord | null): Confidence {
  if (!model) return 'cold';
  if (model.sampleCount < COLD_START_SAMPLES) return 'cold';
  if (model.sampleCount < TRAINED_SAMPLES) return 'warming';
  return 'trained';
}

function joinNatural(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(', ') + ' și ' + parts[parts.length - 1];
}

// ── Axa tehnica: claritate, expunere, ISO ───────────────────────────────────

function technicalSentence(a: AnalysisRecord): string {
  const clarity =
    a.sharpness >= 70 ? 'foarte clară'
    : a.sharpness >= 45 ? 'suficient de clară'
    : 'neclară, cu blur vizibil';

  const exposureDiff = a.exposure - 50;
  const exposure =
    Math.abs(exposureDiff) <= 10 ? 'o expunere echilibrată'
    : exposureDiff < -10 ? 'o expunere spre subexpus'
    : 'o expunere spre supraexpus';

  const flaws: string[] = [];
  if ((a.highlightClipping ?? 0) > 0.06) flaws.push('cu zone arse (highlights fără detaliu)');
  if ((a.shadowClipping ?? 0) > 0.06) flaws.push('cu umbre blocate fără detaliu');
  if (a.iso !== undefined && a.iso >= 1600) flaws.push(`cu ISO ${Math.round(a.iso)} (zgomot vizibil probabil)`);

  let sentence = `Fotografia este ${clarity}, cu ${exposure}`;
  sentence += flaws.length ? `, ${joinNatural(flaws)}.` : '.';
  return sentence;
}

// ── Axa compozitie ───────────────────────────────────────────────────────────

function compositionSentence(a: AnalysisRecord): string | null {
  const hasFaces = a.faceCount > 0;
  if (hasFaces) {
    if (a.ruleOfThirds === undefined && a.headroom === undefined) return null;
    const thirds = (a.ruleOfThirds ?? 0.5) >= 0.6
      ? 'subiectul este bine încadrat conform regulii treimilor'
      : 'subiectul este destul de centrat, fără să urmeze regula treimilor';
    const headroomNote = (a.headroom ?? 0.5) < 0.3
      ? ', dar spațiul deasupra capului e prea strâns'
      : (a.headroom ?? 0.5) > 0.8
        ? ', dar rămâne prea mult spațiu gol deasupra capului'
        : '';
    return `Compozițional, ${thirds}${headroomNote}.`;
  }
  const notes: string[] = [];
  if (a.leadingLinesDetected) notes.push('linii directoare vizibile care ghidează privirea');
  if (a.symmetryDetected) notes.push('o compoziție simetrică');
  if (a.horizonTiltDeg !== undefined && Math.abs(a.horizonTiltDeg) > 2) {
    notes.push(`orizontul e înclinat cu ${Math.abs(a.horizonTiltDeg).toFixed(1)}°`);
  }
  if (!notes.length) return null;
  return `Compozițional, cadrul are ${joinNatural(notes)}.`;
}

// ── Axa subiect / fete ───────────────────────────────────────────────────────

function subjectSentence(a: AnalysisRecord): string | null {
  if (a.faceCount === 0) return null;
  const group = a.faceCount > 1;
  const smileFrac = group ? (a.groupSmileRatio ?? a.bestSmile) : a.bestSmile;
  const eyesFrac = group ? (a.groupEyesOpenRatio ?? (a.allEyesOpen ? 1 : 0)) : (a.allEyesOpen ? 1 : 0);

  const smileNote = smileFrac >= 0.6
    ? (group ? 'majoritatea zâmbesc natural' : 'subiectul zâmbește natural')
    : smileFrac >= 0.25 ? (group ? 'câțiva zâmbesc' : 'zâmbet ușor')
    : (group ? 'expresii mai degrabă serioase' : 'expresie serioasă, fără zâmbet');

  const eyesNote = eyesFrac >= 0.999
    ? (group ? 'toată lumea are ochii deschiși' : 'are ochii deschiși')
    : eyesFrac >= 0.6
      ? 'o persoană din cadru are ochii închiși'
      : 'mai multe persoane au ochii închiși sau clipesc';

  const parts = [smileNote, eyesNote];
  if (a.avgEyeContact !== undefined) {
    parts.push(a.avgEyeContact >= 0.6 ? 'contact vizual direct cu camera' : 'privirea nu e ațintită spre cameră');
  }
  if (a.strangerCount > 0 && a.knownFaceCount > 0) {
    parts.push(`${a.strangerCount} persoană(e) necunoscută(e) alături de cele cunoscute`);
  }
  return `${group ? `Cele ${a.faceCount} fețe: ` : 'Subiectul: '}${joinNatural(parts)}.`;
}

// ── Axa estetica: lumina, culoare, bokeh ────────────────────────────────────

function aestheticSentence(a: AnalysisRecord): string | null {
  const notes: string[] = [];
  if (a.lightQuality === 'hard') notes.push('lumină dură, cu umbre nete');
  else if (a.lightQuality === 'soft') notes.push('lumină difuză, plăcută');
  if (a.goldenHourDetected) notes.push('tonuri calde specifice orei de aur');
  if (a.colorHarmonyScore !== undefined) {
    if (a.colorHarmonyScore >= 0.7) notes.push('o paletă de culori armonioasă');
    else if (a.colorHarmonyScore < 0.35) notes.push('culori dezordonate, fără o paletă clară');
  }
  if (a.bokehQuality === 'good') notes.push('fundal frumos difuzat (bokeh reușit)');
  else if (a.subjectInFocus === false) notes.push('subiectul principal nu e cel mai clar element din cadru');
  if (!notes.length) return null;
  return `Din punct de vedere estetic: ${joinNatural(notes)}.`;
}

// ── Verdict: decizia AI vs. decizia utilizatorului + increderea modelului ──

const CONFIDENCE_NOTE: Record<Confidence, string> = {
  cold: 'Modelul e la început pentru acest tip de scenă (sub 8 decizii învățate) — recomandarea se bazează mai ales pe reguli generale de fotografie, nu încă pe preferințele tale.',
  warming: 'Modelul e în curs de învățare pentru acest tip de scenă — recomandarea combină regulile generale cu ce a observat până acum din alegerile tale.',
  trained: 'Modelul e antrenat pe acest tip de scenă (peste 40 de decizii învățate) — recomandarea reflectă îndeaproape preferințele tale.'
};

function verdictSentence(aiDecision: boolean, userDecision: boolean | null, confidence: Confidence): string {
  const aiVerb = aiDecision ? 'ar păstra' : 'ar respinge';
  if (userDecision === null) {
    return `AI-ul ${aiVerb} această fotografie. ${CONFIDENCE_NOTE[confidence]}`;
  }
  if (aiDecision === userDecision) {
    return userDecision
      ? `AI-ul a recomandat păstrarea acestei fotografii, iar tu ai confirmat aceeași alegere. ${CONFIDENCE_NOTE[confidence]}`
      : `AI-ul a recomandat respingerea acestei fotografii, iar tu ai fost de acord. ${CONFIDENCE_NOTE[confidence]}`;
  }
  return userDecision
    ? `AI-ul ar fi respins această fotografie, dar tu ai păstrat-o — motorul învață din corecția ta și își va ajusta preferințele pentru acest tip de scenă. ${CONFIDENCE_NOTE[confidence]}`
    : `AI-ul ar fi păstrat această fotografie, dar tu ai respins-o — motorul învață din corecția ta și își va ajusta preferințele pentru acest tip de scenă. ${CONFIDENCE_NOTE[confidence]}`;
}

function factorsSentence(a: AnalysisRecord): string | null {
  const factors = explainFactors(a.aiFactors ?? []);
  if (!factors.length) return null;
  const positive = factors.filter(f => f.positive).map(f => f.label);
  const negative = factors.filter(f => !f.positive).map(f => f.label);
  const bits: string[] = [];
  if (positive.length) bits.push(`în favoarea ei: ${joinNatural(positive)}`);
  if (negative.length) bits.push(`împotriva ei: ${joinNatural(negative)}`);
  if (!bits.length) return null;
  return `Principalii factori care au cântărit în scor — ${bits.join('; ')}.`;
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
 */
export function generateExplanation(
  analysis: AnalysisRecord,
  aiDecision: boolean,
  userDecision: boolean | null,
  contextModel: ContextModelRecord | null
): string[] {
  const confidence = modelConfidence(contextModel);
  const paragraphs = [
    technicalSentence(analysis),
    compositionSentence(analysis),
    subjectSentence(analysis),
    aestheticSentence(analysis),
    factorsSentence(analysis),
    verdictSentence(aiDecision, userDecision, confidence)
  ].filter((p): p is string => p !== null);
  return paragraphs;
}
