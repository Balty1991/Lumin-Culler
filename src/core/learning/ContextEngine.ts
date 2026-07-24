/**
 * core/learning/ContextEngine.ts
 *
 * The evolution of the old `Learner` IIFE into a real service.
 *
 * Design:
 *  - One online logistic-regression model PER CONTEXT ("portrait:known",
 *    "landscape", "group:mixed", ...), so the engine can learn things like:
 *    "user prefers slightly under-exposed dramatic portraits, but bright,
 *    razor-sharp landscapes" — the exact scenario the old global-weights
 *    Learner could never represent.
 *  - Online SGD with adaptive learning rate (lr / sqrt(n)) and L2 regularization.
 *  - Feature normalization via Welford running mean/variance per context, so
 *    weights are comparable and training is stable regardless of feature scale.
 *  - Every state mutation is persisted to IndexedDB (Dexie) — survives reloads,
 *    works offline, zero RAM pressure.
 *  - Pure TypeScript, no DOM access → can also run inside a worker if needed.
 */

import { db, type AnalysisRecord, type ContextModelRecord } from '../db';

// ── Types ────────────────────────────────────────────────────────────────────

export type FeatureVector = Record<string, number>;

export interface Prediction {
  score: number;          // 0..100, calibrated probability * 100
  probability: number;    // 0..1 P(user selects this photo)
  contextKey: string;
  confidence: 'cold' | 'warming' | 'trained';  // based on sampleCount
  topFactors: { feature: string; contribution: number }[];
}

export interface CorrectionInput {
  photoId: string;
  analysis: AnalysisRecord;
  aiDecision: boolean;    // what the AI recommended
  userDecision: boolean;  // what the user actually chose
  /** Genul fotografic activ pentru aceasta poza (PhotoRecord.genre) — vezi deriveContextKey. */
  genre?: string;
}

interface FeatureStat { mean: number; m2: number; n: number }

// ── Constants ────────────────────────────────────────────────────────────────

const BASE_LR = 0.35;
const L2_LAMBDA = 0.002;
const MAX_ABS_WEIGHT = 4.0;
const COLD_START_SAMPLES = 8;
const TRAINED_SAMPLES = 40;

/** Sensible priors so the engine is useful before any correction exists. */
const PRIOR_WEIGHTS: FeatureVector = {
  sharpness: 0.9,
  exposureBalance: 0.5,
  bestSmile: 0.7,
  allEyesOpen: 0.8,
  knownFaceRatio: 0.6,
  strangerPenalty: -0.5,
  faceScore: 0.4,
  faceCount: 0.1,
  // compozitie (regula treimilor, headroom) — bonus modest, nu domina claritatea/expunerea/ochii
  ruleOfThirds: 0.3,
  headroom: 0.25,
  // scorare de GRUP (toate fetele, nu doar cea mai buna/stricta) — ponderi mai
  // mici decat allEyesOpen/bestSmile pentru ca la o singura fata sunt identice
  // cu acestea (redundante); la poze de grup aduc semnal suplimentar real
  groupEyesOpenRatio: 0.5,
  groupSmileRatio: 0.4,
  avgEyeContact: 0.35,
  avgEngagement: 0.3,
  highlightClipping: -0.4,
  shadowClipping: -0.3,
  horizonLevel: 0.25,
  // EXIF: doar ISO are o directie universala rezonabila (zgomot ↑ = calitate
  // tehnica ↓, in medie) — modesta, fotografii chiar aleg ISO ridicat cu buna
  // stiinta (astro, concerte). Diafragma/viteza/focala NU au o directie
  // universala (context-dependente: portret vrea diafragma deschisa, peisaj
  // vrea inchisa) — pornesc la 0, invatate DOAR din corectii reale, per context.
  isoPenalty: -0.15,
  apertureRaw: 0,
  shutterSpeedRaw: 0,
  focalLengthRaw: 0,
  // analiza estetica avansata (compozitie extinsa, lumina, culoare) — vezi
  // core/db.ts (AnalysisRecord) si workers/faceAnalysis.worker.ts pentru cum
  // sunt calculate. Prioritati modeste: compozitia si focusul subiectului au
  // un consens fotografic clar (bonus pozitiv rezonabil), pe cand duritatea
  // luminii si spatiul negativ sunt preferinte pur de stil — pornesc la 0,
  // invatate DOAR din corectii reale, per context (acelasi tipar ca diafragma/
  // viteza/focala mai sus).
  compositionScore: 0.3,
  leadingLines: 0.15,
  symmetry: 0.1,
  negativeSpace: 0,
  lightHard: 0,
  lightSoft: 0,
  goldenHour: 0.2,
  subjectInFocus: 0.6,
  bokehQuality: 0.2,
  colorHarmony: 0.25
};

