import type { RescueKey } from './copy';
import type { KeepEdge, PileId, ReasonCode } from './model';

export function pileKey(id: PileId): RescueKey {
  switch (id) {
    case 'videos': return 'pileVideos';
    case 'messengers': return 'pileMessengers';
    case 'duplicates': return 'pileDuplicates';
    case 'screenshots': return 'pileScreenshots';
    case 'bursts': return 'pileBursts';
    case 'blurry': return 'pileBlurry';
  }
}

export function reasonKey(reason: ReasonCode): RescueKey {
  switch (reason) {
    case 'largeVideo': return 'reasonLargeVideo';
    case 'chatVideo': return 'reasonChatVideo';
    case 'status': return 'reasonStatus';
    case 'sticker': return 'reasonSticker';
    case 'gif': return 'reasonGif';
    case 'voice': return 'reasonVoice';
    case 'chatCopy': return 'reasonChatCopy';
    case 'chatOnly': return 'reasonChatOnly';
    case 'duplicate': return 'reasonDuplicate';
    case 'burst': return 'reasonBurst';
    case 'screenshotOld': return 'reasonScreenshotOld';
    case 'screenshotRecent': return 'reasonScreenshotRecent';
    case 'blurry': return 'reasonBlurry';
  }
}

export function edgeKey(edge: KeepEdge): RescueKey {
  switch (edge) {
    case 'sharper': return 'edgeSharper';
    case 'eyes': return 'edgeEyes';
    case 'exposure': return 'edgeExposure';
    case 'face': return 'edgeFace';
    case 'original': return 'edgeOriginal';
  }
}
