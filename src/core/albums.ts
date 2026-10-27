/**
 * Albume virtuale, construite din ce știe deja scanarea.
 *
 * Nu mută și nu redenumește nimic în galerie. Un album e o listă de id-uri.
 * Deschiderea ecranului e singurul moment în care se grupează — după ce
 * primul rezultat e deja pe ecran, nu în treapta 1.
 */
import { classifyPhoto, type InboxCandidate } from './smartInbox';
import { findUnnamedPetClusters, isAnimalTag } from './petIdentity';

export interface AlbumPhoto {
  id: string;
  fileName: string;
  capturedAt?: number;
  status: string;
  groupId?: string;
  aiScore: number;
  faceCount: number;
  personNames: string[];
  sceneTags?: string[];
  textCoverage?: number;
  width?: number;
  height?: number;
  gpsLatitude?: number;
  gpsLongitude?: number;
  /** Pus deoparte la import (bon, factură, captură). */
  aside?: string;
  /** Specia, când background-ul a decupat animalul. */
  petLabel?: string;
  /** Numele dat de om. Absent cât timp grupul e încă „Numește”. */
  petName?: string;
  /** Embeddingul decupajului. Nu e pe pozele care au doar eticheta de specie. */
  petEmbedding?: number[];
}

/** Etichete care spun doar „e un animal”, nu care. */
const GENERIC_ANIMAL_LABELS = new Set(['pet', 'animal', 'mammal', 'vertebrate']);
/** Sub atâtea poze, un album de animal e o etichetă greșită, nu un animal. */
export const MIN_ANIMAL_PHOTOS = 3;
/** Sub atâtea poze, nu e un eveniment. */
export const MIN_EVENT_PHOTOS = 3;

/** Peste 6 ore, e altă ieșire. */
const EVENT_GAP_MS = 6 * 60 * 60 * 1000;
/** Peste 30 km și măcar 45 de minute, e alt loc, chiar dacă pauza e mai scurtă de 6 ore. */
const TRAVEL_KM = 30;
const TRAVEL_GAP_MS = 45 * 60 * 1000;

export interface PersonAlbum {
  name: string;
  photoIds: string[];
  from?: number;
  to?: number;
  selectedIds: string[];
  seriesCount: number;
  duplicateCount: number;
}

export interface AnimalAlbum {
  label: string;
  photoIds: string[];
  latestAt?: number;
}

export interface EventAlbum {
  id: string;
  title: string;
  photoIds: string[];
  selectedCount: number;
  start: number;
  end: number;
}

export interface NamedPetAlbum extends PersonAlbum {
  label: string;
}

export interface UnnamedPetCluster {
  label: string;
  photoIds: string[];
}

export interface BuiltAlbums {
  people: PersonAlbum[];
  /** Poze cu fețe cărora nu li s-a dat încă un nume. */
  unnamedPhotoIds: string[];
  animals: AnimalAlbum[];
  /** Același animal, deja numit. */
  namedPets: NamedPetAlbum[];
  /** Grupuri de același animal, încă fără nume. */
  unnamedPets: UnnamedPetCluster[];
  events: EventAlbum[];
  screenshots: string[];
  documents: string[];
}

function animalLabels(tags: string[] | undefined): string[] {
  const out: string[] = [];
  for (const tag of tags ?? []) {
    const key = tag.trim().toLowerCase();
    if (isAnimalTag(key) && !out.includes(key)) out.push(key);
  }
  return out;
}

function kmBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = 6371;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLon = (bLon - aLon) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(s)));
}

function inboxOf(p: AlbumPhoto): InboxCandidate {
  return {
    id: p.id,
    fileName: p.fileName,
    faceCount: p.faceCount,
    textCoverage: p.textCoverage,
    sceneTags: p.sceneTags,
    width: p.width,
    height: p.height
  };
}

