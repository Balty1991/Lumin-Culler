import { blobToBase64 } from './base64';

/**
 * core/nativeImageSource.ts
 * Ce anume dam plugin-urilor native de analiza ca imagine de intrare.
 *
 * `uri` — un content:// din galeria telefonului. Imaginea nu mai trece deloc
 * prin punte: partea nativa o citeste singura din MediaStore, o decodeaza o
 * data si o refoloseste pentru toate modelele aceleiasi poze (vezi cache-ul
 * din android/.../plugins/BitmapUtils.kt). Asta e calea rapida, si e
 * disponibila pentru pozele aduse din galerie — adica exact importurile mari.
 *
 * `blob` — calea de dinainte: JPEG codat in JS, apoi base64, apoi JSON peste
 * punte, de fiecare data pentru fiecare model. Ramane necesara pentru pozele
 * care NU au un URI de galerie (selectorul de fisiere, RAW-uri decodate in JS)
 * si pe web, unde nu exista plugin nativ deloc.
 *
 * `maxSide` (doar cu `uri`) — cat de mare sa fie bitmapul decodat nativ.
 * Absent = valoarea implicita din BitmapUtils.kt. OCR-ul cere mai mult: e
 * singurul model care chiar depinde de pixeli, ca sa citeasca text mic.
 */
/** Decupaj normalizat 0..1. Îl consumă Image Embedder ca să înglobeze animalul, nu tot cadrul. */
export interface NormCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type NativeImageSource =
  | { blob: Blob; uri?: undefined; maxSide?: undefined; crop?: NormCrop }
  | { uri: string; maxSide?: number; blob?: undefined; crop?: NormCrop };

type CropParams = { cropX?: number; cropY?: number; cropW?: number; cropH?: number };

/** Forma exacta pe care o asteapta partea nativa (resolveInputBitmap in BitmapUtils.kt). */
export type NativeImageParams =
  | ({ imageBase64: string } & CropParams)
  | ({ imageUri: string; maxSide?: number } & CropParams);

function cropParams(crop: NormCrop | undefined): CropParams {
  if (!crop) return {};
  return { cropX: crop.x, cropY: crop.y, cropW: crop.w, cropH: crop.h };
}

/** Parametrii de trimis plugin-ului. Pe calea cu URI nu se codeaza nimic — de asta e ieftina. */
export async function nativeImageParams(
  source: NativeImageSource
): Promise<NativeImageParams> {
  const crop = cropParams(source.crop);
  if (source.uri !== undefined) {
    return source.maxSide !== undefined
      ? { imageUri: source.uri, maxSide: source.maxSide, ...crop }
      : { imageUri: source.uri, ...crop };
  }
  return { imageBase64: await blobToBase64(source.blob), ...crop };
}
