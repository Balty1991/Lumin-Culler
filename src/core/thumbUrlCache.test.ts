import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db', () => ({
  db: { thumbnails: { get: vi.fn() } }
}));

const { db } = await import('./db');
const { getCachedThumbUrl, peekThumbUrl, clearThumbUrlCache } = await import('./thumbUrlCache');

describe('thumbUrlCache', () => {
  beforeEach(() => {
    clearThumbUrlCache();
    vi.mocked(db.thumbnails.get).mockReset();
  });

  it('citeste din baza o singura data pentru aceeasi poza', async () => {
    // Asta e tot rostul: la derularea inapoi peste poze deja vazute, nu se mai
    // face nicio citire si nicio decodare noua.
    vi.mocked(db.thumbnails.get).mockResolvedValue({ photoId: 'a', blob: new Blob(['x']) } as never);
    const first = await getCachedThumbUrl('a');
    const second = await getCachedThumbUrl('a');
    expect(first).toBe(second);
    expect(db.thumbnails.get).toHaveBeenCalledTimes(1);
  });

  it('peek raspunde sincron dupa prima citire, si null inainte', async () => {
    vi.mocked(db.thumbnails.get).mockResolvedValue({ photoId: 'b', blob: new Blob(['x']) } as never);
    expect(peekThumbUrl('b')).toBeNull();
    const url = await getCachedThumbUrl('b');
    expect(peekThumbUrl('b')).toBe(url);
  });

  it('o poza fara miniatura intoarce null, fara sa cache-uiasca nimic', async () => {
    vi.mocked(db.thumbnails.get).mockResolvedValue(undefined as never);
    expect(await getCachedThumbUrl('lipsa')).toBeNull();
    expect(peekThumbUrl('lipsa')).toBeNull();
  });

  it('golirea elibereaza tot', async () => {
    vi.mocked(db.thumbnails.get).mockResolvedValue({ photoId: 'c', blob: new Blob(['x']) } as never);
    await getCachedThumbUrl('c');
    clearThumbUrlCache();
    expect(peekThumbUrl('c')).toBeNull();
  });
});
