import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, type PhotoView } from '../state/store';
import { useTr } from './context';
import { Thumb } from './Thumb';
import { Icon } from './icons';
import { useLx } from './lxStore';
import { useLxPhotos } from './useLxPhotos';
import { intlTag } from '../i18n';
import { loadEditable } from './sharp';
import { shareCollage } from './collage';
import { saveEditedBlob } from './saveEdited';
import { duelPairs, missingInsights, photoProfile, profilePeriod, type PhotoProfile } from './insights';

/* ───────────── „Lipsesc din poze” ───────────── */

const DISMISS_KEY = 'lx.missing.dismissed';
function dismissed(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
}

/** Pe Azi: cine lipsește de mult din poze (sau doi oameni care nu mai apar împreună). */
export function MissingCard() {
  const tr = useTr();
  const photos = useLxPhotos();
  const [hidden, setHidden] = useState(dismissed);
  const list = useMemo(() => missingInsights(photos).filter(i => !(hidden[i.key] && Date.now() - hidden[i.key] < 21 * 86_400_000)), [photos, hidden]);
  if (!list.length) return null;
  const hide = (key: string) => {
    const next = { ...hidden, [key]: Date.now() };
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(next)); } catch { /* fără */ }
    setHidden(next);
  };
  const span = (days: number) => (days >= 60 ? tr('lx.missing.months', { count: Math.round(days / 30) }) : tr('lx.missing.weeks', { count: Math.round(days / 7) }));
  return (
    <section className="lx-section">
      <div className="lx-section-head"><h2>{tr('lx.missing.title')}</h2></div>
      {list.map(i => {
        const p = photos.find(x => x.id === i.lastId);
        return (
          <div key={i.key} className="lx-card lx-missing">
            <button className="lx-missing-thumb" onClick={() => useLx.getState().openViewer([i.lastId], 0)} aria-label={tr('lx.missing.last')}>
              {p && <Thumb id={p.id} lqip={p.lqip} edits={p.edits} />}
            </button>
            <div>
              <b>{i.kind === 'person' ? tr('lx.missing.person', { name: i.name, span: span(i.days) }) : tr('lx.missing.pair', { a: i.a, b: i.b, span: span(i.days) })}</b>
              <small>{i.kind === 'person' ? tr('lx.missing.personTip', { name: i.name }) : tr('lx.missing.pairTip')}</small>
            </div>
            <button className="lx-icon-btn small" onClick={() => hide(i.key)} aria-label={tr('lx.close')}><Icon name="x" size={14} /></button>
          </div>
        );
      })}
    </section>
  );
}

/* ───────────── Profilul tău de fotograf ───────────── */

const W = 1080, H = 1920;
function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function renderProfile(p: PhotoProfile, t: { title: string; month: string; archetype: string; archetypeSub: string; stats: [string, string][]; people: string; footer: string }): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#050305'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, 520, 0, W / 2, 520, 900);
  g.addColorStop(0, 'rgba(255,46,110,0.35)'); g.addColorStop(1, 'rgba(255,46,110,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const font = 'system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff8fae'; ctx.font = `600 34px ${font}`;
  ctx.fillText(t.title.toUpperCase(), W / 2, 130);
  ctx.fillStyle = '#fff6f9'; ctx.font = `700 64px ${font}`;
  ctx.fillText(t.month, W / 2, 210);
  // Cea mai bună poză a perioadei.
  if (p.bestId) {
    const r = await loadEditable(p.bestId, 1400).catch(() => null);
    if (r?.img) {
      const bx = 110, by = 270, bw = W - 220, bh = 860;
      ctx.save();
      ctx.shadowColor = 'rgba(255,79,127,0.55)'; ctx.shadowBlur = 60;
      rounded(ctx, bx, by, bw, bh, 48); ctx.fillStyle = '#1a1016'; ctx.fill();
      ctx.restore();
      ctx.save();
      rounded(ctx, bx, by, bw, bh, 48); ctx.clip();
      const k = Math.max(bw / r.img.naturalWidth, bh / r.img.naturalHeight);
      ctx.drawImage(r.img, bx + (bw - r.img.naturalWidth * k) / 2, by + (bh - r.img.naturalHeight * k) / 2, r.img.naturalWidth * k, r.img.naturalHeight * k);
      ctx.restore();
    }
  }
  // „Ce fel de fotograf ești.”
  const tg = ctx.createLinearGradient(200, 0, W - 200, 0);
  tg.addColorStop(0, '#ff4f7f'); tg.addColorStop(1, '#ffb3c8');
  ctx.fillStyle = tg; ctx.font = `800 76px ${font}`;
  ctx.shadowColor = 'rgba(255,79,127,0.6)'; ctx.shadowBlur = 30;
  ctx.fillText(t.archetype, W / 2, 1250);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#c9b4bf'; ctx.font = `400 34px ${font}`;
  ctx.fillText(t.archetypeSub, W / 2, 1310);
  // Cifrele, în două coloane.
  t.stats.forEach(([v, l], i) => {
    const x = i % 2 === 0 ? W * 0.28 : W * 0.72, y = 1440 + Math.floor(i / 2) * 150;
    ctx.fillStyle = '#fff6f9'; ctx.font = `800 64px ${font}`; ctx.fillText(v, x, y);
    ctx.fillStyle = '#c9b4bf'; ctx.font = `400 30px ${font}`; ctx.fillText(l, x, y + 46);
  });
  if (t.people) { ctx.fillStyle = '#ff8fae'; ctx.font = `600 34px ${font}`; ctx.fillText(t.people, W / 2, 1760); }
  ctx.fillStyle = 'rgba(255,246,249,0.5)'; ctx.font = `500 28px ${font}`;
  ctx.fillText(t.footer, W / 2, 1860);
  return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.92));
}

