/**
 * server/src/logic.ts
 * Logica serverului de efecte AI, fără nimic din Cloudflare, ca să poată fi
 * testată: ce cereri primim, ce trimitem la fal.ai, ce citim înapoi și cât
 * are voie să ceară fiecare instalare pe zi.
 */

export type Kind = 'alive' | 'style' | 'restore' | 'edit';

/** Stilurile artistice. Prompturile cer explicit păstrarea persoanei: un stil nu are voie să schimbe cine e în poză. */
export const STYLES: Record<string, string> = {
  watercolor: 'Turn this photo into a soft watercolor painting. Keep every person, face and pose exactly the same.',
  oil: 'Turn this photo into a classic oil painting with visible brush strokes. Keep every person, face and pose exactly the same.',
  sketch: 'Turn this photo into a detailed pencil sketch on white paper. Keep every person, face and pose exactly the same.',
  anime: 'Redraw this photo in a gentle hand-drawn anime style. Keep every person recognizable, with the same pose and clothes.',
  vintage: 'Make this photo look like a 1970s film photograph: warm faded colors, soft grain. Do not change the people or the scene.',
  cartoon3d: 'Redraw this photo as a soft 3D animated movie still. Keep every person recognizable, with the same pose and clothes.'
};

export const RESTORE_PROMPT =
  'Restore this old photograph: remove scratches, dust, stains and tears, fix fading, gently sharpen the faces and colorize it with natural, realistic colors. Keep every person, face, pose and the composition exactly the same.';

/** Ce se adaugă la orice editare cerută în cuvinte: schimbarea cerută, nimic altceva. */
export const EDIT_GUARD = ' Change only what is asked. Keep everyone\'s face and identity exactly the same.';

export const ALIVE_PROMPT =
  'Natural, gentle motion: the people breathe, blink and smile softly, hair moves slightly, subtle slow camera push-in. Realistic, no new people, no text.';

/** Cât cere fiecare instalare pe zi, ca plasă de siguranță (creditele lunare le ține aplicația). */
export const DAILY_LIMIT: Record<Kind, number> = { alive: 3, style: 20, restore: 20, edit: 20 };

/** Cost estimat per lucrare, în dolari: pentru bugetul zilnic total. */
export const COST_USD: Record<Kind, number> = { alive: 0.45, style: 0.05, restore: 0.05, edit: 0.05 };

export const MAX_IMAGE_BYTES = 1_500_000;

export interface CreateRequest {
  kind: Kind;
  style?: string;
  /** Doar la `edit`: ce vrea omul să schimbe, în cuvintele lui. */
  prompt?: string;
  /** JPEG, base64 simplu (fără prefix data:). */
  image: string;
  installId: string;
}

export type Validation = { ok: true; req: CreateRequest } | { ok: false; error: string };

