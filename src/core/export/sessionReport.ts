/**
 * core/export/sessionReport.ts
 * Sumar de sesiune (plan "modernizare") — cateva cifre utile pentru
 * documentare/facturare fata de client (cate poze, cat a durat triajul,
 * cat de "generoasa" a fost selectia), generat ca fisier text simplu,
 * descarcabil alaturi de restul exporturilor.
 */
import type { LibraryStats } from '../stats';
import type { StageStat } from '../stageTiming';

export interface SessionReportInput {
  stats: LibraryStats;
  projectName: string;
  /** cel mai vechi `importedAt` din biblioteca curenta — aproximeaza inceputul sesiunii. */
  earliestImportedAt: number | null;
  /** momentul generarii raportului (parametru, nu Date.now() direct — testabil). */
  generatedAt: number;
  /**
   * Defalcarea pe etape a importului (core/stageTiming.ts) — optionala, si
   * inclusa DOAR daca s-a masurat ceva. Aici e utila mai ales in testarea
   * inchisa: un tester poate trimite raportul cu unde s-a dus timpul pe
   * telefonul LUI, fara sa trimita vreo poza si fara telemetrie pe server.
   */
  stageStats?: StageStat[];
}

/** ex: 45m, 2h 15m, 3z 4h — zile/ore/minute, nu doar secunde (o sesiune reala poate dura zile). */
function formatSpan(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}z ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

export function buildSessionReportText({ stats, projectName, earliestImportedAt, generatedAt, stageStats }: SessionReportInput): string {
  const lines: string[] = [];
  lines.push('Raport de sesiune — Lumin Culler');
  lines.push(`Proiect: ${projectName || '(fara nume)'}`);
  lines.push(`Generat: ${new Date(generatedAt).toLocaleString()}`);
  lines.push('');
  lines.push(`Poze totale: ${stats.total}`);
  lines.push(`  Selectate: ${stats.selected} (${pct(stats.selected, stats.total)}%)`);
  lines.push(`  De verificat: ${stats.review} (${pct(stats.review, stats.total)}%)`);
  lines.push(`  Respinse: ${stats.rejected} (${pct(stats.rejected, stats.total)}%)`);
  if (stats.pending > 0) lines.push(`  Nedecise: ${stats.pending} (${pct(stats.pending, stats.total)}%)`);
  lines.push('');
  lines.push(`Scor AI mediu: ${stats.avgAiScore}`);
  if (stats.seriesCount > 0) lines.push(`Serii/duplicate: ${stats.seriesCount}`);
  if (earliestImportedAt !== null) {
    lines.push('');
    lines.push(`Sesiune incepusa: ${new Date(earliestImportedAt).toLocaleString()}`);
    lines.push(`Durata de la primul import: ${formatSpan(generatedAt - earliestImportedAt)}`);
  }
  if (stageStats?.length) {
    const total = stageStats.reduce((sum, st) => sum + st.totalMs, 0);
    lines.push('');
    lines.push('Unde s-a dus timpul la import (numai durate, pe acest dispozitiv)');
    for (const st of stageStats) {
      lines.push(
        `  ${st.stage}: ${pct(st.totalMs, total)}% din timp` +
        ` · ${st.count} masuratori` +
        ` · mediana ${Math.round(st.p50Ms)}ms` +
        ` · p90 ${Math.round(st.p90Ms)}ms`
      );
    }
  }
  return lines.join('\n') + '\n';
}
