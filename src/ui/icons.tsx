/** Iconite SVG minime, inline — fara dependenta externa, fara CDN de fonturi de icoane. */
import type { SVGProps } from 'react';

const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function MenuIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="14" y2="17" /></svg>;
}
export function StarIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M12 2.5l2.9 6.4 6.9.7-5.2 4.8 1.5 6.9-6.1-3.6-6.1 3.6 1.5-6.9-5.2-4.8 6.9-.7z" /></svg>;
}
export function SparkleIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M12 3l1.6 4.9L18.5 9 13.6 10.6 12 15.5 10.4 10.6 5.5 9l4.9-1.1z" /><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></svg>;
}
export function DownloadIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 20h16" /></svg>;
}
export function UploadIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M12 21V9" /><path d="M7 14l5-5 5 5" /><path d="M4 4h16" /></svg>;
}
export function ListIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" /><circle cx="4.5" cy="6" r="1.4" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="4.5" cy="18" r="1.4" fill="currentColor" stroke="none" /></svg>;
}
export function InfoIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16.5" /><circle cx="12" cy="7.6" r="0.9" fill="currentColor" stroke="none" /></svg>;
}
export function EditIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M14.5 4.5l5 5L8 21H3v-5z" /></svg>;
}
export function XIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>;
}
export function ChevronLeft(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M15 5l-7 7 7 7" /></svg>;
}
export function ChevronRight(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M9 5l7 7-7 7" /></svg>;
}
export function ChevronUpIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M5 15l7-7 7 7" /></svg>;
}
export function EyeClosedIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M3 12s3.6-6.5 9-6.5S21 12 21 12s-3.6 6.5-9 6.5S3 12 3 12z" opacity="0.35" /><line x1="3" y1="20" x2="21" y2="4" /></svg>;
}
export function UserQuestionIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><circle cx="12" cy="8" r="3.4" /><path d="M4.5 20c1.2-4 4.1-6 7.5-6" /><path d="M15.5 15.3c.3-.7 1-1.1 1.9-1.1 1.1 0 1.9.7 1.9 1.7 0 .8-.5 1.2-1.2 1.6-.6.4-1 .7-1 1.4" /><circle cx="17.3" cy="21.2" r="0.15" fill="currentColor" /></svg>;
}
/** Silueta unei persoane RECUNOSCUTE (aceeasi forma de baza ca UserQuestionIcon, dar cu bifa
    in loc de semnul intrebarii) — distinct de StarIcon, rezervat strict pentru rating stele. */
export function UserCheckIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><circle cx="11" cy="8" r="3.4" /><path d="M3.5 20c1.2-4 3.8-6 7.5-6" /><path d="M15 17.5l2 2 3.5-4" /></svg>;
}
export function LayersIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M12 3l8 4.5-8 4.5-8-4.5z" /><path d="M4 12l8 4.5 8-4.5" /><path d="M4 16.5l8 4.5 8-4.5" /></svg>;
}
export function PlusIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
}
export function TrashIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M4 7h16" /><path d="M9 7V4.5h6V7" /><path d="M6 7l1 13h10l1-13" /></svg>;
}
export function CheckIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M4 12.5l5.5 5.5L20 6" /></svg>;
}
export function AlertIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M12 3.5l9.5 16.5H2.5z" /><line x1="12" y1="9.5" x2="12" y2="14" /><circle cx="12" cy="17" r="0.15" fill="currentColor" /></svg>;
}
/** Distincta de AlertIcon (triunghi de avertizare) — forma octogonala, pentru erori
    reale, ca semnalul sa nu depinda doar de culoare (rosu vs galben). */
