import { describe, expect, it } from 'vitest';
import { CARD, PLAY_URL, STORY_H, STORY_W, shareCaption } from './shareCards';

describe('carduri de partajare', () => {
  it('sunt pătrate sau 9:16 și trimit la fișa Play, nu la un site', () => {
    expect(CARD).toBe(1080);
    expect(STORY_W).toBe(1080);
    expect(STORY_H).toBe(1920);
    expect(PLAY_URL).toContain('id=com.luminculler.app');
    expect(PLAY_URL).not.toContain('github.io');
    const text = shareCaption('Am eliberat 2,1 GB', 'Fă-ți și tu, pe telefon');
    expect(text).toContain('2,1 GB');
    expect(text).toContain(PLAY_URL);
    expect(text).not.toMatch(/\d+\s*(review|recenzii|users|utilizatori)/i);
  });
});
