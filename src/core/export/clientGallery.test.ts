import { describe, expect, it } from 'vitest';
import { buildClientGalleryHtml } from './clientGallery';

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
});