export function validateCreate(body: unknown): Validation {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'bad_json' };
  const b = body as Record<string, unknown>;
  if (b.kind !== 'alive' && b.kind !== 'style' && b.kind !== 'restore' && b.kind !== 'edit') return { ok: false, error: 'bad_kind' };
  if (b.kind === 'edit' && (typeof b.prompt !== 'string' || b.prompt.trim().length < 3 || b.prompt.length > 300)) return { ok: false, error: 'bad_prompt' };
  if (b.kind === 'style' && (typeof b.style !== 'string' || !(b.style in STYLES))) return { ok: false, error: 'bad_style' };
  if (typeof b.installId !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(b.installId)) return { ok: false, error: 'bad_install' };
  if (typeof b.image !== 'string' || b.image.length < 100) return { ok: false, error: 'bad_image' };
  // base64 → octeți: 3 la fiecare 4 caractere.
  if ((b.image.length * 3) / 4 > MAX_IMAGE_BYTES) return { ok: false, error: 'image_too_big' };
  if (!/^\/9j\//.test(b.image)) return { ok: false, error: 'not_jpeg' }; // începutul base64 al unui JPEG (FF D8 FF)
  return {
    ok: true,
    req: {
      kind: b.kind,
      style: b.style as string | undefined,
      prompt: typeof b.prompt === 'string' ? b.prompt.trim() : undefined,
      image: b.image,
      installId: b.installId
    }
  };
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
  const prompt = req.kind === 'restore' ? RESTORE_PROMPT
    : req.kind === 'edit' ? `${req.prompt}.${EDIT_GUARD}`
    : STYLES[req.style as string];
  return { model: models.style, input: { image_url: imageUrl, prompt } };
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

// ---- Workers AI (gratuit, din contul Cloudflare) ----

/**
 * Fără cheie fal.ai, serverul folosește Workers AI, care are o cotă gratuită
 * zilnică. Acolo nu există video și nici editare precisă în cuvinte, deci
 * oferim doar stilurile (redesenarea pozei într-un stil).
 */
export function kindsFor(hasFal: boolean): Kind[] {
  return hasFal ? ['style', 'restore', 'edit', 'alive'] : ['style'];
}

/**
 * Modelele Workers AI care pot redesena o poză (primesc `image` + `strength`),
 * încercate în ordine: Cloudflare scoate din când în când modele din oferta
 * conturilor noi (SD 1.5 img2img nu mai e permis), deci nu ne bazăm pe unul singur.
 */
export const CF_IMG2IMG_MODELS = [
  '@cf/lykon/dreamshaper-8-lcm',
  '@cf/stabilityai/stable-diffusion-xl-base-1.0',
  '@cf/runwayml/stable-diffusion-v1-5-img2img'
];

/** Eroarea spune că modelul nu e disponibil pentru cont (nu că s-a terminat cota). */
export function modelUnavailable(detail: string): boolean {
  return /5018|not allowed|not found|no such model|deprecated|unknown model/i.test(detail);
}

/** Cât de mult redesenează modelul: destul cât să se vadă stilul, puțin cât fața să rămână a omului. */
export const CF_STRENGTH = 0.38;

const CF_STYLE_PROMPTS: Record<string, string> = {
  watercolor: 'soft watercolor painting, delicate brush washes, paper texture',
  oil: 'classic oil painting, visible brush strokes, rich colors, museum quality',
  sketch: 'detailed pencil sketch on white paper, graphite shading',
  anime: 'hand-drawn anime illustration, clean line art, soft cel shading',
  vintage: '1970s film photograph, warm faded colors, soft film grain',
  cartoon3d: '3D animated movie still, soft lighting, pixar style render'
};

export const CF_NEGATIVE = 'deformed face, extra fingers, extra limbs, blurry, text, watermark, nsfw';

/** Mărimea JPEG-ului, citită din antetul SOF, fără să decodăm poza. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    // SOF0..SOF15, fără DHT (C4), JPG (C8) și DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + len;
  }
  return null;
}

/** Dimensiunea de lucru: latura lungă 768, multiplu de 64, cu forma pozei. */
export function cfSize(width: number, height: number): { width: number; height: number } {
  const scale = 768 / Math.max(width, height);
  const r = (v: number) => Math.max(256, Math.round((v * scale) / 64) * 64);
  return { width: r(width), height: r(height) };
}

export function cfRequest(req: CreateRequest, bytes: Uint8Array): Record<string, unknown> {
  const size = jpegSize(bytes) ?? { width: 768, height: 768 };
  return {
    prompt: CF_STYLE_PROMPTS[req.style as string] ?? CF_STYLE_PROMPTS.watercolor,
    negative_prompt: CF_NEGATIVE,
    image: Array.from(bytes),
    strength: CF_STRENGTH,
    num_steps: 20,
    guidance: 7.5,
    ...cfSize(size.width, size.height)
  };
}

// ---- Fundal nou, descrieri și texte (Workers AI, gratuit) ----

/** Ce face serverul pe lângă lucrările cu poze întregi; merg gratuit pe Workers AI. */
export const EXTRA_KINDS = ['background', 'describe', 'caption', 'greeting', 'story', 'concepts', 'supervise', 'inpaint', 'grade'] as const;
export type ExtraKind = typeof EXTRA_KINDS[number];

export const EXTRA_DAILY_LIMIT: Record<ExtraKind, number> = { background: 15, describe: 60, caption: 30, greeting: 30, story: 30, concepts: 80, supervise: 30, inpaint: 25, grade: 40 };

export const CF_TEXT2IMG_MODELS = ['@cf/black-forest-labs/flux-1-schnell', '@cf/bytedance/stable-diffusion-xl-lightning'];
export const CF_VISION_MODELS = ['@cf/meta/llama-3.2-11b-vision-instruct', '@cf/llava-hf/llava-1.5-7b-hf'];
export const CF_TEXT_MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/google/gemma-3-12b-it', '@cf/meta/llama-3.1-8b-instruct'];

/**
 * Promptul de fundal: ce a scris omul (orice limbă, modelul de text îl
 * traduce înainte), plus cerința să fie doar decorul, fără oameni, ca
 * persoana decupată să stea în el.
 */
export function backgroundPrompt(sceneEn: string): string {
  return `${sceneEn.trim().replace(/[.\s]+$/, '')}. Empty scene, background only, no people, no text, photorealistic, natural light, wide angle, high detail.`;
}

export function validateBackground(body: unknown): { ok: true; prompt: string; installId: string; width: number; height: number } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.prompt !== 'string' || b.prompt.trim().length < 3 || b.prompt.length > 200) return { ok: false, error: 'bad_prompt' };
  if (typeof b.installId !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(b.installId)) return { ok: false, error: 'bad_install' };
  const w = Number(b.width) || 768, h = Number(b.height) || 1024;
  const size = cfSize(w, h);
  return { ok: true, prompt: b.prompt.trim(), installId: b.installId, ...size };
}

