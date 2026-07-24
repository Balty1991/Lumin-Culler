import { useEffect, useState, memo } from 'react';
import { db } from '../core/db';
import { useStore, type PhotoView } from '../state/store';
import { StarIcon, UserQuestionIcon, UserCheckIcon, EyeClosedIcon, LayersIcon, CheckIcon, SunIcon } from './icons';

/** Aceleasi praguri ca SELECT_THRESHOLD/REJECT_THRESHOLD (importPipeline.ts) — culoarea inelului de scor. */
function scoreColorVar(score: number): string {
  return score >= 65 ? 'var(--pick)' : score <= 35 ? 'var(--reject)' : 'var(--review)';
}

const STATUS_LABEL_RO: Record<PhotoView['status'], string> = {
  pending: 'in asteptare', selected: 'selectata', rejected: 'respinsa', review: 'de verificat'
};

/** Descriere text completa a cardului — button-ul are aria-label pe el, deci
    toate iconitele-badge din interior devin aria-hidden (un parinte cu
    aria-label le suprascrie oricum pentru un cititor de ecran). */
function describeCard(photo: PhotoView): string {
  const bits: string[] = [];
  if (photo.personNames.length) bits.push(`persoane cunoscute: ${photo.personNames.join(', ')}`);
  if (photo.strangerCount > 0) bits.push('contine straini');
  if (photo.faceCount > 0 && !photo.allEyesOpen) bits.push('ochi inchisi detectati');
  if (photo.groupId) bits.push('parte dintr-o serie');
  if (photo.goldenHourDetected) bits.push('ora de aur');
  if (photo.rating > 0) bits.push(`${photo.rating} stele`);
  return `${photo.fileName}, scor AI ${photo.aiScore}, ${STATUS_LABEL_RO[photo.status]}${bits.length ? ', ' + bits.join(', ') : ''}`;
}

/** Rand compact de metadate camera, afisat doar la densitatea "large" (plan 3.2.1 —
    densitatea grilei controleaza si cate informatii se vad pe card, nu doar dimensiunea). */
function cardExifLine(photo: PhotoView): string {
  const parts: string[] = [];
  if (photo.cameraModel) parts.push(photo.cameraModel);
  if (photo.fNumber !== undefined) parts.push(`f/${photo.fNumber.toFixed(photo.fNumber < 10 ? 1 : 0)}`);
  if (photo.focalLength !== undefined) parts.push(`${Math.round(photo.focalLength)}mm`);
  return parts.join(' · ');
}

/** Card "contact sheet": miniatura din IndexedDB, incarcare lenesa, zero logica. */
function PhotoCardInner({ photo, index, onOpen, multiSelected, onCardPointerDown, onContextMenu }: {
  photo: PhotoView;
  index: number;
  onOpen: (id: string, e: React.MouseEvent) => void;
  multiSelected: boolean;
  /** Inceputul unei posibile selectii prin drag (plan 3.2.1) — decizia daca a fost chiar drag sau doar un tap simplu se ia la nivelul grilei (App.tsx), nu aici. */
  onCardPointerDown?: (id: string, e: React.PointerEvent) => void;
  /** Meniu contextual (click-dreapta / apasare lunga) — pozitionarea si continutul se decid tot la nivelul grilei. */
  onContextMenu?: (id: string, e: React.MouseEvent) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const density = useStore(s => s.gridDensity);

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
    <button
      className={`card st-${photo.status}${multiSelected ? ' multi-selected' : ''}`}
      data-photo-id={photo.id}
      onClick={e => onOpen(photo.id, e)}
      onPointerDown={e => onCardPointerDown?.(photo.id, e)}
      onContextMenu={e => onContextMenu?.(photo.id, e)}
      aria-label={describeCard(photo)}
      aria-pressed={multiSelected}
    >
      <span className="card-top-left" aria-hidden="true">
        <span className="frame-no">#{String(index + 1).padStart(3, '0')}</span>
        {photo.goldenHourDetected && (
          <span className="golden-badge" title="Ora de aur"><SunIcon /></span>
        )}
      </span>
      {multiSelected && <span className="multi-select-badge" aria-hidden="true"><CheckIcon /></span>}
      {!multiSelected && photo.status === 'selected' && (
        <span className="check-badge" aria-hidden="true"><CheckIcon /></span>
      )}
      {src ? <img src={src} alt="" aria-hidden="true" loading="lazy" /> : <span className="card-loading" aria-hidden="true" />}
      <span className="card-strip" aria-hidden="true">
        <span className="card-strip-row">
          <span
            className="mini-score-ring"
            style={{ background: `conic-gradient(${ringColor} ${ringDeg}deg, rgba(255,255,255,0.14) 0)` }}
          >
            <span className="mini-score-ring-inner" style={{ color: ringColor }}>{photo.aiScore}</span>
          </span>
          {density !== 'compact' && (
            <span className="badges">
              {photo.rating > 0 && <span className="rating-chip"><StarIcon fill="currentColor" />{photo.rating}</span>}
              {photo.personNames.length > 0 && <i title={photo.personNames.join(', ')}><UserCheckIcon /></i>}
              {photo.strangerCount > 0 && <i title="Contine straini"><UserQuestionIcon /></i>}
              {photo.faceCount > 0 && !photo.allEyesOpen && <i title="Ochi inchisi"><EyeClosedIcon /></i>}
              {photo.groupId && <i title="Serie / duplicat"><LayersIcon /></i>}
            </span>
          )}
        </span>
        {density === 'large' && cardExifLine(photo) && (
          <span className="card-exif-line mono">{cardExifLine(photo)}</span>
        )}
      </span>
    </button>
  );
}

export const PhotoCard = memo(PhotoCardInner);
