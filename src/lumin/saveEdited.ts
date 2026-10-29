import { Directory, Filesystem } from '@capacitor/filesystem';
import { copyAlbumToPictures } from '../core/albumExport';
import { blobToBase64 } from './collage';

/** O poză făcută în Cherrypic (magie, text), salvată ca poză nouă în Pictures/Cherrypic/Editate. */
export async function saveEditedBlob(blob: Blob, prefix: string): Promise<boolean> {
  const name = `cherrypic-${prefix}-${Date.now()}.jpg`;
  const written = await Filesystem.writeFile({ path: name, data: await blobToBase64(blob), directory: Directory.Cache });
  const r = await copyAlbumToPictures('Editate', [{ uri: written.uri, name }]);
  return r.copied > 0;
}
