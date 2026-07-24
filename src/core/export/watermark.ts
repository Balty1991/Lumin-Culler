/**
 * core/export/watermark.ts
 * Watermark text repetat, diagonal, semi-transparent — aplicat pe miniaturile
 * din galeria client (core/export/clientGallery.ts), ca fotograful sa poata
 * trimite un preview clientului fara sa riste ca acesta sa foloseasca pozele
 * nefinalizate/neplatite. Deseneaza pe un canvas offscreen; nu modifica
 * blob-ul original din Dexie — exportul normal (XMP, listă, contact sheet)
 * ramane neatins.
 */
export async function applyWatermark(blob: Blob, text: string): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) { bitmap.close(); return blob; }

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  const fontSize = Math.max(14, Math.round(canvas.width * 0.07));
  ctx.lineWidth = Math.max(1, fontSize * 0.04);
  ctx.font = `700 ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(-Math.PI / 6);
  // randuri repetate pe toata diagonala — acopera intreg cadrul, nu doar centrul,
  // altfel un decupaj/crop al clientului ar putea elimina un singur watermark central
  const diag = Math.sqrt(canvas.width ** 2 + canvas.height ** 2);
  const stepY = fontSize * 3;
  for (let y = -diag / 2; y <= diag / 2; y += stepY) {
    ctx.strokeText(text, 0, y);
    ctx.fillText(text, 0, y);
  }
  ctx.restore();

  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Watermark-ul nu a putut fi randat.'))), 'image/jpeg', 0.88);
  });
}