export interface DescribeRequest {
  kind: 'describe' | 'caption' | 'greeting' | 'story';
  /** JPEG-uri mici (base64), cel mult 4 (la felicitare, poate lipsi). */
  images: string[];
  installId: string;
  lang: string;
  /** Ce știm deja: data, câte poze, nume (dacă le-a dat omul). */
  context: string;
}

export function validateDescribe(body: unknown): { ok: true; req: DescribeRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.kind !== 'describe' && b.kind !== 'caption' && b.kind !== 'greeting' && b.kind !== 'story') return { ok: false, error: 'bad_kind' };
  const minImages = b.kind === 'greeting' ? 0 : 1;
  if (!Array.isArray(b.images) || b.images.length < minImages || b.images.length > 4) return { ok: false, error: 'bad_images' };
  for (const im of b.images) {
    if (typeof im !== 'string' || !/^\/9j\//.test(im) || (im.length * 3) / 4 > 300_000) return { ok: false, error: 'bad_image' };
  }
  if (typeof b.installId !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(b.installId)) return { ok: false, error: 'bad_install' };
  const lang = typeof b.lang === 'string' && /^[a-z]{2}$/.test(b.lang) ? b.lang : 'en';
  const context = typeof b.context === 'string' ? b.context.slice(0, 300) : '';
  return { ok: true, req: { kind: b.kind, images: b.images as string[], installId: b.installId, lang, context } };
}

export const LANGUAGE_NAMES: Record<string, string> = { ro: 'Romanian', en: 'English', it: 'Italian', es: 'Spanish', fr: 'French', de: 'German' };

export const VISION_PROMPT = 'Describe this photo in one short sentence: the place, what the people are doing, the mood. Never name or identify anyone, not even famous people: say "a man", "a girl", "a family".';

