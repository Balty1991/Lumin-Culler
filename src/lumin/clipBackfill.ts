/**
 * lumin/clipBackfill.ts
 * După ce modelul CLIP ajunge pe telefon (o dată, pe Wi-Fi), trece în liniște și
 * prin pozele analizate înainte: scor estetic + etichete mai sigure. Nu schimbă
 * nicio decizie (păstrat/respins) — doar scorul AI și etichetele, deci căutarea,
 * dosarele și „cea mai bună poză” devin mai bune fără să mute nimic sub ochii omului.
 *
 * Merge câte o poză, cu pauze, și stă cât timp rulează un import.
 */
import { db } from '../core/db';
import { contextEngine } from '../core/learning/ContextEngine';
import { clipAnalyze, prepareClip, refineTags, isClipPlatform } from '../core/clip/clipEngine';
import { downloadModels, getModelsState, refreshModels, setModelsState, syncDownloadGate } from './aiModels';
import { useStore } from '../state/store';
import { holdBackgroundAnalysis, releaseBackgroundAnalysis, updateHeldBackground } from '../core/backgroundAnalysis';
import { t } from '../i18n';
import { waitForUserIdle } from '../core/userIdle';
import { weakDevice } from '../core/deviceClass';
import { dataMode } from './dataMode';
import { releaseTranslator, translateLangFor, translateTexts } from '../core/translate';
import { ENGINES, engineReady, refreshEngines } from './engines';
import { captionPhoto, closeFlorence, joyOf, prepareFlorence } from '../core/extraEngines';

const BATCH = 12;
const PAUSE_MS = 40;
let running = false;
/** Raportat: „în fundal nu face analiza”. Notificarea ține aplicația activă și când ieși din ea. */
let holding = false;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function startClipBackfill(anyNetwork = dataMode() !== 'wifi'): Promise<void> {
  if (running || !isClipPlatform()) return;
  // Prima pornire: întâi omul alege rețeaua (cardul de pe Azi), apoi descărcăm.
  if (dataMode() === null) { await refreshModels().catch(() => undefined); if (!getModelsState().visionReady) return; }
  running = true;
  try {
    const allow = anyNetwork || await syncDownloadGate();
    if (!allow) {
      setModelsState({ phase: 'metered', error: undefined });
      return;
    }
    // Întâi toate motoarele. Analiza galeriei pornește la sfârșitul descărcării,
    // nu în timpul ei (raportat: „Analizez pozele” cât 2 din 12 motoare erau pe telefon).
    // Doar motoarele esențiale (~124 MB) înainte de galerie; restul vin în fundal, în liniște
    // (descărcarea în trepte: prima pornire nu mai așteaptă ~1 GB).
    const engines = await import('./engines');
    if (!(await engines.enginesReadyForGallery())) {
      const got = await engines.downloadEssentialEngines();
      if (!got) { setModelsState({ phase: 'error' }); return; }
    }
    void engines.fetchRemainingEngines();
    // Rețeaua a fost verificată deja; prepare() nu mai are voie să refuze Wi-Fi-ul real.
    await downloadModels(true);
    if (!getModelsState().visionReady && !(await prepareClip(true))) return;
    const todo = await db.analyses.filter(a => a.clipEmbedding === undefined).primaryKeys();
    setModelsState({ phase: 'scanning', scanned: 0, toScan: todo.length });
    const bgText = (d: number) => t(useStore.getState().locale, 'lx.models.scanning', { done: d, total: todo.length });
    if (todo.length > 0) { await holdBackgroundAnalysis(todo.length, bgText(0)); holding = true; }
    for (let i = 0; i < todo.length; i += BATCH) {
      const changed = new Map<string, { sceneTags?: string[]; aiScore: number; aesthetic: number }>();
      for (const id of todo.slice(i, i + BATCH)) {
        while (useStore.getState().progress) await sleep(3000);
        await waitForUserIdle();
        const [photo, analysis] = await Promise.all([db.photos.get(id as string), db.analyses.get(id as string)]);
        if (!photo?.mediaUri || !analysis || analysis.clipEmbedding !== undefined) continue;
        const clip = await clipAnalyze({ uri: photo.mediaUri, maxSide: 480 });
        if (!clip) { await sleep(PAUSE_MS); continue; }
        const tags = refineTags(analysis.sceneTags, clip.embedding);
        const next = { ...analysis, aesthetic: clip.aesthetic, clipEmbedding: clip.embedding, clipQuality: clip.quality, sceneTags: tags.length ? tags : undefined };
        const prediction = await contextEngine.predict(next, photo.genre);
        next.aiScore = prediction.score;
        next.aiFactors = prediction.topFactors;
        next.aiUncertainty = prediction.uncertainty;
        next.aiPersonalDelta = prediction.personalDelta;
        await db.analyses.put(next);
        changed.set(photo.id, { sceneTags: next.sceneTags, aiScore: next.aiScore, aesthetic: clip.aesthetic });
        await sleep(PAUSE_MS);
      }
      setModelsState({ scanned: Math.min(todo.length, i + BATCH) });
      void updateHeldBackground(Math.min(todo.length, i + BATCH), todo.length, bgText(Math.min(todo.length, i + BATCH)));
      if (changed.size) {
        useStore.setState(s => ({
          photos: s.photos.map(p => {
            const c = changed.get(p.id);
            return c ? { ...p, sceneTags: c.sceneTags, aiScore: c.aiScore, aesthetic: c.aesthetic } : p;
          })
        }));
      }
    }
    setModelsState({ phase: getModelsState().textReady ? 'ready' : getModelsState().phase === 'scanning' ? 'idle' : getModelsState().phase });
    // O dată, după o trecere mare: omul află că poate căuta în cuvinte.
    if (todo.length >= 50 && getModelsState().textReady) {
      useStore.getState().setNotice(t(useStore.getState().locale, 'lx.models.doneNotice', { count: todo.length }));
    }
    await recheckSpecies();
    await deepPass();
  } catch {
    // CLIP e un bonus: dacă ceva nu merge, aplicația rămâne exact ca înainte.
  } finally {
    if (holding) { holding = false; void releaseBackgroundAnalysis(); }
    running = false;
  }
}

