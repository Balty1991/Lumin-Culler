import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { useTr } from './context';
import { useLx } from './lxStore';
import { useLxPhotos } from './useLxPhotos';
import { Icon } from './icons';
import { Thumb } from './Thumb';
import { FaceThumb } from './FaceThumb';
import { usePeopleFaces } from './faces';
import { burstFilmAvailable } from './burstFilm';
import { GrowthSheet } from './GrowthButton';
import { LookalikeSheet } from './Lookalike';
import { FirstsSheet, YearMinuteSheet } from './Moments';
import { Connections } from './Connections';
import { EmotionYear } from './EmotionYear';
import { DuelOpen, ProfileOpen } from './Insights';
import { CapsuleCreator } from './Capsule';
import { FamilyPickSheet } from './FamilyPick';
import { FilmCreator } from './FilmCreator';
import { photoTime } from './days';
import { Recaps } from './Recaps';
import { EnhanceSheet } from './Enhance';
import { BrainScreen } from './BrainScreen';
import type { PhotoView } from '../state/store';

/**
 * lumin/Studio.tsx
 * „Studio”: toate creațiile într-un singur loc, pe categorii (Filme, Familie,
 * Amintiri, Jocuri), în loc de zece carduri unul sub altul pe Azi (raportat:
 * „ar trebui prezentare altfel, mai profesională”). Pe Azi rămâne doar o bandă
 * cu dalele, iar „Vezi tot” deschide Studio.
 */
type ToolId = 'recaps' | 'yearMin' | 'growth' | 'film' | 'look' | 'firsts' | 'links' | 'together' | 'capsule' | 'joy' | 'profile' | 'cover' | 'duel';
type Cat = 'films' | 'family' | 'memories' | 'games';
interface Tool { id: ToolId; cat: Cat; glyph: ReactNode; person?: boolean; films?: boolean }

const TOOLS: Tool[] = [
  { id: 'yearMin', cat: 'films', glyph: <Icon name="clock" size={26} />, films: true },
  { id: 'growth', cat: 'films', glyph: <Icon name="sprout" size={26} />, person: true, films: true },
  { id: 'film', cat: 'films', glyph: <Icon name="film" size={26} />, films: true },
  { id: 'look', cat: 'family', glyph: <Icon name="faces" size={26} />, person: true },
  { id: 'firsts', cat: 'family', glyph: <Icon name="flag" size={26} />, person: true },
  { id: 'links', cat: 'family', glyph: <Icon name="similar" size={26} /> },
  { id: 'together', cat: 'family', glyph: <Icon name="heart" size={26} /> },
  { id: 'recaps', cat: 'memories', glyph: <Icon name="square" size={24} /> },
  { id: 'capsule', cat: 'memories', glyph: <Icon name="lock" size={24} /> },
  { id: 'joy', cat: 'memories', glyph: <Icon name="smile" size={26} /> },
  { id: 'profile', cat: 'memories', glyph: <Icon name="user" size={26} /> },
  { id: 'cover', cat: 'memories', glyph: <Icon name="book" size={26} /> },
  { id: 'duel', cat: 'games', glyph: <Icon name="duel" size={26} /> }
];
const CATS: Cat[] = ['films', 'family', 'memories', 'games'];

function useTools(): Tool[] {
  const films = burstFilmAvailable();
  return TOOLS.filter(t => !t.films || films);
}

