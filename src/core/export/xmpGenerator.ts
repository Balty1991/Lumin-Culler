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

/**
 * Extindere export XMP (plan 2.3.5): scorul AI, factorii de decizie si id-ul
 * de serie/grup, in plus fata de rating/eticheta/keywords. Namespace-ul
 * `lc:` e propriu aplicatiei (necunoscut de Lightroom/Capture One, care il
 * ignora fara probleme — un cititor XMP standard nu esueaza pe un namespace
 * strain) — util pentru scripturi/integrari proprii sau versiuni viitoare
 * ale pluginurilor Lightroom/Capture One care STIU sa il citeasca. Scorul si
 * seria sunt insa aduse SI ca dc:subject keywords (vezi deriveXmpKeywords mai
 * jos), fiindca acelea CHIAR sunt cautabile/filtrabile azi, direct din UI-ul
 * Lightroom — spre deosebire de un camp XMP arbitrar, pe care Lightroom nu
 * stie sa-l afiseze/filtreze fara un plugin dedicat.
 */
export interface XmpAiMeta {
  aiScore?: number;
  /** etichete lizibile ale factorilor de decizie (explainFactors) — ex. "Claritate (+)", "Ochi inchisi (-)". */
  aiFactors?: string[];
  groupId?: string;
  /**
   * Metadate personalizate de proiect (plan 2.3.5, state/projectMetadata.ts).
   * `location` foloseste photoshop:Location (camp STANDARD, afisat/cautabil
   * direct in panoul de metadate Lightroom — nu namespace-ul propriu `lc:`) si
   * `event` foloseste Iptc4xmpExt:Event (extensia standard IPTC). Pentru
   * `client` nu exista un camp XMP universal recunoscut — ramane in `lc:`.
   */
  client?: string;
  event?: string;
  location?: string;
}

export function generateXMPSidecar(status: XmpDecision, starRating?: number, keywords?: string[], ai?: XmpAiMeta): string {
  const rating = status === 'rejected' ? RATING.rejected : (starRating && starRating > 0 ? starRating : RATING[status]);
  const label = LABEL[status];
  const subject = keywords?.length
    ? `\n    <dc:subject>\n     <rdf:Bag>\n${keywords.map(k => `      <rdf:li>${xmlEscape(k)}</rdf:li>`).join('\n')}\n     </rdf:Bag>\n    </dc:subject>`
    : '';
  const aiScoreAttr = ai?.aiScore !== undefined ? `\n    lc:AIScore="${Math.round(ai.aiScore)}"` : '';
  const groupIdAttr = ai?.groupId ? `\n    lc:SeriesId="${xmlEscape(ai.groupId)}"` : '';
  const clientAttr = ai?.client ? `\n    lc:Client="${xmlEscape(ai.client)}"` : '';
  const aiFactors = ai?.aiFactors?.length
    ? `\n    <lc:AIFactors>\n     <rdf:Bag>\n${ai.aiFactors.map(f => `      <rdf:li>${xmlEscape(f)}</rdf:li>`).join('\n')}\n     </rdf:Bag>\n    </lc:AIFactors>`
    : '';
  // camp standard, recunoscut de Lightroom (panoul de metadate "Locatie") — nu namespace-ul propriu lc:
  const location = ai?.location ? `\n    <photoshop:Location>${xmlEscape(ai.location)}</photoshop:Location>` : '';
  // extensia standard IPTC pentru evenimente
  const event = ai?.event ? `\n    <Iptc4xmpExt:Event>${xmlEscape(ai.event)}</Iptc4xmpExt:Event>` : '';
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Lumin Culler Pro">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
    xmlns:lc="https://luminculler.app/xmp/1.0/"
    xmp:Rating="${rating}"
    xmp:Label="${label}"${aiScoreAttr}${groupIdAttr}${clientAttr}>${subject}${aiFactors}${location}${event}
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

/**
 * Cuantizat pe decile ("IA 80-89"), nu scorul brut — un keyword per scor exact
 * (ex. "IA 87") ar fragmenta cautarea in Lightroom in sute de etichete unice,
 * fiecare aparuta la 1-2 poze; pe decile, "IA 80-89" grupeaza util un numar
 * rezonabil de poze similar de bune, cautabil direct din panoul de Keywords.
 */
export function deriveAiScoreKeyword(aiScore: number): string {
  const bucket = Math.max(0, Math.min(90, Math.floor(aiScore / 10) * 10));
  return `IA ${bucket}-${bucket + 9}`;
}

/** Keyword de serie/grup — cauti "Serie g-xxxxxxxx" in Lightroom ca sa gasesti instant restul cadrelor din acelasi burst. */
export function deriveSeriesKeyword(groupId: string): string {
  return `Serie ${groupId}`;
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

export interface XmpPhotoInput {
  fileName: string;
  status: PhotoRecord['status'];
  rating?: number;
  keywords?: string[];
  aiScore?: number;
  aiFactors?: string[];
  groupId?: string;
  client?: string;
  event?: string;
  location?: string;
}

export async function exportXMPSidecars(photos: XmpPhotoInput[]): Promise<XmpExportResult> {
  const decided = photos.filter(
    (p): p is XmpPhotoInput & { status: XmpDecision } => p.status !== 'pending'
  );
  const pickDirectory = getDirectoryPicker();
  const method: XmpExportResult['method'] = pickDirectory ? 'folder' : 'downloads';

  if (!decided.length) return { exported: 0, method, cancelled: false };

  const render = (p: XmpPhotoInput & { status: XmpDecision }) =>
    generateXMPSidecar(p.status, p.rating, p.keywords, {
      aiScore: p.aiScore, aiFactors: p.aiFactors, groupId: p.groupId,
      client: p.client, event: p.event, location: p.location
    });

  if (pickDirectory) {
    let dir: LocalDirHandle;
    try {
      dir = await pickDirectory({ mode: 'readwrite' });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return { exported: 0, method, cancelled: true };
      throw err;
    }
    for (const p of decided) {
      await writeTextFile(dir, xmpFileName(p.fileName), render(p), 'application/rdf+xml');
    }
    return { exported: decided.length, method, cancelled: false };
  }

  // un singur sidecar: descarcare directa
  if (decided.length === 1) {
    const p = decided[0];
    const blob = new Blob([render(p)], { type: 'application/rdf+xml' });
    await downloadBlob(xmpFileName(p.fileName), blob);
    return { exported: 1, method, cancelled: false };
  }
  // mai multe sidecar-uri: O SINGURA descarcare .zip — vezi downloadZip pentru
  // motivul (descarcarile multiple secventiale sunt blocate silentios de multe
  // browsere mobile dupa prima)
  const encoder = new TextEncoder();
  const entries = decided.map(p => ({
    path: xmpFileName(p.fileName),
    data: encoder.encode(render(p))
  }));
  const zipName = `lumin-culler-xmp-${new Date().toISOString().slice(0, 10)}.zip`;
  await downloadZip(zipName, entries);
  return { exported: decided.length, method, cancelled: false };
}
