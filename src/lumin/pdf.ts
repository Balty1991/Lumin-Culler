/**
 * lumin/pdf.ts
 * Un PDF cât se poate de simplu: fiecare pagină e o singură imagine JPEG pe
 * toată pagina (A4). Paginile se desenează înainte, pe canvas, cu poze și text;
 * aici doar se pun în fișier. Fără bibliotecă: formatul pentru asta e scurt.
 */
export interface PdfPage { jpeg: Uint8Array; width: number; height: number }

const A4 = { w: 595.28, h: 841.89 };

export function makePdf(pages: readonly PdfPage[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Uint8Array | string) => {
    const bytes = typeof b === 'string' ? enc.encode(b) : b;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n: number, body: () => void) => { offsets[n] = length; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };

  push('%PDF-1.4\n%âãÏÓ\n');
  // 1 catalog, 2 pagini; apoi pentru fiecare pagină: pagina, imaginea, conținutul.
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`));
  pages.forEach((p, i) => {
    const page = 3 + i * 3, image = page + 1, content = page + 2;
    obj(page, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /XObject << /Im${i} ${image} 0 R >> >> /Contents ${content} 0 R >>`));
    obj(image, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg);
      push('\nendstream');
    });
    const draw = `q ${A4.w} 0 0 ${A4.h} 0 0 cm /Im${i} Do Q`;
    obj(content, () => push(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
  });
  const total = 3 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