/** Ce se deschide pentru o dală (cu alegerea omului înainte, unde trebuie). */
function ToolSheet({ tool, onClose }: { tool: Tool; onClose: () => void }) {
  const photos = useLxPhotos();
  const [person, setPerson] = useState<string | null>(null);
  if (tool.person && !person) return <PersonPick toolId={tool.id} onPick={setPerson} onClose={onClose} />;
  switch (tool.id) {
    case 'recaps': return <RecapsSheet onClose={onClose} />;
    case 'yearMin': return <YearMinuteSheet onClose={onClose} />;
    case 'growth': return <GrowthSheet name={person!} list={photos.filter(p => p.capturedAt !== undefined && !p.aside && (p.personNames ?? []).includes(person!))} onClose={onClose} />;
    case 'film': {
      const recent = [...photos].filter(p => p.status === 'selected' && !p.aside).sort((a, b) => photoTime(b) - photoTime(a));
      const start = recent[0] ?? photos[0];
      return start ? <FilmCreator startId={start.id} initialIds={[]} initialTransition="fade" onClose={onClose} /> : null;
    }
    case 'look': return <LookalikeSheet name={person!} onClose={onClose} />;
    case 'firsts': return <FirstsSheet name={person!} onClose={onClose} />;
    case 'links': return <Connections onClose={onClose} />;
    case 'together': return <FamilyPickSheet onClose={onClose} />;
    case 'capsule': {
      const d0 = new Date(); d0.setHours(0, 0, 0, 0);
      return <CapsuleCreator initialIds={photos.filter(p => photoTime(p) >= d0.getTime() && p.status === 'selected').map(p => p.id)} onClose={onClose} />;
    }
    case 'joy': return <EmotionYear onClose={onClose} />;
    case 'profile': return <ProfileOpen mode="profile" onClose={onClose} />;
    case 'cover': return <ProfileOpen mode="cover" onClose={onClose} />;
    case 'duel': return <DuelOpen onClose={onClose} />;
  }
}

