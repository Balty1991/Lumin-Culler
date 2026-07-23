import { useEffect, useState, memo } from 'react';
import { db } from '../core/db';
import type { PhotoView } from '../state/store';
import { StarIcon, UserQuestionIcon, EyeClosedIcon, LayersIcon, CheckIcon, SunIcon } from './icons';

/** Aceleasi praguri ca SELECT_THRESHOLD/REJECT_THRESHOLD (importPipeline.ts) — culoarea inelului de scor. */
function scoreColorVar(score: number): string {
  return score >= 65 ? 'var(--pick)' : score <= 35 ? 'var(--reject)' : 'var(--review)';
}

/** Card "contact sheet": miniatura din IndexedDB, incarcare lenesa, zero logica. */
function PhotoCardInner({ photo, index, onOpen }: {
  photo: PhotoView;
  index: number;
  onOpen: (id: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    db.thumbnails.get(photo.id).then(t => {
      if (t && alive) { url = URL.createObjectURL(t.blob); setSrc(url); }
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [photo.id]);

  const ringColor = scoreColorVar(photo.aiScore);
  const ringDeg = Math.max(0, Math.min(360, Math.round((photo.aiScore / 100) * 360)));

  return (
    <button className={`card st-${photo.status}`} onClick={() => onOpen(photo.id)}>
      <span className="card-top-left">
        <span className="frame-no">#{String(index + 1).padStart(3, '0')}</span>
        {photo.goldenHourDetected && (
          <span className="golden-badge" title="Ora de aur"><SunIcon /></span>
        )}
      </span>
      {photo.status === 'selected' && (
        <span className="check-badge" aria-hidden="true"><CheckIcon /></span>
      )}
      {src ? <img src={src} alt={photo.fileName} loading="lazy" /> : <span className="card-loading" />}
      <span className="card-strip">
        <span
          className="mini-score-ring"
          style={{ background: `conic-gradient(${ringColor} ${ringDeg}deg, rgba(255,255,255,0.14) 0)` }}
        >
          <span className="mini-score-ring-inner" style={{ color: ringColor }}>{photo.aiScore}</span>
        </span>
        <span className="badges">
          {photo.personNames.length > 0 && <i title={photo.personNames.join(', ')}><StarIcon /></i>}
          {photo.strangerCount > 0 && <i title="Contine straini"><UserQuestionIcon /></i>}
          {photo.faceCount > 0 && !photo.allEyesOpen && <i title="Ochi inchisi"><EyeClosedIcon /></i>}
          {photo.groupId && <i title="Serie / duplicat"><LayersIcon /></i>}
        </span>
      </span>
    </button>
  );
}

export const PhotoCard = memo(PhotoCardInner);
