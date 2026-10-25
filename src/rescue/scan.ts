import { demoGroups, rankPiles, type Pile, type PileId } from './model';

export interface ScanFrame {
  done: number;
  total: number;
  piles: Pile[];
  bytes: number;
  current: PileId;
}

/** First gigabyte estimate. The rest of the sample follows in short steps. */
export const SCAN_FIRST_MS = 120;
export const SCAN_STEP_MS = 160;

export function scanFrames(): ScanFrame[] {
  const groups = demoGroups();
  const frames: ScanFrame[] = [];
  for (let i = 0; i < groups.length; i++) {
    const piles = rankPiles(groups.slice(0, i + 1));
    frames.push({
      done: i + 1,
      total: groups.length,
      piles,
      bytes: piles.reduce((sum, pile) => sum + pile.suggestedBytes, 0),
      current: groups[i].id
    });
  }
  return frames;
}

export function scanBudgetMs(): number {
  const steps = scanFrames().length;
  if (steps === 0) return 0;
  return SCAN_FIRST_MS + SCAN_STEP_MS * (steps - 1);
}

export async function streamDemoScan(
  emit: (frame: ScanFrame) => void,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => { setTimeout(resolve, ms); }),
  stopped: () => boolean = () => false
): Promise<Pile[] | null> {
  const frames = scanFrames();
  for (let i = 0; i < frames.length; i++) {
    await wait(i === 0 ? SCAN_FIRST_MS : SCAN_STEP_MS);
    if (stopped()) return null;
    emit(frames[i]);
  }
  return frames[frames.length - 1]?.piles ?? [];
}
