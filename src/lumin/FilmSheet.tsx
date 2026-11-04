import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { useTr } from './context';
import { shareCollage } from './collage';
import { saveEditedBlob } from './saveEdited';

/**
 * Mini-filmul din serie, văzut întâi în aplicație (în buclă), apoi salvat în
 * galerie sau trimis. Înainte se deschidea direct fereastra de partajare.
 */
export function FilmSheet({ film, onClose }: { film: { blob: Blob; ext: string }; onClose: () => void }) {
  const tr = useTr();
  const setNotice = useStore(s => s.setNotice);
  const [url] = useState(() => URL.createObjectURL(film.blob));
  const [busy, setBusy] = useState(false);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const name = `cherrypic-miscare-${Date.now()}.${film.ext}`;
  const save = async () => {
    setBusy(true);
    try {
      const ok = await saveEditedBlob(film.blob, 'miscare', film.ext);
      setNotice(tr(ok ? 'lx.burstFilm.saved' : 'lx.magic.failed'));
      if (ok) onClose();
    } finally { setBusy(false); }
  };
  return createPortal(
    <div className="lx lx-enhance lx-film" role="dialog" aria-modal="true" aria-label={tr('lx.burstFilm.button')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.burstFilm.button')}</span>
        <span />
      </header>
      <div className="lx-enhance-stage">
        <video className="lx-film-video" src={url} autoPlay loop muted playsInline />
      </div>
      <div className="lx-viewer-info">
        <div className="lx-decide-actions">
          <button className="lx-btn ghost" disabled={busy} onClick={() => void shareCollage(film.blob, name, '')}>↗ {tr('lx.wall.share')}</button>
          <button className="lx-btn primary" disabled={busy} onClick={() => void save()}>{tr('lx.burstFilm.save')}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