/**
 * După fiecare import (bara de progres dispare), pozele noi trec prin CLIP în
 * fundal. Așa importul rămâne la fel de rapid ca înainte de CLIP.
 */
let watching = false;
export function watchImportsForClip(): void {
  if (watching || !isClipPlatform()) return;
  watching = true;
  let was = !!useStore.getState().progress;
  useStore.subscribe(st => {
    const now = !!st.progress;
    if (was && !now) window.setTimeout(() => { void startClipBackfill(); }, 1500);
    was = now;
  });
}

/**
 * A doua trecere, mai adâncă: expresia fețelor (FER+) la pozele cu oameni și
 * descrierea în cuvinte (Florence-2) la pozele păstrate. Ambele doar pe telefon,
 * în fundal; descrierea intră la căutare, bucuria în scorul AI.
 */
async function deepPass(): Promise<void> {
  // Traducerea descrierii: doar dacă motorul limbii aplicației e pe telefon.
  const trLang = translateLangFor(useStore.getState().locale);
  await refreshEngines().catch(() => undefined);
  const trEngine = trLang ? ENGINES.find(e => e.id === `translate_${trLang}`) : undefined;
  const canTranslate = !!trEngine && engineReady(trEngine);
  const needsTr = (a: { aiDescription?: string; aiDescriptionLang?: string }) => canTranslate && !!a.aiDescription && a.aiDescriptionLang !== trLang;
  const rows = await db.analyses.filter(a => (a.joy === undefined && a.faces.length > 0) || (!a.aiDescription && a.clipEmbedding !== undefined) || needsTr(a)).toArray();
  if (!rows.length) return;
  // Vizibil în Setări și ținut viu în fundal, ca trecerea CLIP.
  setModelsState({ phase: 'scanning', scanned: 0, toScan: rows.length });
  // Totalul acestei treceri, nu al celei dinainte (raportat: „1060 din 348”).
  // Alt text decât citirea: după „Gata” omul vedea iar „Analizez pozele: 10 din 38” și credea că
  // a luat-o de la capăt (raportat cu captură).
  const bgText = (d: number) => t(useStore.getState().locale, 'lx.models.polishing', { done: Math.min(d, rows.length), total: rows.length });
  if (!holding) { await holdBackgroundAnalysis(rows.length, bgText(0)); holding = true; }
  else void updateHeldBackground(0, rows.length, bgText(0));
  const kept = new Set(useStore.getState().photos.filter(p => p.status === 'selected').map(p => p.id));
  // Descrierile (Florence-2, ~275 MB în lucru) doar pe telefoanele cu memorie destulă.
  const weak = await weakDevice();
  const florence = !weak && rows.some(a => !a.aiDescription && kept.has(a.photoId)) ? await prepareFlorence() : false;
  let done = 0;
  const pending = new Map<string, { aiScore: number; sceneTags?: string[]; aiDescription?: string; aiDescriptionTr?: string; aiDescriptionLang?: string }>();
  const flush = () => {
    if (!pending.size) return;
    const ch = new Map(pending); pending.clear();
    useStore.setState(st => ({ photos: st.photos.map(p => { const c = ch.get(p.id); return c ? { ...p, ...c } : p; }) }));
  };
  for (const a of rows) {
    while (useStore.getState().progress) await sleep(3000);
    await waitForUserIdle();
    const photo = await db.photos.get(a.photoId);
    if (!photo?.mediaUri) continue;
    const next = { ...a };
    let changed = false;
    if (a.joy === undefined && a.faces.length > 0) {
      const joy = await joyOf(photo.mediaUri, a.faces.map(f => f.box as number[]));
      next.joy = joy ?? 0;
      if (joy !== null && joy > 0.85 && !(next.sceneTags ?? []).includes('laughing')) next.sceneTags = [...(next.sceneTags ?? []), 'laughing'];
      changed = true;
    }
    if (florence && !a.aiDescription && kept.has(a.photoId)) {
      const cap = await captionPhoto(photo.mediaUri);
      if (cap) { next.aiDescription = cap; changed = true; }
    }
    if (canTranslate && trLang && next.aiDescription && next.aiDescriptionLang !== trLang) {
      const [t] = (await translateTexts(trLang, [next.aiDescription])) ?? [];
      if (t) { next.aiDescriptionTr = t; next.aiDescriptionLang = trLang; changed = true; }
    }
    if (changed) {
      const prediction = await contextEngine.predict(next, photo.genre);
      next.aiScore = prediction.score;
      next.aiFactors = prediction.topFactors;
      await db.analyses.put(next);
      pending.set(a.photoId, { aiScore: next.aiScore, sceneTags: next.sceneTags, aiDescription: next.aiDescription, aiDescriptionTr: next.aiDescriptionTr, aiDescriptionLang: next.aiDescriptionLang });
    }
    done++;
    // Galeria se redesenează o dată la 10 poze, nu după fiecare (sacadări la derulare).
    if (pending.size >= 10 || done === rows.length) flush();
    if (done % 10 === 0) { void updateHeldBackground(done, rows.length, bgText(done)); setModelsState({ scanned: done }); }
    await sleep(PAUSE_MS);
  }
  flush();
  if (florence) await closeFlorence();
  if (canTranslate) await releaseTranslator();
  setModelsState({ phase: getModelsState().textReady ? 'ready' : 'idle', scanned: rows.length });
}