/**
 * Nume scurte, lizibile, per feature — folosite pentru explicabilitate PER POZA
 * ("de ce a primit acest scor", DetailView), diferit de perechile pozitiv/negativ
 * din summarize() (care descriu directia PONDERII invatate, nu contributia unei
 * poze anume).
 */
export const FACTOR_LABELS: Record<string, string> = {
  sharpness: 'Claritate',
  exposureBalance: 'Expunere echilibrată',
  exposureRaw: 'Nivel de expunere',
  bestSmile: 'Zâmbet',
  allEyesOpen: 'Ochi deschiși',
  faceCount: 'Număr de fețe',
  knownFaceRatio: 'Persoane cunoscute',
  strangerPenalty: 'Străini în cadru',
  faceScore: 'Calitatea feței',
  ruleOfThirds: 'Regula treimilor',
  headroom: 'Cadraj (headroom)',
  groupEyesOpenRatio: 'Ochi deschiși (grup)',
  groupSmileRatio: 'Zâmbete (grup)',
  avgEyeContact: 'Contact vizual',
  avgEngagement: 'Expresie',
  highlightClipping: 'Highlights arse',
  shadowClipping: 'Umbre blocate',
  horizonLevel: 'Orizont drept',
  isoPenalty: 'ISO / zgomot',
  apertureRaw: 'Diafragmă',
  shutterSpeedRaw: 'Viteză obturator',
  focalLengthRaw: 'Distanță focală',
  compositionScore: 'Compoziție',
  leadingLines: 'Linii directoare',
  symmetry: 'Simetrie',
  negativeSpace: 'Spațiu negativ',
  lightHard: 'Lumină dură',
  lightSoft: 'Lumină difuză',
  goldenHour: 'Ora de aur',
  subjectInFocus: 'Subiect în focus',
  bokehQuality: 'Bokeh',
  colorHarmony: 'Armonie cromatică'
};

/** Transforma topFactors dintr-o Prediction in etichete afisabile, filtrand contributiile neglijabile. */
export function explainFactors(topFactors: { feature: string; contribution: number }[]): { label: string; positive: boolean }[] {
  return topFactors
    .filter(f => FACTOR_LABELS[f.feature] && Math.abs(f.contribution) > 0.03)
    .map(f => ({ label: FACTOR_LABELS[f.feature], positive: f.contribution >= 0 }));
}

// ── Feature extraction ───────────────────────────────────────────────────────

