import { useEffect, useState, memo } from 'react';
import { db } from '../core/db';
import { useStore, type PhotoView } from '../state/store';
import {
  StarIcon, UserQuestionIcon, UserCheckIcon, EyeClosedIcon, LayersIcon, CheckIcon, SunIcon, ClockIcon, EditIcon,
  UnderexposedIcon, AwkwardExpressionIcon, RibbonIcon, HeartIcon, HeartOffIcon
} from './icons';
import { isNeutral } from '../core/imageAdjust';
import { AdjustedImage } from './AdjustedImage';
import { t, type Locale } from '../i18n';

/** Aceleasi praguri ca SELECT_THRESHOLD/REJECT_THRESHOLD (importPipeline.ts) — culoarea inelului de scor. */
function scoreColorVar(score: number): string {
  return score >= 65 ? 'var(--pick)' : score <= 35 ? 'var(--reject)' : 'var(--review)';
}

/** Acelasi prag ca aiSuggest.underexposed (aiExplanationGenerator.ts: exposure - 50 < -15). */
function isUnderexposed(photo: PhotoView): boolean {
  return photo.exposure - 50 < -15;
}

/** Majoritatea fetelor din cadru au o expresie stanjenitoare (gura deschisa fara zambet/surpriza reala) — vezi ContextEngine PRIOR_WEIGHTS.groupAwkwardRatio. */
function isAwkwardExpression(photo: PhotoView): boolean {
  return photo.faceCount > 0 && (photo.groupAwkwardRatio ?? 0) > 0.5;
}

/**
 * Descriere text completa a cardului — button-ul are aria-label pe el, deci
 * toate iconitele-badge din interior devin aria-hidden (un parinte cu
 * aria-label le suprascrie oricum pentru un cititor de ecran).
 * Ruteaza prin i18n — bug real gasit de auditul QA: textul era hardcodat in
 * romana indiferent de locale-ul ales, deci un utilizator TalkBack/VoiceOver
 * pe engleza auzea tot romana pentru cel mai repetat text accesibil din
 * aplicatie (o data per poza, potential 1000+ ori pe sesiune).
 */
function describeCard(photo: PhotoView, locale: Locale, isBestOfSeries: boolean): string {
  const bits: string[] = [];
  if (photo.personNames.length) bits.push(t(locale, 'photoCard.knownPersons', { names: photo.personNames.join(', ') }));
  if (photo.strangerCount > 0) bits.push(t(locale, 'photoCard.strangers'));
  if (photo.faceCount > 0 && !photo.allEyesOpen) bits.push(t(locale, 'photoCard.eyesClosedFull'));
  if (photo.groupId) bits.push(t(locale, 'photoCard.seriesFull'));
  if (isBestOfSeries) bits.push(t(locale, 'photoCard.bestOfSeriesFull'));
  if (isUnderexposed(photo)) bits.push(t(locale, 'photoCard.underexposedFull'));
  if (isAwkwardExpression(photo)) bits.push(t(locale, 'photoCard.awkwardFull'));
  if (photo.clientFeedback === 'like') bits.push(t(locale, 'photoCard.clientLikedFull'));
  if (photo.clientFeedback === 'dislike') bits.push(t(locale, 'photoCard.clientDislikedFull'));
  if (photo.goldenHourDetected) bits.push(t(locale, 'photoCard.goldenHour'));
  if (photo.rating > 0) bits.push(t(locale, 'photoCard.stars', { count: photo.rating }));
  const extra = bits.length ? ', ' + bits.join(', ') : '';
  return t(locale, 'photoCard.description', {
    fileName: photo.fileName, score: photo.aiScore, status: t(locale, `photoCard.status.${photo.status}`), extra
  });
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
  const locale = useStore(s => s.locale);
  const bestInGroupIds = useStore(s => s.bestInGroupIds());

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

  const colorLabelClass = photo.colorLabel && photo.colorLabel !== 'none' ? ` label-${photo.colorLabel}` : '';
  const isBestOfSeries = !!photo.groupId && bestInGroupIds.has(photo.id);
  const underexposed = isUnderexposed(photo);
  const awkward = isAwkwardExpression(photo);

  return (
    <button
      className={`card st-${photo.status}${multiSelected ? ' multi-selected' : ''}${colorLabelClass}`}
      data-photo-id={photo.id}
      onClick={e => onOpen(photo.id, e)}
      onPointerDown={e => onCardPointerDown?.(photo.id, e)}
      onContextMenu={e => onContextMenu?.(photo.id, e)}
      aria-label={describeCard(photo, locale, isBestOfSeries)}
      aria-pressed={multiSelected}
    >
      <span className="card-top-left" aria-hidden="true">
        <span className="frame-no">#{String(index + 1).padStart(3, '0')}</span>
        {photo.goldenHourDetected && (
          <span className="golden-badge" title={t(locale, 'photoCard.goldenHour')}><SunIcon /></span>
        )}
        {!isNeutral(photo.edits) && (
          <span className="edited-badge" title={t(locale, 'photoCard.edited')}><EditIcon /></span>
        )}
      </span>
      {multiSelected && <span className="multi-select-badge" aria-hidden="true"><CheckIcon /></span>}
      {!multiSelected && photo.status === 'selected' && (
        <span className="check-badge" aria-hidden="true"><CheckIcon /></span>
      )}
      {!multiSelected && photo.status === 'review' && (
        <span className="review-badge" aria-hidden="true"><ClockIcon /></span>
      )}
      <span className="card-media" aria-hidden="true">
        {photo.lqip && <img className="card-lqip" src={photo.lqip} alt="" />}
        {src && <AdjustedImage className="card-img-loaded" src={src} edits={photo.edits} alt="" loading="lazy" />}
        {!src && !photo.lqip && <span className="card-loading" />}
      </span>
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
              {photo.strangerCount > 0 && <i title={t(locale, 'photoCard.strangers')}><UserQuestionIcon /></i>}
              {photo.faceCount > 0 && !photo.allEyesOpen && <i title={t(locale, 'photoCard.eyesClosed')}><EyeClosedIcon /></i>}
              {photo.groupId && <i title={t(locale, 'photoCard.series')}><LayersIcon /></i>}
              {isBestOfSeries && <i title={t(locale, 'photoCard.bestOfSeries')}><RibbonIcon /></i>}
              {underexposed && <i title={t(locale, 'photoCard.underexposed')}><UnderexposedIcon /></i>}
              {awkward && <i title={t(locale, 'photoCard.awkward')}><AwkwardExpressionIcon /></i>}
              {photo.clientFeedback === 'like' && <i title={t(locale, 'photoCard.clientLiked')}><HeartIcon /></i>}
              {photo.clientFeedback === 'dislike' && <i title={t(locale, 'photoCard.clientDisliked')}><HeartOffIcon /></i>}
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