/** Alegi omul: fețele recunoscute, cei mai des fotografiați întâi. */
function PersonPick({ toolId, onPick, onClose }: { toolId: ToolId; onPick: (name: string) => void; onClose: () => void }) {
  const tr = useTr();
  const persons = useStore(s => s.persons);
  const faceVersion = useLx(s => s.faceVersion);
  const { people } = usePeopleFaces(persons, faceVersion);
  const sorted = useMemo(() => [...people].sort((a, b) => b.photoIds.length - a.photoIds.length), [people]);
  return createPortal(
    <div className="lx lx-enhance lx-fm" role="dialog" aria-modal="true" aria-label={tr(`lx.studio.t.${toolId}`)}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr(`lx.studio.t.${toolId}`)}</span>
        <span />
      </header>
      <div className="lx-fm-body">
        <p className="lx-hint center">{sorted.length ? tr('lx.studio.pickPerson') : tr('lx.studio.noPeople')}</p>
        <div className="lx-studio-people">
          {sorted.map(p => (
            <button key={p.name} onClick={() => onPick(p.name)}>
              <FaceThumb photoId={p.photoId} box={p.box} size={76} className="lx-face-img" />
              <b>{p.name}</b>
              <small>{tr('lx.brain.photos', { count: p.photoIds.length })}</small>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

function Tile({ tool, onOpen, compact }: { tool: Tool; onOpen: () => void; compact?: boolean }) {
  const tr = useTr();
  return (
    <button className={`lx-studio-tile c-${tool.cat}${compact ? ' compact' : ''}`} onClick={onOpen}>
      <span className="lx-studio-glyph">{tool.glyph}</span>
      <b>{tr(`lx.studio.t.${tool.id}`)}</b>
      {!compact && <small>{tr(`lx.studio.d.${tool.id}`)}</small>}
    </button>
  );
}

/** Pe Azi: banda Studio (dale care se derulează) și „Vezi tot”. */
export function StudioStrip() {
  const tr = useTr();
  const tools = useTools();
  const [open, setOpen] = useState<Tool | null>(null);
  const [all, setAll] = useState(false);
  return (
    <section className="lx-section lx-studio-strip">
      <div className="lx-section-head">
        <h2>{tr('lx.studio.title')}</h2>
        <button className="lx-link" onClick={() => setAll(true)}>{tr('lx.studio.all')} ›</button>
      </div>
      <div className="lx-studio-row">
        {tools.map(t => <Tile key={t.id} tool={t} compact onOpen={() => setOpen(t)} />)}
      </div>
      {all && <StudioScreen onClose={() => setAll(false)} />}
      {open && <ToolSheet tool={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

export function StudioScreen({ onClose }: { onClose: () => void }) {
  const tr = useTr();
  const tools = useTools();
  const [open, setOpen] = useState<Tool | null>(null);
  return createPortal(
    <div className="lx lx-enhance lx-studio" role="dialog" aria-modal="true" aria-label={tr('lx.studio.title')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.studio.title')}</span>
        <span />
      </header>
      <div className="lx-fm-body">
        <p className="lx-studio-intro">{tr('lx.studio.intro')}</p>
        {CATS.map(c => {
          const list = tools.filter(t => t.cat === c);
          if (!list.length) return null;
          return (
            <section key={c} className="lx-studio-cat">
              <h3>{tr(`lx.studio.cat.${c}`)}</h3>
              <div className="lx-studio-grid">
                {list.map(t => <Tile key={t.id} tool={t} onOpen={() => setOpen(t)} />)}
              </div>
            </section>
          );
        })}
      </div>
      {open && <ToolSheet tool={open} onClose={() => setOpen(null)} />}
    </div>,
    document.body
  );
}

const STUDIO_ORDER: ToolId[] = ['film', 'yearMin', 'growth', 'look', 'joy', 'capsule', 'cover'];

/** Tab-ul Studio: editorul, filmele și amintirile, în ordinea în care se folosesc. */
export function StudioTab() {
  const tr = useTr();
  const tools = useTools();
  const ordered = STUDIO_ORDER.map(id => tools.find(t => t.id === id)).filter((t): t is Tool => !!t);
  const rest = tools.filter(t => !STUDIO_ORDER.includes(t.id));
  const [open, setOpen] = useState<Tool | null>(null);
  const [enhance, setEnhance] = useState<PhotoView | null>(null);
  // Poza din vitrină: una dintre cele mai reușite, alta în fiecare zi — editorul se deschide pe ea.
  const all = useLxPhotos();
  const star = useMemo(() => {
    const top = all.filter(p => !p.aside && p.status !== 'rejected').sort((a, b) => (b.aesthetic ?? b.aiScore / 12) - (a.aesthetic ?? a.aiScore / 12)).slice(0, 12);
    return top.length ? top[Math.floor(Date.now() / 86_400_000) % top.length] : null;
  }, [all]);
  const openEditor = () => {
    if (star) setEnhance(star);
    else useLx.getState().setTab('days');
  };
  return (
    <div className="lx-screen">
      <header className="lx-head"><h1 className="lx-title">{tr('lx.studio.title')}</h1></header>
      <p className="lx-sub">{tr('lx.studio.intro')}</p>
      {/* Vitrina: poza ta cât ecranul de lată, cu editorul la o atingere. */}
      {star && (
        <button className="lx-studio-hero" onClick={openEditor}>
          <Thumb id={star.id} lqip={star.lqip} edits={star.edits} full />
          <span className="lx-studio-hero-shade" aria-hidden="true" />
          <span className="lx-studio-hero-text">
            <i><Icon name="sparkle" size={14} /> {tr('lx.studio.hero.badge')}</i>
            <b>{tr('lx.studio.hero.title')}</b>
            <small>{tr('lx.studio.hero.sub')}</small>
            <em>{tr('lx.studio.hero.cta')} →</em>
          </span>
        </button>
      )}
      <div className="lx-studio-grid">
        {!star && (
          <button className="lx-studio-tile c-films" onClick={openEditor}>
            <span className="lx-studio-glyph"><Icon name="sparkle" size={26} /></span>
            <b>{tr('lx.enhance.title')}</b>
            <small>{tr('lx.enhance.style')}</small>
          </button>
        )}
        {ordered.map(t => <Tile key={t.id} tool={t} onOpen={() => setOpen(t)} />)}
      </div>
      {rest.length > 0 && (
        <section className="lx-studio-cat">
          <h3>{tr('lx.studio.all')}</h3>
          <div className="lx-studio-grid">{rest.map(t => <Tile key={t.id} tool={t} onOpen={() => setOpen(t)} />)}</div>
        </section>
      )}
      <BrainScreen embedded />
      {open && <ToolSheet tool={open} onClose={() => setOpen(null)} />}
      {enhance && <EnhanceSheet photo={enhance} onClose={() => setEnhance(null)} />}
    </div>
  );
}

/** Rezumatele (săptămâna, cele mai frumoase din lună, anul), mutate de pe Azi în Studio. */
function RecapsSheet({ onClose }: { onClose: () => void }) {
  const tr = useTr();
  return createPortal(
    <div className="lx lx-enhance lx-fm" role="dialog" aria-modal="true" aria-label={tr('lx.studio.t.recaps')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.studio.t.recaps')}</span>
        <span />
      </header>
      <div className="lx-fm-body lx-recaps-sheet"><Recaps /></div>
    </div>,
    document.body
  );
}
