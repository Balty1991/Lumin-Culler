import { describe, expect, it } from 'vitest';
import { admit, DAILY_LIMIT, falRequest, DEFAULT_MODELS, mapStatus, quotaKey, resultUrl, validateCreate, STYLES } from '../src/logic';
import { validateSupervise, normalizeVerdicts, supervisePrompt } from '../src/logic';

const jpeg = '/9j/' + 'A'.repeat(400);
const install = '0f8e2c1a-1234-4abc-9def-001122334455';

describe('validateCreate', () => {
  it('accepts a style job and an alive job', () => {
    expect(validateCreate({ kind: 'style', style: 'watercolor', image: jpeg, installId: install }).ok).toBe(true);
    expect(validateCreate({ kind: 'alive', image: jpeg, installId: install }).ok).toBe(true);
  });
  it('rejects unknown kinds, styles, non-JPEG, huge images and bad install ids', () => {
    expect(validateCreate({ kind: 'nude', image: jpeg, installId: install })).toEqual({ ok: false, error: 'bad_kind' });
    expect(validateCreate({ kind: 'style', style: 'x', image: jpeg, installId: install })).toEqual({ ok: false, error: 'bad_style' });
    expect(validateCreate({ kind: 'alive', image: 'iVBOR' + 'A'.repeat(400), installId: install })).toEqual({ ok: false, error: 'not_jpeg' });
    expect(validateCreate({ kind: 'alive', image: '/9j/' + 'A'.repeat(2_100_000), installId: install })).toEqual({ ok: false, error: 'image_too_big' });
    expect(validateCreate({ kind: 'alive', image: jpeg, installId: 'x' })).toEqual({ ok: false, error: 'bad_install' });
    expect(validateCreate(null)).toEqual({ ok: false, error: 'bad_json' });
  });
});

describe('fal requests and results', () => {
  it('sends the image as a data URI with the right prompt and model', () => {
    const r = falRequest({ kind: 'style', style: 'sketch', image: jpeg, installId: install }, DEFAULT_MODELS);
    expect(r.model).toBe(DEFAULT_MODELS.style);
    expect(r.input.image_url).toBe(`data:image/jpeg;base64,${jpeg}`);
    expect(r.input.prompt).toBe(STYLES.sketch);
    const a = falRequest({ kind: 'alive', image: jpeg, installId: install }, DEFAULT_MODELS);
    expect(a.model).toBe(DEFAULT_MODELS.alive);
    expect(a.input.duration).toBe('5');
  });
  it('reads video and image urls', () => {
    expect(resultUrl('alive', { video: { url: 'https://v' } })).toBe('https://v');
    expect(resultUrl('style', { images: [{ url: 'https://i' }] })).toBe('https://i');
    expect(resultUrl('style', { image: { url: 'https://j' } })).toBe('https://j');
    expect(resultUrl('alive', {})).toBeNull();
  });
  it('maps provider states', () => {
    expect(mapStatus('IN_QUEUE')).toBe('working');
    expect(mapStatus('IN_PROGRESS')).toBe('working');
    expect(mapStatus('COMPLETED')).toBe('done');
    expect(mapStatus('ERROR')).toBe('failed');
  });
});

describe('restore and edit', () => {
  it('validates edit prompts and builds restore/edit requests on the image model', () => {
    expect(validateCreate({ kind: 'edit', image: jpeg, installId: install })).toEqual({ ok: false, error: 'bad_prompt' });
    expect(validateCreate({ kind: 'edit', prompt: 'x'.repeat(301), image: jpeg, installId: install })).toEqual({ ok: false, error: 'bad_prompt' });
    const e = validateCreate({ kind: 'edit', prompt: '  put us on a beach ', image: jpeg, installId: install });
    expect(e.ok).toBe(true);
    if (e.ok) {
      const r = falRequest(e.req, DEFAULT_MODELS);
      expect(r.model).toBe(DEFAULT_MODELS.style);
      expect(String(r.input.prompt).startsWith('put us on a beach.')).toBe(true);
      expect(String(r.input.prompt)).toContain('identity');
    }
    const r = falRequest({ kind: 'restore', image: jpeg, installId: install }, DEFAULT_MODELS);
    expect(String(r.input.prompt)).toContain('Restore');
    expect(resultUrl('restore', { images: [{ url: 'https://r' }] })).toBe('https://r');
  });
});

describe('limits', () => {
  it('stops at the per-install daily limit and at the global budget', () => {
    expect(admit('alive', DAILY_LIMIT.alive, 0, 100)).toEqual({ ok: false, error: 'daily_limit' });
    expect(admit('alive', 0, 4.8, 5)).toEqual({ ok: false, error: 'budget' });
    expect(admit('style', 0, 4.8, 5)).toEqual({ ok: true });
    expect(quotaKey(install, 'alive', Date.UTC(2026, 9, 22))).toBe(`q:2026-10-22:alive:${install}`);
  });
});

import { cfRequest, cfSize, jpegSize, kindsFor } from '../src/logic';