export function extractFeatures(a: AnalysisRecord): FeatureVector {
  return {
    sharpness: a.sharpness / 100,
    // distance from mid-exposure — lets the model learn a *preference direction*
    exposureBalance: 1 - Math.abs(a.exposure - 50) / 50,
    exposureRaw: a.exposure / 100,           // raw value → can learn "prefers darker"
    bestSmile: a.bestSmile,
    allEyesOpen: a.allEyesOpen ? 1 : 0,
    faceCount: Math.min(a.faceCount, 6) / 6,
    knownFaceRatio: a.faceCount ? a.knownFaceCount / a.faceCount : 0,
    strangerPenalty: a.faceCount ? a.strangerCount / a.faceCount : 0,
    faceScore: a.faces.length
      ? a.faces.reduce((s, f) => s + f.faceScore, 0) / a.faces.length
      : 0,
    // ?? 0.5 (neutru) pentru poze fara fete si pentru inregistrari mai vechi
    // dinainte de aceasta functie, care nu au deloc campurile — nu 0, ca sa nu
    // le penalizeze artificial fata de pozele care chiar au compozitie proasta
    ruleOfThirds: a.ruleOfThirds ?? 0.5,
    headroom: a.headroom ?? 0.5,
    // scorare de grup — neutru (0.5) cand nu exista fete (feature-ul nu se aplica)
    groupEyesOpenRatio: a.groupEyesOpenRatio ?? 0.5,
    groupSmileRatio: a.groupSmileRatio ?? 0.5,
    avgEyeContact: a.avgEyeContact ?? 0.5,
    avgEngagement: a.avgEngagement ?? 0.5,
    // clipping: fara date (inregistrari vechi) = presupunem 0 (fara clipping), nu neutru —
    // altfel penalizam artificial poze analizate inainte de aceasta functie
    highlightClipping: a.highlightClipping ?? 0,
    shadowClipping: a.shadowClipping ?? 0,
    // orizont: convertit din grade in scor 0..1 (1 = perfect drept); 0.5 neutru
    // cand nu s-a putut estima (poze cu fete, sau prea putine muchii clare)
    horizonLevel: a.horizonTiltDeg !== undefined ? Math.max(0, 1 - Math.abs(a.horizonTiltDeg) / 15) : 0.5,
    // EXIF — scale logaritmice (in "stops", cum gandesc fotografii), 0 cand
    // lipseste (coincide cu "ISO de baza", nu introduce penalizare falsa)
    isoPenalty: a.iso !== undefined ? Math.min(1, Math.max(0, Math.log2(Math.max(a.iso, 50) / 100) / 6)) : 0,
    // diafragma/viteza/focala: 0.5 (neutru) cand lipsesc — ponderea de start
    // e oricum 0, dar 0.5 e mai corect semantic decat 0 daca modelul invata
    // vreodata o pondere ne-zero (0 ar insemna "extrem", nu "necunoscut")
    apertureRaw: a.fNumber !== undefined ? Math.min(1, Math.max(0, (a.fNumber - 1) / 21)) : 0.5,
    shutterSpeedRaw: a.exposureTime && a.exposureTime > 0
      ? Math.min(1, Math.max(0, Math.log2(Math.max(1 / a.exposureTime, 1)) / 13))
      : 0.5,
    focalLengthRaw: a.focalLength !== undefined ? Math.min(1, Math.max(0, Math.log2(Math.max(a.focalLength, 10) / 10) / 8)) : 0.5,
    // analiza estetica avansata — booleene absente (inregistrari mai vechi) =
    // neutru (0.5), nu 0/1, ca sa nu penalizeze/favorizeze artificial poze
    // analizate inainte de aceste campuri (acelasi tipar ca ruleOfThirds/headroom mai sus)
    compositionScore: a.compositionScore ?? 0.5,
    leadingLines: a.leadingLinesDetected === undefined ? 0.5 : (a.leadingLinesDetected ? 1 : 0),
    symmetry: a.symmetryDetected === undefined ? 0.5 : (a.symmetryDetected ? 1 : 0),
    negativeSpace: a.negativeSpaceScore ?? 0.5,
    lightHard: a.lightQuality === 'hard' ? 1 : 0,
    lightSoft: a.lightQuality === 'soft' ? 1 : 0,
    goldenHour: a.goldenHourDetected ? 1 : 0,
    subjectInFocus: a.subjectInFocus === undefined ? 0.5 : (a.subjectInFocus ? 1 : 0),
    bokehQuality: a.bokehQuality === 'good' ? 1 : a.bokehQuality === 'poor' ? 0 : 0.5,
    colorHarmony: a.colorHarmonyScore ?? 0.5
  };
}