export function ErrorIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z" /><line x1="12" y1="8" x2="12" y2="13" /><circle cx="12" cy="16" r="0.15" fill="currentColor" /></svg>;
}
export function TagIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M12.6 3H5a2 2 0 00-2 2v7.6c0 .5.2 1 .6 1.4l8.4 8.4c.8.8 2 .8 2.8 0l7-7c.8-.8.8-2 0-2.8L13.4 3.6c-.4-.4-.9-.6-1.4-.6z" /><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none" /></svg>;
}
export function FolderIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M3.5 6.5A1.5 1.5 0 015 5h4.2l2 2.2H19a1.5 1.5 0 011.5 1.5v9A1.5 1.5 0 0119 19.2H5A1.5 1.5 0 013.5 17.7z" /></svg>;
}
/** Rezervata pentru filtre SALVATE (combinatii de filtre denumite de utilizator) — distincta de TagIcon (etichete de scena/culoare individuale). */
export function BookmarkIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M6.5 4h11a1 1 0 011 1v15.5l-6.5-4-6.5 4V5a1 1 0 011-1z" /></svg>;
}
/** Badge "Subexpus" pe thumbnail — cerc plin (intunecat) cu un minus, distinct de SunIcon/MoonIcon (rezervate temei). */
export function UnderexposedIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><line x1="8" y1="12" x2="16" y2="12" /></svg>;
}
/** Badge "Zambet fortat/expresie stanjenitoare" pe thumbnail (groupAwkwardRatio) — fata cu gura in zigzag, distincta de EyeClosedIcon. */
export function AwkwardExpressionIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><circle cx="8.7" cy="10" r="0.9" fill="currentColor" stroke="none" /><circle cx="15.3" cy="10" r="0.9" fill="currentColor" stroke="none" /><path d="M7.5 15.5l2-1.3 2 1.3 2-1.3 2 1.3" /></svg>;
}
/** Badge "Best of series" pe thumbnail (pickBestInGroup) — panglica/medalie simpla, distincta de StarIcon (rezervat strict pentru rating). */
export function RibbonIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><circle cx="12" cy="8.5" r="5" /><path d="M9 12.8L7 21l5-2.8 5 2.8-2-8.2" /></svg>;
}
/** Badge "apreciata de client" (galerie client cu feedback) — inima plina. */
export function HeartIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M12 20.5s-7.5-4.6-9.7-9C.7 8 2 4.5 5.3 3.7c2-.5 3.9.3 5.2 2 .3.4.8.4 1 0 1.3-1.7 3.2-2.5 5.2-2 3.3.8 4.6 4.3 3 7.8-2.2 4.4-9.7 9-9.7 9z" /></svg>;
}
/** Badge "respinsa de client" — aceeasi inima, estompata + taiata, la fel ca EyeClosedIcon fata de un ochi normal. */
export function HeartOffIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M12 20.5s-7.5-4.6-9.7-9C.7 8 2 4.5 5.3 3.7c2-.5 3.9.3 5.2 2 .3.4.8.4 1 0 1.3-1.7 3.2-2.5 5.2-2 3.3.8 4.6 4.3 3 7.8-2.2 4.4-9.7 9-9.7 9z" opacity="0.35" /><line x1="3" y1="20" x2="21" y2="4" /></svg>;
}
export function FocusIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M4 9V6a2 2 0 012-2h3" /><path d="M20 9V6a2 2 0 00-2-2h-3" /><path d="M4 15v3a2 2 0 002 2h3" /><path d="M20 15v3a2 2 0 01-2 2h-3" /><circle cx="12" cy="12" r="3" /></svg>;
}
export function UndoIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M7 8L3.5 11.5 7 15" /><path d="M3.5 11.5H14a5.5 5.5 0 010 11H9" /></svg>;
}
export function CropIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" /></svg>;
}
export function SearchIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><circle cx="10.5" cy="10.5" r="6.5" /><line x1="20" y1="20" x2="15.2" y2="15.2" /></svg>;
}
export function SunIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="4.2" />
      <line x1="12" y1="2.5" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="21.5" />
      <line x1="4.2" y1="4.2" x2="6" y2="6" />
      <line x1="18" y1="18" x2="19.8" y2="19.8" />
      <line x1="2.5" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="21.5" y2="12" />
      <line x1="4.2" y1="19.8" x2="6" y2="18" />
      <line x1="18" y1="6" x2="19.8" y2="4.2" />
    </svg>
  );
}
export function MoonIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M20 14.5A8.5 8.5 0 1110.2 4a6.8 6.8 0 009.8 10.5z" /></svg>;
}
export function GridIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...p}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.2" />
    </svg>
  );
}
export function GlobeIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.8 2.5 4.2 5.8 4.2 9s-1.4 6.5-4.2 9c-2.8-2.5-4.2-5.8-4.2-9s1.4-6.5 4.2-9z" />
    </svg>
  );
}
export function BarChartIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><line x1="5" y1="20" x2="5" y2="12" /><line x1="12" y1="20" x2="12" y2="6" /><line x1="19" y1="20" x2="19" y2="15" /></svg>;
}
export function ClockIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5.5l3.5 2" /></svg>;
}
export function PinIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M12 21s7-6.8 7-12a7 7 0 1 0-14 0c0 5.2 7 12 7 12z" /><circle cx="12" cy="9" r="2.4" /></svg>;
}
export function FilterDotIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M4 6h16" /><path d="M7.5 12h9" /><path d="M11 18h2" /></svg>;
}
export function MoreIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" /></svg>;
}
export function ApertureIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v5.2M19.8 7.5l-4.5 2.6M19.8 16.5l-4.5-2.6M12 21v-5.2M4.2 16.5l4.5-2.6M4.2 7.5l4.5 2.6" />
    </svg>
  );
}
export function KeyboardIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...p}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <line x1="6" y1="10" x2="6" y2="10" />
      <line x1="9.5" y1="10" x2="9.5" y2="10" />
      <line x1="13" y1="10" x2="13" y2="10" />
      <line x1="16.5" y1="10" x2="16.5" y2="10" />
      <line x1="20" y1="10" x2="20" y2="10" />
      <line x1="7" y1="14.5" x2="17" y2="14.5" />
    </svg>
  );
}
export function BatteryIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...p}>
      <rect x="2" y="7" width="17" height="10" rx="2" />
      <line x1="21" y1="10.5" x2="21" y2="13.5" />
      <path d="M6.5 12h4l-1.5 3" />
    </svg>
  );
}
export function PlayIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><path d="M7 4l13 8-13 8z" /></svg>;
}
export function PauseIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...base} {...p}><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>;
}
export function MaximizeIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...p}>
      <path d="M8 3H4v4" /><path d="M16 3h4v4" /><path d="M8 21H4v-4" /><path d="M16 21h4v-4" />
    </svg>
  );
}
export function PrinterIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...p}>
      <path d="M6 9V3h12v6" />
      <rect x="4" y="9" width="16" height="8" rx="2" />
      <path d="M6 14h12v7H6z" />
    </svg>
  );
}
