/**
 * Proxy local pentru etapa 1. Nu e telefonul proprietarului: măsoară doar
 * amprenta 9×8 față de o parcurgere a unui cadru mare, pe acest procesor.
 * Cifrele de pe telefon apar în aplicație, după un import real.
 */
function dHash(width, height, pixel) {
  let hash = '';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      hash += pixel(x, y) > pixel(x + 1, y) ? '1' : '0';
    }
  }
  return hash;
}

function time(n, fn) {
  const start = performance.now();
  let sink = 0;
  for (let i = 0; i < n; i++) sink += fn();
  return { ms: (performance.now() - start) / n, sink };
}

const gray = new Uint8Array(2048 * 2048);
for (let i = 0; i < gray.length; i++) gray[i] = (i * 17) & 255;

const full = time(8, () => {
  let s = 0;
  for (let i = 0; i < gray.length; i++) s += gray[i];
  return s;
});
const thumb = time(2000, () => dHash(9, 8, (x, y) => ((x * 31 + y * 17) & 255)).length);

console.log(JSON.stringify({
  fullFrame2048Ms: Number(full.ms.toFixed(2)),
  dHash9x8Ms: Number(thumb.ms.toFixed(4)),
  note: 'Proxy de CPU, nu inferență. Pe 2.1.2 analiza era ~9.9s/poză pe telefonul măsurat în audit.'
}, null, 2));
