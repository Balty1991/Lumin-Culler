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
