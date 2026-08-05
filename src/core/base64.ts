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
