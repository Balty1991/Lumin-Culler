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
  faceCount: 0.1
};

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
      : 0
  };
}

/** Context key: sceneType + subject familiarity. Each key gets its own model. */
export function deriveContextKey(a: AnalysisRecord): string {
  if (a.faceCount === 0) return a.sceneType;               // "landscape" | "detail"
  if (a.strangerCount === 0) return `${a.sceneType}:known`;
  if (a.knownFaceCount === 0) return `${a.sceneType}:strangers`;
  return `${a.sceneType}:mixed`;
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

  async predict(analysis: AnalysisRecord): Promise<Prediction> {
    await this.init();
    const contextKey = deriveContextKey(analysis);
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
    const contextKey = deriveContextKey(input.analysis);
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

  // ── Explainability (feeds the "ML Weights" panel from the old UI) ─────────

  async describePreferences(contextKey: string): Promise<string[]> {
    await this.init();
    const model = this.models.get(contextKey);
    if (!model || model.sampleCount < COLD_START_SAMPLES) return [];
    const labels: Record<string, [string, string]> = {
      sharpness: ['claritate maximă', 'tolerează blur artistic'],
      exposureRaw: ['imagini luminoase', 'ton dramatic, subexpus'],
      bestSmile: ['zâmbete largi', 'expresii serioase'],
      allEyesOpen: ['ochi deschiși obligatoriu', 'acceptă ochi închiși'],
      knownFaceRatio: ['prioritate subiecți cunoscuți', 'indiferent la subiecți'],
      strangerPenalty: ['acceptă străini în cadru', 'evită străinii în cadru']
    };
    return Object.entries(model.weights)
      .filter(([k]) => k in labels)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 4)
      .map(([k, w]) => `${contextKey}: ${w >= 0 ? labels[k][0] : labels[k][1]} (${w.toFixed(2)})`);
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
