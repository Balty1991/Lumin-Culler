import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { copyAlbumToPictures } from '../core/albumExport';
import { blobToBase64 } from './collage';

/** O poză făcută în Cherrypic (magie, text), salvată ca poză nouă în Pictures/Cherrypic/Editate. */
export async function saveEditedBlob(blob: Blob, prefix: string, ext = 'jpg'): Promise<boolean> {
  const name = `cherrypic-${prefix}-${Date.now()}.${ext}`;
  // În browser nu există galeria telefonului: poza se descarcă (înainte dădea „N-a mers”).
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return true;
  }
  const written = await Filesystem.writeFile({ path: name, data: await blobToBase64(blob), directory: Directory.Cache });
  const r = await copyAlbumToPictures('Editate', [{ uri: written.uri, name }]);
  return r.copied > 0;
}
