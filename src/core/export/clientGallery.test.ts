import { describe, expect, it, vi } from 'vitest';
import { buildClientGalleryHtml } from './clientGallery';

const applyWatermarkMock = vi.fn<(blob: Blob, text: string) => Promise<Blob>>();
vi.mock('./watermark', () => ({
  applyWatermark: (blob: Blob, text: string) => applyWatermarkMock(blob, text)
}));

describe('buildClientGalleryHtml', () => {
  it('embeds each photo as an inline data: URI, keyed by escaped filename', async () => {
    const html = await buildClientGalleryHtml(
      [{ fileName: 'a.jpg', thumbnail: new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' }) }],
      'Galerie test'
    );
    expect(html).toContain('data-name="a.jpg"');
    expect(html).toContain('src="data:image/jpeg;base64,');
    expect(html).toContain('<title>Galerie test</title>');
  });

  it('escapes XML/HTML-sensitive characters in the title and file names', async () => {
    const html = await buildClientGalleryHtml(
      [{ fileName: 'Tom & Jerry <2>.jpg', thumbnail: new Blob(['x'], { type: 'image/jpeg' }) }],
      'Client <VIP> & Co'
    );
    expect(html).toContain('Tom &amp; Jerry &lt;2&gt;.jpg');
    expect(html).toContain('Client &lt;VIP&gt; &amp; Co');
    expect(html).not.toContain('Tom & Jerry <2>.jpg"');
  });

  it('produces a single self-contained file with no external references', async () => {
    const html = await buildClientGalleryHtml(
      [{ fileName: 'a.jpg', thumbnail: new Blob(['x'], { type: 'image/jpeg' }) }],
      'Galerie'
    );
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('<link ');
    expect(html).not.toContain('<script src');
  });

  it('applies a watermark to each thumbnail when watermarkText is provided', async () => {
    applyWatermarkMock.mockReset();
    applyWatermarkMock.mockResolvedValue(new Blob(['watermarked-bytes'], { type: 'image/jpeg' }));
    const html = await buildClientGalleryHtml(
      [{ fileName: 'a.jpg', thumbnail: new Blob(['original-bytes'], { type: 'image/jpeg' }) }],
      'Galerie',
      'Studio Foto X'
    );
    expect(applyWatermarkMock).toHaveBeenCalledWith(expect.any(Blob), 'Studio Foto X');
    expect(html).toContain(Buffer.from('watermarked-bytes').toString('base64'));
    expect(html).not.toContain(Buffer.from('original-bytes').toString('base64'));
  });

  it('leaves thumbnails untouched when no watermarkText is given', async () => {
    applyWatermarkMock.mockReset();
    const html = await buildClientGalleryHtml(
      [{ fileName: 'a.jpg', thumbnail: new Blob(['original-bytes'], { type: 'image/jpeg' }) }],
      'Galerie'
    );
    expect(applyWatermarkMock).not.toHaveBeenCalled();
    expect(html).toContain(Buffer.from('original-bytes').toString('base64'));
  });

  it('renders the subtitle line, escaped, when provided', async () => {
    const html = await buildClientGalleryHtml(
      [{ fileName: 'a.jpg', thumbnail: new Blob(['x'], { type: 'image/jpeg' }) }],
      'Galerie',
      undefined,
      '12 poze selectate <VIP> & Co'
    );
    expect(html).toContain('<p class="subtitle">12 poze selectate &lt;VIP&gt; &amp; Co</p>');
  });

  it('omits the subtitle paragraph entirely when not provided, exactly as before this field existed', async () => {
    const html = await buildClientGalleryHtml(
      [{ fileName: 'a.jpg', thumbnail: new Blob(['x'], { type: 'image/jpeg' }) }],
      'Galerie'
    );
    expect(html).not.toContain('class="subtitle"');
  });

  it('always includes the app credit footer', async () => {
    const html = await buildClientGalleryHtml(
      [{ fileName: 'a.jpg', thumbnail: new Blob(['x'], { type: 'image/jpeg' }) }],
      'Galerie'
    );
    expect(html).toContain('Lumin Culler Pro');
  });
});
