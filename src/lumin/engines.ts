/**
 * lumin/engines.ts
 * Lista tuturor motoarelor AI descărcabile, cu fișierele lor (aceleași nume pe
 * care le caută pluginurile native), ca Setări să arate ce e pe telefon și să
 * le poată descărca pe toate dintr-o atingere. Raportat: „nu mi-a apărut să
 * descarc nimic” — motoarele noi veneau în tăcere, la prima folosire.
 */
import { useSyncExternalStore } from 'react';
import { ClipNative, isClipPlatform } from '../core/clip/clipEngine';
import { logError } from '../core/errorLog';
import { weakDevice } from '../core/deviceClass';
import { syncDownloadGate } from './aiModels';

const HF = 'https://huggingface.co';
const FL = `${HF}/onnx-community/Florence-2-base-ft/resolve/main`;

export interface EngineFile { file: string; url: string; min: number }
export interface Engine { id: string; mb: number; files: EngineFile[]; /** Doar pentru limba aceasta a aplicației (traducerea). */ lang?: string }

export const ENGINES: Engine[] = [
  { id: 'clip', mb: 89, files: [{ file: 'clip_vit_b32_vision_q.onnx', url: `${HF}/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx`, min: 80e6 }] },
  { id: 'search', mb: 136, files: [
    { file: 'clip_multilingual_vocab.txt', url: `${HF}/sentence-transformers/clip-ViT-B-32-multilingual-v1/resolve/main/vocab.txt`, min: 5e5 },
    { file: 'clip_multilingual_text_q.onnx', url: `${HF}/sentence-transformers/clip-ViT-B-32-multilingual-v1/resolve/main/onnx/model_qint8_arm64.onnx`, min: 120e6 }] },
  { id: 'describe', mb: 275, files: [
    { file: 'florence_tokenizer.json', url: `${FL}/tokenizer.json`, min: 1e6 },
    ...['vision_encoder_int8', 'embed_tokens_int8', 'encoder_model_int8', 'decoder_model_int8'].map((n, i) => ({ file: `florence_${n}.onnx`, url: `${FL}/onnx/${n}.onnx`, min: [80e6, 30e6, 35e6, 80e6][i] }))] },
  { id: 'joy', mb: 35, files: [{ file: 'emotion_ferplus8.onnx', url: `${HF}/onnxmodelzoo/emotion-ferplus-8/resolve/main/emotion-ferplus-8.onnx`, min: 30e6 }] },
  { id: 'select', mb: 14, files: [
    { file: 'slimsam_encoder_q.onnx', url: `${HF}/Xenova/slimsam-77-uniform/resolve/main/onnx/vision_encoder_quantized.onnx`, min: 8e6 },
    { file: 'slimsam_decoder_q.onnx', url: `${HF}/Xenova/slimsam-77-uniform/resolve/main/onnx/prompt_encoder_mask_decoder_quantized.onnx`, min: 4e6 }] },
  { id: 'portrait', mb: 34, files: [
    { file: 'modnet_q.onnx', url: `${HF}/Xenova/modnet/resolve/main/onnx/model_quantized.onnx`, min: 5e6 },
    { file: 'depth_anything_v2_small_q.onnx', url: `${HF}/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx`, min: 20e6 }] },
  { id: 'eraser', mb: 14, files: [{ file: 'migan_fp16.tflite', url: `${HF}/litert-community/MI-GAN-512-Places2-LiteRT/resolve/main/migan_fp16.tflite`, min: 10e6 }] },
  { id: 'eraserHd', mb: 208, files: [{ file: 'lama_fp32.onnx', url: `${HF}/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx`, min: 200e6 }] },
  { id: 'clarity', mb: 5, files: [{ file: 'realesr_general_x4v3.tflite', url: `${HF}/litert-community/real-esrgan-x4v3-litert/resolve/main/realesr_general_x4v3.tflite`, min: 2e6 }] },
  { id: 'cutout', mb: 5, files: [{ file: 'u2netp.tflite', url: `${HF}/abhimanyu666/u2nettflite/resolve/main/u2netp.tflite`, min: 3e6 }] },
  { id: 'film', mb: 21, files: [{ file: 'rife49_mit.onnx', url: `${HF}/edgetools/rife/resolve/main/rife49.onnx`, min: 18e6 }] },
  // Descrierea AI în limba aplicației (OPUS-MT, Apache-2.0): câte un motor pe limbă.
  ...(['ro', 'de', 'it', 'es', 'fr'] as const).map(l => ({ id: `translate_${l}`, mb: 107, lang: l, files: [
    { file: `opusmt_en_${l}_enc.onnx`, url: `${HF}/Xenova/opus-mt-en-${l}/resolve/main/onnx/encoder_model_quantized.onnx`, min: 30e6 },
    { file: `opusmt_en_${l}_dec.onnx`, url: `${HF}/Xenova/opus-mt-en-${l}/resolve/main/onnx/decoder_model_quantized.onnx`, min: 30e6 },
    { file: `opusmt_en_${l}_tok.json`, url: `${HF}/Xenova/opus-mt-en-${l}/resolve/main/tokenizer.json`, min: 1e6 }] }))
];

interface Api {
  files(): Promise<{ files: Record<string, number> }>;
  fetchModel(o: { url: string; file: string; min: number }): Promise<{ ok: boolean }>;
  addListener(e: 'progress', f: (ev: { what: string; loaded: number; total: number }) => void): Promise<unknown>;
}
const Native = ClipNative as unknown as Api;

