import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type PhotoView } from '../state/store';
import { db, type AnalysisRecord } from '../core/db';
import { buildAlbums, type AlbumPhoto, type BuiltAlbums } from '../core/albums';
import { planKeptCorrections, freeSample, type CorrectionPlan, type CorrectablePhoto } from '../core/autoCorrect';
import { copyAlbumToPictures, canCopyAlbumOnDevice } from '../core/albumExport';
import { findUnrecognizedFaceClusters } from '../core/faceClustering';
import { findUnnamedPetClusters } from '../core/petIdentity';
import { isPremium } from '../core/entitlement';
import { useModalFocusTrap } from './useModalFocusTrap';
import { AdjustedImage } from './AdjustedImage';
import { getCachedPreviewUrl } from '../core/previewUrlCache';
import {
  ChevronLeft, SearchIcon, ShieldIcon, StarIcon, XIcon, UploadIcon, CopyIcon, SparkleIcon
} from './icons';
import { t, plural } from '../i18n';
import type { EditAdjustments } from '../core/imageAdjust';

const LATER_KEY = 'lumin-album-name-later';
const PET_LATER_KEY = 'lumin-album-pet-later';

function toAlbumPhoto(photo: PhotoView, pet?: { petLabel?: string; petName?: string; petEmbedding?: number[] }): AlbumPhoto {
  return {
    id: photo.id,
    fileName: photo.fileName,
    capturedAt: photo.capturedAt,
    status: photo.status,
    groupId: photo.groupId,
    aiScore: photo.aiScore,
    faceCount: photo.faceCount,
    personNames: photo.personNames,
    petLabel: pet?.petLabel,
    petName: pet?.petName ?? photo.petNames?.[0],
    petEmbedding: pet?.petEmbedding,
    sceneTags: photo.sceneTags,
    textCoverage: photo.textCoverage,
    aside: photo.aside,
    gpsLatitude: photo.gpsLatitude,
    gpsLongitude: photo.gpsLongitude
  };
}

function cap(label: string): string {
  return label ? label.slice(0, 1).toUpperCase() + label.slice(1) : label;
}

function hue(name: string): number {
  let n = 0;
  for (let i = 0; i < name.length; i++) n = (n * 33 + name.charCodeAt(i)) % 360;
  return n;
}

