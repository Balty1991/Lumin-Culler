import { describe, expect, it } from 'vitest';
import { ensureLocaleLoaded } from '../i18n';
import { PLAY_STORE_URL, paintShareCard, shareCardCopy } from './shareResultCard';

describe('shareResultCard', () => {
  it('scrie pe cartonaș cât s-a eliberat și linkul de Play, în limba activă', async () => {
    await ensureLocaleLoaded('en');
    await ensureLocaleLoaded('de');
    await ensureLocaleLoaded('es');
    const copy = shareCardCopy('en', '6.2 GB', 12);
    expect(copy.kicker).toBe('I freed');
    expect(copy.size).toBe('6.2 GB');
    expect(copy.brand).toBe('with Lumin');
    expect(copy.detail).toBe('12 files');
    expect(copy.link).toContain('play.google.com');
    expect(PLAY_STORE_URL).toContain('com.luminculler.app');
    expect(shareCardCopy('ro', '6,2 GB', 3).kicker).toBe('Am eliberat');
    expect(shareCardCopy('de', '1 GB', 1).brand).toBe('mit Lumin');
  });

  it('desenează textul pe un canvas, ca imaginea să nu fie un div', async () => {
    await ensureLocaleLoaded('es');
    const calls: string[] = [];
    const ctx = {
      clearRect: () => calls.push('clear'),
      fillRect: () => calls.push('fill'),
      fill: () => calls.push('fill'),
      fillText: (text: string) => calls.push(text),
      stroke: () => calls.push('stroke'),
      beginPath: () => undefined,
      moveTo: () => undefined,
      arcTo: () => undefined,
      closePath: () => undefined,
      createLinearGradient: () => ({ addColorStop: () => undefined }),
      createRadialGradient: () => ({ addColorStop: () => undefined })
    } as unknown as CanvasRenderingContext2D;
    paintShareCard(ctx, shareCardCopy('es', '2 GB', 4));
    expect(calls).toContain('Liberé');
    expect(calls).toContain('2 GB');
    expect(calls.some(call => call.includes('play.google.com'))).toBe(true);
  });
});