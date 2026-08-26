/**
 * core/base64.ts
 * Conversie Blob -> base64, extrasa din core/export/directoryPicker.ts ca sa
 * fie reutilizabila si de core/nativeFaceDetection.ts (bridge-ul Capacitor
 * catre plugin-urile native duce doar JSON, un Blob nu poate trece direct).
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // btoa(String.fromCharCode(...bytes)) arunca RangeError ("too many arguments") pe fisiere
  // mai mari (poze originale de cativa MB) — construim binary string-ul pe bucati.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

/**
 * base64 -> Blob. Drumul invers, pentru datele care vin DE LA partea nativa
 * (ex. HEIC-ul decodat de telefon, vezi core/nativeHeicDecoder.ts).
 *
 * Aceeasi grija cu bucatile ca mai sus, din acelasi motiv: `atob` intoarce un
 * binary string, iar transformarea lui in octeti dintr-o data ar duce la
 * acelasi RangeError pe fisiere de cativa MB.
 */
export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