const SPECIES_KEY = 'cherrypic.speciesRecheck.v1';
/**
 * O singură dată: pozele care aveau deja amprenta CLIP își refac eticheta de pisică/câine
 * cu regula nouă din refineTags (raportat: „poze cu câini” arăta pisici și un om pe canapea).
 */
async function recheckSpecies(): Promise<void> {
  try { if (localStorage.getItem(SPECIES_KEY)) return; } catch { return; }
  const species = /^(cat|kitten|dog|puppy)$/i;
  const rows = await db.analyses.filter(a => !!a.clipEmbedding && (a.sceneTags ?? []).some(tag => species.test(tag))).toArray();
  const changed = new Map<string, string[] | undefined>();
  for (const a of rows) {
    const tags = refineTags(a.sceneTags, a.clipEmbedding!);
    if (tags.length === (a.sceneTags ?? []).length && tags.every((tag, i) => tag === a.sceneTags![i])) continue;
    const next = tags.length ? tags : undefined;
    await db.analyses.update(a.photoId, { sceneTags: next });
    changed.set(a.photoId, next);
  }
  if (changed.size) {
    useStore.setState(s => ({ photos: s.photos.map(p => (changed.has(p.id) ? { ...p, sceneTags: changed.get(p.id) } : p)) }));
  }
  try { localStorage.setItem(SPECIES_KEY, '1'); } catch { /* data viitoare */ }
}