describe('Workers AI', () => {
  it('offers only styles without a fal key', () => {
    expect(kindsFor(false)).toEqual(['style']);
    expect(kindsFor(true)).toContain('alive');
  });
  it('reads the JPEG size from the SOF header and keeps the shape', () => {
    // FFD8, APP0 de 16 octeți, apoi SOF0 cu înălțimea 600 și lățimea 800
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03]);
    expect(jpegSize(bytes)).toEqual({ width: 800, height: 600 });
    expect(cfSize(800, 600)).toEqual({ width: 768, height: 576 });
    expect(cfSize(1000, 4000)).toEqual({ width: 256, height: 768 });
    const r = cfRequest({ kind: 'style', style: 'oil', image: '', installId: install }, bytes);
    expect(r.width).toBe(768);
    expect(String(r.prompt)).toContain('oil');
  });
});

import { modelUnavailable } from '../src/logic';
describe('model fallback', () => {
  it('tells an unavailable model apart from a used-up quota', () => {
    expect(modelUnavailable('5018: This account is not allowed to access @cf/x')).toBe(true);
    expect(modelUnavailable('3036: you have used up your daily free allocation of 10,000 neurons')).toBe(false);
  });
});

import { backgroundPrompt, parseJsonReply, validateBackground, validateDescribe, writerPrompt } from '../src/logic';
describe('background, describe and captions', () => {
  it('builds an empty-scene background prompt and validates sizes', () => {
    expect(backgroundPrompt('a beach at sunset.')).toMatch(/^a beach at sunset\. Empty scene/);
    const v = validateBackground({ prompt: 'plajă la apus', installId: install, width: 900, height: 1200 });
    expect(v.ok && v.width).toBe(576);
    expect(validateBackground({ prompt: 'x', installId: install }).ok).toBe(false);
  });
  it('accepts up to four small JPEGs and asks for JSON in the right language', () => {
    const v = validateDescribe({ kind: 'describe', images: [jpeg, jpeg], installId: install, lang: 'ro', context: 'iulie 2023' });
    expect(v.ok).toBe(true);
    if (v.ok) expect(writerPrompt(v.req, ['a beach', 'kids eating ice cream'])).toContain('Romanian');
    expect(validateDescribe({ kind: 'describe', images: [], installId: install }).ok).toBe(false);
    expect(validateDescribe({ kind: 'caption', images: [jpeg, jpeg, jpeg, jpeg, jpeg], installId: install }).ok).toBe(false);
  });
  it('pulls the JSON object out of a chatty reply', () => {
    expect(parseJsonReply('Sure! {"title": "O zi la mare", "line": "Nisip."} Hope it helps')).toEqual({ title: 'O zi la mare', line: 'Nisip.' });
    expect(parseJsonReply('no json')).toBeNull();
  });
});

describe('greetings', () => {
  it('needs no photo and asks for three messages', () => {
    const v = validateDescribe({ kind: 'greeting', images: [], installId: install, lang: 'ro', context: 'Ocazia: zi de naștere. Pentru: Ana, 5 ani.' });
    expect(v.ok).toBe(true);
    if (v.ok) expect(writerPrompt(v.req, [])).toContain('"texts"');
  });
});

describe('privacy and language rules', () => {
  it('forbids naming people and mixing languages in every text prompt', () => {
    for (const kind of ['describe', 'caption', 'greeting'] as const) {
      const v = validateDescribe({ kind, images: [jpeg], installId: install, lang: 'ro' });
      if (!v.ok) throw new Error('invalid');
      const p = writerPrompt(v.req, ['a man smiling']);
      expect(p).toContain('Never name or identify people');
      expect(p).toContain('Write only in Romanian');
    }
  });
});

describe('Lumi Cloud supervise', () => {
  const img = '/9j/' + 'A'.repeat(100);
  it('validates requests', () => {
    expect(validateSupervise({ images: [img], scores: [40], installId: 'abcdefghijklmnop', lang: 'ro' }).ok).toBe(true);
    expect(validateSupervise({ images: [], installId: 'abcdefghijklmnop' }).ok).toBe(false);
    expect(validateSupervise({ images: ['nope'], installId: 'abcdefghijklmnop' }).ok).toBe(false);
    expect(validateSupervise({ images: [img, img, img, img, img], installId: 'abcdefghijklmnop' }).ok).toBe(false);
  });
  it('normalizes model replies to exactly n safe verdicts', () => {
    const v = normalizeVerdicts({ items: [{ keep: true, confidence: 3, reason: 'e clară', caption: 'o fetiță', tags: ['Girl', 1] }] }, 2);
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ keep: true, confidence: 1, tags: ['girl'] });
    expect(v[1]).toMatchObject({ keep: false, confidence: 0 });
  });
  it('asks for the user language and exact count', () => {
    const p = supervisePrompt({ images: [img, img], scores: [10, 90], installId: 'x', lang: 'ro' }, ['a', 'b']);
    expect(p).toContain('Romanian');
    expect(p).toContain('exactly 2 items');
  });
});
