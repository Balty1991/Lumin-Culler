/**
 * lumin/aiModels.ts
 * Starea motoarelor AI descărcate (CLIP + căutarea în cuvinte), vizibilă în
 * Setări: ce e pe telefon, ce se descarcă acum (cu procent) și de ce nu a
 * pornit (ex. Wi-Fi marcat „contorizat” de Android). Raportat: „m-am conectat
 * la Wi-Fi, dar nu a descărcat nimic” — fără nicio stare, omul nu avea cum să știe.
 */
import { useSyncExternalStore } from 'react';
import { ClipNative, isClipPlatform } from '../core/clip/clipEngine';
import { prepareClipSearch } from '../core/clip/clipSearch';

export type ModelsPhase = 'unsupported' | 'idle' | 'downloading' | 'scanning' | 'ready' | 'metered' | 'error';
export interface ModelsState {
  phase: ModelsPhase;
  visionReady: boolean;
  textReady: boolean;
  /** 0..1 în timpul descărcării. */
  progress: number;
  what: 'vision' | 'text' | null;
  /** Pozele trecute prin CLIP în fundal: făcute / total. */
  scanned: number;
  toScan: number;
  error?: string;
}

let state: ModelsState = { phase: isClipPlatform() ? 'idle' : 'unsupported', visionReady: false, textReady: false, progress: 0, what: null, scanned: 0, toScan: 0 };
const subs = new Set<() => void>();
export function setModelsState(patch: Partial<ModelsState>): void {
  state = { ...state, ...patch };
  subs.forEach(f => f());
}
export function getModelsState(): ModelsState { return state; }
export function useModelsState(): ModelsState {
  return useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => state);
}

let listening = false;
async function listen() {
  if (listening || !isClipPlatform()) return;
  listening = true;
  try {
    const sizes: Record<string, number> = { vision: 89e6, text: 136e6 };
    await (ClipNative as unknown as { addListener(e: string, f: (ev: { what: 'vision' | 'text'; loaded: number; total: number }) => void): Promise<unknown> })
      .addListener('progress', ev => {
        // Evenimentele native pot sosi DUPĂ ce descărcarea s-a terminat; nu
        // readucem starea în „downloading” (rămânea blocat cu ✓ și 12/12).
        if (state.phase !== 'downloading') return;
        const loaded = Number(ev.loaded), total = Number(ev.total);
        const size = total > 0 ? total : sizes[ev.what] ?? 0;
        // Raportat: „Descarc motorul de imagine… NaN%”. Fără mărime cunoscută, 0.
        const p = size > 0 && Number.isFinite(loaded) ? Math.min(1, loaded / size) : 0;
        setModelsState({ what: ev.what === 'text' ? 'text' : 'vision', progress: p });
      });
  } catch { /* fără progres, doar starea finală */ }
}

export async function refreshModels(): Promise<void> {
  if (!isClipPlatform()) return;
  void listen();
  try {
    const a = await ClipNative.available();
    setModelsState({ visionReady: a.ready, textReady: !!a.textReady, ...(state.phase === 'idle' && a.ready && a.textReady ? { phase: 'ready' } : {}) });
  } catch { /* rămâne cum era */ }
}

/**
 * Descarcă ce lipsește. `anyNetwork`: omul a apăsat el butonul și a acceptat
 * datele mobile. Întoarce false dacă nu s-a putut (motivul e în stare).
 */
export async function downloadModels(anyNetwork: boolean): Promise<boolean> {
  if (!isClipPlatform()) return false;
  void listen();
  if (state.phase === 'downloading') return false;
  setModelsState({ phase: 'downloading', progress: 0, what: 'vision', error: undefined });
  try {
    const v = await ClipNative.prepare({ anyNetwork });
    if (!v.ready) { setModelsState({ phase: v.reason === 'metered' ? 'metered' : 'error' }); return false; }
    setModelsState({ visionReady: true, what: 'text', progress: 0 });
    const t = await prepareClipSearch(anyNetwork);
    setModelsState({ textReady: t, phase: t ? 'ready' : 'metered', what: null });
    return t;
  } catch (e) {
    setModelsState({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}
