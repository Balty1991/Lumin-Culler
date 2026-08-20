/**
 * core/recapVideoRender.ts
 *
 * Deseneaza planul din recapVideo.ts pe un canvas si il inregistreaza ca fisier.
 *
 * Totul local: `canvas.captureStream()` + `MediaRecorder`. Nicio poza nu pleaca
 * de pe dispozitiv nici acum, cand rezultatul e un fisier de trimis — ceea ce e
 * exact argumentul de vanzare al aplicatiei, si ar fi fost o ironie sa-l pierdem
 * fix la functia facuta ca sa fie impartasita.
 */
import { frameOpacity, frameScale, type RecapPlan } from './recapVideo';

/** Patrat: se vede bine si pe telefon, si intr-o conversatie, fara sa taie nimic pe verticala. */
export const CANVAS_SIZE = 1080;

/**
 * Formatul cerut, in ordinea preferintei.
 *
 * mp4 primul, dar NUMAI cu H.264 cerut explicit. Capcana, gasita la verificare:
 * Chromium raspunde `true` la isTypeSupported('video/mp4') si apoi produce un
 * fisier cu VP9 INTR-UN container mp4 (marca `vp09`). Are extensia potrivita, se
 * descarca frumos — si nu-l reda nimic: nici WhatsApp, nici galeria Android,
 * nici macar elementul <video> al browserului care l-a scris. Un `.webm` cinstit
 * e mult mai bun decat un `.mp4` pe care nu-l deschide nimeni, asa ca `video/mp4`
 * fara codec NU e in lista.
 */
const PREFERRED_TYPES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm'
];

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of PREFERRED_TYPES) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

/** Extensia potrivita tipului ales, ca fisierul sa se deschida cu ce trebuie. */
export function extensionFor(mimeType: string): string {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
}

export function isRecapVideoSupported(): boolean {
  return typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function'
    && pickMimeType() !== null;
}

/**
 * Deseneaza o poza umpland patratul, FARA sa taie din ea.
 *
 * Poza intreaga incape (contain), iar restul patratului se umple cu o versiune
 * marita si intunecata a ei. Alternativa (cover) ar fi taiat capete de oameni pe
 * pozele verticale — adica exact subiectul pentru care exista clipul.
 */
function drawCovered(ctx: CanvasRenderingContext2D, img: CanvasImageSource, w: number, h: number, scale: number): void {
  const S = CANVAS_SIZE;
  // fundal: aceeasi poza, marita sa acopere, intunecata
  const coverScale = Math.max(S / w, S / h) * 1.25;
  const cw = w * coverScale, ch = h * coverScale;
  ctx.save();
  ctx.filter = 'blur(28px) brightness(0.45)';
  ctx.drawImage(img, (S - cw) / 2, (S - ch) / 2, cw, ch);
  ctx.restore();
  // poza propriu-zisa, intreaga, cu panoramarea lenta
  const fitScale = Math.min(S / w, S / h) * scale;
  const fw = w * fitScale, fh = h * fitScale;
  ctx.drawImage(img, (S - fw) / 2, (S - fh) / 2, fw, fh);
}

export interface RecapRenderInput {
  plan: RecapPlan;
  /** Imaginile deja incarcate, in aceeasi ordine ca `plan.frames`. */
  images: (CanvasImageSource & { width: number; height: number })[];
  /** 0..1 — pentru bara de progres. */
  onProgress?: (fraction: number) => void;
  /** Intoarce true ca sa opreasca inregistrarea. */
  isCancelled?: () => boolean;
}

/**
 * Inregistreaza clipul si intoarce fisierul.
 *
 * Ruleaza in timp REAL: un clip de 20 de secunde dureaza 20 de secunde de
 * facut, pentru ca MediaRecorder inregistreaza un flux, nu randeaza offline.
 * De asta exista progres si anulare — altfel ar parea blocat.
 */
export async function renderRecapVideo({ plan, images, onProgress, isCancelled }: RecapRenderInput): Promise<Blob> {
  const mimeType = pickMimeType();
  if (!mimeType) throw new Error('MediaRecorder indisponibil');

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d indisponibil');

  const stream = canvas.captureStream(plan.fps);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = () => reject(new Error('inregistrarea a esuat'));
  });

  recorder.start();
  const started = performance.now();

  await new Promise<void>(resolve => {
    const tick = () => {
      const t = performance.now() - started;
      if (t >= plan.totalMs || isCancelled?.()) { resolve(); return; }

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      // De la ultima spre prima: cea care intra se deseneaza PESTE cea care
      // iese, deci tranzitia e o suprapunere, nu o clipire prin negru.
      for (let i = plan.frames.length - 1; i >= 0; i--) {
        const alpha = frameOpacity(plan, i, t);
        if (alpha <= 0) continue;
        const img = images[i];
        if (!img) continue;
        ctx.globalAlpha = alpha;
        drawCovered(ctx, img, img.width, img.height, frameScale(plan, i, t));
        ctx.globalAlpha = 1;
      }
      onProgress?.(Math.min(1, t / plan.totalMs));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  recorder.stop();
  stream.getTracks().forEach(tr => tr.stop());
  onProgress?.(1);
  return done;
}
