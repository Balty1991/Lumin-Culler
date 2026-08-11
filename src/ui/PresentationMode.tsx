import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { getCachedPreviewUrl } from '../core/previewUrlCache';
import { useStore, type PhotoView } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, ChevronLeft, ChevronRight, PlayIcon, PauseIcon, MaximizeIcon } from './icons';
import { EASE } from './motion';
import { t } from '../i18n';

/** Durata (ms) fiecarui cadru in avansul automat — suficient de lent pentru
    o prezentare la client (nu e un "carusel" rapid), suficient de scurt sa
    nu para blocat. */
const ADVANCE_MS = 5000;
/** Cat dureaza zoom-ul Ken Burns pe durata cadrului — usor mai mult decat
    ADVANCE_MS, ca zoom-ul sa nu se opreasca vizibil chiar inainte de tranzitie. */
const KEN_BURNS_S = ADVANCE_MS / 1000 + 1.2;

/** Un singur cadru: lqip blurat instant, apoi preview-ul complet (2048px) cu
    un zoom lent (efect "Ken Burns") cat timp e afisat — remontat la fiecare
    schimbare de poza (key={photo.id} pe parinte), deci zoom-ul reporneste. */
function PresentationSlide({ photo, reduceMotion }: { photo: PhotoView; reduceMotion: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    void getCachedPreviewUrl(photo.id).then(url => { if (alive) setSrc(url); });
    return () => { alive = false; };
  }, [photo.id]);

  return (
    <div className="presentation-slide-wrap">
      {photo.lqip && (
        <img className="presentation-lqip" src={photo.lqip} alt="" style={{ opacity: src ? 0 : 1 }} />
      )}
      {src && (
        <motion.img
          className="presentation-img"
          src={src}
          alt=""
          initial={{ scale: reduceMotion ? 1 : 1.08 }}
          animate={{ scale: 1 }}
          transition={{ duration: reduceMotion ? 0 : KEN_BURNS_S, ease: 'linear' }}
        />
      )}
    </div>
  );
}

/**
 * Prezentare fullscreen cinematica (idee "modernizare" aprobata de utilizator):
 * ruleaza peste selectia multipla curenta daca exista, altfel peste pozele
 * "selectate" din filtrul curent, altfel peste tot filtrul curent — util
 * pentru a arata rezultatul clientului pe loc, fara sa vada grila de lucru
 * (badge-uri, status, meniu). Avans automat + control manual cu sagetile,
 * play/pauza si Fullscreen API real (ascunde chrome-ul browserului).
 */
