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
 *    0..5 = stele. Daca poza are un rating manual (1-5, axa separata de
 *    status — vezi PhotoRecord.rating), acela e scris; altfel cade pe
 *    conventia veche (5 pentru selectate, 0 pentru de verificat). O poza
 *    RESPINSA ramane -1 indiferent de rating — flag-ul de respingere are
 *    intotdeauna prioritate in Lightroom.
 *  - xmp:Label: eticheta de culoare ("Green"/"Red"/"Yellow"), acelasi sistem
 *    de culori din Lightroom.
 *  - dc:subject: keywords generate automat din ce a detectat deja AI-ul
 *    (numele persoanelor cunoscute + tipul de scena) — camp standard Dublin
 *    Core, citit de Lightroom/Bridge ca "Keywords"/"Subiect", util pentru
 *    cautare/filtrare ulterioara in acele aplicatii fara munca manuala.
 * Acopera toate pozele DECISE (selectate/respinse/de verificat), nu doar cele
 * selectate — punctul central al exportului XMP e sa duca TOATE deciziile in
 * Lightroom fara sa copiezi vreun byte de imagine, nu doar selectia finala.
 */
import type { PhotoRecord } from '../db';
import { getDirectoryPicker, writeTextFile, downloadBlob, downloadZip, type LocalDirHandle } from './directoryPicker';

export type XmpDecision = Exclude<PhotoRecord['status'], 'pending'>;

const RATING: Record<XmpDecision, number> = { selected: 5, rejected: -1, review: 0 };
const LABEL: Record<XmpDecision, string> = { selected: 'Green', rejected: 'Red', review: 'Yellow' };

const SCENE_KEYWORD: Record<string, string> = {
  portrait: 'Portret', child_portrait: 'Portret copil', group: 'Grup', family_group: 'Grup familie',
  landscape: 'Peisaj', detail: 'Detaliu'
};

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function generateXMPSidecar(status: XmpDecision, starRating?: number, keywords?: string[]): string {
  const rating = status === 'rejected' ? RATING.rejected : (starRating && starRating > 0 ? starRating : RATING[status]);
  const label = LABEL[status];
  const subject = keywords?.length
    ? `\n    <dc:subject>\n     <rdf:Bag>\n${keywords.map(k => `      <rdf:li>${xmlEscape(k)}</rdf:li>`).join('\n')}\n     </rdf:Bag>\n    </dc:subject>`
    : '';
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Lumin Culler Pro">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmp:Rating="${rating}"
    xmp:Label="${label}">${subject}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/** Keywords automate din ce a detectat deja AI-ul — fara input manual, doar reformatarea a ceea ce exista. */
export function deriveXmpKeywords(personNames: string[], sceneSemantic: string | undefined, sceneTags?: string[]): string[] {
  const keywords = [...personNames];
  if (sceneSemantic && SCENE_KEYWORD[sceneSemantic]) keywords.push(SCENE_KEYWORD[sceneSemantic]);
  if (sceneTags?.length) keywords.push(...sceneTags);
  return keywords;
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
  photos: { fileName: string; status: PhotoRecord['status']; rating?: number; keywords?: string[] }[]
): Promise<XmpExportResult> {
  const decided = photos.filter(
    (p): p is { fileName: string; status: XmpDecision; rating?: number; keywords?: string[] } => p.status !== 'pending'
  );
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
      await writeTextFile(dir, xmpFileName(p.fileName), generateXMPSidecar(p.status, p.rating, p.keywords), 'application/rdf+xml');
    }
    return { exported: decided.length, method, cancelled: false };
  }

  // un singur sidecar: descarcare directa
  if (decided.length === 1) {
    const p = decided[0];
    const blob = new Blob([generateXMPSidecar(p.status, p.rating, p.keywords)], { type: 'application/rdf+xml' });
    await downloadBlob(xmpFileName(p.fileName), blob);
    return { exported: 1, method, cancelled: false };
  }
  // mai multe sidecar-uri: O SINGURA descarcare .zip — vezi downloadZip pentru
  // motivul (descarcarile multiple secventiale sunt blocate silentios de multe
  // browsere mobile dupa prima)
  const encoder = new TextEncoder();
  const entries = decided.map(p => ({
    path: xmpFileName(p.fileName),
    data: encoder.encode(generateXMPSidecar(p.status, p.rating, p.keywords))
  }));
  const zipName = `lumin-culler-xmp-${new Date().toISOString().slice(0, 10)}.zip`;
  await downloadZip(zipName, entries);
  return { exported: decided.length, method, cancelled: false };
}