/**
 * Context key: [gen:] + sceneType + subject familiarity. Each key gets its own model.
 * Genul fotografic (optional, ales de utilizator per import — vezi state/genre.ts si
 * PhotoRecord.genre) prefixeaza cheia: "Nunta:portrait:known" invata ponderi complet
 * separate de "Peisaj:landscape" sau de "portrait:known" (fara gen ales). Aceasta e
 * extensia "ContextEngine 2.0" din planul de dezvoltare — utilizatorii care lucreaza
 * in mai multe genuri (nunti vs. peisaj) nu mai impart acelasi model per scena.
 */
export function deriveContextKey(a: AnalysisRecord, genre?: string): string {
  const base =
    a.faceCount === 0 ? a.sceneType               // "landscape" | "detail"
    : a.strangerCount === 0 ? `${a.sceneType}:known`
    : a.knownFaceCount === 0 ? `${a.sceneType}:strangers`
    : `${a.sceneType}:mixed`;
  const trimmed = genre?.trim();
  return trimmed ? `${trimmed}:${base}` : base;
}

// ── Engine ───────────────────────────────────────────────────────────────────

export class ContextEngine {
  private models = new Map<string, ContextModelRecord>();
  private loaded = false;

  async init(): Promise<void> {
    if (this.loaded) return;
    const rows = await db.contextModels.toArray();
    for (const row of rows) this.models.set(row.contextKey, row);
    this.loaded = true;
  }

  // ── Prediction ─────────────────────────────────────────────────────────────

  async predict(analysis: AnalysisRecord, genre?: string): Promise<Prediction> {
    await this.init();
    const contextKey = deriveContextKey(analysis, genre);
    const model = this.getOrCreateModel(contextKey);
    const features = extractFeatures(analysis);
    const normalized = this.normalize(model, features, /*update=*/ false);

    let z = model.bias;
    const contributions: { feature: string; contribution: number }[] = [];
    for (const [k, v] of Object.entries(normalized)) {
      const w = model.weights[k] ?? 0;
      z += w * v;
      contributions.push({ feature: k, contribution: w * v });
    }
    const probability = 1 / (1 + Math.exp(-z));
    contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    return {
      score: Math.round(probability * 100),
      probability,
      contextKey,
      confidence:
        model.sampleCount < COLD_START_SAMPLES ? 'cold'
        : model.sampleCount < TRAINED_SAMPLES ? 'warming'
        : 'trained',
      topFactors: contributions.slice(0, 4)
    };
  }

  // ── Learning from manual corrections ───────────────────────────────────────

  /**
   * Called on EVERY manual decision (not only disagreements): agreements
   * reinforce, disagreements correct. Online SGD on log-loss.
   */
  async recordCorrection(input: CorrectionInput): Promise<void> {
    await this.init();
    const contextKey = deriveContextKey(input.analysis, input.genre);
    const model = this.getOrCreateModel(contextKey);
    const features = extractFeatures(input.analysis);

    // Update normalization stats FIRST (Welford), then normalize with them.
    const normalized = this.normalize(model, features, /*update=*/ true);

    // Forward pass
    let z = model.bias;
    for (const [k, v] of Object.entries(normalized)) z += (model.weights[k] ?? 0) * v;
    const p = 1 / (1 + Math.exp(-z));
    const y = input.userDecision ? 1 : 0;
    const error = p - y;

    // Adaptive learning rate: fast when cold, stable when trained.
    // Disagreements with the AI are stronger evidence → boosted step.
    const disagreement = input.aiDecision !== input.userDecision;
    const lr = (BASE_LR / Math.sqrt(model.sampleCount + 1)) * (disagreement ? 1.6 : 1.0);

    for (const [k, v] of Object.entries(normalized)) {
      const w = model.weights[k] ?? 0;
      const updated = w - lr * (error * v + L2_LAMBDA * w);
      model.weights[k] = Math.max(-MAX_ABS_WEIGHT, Math.min(MAX_ABS_WEIGHT, updated));
    }
    model.bias -= lr * error;
    model.sampleCount++;
    model.updatedAt = Date.now();

    await Promise.all([
      db.contextModels.put(model),
      db.corrections.add({
        photoId: input.photoId,
        contextKey,
        features,
        aiDecision: input.aiDecision,
        userDecision: input.userDecision,
        ts: Date.now()
      })
    ]);
  }