export function PresentationMode() {
  const open = useStore(s => s.presentationOpen);
  const setOpen = useStore(s => s.setPresentationOpen);
  const presentationPhotoIds = useStore(s => s.presentationPhotoIds);
  const setPresentationPhotoIds = useStore(s => s.setPresentationPhotoIds);
  const multiSelectIds = useStore(s => s.multiSelectIds);
  const allPhotos = useStore(s => s.photos);
  const filtered = useStore(s => s.filtered());
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const reduceMotion = useReducedMotion() ?? false;
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  const { photos, sourceLabel } = useMemo(() => {
    // Recap lunar (Meniu) fixeaza o lista explicita de poze, indiferent de filtrul
    // curent al grilei — cauta in TOATE pozele (allPhotos), nu doar in `filtered`.
    if (presentationPhotoIds) {
      const idSet = new Set(presentationPhotoIds);
      return { photos: allPhotos.filter(p => idSet.has(p.id)), sourceLabel: tr('presentation.source.recap') };
    }
    if (multiSelectIds.size > 0) {
      return { photos: filtered.filter(p => multiSelectIds.has(p.id)), sourceLabel: tr('presentation.source.selection') };
    }
    const selected = filtered.filter(p => p.status === 'selected');
    if (selected.length > 0) return { photos: selected, sourceLabel: tr('presentation.source.selected') };
    return { photos: filtered, sourceLabel: tr('presentation.source.filtered') };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentationPhotoIds, multiSelectIds, allPhotos, filtered, locale]);

  // Golim lista fixata a Recap-ului la inchidere, indiferent cum s-a inchis
  // (Escape, buton, iesire din empty-state) — urmatoarea deschidere normala
  // (din grila) trebuie sa revina la comportamentul obisnuit (selectie/filtru).
  useEffect(() => {
    if (!open && presentationPhotoIds) setPresentationPhotoIds(null);
  }, [open, presentationPhotoIds, setPresentationPhotoIds]);

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) { setIndex(0); setPlaying(true); }
  }, [open]);

  useEffect(() => {
    if (index >= photos.length && photos.length > 0) setIndex(0);
  }, [photos.length, index]);

  const step = (delta: number) => {
    if (photos.length < 2) return;
    setIndex(i => (i + delta + photos.length) % photos.length);
  };

  useEffect(() => {
    if (!open || !playing || photos.length < 2 || reduceMotion) return;
    const id = setTimeout(() => step(1), ADVANCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, playing, index, photos.length, reduceMotion]);

  const bumpControls = () => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 2800);
  };

  useEffect(() => {
    if (!open) return;
    bumpControls();
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p); }
      bumpControls();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, photos.length]);

  // Fullscreen real (ascunde bara browserului) — iesim automat daca panoul se inchide
  // altfel decat prin butonul de Fullscreen (ex. Escape), ca sa nu ramana "agatat".
  useEffect(() => {
    if (!open && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, [open]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void containerRef.current?.requestFullscreen().catch(() => {});
  };

  if (!open) return null;

  const photo = photos[index] as PhotoView | undefined;

  return (
    <div
      className="presentation-scrim"
      ref={containerRef}
      role="dialog" aria-modal="true" aria-label={tr('menu.presentation')}
      tabIndex={-1}
      onPointerMove={bumpControls}
      onClick={bumpControls}
    >
      {photos.length === 0 ? (
        <div className="presentation-empty">
          <p className="hint">{tr('presentation.empty')}</p>
          <button className="ghost" onClick={() => setOpen(false)}>{tr('presentation.exit')}</button>
        </div>
      ) : (
        <>
          <AnimatePresence mode="wait">
            {photo && (
              <motion.div
                key={photo.id}
                className="presentation-frame"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.6, ease: EASE }}
              >
                <PresentationSlide photo={photo} reduceMotion={reduceMotion} />
              </motion.div>
            )}
          </AnimatePresence>

          <div className={`presentation-controls${controlsVisible ? '' : ' hidden'}`} onClick={e => e.stopPropagation()}>
            <div className="presentation-top-bar">
              <span className="presentation-source mono">{sourceLabel}</span>
              <span className="presentation-counter mono">{tr('presentation.counter', { current: index + 1, total: photos.length })}</span>
              <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('presentation.exit')}>
                <XIcon />
              </button>
            </div>

            {photos.length > 1 && (
              <>
                <button className="presentation-nav-btn presentation-nav-prev" onClick={() => step(-1)} aria-label={tr('workspace.nav.prev')}>
                  <ChevronLeft />
                </button>
                <button className="presentation-nav-btn presentation-nav-next" onClick={() => step(1)} aria-label={tr('workspace.nav.next')}>
                  <ChevronRight />
                </button>
              </>
            )}

            <div className="presentation-bottom-bar">
              <button className="ghost icon-btn" onClick={() => setPlaying(p => !p)} aria-label={playing ? tr('presentation.pause') : tr('presentation.play')}>
                {playing ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button className="ghost icon-btn" onClick={toggleFullscreen} aria-label={tr('presentation.fullscreen')}>
                <MaximizeIcon />
              </button>
              {photo?.fileName && <span className="presentation-filename mono">{photo.fileName}</span>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
