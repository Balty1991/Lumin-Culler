import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../core/db';
import { overcastSkyShare, computeAutoAdjustments, computeAutoStraighten, drawAdjusted, NEUTRAL_ADJUSTMENTS, outputSize, subjectFromFaces, type EditAdjustments } from '../core/imageAdjust';
import { measureFrame, mergeRecipe, recipeFromStats, type LookIssue, type LookFace } from '../core/autoLook';
import { getCachedPreviewUrl, getDisplayUrl } from '../core/previewUrlCache';
import { canSharpen, peekSharpUrl, SCREEN_SIZE, sharpUrl } from './sharp';
import { isNativeSegmentationAvailable, segmentPersonMask } from '../core/nativeSegmentation';
import { useStore, type PhotoView } from '../state/store';
import { frameCrop } from './instaCrop';
import { saveEditedBlob } from './saveEdited';
import { useTr } from './context';
import { AiRetouch, type ToolKind } from './AiRetouch';
import { portraitAvailable } from '../core/portraitEdit';
import { Icon } from './icons';
import { learnLook, readMyLook } from './myLook';
import { canRenderOff, renderOff } from './editRender';
import { MagicSheet } from './MagicSheet';
import { lowLightOnDevice, onDeviceEditAvailable } from '../core/onDeviceEdit';
import { analysisPool } from '../core/workerPool';
import { vibrate } from '../ui/haptics';
import { renderBeforeAfterCard, shareCard } from './shareCards';

/**
 * lumin/Enhance.tsx
 * „Fă-o mai frumoasă”: o atingere, AI-ul reglează lumina, umbrele, albul și
 * culoarea după ce vede în poză (aceleași calcule ca butonul Auto din editor,
 * core/imageAdjust.ts), iar tu tragi de linie ca să vezi înainte și după.
 *
 * Doar lumină și culoare: fără decupaj sau rotire, ca înainte/după să se
 * suprapună exact și ca nimic din cadru să nu dispară pe nepusă masă.
 * Se salvează ca o copie; fișierul din galerie nu se atinge.
 */
/**
 * Stilurile: peste corecția automată (lumină, alb, culoare măsurate din poză),
 * fiecare adaugă un aspect vizibil. Raportat: „varianta editată nu are prea
 * multe îmbunătățiri” — corecția singură e doar „de siguranță”.
 */
export type EnhanceStyle = 'natural' | 'portrait' | 'retouch' | 'vivid' | 'warm' | 'clear' | 'film' | 'bw' | 'drama';
export const ENHANCE_STYLES: EnhanceStyle[] = ['natural', 'portrait', 'retouch', 'vivid', 'warm', 'clear', 'film', 'bw', 'drama'];
/** Stilurile din Pro: le poți încerca, salvarea cere abonamentul. */
const ADVANCED: ReadonlySet<EnhanceStyle> = new Set(['portrait', 'retouch', 'clear', 'film', 'bw', 'drama']);
/** Stilurile care au nevoie de un om în poză (fundalul estompat în jurul lui). */
const NEEDS_FACE: ReadonlySet<EnhanceStyle> = new Set(['portrait', 'retouch']);
const STYLE_ADD: Record<EnhanceStyle, Partial<Record<keyof EditAdjustments, number>>> = {
  // Cu alb și negru duși spre capete: pe pozele cu cer înnorat, fără ele „după” arăta ca „înainte”
  // (raportat cu capturi, Natural și Clară aproape identice cu originalul).
  // Măsurat pe poza raportată: mai multă lumină, zonele luminoase nu mai coborâte (cerul
  // înnorat ieșea gri), negrul doar puțin — cum a reglat omul de mână și i-a plăcut.
  // Finisaj mic: diagnosticul (autoLook) face deja corectura mare, per poză.
  natural: { exposure: 3, contrast: 6, saturation: 3, clarity: 4, sharpen: 4, shadows: 4, whites: 4 },
  vivid: { contrast: 18, saturation: 14, clarity: 22, sharpen: 20, dehaze: 12, shadows: 14, highlights: -14, whites: 10, blacks: -9 },
  warm: { contrast: 12, saturation: 8, temperature: 16, tint: 3, clarity: 14, sharpen: 16, shadows: 12, whites: 6, blacks: -6 },
  drama: { contrast: 26, saturation: -10, clarity: 34, sharpen: 22, dehaze: 16, vignette: 24, highlights: -28, shadows: 20 },
  // Portret: fundalul estompat în jurul fețelor, pielea moale (claritate scăzută), lumină caldă.
  // Retuș: ten mai neted (netezirea zgomotului, fără claritate), lumină caldă și blândă pe față.
  retouch: { noiseReduction: 45, clarity: -16, sharpen: 4, contrast: 2, exposure: 3, shadows: 14, highlights: -10, temperature: 5, saturation: 2, vignette: 8 },
  portrait: { bokeh: 60, relight: 18, contrast: 6, saturation: 2, temperature: 6, clarity: -8, sharpen: 8, shadows: 12, highlights: -10, vignette: 16 },
  // Clar: umbrele deschise și luminile coborâte, detaliu scos în evidență (un HDR blând).
  // Cu alb și negru ținute la capete: fără ele cerul ieșea gri și poza spălată
  // (raportat cu captură, la 125%).
  clear: { contrast: 16, saturation: 8, clarity: 36, sharpen: 26, dehaze: 16, shadows: 22, highlights: -24, whites: 12, blacks: -11 },
  // Film: culori de cinema (umbre reci, lumini calde), granulație fină.
  film: { contrast: 4, saturation: -6, grade: 45, grain: 16, clarity: 8, sharpen: 10, shadows: 10, highlights: -14, vignette: 12 },
  bw: { bw: 100, contrast: 18, saturation: 0, clarity: 22, sharpen: 18, grain: 10, vignette: 14, shadows: 8, highlights: -12 }
};
/**
 * Plafonul culorii, oricât de sus e intensitatea: peste el pielea se înroșește
 * și cerul devine fosforescent (raportat: „parcă saturează cam mult”).
 */
const MAX_SATURATION = 20;
/** Stilurile fără lumină proprie, care altfel ies mai închise decât originalul. */
const BRIGHTEN: ReadonlySet<EnhanceStyle> = new Set(['vivid', 'warm', 'clear']);

const clamp = (v: number) => Math.max(-100, Math.min(100, Math.round(v)));

