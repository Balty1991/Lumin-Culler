/**
 * core/export/nativeFolderExport.ts
 * Punte catre plugin-ul Capacitor local FolderExport (vezi android/app/src/main/
 * java/com/luminculler/app/plugins/FolderExportPlugin.kt) — export in FOLDERE
 * REALE pe Android, prin Storage Access Framework.
 *
 * Cerinta directa a utilizatorului ("la export folder, salveaza doar poza, nu si
 * folderul creat"): foaia de partajare nativa preda UN SINGUR fisier aplicatiei
 * care il primeste, deci prefixul de folder ("Ami/IMG_0001.jpg") era aruncat, iar
 * gruparea pe persoane/scena supravietuia doar in arhiva .zip a exporturilor cu
 * mai multe poze. Cu SAF, Android se comporta ca desktop-ul: utilizatorul alege
 * destinatia si pozele ajung direct in subfoldere reale.
 *
 * Adaptorul de mai jos imbraca plugin-ul in EXACT aceeasi forma (LocalDirHandle)
 * pe care o intoarce deja showDirectoryPicker pe desktop — asa, exportul
 * (core/exportPhotos.ts, copyToDirectory) nu are nevoie de nicio ramura noua
 * "daca e Android": aceeasi bucla scrie in ambele cazuri, si tot restul
 * (method: 'folder', grouped: true, mesajul de succes) devine corect automat.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { blobToBase64 } from '../base64';
import type { LocalDirHandle, LocalFileHandle, LocalWritable } from './directoryPicker';

interface FolderExportPluginApi {
  pickDirectory(): Promise<{ cancelled: boolean; treeUri?: string; rootDocUri?: string }>;
  ensureDirectory(options: { treeUri: string; parentDocUri: string; name: string }): Promise<{ docUri: string }>;
  writeFile(options: { parentDocUri: string; name: string; data: string; mime: string }): Promise<{ uri: string }>;
}

const FolderExportNative = registerPlugin<FolderExportPluginApi>('FolderExport');

/**
 * Semnal de anulare de la selectorul nativ de folder. Un tip propriu (nu un
 * DOMException AbortError ca pe web) fiindca aici anularea e NEECHIVOCA — vine
 * ca `{ cancelled: true }` de la o activitate reala a sistemului, deci nu are
 * nevoie de euristica de timp folosita pe web ca sa distinga o anulare adevarata
 * de un API expus dar nefunctional (vezi isRealUserCancel in directoryPicker.ts).
 */
export class ExportCancelledError extends Error {
  constructor() {
    super('Selectorul de folder a fost inchis fara nicio alegere.');
    this.name = 'ExportCancelledError';
  }
}

/** Sigur de apelat si pe web — registerPlugin() nu esueaza la incarcare, doar la apelul efectiv al unei metode. */
export function isNativeFolderExportAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('FolderExport');
}

function fileHandle(parentDocUri: string, name: string, mime: string): LocalFileHandle {
  return {
    async createWritable(): Promise<LocalWritable> {
      // Acumulam bucatile si scriem O SINGURA data, la close(): puntea Capacitor
      // duce doar JSON (base64), deci fiecare write() ar insemna alt fisier, nu o
      // continuare a aceluiasi. In practica exportul cheama write() exact o data
      // per fisier (vezi copyToDirectory), dar contractul LocalWritable permite
      // mai multe, iar un Blob compus le acopera pe toate fara cazuri speciale.
      const parts: Blob[] = [];
      return {
        async write(data: Blob) { parts.push(data); },
        async close() {
          const blob = parts.length === 1 ? parts[0] : new Blob(parts, { type: mime });
          // Tipul dedus din NUME, nu blob.type: numele e ce a cerut utilizatorul, iar
          // un blob poate veni cu un tip gol sau proprietar (RAW) pe care providerul
          // SAF nu l-ar recunoaste — vezi mimeFromName.
          await FolderExportNative.writeFile({ parentDocUri, name, data: await blobToBase64(blob), mime });
        }
      };
    }
  };
}

function dirHandle(treeUri: string, docUri: string): LocalDirHandle {
  return {
    async getDirectoryHandle(name: string): Promise<LocalDirHandle> {
      const { docUri: childUri } = await FolderExportNative.ensureDirectory({ treeUri, parentDocUri: docUri, name });
      return dirHandle(treeUri, childUri);
    },
    async getFileHandle(name: string): Promise<LocalFileHandle> {
      // Fisierul e creat efectiv abia la close() (SAF are nevoie de tipul MIME si
      // creeaza documentul dintr-un singur apel) — de aceea handle-ul e lenes.
      return fileHandle(docUri, name, mimeFromName(name));
    }
  };
}

/**
 * SAF foloseste tipul MIME la crearea documentului, iar unii provideri (inclusiv
 * "Fisiere" de la Google) ii adauga o extensie pe baza lui — un
 * "application/octet-stream" ar transforma "IMG_0001.jpg" in "IMG_0001.jpg.bin".
 * Deducem tipul din extensie ca numele exportat sa ramana EXACT cel cerut.
 */
function mimeFromName(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic' || ext === 'heif') return `image/${ext}`;
  if (ext === 'xmp' || ext === 'xml') return 'application/xml';
  if (ext === 'json') return 'application/json';
  if (ext === 'html') return 'text/html';
  if (ext === 'zip') return 'application/zip';
  // RAW si orice altceva: niciun tip standard de incredere, dar tot trebuie sa
  // ramana un fisier binar opac — extensia originala e deja in nume.
  return 'application/octet-stream';
}

/**
 * Deschide selectorul nativ de folder si intoarce destinatia aleasa in forma
 * LocalDirHandle. Arunca ExportCancelledError daca utilizatorul o inchide.
 */
export async function pickNativeDirectory(): Promise<LocalDirHandle> {
  const result = await FolderExportNative.pickDirectory();
  if (result.cancelled || !result.treeUri || !result.rootDocUri) throw new ExportCancelledError();
  return dirHandle(result.treeUri, result.rootDocUri);
}
