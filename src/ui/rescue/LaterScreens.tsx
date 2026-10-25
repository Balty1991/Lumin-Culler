import { useEffect, useRef, useState } from 'react';
import { rescueT, type RescueLocale } from '../../rescue/copy';
import { effortCount, formatBytes } from '../../rescue/format';
import { edgeKey, pileKey, reasonKey } from '../../rescue/labels';
import { effortSeconds, selectionOf, type HeldFile, type Pile, type PileId, type RescueItem } from '../../rescue/model';
import { BackButton, SizeHeading } from './chrome';
import { LazyThumb } from './LazyThumb';

export default function LaterScreens(props: {
  screen: 'review' | 'swipe' | 'trash' | 'freed';
  locale: RescueLocale;
  piles: readonly Pile[];
  pileId: PileId;
  checked: ReadonlySet<string>;
  aside: ReadonlySet<string>;
  trashed: readonly HeldFile[];
  batch: readonly HeldFile[];
  onBack: () => void;
  onOpen: (screen: 'swipe') => void;
  onToggle: (id: string) => void;
  onReset: () => void;
  onMove: () => void;
  onTrash: (file: HeldFile) => void;
  onKeep: (id: string) => void;
  onSwipeEmpty: (moved: boolean) => void;
  onUndo: () => void;
  onFree: () => void;
}) {
  const { screen } = props;
  if (screen === 'review') return <Review {...props} />;
  if (screen === 'swipe') return <Swipe key={props.pileId} {...props} />;
  if (screen === 'trash') return <Trash {...props} />;
  return <Freed {...props} />;
}

function pileOf(piles: readonly Pile[], pileId: PileId): Pile | undefined {
  return piles.find(pile => pile.id === pileId) ?? piles[0];
}

function keepLine(locale: RescueLocale, item: RescueItem): string | null {
  if (!item.keepName) return null;
  const edges = (item.edges ?? []).map(edge => rescueT(locale, edgeKey(edge))).join(', ');
  const base = rescueT(locale, 'keep', { name: item.keepName });
  return edges ? `${base} · ${edges}` : base;
}