/** Corecția automată + stilul, la intensitatea aleasă (0..1,5). */
export function styledEdits(base: EditAdjustments, style: EnhanceStyle, amount: number): EditAdjustments {
  const out: EditAdjustments = { ...base };
  if (!NEEDS_FACE.has(style)) delete out.bokehSubject;
  const keys = new Set([...Object.keys(NEUTRAL_ADJUSTMENTS), ...Object.keys(STYLE_ADD[style])]) as Set<keyof EditAdjustments>;
  for (const k of keys) {
    const b = base[k];
    if (k === 'rotationDeg' || (b !== undefined && typeof b !== 'number')) continue;
    const v = ((b as number | undefined) ?? 0) + (STYLE_ADD[style][k] ?? 0);
    (out as unknown as Record<string, number>)[k] = clamp(v * amount);
  }
  out.saturation = Math.min(MAX_SATURATION, out.saturation);
  // Pozele largi, cu cer înnorat (raportat cu capturi: „la pozele mai în larg încă
  // are tendință să întunece”): pe o poză fără negru adevărat, corecția automată
  // întinde negrul tare (−35), stilul mai adaugă, iar dehaze/contrastul coboară
  // tonurile medii — pământul și hainele se înnegreau. Negrul și recuperarea
  // luminilor au un prag, iar ce întunecă dehaze-ul se dă înapoi ca lumină.
  // Pe portretele de aproape (lăudate) pragurile aproape că nu se ating.
  if (style !== 'drama' && style !== 'bw') {
    const k = Math.min(1, amount);
    const floor = -18 * Math.max(1, amount);
    const blacks = out.blacks ?? 0;
    const crush = Math.max(0, floor - blacks);
    out.blacks = Math.max(floor, blacks);
    out.highlights = Math.max(-30 * Math.max(1, amount), out.highlights ?? 0);
    const lift = (out.dehaze ?? 0) * 0.35 + crush * 0.15 + (BRIGHTEN.has(style) ? 5 * k : 0);
    out.exposure = clamp((out.exposure ?? 0) + lift);
  }
  // „Wow”, nu doar corect (cerut: „când dai editare în modul automat, poza să fie wow”):
  // contrast local și culoare cu viață, cu plafoane ca să nu arate prelucrată.
  if (style === 'natural' || style === 'vivid') {
    const k = Math.min(1, amount);
    const night = (out.noiseReduction ?? 0) >= 25;
    out.toneMap = Math.min(45, out.toneMap ?? 0);
    // Raportat: „saturează și dă culoare galbenă pozei”. Natural rămâne aproape neutru
    // (căldura împinge verdele spre galben), iar „wow”-ul vine din lumină și contrast
    // local, nu din culoare. Doar „Vie” primește culoare în plus.
    const vivid = style === 'vivid';
    // Nici răcire tare: albul crem devenea lila (geaca, raportat cu captură).
    out.temperature = Math.max(-3, Math.min(vivid ? 10 : 5, out.temperature ?? 0));
    out.tint = Math.max(-5, Math.min(2, out.tint ?? 0));
    out.saturation = Math.min(vivid ? MAX_SATURATION : 6, out.saturation ?? 0);
    if (!night) {
      // Ținta arătată de om (editorul telefonului): cer albastru adânc, verde viu, contrast
      // local puternic, umbre deschise. Culoarea vine pe benzi (verde, albastru, galben),
      // nu ca saturație globală: tenul (portocaliu) rămâne cum e, poza nu se îngălbenește.
      out.saturation = Math.max(out.saturation ?? 0, Math.round((vivid ? 12 : 6) * k));
      // Raportat: prea mult contrast local dădea strălucire albă în jurul omului și pietriș
      // „crocant”. Contrastul local și claritatea rămân moderate; culoarea face diferența.
      out.toneMap = Math.min(out.toneMap ?? 0, 22);
      out.clarity = Math.min(Math.max(out.clarity ?? 0, Math.round(10 * k)), 12);
      out.sharpen = Math.min(Math.max(out.sharpen ?? 0, Math.round(10 * k)), 12);
      out.contrast = Math.max(out.contrast ?? 0, Math.round(14 * k));
      out.highlights = Math.max(Math.round(-14 * k), Math.min(out.highlights ?? 0, Math.round(-8 * k)));
      out.whites = Math.min(out.whites ?? 0, 4);
      out.blacks = Math.min(out.blacks ?? 0, Math.round(-8 * k));
      const b = (s: number, l = 0) => ({ hue: 0, saturation: Math.round(s * k), luminance: Math.round(l * k) });
      out.hsl = {
        ...(out.hsl ?? {}),
        green: b(vivid ? 34 : 26, -4),
        aqua: b(6, -2),
        blue: b(vivid ? 14 : 8, -10),
        yellow: b(14, 0),
        orange: b(-4, 2)
      };
    }
    out.vignette = Math.max(out.vignette ?? 0, Math.round(10 * k));
  }
  // „Wow” pe pozele cu oameni (cerut cu capturi: „vreau și mai wow”): marginile coboară în
  // jurul omului, nu al centrului pozei, ca el să iasă în față. Tenul nu se atinge.
  if (base.bokehSubject && style !== 'bw' && style !== 'portrait') {
    const sub = base.bokehSubject;
    out.vignetteAt = { x: sub.x + sub.width / 2, y: sub.y + sub.height * 0.3 };
    out.vignette = Math.max(out.vignette ?? 0, Math.round(26 * Math.min(1.2, amount)));
  }
  if (style === 'bw') out.bw = Math.max(0, Math.min(100, Math.round(100 * Math.min(1, amount * 1.5))));
  if (NEEDS_FACE.has(style) && !out.bokehSubject) out.bokeh = 0;
  if (style === 'retouch') delete out.bokehSubject;
  return out;
}

/**
 * Corecția automată a unei poze (lumină, alb, culoare — fără decupaj sau rotire),
 * plus URL-ul imaginii din care a fost măsurată.
 */
/** Luminozitatea medie (0..1), pe o miniatură de 32 px. */
function meanLumOf(img: HTMLImageElement): number {
  try {
    const c = document.createElement('canvas'); c.width = 32; c.height = 32;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0.5;
    ctx.drawImage(img, 0, 0, 32, 32);
    const d = ctx.getImageData(0, 0, 32, 32).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return s / (d.length / 4) / 255;
  } catch { return 0.5; }
}

/**
 * Poza din care pornește editorul, la claritate de ecran. Raportat: „după ce intru în
 * editor pozele își pierd claritatea”: când copia clară de 1600 px nu ieșea din prima,
 * editorul cădea direct pe preview, care pe telefon e adesea miniatura de 256 px.
 * Acum încearcă pe rând: copia de 1600 (de două ori), cea de ecran deja făcută pentru
 * vizualizator, fișierul din galerie; miniatura rămâne doar ultima rezervă.
 */
async function editorSource(photoId: string, load: (u: string) => Promise<HTMLImageElement>): Promise<{ url: string; img: HTMLImageElement } | null> {
  const big = (img: HTMLImageElement) => Math.max(img.naturalWidth, img.naturalHeight) >= 900;
  // Poza de ecran deja făcută pentru vizualizator (1440 px) e destul de clară pentru editor:
  // dacă există, editorul se deschide pe loc, fără să mai ceară telefonului alta.
  const tries: Array<() => Promise<string | null>> = canSharpen()
    ? [
        () => Promise.resolve(peekSharpUrl(photoId, SCREEN_SIZE)),
        () => sharpUrl(photoId, 1600),
        () => sharpUrl(photoId, 1600),
        () => Promise.resolve(peekSharpUrl(photoId, SCREEN_SIZE)),
        () => sharpUrl(photoId, SCREEN_SIZE),
        () => getDisplayUrl(photoId)
      ]
    : [() => getDisplayUrl(photoId)];
  let fallback: { url: string; img: HTMLImageElement } | null = null;
  for (const get of tries) {
    const url = await get().catch(() => null);
    if (!url) continue;
    const img = await load(url).catch(() => null);
    if (!img || img.naturalWidth === 0) continue;
    if (big(img)) return { url, img };
    fallback ??= { url, img };
  }
  if (fallback) return fallback;
  const last = await getCachedPreviewUrl(photoId);
  if (!last) return null;
  const img = await load(last).catch(() => null);
  return img ? { url: last, img } : null;
}

export async function autoEnhance(photoId: string): Promise<{ url: string; original: string; lit?: boolean; edits: EditAdjustments; tilt: number; width: number; height: number; faces: { box: [number, number, number, number] }[]; scenes: Scene[]; issues: LookIssue[] }> {
  // Pe telefon: poza clară făcută de Android (originalul direct ieșea negru pe unele telefoane).
  const load = (u: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('imaginea nu s-a încărcat'));
    el.src = u;
  });
  const [picked, a] = await Promise.all([editorSource(photoId, load), db.analyses.get(photoId)]);
  if (!picked) throw new Error('fără imagine');
  let url = picked.url;
  const original = picked.url;
  let img = picked.img;
  // Poza întunecată: întâi lumina învățată (Zero-DCE, pe telefon), apoi restul corecturii.
  let lit = false;
  const dark = meanLumOf(img);
  if (dark < 0.34) {
    const better = await fetch(url).then(r => r.blob()).then(b => lowLightOnDevice(b, Math.max(0.35, Math.min(0.7, (0.42 - dark) / 0.25)))).catch(() => null);
    if (better) { url = URL.createObjectURL(better); img = await load(url); lit = true; }
  }
  const auto = computeAutoAdjustments(img, img.naturalWidth, img.naturalHeight, {
    exposureScore: a?.exposure,
    highlightClipping: a?.highlightClipping,
    shadowClipping: a?.shadowClipping,
    faceCount: a?.faceCount,
    faces: a?.faces,
    colorHarmonyScore: a?.colorHarmonyScore,
    goldenHourDetected: a?.goldenHourDetected
  });
  // Puțină lumină în plus, cât trebuie pentru poza asta (raportat: Natural arăta mult mai
  // bine cu Luminozitate +20 pusă de mână). Măsurată pe fețe, unde sunt, altfel pe toată
  // poza; o poză deja luminoasă nu primește nimic.
  auto.exposure = Math.max(-100, Math.min(100, auto.exposure + brightnessLift(img, a?.faces)));
  // Ce fel de poză e, și ce e stricat la ea (lumină, culoare, ceață, zgomot, cer, ten).
  const scene = sceneTune(img, auto, a);
  // Unde e omul (din fețele găsite la import): stilul Portret estompează în jurul lui.
  // Cu tot corpul: fără decupajul modelului, zona clară pornește de la față și coboară
  // cât un om întreg (umeri mai lați decât fața), nu doar un umăr sub ea.
  const face = subjectFromFaces(a?.faces);
  const subject = face ? (() => {
    const faceH = face.height / 2;
    const x = Math.max(0, face.x - face.width * 0.6);
    const right = Math.min(1, face.x + face.width * 1.6);
    return { x, y: face.y, width: right - x, height: Math.min(1, face.y + faceH * 7.5) - face.y };
  })() : null;
  // Orizontul strâmb (măsurat la import, doar pe pozele fără oameni): îndreptarea e o opțiune, nu implicită.
  const tilt = computeAutoStraighten({ faceCount: a?.faceCount, horizonTiltDeg: a?.horizonTiltDeg });
  return {
    url, original, lit, tilt, width: img.naturalWidth, height: img.naturalHeight, scenes: scene.scenes, issues: scene.issues,
    faces: (a?.faces ?? []).map(f => ({ box: f.box as [number, number, number, number] })),
    edits: { ...auto, crop: undefined, rotationDeg: 0, ...(subject ? { bokehSubject: subject } : {}) }
  };
}