  // ── Explainability (feeds the "Preferinte AI" panel in UI) ─────────────────

  /** Rezumat lizibil al tuturor contextelor invatate — pentru panoul "Preferinte AI" din UI. */
  async summarize(): Promise<{
    contextKey: string;
    sampleCount: number;
    confidence: Prediction['confidence'];
    notes: string[];
    /** aceleasi ponderi de top care alimenteaza `notes`, in forma bruta — pentru grafice (InsightsChart). */
    topWeights: { feature: string; label: string; weight: number }[];
    /**
     * TOATE ponderile modelului (nu doar top 4), inclusiv cele aproape zero —
     * pentru utilizatorii care vor sa vada profilul complet invatat, nu doar
     * un rezumat. Spre deosebire de topWeights, nu e gatat de COLD_START_SAMPLES:
     * starea reala (chiar daca e doar prior-ul initial) e mai utila decat gol.
     */
    allWeights: { feature: string; label: string; weight: number }[];
  }[]> {
    await this.init();
    const labels: Record<string, [string, string]> = {
      sharpness: ['claritate maximă', 'tolerează blur artistic'],
      exposureRaw: ['imagini luminoase', 'ton dramatic, subexpus'],
      bestSmile: ['zâmbete largi', 'expresii serioase'],
      allEyesOpen: ['ochi deschiși obligatoriu', 'acceptă ochi închiși'],
      knownFaceRatio: ['prioritate subiecți cunoscuți', 'indiferent la subiecți'],
      strangerPenalty: ['acceptă străini în cadru', 'evită străinii în cadru'],
      ruleOfThirds: ['compune după regula treimilor', 'preferă subiecte centrate'],
      headroom: ['spațiu echilibrat deasupra capului', 'tolerează cadraj strâns/lejer'],
      groupEyesOpenRatio: ['strict cu ochii închiși la poze de grup', 'tolerează pe cineva cu ochii închiși în grup'],
      groupSmileRatio: ['prioritate grupuri unde toți zâmbesc', 'indiferent la zâmbetul grupului'],
      avgEyeContact: ['preferă contact vizual cu camera', 'acceptă priviri în altă parte'],
      avgEngagement: ['preferă expresii vii, pozitive', 'acceptă expresii neutre/serioase'],
      highlightClipping: ['evită highlights arse', 'tolerează zone supraexpuse'],
      shadowClipping: ['evită umbre blocate', 'tolerează zone subexpuse'],
      horizonLevel: ['preferă orizont perfect drept', 'tolerează orizont ușor înclinat'],
      isoPenalty: ['preferă ISO scăzut/curat', 'tolerează ISO ridicat/zgomot'],
      apertureRaw: ['preferă diafragmă închisă (totul clar)', 'preferă diafragmă deschisă (fundal difuz)'],
      shutterSpeedRaw: ['preferă viteze lente (blur de mișcare)', 'preferă viteze rapide (îngheață mișcarea)'],
      focalLengthRaw: ['preferă cadre wide (peisaj/context)', 'preferă cadre tele (portret/apropiere)'],
      compositionScore: ['compoziție îngrijită (linii/simetrie/spațiu)', 'tolerează compoziție mai liberă'],
      leadingLines: ['preferă linii directoare puternice', 'indiferent la liniile directoare'],
      symmetry: ['preferă cadre simetrice', 'preferă cadre asimetrice/dinamice'],
      negativeSpace: ['preferă mult spațiu negativ (minimalist)', 'preferă cadre aglomerate/pline'],
      lightHard: ['preferă lumină dură, contrastantă', 'evită lumina dură'],
      lightSoft: ['preferă lumină difuză, blândă', 'evită lumina prea plată'],
      goldenHour: ['preferă cadre din ora de aur', 'indiferent la ora capturii'],
      subjectInFocus: ['cere subiectul perfect în focus', 'tolerează subiect ușor neclar'],
      bokehQuality: ['preferă fundal difuz (bokeh)', 'preferă totul clar, fără bokeh'],
      colorHarmony: ['preferă palete de culori armonioase', 'indiferent la armonia culorilor']
    };
    return Array.from(this.models.values())
      .map(model => {
        const ranked = Object.entries(model.weights)
          .filter(([k]) => k in labels)
          .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
          .slice(0, 4);
        return {
          contextKey: model.contextKey,
          sampleCount: model.sampleCount,
          confidence:
            model.sampleCount < COLD_START_SAMPLES ? ('cold' as const)
            : model.sampleCount < TRAINED_SAMPLES ? ('warming' as const)
            : ('trained' as const),
          notes: model.sampleCount < COLD_START_SAMPLES ? [] : ranked.map(([k, w]) => w >= 0 ? labels[k][0] : labels[k][1]),
          topWeights: model.sampleCount < COLD_START_SAMPLES ? [] : ranked.map(([k, w]) => ({
            feature: k, label: FACTOR_LABELS[k] ?? k, weight: w
          })),
          allWeights: Object.entries(model.weights)
            .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
            .map(([k, w]) => ({ feature: k, label: FACTOR_LABELS[k] ?? k, weight: w }))
        };
      })
      .sort((a, b) => b.sampleCount - a.sampleCount);
  }

