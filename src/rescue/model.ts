/**
 * Ranking for the browser demo. The numbers match Rescue.kt: one pile per
 * file, ordered by suggested gigabytes per second of effort. Decimal
 * gigabytes (1e9), same as the Kotlin plan, so a sample gallery lines up
 * with the Android home screen.
 */

export const PILE_IDS = ['videos', 'messengers', 'duplicates', 'screenshots', 'bursts', 'blurry'] as const;
export type PileId = (typeof PILE_IDS)[number];

export type ReasonCode =
  | 'largeVideo'
  | 'chatVideo'
  | 'status'
  | 'sticker'
  | 'gif'
  | 'voice'
  | 'chatCopy'
  | 'chatOnly'
  | 'duplicate'
  | 'burst'
  | 'screenshotOld'
  | 'screenshotRecent'
  | 'blurry';

export type KeepEdge = 'sharper' | 'eyes' | 'exposure' | 'face' | 'original';

export interface RescueItem {
  id: string;
  name: string;
  bytes: number;
  suggested: boolean;
  reason: ReasonCode;
  keepName?: string;
  edges?: KeepEdge[];
}

export interface Pile {
  id: PileId;
  items: RescueItem[];
  suggestedBytes: number;
  suggestedCount: number;
  effortSeconds: number;
  gbPerSecond: number;
}

const PILE_RANK: Record<PileId, number> = {
  videos: 0,
  messengers: 1,
  duplicates: 2,
  screenshots: 3,
  bursts: 4,
  blurry: 5
};

/** Seconds the suggested set should take. One confirm, not one swipe per file. */
export function effortSeconds(id: PileId, suggestedCount: number): number {
  const table: Record<PileId, readonly [number, number]> = {
    videos: [3, 1.2],
    messengers: [6, 0.12],
    duplicates: [5, 0.08],
    screenshots: [5, 0.08],
    bursts: [7, 0.25],
    blurry: [4, 1.1]
  };
  const [base, each] = table[id];
  return base + Math.max(0, suggestedCount) * each;
}

export function pileFrom(id: PileId, items: readonly RescueItem[]): Pile | null {
  if (items.length === 0) return null;
  const ordered = [...items].sort((a, b) => Number(b.suggested) - Number(a.suggested) || b.bytes - a.bytes);
  const suggested = ordered.filter(item => item.suggested);
  const bytes = suggested.reduce((sum, item) => sum + Math.max(0, item.bytes), 0);
  const count = suggested.length;
  const effort = count === 0 ? 0 : effortSeconds(id, count);
  const gbPerSecond = count === 0 || effort <= 0 ? 0 : (bytes / 1_000_000_000) / effort;
  return { id, items: ordered, suggestedBytes: bytes, suggestedCount: count, effortSeconds: effort, gbPerSecond };
}

export function rankPiles(groups: readonly { id: PileId; items: readonly RescueItem[] }[]): Pile[] {
  return groups
    .map(group => pileFrom(group.id, group.items))
    .filter((pile): pile is Pile => pile !== null)
    .sort((a, b) => b.gbPerSecond - a.gbPerSecond || PILE_RANK[a.id] - PILE_RANK[b.id]);
}

export function selectionOf(
  items: readonly RescueItem[],
  checked: ReadonlySet<string>,
  aside: ReadonlySet<string>
): { bytes: number; count: number; leftOut: number } {
  let bytes = 0;
  let count = 0;
  let leftOut = 0;
  for (const item of items) {
    if (aside.has(item.id)) continue;
    if (checked.has(item.id)) {
      bytes += Math.max(0, item.bytes);
      count += 1;
    } else {
      leftOut += 1;
    }
  }
  return { bytes, count, leftOut };
}

const MB = 1_000_000;

/**
 * Discovery order for the streamed demo. Videos come first so the gigabyte
 * estimate is useful before the rest of the gallery is classified.
 * The unique chat photo and the recent screenshot stay visible and unchecked.
 */
export function demoGroups(): { id: PileId; items: RescueItem[] }[] {
  return [
    {
      id: 'videos',
      items: [
        { id: 'v1', name: 'VID-20260312-WA0042.mp4', bytes: 1_600_000_000, suggested: true, reason: 'chatVideo' },
        { id: 'v2', name: 'concert.mp4', bytes: 820 * MB, suggested: true, reason: 'largeVideo' }
      ]
    },
    {
      id: 'messengers',
      items: [
        {
          id: 'm1',
          name: 'IMG-20260302-WA0091.jpg',
          bytes: 6 * MB,
          suggested: true,
          reason: 'chatCopy',
          keepName: 'IMG_2044.jpg',
          edges: ['original', 'eyes']
        },
        { id: 'm2', name: 'status-20260301.jpg', bytes: 18 * MB, suggested: true, reason: 'status' },
        { id: 'm3', name: 'STK-20260218.webp', bytes: 400_000, suggested: true, reason: 'sticker' },
        { id: 'm4', name: 'IMG-20260111-WA0004.jpg', bytes: 4 * MB, suggested: false, reason: 'chatOnly' }
      ]
    },
    {
      id: 'duplicates',
      items: [
        {
          id: 'd1',
          name: 'IMG_2044 (1).jpg',
          bytes: 48 * MB,
          suggested: true,
          reason: 'duplicate',
          keepName: 'IMG_2044.jpg',
          edges: ['eyes', 'sharper']
        },
        {
          id: 'd2',
          name: 'IMG_2044 (2).jpg',
          bytes: 48 * MB,
          suggested: true,
          reason: 'duplicate',
          keepName: 'IMG_2044.jpg',
          edges: ['sharper']
        }
      ]
    },
    {
      id: 'screenshots',
      items: [
        { id: 's1', name: 'Screenshot_20251102.png', bytes: 12 * MB, suggested: true, reason: 'screenshotOld' },
        { id: 's2', name: 'Screenshot_20261020.png', bytes: 8 * MB, suggested: false, reason: 'screenshotRecent' }
      ]
    },
    {
      id: 'bursts',
      items: [
        {
          id: 'b1',
          name: 'IMG_0881.jpg',
          bytes: 22 * MB,
          suggested: true,
          reason: 'burst',
          keepName: 'IMG_0880.jpg',
          edges: ['eyes', 'sharper']
        },
        {
          id: 'b2',
          name: 'IMG_0882.jpg',
          bytes: 18 * MB,
          suggested: true,
          reason: 'burst',
          keepName: 'IMG_0880.jpg',
          edges: ['sharper']
        }
      ]
    },
    {
      id: 'blurry',
      items: [
        { id: 'u1', name: 'IMG_3310.jpg', bytes: 14 * MB, suggested: true, reason: 'blurry' }
      ]
    }
  ];
}

export function demoPiles(): Pile[] {
  return rankPiles(demoGroups());
}

export function suggestedChecked(piles: readonly Pile[]): Set<string> {
  return new Set(piles.flatMap(pile => pile.items.filter(item => item.suggested).map(item => item.id)));
}

export interface HeldFile {
  id: string;
  name: string;
  bytes: number;
}

export function holdOf(items: readonly RescueItem[]): HeldFile[] {
  return items.filter(item => item.suggested).map(({ id, name, bytes }) => ({ id, name, bytes }));
}