export type Scene = 'overcast' | 'food' | 'landscape' | 'night' | 'portrait' | 'backlit' | 'indoor';
/** Scenele la care „Vie” arată mai bine decât „Natural”; cu oameni în cadru rămâne „Natural”. */
const VIVID_SCENES: ReadonlySet<Scene> = new Set(['landscape', 'food', 'overcast']);
export function recommendStyle(scenes: readonly Scene[]): EnhanceStyle {
  if (scenes.includes('portrait') || scenes.includes('night')) return 'natural';
  return scenes.some(sc => VIVID_SCENES.has(sc)) ? 'vivid' : 'natural';
}
const FOOD = /pizza|cake|donut|sandwich|food|dish|meal|dessert|fruit|banana|apple|orange|broccoli|hot dog|cuisine|bread|coffee|wine|cup/i;
const NATURE = /mountain|sea|ocean|beach|lake|river|forest|tree|sky|cloud|field|grass|flower|landscape|sunset|snow|waterfall|plant/i;
const INDOOR = /couch|bed|dining table|tv|chair|room|kitchen|lamp|ceiling|wall|furniture|toilet|sink|oven|refrigerator/i;

/**
 * Editorul „inteligent”: recunoaște tipul pozei din ce s-a văzut la import
 * (etichetele scenei, fețele) și din pixeli (cer gri, noapte), și ajustează
 * corectura automată pentru el. Întoarce scenele găsite, ca omul să vadă ce
 * a înțeles editorul („cer înnorat · portret”).
 */
export function sceneTune(img: HTMLImageElement, e: EditAdjustments, a?: { sceneTags?: string[]; sceneSemantic?: string; faceCount?: number; faces?: { box: number[] }[] }): { scenes: Scene[]; issues: LookIssue[] } {
  const scenes: Scene[] = [];
  const add = (k: keyof EditAdjustments, v: number) => { (e as unknown as Record<string, number>)[k] = Math.max(-100, Math.min(100, ((e as unknown as Record<string, number>)[k] ?? 0) + v)); };
  let luma = 0.5, overcast = 0, topLum = 0, centerLum = 0, darkShare = 0, brightShare = 0;
  try {
    const n = 64;
    const c = document.createElement('canvas');
    c.width = n; c.height = n;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(img, 0, 0, n, n);
      const data = ctx.getImageData(0, 0, n, n);
      overcast = overcastSkyShare(data);
      let sum = 0, top = 0, tn = 0, mid = 0, mn = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const i = (y * n + x) * 4;
        const l = (0.299 * data.data[i] + 0.587 * data.data[i + 1] + 0.114 * data.data[i + 2]) / 255;
        sum += l;
        if (l < 0.2) darkShare++;
        else if (l > 0.88) brightShare++;
        if (y < n * 0.3) { top += l; tn++; }
        if (y > n * 0.3 && y < n * 0.75 && x > n * 0.25 && x < n * 0.75) { mid += l; mn++; }
      }
      luma = sum / (n * n); topLum = tn ? top / tn : 0; centerLum = mn ? mid / mn : 0;
      darkShare /= n * n; brightShare /= n * n;
    }
  } catch { /* fără pixeli: doar etichetele */ }
  const tags = [...(a?.sceneTags ?? []), a?.sceneSemantic ?? ''].join(' ');
  const bigFace = (a?.faces ?? []).some(f => (f.box[2] ?? 0) * (f.box[3] ?? 0) > 0.02);
  // Echilibrul local (raportat de multe ori: „editorul să corecteze și să îmbunătățească
  // substanțial”): cu cât poza are mai multe zone prea întunecate și prea luminoase
  // deodată, cu atât se echilibrează mai tare, zonă cu zonă. Umbrele globale se
  // domolesc puțin, ca să nu se deschidă de două ori.
  const tone = Math.round(Math.min(70, darkShare * 150 + brightShare * 80 + (luma < 0.38 ? 12 : 0)));
  if (tone >= 8) { add('toneMap', tone); add('shadows', -Math.round(tone * 0.15)); }
  // Puțină claritate și accentuare la fiecare poză: diferența dintre „corectată” și „mai frumoasă”.
  if (luma >= 0.24) add('sharpen', 14);
  if (overcast > 0.12) { scenes.push('overcast'); add('temperature', 4); add('saturation', 4); add('dehaze', 6); }
  if (luma < 0.24) { scenes.push('night'); add('noiseReduction', 25); add('shadows', 12); add('clarity', -4); add('sharpen', -6); }
  if (FOOD.test(tags)) { scenes.push('food'); add('temperature', 6); add('saturation', 6); add('clarity', 6); add('vignette', 6); }
  if (!bigFace && NATURE.test(tags)) { scenes.push('landscape'); add('dehaze', 8); add('saturation', 4); add('clarity', 6); }
  if (bigFace) { scenes.push('portrait'); add('clarity', -6); add('shadows', 4); add('temperature', 2); }
  if (topLum - centerLum > 0.28 && (a?.faceCount ?? 0) > 0) { scenes.push('backlit'); add('shadows', 10); add('highlights', -8); }
  if (!scenes.includes('night') && INDOOR.test(tags) && luma < 0.42) { scenes.push('indoor'); add('temperature', -3); add('exposure', 6); add('noiseReduction', 10); }
  let issues: LookIssue[] = [];
  try {
    const px = document.createElement('canvas');
    px.width = 96; px.height = 96;
    const pctx = px.getContext('2d', { willReadFrequently: true });
    if (pctx) {
      pctx.drawImage(img, 0, 0, 96, 96);
      const frame = pctx.getImageData(0, 0, 96, 96);
      const faces: LookFace[] = (a?.faces ?? []).map(f => ({ box: [f.box[0] ?? 0, f.box[1] ?? 0, f.box[2] ?? 0, f.box[3] ?? 0] }));
      const recipe = recipeFromStats(measureFrame(frame.data, 96, 96, faces, 1), faces);
      issues = recipe.issues;
      const merged = mergeRecipe(e, recipe);
      Object.assign(e, merged);
      // Portretul cu fața deja clară nu primește accentuarea oarbă de mai sus:
      // ea mușca din bokeh (raportat pe portrete în contralumină caldă).
      if (faces.length && !recipe.issues.includes('soft')) {
        e.sharpen = Math.min(e.sharpen ?? 0, 8);
        if ((e.clarity ?? 0) > 8) e.clarity = 8;
      }
    }
  } catch { /* diagnosticul e un plus; corectura de bază rămâne */ }
  return { scenes, issues };
}

/** Cât să se deschidă lumina (0..24): fețele spre ~62% luminozitate, poza întreagă spre ~52%. */
export function liftFor(luma: number, onFaces: boolean): number {
  const target = onFaces ? 0.62 : 0.52;
  return Math.round(Math.max(0, Math.min(24, (target - luma) * (onFaces ? 110 : 90))));
}

function brightnessLift(img: HTMLImageElement, faces?: readonly { box: [number, number, number, number] }[]): number {
  try {
    const n = 64;
    const c = document.createElement('canvas');
    c.width = n; c.height = n;
    const ctx = c.getContext('2d');
    if (!ctx) return 0;
    ctx.drawImage(img, 0, 0, n, n);
    const d = ctx.getImageData(0, 0, n, n).data;
    const big = (faces ?? []).filter(f => f.box[2] * f.box[3] >= 0.004);
    let sum = 0, count = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, v = (y + 0.5) / n;
      if (big.length && !big.some(({ box: [bx, by, bw, bh] }) => u >= bx && u <= bx + bw && v >= by && v <= by + bh)) continue;
      const i = (y * n + x) * 4;
      sum += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      count++;
    }
    if (!count) return 0;
    let whole = 0;
    const pixels = n * n;
    for (let i = 0; i < d.length; i += 4) whole += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    whole /= pixels;
    const faceLuma = sum / count;
    const onFaces = big.length > 0 && count >= 4;
    // Ten închis într-o poză deja expusă nu e o față prea întunecată. O siluetă
    // adevărată (fața foarte jos, cadrul luminos) primește doar un plus mic:
    // relight-ul local deschide fața, expunerea globală ar arde fereastra.
    if (onFaces && whole > 0.38 && faceLuma < 0.5) {
      if (faceLuma > 0.2) return 0;
      return Math.round(Math.min(8, Math.max(0, (0.28 - faceLuma) * 30)));
    }
    return liftFor(faceLuma, onFaces);
  } catch { return 0; }
}

/**
 * „Auto AI” pe telefon, când serverul nu răspunde: aceeași rețetă ca editorul,
 * citită de pe varianta deja corectată. Nu depinde de cotă și nu pleacă nicăieri.
 */
