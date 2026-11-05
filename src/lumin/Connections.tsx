import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { useTr } from './context';
import { useLx } from './lxStore';
import { FaceThumb } from './FaceThumb';
import { usePeopleFaces } from './faces';
import { personLinks } from './insights';

/**
 * lumin/Connections.tsx
 * „Legăturile familiei”: oamenii recunoscuți, în cerc, legați după câte poze au
 * împreună (linia mai groasă = mai multe poze). Atingi doi oameni și vezi toate
 * pozele cu ei împreună.
 */
const MAX_PEOPLE = 10;

export function ConnectionsButton() {
  const tr = useTr();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="lx-btn ghost small lx-links-btn" onClick={() => setOpen(true)}>⟡ {tr('lx.links.title')}</button>
      {open && <Connections onClose={() => setOpen(false)} />}
    </>
  );
}

export function Connections({ onClose }: { onClose: () => void }) {
  const tr = useTr();
  const persons = useStore(s => s.persons);
  const faceVersion = useLx(s => s.faceVersion);
  const { people } = usePeopleFaces(persons, faceVersion);
  const top = useMemo(() => [...people].filter(p => p.photoIds.length >= 3).sort((a, b) => b.photoIds.length - a.photoIds.length).slice(0, MAX_PEOPLE), [people]);
  const links = useMemo(() => personLinks(top), [top]);
  const [sel, setSel] = useState<string[]>([]);
  const max = links[0]?.ids.length ?? 1;
  // Așezarea: în cerc, cel cu cele mai multe poze sus.
  const pos = useMemo(() => new Map(top.map((p, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, top.length)) * Math.PI * 2;
    return [p.name, { x: 50 + Math.cos(a) * 38, y: 50 + Math.sin(a) * 38 }];
  })), [top]);
  const pick = (name: string) => setSel(cur => (cur.includes(name) ? cur.filter(n => n !== name) : [...cur.slice(-1), name]));
  const pair = sel.length === 2 ? links.find(l => (l.a === sel[0] && l.b === sel[1]) || (l.a === sel[1] && l.b === sel[0])) ?? null : null;
  const strongest = links.slice(0, 3);
  return createPortal(
    <div className="lx lx-enhance lx-links" role="dialog" aria-modal="true" aria-label={tr('lx.links.title')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.links.title')}</span>
        <span />
      </header>
      {top.length < 2 ? <p className="lx-empty">{tr('lx.links.empty')}</p> : (
        <div className="lx-fm-body">
          <div className="lx-links-map">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {links.map(l => {
                const a = pos.get(l.a)!, b = pos.get(l.b)!;
                const on = sel.includes(l.a) && sel.includes(l.b);
                const dim = sel.length > 0 && !sel.includes(l.a) && !sel.includes(l.b);
                return <line key={`${l.a}|${l.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={on ? 'on' : dim ? 'dim' : undefined}
                  style={{ strokeWidth: 0.3 + (l.ids.length / max) * 2.2, opacity: dim ? 0.12 : 0.25 + (l.ids.length / max) * 0.7 }} />;
              })}
            </svg>
            {top.map(p => {
              const at = pos.get(p.name)!;
              return (
                <button key={p.name} className={sel.includes(p.name) ? 'lx-links-node on' : 'lx-links-node'} style={{ left: `${at.x}%`, top: `${at.y}%` }} onClick={() => pick(p.name)}>
                  <FaceThumb photoId={p.photoId} box={p.box} size={56} className="lx-face-img" />
                  <b>{p.name}</b>
                </button>
              );
            })}
          </div>
          {sel.length === 2 ? (
            <div className="lx-card lx-links-pair">
              <b>{pair ? tr('lx.links.together', { a: sel[0], b: sel[1], count: pair.ids.length }) : tr('lx.links.never', { a: sel[0], b: sel[1] })}</b>
              {pair && <button className="lx-btn primary small" onClick={() => { onClose(); useLx.getState().openViewer(pair.ids, 0); }}>{tr('lx.links.see')}</button>}
            </div>
          ) : <p className="lx-hint center">{tr('lx.links.hint')}</p>}
          {strongest.length > 0 && (
            <section className="lx-fm-section">
              <b>{tr('lx.links.strongest')}</b>
              {strongest.map(l => (
                <button key={`${l.a}|${l.b}`} className="lx-links-row" onClick={() => setSel([l.a, l.b])}>
                  <span>{l.a} & {l.b}</span><small>{tr('lx.links.count', { count: l.ids.length })}</small>
                </button>
              ))}
            </section>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}
