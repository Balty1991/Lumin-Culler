/**
 * Albume virtuale, construite din ce știe deja scanarea.
 *
 * Nu mută și nu redenumește nimic în galerie. Un album e o listă de id-uri.
 * Deschiderea ecranului e singurul moment în care se grupează — după ce
 * primul rezultat e deja pe ecran, nu în treapta 1.
 */
import { classifyPhoto, type InboxCandidate } from './smartInbox';

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
}

/** Etichete de animal ale modelului de bază ML Kit Image Labeling (engleză, offline, în SDK). */
const ANIMAL_LABELS = new Set([
  'dog', 'cat', 'bird', 'horse', 'animal', 'pet', 'puppy', 'kitten',
  'fish', 'rabbit', 'cow', 'sheep', 'elephant', 'bear', 'zebra', 'giraffe',
  'lion', 'tiger', 'monkey', 'deer', 'fox', 'wolf', 'hamster', 'turtle',
  'duck', 'chicken', 'goat', 'pig', 'wildlife', 'mammal', 'reptile',
  'insect', 'butterfly', 'bee', 'spider', 'snake', 'frog', 'lizard',
  'parrot', 'eagle', 'owl', 'penguin', 'dolphin', 'whale', 'shark',
  'cattle', 'livestock', 'feline', 'canine', 'squirrel', 'mouse', 'rat',
  'hedgehog', 'camel', 'kangaroo'
]);

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

export interface BuiltAlbums {
  people: PersonAlbum[];
  /** Poze cu fețe cărora nu li s-a dat încă un nume. */
  unnamedPhotoIds: string[];
  animals: AnimalAlbum[];
  events: EventAlbum[];
  screenshots: string[];
  documents: string[];
}

function animalLabels(tags: string[] | undefined): string[] {
  const out: string[] = [];
  for (const tag of tags ?? []) {
    const key = tag.trim().toLowerCase();
    if (ANIMAL_LABELS.has(key) && !out.includes(key)) out.push(key);
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
  const screenshots: string[] = [];
  const documents: string[] = [];
  const memory: AlbumPhoto[] = [];

  for (const photo of photos) {
    const kind = classifyPhoto(inboxOf(photo));
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
    for (const label of animalLabels(photo.sceneTags)) {
      const list = animals.get(label) ?? [];
      list.push(photo);
      animals.set(label, list);
    }
  }

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
    events: eventBuckets.map(list => {
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