export function localGrade(ctx: CanvasRenderingContext2D, w: number, h: number): { values: Record<string, number>; issues: LookIssue[] } {
  const frame = ctx.getImageData(0, 0, w, h);
  const recipe = recipeFromStats(measureFrame(frame.data, w, h, [], 2));
  const values: Record<string, number> = { ...recipe.adjustments };
  if (recipe.relight) values.relight = recipe.relight;
  return { values, issues: recipe.issues };
}

/** „Fă-le pe toate mai frumoase”: stilul Natural pe fiecare, salvate ca și copii. */
/** Pozele care au primit deja „✨ Mai frumoase” (auditul: butonul adăuga copii duplicate la fiecare apăsare). */
const ENHANCED_KEY = 'lx.enhancedAll';
function enhancedSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(ENHANCED_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}
export function notYetEnhanced(ids: readonly string[]): string[] {
  const done = enhancedSet();
  return ids.filter(id => !done.has(id));
}
function markEnhanced(ids: readonly string[]): void {
  try {
    const all = [...enhancedSet(), ...ids].slice(-5000);
    localStorage.setItem(ENHANCED_KEY, JSON.stringify(all));
  } catch { /* fără stocare: butonul doar nu se ascunde */ }
}

/**
 * Stilul pentru o zi întreagă: al tău, dacă ai unul (și nu cere fețe ori Pro
 * fără abonament); altfel „Natural”, ca până acum.
 */
export function batchLook(): { style: EnhanceStyle; amount: number; mine: boolean } {
  const mine = readMyLook();
  const style = mine && (ENHANCE_STYLES as string[]).includes(mine.style) ? mine.style as EnhanceStyle : null;
  if (!mine || !style || NEEDS_FACE.has(style)) return { style: 'natural', amount: 1, mine: false };
  return { style, amount: mine.amount, mine: true };
}

export async function enhanceAll(photoIds: readonly string[], onProgress?: (done: number, total: number) => void, forceNatural = false): Promise<number> {
  const plans: { sourceId: string; adjustments: EditAdjustments }[] = [];
  const look = forceNatural ? { style: 'natural' as EnhanceStyle, amount: 1 } : batchLook();
  for (let i = 0; i < photoIds.length; i++) {
    try {
      const { edits } = await autoEnhance(photoIds[i]);
      plans.push({ sourceId: photoIds[i], adjustments: styledEdits(edits, look.style, look.amount) });
    } catch { /* o poză care nu se citește nu oprește restul */ }
    onProgress?.(i + 1, photoIds.length);
  }
  if (!plans.length) return 0;
  const made = await useStore.getState().addCorrectedCopies(plans);
  markEnhanced(plans.map(p => p.sourceId));
  return made;
}

/**
 * Reglajele manuale: cerute („mai poți upgrada editorul… și la lumina și tonul
 * de culoare”). Se adaugă peste stil, deci „Natural” + „Lumină +20” e poza
 * aleasă de AI, doar mai luminoasă.
 */
type Panel = 'styles' | 'light' | 'color' | 'frame';
type ManualPanel = 'light' | 'color';
const PANELS: Panel[] = ['styles', 'light', 'color', 'frame'];
/** Proporțiile din „Cadru” (lățime / înălțime); cadrul se așază pe fețe (frameCrop). */
type Aspect = 'orig' | '4:5' | '1:1' | '9:16' | '16:9' | '3:2';
const ASPECTS: Record<Aspect, number> = { orig: 0, '4:5': 4 / 5, '1:1': 1, '9:16': 9 / 16, '16:9': 16 / 9, '3:2': 3 / 2 };
type ManualKey = 'toneMap' | 'exposure' | 'contrast' | 'highlights' | 'shadows' | 'whites' | 'blacks' | 'clarity' | 'vignette' | 'temperature' | 'tint' | 'saturation' | 'dehaze' | 'sharpen' | 'noiseReduction' | 'grain' | 'sky';
const MANUAL: Record<ManualPanel, { key: ManualKey; min?: number; track?: string }[]> = {
  light: [
    { key: 'toneMap', min: 0 }, { key: 'exposure' }, { key: 'contrast' }, { key: 'highlights' }, { key: 'shadows' },
    { key: 'whites' }, { key: 'blacks' }, { key: 'clarity' }, { key: 'dehaze' }, { key: 'vignette' }
  ],
  color: [
{ key: 'temperature', track: 'temp' }, { key: 'tint', track: 'tint' }, { key: 'saturation', track: 'sat' },
    { key: 'sharpen', min: 0 }, { key: 'noiseReduction', min: 0 }, { key: 'grain', min: 0 }
  ]
};
/**
 * Gustul omului în editor: media (lentă) a reglajelor pe care le salvează. Dacă
 * pune mereu +10 la lumină, editorul pornește data viitoare cu +10 — vizibil în
 * Lumină și Culoare, și se poate da înapoi. Doar valorile clare (|v| ≥ 3).
 */
const TASTE_KEY = 'lumin-editor-taste';
function readEditorTaste(): Partial<Record<ManualKey, number>> {
  try {
    const raw = JSON.parse(localStorage.getItem(TASTE_KEY) ?? '{}') as { n?: number; v?: Record<string, number> };
    if (!raw.n || raw.n < 3 || !raw.v) return {};
    const out: Partial<Record<ManualKey, number>> = {};
    const known = new Set([...MANUAL.light, ...MANUAL.color].map(m => m.key as string));
    // Doar o parte din medie și cu plafon (auditul: după două salvări extreme,
    // „Cer +60” se punea pe orice poză nouă).
    for (const [k, v] of Object.entries(raw.v)) {
      if (!known.has(k) || Math.abs(v) < 4) continue;
      out[k as ManualKey] = Math.round(Math.max(-15, Math.min(15, v * 0.6)));
    }
    return out;
  } catch { return {}; }
}
function learnEditorTaste(manual: Partial<Record<ManualKey, number>>): void {
  try {
    const raw = JSON.parse(localStorage.getItem(TASTE_KEY) ?? '{}') as { n?: number; v?: Record<string, number> };
    const n = raw.n ?? 0;
    const v = { ...(raw.v ?? {}) };
    const keys = new Set([...Object.keys(v), ...Object.keys(manual)]);
    const a = n === 0 ? 1 : 0.3; // media mobilă: ultimele poze contează mai mult
    for (const k of keys) v[k] = (1 - a) * (v[k] ?? 0) + a * (manual[k as ManualKey] ?? 0);
    localStorage.setItem(TASTE_KEY, JSON.stringify({ n: n + 1, v }));
  } catch { /* fără stocare */ }
}

/** Stilul + reglajele omului, în limitele fiecărui reglaj. */
export function withManual(e: EditAdjustments, manual: Partial<Record<ManualKey, number>>): EditAdjustments {
  const out = { ...e } as unknown as Record<string, number>;
  for (const [k, v] of Object.entries(manual)) {
    if (!v) continue;
    const lo = k === 'sharpen' || k === 'grain' || k === 'noiseReduction' || k === 'toneMap' ? 0 : -100;
    out[k] = Math.max(lo, Math.min(100, Math.round((out[k] ?? 0) + v)));
  }
  return out as unknown as EditAdjustments;
}

