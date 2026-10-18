import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { t } from '../i18n';
import {
  basketsFromLibrary, basketsFromScan, estimateSavedBytes, type CleanBasket, type CleanItem
} from '../core/cleanScan';
import { expiredShots, readAutoClean, reminderDue, writeAutoClean, type AutoCleanSettings } from '../core/autoClean';
import {
  commitAiClean, decideAiClean, readAiCleanState, writeAiCleanState, type AiCleanDecision, type AiCleanState
} from '../core/aiCleanAllowance';
import { isCleanScanAvailable, requestVideoAccess, scanGallery, type GalleryScan } from '../core/nativeCleanScan';
import { compressVideo, isVideoCompressAvailable } from '../core/nativeVideoCompress';
import { deleteNativePhotos } from '../core/nativeMediaLibrary';
import { requestNotificationAccess, showNotification } from '../core/nativeNotifications';
import { cancelCleanReminder, cleanReminderIsDue, markCleanReminderShown, scheduleCleanReminder } from '../core/cleanReminder';
import { shareCleanResult } from './shareResultCard';
import { DEFECT_EYES_OPEN_RATIO, DEFECT_SHARPNESS } from '../core/importPipeline';
import { addFreedBytes, addFreedFiles, readFreedBytes, readFreedFiles } from '../state/storageFreed';
import { formatSize } from '../state/storageStats';
import { maybeAskForReviewAfterFreed } from '../state/reviewPrompt';
import { CleanSwipe } from './CleanSwipe';
import { StorageOrb } from './StorageOrb';
import { getCachedThumbUrl, peekThumbUrl } from '../core/thumbUrlCache';
import { formatEta } from '../core/formatTime';
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
  const [swipe, setSwipe] = useState<CleanBasket | null>(null);
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

  const videos = baskets.find(basket => basket.id === 'videos') ?? { id: 'videos' as const, items: [], bytes: 0 };
  const photoBaskets = baskets.filter(basket => basket.id !== 'videos' && basket.items.length > 0);
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
    maybeAskForReviewAfterFreed(total);
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

  const review = (basket: CleanBasket) => {
    const imported = basket.items.every(item => item.uri.startsWith('app:'));
    if (imported) {
      openTiktokSortForIds(basket.items.map(item => item.photoId!).filter(Boolean));
      return;
    }
    setSwipe(basket);
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

  const ring = freed + reclaimable;
  const ringRatio = ring > 0 ? Math.min(1, freed / ring) : 0.08;
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

  return (
    <section className="clean-home orbit-clean" aria-label={tr('clean.title')}>
      <div className="orbit-aurora" aria-hidden="true" />
      {celebrate && <CleanCelebrate label={tr('clean.freed', { size: celebrate })} />}
      <ScanBar />
      <header className="orbit-hero">
        <StorageOrb ratio={ringRatio} label={freed > 0 ? formatSize(freed) : '0'} caption={tr('clean.share.kicker')} />
        <div className="orbit-hero-copy">
          <p className="orbit-kicker">{tr('clean.privacy')}</p>
          <h2>{tr('clean.title')}</h2>
          <p className="clean-freed-value">{freed > 0 ? tr('clean.freed', { size: formatSize(freed) }) : tr('clean.freed.none')}</p>
          <p className="clean-lead">{tr('clean.lead')}</p>
          <div className="orbit-actions">
            <button type="button" className="ghost" disabled={freed <= 0} onClick={() => { void share(); }}>{tr('clean.share.card')}</button>
            <button type="button" className="ghost" onClick={() => setProMode(true)}>{tr('clean.pro')}</button>
          </div>
        </div>
      </header>

      {scanning && <p className="clean-muted" role="status">{tr('clean.scanning')}</p>}
      {scanning && photoBaskets.length === 0 && (
        <ul className="orbit-baskets" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => <li key={i} className="orbit-skeleton" />)}
        </ul>
      )}
      {scanError && (
        <p className="clean-muted" role="alert">
          {tr('clean.scanFailed')} <button type="button" className="ghost" onClick={() => { void refresh(); }}>{tr('clean.retry')}</button>
        </p>
      )}
      {!isCleanScanAvailable() && <p className="clean-muted">{tr('clean.webNote')}</p>}
      {scan && !scan.granted && (
        <p className="clean-muted">
          {tr('clean.permission')} <button type="button" className="ghost" onClick={() => { void refresh(); }}>{tr('clean.grant')}</button>
        </p>
      )}
      {notice && <p className="clean-notice" role="status">{notice}</p>}
      {partial && (
        <div className="clean-partial">
          <p>{tr('clean.ai.partial', { take: partial.decision.take, count: partial.basket.items.length })}</p>
          <button
            type="button"
            className="btn-accent"
            onClick={() => {
              const slice = partial.basket.items.slice(0, partial.decision.take);
              setPartial(null);
              void performDelete(slice, partial.decision);
            }}
          >
            {tr('clean.ai.partialGo', { take: partial.decision.take })}
          </button>
          <button type="button" className="ghost" onClick={() => setPartial(null)}>{tr('clean.continueFree')}</button>
        </div>
      )}

      <ul className="orbit-baskets">
        {photoBaskets.map(basket => (
          <li key={basket.id} className="orbit-basket">
            <div className="orbit-basket-top">
              <strong>{tr(`clean.basket.${basket.id}`)}</strong>
              <b>{formatSize(basket.bytes)}</b>
            </div>
            <span>{tr('clean.items', { count: basket.items.length })}</span>
            <BasketStrip items={basket.items} compare={!!basket.keeper} />
            {basket.keeper && (
              <span className="clean-keeper">
                {basket.keeper.groups > 1
                  ? tr('clean.best.groups', { count: basket.keeper.groups })
                  : tr('clean.best.line', { name: basket.keeper.name })}
              </span>
            )}
            <div className="orbit-basket-actions">
              <button type="button" className="ghost" onClick={() => review(basket)}>{tr('clean.review')}</button>
              <button type="button" className="btn-accent" onClick={() => cleanAll(basket)}>{tr('clean.cleanAll')}</button>
            </div>
          </li>
        ))}
      </ul>
      {photoBaskets.length === 0 && !scanning && <p className="clean-muted">{tr('clean.empty')}</p>}

      <section className="orbit-film" aria-label={tr('clean.basket.videos')}>
        <h3>{tr('clean.basket.videos')}</h3>
        <p className="clean-muted">{tr('clean.videos.lead')}</p>
        {scan && !scan.videosGranted && (
          <button
            type="button"
            className="ghost"
            onClick={() => { void requestVideoAccess().then(() => refresh()); }}
          >
            {tr('clean.videos.needPermission')}
          </button>
        )}
        {videos.items.length === 0 && <p className="clean-muted">{tr('clean.videos.empty')}</p>}
        <label className="clean-keep">
          <input type="checkbox" checked={keepOriginal} onChange={event => setKeepOriginal(event.target.checked)} />
          {tr('clean.videos.keepOriginal')}
        </label>
        <ul className="orbit-filmstrip">
          {videos.items.map(item => (
            <li key={item.uri} className="orbit-video">
              <div>
                <strong>{item.name}</strong>
                <span>{formatSize(item.bytes)}</span>
              </div>
              <div className="clean-basket-actions">
                <button type="button" className="ghost" onClick={() => { void performDelete([item], { kind: 'all', consumesFull: false, consumesDaily: 0 }); }}>
                  {tr('clean.videos.delete')}
                </button>
                <button type="button" className="btn-accent" disabled={compressing === item.uri} onClick={() => { void compress(item); }}>
                  {compressing === item.uri ? tr('clean.videos.compressing') : tr('clean.videos.compress')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {auto.expireScreenshots && oldShots.length > 0 && (
        <button type="button" className="ghost orbit-expire" onClick={() => review({ id: 'screenshots', items: oldShots, bytes: oldShots.reduce((sum, item) => sum + item.bytes, 0) })}>
          {tr('clean.auto.screenshots')} · {oldShots.length}
        </button>
      )}

        {swipe && (
        <CleanSwipe
          basket={swipe}
          onClose={() => setSwipe(null)}
          onDeleted={items => performDelete(items, { kind: 'all', consumesFull: false, consumesDaily: 0 })}
        />
      )}
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

function BasketStrip({ items, compare }: { items: CleanItem[]; compare: boolean }) {
  const shown = items.slice(0, compare ? 2 : 5);
  return (
    <div className={compare ? 'orbit-masonry orbit-compare' : 'orbit-masonry'}>
      {shown.map(item => <BasketThumb key={item.uri} item={item} />)}
    </div>
  );
}

function BasketThumb({ item }: { item: CleanItem }) {
  const lqip = useStore(s => item.photoId ? s.photos.find(photo => photo.id === item.photoId)?.lqip : undefined);
  const [src, setSrc] = useState<string | null>(lqip ?? peekThumbUrl(item.photoId ?? '') ?? null);
  useEffect(() => {
    if (!item.photoId) return;
    let alive = true;
    void getCachedThumbUrl(item.photoId).then(url => { if (alive && url) setSrc(url); }).catch(() => {});
    return () => { alive = false; };
  }, [item.photoId]);
  if (!src) return <span className="orbit-skel-thumb" />;
  return <img src={src} alt="" />;
}
