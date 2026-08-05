/**
 * core/nativeTextRecognition.ts
 * Analiza AI nativa (Faza 5) — punte catre plugin-ul Capacitor local
 * TextRecognition (vezi android/app/src/main/java/com/luminculler/app/plugins/
 * TextRecognitionPlugin.kt), OCR Google ML Kit (script Latin, acopera romana).
 *
 * Scop: textul dens/aliniat e un semnal puternic ca o poza e de fapt un
 * document/o captura de ecran — direct relevant pentru bug-ul reparat mai
 * devreme in sesiune (documente aprobate automat, pentru ca nici COCO nici
 * ImageNet nu recunosc "document"). `textCoverage` ramane NECONECTAT la
 * decidePhotoStatus (core/importPipeline.ts) — o faza viitoare de conectare,
 * dupa validare pe device real.
 *
 * La fel ca celelalte native*.ts (Faza 1-4): doar dovedeste ca portul
 * functioneaza pe un device real.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { blobToBase64 } from './base64';

export interface NativeTextBlock {
  text: string;
  box: { left: number; top: number; width: number; height: number };
}

export interface NativeTextRecognitionResult {
  blocks: NativeTextBlock[];
  /** Fractiune 0..1 din cadru acoperita de cutii de text (aproximare prin suma ariilor, nu o uniune reala). */
  textCoverage: number;
}

interface TextRecognitionPluginApi {
  detectText(options: { imageBase64: string }): Promise<NativeTextRecognitionResult>;
}

const TextRecognitionNative = registerPlugin<TextRecognitionPluginApi>('TextRecognition');

/** Sigur de apelat si pe web — registerPlugin() nu esueaza la incarcare, doar la apelul efectiv al unei metode. */
export function isNativeTextRecognitionAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('TextRecognition');
}

export async function detectTextNative(imageBlob: Blob): Promise<NativeTextRecognitionResult> {
  if (!isNativeTextRecognitionAvailable()) {
    throw new Error('Recunoasterea nativa de text e disponibila doar in aplicatia Android (Capacitor), nu in browser.');
  }
  const imageBase64 = await blobToBase64(imageBlob);
  return TextRecognitionNative.detectText({ imageBase64 });
}