export function EnhanceSheet({ photo, onClose }: { photo: PhotoView; onClose: () => void }) {
  const [erasing, setErasing] = useState(false);
  // Escape închide editorul (auditul: tastatura nu avea ieșire).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.lx-magic, .lx-retouch')) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const tr = useTr();
  const addCorrectedCopies = useStore(s => s.addCorrectedCopies);
  const premiumLocked = useStore(s => s.premiumLocked);
  const [src, setSrc] = useState<string | null>(null);
  // „Înainte” arată mereu poza originală, chiar dacă editarea pornește de la varianta luminată
  // de model (raportat: „parcă modifică și originalul”).
  const [orig, setOrig] = useState<string | null>(null);
  /** Sursa e deja luminată pe telefon (Zero-DCE): copia se salvează gata făcută. */
  const [lit, setLit] = useState(false);
  const [base, setBase] = useState<EditAdjustments | null>(null);
  // „Stilul tău”: editorul pornește pe stilul și intensitatea pe care le salvezi de obicei.
  const mine = useMemo(() => { const m = readMyLook(); return m && (ENHANCE_STYLES as string[]).includes(m.style) && !NEEDS_FACE.has(m.style as EnhanceStyle) ? m : null; }, []);
  const [style, setStyle] = useState<EnhanceStyle>(() => (mine?.style as EnhanceStyle | undefined) ?? 'natural');
  /** „De la zero”: fără nicio reparație automată, doar reglajele puse de mână. */
  const [pure, setPure] = useState(false);
  const [amount, setAmount] = useState(() => mine?.amount ?? 0.5);
  const [picked, setPicked] = useState<{ style: EnhanceStyle; scene: Scene | null } | null>(null); // cerut: slider-ul pornește de la 50%, omul urcă dacă vrea mai mult
  const [tilt, setTilt] = useState(0);
  const [straight, setStraight] = useState(false);
  // „Lumină” și „Culoare”: reglajele omului, adăugate peste stil (0 = cum a ales AI-ul).
  const [panel, setPanel] = useState<Panel>('styles');
  // Pornește cu reglajele pe care omul le pune de obicei (învățate la „Păstrez”).
  const [manual, setManual] = useState<Partial<Record<ManualKey, number>>>(() => readEditorTaste());
  const learned = useMemo(() => Object.keys(readEditorTaste()).length > 0, []);
  // „Cadru”: proporția (cadrul așezat pe fețe) și înclinarea aleasă de om.
  const [aspect, setAspect] = useState<Aspect>('orig');
  const [userTilt, setUserTilt] = useState<number | null>(null);
  const [geo, setGeo] = useState<{ width: number; height: number; faces: { box: [number, number, number, number] }[] } | null>(null);
  const crop = useMemo(() => {
    if (aspect === 'orig' || !geo) return undefined;
    const r = frameCrop(geo.width, geo.height, ASPECTS[aspect], geo.faces);
    return { x: r.x / geo.width, y: r.y / geo.height, width: r.w / geo.width, height: r.h / geo.height };
  }, [aspect, geo]);
  const rotation = userTilt ?? (straight ? tilt : 0);
  // Portret: omul decupat de modelul de segmentare de pe telefon, nu doar o zonă rotundă
  // în jurul feței (raportat: picioarele și cizmele ieșeau estompate).
  const [personMask, setPersonMask] = useState<{ image: CanvasImageSource; focusY: number | null } | null>(null);
  useEffect(() => {
    if (style !== 'portrait' || personMask || !src || !isNativeSegmentationAvailable()) return;
    let alive = true;
    void (async () => {
      const blob = await (await fetch(src)).blob();
      const m = await segmentPersonMask(blob, base?.bokehSubject ?? undefined);
      if (alive && m.personCoverage >= 0.03) setPersonMask({ image: m.image, focusY: m.focusY });
    })().catch(() => {});
    return () => { alive = false; };
  }, [style, src, personMask, base]);
  const edits = useMemo(() => {
    if (!base) return null;
    if (pure) return withManual({ ...NEUTRAL_ADJUSTMENTS, rotationDeg: rotation, ...(crop ? { crop } : {}) }, manual);
    const e = withManual({ ...styledEdits(base, style, amount), rotationDeg: rotation, ...(crop ? { crop } : {}) }, manual);
    return style === 'portrait' && personMask ? { ...e, bokehMask: personMask.image, ...(personMask.focusY !== null ? { bokehFocusY: personMask.focusY } : {}) } : e;
  }, [base, style, amount, rotation, crop, manual, personMask, pure]);
  // Fără reparații, previzualizarea pleacă de la poza originală (nu de la cea deja luminată).
  const view = pure ? (orig ?? src) : src;
  // Anulare pas cu pas: fiecare stare la care te-ai oprit (stil, intensitate, reglaje).
  type Snap = { style: EnhanceStyle; amount: number; manual: Partial<Record<ManualKey, number>>; pure: boolean };
  const [hist, setHist] = useState<Snap[]>([]);
  const [histAt, setHistAt] = useState(-1);
  const restoring = useRef(false);
  useEffect(() => {
    if (!base) return;
    if (restoring.current) { restoring.current = false; return; }
    const snap: Snap = { style, amount, manual, pure };
    const timer = window.setTimeout(() => {
      setHist(h => {
        const kept = h.slice(0, histAt + 1);
        if (kept.length && JSON.stringify(kept[kept.length - 1]) === JSON.stringify(snap)) return h;
        const next = [...kept, snap].slice(-40);
        setHistAt(next.length - 1);
        return next;
      });
    }, 450);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, style, amount, manual, pure]);
  const stepHistory = (d: number) => {
    const snap = hist[histAt + d];
    if (!snap) return;
    restoring.current = true;
    setHistAt(histAt + d);
    setStyle(snap.style); setAmount(snap.amount); setManual(snap.manual); setPure(snap.pure);
  };
  /** Stil Pro ales fără abonament: se vede ca probă (cu marcaj), nu se poate salva sau trimite. */
  const proPreview = premiumLocked && !pure && ADVANCED.has(style);
  const styles = ENHANCE_STYLES.filter(st => !NEEDS_FACE.has(st) || !!base?.bokehSubject);
  const [failed, setFailed] = useState(false);
  const [split, setSplit] = useState(100);
  const splitValue = useRef(100);
  const splitFrame = useRef(0);
  const dragBounds = useRef<DOMRect | null>(null);
  const compareAfter = useRef<HTMLDivElement>(null);
  const compareLine = useRef<HTMLSpanElement>(null);
  const compareInner = useRef<HTMLDivElement>(null);
  /**
   * Bara Înainte/După: doar `transform` (compus pe placa video), nu `clip-path`
   * și nu `left`, care redesenau poza la fiecare cadru — raportat cu filmare:
   * linia rămânea sacadat în urma degetului.
   */
  const placeSplit = (next: number) => {
    if (compareAfter.current) compareAfter.current.style.transform = `translate3d(${next}%,0,0)`;
    if (compareInner.current) compareInner.current.style.transform = `translate3d(${-next}%,0,0)`;
    if (compareLine.current) compareLine.current.style.transform = `translate3d(${next}%,0,0)`;
  };
  const revealed = useRef(false);
  const [saving, setSaving] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  // Cât editezi, citirea galeriei din fundal stă (altfel reglajele merg sacadat).
  useEffect(() => analysisPool.holdForUi(), []);
  // Poza încape întreagă în spațiul de deasupra panoului, oricât de înalt e panoul.
  useEffect(() => {
    const el = stage.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => el.style.setProperty('--stage-h', `${Math.max(120, el.clientHeight - 16)}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dragging = useRef(false);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [issues, setIssues] = useState<LookIssue[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { url, original, lit: wasLit, edits: lightOnly, tilt: t, width, height, faces, scenes: found, issues: foundIssues } = await autoEnhance(photo.id);
      setLit(!!wasLit);
      if (!alive) return;
      setScenes(found);
      setIssues(foundIssues);
      setGeo({ width, height, faces });
      setTilt(t);
      if (Math.abs(t) >= 1.5) setStraight(true);
      setSrc(url);
      setOrig(original);
      setBase(lightOnly);
      // Intensitatea de pornire, pe măsura pozei: o poză deja bună primea la 50% o
      // schimbare aproape invizibilă (raportat cu capturi). Fără un stil învățat,
      // urcăm până se vede — cel mult 90%.
      if (!mine) {
        // Stilul de pornire, după ce fel de poză e (fără un stil învățat): peisajele, mâncarea
        // și cerul înnorat câștigă din culoare și contrast local; oamenii rămân naturali.
        const pick = recommendStyle(found);
        if (alive && pick !== 'natural') { setStyle(pick); setPicked({ style: pick, scene: found.find(sc => VIVID_SCENES.has(sc)) ?? null }); }
        const fit = await fitAmount(url, lightOnly).catch(() => null);
        if (alive && fit !== null) setAmount(fit);
      }
    })().catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [photo.id]);

  useEffect(() => {
    if (!src || revealed.current) return;
    revealed.current = true;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      splitValue.current = 50;
      placeSplit(50);
      setSplit(50);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      if (dragging.current) return;
      const t = Math.min(1, (now - t0) / 1100);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = 100 - eased * 50;
      splitValue.current = next;
      placeSplit(next);
      if (t < 1) raf = requestAnimationFrame(tick);
      else setSplit(next);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [src]);

  useEffect(() => () => {
    if (splitFrame.current) cancelAnimationFrame(splitFrame.current);
  }, []);

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const box = dragBounds.current;
    if (!box || !dragging.current) return;
    splitValue.current = Math.max(0, Math.min(100, ((e.clientX - box.left) / box.width) * 100));
    if (splitFrame.current) return;
    splitFrame.current = requestAnimationFrame(() => {
      splitFrame.current = 0;
      const next = splitValue.current;
      placeSplit(next);
    });
  };
  const finishDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    dragBounds.current = null;
    if (splitFrame.current) {
      cancelAnimationFrame(splitFrame.current);
      splitFrame.current = 0;
    }
    setSplit(splitValue.current);
  };
  // Gesturi pe poză:
  //  · ții apăsat fără să miști → vezi originalul pe tot cadrul, ridici degetul → revine editarea;
  //  · tragi → muți linia înainte/după (ca până acum);
  //  · două degete → mărești (până la 4×) și plimbi poza; atingere dublă → la loc.
  const [holding, setHolding] = useState(false);
  const zoomBox = useRef<HTMLDivElement>(null);
  const gesture = useRef({ pointers: new Map<number, { x: number; y: number }>(), startX: 0, startY: 0, moved: false, holdTimer: 0, held: false, scale: 1, tx: 0, ty: 0, pinchDist: 0, pinchScale: 1, lastTap: 0 });
  const applyZoom = () => {
    const g = gesture.current;
    if (zoomBox.current) zoomBox.current.style.transform = g.scale > 1.01 ? `translate3d(${g.tx}px,${g.ty}px,0) scale(${g.scale})` : '';
  };
  const clampPan = () => {
    const g = gesture.current, box = stage.current?.getBoundingClientRect();
    if (!box) return;
    const mx = (box.width * (g.scale - 1)) / 2, my = (box.height * (g.scale - 1)) / 2;
    g.tx = Math.max(-mx, Math.min(mx, g.tx)); g.ty = Math.max(-my, Math.min(my, g.ty));
  };
  const endHold = () => {
    const g = gesture.current;
    window.clearTimeout(g.holdTimer);
    if (g.held) { g.held = false; setHolding(false); placeSplit(splitValue.current); }
  };
  const stageDown = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    e.currentTarget.setPointerCapture(e.pointerId);
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.pointers.size === 2) {
      endHold(); dragging.current = false;
      const [a, b] = [...g.pointers.values()];
      g.pinchDist = Math.hypot(a.x - b.x, a.y - b.y) || 1; g.pinchScale = g.scale;
      return;
    }
    g.startX = e.clientX; g.startY = e.clientY; g.moved = false;
    dragBounds.current = stage.current?.getBoundingClientRect() ?? null;
    g.holdTimer = window.setTimeout(() => {
      if (g.moved || g.pointers.size !== 1) return;
      g.held = true; setHolding(true); placeSplit(100);
      vibrate(8);
    }, 280);
  };
  const stageMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const prev = g.pointers.get(e.pointerId);
    if (!prev) return;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      g.scale = Math.max(1, Math.min(4, g.pinchScale * (Math.hypot(a.x - b.x, a.y - b.y) / g.pinchDist)));
      clampPan(); applyZoom();
      return;
    }
    if (g.held) return;
    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < 8) return;
    g.moved = true; window.clearTimeout(g.holdTimer);
    if (g.scale > 1.01) { g.tx += e.clientX - prev.x; g.ty += e.clientY - prev.y; clampPan(); applyZoom(); return; }
    dragging.current = true;
    move(e);
  };
  const stageUp = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const wasPinch = g.pointers.size === 2;
    g.pointers.delete(e.pointerId);
    if (wasPinch) { if (g.scale < 1.05) { g.scale = 1; g.tx = 0; g.ty = 0; applyZoom(); } return; }
    const tap = !g.moved && !g.held;
    endHold();
    if (tap) {
      const now = Date.now();
      if (now - g.lastTap < 300) { g.scale = 1; g.tx = 0; g.ty = 0; applyZoom(); g.lastTap = 0; return; }
      g.lastTap = now;
      // O atingere scurtă mută linia acolo (ca până acum), doar când poza nu e mărită.
      if (g.scale <= 1.01) { dragging.current = true; move(e); }
    }
    finishDrag();
  };
  const [retouch, setRetouch] = useState<ToolKind | null>(null);
  const [tools, setTools] = useState<{ clarity: boolean; cutout: boolean }>({ clarity: false, cutout: false });
  useEffect(() => { void onDeviceEditAvailable().then(a => setTools({ clarity: a.clarity, cutout: a.cutout })); }, []);
  // „Auto AI” (serverul) a fost scos din editor: depindea de limita zilnică, iar corectura
  // automată de pe telefon face deja același lucru, gratuit și pe loc.

  const save = async () => {
    if (!edits) return;
    learnEditorTaste(manual);
    if (ADVANCED.has(style) && useStore.getState().gatePremium('styles')) return;
    if (!pure) learnLook(style, amount);
    setSaving(true);
    try {
      // Portretul cu omul decupat: masca nu se păstrează în copie (se reface din poză),
      // deci rezultatul se salvează gata făcut, ca poză nouă, la rezoluție mare.
      const useLit = lit && !pure;
      // Pe telefon, poza editată se scrie mereu ca poză nouă în galeria telefonului
      // (Pictures/Cherrypic/Editate), unde apare prima. Raportat: „dacă salvezi o poză după
      // editare, nu o văd în galeria telefonului” — copia rămânea doar în aplicație, iar
      // trimiterea ei dădea eroare, fiindcă nu avea fișier.
      if ((style === 'portrait' && edits.bokehMask && !pure) || useLit || canSharpen()) {
        const url = useLit ? src : (canSharpen() ? await sharpUrl(photo.id, 3000).catch(() => null) : null) ?? src;
        const img = url ? await createImageBitmap(await (await fetch(url)).blob()) : null;
        if (img) {
          const o = outputSize(img.width, img.height, edits);
          const c = document.createElement('canvas');
          c.width = o.width; c.height = o.height;
          const ctx = c.getContext('2d');
          if (ctx) {
            // Desenul mare, în afara firului principal când se poate: ecranul nu îngheață la salvare.
            let drawn = false;
            if (canRenderOff(edits)) {
              const source = document.createElement('canvas');
              source.width = img.width; source.height = img.height;
              source.getContext('2d')?.drawImage(img, 0, 0);
              const out = await renderOff(source, edits).catch(() => null);
              if (out) { ctx.drawImage(out, 0, 0, o.width, o.height); out.close(); drawn = true; }
            }
            if (!drawn) drawAdjusted(ctx, img, img.width, img.height, o.width, o.height, edits);
            const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.94));
            const ok = blob ? await saveEditedBlob(blob, useLit ? 'lumina' : style === 'portrait' ? 'portret' : 'editat') : false;
            if (ok) vibrate(12);
            useStore.getState().setNotice(tr(ok ? 'lx.magic.saved' : 'lx.magic.failed'));
            if (ok) { onClose(); return; }
          }
        }
      }
      vibrate(12);
      await addCorrectedCopies([{ sourceId: photo.id, adjustments: edits }]);
      // Aceeași lumină pentru toată ziua: celelalte poze păstrate din aceeași zi au de
      // obicei aceeași lumină, deci primesc aceleași reglaje (fără decupaj și fără estompare).
      const day = photo.capturedAt ? new Date(photo.capturedAt).toDateString() : null;
      const siblings = day ? useStore.getState().photos.filter(p => p.id !== photo.id && p.status === 'selected' && !p.aside && p.mediaUri && p.capturedAt && new Date(p.capturedAt).toDateString() === day) : [];
      if (siblings.length && await useStore.getState().askConfirm(tr('lx.enhance.applyDay', { count: siblings.length }), { confirmLabel: tr('lx.enhance.applyDayGo') })) {
        const shared = { ...edits, crop: undefined, bokeh: 0, bokehMask: undefined, bokehSubject: undefined, rotationDeg: 0 };
        await addCorrectedCopies(siblings.map(p => ({ sourceId: p.id, adjustments: shared })));
      }
      onClose();
    } finally { setSaving(false); }
  };

  const nothing = false;
  return createPortal(
    <div className="lx lx-enhance" role="dialog" aria-modal="true" aria-label={tr('lx.enhance.title')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.enhance.title')}</span>
        <span className="lx-undo-pair">
          <button className="lx-icon-btn" onClick={() => stepHistory(-1)} disabled={histAt <= 0} aria-label={tr('lx.undo')}>↶</button>
          <button className="lx-icon-btn" onClick={() => stepHistory(1)} disabled={histAt >= hist.length - 1} aria-label={tr('lx.enhance.redo')}>↷</button>
        </span>
      </header>
      <div className={`lx-enhance-stage${holding ? ' holding' : ''}`} ref={stage}
        onPointerDown={stageDown} onPointerMove={stageMove} onPointerUp={stageUp} onPointerCancel={stageUp}>
        {holding && <span className="lx-enhance-hold">{tr('lx.enhance.before')}</span>}
        {proPreview && <span className="lx-pro-preview" aria-hidden="true"><b>PRO</b> {tr('lx.enhance.proPreview')}</span>}
        {!src && !failed && <div className="lx-enhance-wait"><span className="lx-spinner" />{tr('lx.enhance.working')}</div>}
        {failed && <p className="lx-empty">{tr('lx.enhance.failed')}</p>}
        <div className="lx-enhance-zoom" ref={zoomBox}>
        {src && edits && (edits.crop || panel === 'frame') ? (
          <div className="lx-enhance-frame cropped">
            <LivePreview src={view!} edits={edits} />
          </div>
        ) : src && edits && (
          <div className="lx-enhance-frame">
            <img src={orig ?? src} alt="" draggable={false} />
            <div ref={compareAfter} className="lx-enhance-after" style={{ transform: `translate3d(${split}%,0,0)` }}>
              <div ref={compareInner} className="lx-enhance-after-inner" style={{ transform: `translate3d(${-split}%,0,0)` }}>
                <LivePreview src={view!} edits={edits} />
              </div>
            </div>
            {!nothing && (
              <>
                <span ref={compareLine} className="lx-enhance-linewrap" style={{ transform: `translate3d(${split}%,0,0)` }}><span className="lx-enhance-line"><i /></span></span>
                <span className="lx-enhance-tag left">{tr('lx.enhance.before')}</span>
                <span className="lx-enhance-tag right">{tr('lx.enhance.after')}</span>
              </>
            )}
          </div>
        )}
        </div>
      </div>
      <div className="lx-viewer-info">
        {base && (
          <>
            <div className="lx-enhance-tabs" role="tablist">
              {PANELS.map(pn => (
                <button key={pn} role="tab" aria-selected={panel === pn} className={panel === pn ? 'on' : ''} onClick={() => setPanel(pn)}>
                  {tr(`lx.enhance.panel.${pn}`)}
                  {(pn === 'frame' ? aspect !== 'orig' || rotation !== 0 : pn !== 'styles' && MANUAL[pn].some(m => manual[m.key])) && <i aria-hidden="true" />}
                </button>
              ))}
            </div>
            {panel === 'frame' ? (
              <div className="lx-enhance-sliders">
                {mine && !pure && <p className="lx-enhance-mine">✦ {tr('lx.enhance.mineNote', { style: tr(`lx.enhance.style.${mine.style}`), percent: Math.round(mine.amount * 100), count: mine.saves })}</p>}
            {picked && !pure && style === picked.style && picked.scene && <p className="lx-enhance-mine">✦ {tr('lx.enhance.pickedNote', { style: tr(`lx.enhance.style.${picked.style}`), scene: tr(`lx.enhance.scene.${picked.scene}`) })}</p>}
            <div className="lx-enhance-styles" role="radiogroup" aria-label={tr('lx.enhance.panel.frame')}>
                  {(Object.keys(ASPECTS) as Aspect[]).map(a => (
                    <button key={a} role="radio" aria-checked={aspect === a} className={aspect === a ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setAspect(a)}>
                      {a === 'orig' ? tr('lx.enhance.aspect.orig') : a}
                    </button>
                  ))}
                </div>
                <label className="lx-enhance-amount">
                  <span>{tr('lx.enhance.tilt')}</span>
                  <input type="range" min={-8} max={8} step={0.5} value={rotation} onChange={e => setUserTilt(Number(e.target.value))} onDoubleClick={() => setUserTilt(0)} />
                  <b>{rotation > 0 ? '+' : ''}{rotation}°</b>
                </label>
                <p className="lx-hint">{tr('lx.enhance.frameHint')}</p>
              </div>
            ) : panel !== 'styles' ? (
              <div className="lx-enhance-sliders">
                {MANUAL[panel as ManualPanel].map(m => (
                  <label key={m.key} className="lx-enhance-amount">
                    <span>{tr(`lx.enhance.adj.${m.key}`)}</span>
                    <input type="range" min={m.min ?? -100} max={100} step={1} value={manual[m.key] ?? 0}
                      className={m.track ? `track-${m.track}` : undefined}
                      onChange={e => setManual(v => ({ ...v, [m.key]: Number(e.target.value) }))}
                      onDoubleClick={() => setManual(v => ({ ...v, [m.key]: 0 }))} />
                    <b>{(manual[m.key] ?? 0) > 0 ? '+' : ''}{manual[m.key] ?? 0}</b>
                  </label>
                ))}
                {MANUAL[panel as ManualPanel].some(m => manual[m.key]) && (
                  <button className="lx-link center" onClick={() => setManual(v => { const n = { ...v }; for (const m of MANUAL[panel as ManualPanel]) delete n[m.key]; return n; })}>{tr('lx.enhance.reset')}</button>
                )}
              </div>
            ) : (<>
            {/* O singură linie mică: ce a reparat editorul (și că a pornit de la reglajele omului). */}
            {pure ? (
              <p className="lx-enhance-fix">
                {tr('lx.enhance.pureOn')}
                <button className="lx-link" onClick={() => setPure(false)}>{tr('lx.enhance.pureUndo')}</button>
              </p>
            ) : (issues.length > 0 || scenes.length > 0 || (learned && Object.keys(manual).length > 0)) && (
              <p className="lx-enhance-fix">
                {issues.length > 0
                  ? `✓ ${tr('lx.enhance.fixed', { what: issues.map(id => tr(`lx.enhance.issue.${id}`)).join(' · ') })}`
                  : scenes.length > 0 ? `🔍 ${tr('lx.enhance.saw', { what: scenes.map(sc => tr(`lx.enhance.scene.${sc}`)).join(' · ') })}` : ''}
                {learned && Object.keys(manual).length > 0 && <span> · {tr('lx.enhance.learnedShort')}</span>}
              </p>
            )}
            {!pure && (
              <button className="lx-pure-btn" onClick={() => { setPure(true); setManual({}); }}>
                <Icon name="reset" size={16} /> {tr('lx.enhance.pure')}
              </button>
            )}
            <div className="lx-enhance-styles" role="radiogroup" aria-label={tr('lx.enhance.style')}>
              {styles.map(st => (
                <button key={st} role="radio" aria-checked={!pure && style === st} className={!pure && style === st ? 'lx-style-card on' : 'lx-style-card'} onClick={() => { setPure(false); setStyle(st); }}>
                  {view && base && <StyleThumb src={view} edits={styledEdits(base, st, Math.max(0.6, amount))} />}
                  <span>{mine?.style === st && <i className="lx-mine" title={tr('lx.enhance.mine')}>✦ </i>}{tr(`lx.enhance.style.${st}`)}</span>
                  {ADVANCED.has(st) && premiumLocked && <b className="lx-pro">PRO</b>}
                </button>
              ))}
              {tilt !== 0 && (
                <button role="switch" aria-checked={straight} className={straight ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setStraight(v => !v)}>
                  📐 {tr('lx.enhance.straighten')}
                </button>
              )}
            </div>
            {!pure && <label className="lx-enhance-amount">
              <span>{tr('lx.enhance.amount')}</span>
              <input type="range" min={0} max={150} step={5} value={Math.round(amount * 100)} onChange={e => setAmount(Number(e.target.value) / 100)} />
              <b>{Math.round(amount * 100)}%</b>
            </label>}
            <div className="lx-enhance-tools" role="group" aria-label={tr('lx.tool.group')}>
              <button className="lx-tool-btn" onClick={() => setErasing(true)}><Icon name="eraser" />{tr('lx.magic.erase')}</button>
              {tools.clarity && <button className="lx-tool-btn" onClick={() => setRetouch('clarity')}><Icon name="zoom" />{tr('lx.tool.clarity.button')}</button>}
              {tools.cutout && <button className="lx-tool-btn" onClick={() => setRetouch('cutout')}><Icon name="scissors" />{tr('lx.tool.cutout.button')}</button>}
              {portraitAvailable() && <button className="lx-tool-btn" onClick={() => setRetouch('portrait')}><Icon name="target" />{tr('lx.tool.portrait.button')}</button>}
            </div>
            </>)}
          </>
        )}
        <div className="lx-decide-actions">
          <button className="lx-btn ghost" onClick={onClose}>{tr(nothing ? 'lx.close' : 'lx.enhance.cancel')}</button>
          {!nothing && orig && view && (
            <button className="lx-btn ghost" onClick={() => {
              // Un stil Pro nu iese din aplicație nici ca imagine „înainte/după”.
              if (proPreview && useStore.getState().gatePremium('styles')) return;
              const fixes = issues.length
                ? issues.map(id => tr(`lx.enhance.issue.${id}`)).join(' · ')
                : tr('lx.enhance.title');
              // „După” e poza cu reglajele de pe ecran, nu sursa (raportat cu capturi:
              // cele două jumătăți ieșeau aproape la fel).
              void (async () => {
                const after = edits ? await renderEditedUrl(view, edits).catch(() => null) : null;
                try {
                  const blob = await renderBeforeAfterCard(orig, after ?? view, fixes, tr('lx.share.cta'));
                  if (blob) await shareCard(blob, `cherrypic-inainte-dupa-${Date.now()}.jpg`, fixes, tr('lx.share.cta'));
                } finally { if (after) URL.revokeObjectURL(after); }
              })();
            }}>{tr('lx.freed.share')}</button>
          )}
          {!nothing && <button className="lx-btn primary" disabled={!edits || saving} onClick={() => void save()}>{tr(proPreview ? 'lx.enhance.savePro' : 'lx.enhance.save')}</button>}
        </div>
      </div>
      {erasing && <MagicSheet photo={photo} onClose={() => setErasing(false)} />}
      {retouch && <AiRetouch photo={photo} kind={retouch} onClose={() => setRetouch(null)} />}
    </div>,
    document.body
  );
}

/**
 * „După”, desenat direct pe ecran. Raportat: „când schimbi intensitatea, durează
 * câteva secunde bune”. Înainte fiecare pas al liniei refăcea poza de 1600 px
 * și o comprima în JPEG. Acum: întâi o variantă mică (640 px, câteva zeci de
 * ms), cât tragi de linie; când te oprești, aceeași poză la claritate deplină.
 */
/**
 * Miniatura unui stil, pe poza ta: vezi cum arată înainte să-l alegi. Desenată mic
 * (96 px) și pe rând, una pe cadru, ca să nu țină ecranul pe loc.
 */
const tinyCache = new Map<string, Promise<HTMLCanvasElement>>();
function tinySource(src: string): Promise<HTMLCanvasElement> {
  let p = tinyCache.get(src);
  if (!p) {
    p = new Promise<HTMLCanvasElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => {
        const side = Math.min(el.naturalWidth, el.naturalHeight);
        const c = document.createElement('canvas');
        c.width = 96; c.height = 96;
        c.getContext('2d')?.drawImage(el, (el.naturalWidth - side) / 2, (el.naturalHeight - side) / 2, side, side, 0, 0, 96, 96);
        resolve(c);
      };
      el.onerror = reject;
      el.src = src;
    });
    if (tinyCache.size > 4) tinyCache.clear();
    tinyCache.set(src, p);
  }
  return p;
}
let thumbQueue: Promise<void> = Promise.resolve();
function StyleThumb({ src, edits }: { src: string; edits: EditAdjustments }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const key = useMemo(() => JSON.stringify({ ...edits, bokehMask: undefined, crop: undefined }), [edits]);
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      thumbQueue = thumbQueue.then(async () => {
        if (!alive) return;
        const tiny = await tinySource(src).catch(() => null);
        const ctx = canvas.current?.getContext('2d');
        if (!alive || !tiny || !ctx) return;
        const e: EditAdjustments = { ...edits, crop: undefined, rotationDeg: 0, bokeh: 0, bokehMask: undefined, heal: undefined };
        try { drawAdjusted(ctx, tiny, 96, 96, 96, 96, e); } catch { /* rămâne goală */ }
        await new Promise<void>(r => requestAnimationFrame(() => r()));
      });
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, key]);
  return <canvas ref={canvas} width={96} height={96} aria-hidden="true" />;
}

/** Cât de mult schimbă reglajele poza: media diferenței pe pixel (0..255), pe miniatura de 96 px. */
export function visibleChange(before: Uint8ClampedArray, after: Uint8ClampedArray): number {
  let s = 0;
  for (let i = 0; i < before.length; i += 4) s += Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]);
  return s / (before.length / 4) / 3;
}
/** Treptele de intensitate încercate și schimbarea de la care efectul „se vede”. */
export const FIT_STEPS = [0.5, 0.65, 0.8, 0.95];
export const FIT_TARGET = 11;
/** Prima treaptă la care schimbarea atinge ținta; ultima dacă niciuna nu ajunge. */
export function pickAmount(changes: readonly number[], steps: readonly number[] = FIT_STEPS, target = FIT_TARGET): number {
  const i = changes.findIndex(c => c >= target);
  return steps[i < 0 ? Math.min(changes.length, steps.length) - 1 : i];
}
async function fitAmount(src: string, base: EditAdjustments): Promise<number> {
  const tiny = await tinySource(src);
  const before = tiny.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, 96, 96).data;
  const c = document.createElement('canvas');
  c.width = 96; c.height = 96;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const changes: number[] = [];
  for (const k of FIT_STEPS) {
    const e: EditAdjustments = { ...styledEdits(base, 'natural', k), crop: undefined, rotationDeg: 0, bokeh: 0, bokehMask: undefined, heal: undefined };
    drawAdjusted(ctx, tiny, 96, 96, 96, 96, e);
    const ch = visibleChange(before, ctx.getImageData(0, 0, 96, 96).data);
    changes.push(ch);
    if (ch >= FIT_TARGET) break;
  }
  return pickAmount(changes);
}

/** Poza cu reglajele aplicate, ca adresă temporară (cel mult 1600 px pe latura lungă). */
async function renderEditedUrl(src: string, edits: EditAdjustments): Promise<string | null> {
  const img = await createImageBitmap(await (await fetch(src)).blob());
  const k = Math.min(1, 1600 / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const small = document.createElement('canvas');
  small.width = w; small.height = h;
  small.getContext('2d')?.drawImage(img, 0, 0, w, h);
  img.close();
  const o = outputSize(w, h, edits);
  const c = document.createElement('canvas');
  c.width = o.width; c.height = o.height;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  drawAdjusted(ctx, small, w, h, o.width, o.height, edits);
  const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.92));
  return blob ? URL.createObjectURL(blob) : null;
}

const QUICK = 640;
/** Treptele cadrului rapid, ca fracțiune din 640 px. */
const QUICK_STEPS = [1, 0.75, 0.56, 0.42, 0.32];
let quickScale = 1;
/** Ținta: sub ~24 ms pe cadru. Peste → o treaptă mai mic; sub 9 ms → o treaptă mai mare. */
export function nextQuickScale(current: number, ms: number): number {
  const i = Math.max(0, QUICK_STEPS.indexOf(current));
  if (ms > 24) return QUICK_STEPS[Math.min(QUICK_STEPS.length - 1, i + (ms > 60 ? 2 : 1))];
  if (ms < 9) return QUICK_STEPS[Math.max(0, i - 1)];
  return QUICK_STEPS[i];
}
const pads: (HTMLCanvasElement | null)[] = [null, null];
function pad(n: number, w: number, h: number): HTMLCanvasElement {
  const c = pads[n] ?? (pads[n] = document.createElement('canvas'));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}
const scratch = (w: number, h: number) => pad(0, w, h);
const scratch2 = (w: number, h: number) => pad(1, w, h);
function LivePreview({ src, edits }: { src: string; edits: EditAdjustments }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const small = useMemo(() => {
    if (!img) return null;
    const k = Math.min(1, QUICK / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }, [img]);
  // Varianta „clară” nu trebuie să fie mai mare decât ecranul (auditul: 2,4–4,2 s pe
  // poza întreagă, pe firul principal, la fiecare pauză în tragerea slider-ului).
  const screen = useMemo(() => {
    if (!img) return null;
    const cap = Math.round(Math.min(1400, Math.max(window.innerWidth, window.innerHeight) * Math.min(2, window.devicePixelRatio || 1)));
    const k = Math.min(1, cap / Math.max(img.naturalWidth, img.naturalHeight));
    if (k >= 1) return null;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }, [img]);

  useEffect(() => {
    let alive = true;
    const el = new Image();
    el.onload = () => { if (alive) setImg(el); };
    el.src = src;
    return () => { alive = false; };
  }, [src]);

  useEffect(() => {
    const out = canvas.current;
    if (!out || !img || !small) return;
    const draw = (source: CanvasImageSource, w: number, h: number) => {
      // Cu decupaj, pânza ia proporția cadrului (altfel decupajul s-ar întinde).
      const o = outputSize(w, h, edits);
      if (out.width !== o.width || out.height !== o.height) { out.width = o.width; out.height = o.height; }
      const ctx = out.getContext('2d');
      if (ctx) try { drawAdjusted(ctx, source, w, h, o.width, o.height, edits); } catch { /* fără memorie: rămâne ultima */ }
    };
    // Cadrul rapid se adaptează la telefon: dacă desenul durează mai mult de un cadru
    // și jumătate, următorul se face mai mic (și se întinde pe aceeași pânză); dacă
    // merge ușor, crește la loc. Claritatea deplină vine oricum când te oprești.
    const frame = requestAnimationFrame(() => {
      const k = quickScale;
      const t0 = performance.now();
      if (k >= 1) draw(small, small.width, small.height);
      else {
        const w = Math.max(1, Math.round(small.width * k)), h = Math.max(1, Math.round(small.height * k));
        const src = scratch(w, h);
        src.getContext('2d')?.drawImage(small, 0, 0, w, h);
        const o = outputSize(w, h, edits);
        const mid = scratch2(o.width, o.height);
        const mctx = mid.getContext('2d');
        const big = outputSize(small.width, small.height, edits);
        if (out.width !== big.width || out.height !== big.height) { out.width = big.width; out.height = big.height; }
        const ctx = out.getContext('2d');
        if (mctx && ctx) try {
          drawAdjusted(mctx, src, w, h, o.width, o.height, edits);
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(mid, 0, 0, out.width, out.height);
        } catch { /* fără memorie: rămâne ultima */ }
      }
      quickScale = nextQuickScale(quickScale, performance.now() - t0);
    });
    let alive = true;
    const onMain = () => (screen ? draw(screen, screen.width, screen.height) : draw(img, img.naturalWidth, img.naturalHeight));
    const full = window.setTimeout(() => {
      // Cadrul clar se calculează în afara firului principal când se poate (fără gumă
      // și fără fundal estompat): ecranul nu îngheață nici când te oprești.
      if (!canRenderOff(edits)) { onMain(); return; }
      renderOff(screen ?? img, edits).then(bitmap => {
        if (alive) {
          if (out.width !== bitmap.width || out.height !== bitmap.height) { out.width = bitmap.width; out.height = bitmap.height; }
          out.getContext('2d')?.drawImage(bitmap, 0, 0);
        }
        bitmap.close();
      }).catch(() => { if (alive) onMain(); });
    }, 350);
    return () => { alive = false; cancelAnimationFrame(frame); window.clearTimeout(full); };
  }, [img, small, screen, edits]);

  return <canvas ref={canvas} className="lx-enhance-canvas" />;
}