function AlbumThumb({ photoId }: { photoId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    void db.thumbnails.get(photoId).then(rec => {
      if (rec && alive) {
        url = URL.createObjectURL(rec.blob);
        setSrc(url);
      }
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [photoId]);
  return src ? <img src={src} alt="" /> : <span className="album-thumb-empty" />;
}

function formatWhen(ms: number | undefined, locale: 'ro' | 'en'): string {
  if (ms === undefined) return '';
  return new Date(ms).toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fixLine(plan: CorrectionPlan, tr: (key: string, params?: Record<string, string | number>) => string): { key: string; label: string; value: string }[] {
  const rows: { key: string; label: string; value: string }[] = [];
  const a = plan.adjustments;
  if (plan.fixes.includes('exposure')) {
    const ev = (a.exposure / 50).toLocaleString('ro-RO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    rows.push({ key: 'exposure', label: tr('albums.fix.exposure'), value: `${a.exposure > 0 ? '+' : ''}${ev} EV` });
  }
  if (plan.fixes.includes('highlights')) rows.push({ key: 'highlights', label: tr('albums.fix.highlights'), value: tr('albums.fix.recovered') });
  if (plan.fixes.includes('shadows')) rows.push({ key: 'shadows', label: tr('albums.fix.shadows'), value: `+${a.shadows}%` });
  if (plan.fixes.includes('straighten')) {
    const deg = Math.abs(a.rotationDeg ?? 0).toLocaleString('ro-RO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    rows.push({ key: 'straighten', label: tr('albums.fix.horizon'), value: tr('albums.fix.straightened', { deg }) });
  }
  if (plan.fixes.includes('crop')) rows.push({ key: 'crop', label: tr('albums.fix.crop'), value: tr('albums.fix.thirds') });
  return rows;
}

type Screen =
  | { kind: 'list' }
  | { kind: 'person'; name: string }
  | { kind: 'pet'; name: string }
  | { kind: 'pile'; title: string; ids: string[] }
  | { kind: 'correct' };

export function AlbumsPanel() {
  const open = useStore(s => s.albumsOpen);
  const setOpen = useStore(s => s.setAlbumsOpen);
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);
  const protectedPersons = useStore(s => s.protectedPersons);
  const toggleProtectedPerson = useStore(s => s.toggleProtectedPerson);
  const askPrompt = useStore(s => s.askPrompt);
  const askConfirm = useStore(s => s.askConfirm);
  const enrollFaceCluster = useStore(s => s.enrollFaceCluster);
  const enrollPetCluster = useStore(s => s.enrollPetCluster);
  const setNotice = useStore(s => s.setNotice);
  const rejectExactDuplicates = useStore(s => s.rejectExactDuplicates);
  const addCorrectedCopies = useStore(s => s.addCorrectedCopies);
  const setPremiumOpen = useStore(s => s.setPremiumOpen);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale === 'en' ? 'en' : 'ro', key, params);

  const [screen, setScreen] = useState<Screen>({ kind: 'list' });
  const [query, setQuery] = useState('');
  const [later, setLater] = useState(() => sessionStorage.getItem(LATER_KEY) === '1');
  const [petLater, setPetLater] = useState(() => sessionStorage.getItem(PET_LATER_KEY) === '1');
  const [petRows, setPetRows] = useState<Map<string, { petLabel?: string; petName?: string; petEmbedding?: number[] }>>(new Map());
  const [naming, setNaming] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [plans, setPlans] = useState<CorrectionPlan[]>([]);
  const [planIndex, setPlanIndex] = useState(0);
  const [wipe, setWipe] = useState(55);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void db.analyses.toArray().then(rows => {
      if (!alive) return;
      const map = new Map<string, { petLabel?: string; petName?: string; petEmbedding?: number[] }>();
      for (const row of rows) {
        if (!row.petEmbedding && !row.petName && !row.petLabel) continue;
        map.set(row.photoId, { petLabel: row.petLabel, petName: row.petName, petEmbedding: row.petEmbedding });
      }
      setPetRows(map);
    });
    return () => { alive = false; };
  }, [open, photos]);

  const albums: BuiltAlbums = useMemo(
    () => buildAlbums(photos.map(p => toAlbumPhoto(p, petRows.get(p.id))), locale === 'en' ? 'en' : 'ro'),
    [photos, locale, petRows]
  );

  useEffect(() => {
    if (!open) {
      setScreen({ kind: 'list' });
      setQuery('');
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (screen.kind !== 'list') setScreen({ kind: 'list' });
      else setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, screen.kind, setOpen]);

  const currentPlan = plans[planIndex];
  useEffect(() => {
    if (screen.kind !== 'correct' || !currentPlan) {
      setPreviewUrl(null);
      return;
    }
    let alive = true;
    void getCachedPreviewUrl(currentPlan.photoId).then(next => {
      if (alive) setPreviewUrl(next);
    });
    return () => { alive = false; };
  }, [screen.kind, currentPlan]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const people = albums.people.filter(p => !q || p.name.toLowerCase().includes(q));
  const namedPets = albums.namedPets.filter(p => !q || p.name.toLowerCase().includes(q) || p.label.includes(q));
  const animals = albums.animals.filter(a => !q || a.label.includes(q));
  const events = albums.events.filter(e => !q || e.title.toLowerCase().includes(q));

  const openCorrect = async (onlyIds?: Set<string>) => {
    const selected = photos.filter(p => p.status === 'selected' && (!onlyIds || onlyIds.has(p.id)));
    const analyses = await db.analyses.bulkGet(selected.map(p => p.id));
    const byId = new Map<string, AnalysisRecord>();
    selected.forEach((p, i) => { const row = analyses[i]; if (row) byId.set(p.id, row); });
    const input: CorrectablePhoto[] = selected.map(p => {
      const a = byId.get(p.id);
      return {
        id: p.id,
        status: p.status,
        aiScore: p.aiScore,
        sharpness: a?.sharpness ?? p.sharpness,
        exposure: a?.exposure ?? p.exposure,
        faceCount: p.faceCount,
        highlightClipping: a?.highlightClipping ?? p.highlightClipping,
        shadowClipping: a?.shadowClipping ?? p.shadowClipping,
        horizonTiltDeg: a?.horizonTiltDeg,
        ruleOfThirds: a?.ruleOfThirds ?? p.ruleOfThirds,
        faces: a?.faces?.map(f => ({ box: f.box }))
      };
    });
    const next = planKeptCorrections(input);
    if (!next.length) {
      setNotice(tr('albums.correct.none'));
      return;
    }
    setPlans(next);
    setPlanIndex(0);
    setWipe(55);
    setScreen({ kind: 'correct' });
  };

  const applyPlans = async () => {
    const { allowed, locked } = freeSample(plans, isPremium());
    const n = await addCorrectedCopies(allowed.map(plan => ({ sourceId: plan.photoId, adjustments: plan.adjustments })));
    if (locked.length) {
      setNotice(tr('albums.correct.sample', { count: n, locked: locked.length }));
      setPremiumOpen(true);
    }
    setScreen({ kind: 'list' });
  };

  const exportIds = async (title: string, ids: string[]) => {
    const byId = new Map(photos.map(p => [p.id, p]));
    const items = ids.map(id => byId.get(id)).filter((p): p is PhotoView => !!p && !!p.mediaUri)
      .map(p => ({ uri: p.mediaUri as string, name: p.fileName }));
    if (!items.length) {
      setNotice(tr('albums.export.noUri'));
      return;
    }
    if (!canCopyAlbumOnDevice()) {
      setNotice(tr('albums.export.phoneOnly'));
      return;
    }
    setExporting(true);
    try {
      const result = await copyAlbumToPictures(title, items);
      setNotice(tr('albums.export.done', { count: result.copied, album: title }));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : tr('albums.export.phoneOnly'));
    } finally {
      setExporting(false);
    }
  };

  const nameUnnamed = async () => {
    const name = await askPrompt(tr('albums.name.prompt'), '', { confirmLabel: tr('albums.name.confirm') });
    const trimmed = name?.trim();
    if (!trimmed) return;
    setNaming(true);
    try {
      const [rows, analyses] = await Promise.all([db.photos.toArray(), db.analyses.toArray()]);
      const byId = new Map(analyses.map(a => [a.photoId, a]));
      const clusters = findUnrecognizedFaceClusters(rows.map(p => ({
        id: p.id,
        fileName: p.fileName,
        faces: (byId.get(p.id)?.faces ?? []).map(f => ({ personId: f.personId, embedding: f.embedding, box: f.box }))
      })));
      const top = clusters[0];
      if (!top) {
        setNotice(tr('albums.name.noIdentity'));
        return;
      }
      await enrollFaceCluster(trimmed, top.members.map(m => ({ photoId: m.photoId, faceIndex: m.faceIndex, embedding: m.embedding })));
      if (!useStore.getState().protectedPersons.has(trimmed)) toggleProtectedPerson(trimmed);
      setLater(true);
    } finally {
      setNaming(false);
    }
  };

  const namePet = async () => {
    const name = await askPrompt(tr('albums.pet.prompt'), '', { confirmLabel: tr('albums.name.confirm') });
    const trimmed = name?.trim();
    if (!trimmed) return;
    setNaming(true);
    try {
      const analyses = await db.analyses.toArray();
      const clusters = findUnnamedPetClusters(analyses.map(a => ({
        id: a.photoId,
        petName: a.petName,
        petLabel: a.petLabel,
        petEmbedding: a.petEmbedding
      })));
      const top = clusters[0];
      if (!top) {
        setNotice(tr('albums.pet.none'));
        return;
      }
      await enrollPetCluster(trimmed, top.members.map(m => ({ photoId: m.photoId })));
      if (!useStore.getState().protectedPersons.has(trimmed)) toggleProtectedPerson(trimmed);
      setPetLater(true);
    } finally {
      setNaming(false);
    }
  };

  const cleanDuplicates = async (ids: string[]) => {
    const mine = new Set(ids);
    const subset = photos.filter(p => mine.has(p.id));
    const extras: string[] = [];
    const groups = new Map<string, PhotoView[]>();
    for (const p of subset) {
      if (!p.groupId) continue;
      const list = groups.get(p.groupId) ?? [];
      list.push(p);
      groups.set(p.groupId, list);
    }
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const keep = members.find(m => m.status === 'selected') ?? members.reduce((a, b) => (a.aiScore >= b.aiScore ? a : b));
      for (const m of members) if (m.id !== keep.id && m.status !== 'rejected') extras.push(m.id);
    }
    if (!extras.length) {
      setNotice(tr('albums.dupes.none'));
      return;
    }
    const ok = await askConfirm(tr('albums.dupes.confirm', { count: extras.length }), { confirmLabel: tr('albums.dupes.go'), danger: true });
    if (!ok) return;
    await rejectExactDuplicates(extras);
    setNotice(tr('albums.dupes.done', { count: extras.length }));
  };

  const person = screen.kind === 'person'
    ? albums.people.find(p => p.name === screen.name)
    : screen.kind === 'pet'
      ? albums.namedPets.find(p => p.name === screen.name)
      : undefined;

  return (
    <div className="detail">
      <div className="detail-inner wide album-sheet" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('albums.title')} tabIndex={-1}>
        {screen.kind === 'list' && (
          <>
            <header className="detail-head">
              <span>{tr('albums.title')}</span>
              <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}><XIcon /></button>
            </header>
            <p className="hint">{tr('albums.subtitle')}</p>
            <label className="album-search">
              <SearchIcon aria-hidden="true" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder={tr('albums.search')} />
            </label>

            {albums.unnamedPhotoIds.length > 0 && !later && (
              <section className="album-prompt">
                <div className="album-avatar dashed" aria-hidden="true">?</div>
                <div>
                  <b>{tr('albums.name.title')}</b>
                  <p>{tr('albums.name.sub')}</p>
                  <div className="album-prompt-actions">
                    <button className="primary small-btn" disabled={naming} onClick={() => void nameUnnamed()}>{tr('albums.name.cta')}</button>
                    <button className="ghost small-btn" onClick={() => { sessionStorage.setItem(LATER_KEY, '1'); setLater(true); }}>{tr('albums.name.later')}</button>
                  </div>
                </div>
              </section>
            )}

            <section className="album-block">
              <header>
                <span>{tr('albums.people')}</span>
                <span className="hint">{tr('albums.count', { count: people.length })}</span>
              </header>
              {people.length === 0 ? <p className="hint">{tr('albums.people.empty')}</p> : (
                <div className="album-people">
                  {people.map(p => (
                    <button key={p.name} className="album-person" onClick={() => setScreen({ kind: 'person', name: p.name })}>
                      <span className="album-avatar" style={{ background: `linear-gradient(145deg, hsl(${hue(p.name)} 80% 62%), hsl(${(hue(p.name) + 40) % 360} 70% 48%))` }}>
                        {p.name.slice(0, 1).toUpperCase()}
                        {protectedPersons.has(p.name) && <ShieldIcon className="album-avatar-badge" />}
                      </span>
                      <b>{p.name}</b>
                      <span>{tr(plural(p.photoIds.length, 'albums.photos.one', 'albums.photos.other'), { count: p.photoIds.length })}</span>
                    </button>
                  ))}
                  {albums.unnamedPhotoIds.length > 0 && (
                    <button className="album-person" onClick={() => void nameUnnamed()}>
                      <span className="album-avatar dashed">?</span>
                      <b>{tr('albums.name.short')}</b>
                      <span>{tr(plural(albums.unnamedPhotoIds.length, 'albums.photos.one', 'albums.photos.other'), { count: albums.unnamedPhotoIds.length })}</span>
                    </button>
                  )}
                </div>
              )}
            </section>

            <section className="album-block">
              <header>
                <span>{tr('albums.animals')}</span>
                <span className="hint">{tr('albums.count', { count: namedPets.length + animals.length })}</span>
              </header>
              {albums.unnamedPets.length > 0 && !petLater && (
                <section className="album-prompt">
                  <div className="album-avatar dashed" aria-hidden="true">?</div>
                  <div>
                    <b>{tr('albums.pet.title')}</b>
                    <p>{tr('albums.pet.sub')}</p>
                    <div className="album-prompt-actions">
                      <button className="primary small-btn" disabled={naming} onClick={() => void namePet()}>{tr('albums.name.cta')}</button>
                      <button className="ghost small-btn" onClick={() => { sessionStorage.setItem(PET_LATER_KEY, '1'); setPetLater(true); }}>{tr('albums.name.later')}</button>
                    </div>
                  </div>
                </section>
              )}
              {(namedPets.length > 0 || albums.unnamedPets.length > 0) && (
                <div className="album-people">
                  {namedPets.map(p => (
                    <button key={p.name} className="album-person" onClick={() => setScreen({ kind: 'pet', name: p.name })}>
                      <span className="album-avatar" style={{ background: `hsl(${hue(p.name)} 75% 55%)` }}>
                        {p.name.slice(0, 1).toUpperCase()}
                        {protectedPersons.has(p.name) && <ShieldIcon className="album-avatar-badge" />}
                      </span>
                      <b>{p.name}</b>
                      <span>{tr(plural(p.photoIds.length, 'albums.photos.one', 'albums.photos.other'), { count: p.photoIds.length })}</span>
                    </button>
                  ))}
                  {albums.unnamedPets.length > 0 && (
                    <button className="album-person" onClick={() => void namePet()}>
                      <span className="album-avatar dashed">?</span>
                      <b>{tr('albums.name.short')}</b>
                      <span>{tr(plural(albums.unnamedPets[0].photoIds.length, 'albums.photos.one', 'albums.photos.other'), { count: albums.unnamedPets[0].photoIds.length })}</span>
                    </button>
                  )}
                </div>
              )}
              {animals.length === 0 && namedPets.length === 0 && albums.unnamedPets.length === 0
                ? <p className="hint">{tr('albums.animals.empty')}</p>
                : animals.map(a => (
                  <button key={a.label} className="album-row" onClick={() => setScreen({ kind: 'pile', title: cap(a.label), ids: a.photoIds })}>
                    <span className="album-avatar small" style={{ background: `hsl(${hue(a.label)} 75% 55%)` }}>{a.label.slice(0, 1).toUpperCase()}</span>
                    <span>
                      <b>{cap(a.label)}</b>
                      <span className="hint">{tr(plural(a.photoIds.length, 'albums.photos.one', 'albums.photos.other'), { count: a.photoIds.length })}</span>
                    </span>
                  </button>
                ))}
            </section>

            <section className="album-block">
              <header>
                <span>{tr('albums.events')}</span>
                <span className="hint">{tr('albums.count', { count: events.length })}</span>
              </header>
              {events.length === 0 ? <p className="hint">{tr('albums.events.empty')}</p> : (
                <div className="album-events">
                  {events.map(event => (
                    <button key={event.id} className="album-event" onClick={() => setScreen({ kind: 'pile', title: event.title, ids: event.photoIds })}>
                      <span className="album-event-art" style={{ background: `linear-gradient(160deg, hsl(${hue(event.id)} 70% 58%), hsl(${(hue(event.id) + 50) % 360} 55% 32%))` }} />
                      <b><StarIcon /> {event.title}</b>
                      <span>{tr('albums.event.meta', { count: event.photoIds.length, kept: event.selectedCount })}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="album-block">
              <header><span>{tr('albums.other')}</span></header>
              <div className="album-other">
                <button className="album-other-card" onClick={() => setScreen({ kind: 'pile', title: tr('albums.screenshots'), ids: albums.screenshots })}>
                  <b>{tr('albums.screenshots')}</b>
                  <span>{albums.screenshots.length}</span>
                </button>
                <button className="album-other-card" onClick={() => setScreen({ kind: 'pile', title: tr('albums.documents'), ids: albums.documents })}>
                  <b>{tr('albums.documents')}</b>
                  <span>{albums.documents.length}</span>
                </button>
              </div>
            </section>

            <button className="ghost album-correct-entry" onClick={() => void openCorrect()}>
              <SparkleIcon /> {tr('albums.correct.open')}
            </button>
          </>
        )}

        {(screen.kind === 'person' || screen.kind === 'pet') && person && (
          <>
            <header className="detail-head">
              <button className="ghost icon-btn" onClick={() => setScreen({ kind: 'list' })} aria-label={tr('albums.back')}><ChevronLeft /></button>
              <span>{person.name}</span>
              <span />
            </header>
            <div className="album-person-head">
              <span className="album-avatar large" style={{ background: `linear-gradient(145deg, hsl(${hue(person.name)} 80% 62%), hsl(${(hue(person.name) + 40) % 360} 70% 48%))` }}>{person.name.slice(0, 1).toUpperCase()}</span>
              <div>
                <h2>{person.name}</h2>
                <p className="hint">
                  {tr(plural(person.photoIds.length, 'albums.photos.one', 'albums.photos.other'), { count: person.photoIds.length })}
                  {person.from !== undefined && ` · ${formatWhen(person.from, locale === 'en' ? 'en' : 'ro')}`}
                </p>
                <button className={protectedPersons.has(person.name) ? 'album-protect on' : 'album-protect'} onClick={() => toggleProtectedPerson(person.name)}>
                  <ShieldIcon /> {protectedPersons.has(person.name) ? tr('albums.protected') : tr('albums.protect')}
                </button>
              </div>
            </div>
            {protectedPersons.has(person.name) && <p className="album-protect-note">{tr('albums.protected.note')}</p>}
            <header className="album-block-head">
              <span>{tr('albums.best')}</span>
              <span className="hint">{tr('albums.count', { count: person.selectedIds.length })}</span>
            </header>
            <div className="album-grid">
              {(person.selectedIds.length ? person.selectedIds : person.photoIds).slice(0, 6).map(id => (
                <div key={id} className="album-grid-cell"><AlbumThumb photoId={id} /></div>
              ))}
            </div>
            <div className="album-stats">
              <div><b>{person.seriesCount}</b><span>{tr('albums.stats.series')}</span></div>
              <div><b>{person.selectedIds.length}</b><span>{tr('albums.stats.kept')}</span></div>
              <div><b>{person.duplicateCount}</b><span>{tr('albums.stats.dupes')}</span></div>
            </div>
            <button className="primary album-export" disabled={exporting} onClick={() => void exportIds(person.name, person.photoIds)}>
              <UploadIcon /> {tr('albums.export')}
            </button>
            <p className="hint album-export-note">{tr('albums.export.note')}</p>
            <button className="ghost album-export" disabled={person.duplicateCount === 0} onClick={() => void cleanDuplicates(person.photoIds)}>
              <CopyIcon /> {tr('albums.dupes', { count: person.duplicateCount })}
            </button>
            <button className="ghost album-export" onClick={() => void openCorrect(new Set(person.photoIds))}>
              <SparkleIcon /> {tr('albums.correct.open')}
            </button>
          </>
        )}

        {screen.kind === 'pile' && (
          <>
            <header className="detail-head">
              <button className="ghost icon-btn" onClick={() => setScreen({ kind: 'list' })} aria-label={tr('albums.back')}><ChevronLeft /></button>
              <span>{screen.title}</span>
              <span />
            </header>
            <p className="hint">{tr(plural(screen.ids.length, 'albums.photos.one', 'albums.photos.other'), { count: screen.ids.length })}</p>
            {screen.ids.length === 0 ? <p className="hint">{tr('albums.emptyPile')}</p> : (
              <div className="album-grid">
                {screen.ids.slice(0, 12).map(id => (
                  <div key={id} className="album-grid-cell"><AlbumThumb photoId={id} /></div>
                ))}
              </div>
            )}
            <button className="primary album-export" disabled={exporting || screen.ids.length === 0} onClick={() => void exportIds(screen.title, screen.ids)}>
              <UploadIcon /> {tr('albums.export')}
            </button>
            <p className="hint album-export-note">{tr('albums.export.note')}</p>
          </>
        )}

        {screen.kind === 'correct' && currentPlan && (
          <>
            <header className="detail-head">
              <button className="ghost icon-btn" onClick={() => setScreen({ kind: 'list' })} aria-label={tr('albums.back')}><ChevronLeft /></button>
              <span>{tr('albums.correct.title')}</span>
              <span className="hint">{planIndex + 1} / {plans.length}</span>
            </header>
            <div className="album-wipe">
              {previewUrl && (
                <>
                  <AdjustedImage src={previewUrl} edits={currentPlan.adjustments as EditAdjustments} alt="" />
                  <div className="album-wipe-before" style={{ width: `${wipe}%` }}>
                    <img src={previewUrl} alt="" style={{ width: `${10000 / Math.max(wipe, 1)}%` }} />
                    <span>{tr('albums.correct.before')}</span>
                  </div>
                  <span className="album-wipe-after">{tr('albums.correct.after')}</span>
                </>
              )}
            </div>
            <label className="album-wipe-range">
              <span className="hint">{tr('albums.correct.slide')}</span>
              <input type="range" min={5} max={95} value={wipe} onChange={e => setWipe(Number(e.target.value))} />
            </label>
            <h3 className="album-fixes-title">{tr('albums.correct.applied')}</h3>
            <ul className="album-fixes">
              {fixLine(currentPlan, tr).map(row => (
                <li key={row.key}><span>{row.label}</span><b>{row.value}</b></li>
              ))}
            </ul>
            <p className="album-protect-note">{tr('albums.correct.keepOriginal')}</p>
            <div className="album-correct-actions">
              {plans.length > 1 && (
                <button className="ghost small-btn" disabled={planIndex === 0} onClick={() => setPlanIndex(i => i - 1)}>{tr('albums.correct.prev')}</button>
              )}
              {plans.length > 1 && (
                <button className="ghost small-btn" disabled={planIndex >= plans.length - 1} onClick={() => setPlanIndex(i => i + 1)}>{tr('albums.correct.next')}</button>
              )}
            </div>
            <div className="album-correct-actions">
              <button className="ghost" onClick={() => setScreen({ kind: 'list' })}>{tr('albums.correct.cancel')}</button>
              <button className="primary" onClick={() => void applyPlans()}>{tr('albums.correct.applyAll', { count: plans.length })}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
