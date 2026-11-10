/**
 * lumin/icons.tsx
 * Pictogramele aplicației, desenate (contur 1.8, colțuri rotunjite), în locul
 * emoji-urilor: arată la fel pe orice telefon și se potrivesc cu tema.
 */
const PATHS = {
  sparkle: 'M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
  eraser: 'M16 4l4 4-9 9H7l-3-3zM7 17h13',
  share: 'M12 3v12M7 8l5-5 5 5M5 14v5h14v-5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  similar: 'M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M9 12a3 3 0 106 0 3 3 0 00-6 0',
  film: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4',
  square: 'M4 4h16v16H4zM4 15l4-4 4 4 3-3 5 5',
  tag: 'M3 12V4h8l9 9-8 8zM7.5 7.5h.01',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  pen: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 017 0v3',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  zoom: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-3.5-3.5M11 8v6M8 11h6',
  scissors: 'M6 8a2 2 0 100-4 2 2 0 000 4zM6 20a2 2 0 100-4 2 2 0 000 4zM8 7l12 10M8 17L20 7',
  target: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8zM12 11.5v1',
  reset: 'M4 12a8 8 0 108-8H8M8 1v6h6',
  // Studio: fiecare unealtă are desenul ei, nu un semn de text („≈”, „1ª”, „VS”).
  faces: 'M9 11a3 3 0 100-6 3 3 0 000 6zM15.5 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM3.5 19a5.5 5.5 0 0111 0M14.5 14.3a4.5 4.5 0 016 4.2',
  flag: 'M6 21V4M6 4h11l-2.5 4 2.5 4H6',
  heart: 'M12 20s-7-4.4-7-9.6A4 4 0 0112 8a4 4 0 017 2.4C19 15.6 12 20 12 20z',
  clock: 'M12 4a8 8 0 100 16 8 8 0 000-16zM12 8v4l3 2',
  book: 'M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h11',
  duel: 'M4 6h6v12H4zM14 6h6v12h-6zM13 9l-2 3h2l-2 3',
  sprout: 'M12 20v-8M12 12c0-3-2-5-6-5 0 4 2 6 6 5zM12 14c0-3 2-5 6-5 0 4-2 6-6 5z',
  smile: 'M12 3a9 9 0 100 18 9 9 0 000-18zM8.5 14a4 4 0 007 0M9 9.5h.01M15 9.5h.01',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4.5 20a7.5 7.5 0 0115 0'
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg className="lx-icon" aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={name === 'more' ? 3 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}
