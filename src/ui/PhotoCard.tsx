import { useEffect, useState, memo } from 'react';
import { db } from '../core/db';
import type { PhotoView } from '../state/store';
import { StarIcon, UserQuestionIcon, EyeClosedIcon, LayersIcon } from './icons';

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

  return (
    <button className={`card st-${photo.status}`} onClick={() => onOpen(photo.id)}>
      <span className="frame-no">#{String(index + 1).padStart(3, '0')}</span>
      {src ? <img src={src} alt={photo.fileName} loading="lazy" /> : <span className="card-loading" />}
      <span className="card-strip">
        <b className="score">{photo.aiScore}</b>
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
