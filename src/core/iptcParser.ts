/**
 * core/iptcParser.ts
 * Parser IPTC-IIM minimal, direct pe octeti — completeaza "panoul de informatii
 * extins" (plan 3.2.2) cu metadatele IPTC legacy, distincte de EXIF (camera/GPS,
 * vezi exifParser.ts) si de XMP (scris de aceasta aplicatie la EXPORT, nu citit
 * la import). Multe fluxuri profesionale (agentii foto, Photo Mechanic, vechi
 * exporturi Lightroom) inca scriu IPTC-IIM, nu doar XMP.
 *
 * Structura: JPEG -> segment APP13 (marker 0xFFED) -> semnatura "Photoshop 3.0\0"
 * -> blocuri de resurse Photoshop "8BIM" -> resursa 0x0404 (IPTC-NAA record) ->
 * inregistrari IPTC-IIM (marcaj 0x1C, record, dataset, lungime, date).
 * Toate campurile din Record 2 (Application Record) — cel folosit de fotografi.
 */

export interface IptcData {
  /** Fotograf/autor (2:80, "By-line"). */
  byline?: string;
  /** Descriere/legenda (2:120, "Caption/Abstract"). */
  caption?: string;
  /** Titlu scurt (2:105, "Headline"; sau 2:5 "Object Name" ca fallback). */
  headline?: string;
  credit?: string;
  source?: string;
  copyright?: string;
  city?: string;
  country?: string;
  /** Repetabil (2:25) — poate aparea de mai multe ori in acelasi fisier. */
  keywords?: string[];
}

const IPTC_RECORD_APPLICATION = 2;
const DATASET_OBJECT_NAME = 5;
const DATASET_KEYWORDS = 25;
const DATASET_BYLINE = 80;
const DATASET_CITY = 90;
const DATASET_COUNTRY = 101;
const DATASET_HEADLINE = 105;
const DATASET_CREDIT = 110;
const DATASET_SOURCE = 115;
const DATASET_COPYRIGHT = 116;
const DATASET_CAPTION = 120;

const PHOTOSHOP_SIGNATURE = 'Photoshop 3.0\0';
const RESOURCE_TYPE_8BIM = 0x3842494d; // "8BIM"
const RESOURCE_ID_IPTC = 0x0404;

/** IPTC-IIM foloseste de obicei Latin-1/ASCII (setul de caractere UTF-8 explicit, marcat prin
    escape-ul 1:90, e rar in practica) — suficient pentru marea majoritate a fisierelor reale. */
function decodeIptcString(view: DataView, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s.trim();
}

/** Parcurge inregistrarile IPTC-IIM dintr-un bloc de date (resursa 0x0404). */
function parseIptcRecords(view: DataView, start: number, end: number): IptcData {
  const result: IptcData = {};
  const keywords: string[] = [];
  let offset = start;
  while (offset + 5 <= end) {
    if (view.getUint8(offset) !== 0x1c) { offset++; continue; }
    const record = view.getUint8(offset + 1);
    const dataset = view.getUint8(offset + 2);
    let length = view.getUint16(offset + 3, false);
    let dataStart = offset + 5;
    // lungime extinsa (rar): bitul inalt setat -> restul bitilor spun cati octeti urmeaza contin lungimea reala
    if (length & 0x8000) {
      const extBytes = length & 0x7fff;
      if (dataStart + extBytes > end) break;
      length = 0;
      for (let i = 0; i < extBytes; i++) length = length * 256 + view.getUint8(dataStart + i);
      dataStart += extBytes;
    }
    if (dataStart + length > end) break;
    if (record === IPTC_RECORD_APPLICATION) {
      const str = decodeIptcString(view, dataStart, length);
      switch (dataset) {
        case DATASET_BYLINE: result.byline = str; break;
        case DATASET_CAPTION: result.caption = str; break;
        case DATASET_HEADLINE: result.headline = str; break;
        case DATASET_CREDIT: result.credit = str; break;
        case DATASET_SOURCE: result.source = str; break;
        case DATASET_COPYRIGHT: result.copyright = str; break;
        case DATASET_CITY: result.city = str; break;
        case DATASET_COUNTRY: result.country = str; break;
        case DATASET_KEYWORDS: if (str) keywords.push(str); break;
        case DATASET_OBJECT_NAME: if (!result.headline) result.headline = str; break;
      }
    }
    offset = dataStart + length;
  }
  if (keywords.length) result.keywords = keywords;
  return result;
}

/** Cauta resursa 0x0404 (IPTC-NAA) printre blocurile "8BIM" din segmentul Photoshop. */
function findIptcBlock(view: DataView, start: number, end: number): { start: number; length: number } | null {
  let offset = start;
  while (offset + 12 <= end) {
    if (view.getUint32(offset) !== RESOURCE_TYPE_8BIM) { offset++; continue; }
    const resourceId = view.getUint16(offset + 4);
    const nameLen = view.getUint8(offset + 6);
    // pascal string (1 octet lungime + N octeti nume), padat la lungime PARA (inclusiv octetul de lungime)
    let nameEnd = offset + 6 + 1 + nameLen;
    if ((1 + nameLen) % 2 !== 0) nameEnd += 1;
    if (nameEnd + 4 > end) break;
    const dataLength = view.getUint32(nameEnd);
    const dataStart = nameEnd + 4;
    if (dataStart + dataLength > end) break;
    if (resourceId === RESOURCE_ID_IPTC) return { start: dataStart, length: dataLength };
    offset = dataStart + dataLength + (dataLength % 2); // datele sunt padate la lungime para
  }
  return null;
}

/** Parseaza IPTC-IIM dintr-un ArrayBuffer JPEG. Returneaza {} (nu arunca) daca nu exista/nu se poate citi. */
export function parseIptc(buffer: ArrayBuffer): IptcData {
  if (buffer.byteLength < 4) return {};
  const view = new DataView(buffer);
  if (view.getUint16(0) !== 0xffd8) return {}; // nu incepe cu SOI -> nu e JPEG

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    if ((marker & 0xff00) !== 0xff00) break; // structura de markere corupta
    if (marker === 0xffd8 || marker === 0xffd9 || marker === 0xff01 || (marker >= 0xffd0 && marker <= 0xffd7)) {
      offset += 2; // markere fara segment de date (RST0-7, SOI, EOI, TEM)
      if (marker === 0xffd9) break;
      continue;
    }
    if (offset + 4 > view.byteLength) break;
    const segmentLength = view.getUint16(offset + 2);
    if (marker === 0xffda) break; // start-of-scan -> ce urmeaza sunt date de imagine, nu mai cautam markere
    if (marker === 0xffed) {
      const segStart = offset + 4;
      const sigEnd = segStart + PHOTOSHOP_SIGNATURE.length;
      let matches = sigEnd <= view.byteLength;
      for (let i = 0; matches && i < PHOTOSHOP_SIGNATURE.length; i++) {
        if (view.getUint8(segStart + i) !== PHOTOSHOP_SIGNATURE.charCodeAt(i)) matches = false;
      }
      if (matches) {
        const segEnd = offset + 2 + segmentLength;
        const iptcBlock = findIptcBlock(view, sigEnd, segEnd);
        if (iptcBlock) return parseIptcRecords(view, iptcBlock.start, iptcBlock.start + iptcBlock.length);
      }
    }
    offset += 2 + segmentLength;
  }
  return {};
}
