/**
 * core/clip/clipPreprocess.ts
 * Poza -> tensorul pe care il asteapta modelul.
 *
 * DE CE E CRITIC, desi pare plictisitor. Un model de vedere e antrenat pe o
 * preprocesare ANUME: aceeasi decupare, aceeasi scara, aceeasi normalizare pe
 * canal, aceeasi ordine a dimensiunilor. Daca oricare dintre ele difera, modelul
 * nu da eroare — da vectori. Vectori de forma corecta, cu valori plauzibile, si
 * complet gresiti. Exact ca la compararea intre modele diferite (clipVector.ts),
 * modul de esec e tacerea, nu zgomotul. De-aia partea pur matematica de aici e
 * scoasa din worker si testata separat, cu numere verificabile de mana.
 *
 * DECUPAREA. Reteta standard e "redimensioneaza latura scurta la S, apoi taie
 * un patrat S×S din centru". Aici se face intr-un singur pas: se ia direct cel
 * mai mare patrat centrat din imaginea ORIGINALA si se deseneaza scalat in
 * S×S. E acelasi rezultat geometric, dar cu o singura reesantionare in loc de
 * doua — mai rapid si mai putin neclar, ceea ce conteaza cand exact claritatea
 * e unul dintre lucrurile pe care aplicatia le judeca.
 *
 * CE SE PIERDE, spus pe fata: taierea centrata arunca marginile unei poze
 * panoramice. Pentru "despre ce e poza asta" e compromisul obisnuit si
 * acceptat; nu e potrivit pentru a decide incadrarea, si nu se foloseste acolo.
 */

/**
 * Patratul centrat maxim din imaginea sursa — argumentele 2..5 pentru
 * drawImage. Pe o imagine deja patrata e toata imaginea.
 */
export function centerSquare(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height);
  return {
    // Math.floor, nu rotunjire: un offset fractionar la drawImage introduce o
    // interpolare in plus pe o operatie care ar trebui sa fie o simpla decupare.
    sx: Math.floor((width - size) / 2),
    sy: Math.floor((height - size) / 2),
    size
  };
}

/**
 * RGBA 0..255 (asa cum vine din canvas) -> tensor NCHW float, normalizat.
 *
 * NCHW inseamna ca toate valorile rosii vin primele, apoi toate cele verzi,
 * apoi toate cele albastre — NU pixel cu pixel. E ordinea pe care o cer
 * modelele exportate din PyTorch. Scrisa gresit (intercalat, ca in canvas),
 * modelul primeste o imagine care pentru el e zgomot colorat, si raspunde cu
 * un vector care arata normal.
 *
 * Canalul alfa se ignora: modelul are trei canale de intrare, iar pozele n-au
 * transparenta. O poza cu alfa (PNG) se vede ca si cum ar fi peste negru,
 * exact ca in canvas.
 *
 * @param rgba datele exact ca in ImageData.data, lungime size*size*4
 * @param size latura tensorului (patrat)
 * @param mean media pe canal R,G,B pe scara 0..1
 * @param std deviatia pe canal, aceeasi scara
 */
export function toTensor(
  rgba: Uint8ClampedArray | Uint8Array,
  size: number,
  mean: readonly [number, number, number],
  std: readonly [number, number, number]
): Float32Array {
  const pixels = size * size;
  if (rgba.length < pixels * 4) {
    throw new Error(`clipPreprocess: astept ${pixels * 4} octeti pentru ${size}x${size}, am primit ${rgba.length}`);
  }
  const out = new Float32Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    const p = i * 4;
    // Canal cu canal, la distanta de `pixels` unul de altul — asta E ordinea NCHW.
    out[i] = (rgba[p] / 255 - mean[0]) / std[0];
    out[pixels + i] = (rgba[p + 1] / 255 - mean[1]) / std[1];
    out[2 * pixels + i] = (rgba[p + 2] / 255 - mean[2]) / std[2];
  }
  return out;
}