/** Cererea pentru modelul de text, din descrierile pozelor. Răspunsul trebuie să fie JSON. */
export function writerPrompt(req: DescribeRequest, descriptions: string[]): string {
  const language = LANGUAGE_NAMES[req.lang] ?? 'English';
  // Reguli comune: doar limba omului, iar nume de oameni doar din ce a dat el (nu ghicite din poză).
  const rules = ` Write only in ${language}, with no words from other languages. Never name or identify people from the photos; use a name only if it appears in the known context.`;
  const facts = descriptions.map((d, i) => `Photo ${i + 1}: ${d}`).join('\n');
  const ctx = req.context ? `\nKnown context: ${req.context}` : '';
  if (req.kind === 'story') {
    return `You write the short story of a day for a family photo memories app. It will appear as subtitles in a slideshow, one sentence at a time, in the order of the photos.${ctx}\n${facts}\n\nWrite in ${language}, warm, simple and concrete, like a parent remembering the day; present the moments in order.${rules} Return only JSON: {"sentences": ["...", "...", "..."]} with 3 or 4 sentences, each max 14 words.`;
  }
  if (req.kind === 'greeting') {
    return `You write greeting card messages for a family photo app.${ctx}\n${facts}\n\nWrite in ${language}, warm, personal and natural, like a close family member would write, never generic or cheesy. Use the occasion and the name from the context if given. ${rules} Return only JSON: {"texts": ["...", "...", "..."]} with three different messages: one heartfelt (max 45 words), one cheerful and playful (max 35 words), one short (max 15 words).`;
  }
  if (req.kind === 'describe') {
    return `You write titles for a family photo memories app.${ctx}\n${facts}\n\nWrite in ${language}, warm and natural, never cheesy.${rules} Return only JSON: {"title": "max 6 words, no date", "line": "one sentence, max 18 words, like a caption in a photo album"}.`;
  }
  return `You write social media captions for someone sharing their own photos.${ctx}\n${facts}\n\nWrite in ${language}.${rules} Return only JSON: {"captions": ["...", "...", "..."]} with three different captions: one heartfelt, one funny, one short with 2-3 fitting emoji. Max 25 words each. No hashtags spam (at most 2).`;
}

/** Scoate obiectul JSON din răspunsul modelului (care uneori pune text în jur). */
export function parseJsonReply(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

/**
 * Căutarea cu cuvinte: omul scrie în limba lui („tort”, „la mare”), iar
 * modelul alege din lista de concepte pe care telefonul le știe căuta.
 */
export function conceptsPrompt(query: string, vocab: string[]): string {
  return `A user searches their photo gallery for: "${query}". From this list of searchable concepts, pick the 1 to 3 that best match what they mean (translate if needed). Concepts: ${vocab.join(', ')}.\nReturn only JSON: {"concepts": ["..."]} using concepts exactly as written in the list. If nothing matches, return {"concepts": []}.`;
}

export function validateConcepts(body: unknown): { ok: true; query: string; vocab: string[]; installId: string } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.query !== 'string' || b.query.trim().length < 2 || b.query.length > 80) return { ok: false, error: 'bad_query' };
  if (!Array.isArray(b.vocab) || b.vocab.length < 1 || b.vocab.length > 600 || !b.vocab.every((v) => typeof v === 'string' && v.length <= 40)) return { ok: false, error: 'bad_vocab' };
  if (typeof b.installId !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(b.installId)) return { ok: false, error: 'bad_install' };
  return { ok: true, query: b.query.trim(), vocab: b.vocab as string[], installId: b.installId };
}

// ---- Lumi Cloud: a doua părere pentru pozele la care Lumi (pe telefon) nu e sigură ----

export interface SuperviseRequest {
  /** JPEG-uri mici (base64), cel mult 4 pe cerere. */
  images: string[];
  /** Scorul dat de Lumi pe telefon (0..100), în aceeași ordine. */
  scores: number[];
  /** Ce a măsurat telefonul pe fiecare poză (claritate, lumină, ochi), în engleză. */
  notes: string[];
  installId: string;
  lang: string;
}

export interface Verdict {
  keep: boolean;
  /** 0..1 — cât de sigur e modelul. */
  confidence: number;
  /** De ce, în limba omului, adresat lui. */
  reason: string;
  /** Ce se vede, scurt, în limba omului (intră în căutare). */
  caption: string;
  /** Cuvinte în engleză pentru căutare. */
  tags: string[];
}

