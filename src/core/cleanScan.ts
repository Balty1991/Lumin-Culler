/**
 * core/cleanScan.ts
 * Coșurile de curățat, din rândurile pe care le întoarce scanarea de pe telefon
 * sau din pozele deja analizate în bibliotecă.
 *
 * Regulile stau aici, nu în Kotlin, ca să poată fi verificate fără un telefon:
 * aceeași funcție decide și ecranul, și testele. Partea nativă doar măsoară
 * (mărime, dosar, amprentă pe felii, varianța de claritate) și nu alege ce se
 * șterge.
 *
 * Un element intră într-un singur coș. Ordinea e cea în care se eliberează
 * spațiu fără să arunci cadrul pe care l-ai păstra: extra-urile din duplicate,
 * apoi extra-urile din rafală, apoi neclarele rămase, apoi capturile, apoi
 * dosarele de mesagerie. Videoclipurile sunt un alt mediu și nu concurează
 * cu pozele.
 */

export const BURST_GAP_MS = 2500;
export const BURST_MIN_FRAMES = 3;
/** Sub varianța asta, miniatura de 48px e mișcată. Aceeași cifră e folosită la scanarea nativă. */
export const BLUR_VARIANCE_MAX = 80;
export const LARGE_VIDEO_BYTES = 50 * 1024 * 1024;

export type BasketId = 'duplicates' | 'bursts' | 'blurry' | 'screenshots' | 'messengers' | 'eyes' | 'videos';

export interface CleanImageRow {
  uri: string;
  name: string;
  bytes: number;
  width: number;
  height: number;
  taken: number;
  bucket: string;
  hash: string | null;
  /** Varianța Laplacian pe miniatură. null = nu s-a măsurat. */
  blur: number | null;
}

export interface CleanVideoRow {
  uri: string;
  name: string;
  bytes: number;
  width: number;
  height: number;
  durationMs: number;
}

export interface CleanItem {
  uri: string;
  name: string;
  bytes: number;
  taken: number;
  width: number;
  height: number;
  durationMs?: number;
  /** Id-ul din biblioteca aplicației, când coșul vine din poze deja importate. */
  photoId?: string;
}

export interface CleanBasket {
  id: BasketId;
  items: CleanItem[];
  bytes: number;
}

const SCREENSHOT_RE = /screenshot|screen[\s_-]?shots?|capturi|bildschirmfoto|bildschirmaufnahme|capturas? de pantalla|screen\s*captures?/i;
const MESSENGER_RE = /whatsapp|telegram|messenger|signal|viber/i;

export function isScreenshotBucket(name: string): boolean {
  return SCREENSHOT_RE.test(name);
}

export function isMessengerBucket(name: string): boolean {
  return MESSENGER_RE.test(name);
}

function itemOf(row: CleanImageRow): CleanItem {
  return {
    uri: row.uri,
    name: row.name,
    bytes: Math.max(0, row.bytes),
    taken: row.taken,
    width: row.width,
    height: row.height
  };
}

function basket(id: BasketId, items: CleanItem[]): CleanBasket {
  return { id, items, bytes: items.reduce((sum, item) => sum + item.bytes, 0) };
}

function duplicateKey(row: CleanImageRow): string {
  // Fără amprentă nu sunt duplicate. Două cadre dintr-o rafală pot avea aceeași
  // mărime și aceleași dimensiuni fără să fie același fișier. Amprenta o pune
  // scanarea doar când două fișiere chiar împart mărimea.
  if (!row.hash || row.bytes <= 0) return '';
  return `h:${row.bytes}:${row.hash}`;
}

/**
 * Cât s-ar câștiga, aproximativ, comprimând un videoclip la 720p / ~2,5 Mbps.
 *
 * E o estimare arătată înainte de Premium, nu o promisiune. După comprimare,
 * ecranul arată diferența reală de mărime. Peste 85% nu promitem niciodată:
 * un clip deja mic nu se face de zece ori mai mic doar pentru că am apăsat.
 */
export function estimateSavedBytes(bytes: number, width: number, height: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  const longEdge = Math.max(width, height);
  const scale = longEdge > 0 ? Math.min(1, 720 / longEdge) : 1;
  const ratio = Math.min(0.85, Math.max(0.15, 1 - scale * scale * 0.55));
  return Math.round(bytes * ratio);
}

