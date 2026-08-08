/**
 * core/cropMath.ts
 * Matematica pura a tool-ului de recadrare manuala din EditPanel.tsx —
 * extrasa aici (audit de cod, nu cerinta directa a utilizatorului) ca sa fie
 * testabila fara sa randam EditPanel intreg sau sa simulam evenimente de
 * pointer/canvas. Toate coordonatele sunt fractiuni normalizate (0..1) fata
 * de latimea/inaltimea cadrului ORIGINAL al pozei — acelasi sistem ca
 * EditAdjustments.crop din core/imageAdjust.ts.
 */

export type CropBox = { x: number; y: number; width: number; height: number };
export type CropDragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

export const FULL_CROP: CropBox = { x: 0, y: 0, width: 1, height: 1 };
// Sub aceasta latime/inaltime (fractiune din cadru), o caseta ar fi prea mica
// ca sa mai poata fi apucata de handle-uri pe un ecran de telefon.
export const MIN_CROP_SIZE = 0.1;

export function clamp01(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Un raport gen "1:1" e definit in pixeli REALI ai fotografiei, dar `crop`
 * lucreaza in fractiuni normalizate (0..1) fata de latimea/inaltimea
 * cadrului — o caseta patrata (1:1) pe o poza portret NU inseamna
 * box.width === box.height in coordonate normalizate, ci trebuie corectata
 * cu raportul de aspect AL POZEI (naturalWidth/naturalHeight), altfel ar
 * iesi un dreptunghi, nu un patrat, cand se deseneaza pe pixelii reali.
 */
export function normalizedBoxRatio(ratio: number, naturalWidth: number, naturalHeight: number): number {
  return (ratio * naturalHeight) / naturalWidth;
}

/** Cea mai mare caseta cu raportul `normR` (width/height, normalizat) care incape in cadrul [0,1], centrata pe (cx, cy). */
export function boxForAspect(normR: number, cx: number, cy: number): CropBox {
  const width = normR <= 1 ? normR : 1;
  const height = normR <= 1 ? 1 : 1 / normR;
  const x = clamp01(cx - width / 2, 0, 1 - width);
  const y = clamp01(cy - height / 2, 0, 1 - height);
  return { x, y, width, height };
}

/** Mutarea casetei intregi (drag pe interior, nu pe un handle de colt) — dimensiunea nu se schimba, doar pozitia, clampata sa ramana in [0,1]. */
export function moveCropBox(box: CropBox, dx: number, dy: number): CropBox {
  return {
    ...box,
    x: clamp01(box.x + dx, 0, 1 - box.width),
    y: clamp01(box.y + dy, 0, 1 - box.height)
  };
}

/** Redimensionare LIBERA (fara raport blocat) dintr-un colt — fiecare axa se schimba independent, colturile opuse raman fixe. */
export function resizeCropFree(box: CropBox, mode: Exclude<CropDragMode, 'move'>, dx: number, dy: number): CropBox {
  let { x, y, width, height } = box;
  if (mode === 'nw' || mode === 'sw') {
    const newX = clamp01(box.x + dx, 0, box.x + box.width - MIN_CROP_SIZE);
    width = box.width - (newX - box.x);
    x = newX;
  }
  if (mode === 'ne' || mode === 'se') {
    width = clamp01(box.width + dx, MIN_CROP_SIZE, 1 - box.x);
  }
  if (mode === 'nw' || mode === 'ne') {
    const newY = clamp01(box.y + dy, 0, box.y + box.height - MIN_CROP_SIZE);
    height = box.height - (newY - box.y);
    y = newY;
  }
  if (mode === 'sw' || mode === 'se') {
    height = clamp01(box.height + dy, MIN_CROP_SIZE, 1 - box.y);
  }
  return { x, y, width, height };
}

/**
 * Redimensionare cu raport BLOCAT (o presetare aleasa, ex. 1:1/4:5/16:9) —
 * coltul opus celui tras (`anchor`) ramane fix. Bug real gasit de ESLint
 * (`no-unused-vars`, nu manual): o versiune anterioara calcula distanta pe
 * verticala dar n-o folosea niciodata — latimea se deriva DOAR din miscarea
 * orizontala, asa ca un drag predominant vertical nu avea niciun efect
 * vizibil cat timp raportul era blocat. Acum axa cu miscare mai mare
 * (|dx| vs |dy|) conduce redimensionarea, cealalta dimensiune derivandu-se
 * din `normR` (raportul width/height, deja normalizat la pixelii reali ai
 * pozei — vezi normalizedBoxRatio) — apoi perechea intreaga e scalata
 * UNIFORM (un singur factor, nu clamp secvential pe fiecare axa) daca
 * depaseste spatiul disponibil intre ancora si marginea cadrului, ca
 * raportul sa ramana exact, nu usor deformat.
 */
export function resizeCropLocked(box: CropBox, mode: Exclude<CropDragMode, 'move'>, dx: number, dy: number, normR: number): CropBox {
  const isLeftHandle = mode === 'nw' || mode === 'sw';
  const isTopHandle = mode === 'nw' || mode === 'ne';
  const anchorX = isLeftHandle ? box.x + box.width : box.x;
  const anchorY = isTopHandle ? box.y + box.height : box.y;
  const maxWidth = Math.max(MIN_CROP_SIZE, isLeftHandle ? anchorX : 1 - anchorX);
  const maxHeight = Math.max(MIN_CROP_SIZE, isTopHandle ? anchorY : 1 - anchorY);
  let width: number;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const rawCornerX = isLeftHandle ? box.x + dx : box.x + box.width + dx;
    width = Math.max(MIN_CROP_SIZE, Math.abs(rawCornerX - anchorX));
  } else {
    const rawCornerY = isTopHandle ? box.y + dy : box.y + box.height + dy;
    width = Math.max(MIN_CROP_SIZE, Math.abs(rawCornerY - anchorY)) * normR;
  }
  let height = width / normR;
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  width *= scale; height *= scale;
  return {
    x: isLeftHandle ? anchorX - width : anchorX,
    y: isTopHandle ? anchorY - height : anchorY,
    width, height
  };
}
