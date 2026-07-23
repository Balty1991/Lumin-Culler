import type { ReactNode } from 'react';

interface TooltipProps {
  label: string;
  shortcut?: string;
  children: ReactNode;
  /** Aliniere fata de element — 'bottom' impicit, 'left' pentru butoane langa marginea dreapta a ecranului. */
  side?: 'bottom' | 'left';
}

/** Tooltip minimal, aparitie instant la hover/focus — pentru butoanele doar-iconita din bara de unelte. */
export function Tooltip({ label, shortcut, children, side = 'bottom' }: TooltipProps) {
  return (
    <span className={`tooltip-wrap${side === 'left' ? ' tooltip-left' : ''}`}>
      {children}
      <span className="tooltip-bubble" role="tooltip">
        {label}
        {shortcut && <kbd>{shortcut}</kbd>}
      </span>
    </span>
  );
}