function Review(props: {
  locale: RescueLocale;
  piles: readonly Pile[];
  pileId: PileId;
  checked: ReadonlySet<string>;
  aside: ReadonlySet<string>;
  onBack: () => void;
  onOpen: (screen: 'swipe') => void;
  onToggle: (id: string) => void;
  onReset: () => void;
  onMove: () => void;
}) {
  const { locale } = props;
  const pile = pileOf(props.piles, props.pileId);
  if (!pile) {
    return <BackButton label={rescueT(locale, 'back')} onClick={props.onBack} />;
  }
  const name = rescueT(locale, pileKey(pile.id));
  const sel = selectionOf(pile.items, props.checked, props.aside);
  const effort = effortCount(sel.count === 0 ? 0 : effortSeconds(pile.id, sel.count));
  return (
    <>
      <BackButton label={rescueT(locale, 'back')} onClick={props.onBack} />
      <h1>{rescueT(locale, 'reviewTitle')}</h1>
      <p className="rescue-lead">{name}</p>
      <p>{rescueT(locale, 'reviewSafe')}</p>
      <p className="rescue-muted">{rescueT(locale, 'reviewWeb')}</p>
      {sel.count > 0 ? <p className="rescue-muted">{rescueT(locale, effort.key, { count: effort.count })}</p> : null}
      <div>
        {pile.items.filter(item => !props.aside.has(item.id)).map(item => {
          const kept = keepLine(locale, item);
          return (
            <label className="rescue-file" key={item.id}>
              <input
                type="checkbox"
                checked={props.checked.has(item.id)}
                onChange={() => props.onToggle(item.id)}
              />
              <LazyThumb id={item.id} />
              <span>
                <span className="rescue-file-name">{item.name}</span>
                <span className="rescue-muted">{formatBytes(item.bytes)} · {rescueT(locale, reasonKey(item.reason))}</span>
                {kept ? <span className="rescue-muted">{kept}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
      <button
        type="button"
        className="rescue-btn"
        disabled={sel.count === 0}
        onClick={props.onMove}
      >
        {rescueT(locale, 'move', { count: sel.count, size: formatBytes(sel.bytes) })}
      </button>
      <button type="button" className="rescue-btn quiet" onClick={() => props.onOpen('swipe')}>
        {rescueT(locale, 'swipe')}
      </button>
      <button type="button" className="rescue-btn text" onClick={props.onReset}>
        {rescueT(locale, 'reset')}
      </button>
    </>
  );
}

function Swipe(props: {
  locale: RescueLocale;
  piles: readonly Pile[];
  pileId: PileId;
  aside: ReadonlySet<string>;
  trashed: readonly HeldFile[];
  onBack: () => void;
  onTrash: (file: HeldFile) => void;
  onKeep: (id: string) => void;
  onSwipeEmpty: (moved: boolean) => void;
}) {
  const { locale } = props;
  const pile = pileOf(props.piles, props.pileId);
  const [passed, setPassed] = useState<ReadonlySet<string>>(() => new Set());
  const baseline = useRef(props.trashed.length);
  const cardRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ id: -1, x0: 0, dx: 0 });
  const { onSwipeEmpty, trashed } = props;

  const queue = (pile?.items ?? []).filter(item => !props.aside.has(item.id) && !passed.has(item.id));
  const current = queue[0];

  useEffect(() => {
    if (current) return;
    onSwipeEmpty(trashed.length > baseline.current);
  }, [current, onSwipeEmpty, trashed.length]);

  if (!current) return <BackButton label={rescueT(locale, 'back')} onClick={props.onBack} />;

  const kept = keepLine(locale, current);
  const place = (dx: number) => {
    const el = cardRef.current;
    if (el) el.style.transform = `translate3d(${dx}px, 0, 0)`;
  };
  const commit = (dx: number) => {
    place(0);
    if (dx <= -72) props.onTrash({ id: current.id, name: current.name, bytes: current.bytes });
    else if (dx >= 72) {
      setPassed(prev => new Set(prev).add(current.id));
      props.onKeep(current.id);
    }
  };

  return (
    <>
      <BackButton label={rescueT(locale, 'back')} onClick={props.onBack} />
      <p className="rescue-muted">{rescueT(locale, 'swipeProgress', { index: 1, count: queue.length })}</p>
      <div
        className="rescue-shot"
        ref={cardRef}
        onPointerDown={event => {
          if (event.button !== 0) return;
          drag.current = { id: event.pointerId, x0: event.clientX, dx: 0 };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (event.pointerId !== drag.current.id) return;
          const dx = event.clientX - drag.current.x0;
          drag.current.dx = dx;
          place(dx);
        }}
        onPointerUp={event => {
          if (event.pointerId !== drag.current.id) return;
          const dx = drag.current.dx;
          drag.current.id = -1;
          commit(dx);
        }}
        onPointerCancel={() => { drag.current.id = -1; place(0); }}
      >
        <LazyThumb id={current.id} />
        <h1>{current.name}</h1>
        <p>{formatBytes(current.bytes)} · {rescueT(locale, reasonKey(current.reason))}</p>
        {kept ? <p className="rescue-muted">{kept}</p> : null}
      </div>
      <p className="rescue-muted">{rescueT(locale, 'swipeHint')}</p>
      <div className="rescue-actions">
        <button type="button" className="rescue-btn danger" onClick={() => commit(-80)}>{rescueT(locale, 'swipeTrash')}</button>
        <button type="button" className="rescue-btn quiet" onClick={() => commit(80)}>{rescueT(locale, 'swipeKeep')}</button>
      </div>
    </>
  );
}

function sumBytes(files: readonly HeldFile[]): number {
  return files.reduce((sum, file) => sum + file.bytes, 0);
}

function Trash(props: { locale: RescueLocale; trashed: readonly HeldFile[]; onBack: () => void; onUndo: () => void; onFree: () => void }) {
  const { locale, trashed } = props;
  const size = formatBytes(sumBytes(trashed));
  return (
    <>
      <BackButton label={rescueT(locale, 'back')} onClick={props.onBack} />
      <SizeHeading locale={locale} template="trashed" size={size} />
      <p>{rescueT(locale, 'trashedBody')}</p>
      <ul className="rescue-names">
        {trashed.map(file => <li key={file.id}>{file.name}</li>)}
      </ul>
      <button type="button" className="rescue-btn" onClick={props.onFree}>{rescueT(locale, 'freeNow')}</button>
      <p className="rescue-muted">{rescueT(locale, 'freeHint')}</p>
      <button type="button" className="rescue-btn quiet" onClick={props.onUndo}>{rescueT(locale, 'undo')}</button>
      <button type="button" className="rescue-btn text" onClick={props.onBack}>{rescueT(locale, 'leave')}</button>
    </>
  );
}

function Freed(props: { locale: RescueLocale; batch: readonly HeldFile[]; onBack: () => void }) {
  const { locale } = props;
  return (
    <>
      <BackButton label={rescueT(locale, 'back')} onClick={props.onBack} />
      <SizeHeading locale={locale} template="freed" size={formatBytes(sumBytes(props.batch))} />
      <p>{rescueT(locale, 'freedBody')}</p>
      <p className="rescue-muted">{rescueT(locale, 'freedWeb')}</p>
      <ul className="rescue-names">
        {props.batch.map(file => <li key={file.id}>{file.name}</li>)}
      </ul>
      <button type="button" className="rescue-btn" onClick={props.onBack}>{rescueT(locale, 'done')}</button>
    </>
  );
}
