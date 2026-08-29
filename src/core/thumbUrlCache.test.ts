import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db', () => ({
  db: { thumbnails: { get: vi.fn() } }
}));

const { db } = await import('./db');
const { getCachedThumbUrl, peekThumbUrl, forgetThumbUrl, clearThumbUrlCache } = await import('./thumbUrlCache');

describe('thumbUrlCache', () => {
  beforeEach(() => {
    clearThumbUrlCache();
    vi.mocked(db.thumbnails.get).mockReset();
    // jsdom nu implementeaza createObjectURL/revokeObjectURL (blob: URLs)
    // — fara stub, getCachedThumbUrl arunca la prima citire reala.
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:mock-url-${++n}`);
    URL.revokeObjectURL = vi.fn();
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

/**
 * Regresia raportata de utilizator: "am aplicat editarile, dar cand am iesit
 * nu se vad pe poza". Se aplicasera — miniatura din baza era cea corecta. Dar
 * un Object URL e legat de BYTES-II de la momentul crearii, nu de
 * inregistrarea din baza, iar cache-ul de mai sus il servea mai departe.
 *
 * Cache-ul face exact ce trebuie; ce lipsea era un mod de a-i spune ca o
 * anume poza s-a schimbat.
 */
describe('thumbUrlCache: cand imaginea din spate se schimba', () => {
  beforeEach(() => {
    clearThumbUrlCache();
    vi.mocked(db.thumbnails.get).mockReset();
  });

  it('dupa forgetThumbUrl, poza se reciteste — deci ecranul vede imaginea noua', async () => {
    vi.mocked(db.thumbnails.get).mockResolvedValue({ photoId: 'a', blob: new Blob(['vechi']) } as never);
    const inainte = await getCachedThumbUrl('a');

    // exact ce face bakeEdits: rescrie blob-ul, apoi uita URL-ul
    vi.mocked(db.thumbnails.get).mockResolvedValue({ photoId: 'a', blob: new Blob(['copt']) } as never);
    forgetThumbUrl('a');

    const dupa = await getCachedThumbUrl('a');
    expect(dupa).not.toBe(inainte);
    expect(db.thumbnails.get).toHaveBeenCalledTimes(2);
  });

  it('FARA el, cache-ul serveste mai departe imaginea veche — chiar bug-ul raportat', async () => {
    vi.mocked(db.thumbnails.get).mockResolvedValue({ photoId: 'a', blob: new Blob(['vechi']) } as never);
    const inainte = await getCachedThumbUrl('a');
    vi.mocked(db.thumbnails.get).mockResolvedValue({ photoId: 'a', blob: new Blob(['copt']) } as never);
    expect(await getCachedThumbUrl('a')).toBe(inainte);
    expect(db.thumbnails.get).toHaveBeenCalledTimes(1); // nici n-a intrebat baza
  });

  it('pe o poza care nu e in cache nu face nimic si nu arunca', () => {
    expect(() => forgetThumbUrl('nu-exista')).not.toThrow();
    expect(peekThumbUrl('nu-exista')).toBeNull();
  });
});