  /** Re-citeste modelele din DB, ignorand cache-ul in memorie — necesar dupa ce alt cod (ex. restaurarea unui backup) a scris direct in db.contextModels. */
  async reload(): Promise<void> {
    this.models.clear();
    this.loaded = false;
    await this.init();
  }

  async reset(contextKey?: string): Promise<void> {
    if (contextKey) {
      this.models.delete(contextKey);
      await db.contextModels.delete(contextKey);
    } else {
      this.models.clear();
      await db.contextModels.clear();
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private getOrCreateModel(contextKey: string): ContextModelRecord {
    let model = this.models.get(contextKey);
    if (!model) {
      model = {
        contextKey,
        weights: { ...PRIOR_WEIGHTS },
        bias: 0,
        featureStats: {},
        sampleCount: 0,
        updatedAt: Date.now()
      };
      this.models.set(contextKey, model);
    }
    return model;
  }

  /** Welford running normalization: z = (x - mean) / std, clamped to ±3. */
  private normalize(model: ContextModelRecord, features: FeatureVector, update: boolean): FeatureVector {
    const out: FeatureVector = {};
    for (const [k, x] of Object.entries(features)) {
      let s: FeatureStat = model.featureStats[k] ?? { mean: 0, m2: 0, n: 0 };
      if (update) {
        s = { ...s, n: s.n + 1 };
        const delta = x - s.mean;
        s.mean += delta / s.n;
        s.m2 += delta * (x - s.mean);
        model.featureStats[k] = s;
      }
      const variance = s.n > 1 ? s.m2 / (s.n - 1) : 1;
      const std = Math.sqrt(Math.max(variance, 1e-4));
      const z = s.n > 2 ? (x - s.mean) / std : x; // raw until stats warm up
      out[k] = Math.max(-3, Math.min(3, z));
    }
    return out;
  }
}

export const contextEngine = new ContextEngine();
