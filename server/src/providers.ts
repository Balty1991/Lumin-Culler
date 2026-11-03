/**
 * server/src/providers.ts
 * Alegerea furnizorului pentru „Auto AI”, fără secrete în cod.
 *
 * Ordinea vine din AI_PROVIDERS (implicit workers,gemini). Un furnizor fără
 * cheie e sărit. Rezultatul unei corecturi se poate ține minte după o
 * amprentă a imaginii, ca aceeași poză să nu consume neuroni de două ori.
 */

export type GradeProviderName = 'workers' | 'gemini';

const ALLOWED: readonly GradeProviderName[] = ['workers', 'gemini'];

export function providerOrder(raw: string | undefined): GradeProviderName[] {
  const picked = (raw ?? 'workers,gemini')
    .split(',')
    .map(s => s.trim())
    .filter((s): s is GradeProviderName => (ALLOWED as readonly string[]).includes(s));
  return picked.length ? [...new Set(picked)] : ['workers'];
}

/** Amprentă stabilă, ieftină, a JPEG-ului base64. Nu e un hash criptografic. */
export function gradeCacheKey(image: string): string {
  let h = 2166136261;
  const step = Math.max(1, Math.floor(image.length / 48));
  for (let i = 0; i < image.length; i += step) {
    h ^= image.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `grade:${(h >>> 0).toString(16)}:${image.length}`;
}

export function geminiGradeBody(image: string, prompt: string): Record<string, unknown> {
  return {
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inline_data: { mime_type: 'image/jpeg', data: image } }
      ]
    }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 180 }
  };
}

export function textFromGemini(json: unknown): string {
  const parts = (json as { candidates?: { content?: { parts?: { text?: string }[] } }[] } | null)?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map(p => (typeof p?.text === 'string' ? p.text : '')).join('');
}

/**
 * Editări generative (Gemini „Flash Image”): retuș profesional, cer nou, gumă.
 * Cost orientativ ~0,04–0,07 USD pe editare (de verificat în AI Studio) —
 * acoperit de abonament prin plafonul lunar pe instalare (AIEDIT_MONTHLY).
 */
export type AiEditMode = 'enhance' | 'sky-blue' | 'sky-sunset' | 'erase';

export const AIEDIT_PROMPTS: Record<AiEditMode, string> = {
  enhance: 'Retouch this photo like a professional photo editor. Keep it the same photo: same people, faces, identity, pose, composition, framing and content. Fix exposure and white balance, open up dark shadows and faces, recover blown highlights, make colors natural and vivid but not oversaturated, reduce noise, add gentle clarity. If the sky is flat white or gray, give it a natural soft blue sky with light clouds. Do not add or remove objects, do not change faces. Photorealistic.',
  'sky-blue': 'Replace only the sky in this photo with a natural clear blue sky with a few soft white clouds, matching the light and perspective of the scene. Keep everything else exactly the same: people, faces, trees, buildings, edges. Adjust the overall light slightly so it looks like a sunny day. Photorealistic.',
  'sky-sunset': 'Replace only the sky in this photo with a natural warm sunset sky (orange, pink and soft purple), matching the perspective. Keep everything else exactly the same: people, faces, trees, buildings. Add a gentle warm golden light on the scene so it matches the sunset. Photorealistic.',
  erase: 'The second image is a mask: white marks the area to remove. Remove from the first image whatever object or person is under the white area and fill it naturally with the surrounding background (same texture, light and perspective), as if it was never there. Keep everything else exactly the same. Return only the edited first image. Photorealistic.'
};

export function geminiImageBody(prompt: string, images: { mime: string; data: string }[]): Record<string, unknown> {
  return {
    contents: [{ role: 'user', parts: [{ text: prompt }, ...images.map(i => ({ inline_data: { mime_type: i.mime, data: i.data } }))] }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: 0.4 }
  };
}

/** Prima imagine din răspunsul Gemini (REST: inlineData, camelCase; tolerăm și snake_case). */
export function imageFromGemini(json: unknown): { mime: string; data: string } | null {
  const parts = (json as { candidates?: { content?: { parts?: Record<string, any>[] } }[] } | null)?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const p of parts) {
    const d = p?.inlineData ?? p?.inline_data;
    if (d && typeof d.data === 'string' && d.data.length > 100) return { mime: d.mimeType ?? d.mime_type ?? 'image/png', data: d.data };
  }
  return null;
}

export function monthKey(kind: string, installId: string, now: number): string {
  return `m:${new Date(now).toISOString().slice(0, 7)}:${kind}:${installId}`;
}