export function validateSupervise(body: unknown): { ok: true; req: SuperviseRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(b.images) || b.images.length < 1 || b.images.length > 4) return { ok: false, error: 'bad_images' };
  for (const im of b.images) {
    if (typeof im !== 'string' || !/^\/9j\//.test(im) || (im.length * 3) / 4 > 300_000) return { ok: false, error: 'bad_image' };
  }
  if (typeof b.installId !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(b.installId)) return { ok: false, error: 'bad_install' };
  const scores = Array.isArray(b.scores) ? (b.scores as unknown[]).map(x => Math.max(0, Math.min(100, Number(x) || 0))) : [];
  const lang = typeof b.lang === 'string' && /^[a-z]{2}$/.test(b.lang) ? b.lang : 'en';
  const notes = Array.isArray(b.notes) ? (b.notes as unknown[]).map(x => (typeof x === 'string' ? x.slice(0, 160) : '')) : [];
  return { ok: true, req: { images: b.images as string[], scores: (b.images as string[]).map((_, i) => scores[i] ?? 50), notes: (b.images as string[]).map((_, i) => notes[i] ?? ''), installId: b.installId, lang } };
}

export const SUPERVISE_VISION_PROMPT = 'You help someone decide whether to keep a personal photo. In two short sentences describe: who or what is in it and what is happening, their expressions (smiling? eyes closed?), and the technical quality (sharp or blurry, well lit or too dark or too bright, good or accidental framing). Never name or identify anyone.';

export function supervisePrompt(req: SuperviseRequest, descriptions: string[]): string {
  const language = LANGUAGE_NAMES[req.lang] ?? 'English';
  const facts = descriptions.map((d, i) => `Photo ${i + 1} (phone AI score ${req.scores[i]}/100${req.notes[i] ? `; measured on the phone: ${req.notes[i]}` : ''}): ${d}`).join('\n');
  return `You are a careful photo curator helping one person keep only their best personal photos (family, kids, friends, pets, places, moments).\n${facts}\n\nFor each photo decide if this person would keep it. Trust the phone measurements for technical quality (blur, darkness, closed eyes): they come from the full photo. Keep sharp photos with open eyes, real smiles, good light and a clear moment. Do not keep blurry, too dark, accidental, closed-eye or near-empty frames. Be honest about uncertainty.\nWrite reason and caption only in ${language}, with no words from other languages; the reason speaks to the user ("you"), max 12 words; the caption says what is in the photo, max 8 words. Never name or identify people. Tags are 2-5 lowercase English words for search.\nReturn only JSON: {"items": [{"keep": true, "confidence": 0.8, "reason": "...", "caption": "...", "tags": ["..."]}]} with exactly ${descriptions.length} items, in the same order.`;
}

/** Răspunsul modelului, adus la exact `n` verdicte sigure de folosit. */
export function normalizeVerdicts(parsed: Record<string, unknown> | null, n: number): Verdict[] {
  const items = Array.isArray(parsed?.items) ? parsed!.items as unknown[] : [];
  return Array.from({ length: n }, (_, i) => {
    const it = (items[i] ?? {}) as Record<string, unknown>;
    const known = typeof it.keep === 'boolean';
    return {
      keep: it.keep === true,
      confidence: known ? Math.max(0, Math.min(1, Number(it.confidence) || 0)) : 0,
      reason: typeof it.reason === 'string' ? it.reason.slice(0, 140) : '',
      caption: typeof it.caption === 'string' ? it.caption.slice(0, 80) : '',
      tags: Array.isArray(it.tags) ? (it.tags as unknown[]).filter((t): t is string => typeof t === 'string').map(t => t.toLowerCase().slice(0, 30)).slice(0, 6) : []
    };
  });
}

/**
 * Guma AI și cerul nou: zona albă din mască se redesenează. Imaginea și masca
 * vin deja micșorate de telefon (latura lungă ≤ 512, multiplu de 64), iar
 * telefonul pune înapoi doar zona din mască, la rezoluția pozei.
 */