export interface EnginesState { have: Record<string, number>; busy: string | null; progress: number; error: string | null }
let state: EnginesState = { have: {}, busy: null, progress: 0, error: null };
const subs = new Set<() => void>();
const set = (p: Partial<EnginesState>) => { state = { ...state, ...p }; subs.forEach(f => f()); };
export const useEngines = () => useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => state);

export function engineReady(e: Engine, have = state.have): boolean {
  return e.files.every(f => (have[f.file] ?? 0) > f.min);
}

let listening = false;
export async function refreshEngines(): Promise<void> {
  if (!isClipPlatform()) return;
  if (!listening) {
    listening = true;
    void Native.addListener('progress', ev => {
      if (!state.busy) return;
      const eng = ENGINES.find(e => e.id === state.busy);
      const f = eng?.files.find(x => x.file === ev.what);
      if (f) {
        const den = ev.total > 0 ? ev.total : f.min;
        const loaded = Number(ev.loaded);
        if (den > 0 && Number.isFinite(loaded)) set({ progress: Math.min(1, loaded / den) });
      }
    }).catch(() => undefined);
  }
  try { set({ have: (await Native.files()).files }); } catch { /* rămâne */ }
}

/** Un motor, cu progres în Setări. `true` dacă e gata la final. */
export async function downloadEngine(id: string): Promise<boolean> {
  const e = ENGINES.find(x => x.id === id);
  if (!e || !isClipPlatform()) return false;
  while (state.busy) await new Promise(r => setTimeout(r, 500));
  await refreshEngines();
  if (engineReady(e)) return true;
  set({ busy: e.id, progress: 0, error: null });
  try {
    for (const f of e.files) {
      if ((state.have[f.file] ?? 0) > f.min) continue;
      await Native.fetchModel(f);
    }
  } catch (err) {
    set({ error: e.id });
    logError('engine', `${e.id}: ${err instanceof Error ? err.message : String(err)}`, 'engines');
  }
  await refreshEngines();
  set({ busy: null, progress: 0 });
  return engineReady(e);
}

/** Descarcă pe rând tot ce lipsește. `true` dacă la final sunt toate pe telefon. */
export async function downloadAllEngines(): Promise<boolean> {
  if (!isClipPlatform()) return false;
  while (state.busy) await new Promise(r => setTimeout(r, 400));
  const locale = (await import('../state/store')).useStore.getState().locale;
  const weak = await weakDevice();
  for (const e of enginesFor(locale)) {
    if (engineReady(e) || engineSkipped(e.id, weak)) continue;
    await downloadEngine(e.id);
  }
  const ready = await enginesReadyForGallery();
  if (ready) notifyEnginesReady();
  return ready;
}

/**
 * Raportat: „nu se descărcase, să nu se mai întâmple”. După analiza de fundal,
 * motoarele lipsă se descarcă singure, pe rând, ca să fie gata când e nevoie de ele.
 */
let autoDone = false;
export async function autoFetchEngines(): Promise<boolean> {
  if (autoDone || !isClipPlatform()) return false;
  let got = false;
  autoDone = true;
  await refreshEngines();
  // Pe telefoanele slabe, descrierea și Guma HD nu rulează oricum: nu le descărcăm singure.
  const weak = await weakDevice();
  const locale = (await import('../state/store')).useStore.getState().locale;
  for (const e of enginesFor(locale)) {
    if (engineReady(e) || engineSkipped(e.id, weak)) continue;
    // „Doar pe Wi-Fi”: pe date mobile, descărcarea automată așteaptă (butoanele din Setări merg oricum).
    if (!(await syncDownloadGate())) { autoDone = false; return got; }
    if ((await downloadEngine(e.id)) || (await downloadEngine(e.id))) got = true; // o reîncercare
  }
  if (await enginesReadyForGallery()) notifyEnginesReady();
  return got;
}

/** Un singur motor, chiar acum (de ex. selecția la deschiderea gumei). `true` dacă e gata. */
export async function fetchEngine(id: string): Promise<boolean> {
  const e = ENGINES.find(x => x.id === id);
  if (!e || !isClipPlatform()) return false;
  await refreshEngines();
  if (engineReady(e)) return true;
  try {
    for (const f of e.files) {
      if ((state.have[f.file] ?? 0) > f.min) continue;
      await Native.fetchModel(f);
    }
  } catch { /* se vede mai jos */ }
  await refreshEngines();
  return engineReady(e);
}

/** Motoarele care contează pentru limba aplicației (traducerea doar pentru limba ei). */
export function enginesFor(locale: string): Engine[] {
  const base = locale.slice(0, 2);
  return ENGINES.filter(e => !e.lang || e.lang === base);
}

/** Descrierea și Guma HD nu rulează pe telefoanele slabe: nu le așteptăm. */
export function engineSkipped(id: string, weak: boolean): boolean {
  return weak && (id === 'describe' || id === 'eraserHd');
}

export const ENGINES_READY_EVENT = 'cherrypic-engines-ready';

/**
 * Analiza galeriei are voie să pornească?
 * - web sau „Mai târziu”: da, cu motoarele din APK;
 * - fereastra de după instalare încă pe ecran: nu;
 * - a ales descărcarea: da, abia când motoarele cerute sunt pe telefon.
 */
export async function enginesReadyForGallery(): Promise<boolean> {
  if (!isClipPlatform()) return true;
  const { dataMode, enginesPromptPending } = await import('./dataMode');
  if (dataMode() === null) return !enginesPromptPending();
  await refreshEngines();
  const weak = await weakDevice();
  const locale = (await import('../state/store')).useStore.getState().locale;
  return enginesFor(locale).every(e => engineReady(e) || engineSkipped(e.id, weak));
}

function notifyEnginesReady(): void {
  window.dispatchEvent(new Event(ENGINES_READY_EVENT));
}
