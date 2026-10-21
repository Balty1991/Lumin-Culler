import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { t } from '../i18n';
import {
  basketsFromLibrary, basketsFromScan, estimateSavedBytes, type BasketId, type CleanBasket, type CleanItem
} from '../core/cleanScan';
import { expiredShots, readAutoClean, reminderDue, writeAutoClean, type AutoCleanSettings } from '../core/autoClean';
import {
  commitAiClean, decideAiClean, readAiCleanState, writeAiCleanState, type AiCleanDecision, type AiCleanState
} from '../core/aiCleanAllowance';
import { isCleanScanAvailable, requestVideoAccess, scanGallery, type GalleryScan } from '../core/nativeCleanScan';
import { compressVideo, isVideoCompressAvailable } from '../core/nativeVideoCompress';
import { deleteNativePhotos } from '../core/nativeMediaLibrary';
import { showNotification } from '../core/nativeNotifications';
import { cancelCleanReminder, cleanReminderIsDue, markCleanReminderShown, scheduleCleanReminder } from '../core/cleanReminder';
import { shareCleanResult } from './shareResultCard';
import { StorageOrb } from './StorageOrb';
import { accentFromPixels, inkForAccent } from './palette';
import { withViewTransition } from './viewTransition';
import { ApertureIcon, CheckIcon, CopyIcon, CropIcon, EyeClosedIcon, FocusIcon, LayersIcon, OrbitCleanIcon, PlayIcon, TrashIcon, UndoIcon } from './icons';
import { DEFECT_EYES_OPEN_RATIO, DEFECT_SHARPNESS } from '../core/importPipeline';
import { addFreedBytes, addFreedFiles, readFreedBytes, readFreedFiles, subtractFreedBytes, subtractFreedFiles } from '../state/storageFreed';
import { formatSize } from '../state/storageStats';
import { maybeAskForReviewAfterFreed } from '../state/reviewPrompt';
import { Capacitor } from '@capacitor/core';
import { getCachedThumbUrl, peekThumbUrl } from '../core/thumbUrlCache';
import { formatEta } from '../core/formatTime';
import { motionAllowed, tickHaptic } from './haptics';
import './cleanHome.css';

