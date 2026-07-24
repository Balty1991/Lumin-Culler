import { useEffect, useRef, useState } from 'react';
import { useStore, type PhotoView } from '../state/store';
import type { HistoryEvent, BatchHistoryEvent } from '../state/history';
import { Tooltip } from './Tooltip';
import { UndoIcon } from './icons';
import { t } from '../i18n';

interface HistoryRow {
  key: string;
  ts: number;
  label: string;
}

function combinedRows(
  history: HistoryEvent[],
  batchHistory: BatchHistoryEvent[],
  photos: PhotoView[],
  tr: (key: string, params?: Record<string, string | number>) => string
): HistoryRow[] {
  const singles: HistoryRow[] = history.map(h => ({
    key: `s-${h.photoId}-${h.ts}`,
    ts: h.ts,
    label: tr('undoHistory.singleLabel', {
      name: photos.find(p => p.id === h.photoId)?.fileName ?? h.photoId,
      from: tr(`store.statusLabel.${h.previousStatus}`),
      to: tr(`store.statusLabel.${h.newStatus}`)
    })
  }));
  const batches: HistoryRow[] = batchHistory.map(b => ({ key: `b-${b.id}`, ts: b.ts, label: b.label }));
  return [...singles, ...batches].sort((a, b) => b.ts - a.ts);
}

/**
 * Buton de undo cu istoric VIZIBIL (plan "cat mai pro") — mecanismul de undo
 * era deja multi-nivel (pana la 10 decizii unice + 5 loturi, vezi
 * state/history.ts), dar fara nicio vizibilitate asupra CE anume ar reverta
 * fiecare pas: un singur buton, un singur click, o singura presupunere.
 * Acum click-ul deschide un popover cu lista actiunilor recente (cea mai
 * noua prima) si un buton de revert per rand — care reverta pana la ACEL
 * rand inclusiv, apeland `undo()` de N ori in secventa (undo() alege deja
 * global cel mai recent element ramas intre cele doua stive, deci N apeluri
 * consecutive reverta exact primele N randuri afisate, in aceeasi ordine).
 * Ctrl+Z ramane neschimbat: un singur apel direct la undo(), fara popover.
 */
export function UndoHistoryButton() {
  const history = useStore(s => s.history);
  const batchHistory = useStore(s => s.batchHistory);
  const photos = useStore(s => s.photos);
  const undo = useStore(s => s.undo);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const undoCount = history.length + batchHistory.length;
  const [open, setOpen] = useState(false);
  const [reverting, setReverting] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const id = window.setTimeout(() => window.addEventListener('pointerdown', onPointerDown), 0);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // popover-ul isi pierde sensul daca istoricul ajunge la 0 in timp ce e deschis (ex. Ctrl+Z apasat separat)
  useEffect(() => { if (undoCount === 0) setOpen(false); }, [undoCount]);

  if (undoCount === 0) return null;

  const rows = combinedRows(history, batchHistory, photos, tr);

  const revertUpTo = async (index: number) => {
    setReverting(true);
    for (let i = 0; i <= index; i++) await undo();
    setReverting(false);
    setOpen(false);
  };

  const button = (
    <button
      className="ghost icon-btn"
      onClick={() => setOpen(v => !v)}
      aria-label={tr('app.undo.ariaLabel', { count: undoCount })}
      aria-expanded={open}
    >
      <UndoIcon />
      <span className="undo-count mono">{undoCount}</span>
    </button>
  );

  return (
    <div className="undo-history-wrap" ref={wrapRef}>
      {/* fara Tooltip cat timp popover-ul e deschis — altfel bula de hover ramane
          vizibila peste popover (butonul ramane cu focus dupa click, iar
          Tooltip apare si la :focus-within, nu doar la hover real) */}
      {open ? button : <Tooltip label={tr('app.tooltip.undo')} shortcut="Ctrl+Z">{button}</Tooltip>}
      {open && (
        <div className="undo-history-popover glass" role="menu" aria-label={tr('undoHistory.title')}>
          <div className="undo-history-title mono">{tr('undoHistory.title')}</div>
          <ul className="undo-history-list">
            {rows.map((row, i) => (
              <li key={row.key}>
                <button className="undo-history-item" role="menuitem" onClick={() => void revertUpTo(i)} disabled={reverting}>
                  <span className="undo-history-label">{row.label}</span>
                  <span className="undo-history-revert mono">{i === 0 ? tr('undoHistory.revertLast') : tr('undoHistory.revertUpTo')}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
