/**
 * „Exportă ca album” copiază. Nu mută și nu redenumește fișierul din galerie.
 *
 * Destinația, pe telefon: Pictures/Lumin/<album>, prin MediaStore. Sursa
 * rămâne content://-ul de unde s-a citit.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { albumFolderName } from './albums';

interface AlbumCopyPlugin {
  copyIntoLuminAlbum(options: { album: string; uris: string[]; names: string[] }): Promise<{ copied: number; skipped: number }>;
}

const FolderExport = registerPlugin<AlbumCopyPlugin>('FolderExport');

export function canCopyAlbumOnDevice(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('FolderExport');
}

export async function copyAlbumToPictures(
  album: string,
  items: { uri: string; name: string }[]
): Promise<{ copied: number; skipped: number }> {
  const withUri = items.filter(item => item.uri);
  if (!withUri.length) return { copied: 0, skipped: items.length };
  if (!canCopyAlbumOnDevice()) {
    throw new Error('Exportul în Pictures/Lumin rulează pe telefon.');
  }
  const result = await FolderExport.copyIntoLuminAlbum({
    album: albumFolderName(album),
    uris: withUri.map(item => item.uri),
    names: withUri.map(item => item.name)
  });
  return {
    copied: result.copied,
    skipped: result.skipped + (items.length - withUri.length)
  };
}
