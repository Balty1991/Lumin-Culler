/**
 * core/singletonVerdict.ts
 * Verdictul unei poze fără vecini de rafală.
 *
 * Analiza ușoară nu are fețe, etichete sau clipping măsurat. Dacă trece prin
 * decidePhotoStatus, „niciun subiect recunoscut” o ține la De verificat chiar
 * când e clară și bine expusă — exact cele 134 de poze din testul de pe telefon.
 * Aici decizia se ia din ce s-a măsurat cu adevărat. Ce nu s-a măsurat nu se
 * inventează și nu blochează o păstrare.
 */
import { landscapeSharpness } from './learning/ContextEngine';
import { classifyPhoto } from './smartInbox';

/**
 * Aceleași praguri ca hasNamedDefect din importPipeline (45 și 0.8).
 * Nu se importă de acolo: pipeline-ul importă modulul ăsta, iar un cerc
 * ar lăsa constantele neinițializate.
 */
export const ISOLATE_DEFECT_SHARPNESS = 45;
export const ISOLATE_EYES_OPEN_MIN = 0.8;

/** Aceeași bandă ca hasNamedDefect: peste 15 puncte față de 50, expunerea e un defect. */
export const DEFECT_EXPOSURE_OFF = 15;

/**
 * Sub atât, hârtia luminoasă, pală și cu muchii (bon, factură, pagină) e un
 * document. Calibrat pe grila 48×48, nu pe amprenta 9×8.
 */
export const PAPER_DOCUMENT_MIN = 0.62;

/** Lângă prag, nu e nici clară, nici ratată. Rămâne de verificat. */
const CLOSE_SHARPNESS = 8;
const CLOSE_EXPOSURE = 4;

export type PhotoAside = 'document' | 'screenshot';

export interface IsolateSignals {
  fileName: string;
  /** 0–100, măsurat pe miniatură. NaN = nemăsurat. */
  sharpness: number;
  /** 0–100. NaN = nemăsurat. */
  exposure: number;
  paperScore?: number;
  width?: number;
  height?: number;
  /** Câte fețe s-au găsit. Absent sau 0 = nu s-a măsurat nicio față. */
  faceCount?: number;
  /**
   * Fracția de fețe cu ochii deschiși, 0–1.
   * Absent = ochii nu s-au măsurat. Nu se presupune nici clipit, nici deschis.
   */
  eyesOpenRatio?: number;
}

export interface IsolateDecision {
  status: 'selected' | 'rejected' | 'review';
  aside?: PhotoAside;
}

/**
 * Hârtie: lumină mare, saturație mică, muchii multe (text).
 * Întoarce 0..1. Date prea mici pentru o grilă → 0, nu „document”.
 */
export function paperScoreFromRgba(data: ArrayLike<number>, width: number): number {
  const height = Math.floor(data.length / (width * 4));
  if (width < 8 || height < 8) return 0;
  const count = width * height;
  const gray = new Float64Array(count);
  let lumaSum = 0;
  let satSum = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const yv = 0.299 * r + 0.587 * g + 0.114 * b;
      gray[y * width + x] = yv;
      lumaSum += yv;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      satSum += max === 0 ? 0 : (max - min) / max;
    }
  }
  let acc = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const c = gray[y * width + x];
      const lap = gray[y * width + x - 1] + gray[y * width + x + 1] + gray[(y - 1) * width + x] + gray[(y + 1) * width + x] - 4 * c;
      acc += lap * lap;
      n++;
    }
  }
  const luma = lumaSum / count / 255;
  const sat = satSum / count;
  const edge = Math.min(1, Math.sqrt(n ? acc / n : 0) / 28);
  const bright = Math.min(1, Math.max(0, (luma - 0.55) / 0.3));
  const pale = Math.min(1, Math.max(0, (0.22 - sat) / 0.22));
  return bright * 0.45 + pale * 0.3 + edge * 0.25;
}

function judgedSharpness(raw: number, faceCount: number): number {
  if (faceCount > 0) return raw;
  return landscapeSharpness(raw) * 100;
}

export function decideIsolate(s: IsolateSignals): IsolateDecision {
  const faces = s.faceCount ?? 0;
  const category = classifyPhoto({
    id: '',
    fileName: s.fileName,
    faceCount: faces,
    width: s.width,
    height: s.height
  });
  if (category === 'screenshot') return { status: 'review', aside: 'screenshot' };
  if ((s.paperScore ?? 0) >= PAPER_DOCUMENT_MIN && faces === 0) {
    return { status: 'review', aside: 'document' };
  }

  const measuredSharp = Number.isFinite(s.sharpness);
  const measuredExposure = Number.isFinite(s.exposure);
  if (!measuredSharp || !measuredExposure) return { status: 'review' };

  if (faces > 0 && s.eyesOpenRatio !== undefined && s.eyesOpenRatio < ISOLATE_EYES_OPEN_MIN) {
    return { status: 'rejected' };
  }

  const sharp = judgedSharpness(s.sharpness, faces);
  const exposureOff = Math.abs(s.exposure - 50);
  if (sharp < ISOLATE_DEFECT_SHARPNESS - CLOSE_SHARPNESS) return { status: 'rejected' };
  if (exposureOff > DEFECT_EXPOSURE_OFF + CLOSE_EXPOSURE) return { status: 'rejected' };
  if (sharp < ISOLATE_DEFECT_SHARPNESS + CLOSE_SHARPNESS) return { status: 'review' };
  if (exposureOff > DEFECT_EXPOSURE_OFF - CLOSE_EXPOSURE) return { status: 'review' };
  return { status: 'selected' };
}

/** Coada de triaj. Documentele și capturile stau deoparte, nu în „De verificat”. */
export function isReviewQueue(photo: { status: string; aside?: PhotoAside | string }): boolean {
  if (photo.aside === 'document' || photo.aside === 'screenshot') return false;
  return photo.status === 'pending' || photo.status === 'review';
}
