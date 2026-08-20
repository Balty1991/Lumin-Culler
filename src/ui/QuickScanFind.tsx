import { useStore } from '../state/store';
import { t, plural } from '../i18n';
import { formatSize } from '../state/storageStats';

/**
 * ui/QuickScanFind.tsx
 * Prima informatie CONCRETA a unui import: cate copii identice s-au gasit si
 * cat spatiu ocupa degeaba. Apare in primele secunde, cat inca se incarca
 * modelele AI sau ruleaza analiza — vezi core/quickDuplicateScan.ts, care afla
 * asta fara sa decodeze nicio imagine.
 *
 * Sta intr-un component separat pentru ca se arata pe DOUA ecrane diferite ale
 * aceleiasi asteptari (AiBootScreen, pentru incarcarea modelelor, si cardul de
 * progres din App.tsx, pentru analiza propriu-zisa) — altfel acelasi bloc ar fi
 * fost copiat in doua locuri si s-ar fi desincronizat la prima modificare.
 */
export function QuickScanFind() {
  const locale = useStore(s => s.locale);
  const quickScan = useStore(s => s.quickScan);
  if (!quickScan || quickScan.duplicates === 0) return null;
  return (
    <div className="analysis-studio-find">
      <b className="mono">{formatSize(quickScan.wastedBytes)}</b>
      <span>
        {t(locale, plural(quickScan.duplicates, 'app.progress.quickScan.one', 'app.progress.quickScan.other'), { count: quickScan.duplicates })}
      </span>
    </div>
  );
}