export function CleanHome() {
  const locale = useStore(s => s.locale);
  const photos = useStore(s => s.photos);
  const premium = useStore(s => s.premium);
  const premiumLocked = useStore(s => s.premiumLocked);
  const gatePremium = useStore(s => s.gatePremium);
  const setProMode = useStore(s => s.setProMode);
  const openTiktokSortForIds = useStore(s => s.openTiktokSortForIds);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  const [scan, setScan] = useState<GalleryScan | null>(null);
  const [scanning, setScanning] = useState(isCleanScanAvailable);
  const [scanError, setScanError] = useState(false);
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [freed, setFreed] = useState(readFreedBytes);
  const [files, setFiles] = useState(readFreedFiles);
  const [ai, setAi] = useState<AiCleanState>(readAiCleanState);
  const [auto, setAuto] = useState<AutoCleanSettings>(readAutoClean);
  const [partial, setPartial] = useState<{ basket: CleanBasket; decision: Extract<AiCleanDecision, { kind: 'partial' }> } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [keepOriginal, setKeepOriginal] = useState(true);
  const [compressing, setCompressing] = useState<string | null>(null);

  const refresh = async () => {
    if (!isCleanScanAvailable()) { setScan(null); return; }
    setScanning(true);
    setScanError(false);
    try {
      setScan(await scanGallery());
    } catch {
      setScanError(true);
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const reminded = useRef(false);
  const reminderDaysRef = useRef(auto.reminderDays);

  useEffect(() => {
    const sync = () => setAuto(readAutoClean());
    window.addEventListener('lumin-auto-clean', sync);
    return () => window.removeEventListener('lumin-auto-clean', sync);
  }, []);

  const library = useMemo(() => basketsFromLibrary(photos.map(photo => ({
    id: photo.id,
    fileName: photo.fileName,
    mediaUri: photo.mediaUri,
    sizeBytes: photo.sizeBytes,
    capturedAt: photo.capturedAt,
    sharpness: photo.sharpness ?? 0,
    faceCount: photo.faceCount ?? 0,
    allEyesOpen: photo.allEyesOpen ?? true,
    exposure: photo.exposure,
    groupEyesOpenRatio: photo.groupEyesOpenRatio,
    groupId: photo.groupId,
    sceneTags: photo.sceneTags,
    status: photo.status,
    hash: photo.dHash,
    blurBelow: DEFECT_SHARPNESS,
    eyesOpenBelow: DEFECT_EYES_OPEN_RATIO
  }))), [photos]);

  const baskets = useMemo(() => {
    const base = scan?.granted ? basketsFromScan(scan.images, scan.videos) : library;
    const eyes = library.find(basket => basket.id === 'eyes');
    const withEyes = scan?.granted && eyes && eyes.items.length > 0
      ? [...base.filter(basket => basket.id !== 'videos' && basket.id !== 'eyes'), eyes, ...base.filter(basket => basket.id === 'videos')]
      : base;
    return withEyes.map(basket => {
      const items = basket.items.filter(item => !gone.has(item.uri));
      return { ...basket, items, bytes: items.reduce((sum, item) => sum + item.bytes, 0) };
    });
  }, [scan, library, gone]);

  const reclaimable = baskets.reduce((sum, basket) => sum + basket.bytes, 0);
  useEffect(() => {
    try { sessionStorage.setItem('lumin-reclaimable', String(reclaimable)); } catch { /* sesiunea ține cifra doar pentru setări */ }
  }, [reclaimable]);

  useEffect(() => {
    if (premiumLocked || !auto.monthlyReminder) {
      void cancelCleanReminder();
      return;
    }
    const reset = reminderDaysRef.current !== auto.reminderDays;
    reminderDaysRef.current = auto.reminderDays;
    void scheduleCleanReminder({
      intervalDays: auto.reminderDays,
      locale,
      reclaimableBytes: reclaimable,
      reset
    });
  }, [premiumLocked, auto.monthlyReminder, auto.reminderDays, locale, reclaimable]);

  useEffect(() => {
    if (reminded.current || scanning || premiumLocked || !auto.monthlyReminder) return;
    if (!reminderDue(auto, Date.now())) return;
    reminded.current = true;
    void (async () => {
      const nativeDue = await cleanReminderIsDue(auto.reminderDays);
      if (nativeDue === false) {
        const next = { ...auto, lastMonthlyReminderAt: Date.now() };
        writeAutoClean(next);
        setAuto(next);
        return;
      }
      const body = reclaimable > 0
        ? t(locale, 'clean.reminder.body', { size: formatSize(reclaimable) })
        : t(locale, 'clean.reminder.empty');
      await showNotification({ title: 'Lumin', body, channelName: 'Lumin' });
      await markCleanReminderShown();
      const next = { ...auto, lastMonthlyReminderAt: Date.now() };
      writeAutoClean(next);
      setAuto(next);
    })();
  }, [scanning, premiumLocked, auto, locale, reclaimable]);

  const [undo, setUndo] = useState<{ items: CleanItem[] } | null>(null);
  const undoTimer = useRef<number | null>(null);
  const rememberFreed = (items: CleanItem[]) => {
    const bytes = items.reduce((sum, item) => sum + item.bytes, 0);
    const total = addFreedBytes(bytes);
    const count = addFreedFiles(items.length);
    setFreed(total);
    setFiles(count);
    setGone(prev => {
      const next = new Set(prev);
      for (const item of items) next.add(item.uri);
      return next;
    });
    setUndo({ items });
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 6000);
    maybeAskForReviewAfterFreed(total);
  };
  const restoreUndo = () => {
    if (!undo) return;
    tickHaptic('undo');
    const bytes = undo.items.reduce((sum, item) => sum + item.bytes, 0);
    setGone(prev => {
      const next = new Set(prev);
      for (const item of undo.items) next.delete(item.uri);
      return next;
    });
    setFreed(subtractFreedBytes(bytes));
    setFiles(subtractFreedFiles(undo.items.length));
    setUndo(null);
  };

  const performDelete = async (items: CleanItem[], decision: AiCleanDecision): Promise<boolean> => {
    const native = items.filter(item => item.uri.startsWith('content:') || item.uri.startsWith('file:'));
    const imported = items.filter(item => item.photoId && item.uri.startsWith('app:'));
    if (native.length === 0) {
      if (imported.length > 0) openTiktokSortForIds(imported.map(item => item.photoId!));
      return false;
    }
    try {
      const result = await deleteNativePhotos(native.map(item => item.uri));
      if (result.cancelled) return false;
      const skipped = new Set(result.skippedUris);
      const removed = native.filter(item => !skipped.has(item.uri));
      if (removed.length === 0) return false;
      rememberFreed(removed);
      const consumesFull = decision.kind === 'all' && decision.consumesFull;
      const consumesDaily = decision.kind === 'blocked' ? 0 : decision.consumesDaily;
      if (consumesFull || consumesDaily > 0) {
        const next = commitAiClean(ai, decision);
        setAi(next);
        writeAiCleanState(next);
      }
      return true;
    } catch {
      setNotice(tr('clean.scanFailed'));
      return false;
    }
  };

  const cleanAll = (basket: CleanBasket) => {
    const decision = decideAiClean({ count: basket.items.length, premium, enforced: premiumLocked, state: ai });
    if (decision.kind === 'blocked') {
      setNotice(tr('clean.ai.blocked'));
      gatePremium('aiClean');
      return;
    }
    if (decision.kind === 'partial') {
      setPartial({ basket, decision });
      gatePremium('aiClean');
      return;
    }
    void performDelete(basket.items, decision);
  };

  const compress = async (item: CleanItem) => {
    const estimate = estimateSavedBytes(item.bytes, item.width, item.height);
    if (premiumLocked || !isVideoCompressAvailable()) {
      setNotice(tr('clean.videos.premium') + ' ' + tr('clean.videos.estimate', { size: formatSize(estimate) }));
      if (premiumLocked) gatePremium('videoCompress');
      return;
    }
    setCompressing(item.uri);
    try {
      const result = await compressVideo({ uri: item.uri, bytes: item.bytes, name: item.name });
      if (!keepOriginal) {
        const deleted = await deleteNativePhotos([item.uri]);
        if (!deleted.cancelled && !deleted.skippedUris.includes(item.uri)) {
          rememberFreed([{ ...item, bytes: Math.max(result.savedBytes, item.bytes - result.newBytes) }]);
        }
      }
      setNotice(tr('clean.videos.saved', { size: formatSize(result.savedBytes) }));
    } catch {
      setNotice(tr('clean.videos.failed'));
    } finally {
      setCompressing(null);
    }
  };

  const share = () => {
    void shareCleanResult(locale, formatSize(freed), files);
  };

  const oldShots = expiredShots(
    baskets.find(basket => basket.id === 'screenshots')?.items ?? [],
    Date.now()
  );

  const [celebrate, setCelebrate] = useState<string | null>(null);
  const freedBefore = useRef(freed);
  useEffect(() => {
    if (freed > freedBefore.current) {
      setCelebrate(formatSize(freed - freedBefore.current));
      const timer = window.setTimeout(() => setCelebrate(null), 1600);
      freedBefore.current = freed;
      return () => window.clearTimeout(timer);
    }
    freedBefore.current = freed;
  }, [freed]);

  const chips: BasketId[] = ['duplicates', 'bursts', 'blurry', 'screenshots', 'videos', 'messengers'];
  const eyes = baskets.find(basket => basket.id === 'eyes');
  if (eyes && eyes.items.length > 0) chips.splice(4, 0, 'eyes');
  const [chip, setChip] = useState<BasketId>('blurry');
  const [accent, setAccent] = useState('#7dfff4');
  const shownFreed = useRolled(freed);
  const active = baskets.find(basket => basket.id === chip) ?? { id: chip, items: [] as CleanItem[], bytes: 0 };
  const [index, setIndex] = useState(0);
  const [sheet, setSheet] = useState(false);
  useEffect(() => { setIndex(0); setSheet(false); }, [chip]);
  useEffect(() => {
    document.documentElement.style.setProperty('--deck-accent', accent);
    document.documentElement.style.setProperty('--deck-ink', inkForAccent(accent));
  }, [accent]);
  const selectChip = (id: BasketId) => {
    if (id === chip) return;
    tickHaptic('chip');
    withViewTransition(() => setChip(id));
  };
  const item = active.items[Math.min(index, Math.max(0, active.items.length - 1))];
  const chipName = (id: BasketId) => (id === 'messengers' || id === 'videos') ? tr(`clean.chip.${id}`) : tr(`clean.basket.${id}`);

  const onDeckDelete = () => {
    if (!item) return;
    tickHaptic('delete');
    if (item.photoId && item.uri.startsWith('app:')) {
      openTiktokSortForIds([item.photoId]);
      return;
    }
    void performDelete([item], { kind: 'all', consumesFull: false, consumesDaily: 0 });
    setIndex(value => value + 1);
  };
  const onDeckKeep = () => {
    tickHaptic('keep');
    setIndex(value => value + 1);
  };

  return (
    <section className="deck-app" aria-label={tr('clean.title')}>
      <div className="orbit-aurora" aria-hidden="true" />
      {celebrate && <CleanCelebrate label={tr('clean.freed', { size: celebrate })} />}
      <header className="deck-bar">
        <div className="deck-bar-row">
          <h1>{tr('clean.title')}</h1>
          <div className="deck-meter">
            <StorageOrb compact ratio={Math.min(1, shownFreed / 8_000_000_000)} accent={accent} />
            <button type="button" className="deck-freed" onClick={() => { void share(); }} disabled={freed <= 0}>
              <b>{freed > 0 ? formatSize(shownFreed) : '0'}</b>
              <span>{tr('clean.share.kicker')}</span>
            </button>
          </div>
        </div>
        <div className="deck-chips" role="tablist" aria-label={tr('clean.title')}>
          {chips.map(id => {
            const basket = baskets.find(entry => entry.id === id);
            const count = basket?.items.length ?? 0;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={chip === id}
                onClick={() => selectChip(id)}
              >
                <ChipMark id={id} />
                {chipName(id)}
                <span aria-hidden="true">{count}</span>
              </button>
            );
          })}
        </div>
        <ScanBar />
      </header>

      <div className="deck-stage">
        {scanning && active.items.length === 0 && <div className="deck-skeleton" aria-hidden="true" />}
        {chip === 'videos' ? (
          <ul className="deck-videos">
            {scan && !scan.videosGranted && (
              <li>
                <button type="button" className="ghost" onClick={() => { void requestVideoAccess().then(() => refresh()); }}>
                  {tr('clean.videos.needPermission')}
                </button>
              </li>
            )}
            {active.items.length === 0 && <li className="deck-empty">{tr('clean.videos.empty')}</li>}
            {active.items.map(video => (
              <li key={video.uri}>
                <DeckImage item={video} />
                <div>
                  <strong>{video.name}</strong>
                  <span>{formatSize(video.bytes)}</span>
                </div>
                <button type="button" className="ghost" onClick={() => { void performDelete([video], { kind: 'all', consumesFull: false, consumesDaily: 0 }); }}>
                  {tr('clean.videos.delete')}
                </button>
                <button type="button" className="btn-accent" disabled={compressing === video.uri} onClick={() => { void compress(video); }}>
                  {compressing === video.uri ? tr('clean.videos.compressing') : tr('clean.videos.compress')}
                </button>
              </li>
            ))}
          </ul>
        ) : item ? (
          <PhotoDeck key={item.uri} item={item} onDelete={onDeckDelete} onKeep={onDeckKeep} onAccent={setAccent} deleteLabel={tr('clean.swipe.delete')} keepLabel={tr('clean.swipe.keep')} hint={tr('clean.swipe.hint')} />
        ) : (
          <div className="deck-empty">
            <OrbitCleanIcon />
            <p>{scanning ? tr('clean.scanning') : tr('clean.empty')}</p>
          </div>
        )}
      </div>

      <div className={sheet ? 'deck-sheet open' : 'deck-sheet'}>
        <button type="button" className="deck-sheet-handle" aria-expanded={sheet} onClick={() => setSheet(open => !open)}>
          {item ? `${item.name} · ${formatSize(item.bytes)}` : chipName(chip)}
        </button>
        {notice && <p className="clean-notice" role="status">{notice}</p>}
        {scanError && (
          <p role="alert">{tr('clean.scanFailed')} <button type="button" className="ghost" onClick={() => { void refresh(); }}>{tr('clean.retry')}</button></p>
        )}
        {scan && !scan.granted && (
          <p>{tr('clean.permission')} <button type="button" className="ghost" onClick={() => { void refresh(); }}>{tr('clean.grant')}</button></p>
        )}
        {'keeper' in active && active.keeper && (
          <p className="clean-keeper">
            {active.keeper.groups > 1 ? tr('clean.best.groups', { count: active.keeper.groups }) : tr('clean.best.line', { name: active.keeper.name })}
          </p>
        )}
        {chip !== 'videos' && active.items.length > 0 && (
          <button type="button" className="btn-accent" onClick={() => cleanAll(active as CleanBasket)}>{tr('clean.cleanAll')}</button>
        )}
        {undo && (
          <div className="deck-undo" role="status">
            <span>{tr('clean.undo.removed', { name: undo.items[0]?.name ?? '' })}</span>
            <button type="button" onClick={restoreUndo}><UndoIcon />{tr('clean.undo')}</button>
          </div>
        )}
        {sheet && (
          <div className="deck-sheet-body">
            {!isCleanScanAvailable() && <p>{tr('clean.webNote')}</p>}
            {chip === 'videos' && <p>{tr('clean.videos.lead')}</p>}
            {chip === 'videos' && (
              <label className="clean-keep">
                <input type="checkbox" checked={keepOriginal} onChange={event => setKeepOriginal(event.target.checked)} />
                {tr('clean.videos.keepOriginal')}
              </label>
            )}
            <button type="button" className="ghost" disabled={freed <= 0} onClick={() => { void share(); }}>{tr('clean.share.card')}</button>
            <button type="button" className="ghost" onClick={() => setProMode(true)}>{tr('clean.pro')}</button>
            {partial && (
              <div className="clean-partial">
                <p>{tr('clean.ai.partial', { take: partial.decision.take, count: partial.basket.items.length })}</p>
                <button type="button" className="btn-accent" onClick={() => {
                  const slice = partial.basket.items.slice(0, partial.decision.take);
                  setPartial(null);
                  void performDelete(slice, partial.decision);
                }}>{tr('clean.ai.partialGo', { take: partial.decision.take })}</button>
                <button type="button" className="ghost" onClick={() => setPartial(null)}>{tr('clean.continueFree')}</button>
              </div>
            )}
            {auto.expireScreenshots && oldShots.length > 0 && (
              <button type="button" className="ghost" onClick={() => setChip('screenshots')}>
                {tr('clean.auto.screenshots')} · {oldShots.length}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ScanBar() {
  const progress = useStore(s => s.progress);
  const cancelImport = useStore(s => s.cancelImport);
  const importCancelling = useStore(s => s.importCancelling);
  const locale = useStore(s => s.locale);
  if (!progress || progress.phase === 'finalizat') return null;
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 8;
  const label = progress.phase === 'grupare'
    ? t(locale, 'app.progress.grouping')
    : progress.fileName
      ? (progress.etaSeconds !== undefined
        ? t(locale, 'app.progress.scanningEta', { done: progress.done, total: progress.total, fileName: progress.fileName, eta: formatEta(progress.etaSeconds) })
        : t(locale, 'app.progress.scanning', { done: progress.done, total: progress.total, fileName: progress.fileName }))
      : (progress.total
        ? t(locale, 'app.progress.reading', { done: progress.done, total: progress.total })
        : t(locale, 'app.progress.readingUnknown', { done: progress.done }));
  return (
    <div className="orbit-progress" role="status" aria-live="polite">
      <div className="orbit-progress-row">
        <span>{label}</span>
        <b>{progress.total ? `${progress.done}/${progress.total}` : '…'}</b>
      </div>
      <div className="orbit-progress-track" aria-hidden="true">
        <span style={{ width: `${Math.max(4, Math.min(100, pct))}%` }} />
      </div>
      <button type="button" className="ghost" onClick={() => cancelImport()} disabled={importCancelling}>
        {t(locale, importCancelling ? 'app.progress.cancelling' : 'app.progress.cancel')}
      </button>
    </div>
  );
}

function CleanCelebrate({ label }: { label: string }) {
  return (
    <div className="orbit-celebrate" role="status">
      <strong>{label}</strong>
      {Array.from({ length: 16 }, (_, i) => <i key={i} style={{ ['--i' as string]: i }} />)}
    </div>
  );
}

function PhotoDeck(props: {
  item: CleanItem;
  onDelete: () => void;
  onKeep: () => void;
  onAccent: (accent: string) => void;
  deleteLabel: string;
  keepLabel: string;
  hint: string;
}) {
  const { item, onDelete, onKeep, onAccent, deleteLabel, keepLabel, hint } = props;
  const [drag, setDrag] = useState(0);
  const [origin, setOrigin] = useState<number | null>(null);
  const [leaving, setLeaving] = useState<-1 | 0 | 1>(0);
  const velocity = useRef(0);
  const lastPoint = useRef({ x: 0, t: 0 });

  const go = (direction: 'keep' | 'delete') => {
    if (motionAllowed()) setLeaving(direction === 'delete' ? -1 : 1);
    if (direction === 'delete') onDelete();
    else onKeep();
  };

  return (
    <div className="deck-photo-wrap">
      <p className="deck-hint">{hint}</p>
      <div
        className={`deck-photo${leaving < 0 ? ' leaving-left' : leaving > 0 ? ' leaving-right' : ''}`}
        style={leaving === 0 ? { transform: `translate3d(${drag}px, ${Math.abs(drag) * 0.03}px, 0) rotate(${drag / 22}deg)` } : undefined}
        onPointerDown={event => {
          if (leaving !== 0) return;
          setOrigin(event.clientX);
          velocity.current = 0;
          lastPoint.current = { x: event.clientX, t: performance.now() };
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (origin === null || leaving !== 0) return;
          const now = performance.now();
          velocity.current = (event.clientX - lastPoint.current.x) / Math.max(1, now - lastPoint.current.t);
          lastPoint.current = { x: event.clientX, t: now };
          setDrag(event.clientX - origin);
        }}
        onPointerUp={() => {
          const projected = drag + velocity.current * 160;
          if (projected <= -80) go('delete');
          else if (projected >= 80) go('keep');
          else { setDrag(0); setOrigin(null); }
        }}
        onPointerCancel={() => { setDrag(0); setOrigin(null); }}
      >
        <span className={`clean-stamp delete${drag < -36 ? ' on' : ''}`}>{deleteLabel}</span>
        <span className={`clean-stamp keep${drag > 36 ? ' on' : ''}`}>{keepLabel}</span>
        <DeckImage item={item} onAccent={onAccent} />
        {leaving < 0 && (
          <span className="orbit-burst" aria-hidden="true">
            {Array.from({ length: 10 }, (_, i) => <i key={i} style={{ ['--i' as string]: i }} />)}
          </span>
        )}
      </div>
      <div className="deck-choices">
        <button type="button" className="clean-choice delete" onClick={() => go('delete')}><TrashIcon />{deleteLabel}</button>
        <button type="button" className="clean-choice keep" onClick={() => go('keep')}><CheckIcon />{keepLabel}</button>
      </div>
    </div>
  );
}

function DeckImage({ item, onAccent }: { item: CleanItem; onAccent?: (accent: string) => void }) {
  const lqip = useStore(s => item.photoId ? s.photos.find(photo => photo.id === item.photoId)?.lqip : undefined);
  const [src, setSrc] = useState<string | null>(lqip ?? (item.photoId ? peekThumbUrl(item.photoId) : null));
  useEffect(() => {
    let alive = true;
    if (item.uri.startsWith('content:') || item.uri.startsWith('file:')) {
      setSrc(Capacitor.convertFileSrc(item.uri));
      return;
    }
    if (!item.photoId) return;
    void getCachedThumbUrl(item.photoId).then(url => { if (alive && url) setSrc(url); }).catch(() => {});
    return () => { alive = false; };
  }, [item.uri, item.photoId]);
  if (!src) return <div className="deck-fallback">{item.name}</div>;
  return (
    <img
      src={src}
      alt={item.name}
      onLoad={event => {
        if (!onAccent) return;
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 16;
          canvas.height = 16;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(event.currentTarget, 0, 0, 16, 16);
          onAccent(accentFromPixels(ctx.getImageData(0, 0, 16, 16).data));
        } catch {
          // O poză din alt origin nu lasă pixelii să iasă din canvas.
        }
      }}
    />
  );
}

const CHIP_ICON: Record<BasketId, typeof CopyIcon> = {
  duplicates: CopyIcon,
  bursts: ApertureIcon,
  blurry: FocusIcon,
  screenshots: CropIcon,
  videos: PlayIcon,
  messengers: LayersIcon,
  eyes: EyeClosedIcon
};

function ChipMark({ id }: { id: BasketId }) {
  const Icon = CHIP_ICON[id];
  return <Icon width={14} height={14} />;
}

function useRolled(value: number): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (!motionAllowed()) {
      from.current = value;
      setShown(value);
      return;
    }
    const startValue = from.current;
    const started = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / 720);
      const eased = 1 - (1 - t) ** 3;
      const next = Math.round(startValue + (value - startValue) * eased);
      setShown(next);
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}