export function basketsFromScan(images: readonly CleanImageRow[], videos: readonly CleanVideoRow[]): CleanBasket[] {
  const claimed = new Set<string>();
  const claim = (rows: CleanImageRow[]) => {
    const items: CleanItem[] = [];
    for (const row of rows) {
      if (claimed.has(row.uri)) continue;
      claimed.add(row.uri);
      items.push(itemOf(row));
    }
    return items;
  };

  const duplicateExtras: CleanImageRow[] = [];
  const byKey = new Map<string, CleanImageRow[]>();
  for (const row of images) {
    const key = duplicateKey(row);
    if (!key) continue;
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const ranked = [...group].sort((a, b) => b.taken - a.taken || b.bytes - a.bytes);
    // Copia păstrată nu mai intră și la capturi sau neclare: un fișier, un coș.
    claimed.add(ranked[0].uri);
    duplicateExtras.push(...ranked.slice(1));
  }

  const burstExtras: CleanImageRow[] = [];
  const burstMembers = new Set<string>();
  const burstCandidates = images
    .filter(row => row.taken > 0 && !isScreenshotBucket(row.bucket))
    .sort((a, b) => a.taken - b.taken || a.uri.localeCompare(b.uri));
  let cluster: CleanImageRow[] = [];
  const flush = () => {
    if (cluster.length >= BURST_MIN_FRAMES) {
      const keeper = [...cluster].sort((a, b) => {
        const blurA = a.blur ?? -1;
        const blurB = b.blur ?? -1;
        if (blurA !== blurB) return blurB - blurA;
        return b.bytes - a.bytes;
      })[0];
      for (const row of cluster) {
        burstMembers.add(row.uri);
        if (row.uri !== keeper.uri) burstExtras.push(row);
      }
    }
    cluster = [];
  };
  for (const row of burstCandidates) {
    const prev = cluster[cluster.length - 1];
    if (prev && (row.bucket !== prev.bucket || row.taken - prev.taken > BURST_GAP_MS)) flush();
    cluster.push(row);
  }
  flush();

  const blurry = images.filter(row =>
    row.blur !== null && row.blur < BLUR_VARIANCE_MAX &&
    !isScreenshotBucket(row.bucket) && !burstMembers.has(row.uri)
  );
  const screenshots = images.filter(row => isScreenshotBucket(row.bucket));
  const messengers = images.filter(row => isMessengerBucket(row.bucket) && !isScreenshotBucket(row.bucket));

  const largeVideos = videos
    .filter(video => video.bytes >= LARGE_VIDEO_BYTES)
    .sort((a, b) => b.bytes - a.bytes)
    .map((video): CleanItem => ({
      uri: video.uri,
      name: video.name,
      bytes: video.bytes,
      taken: 0,
      width: video.width,
      height: video.height,
      durationMs: video.durationMs
    }));

  return [
    basket('duplicates', claim(duplicateExtras)),
    basket('bursts', claim(burstExtras)),
    basket('blurry', claim(blurry)),
    basket('screenshots', claim(screenshots)),
    basket('messengers', claim(messengers)),
    basket('videos', largeVideos)
  ];
}

/** Ce poate citi gruparea dintr-o poză deja analizată în aplicație. */
export interface LibraryCleanPhoto {
  id: string;
  fileName: string;
  mediaUri?: string;
  sizeBytes?: number;
  capturedAt?: number;
  sharpness: number;
  faceCount: number;
  allEyesOpen: boolean;
  groupEyesOpenRatio?: number;
  groupId?: string;
  sceneTags?: string[];
  status: string;
  /** Pragul de claritate folosit de motor, ca să nu existe două definiții de „neclar”. */
  blurBelow: number;
  eyesOpenBelow: number;
}

function libraryItem(photo: LibraryCleanPhoto): CleanItem {
  return {
    uri: photo.mediaUri || `app:${photo.id}`,
    name: photo.fileName,
    bytes: photo.sizeBytes ?? 0,
    taken: photo.capturedAt ?? 0,
    width: 0,
    height: 0,
    photoId: photo.id
  };
}

function eyesClosed(photo: LibraryCleanPhoto): boolean {
  if (photo.faceCount <= 0) return false;
  if (photo.groupEyesOpenRatio !== undefined) return photo.groupEyesOpenRatio < photo.eyesOpenBelow;
  return !photo.allEyesOpen;
}

/**
 * Coșuri din biblioteca deja analizată, când telefonul n-a putut fi scanat
 * (web) sau pe lângă scanare, pentru ochii închiși — semnal pe care o
 * scanare de metadate nu îl are.
 *
 * Seriile de aici sunt groupId-ul motorului (rafală sau aproape-duplicate),
 * nu o potrivire de mărime: două cadre din aceeași rafală nu au același număr
 * de octeți. Se păstrează cadrul cu claritatea cea mai mare.
 */
export function basketsFromLibrary(photos: readonly LibraryCleanPhoto[]): CleanBasket[] {
  const open = photos.filter(photo => photo.status !== 'rejected');
  const claimed = new Set<string>();
  const take = (photo: LibraryCleanPhoto): CleanItem | null => {
    if (claimed.has(photo.id)) return null;
    claimed.add(photo.id);
    return libraryItem(photo);
  };

  const burstExtras: CleanItem[] = [];
  const byGroup = new Map<string, LibraryCleanPhoto[]>();
  for (const photo of open) {
    if (!photo.groupId) continue;
    const list = byGroup.get(photo.groupId);
    if (list) list.push(photo);
    else byGroup.set(photo.groupId, [photo]);
  }
  for (const group of byGroup.values()) {
    if (group.length < 2) continue;
    const keeper = [...group].sort((a, b) => b.sharpness - a.sharpness || (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0))[0];
    for (const photo of group) {
      if (photo.id === keeper.id) { claimed.add(photo.id); continue; }
      const item = take(photo);
      if (item) burstExtras.push(item);
    }
  }

  const blurry: CleanItem[] = [];
  const screenshots: CleanItem[] = [];
  const eyes: CleanItem[] = [];
  for (const photo of open) {
    const shot = (photo.sceneTags ?? []).some(tag => /screenshot/i.test(tag));
    if (shot) {
      const item = take(photo);
      if (item) screenshots.push(item);
      continue;
    }
    if (photo.sharpness < photo.blurBelow) {
      const item = take(photo);
      if (item) blurry.push(item);
      continue;
    }
    if (eyesClosed(photo)) {
      const item = take(photo);
      if (item) eyes.push(item);
    }
  }

  return [
    basket('duplicates', []),
    basket('bursts', burstExtras),
    basket('blurry', blurry),
    basket('screenshots', screenshots),
    basket('messengers', []),
    basket('eyes', eyes),
    basket('videos', [])
  ];
}