function personStats(photos: AlbumPhoto[]): Pick<PersonAlbum, 'selectedIds' | 'seriesCount' | 'duplicateCount' | 'from' | 'to'> {
  const selectedIds = photos.filter(p => p.status === 'selected').map(p => p.id);
  const times = photos.map(p => p.capturedAt).filter((t): t is number => t !== undefined);
  const byGroup = new Map<string, AlbumPhoto[]>();
  for (const p of photos) {
    if (!p.groupId) continue;
    const list = byGroup.get(p.groupId) ?? [];
    list.push(p);
    byGroup.set(p.groupId, list);
  }
  let duplicateCount = 0;
  let seriesCount = 0;
  for (const members of byGroup.values()) {
    if (members.length < 2) continue;
    seriesCount++;
    const keep = members.find(m => m.status === 'selected')
      ?? members.reduce((a, b) => (a.aiScore >= b.aiScore ? a : b));
    duplicateCount += members.filter(m => m.id !== keep.id && m.status !== 'rejected').length;
  }
  return {
    selectedIds,
    seriesCount,
    duplicateCount,
    from: times.length ? Math.min(...times) : undefined,
    to: times.length ? Math.max(...times) : undefined
  };
}

/** Titlu din dată. „12 oct” într-o zi, „aug” dacă ieșirea acoperă luna. */
export function eventTitle(start: number, end: number, locale: 'ro' | 'en' = 'ro'): string {
  const tag = locale === 'ro' ? 'ro-RO' : 'en-GB';
  const fmt = (ms: number, options: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleDateString(tag, options);
  const a = new Date(start);
  const b = new Date(end);
  const sameDay = a.toDateString() === b.toDateString();
  if (sameDay) return fmt(start, { day: 'numeric', month: 'short' }).replace(/\.$/, '');
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (sameMonth && (end - start) > 20 * 24 * 60 * 60 * 1000) {
    return fmt(start, { month: 'short' }).replace(/\.$/, '');
  }
  if (sameMonth) {
    return `${fmt(start, { day: 'numeric' })}–${fmt(end, { day: 'numeric', month: 'short' })}`.replace(/\.$/, '');
  }
  return `${fmt(start, { day: 'numeric', month: 'short' })} – ${fmt(end, { day: 'numeric', month: 'short' })}`.replace(/\.$/g, '');
}

function newEvent(prev: AlbumPhoto, next: AlbumPhoto): boolean {
  const gap = (next.capturedAt ?? 0) - (prev.capturedAt ?? 0);
  if (gap > EVENT_GAP_MS) return true;
  if (
    gap > TRAVEL_GAP_MS
    && prev.gpsLatitude !== undefined && prev.gpsLongitude !== undefined
    && next.gpsLatitude !== undefined && next.gpsLongitude !== undefined
    && kmBetween(prev.gpsLatitude, prev.gpsLongitude, next.gpsLatitude, next.gpsLongitude) > TRAVEL_KM
  ) return true;
  return false;
}

export function buildAlbums(photos: readonly AlbumPhoto[], locale: 'ro' | 'en' = 'ro'): BuiltAlbums {
  const people = new Map<string, AlbumPhoto[]>();
  const unnamedPhotoIds: string[] = [];
  const animals = new Map<string, AlbumPhoto[]>();
  const namedPets = new Map<string, AlbumPhoto[]>();
  const petSpecies = new Map<string, string>();
  const screenshots: string[] = [];
  const documents: string[] = [];
  const memory: AlbumPhoto[] = [];
  const animalPhotos: { photo: AlbumPhoto; labels: string[] }[] = [];

  for (const photo of photos) {
    const kind = photo.aside === 'document' ? 'document'
      : photo.aside === 'screenshot' ? 'screenshot'
        : classifyPhoto(inboxOf(photo));
    if (kind === 'screenshot') {
      screenshots.push(photo.id);
      continue;
    }
    if (kind === 'document' || kind === 'object') {
      documents.push(photo.id);
      continue;
    }
    memory.push(photo);
    if (photo.faceCount > 0 && photo.personNames.length === 0) unnamedPhotoIds.push(photo.id);
    for (const name of photo.personNames) {
      const list = people.get(name) ?? [];
      list.push(photo);
      people.set(name, list);
    }
    const labels = animalLabels([...(photo.sceneTags ?? []), ...(photo.petLabel ? [photo.petLabel] : [])]);
    if (labels.length) animalPhotos.push({ photo, labels });
    if (photo.petName) {
      const list = namedPets.get(photo.petName) ?? [];
      list.push(photo);
      namedPets.set(photo.petName, list);
      if (photo.petLabel && !petSpecies.has(photo.petName)) petSpecies.set(photo.petName, photo.petLabel);
    }
  }

  // Un singur album pe poză: specia cea mai frecventă din galerie dintre
  // etichetele ei. Raportat: aceeași pisică apărea în „Cat”, „Pet” și „Dog”,
  // iar o fetiță cu pisica în brațe ajungea „Horse”. Etichetele generice
  // („pet”, „animal”) se alătură speciei dominante, iar un album cu mai puțin
  // de MIN_ANIMAL_PHOTOS poze e zgomot de etichetare, nu un animal al tău.
  const speciesCount = new Map<string, number>();
  for (const { labels } of animalPhotos) {
    for (const label of labels) if (!GENERIC_ANIMAL_LABELS.has(label)) speciesCount.set(label, (speciesCount.get(label) ?? 0) + 1);
  }
  const dominant = [...speciesCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const { photo, labels } of animalPhotos) {
    const specific = labels.filter(l => !GENERIC_ANIMAL_LABELS.has(l))
      .sort((a, b) => (speciesCount.get(b) ?? 0) - (speciesCount.get(a) ?? 0));
    const label = specific[0] ?? dominant ?? labels[0];
    const list = animals.get(label) ?? [];
    list.push(photo);
    animals.set(label, list);
  }
  for (const [label, list] of animals) if (list.length < MIN_ANIMAL_PHOTOS) animals.delete(label);

  const dated = memory
    .filter(p => p.capturedAt !== undefined)
    .sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0));
  const eventBuckets: AlbumPhoto[][] = [];
  for (const photo of dated) {
    const last = eventBuckets[eventBuckets.length - 1];
    const prev = last?.[last.length - 1];
    if (!last || !prev || newEvent(prev, photo)) eventBuckets.push([photo]);
    else last.push(photo);
  }

  return {
    people: [...people.entries()]
      .map(([name, list]) => ({ name, photoIds: list.map(p => p.id), ...personStats(list) }))
      .sort((a, b) => b.photoIds.length - a.photoIds.length || a.name.localeCompare(b.name)),
    unnamedPhotoIds,
    namedPets: [...namedPets.entries()]
      .map(([name, list]) => ({
        name,
        label: petSpecies.get(name) ?? 'animal',
        photoIds: list.map(p => p.id),
        ...personStats(list)
      }))
      .sort((a, b) => b.photoIds.length - a.photoIds.length || a.name.localeCompare(b.name)),
    unnamedPets: findUnnamedPetClusters(memory).map(cluster => ({
      label: cluster.label,
      photoIds: cluster.members.map(m => m.photoId)
    })),
    animals: [...animals.entries()]
      .map(([label, list]) => ({
        label,
        photoIds: list.map(p => p.id),
        latestAt: list.reduce<number | undefined>((max, p) => {
          if (p.capturedAt === undefined) return max;
          return max === undefined || p.capturedAt > max ? p.capturedAt : max;
        }, undefined)
      }))
      .sort((a, b) => b.photoIds.length - a.photoIds.length || a.label.localeCompare(b.label)),
    // O zi cu o poză nu e un eveniment (raportat: 28 de „evenimente”, aproape toate cu 1 poză).
    events: eventBuckets.filter(list => list.length >= MIN_EVENT_PHOTOS).map(list => {
      const start = list[0].capturedAt ?? 0;
      const end = list[list.length - 1].capturedAt ?? start;
      return {
        id: `${start}-${end}-${list[0].id}`,
        title: eventTitle(start, end, locale),
        photoIds: list.map(p => p.id),
        selectedCount: list.filter(p => p.status === 'selected').length,
        start,
        end
      };
    }).reverse(),
    screenshots,
    documents
  };
}

/** Nume sigur pentru un folder din galerie. Nu e o cale. */
export function albumFolderName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || 'Album').slice(0, 40);
}