/** Pe Azi: „Profilul tău foto din octombrie”, cu cardul gata de distribuit. */
export function ProfileCard() {
  const tr = useTr();
  const photos = useLxPhotos();
  const locale = useStore(s => s.locale);
  const [open, setOpen] = useState(false);
  const period = useMemo(() => profilePeriod(), []);
  const profile = useMemo(() => photoProfile(photos, period.from, period.to), [photos, period]);
  if (profile.total < 15) return null;
  const month = new Date(period.from).toLocaleDateString(intlTag(locale), { month: 'long' });
  return (
    <>
      <button className="lx-card lx-profile-card" onClick={() => setOpen(true)}>
        <span className="lx-profile-badge"><Icon name="sparkle" size={22} /></span>
        <span>
          <b>{tr('lx.profile.cardTitle', { month })}</b>
          <small>{tr(`lx.profile.arch.${profile.archetype}`)} · {tr('lx.profile.keptOf', { kept: profile.kept, total: profile.total })}</small>
        </span>
        <span aria-hidden="true">›</span>
      </button>
      {open && <ProfileSheet profile={profile} onClose={() => setOpen(false)} />}
    </>
  );
}

function ProfileSheet({ profile, onClose }: { profile: PhotoProfile; onClose: () => void }) {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const tag = intlTag(locale);
    const month = new Date(profile.from).toLocaleDateString(tag, { month: 'long', year: 'numeric' });
    const weekday = profile.weekday !== null ? new Date(2024, 0, 7 + profile.weekday).toLocaleDateString(tag, { weekday: 'long' }) : '–';
    const hour = profile.hour !== null ? `${String(profile.hour).padStart(2, '0')}:00` : '–';
    void renderProfile(profile, {
      title: tr('lx.profile.title'),
      month: month.charAt(0).toUpperCase() + month.slice(1),
      archetype: tr(`lx.profile.arch.${profile.archetype}`),
      archetypeSub: tr(`lx.profile.archSub.${profile.archetype}`),
      stats: [
        [String(profile.total), tr('lx.profile.stat.taken')],
        [`${profile.keepRate}%`, tr('lx.profile.stat.kept')],
        [hour, tr('lx.profile.stat.hour')],
        [weekday, tr('lx.profile.stat.day')]
      ],
      people: profile.people.length ? tr('lx.profile.with', { names: profile.people.map(p => p.name).join(' · ') }) : '',
      footer: 'Cherrypic'
    }).then(b => {
      if (!alive || !b) return;
      setBlob(b); setUrl(URL.createObjectURL(b));
    });
    return () => { alive = false; };
  }, [profile, locale, tr]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return createPortal(
    <div className="lx lx-enhance lx-film" role="dialog" aria-modal="true" aria-label={tr('lx.profile.title')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.profile.title')}</span>
        <span />
      </header>
      <div className="lx-enhance-stage">
        {url ? <img className="lx-film-video" src={url} alt="" /> : <div className="lx-enhance-wait"><span className="lx-spinner" /></div>}
      </div>
      <div className="lx-viewer-info">
        <div className="lx-decide-actions">
          <button className="lx-btn ghost" disabled={!blob} onClick={() => blob && void saveEditedBlob(blob, 'profil').then(ok => useStore.getState().setNotice(tr(ok ? 'lx.profile.saved' : 'lx.magic.failed')))}>{tr('lx.burstFilm.save')}</button>
          <button className="lx-btn primary" disabled={!blob} onClick={() => blob && void shareCollage(blob, `cherrypic-profil-${Date.now()}.jpg`, tr('lx.profile.shareText'))}>↗ {tr('lx.wall.share')}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ───────────── Duelul ───────────── */

const ROUNDS = 10;

/** Pe Azi: invitația la duel, când sunt serii nedecise. */
export function DuelCard() {
  const tr = useTr();
  const photos = useLxPhotos();
  const [open, setOpen] = useState(false);
  const pairs = useMemo(() => duelPairs(photos, ROUNDS), [photos]);
  if (pairs.length < 3 && !open) return null;
  return (
    <>
      <button className="lx-card lx-duel-card" onClick={() => setOpen(true)}>
        <span className="lx-duel-vs">VS</span>
        <span><b>{tr('lx.duel.title')}</b><small>{tr('lx.duel.sub', { count: pairs.length })}</small></span>
        <span aria-hidden="true">›</span>
      </button>
      {open && <Duel pairs={pairs} onClose={() => setOpen(false)} />}
    </>
  );
}

function Duel({ pairs, onClose }: { pairs: [PhotoView, PhotoView][]; onClose: () => void }) {
  const tr = useTr();
  const setStatus = useStore(s => s.setStatus);
  const [round, setRound] = useState(0);
  const [agree, setAgree] = useState(0);
  const [flash, setFlash] = useState<{ side: 0 | 1; agree: boolean } | null>(null);
  const done = round >= pairs.length;
  const pick = (side: 0 | 1) => {
    if (flash || done) return;
    const [a, b] = pairs[round];
    const win = side === 0 ? a : b, lose = side === 0 ? b : a;
    const ai = win.aiScore >= lose.aiScore;
    setFlash({ side, agree: ai });
    if (ai) setAgree(n => n + 1);
    // Câștigătoarea rămâne, cealaltă la „Nu azi” (nimic nu se șterge); AI-ul învață din alegere.
    void setStatus(win.id, 'selected');
    void setStatus(lose.id, 'rejected');
    window.setTimeout(() => { setFlash(null); setRound(r => r + 1); }, 750);
  };
  return createPortal(
    <div className="lx lx-enhance lx-duel" role="dialog" aria-modal="true" aria-label={tr('lx.duel.title')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{done ? tr('lx.duel.title') : tr('lx.duel.round', { n: round + 1, total: pairs.length })}</span>
        <span />
      </header>
      {done ? (
        <div className="lx-duel-end">
          <span className="lx-duel-vs big">{agree}/{pairs.length}</span>
          <b>{tr('lx.duel.endTitle', { agree, total: pairs.length })}</b>
          <p>{tr(agree >= pairs.length * 0.7 ? 'lx.duel.endSame' : 'lx.duel.endLearn')}</p>
          <button className="lx-btn primary" onClick={onClose}>{tr('lx.duel.done')}</button>
        </div>
      ) : (
        <>
          <p className="lx-hint center">{tr('lx.duel.ask')}</p>
          <div className="lx-duel-pair">
            {pairs[round].map((p, i) => (
              <button key={p.id} className={flash ? (flash.side === i ? 'lx-duel-photo win' : 'lx-duel-photo lose') : 'lx-duel-photo'} onClick={() => pick(i as 0 | 1)}>
                <Thumb id={p.id} lqip={p.lqip} edits={p.edits} full />
                {flash?.side === i && <span className="lx-duel-flash">{tr(flash.agree ? 'lx.duel.agree' : 'lx.duel.learn')}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>,
    document.body
  );
}
