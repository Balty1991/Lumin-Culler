/**
 * core/nativeImageEmbedder.ts
 * Analiza AI nativa (Faza 6) — punte catre plugin-ul Capacitor local
 * ImageEmbedder (vezi android/app/src/main/java/com/luminculler/app/plugins/
 * ImageEmbedderPlugin.kt), embedding general de similaritate vizuala
 * (continut, NU identitate/biometrie) — MediaPipe Image Embedder +
 * MobileNetV3-small.
 *
 * De ce util: hashCompare.worker.ts foloseste deja un al doilea semnal
 * (similaritate cosinus a embedding-urilor de fata) ca sa rafineze grupurile
 * de rafale/duplicate gasite prin dHash — dar DOAR cand exista fete. Rafale
 * fara oameni (peisaje, animale) cad azi pe un semnal mult mai slab. Acest
 * embedding general ar da acelasi tip de "a doua opinie" si pentru poze fara
 * fete — NECONECTAT inca de acea logica, doar dovedit ca functioneaza.
 *
 * La fel ca celelalte native*.ts (Faza 1-5): doar dovedeste ca portul
 * functioneaza pe un device real.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { blobToBase64 } from './base64';

export interface NativeImageEmbeddingResult {
  embedding: number[];
}

interface ImageEmbedderPluginApi {
  embedImage(options: { imageBase64: string }): Promise<NativeImageEmbeddingResult>;
}

const ImageEmbedderNative = registerPlugin<ImageEmbedderPluginApi>('ImageEmbedder');

/** Sigur de apelat si pe web — registerPlugin() nu esueaza la incarcare, doar la apelul efectiv al unei metode. */
export function isNativeImageEmbedderAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ImageEmbedder');
}

export async function embedImageNative(imageBlob: Blob): Promise<NativeImageEmbeddingResult> {
  if (!isNativeImageEmbedderAvailable()) {
    throw new Error('Embedding-ul nativ de imagine e disponibil doar in aplicatia Android (Capacitor), nu in browser.');
  }
  const imageBase64 = await blobToBase64(imageBlob);
  return ImageEmbedderNative.embedImage({ imageBase64 });
}
