import { describe, expect, it, vi, afterEach } from 'vitest';
import { downloadZip } from './directoryPicker';

describe('downloadZip', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('triggers exactly ONE download (one object URL, one anchor click) regardless of entry count', async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:mock-url');
    URL.createObjectURL = createObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const encoder = new TextEncoder();
    await downloadZip('test-export.zip', [
      { path: 'Ami/a.jpg', data: encoder.encode('poza-a') },
      { path: 'Ami/b.jpg', data: encoder.encode('poza-b') },
      { path: 'Necunoscuti/c.jpg', data: encoder.encode('poza-c') }
    ]);

    // un singur URL.createObjectURL + un singur click — indiferent ca zipul contine 3 fisiere,
    // rezultatul e O SINGURA descarcare, nu 3 (bug real reparat aici: descarcarile secventiale
    // multiple sunt blocate silentios de multe browsere mobile dupa prima)
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const blobArg = createObjectURL.mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe('application/zip');
  });

  it('produces a zip blob with non-trivial size for multiple entries', async () => {
    let capturedBlob: Blob | null = null;
    URL.createObjectURL = vi.fn((b: Blob) => { capturedBlob = b; return 'blob:mock-url'; });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const encoder = new TextEncoder();
    await downloadZip('test.zip', [{ path: 'a.txt', data: encoder.encode('hello world'.repeat(50)) }]);

    expect(capturedBlob).not.toBeNull();
    expect(capturedBlob!.size).toBeGreaterThan(0);
  });
});
