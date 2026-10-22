/**
 * server/src/logic.ts
 * Logica serverului de efecte AI, fără nimic din Cloudflare, ca să poată fi
 * testată: ce cereri primim, ce trimitem la fal.ai, ce citim înapoi și cât
 * are voie să ceară fiecare instalare pe zi.
 */

export type Kind = 'alive' | 'style';

/** Stilurile artistice. Prompturile cer explicit păstrarea persoanei: un stil nu are voie să schimbe cine e în poză. */
export const STYLES: Record<string, string> = {
  watercolor: 'Turn this photo into a soft watercolor painting. Keep every person, face and pose exactly the same.',
  oil: 'Turn this photo into a classic oil painting with visible brush strokes. Keep every person, face and pose exactly the same.',
  sketch: 'Turn this photo into a detailed pencil sketch on white paper. Keep every person, face and pose exactly the same.',
  anime: 'Redraw this photo in a gentle hand-drawn anime style. Keep every person recognizable, with the same pose and clothes.',
  vintage: 'Make this photo look like a 1970s film photograph: warm faded colors, soft grain. Do not change the people or the scene.',
  cartoon3d: 'Redraw this photo as a soft 3D animated movie still. Keep every person recognizable, with the same pose and clothes.'
};

export const ALIVE_PROMPT =
  'Natural, gentle motion: the people breathe, blink and smile softly, hair moves slightly, subtle slow camera push-in. Realistic, no new people, no text.';

/** Cât cere fiecare instalare pe zi, ca plasă de siguranță (creditele lunare le ține aplicația). */
export const DAILY_LIMIT: Record<Kind, number> = { alive: 3, style: 20 };

/** Cost estimat per lucrare, în dolari: pentru bugetul zilnic total. */
export const COST_USD: Record<Kind, number> = { alive: 0.45, style: 0.05 };

export const MAX_IMAGE_BYTES = 1_500_000;

export interface CreateRequest {
  kind: Kind;
  style?: string;
  /** JPEG, base64 simplu (fără prefix data:). */
  image: string;
  installId: string;
}

export type Validation = { ok: true; req: CreateRequest } | { ok: false; error: string };

export function validateCreate(body: unknown): Validation {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'bad_json' };
  const b = body as Record<string, unknown>;
  if (b.kind !== 'alive' && b.kind !== 'style') return { ok: false, error: 'bad_kind' };
  if (b.kind === 'style' && (typeof b.style !== 'string' || !(b.style in STYLES))) return { ok: false, error: 'bad_style' };
  if (typeof b.installId !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(b.installId)) return { ok: false, error: 'bad_install' };
  if (typeof b.image !== 'string' || b.image.length < 100) return { ok: false, error: 'bad_image' };
  // base64 → octeți: 3 la fiecare 4 caractere.
  if ((b.image.length * 3) / 4 > MAX_IMAGE_BYTES) return { ok: false, error: 'image_too_big' };
  if (!/^\/9j\//.test(b.image)) return { ok: false, error: 'not_jpeg' }; // începutul base64 al unui JPEG (FF D8 FF)
  return { ok: true, req: { kind: b.kind, style: b.style as string | undefined, image: b.image, installId: b.installId } };
}

export interface Models {
  alive: string;
  style: string;
}

export const DEFAULT_MODELS: Models = {
  alive: 'fal-ai/kling-video/v2.1/standard/image-to-video',
  style: 'fal-ai/flux-pro/kontext'
};

/** Cererea către fal.ai: modelul și intrarea lui. */
export function falRequest(req: CreateRequest, models: Models): { model: string; input: Record<string, unknown> } {
  const imageUrl = `data:image/jpeg;base64,${req.image}`;
  if (req.kind === 'alive') {
    return { model: models.alive, input: { image_url: imageUrl, prompt: ALIVE_PROMPT, duration: '5' } };
  }
  return { model: models.style, input: { image_url: imageUrl, prompt: STYLES[req.style as string] } };
}

/** Adresa rezultatului din răspunsul lui fal.ai, după tipul lucrării. */
export function resultUrl(kind: Kind, json: unknown): string | null {
  const j = json as Record<string, any> | null;
  if (!j) return null;
  if (kind === 'alive') return typeof j.video?.url === 'string' ? j.video.url : null;
  const img = Array.isArray(j.images) ? j.images[0] : j.image;
  return typeof img?.url === 'string' ? img.url : null;
}

/** Ziua UTC (AAAA-LL-ZZ), pentru contoarele zilnice. */
export function day(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function quotaKey(installId: string, kind: Kind, now: number): string {
  return `q:${day(now)}:${kind}:${installId}`;
}

export function budgetKey(now: number): string {
  return `b:${day(now)}`;
}

/** Poate porni o lucrare nouă? `spentUsd` e ce s-a cheltuit azi în total. */
export function admit(kind: Kind, usedToday: number, spentUsd: number, budgetUsd: number):
  { ok: true } | { ok: false; error: 'daily_limit' | 'budget' } {
  if (usedToday >= DAILY_LIMIT[kind]) return { ok: false, error: 'daily_limit' };
  if (spentUsd + COST_USD[kind] > budgetUsd) return { ok: false, error: 'budget' };
  return { ok: true };
}

/** Starea lui fal.ai tradusă pentru aplicație. */
export function mapStatus(status: string | undefined): 'working' | 'done' | 'failed' {
  if (status === 'COMPLETED') return 'done';
  if (status === 'IN_QUEUE' || status === 'IN_PROGRESS') return 'working';
  return 'failed';
}
