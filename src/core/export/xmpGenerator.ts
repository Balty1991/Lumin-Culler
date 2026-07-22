/**
 * core/export/xmpGenerator.ts
 * Sidecar-uri XMP — alternativa la copierea fisierelor imagine (exportPhotos.ts):
 * doar cateva sute de octeti per poza (nu megaocteti), fara sa dubleze spatiul
 * ocupat de originale. Lightroom/Bridge/Capture One le citesc automat DACA
 * sidecar-ul are exact numele originalului (doar extensia schimbata in .xmp)
 * si sta in ACELASI folder ca originalul — de aceea exportul XMP e mereu plat
 * (spre deosebire de exportOriginalFiles, care grupeaza pe subfoldere), ca sa
 * reflecte structura reala a folderului sursa al utilizatorului: aceste
 * fisiere trebuie copiate langa pozele originale, nu intr-o structura noua.
 *
 * Campuri XMP folosite — doar cele cu semantica standard, verificabila:
 *  - xmp:Rating: -1 = respinsa (conventia Lightroom pentru flag-ul "Reject"),
 *    0..5 = stele. NU folosim un camp non-standard gen "pick flag" separat
 *    (proprietar/ambiguu intre unelte) — rating + label acopera fluxul uzual
 *    de triaj foto.
 *  - xmp:Label: eticheta de culoare ("Green"/"Red"/"Yellow"), acelasi sistem
 *    de culori din Lightroom.
 * Acopera toate pozele DECISE (selectate/respinse/de verificat), nu doar cele
 * selectate — punctul central al exportului XMP e sa duca TOATE deciziile in
 * Lightroom fara sa copiezi vreun byte de imagine, nu doar selectia finala.
 */
import type { PhotoRecord } from '../db';
import { getDirectoryPicker, writeTextFile, downloadBlob, type LocalDirHandle } from './directoryPicker';

export type XmpDecision = Exclude<PhotoRecord['status'], 'pending'>;

const RATING: Record<XmpDecision, number> = { selected: 5, rejected: -1, review: 0 };
const LABEL: Record<XmpDecision, string> = { selected: 'Green', rejected: 'Red', review: 'Yellow' };

export function generateXMPSidecar(status: XmpDecision): string {
  const rating = RATING[status];
  const label = LABEL[status];
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Lumin Culler Pro">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmp:Rating="${rating}"
    xmp:Label="${label}">
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

function xmpFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return (dot > 0 ? fileName.slice(0, dot) : fileName) + '.xmp';
}

export interface XmpExportResult {
  exported: number;
  method: 'folder' | 'downloads';
  cancelled: boolean;
}

export async function exportXMPSidecars(
  photos: { fileName: string; status: PhotoRecord['status'] }[]
): Promise<XmpExportResult> {
  const decided = photos.filter((p): p is { fileName: string; status: XmpDecision } => p.status !== 'pending');
  const pickDirectory = getDirectoryPicker();
  const method: XmpExportResult['method'] = pickDirectory ? 'folder' : 'downloads';

  if (!decided.length) return { exported: 0, method, cancelled: false };

  if (pickDirectory) {
    let dir: LocalDirHandle;
    try {
      dir = await pickDirectory({ mode: 'readwrite' });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return { exported: 0, method, cancelled: true };
      throw err;
    }
    for (const p of decided) {
      await writeTextFile(dir, xmpFileName(p.fileName), generateXMPSidecar(p.status), 'application/rdf+xml');
    }
    return { exported: decided.length, method, cancelled: false };
  }

  for (const p of decided) {
    const blob = new Blob([generateXMPSidecar(p.status)], { type: 'application/rdf+xml' });
    await downloadBlob(xmpFileName(p.fileName), blob);
  }
  return { exported: decided.length, method, cancelled: false };
}