export const CF_INPAINT_MODELS = ['@cf/runwayml/stable-diffusion-v1-5-inpainting'];
export type InpaintMode = 'erase' | 'sky-blue' | 'sky-sunset';
const INPAINT_PROMPTS: Record<InpaintMode, { prompt: string; negative: string }> = {
  erase: {
    prompt: 'empty background, seamless natural continuation of the surrounding scene, same texture and lighting, photo',
    negative: 'person, people, face, object, text, watermark, blurry, artifacts'
  },
  'sky-blue': {
    prompt: 'clear bright blue sky with a few soft white clouds, natural daylight, photo',
    negative: 'buildings, trees, people, text, watermark, artifacts'
  },
  'sky-sunset': {
    prompt: 'beautiful golden hour sunset sky with warm orange and pink clouds, photo',
    negative: 'buildings, trees, people, sun disk, text, watermark, artifacts'
  }
};
export function inpaintPrompt(mode: InpaintMode): { prompt: string; negative: string } {
  return INPAINT_PROMPTS[mode];
}

const B64 = /^[A-Za-z0-9+/=]+$/;
export function validateInpaint(body: unknown): { ok: true; installId: string; mode: InpaintMode; image: string; mask: string; width: number; height: number } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.installId !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(b.installId)) return { ok: false, error: 'bad_install' };
  if (b.mode !== 'erase' && b.mode !== 'sky-blue' && b.mode !== 'sky-sunset') return { ok: false, error: 'bad_mode' };
  if (typeof b.image !== 'string' || b.image.length > 1_500_000 || !B64.test(b.image)) return { ok: false, error: 'bad_image' };
  if (typeof b.mask !== 'string' || b.mask.length > 800_000 || !B64.test(b.mask)) return { ok: false, error: 'bad_mask' };
  const w = Math.round(Number(b.width) / 64) * 64, h = Math.round(Number(b.height) / 64) * 64;
  if (!(w >= 256 && w <= 768 && h >= 256 && h <= 768)) return { ok: false, error: 'bad_size' };
  return { ok: true, installId: b.installId, mode: b.mode, image: b.image, mask: b.mask, width: w, height: h };
}

/**
 * „Auto AI” din editor: modelul care vede poza spune ce reglaje i-ar trebui, ca
 * un retușor — pornind de la varianta deja corectată pe telefon. Numere mici
 * (±30), ca să fie o corectură peste stil, nu o poză nouă.
 */
export const GRADE_KEYS = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temperature', 'tint', 'saturation', 'clarity'] as const;
export const GRADE_PROMPT = `You are a professional photo retoucher. Look at this photo (already lightly auto-corrected) and decide small slider adjustments that would make it look natural, bright and pleasing, especially faces and skin. Typical issues: too dark faces, gray flat overcast light, cold/blue or green cast, dull colors, harsh highlights. Never make it darker unless it is clearly overexposed. Return only JSON with integer values between -30 and 30 (0 = leave as is): {"exposure":0,"contrast":0,"highlights":0,"shadows":0,"whites":0,"blacks":0,"temperature":0,"tint":0,"saturation":0,"clarity":0,"reason":"max 12 words, what you fixed"}. temperature>0 warmer, tint>0 more magenta (less green).`;

export function validateGrade(body: unknown): { ok: true; image: string; installId: string; lang: string } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.image !== 'string' || !/^\/9j\//.test(b.image) || (b.image.length * 3) / 4 > 300_000) return { ok: false, error: 'bad_image' };
  if (typeof b.installId !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(b.installId)) return { ok: false, error: 'bad_install' };
  const lang = typeof b.lang === 'string' && /^[a-z]{2}$/.test(b.lang) ? b.lang : 'en';
  return { ok: true, image: b.image, installId: b.installId, lang };
}

/** Doar cheile cunoscute, numere întregi în ±30. */
export function normalizeGrade(raw: Record<string, unknown> | null): { values: Record<string, number>; reason: string } | null {
  if (!raw) return null;
  const values: Record<string, number> = {};
  for (const k of GRADE_KEYS) {
    const v = Number(raw[k]);
    if (Number.isFinite(v) && v !== 0) values[k] = Math.max(-30, Math.min(30, Math.round(v)));
  }
  return { values, reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 120) : '' };
}
