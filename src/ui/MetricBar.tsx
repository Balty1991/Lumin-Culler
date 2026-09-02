import type { ReactNode } from 'react';
import { DEFECT_SHARPNESS, DEFECT_EYES_OPEN_RATIO } from '../core/importPipeline';

/**
 * ui/MetricBar.tsx
 * Un rand de metrica din panoul de scor: iconita, nume, bara, procent.
 *
 * DE CE EXISTA. Randurile astea erau scrise de trei ori la rand in TikTokSort
 * (si inca o data in alta forma in PhotoInfoTabs), fiecare cu procentul
 * calculat de DOUA ori — o data pentru latimea barei, o data pentru eticheta.
 * Dar problema adevarata nu era duplicarea, ci ca toate barele erau de aceeasi
 * culoare: "Zambet 60%" si "Ochi OK 100%" aratau identic, desi una dintre ele
 * spune ca poza e in regula si cealalta nu spune nimic. Chiar langa ele,
 * inelul de scor E colorat. Aplicatia avea deja vocabularul (verde/ambru/rosu)
 * si nu-l folosea acolo unde ar fi ajutat cel mai mult.
 *
 * CE INSEAMNA CULOAREA, si de ce nu e o parere. O bara se coloreaza numai la
 * pragul la care MOTORUL insusi numara un defect (DEFECT_SHARPNESS,
 * DEFECT_EYES_OPEN_RATIO din importPipeline.ts — aceleasi constante, importate,
 * nu copiate). Deci rosul nu spune "poza asta e proasta", spune exact "asta a
 * contat la scor". O bara rosie la 50 langa un motor care considera defect abia
 * sub 45 ar fi fost doua opinii in acelasi ecran.
 *
 * CE RAMANE NECOLORAT, deliberat: zambetul. Un portret serios nu e un defect,
 * si motorul nu-l trateaza ca atare — `hasNamedDefect` nici nu se uita la el.
 * A-l colora rosu la 30% ar fi fost o judecata de gust pe care aplicatia nu si-o
 * asuma nicaieri altundeva, strecurata printr-o culoare.
 */
export type MetricTone = 'neutral' | 'good' | 'bad';

/** Claritatea, pe scara 0..100 a analizei. */
export function sharpnessTone(sharpness: number): MetricTone {
  return sharpness < DEFECT_SHARPNESS ? 'bad' : 'good';
}

/** Ochii deschisi, ca fractiune 0..1 (la o singura fata: 1 sau 0). */
export function eyesTone(openRatio: number): MetricTone {
  return openRatio < DEFECT_EYES_OPEN_RATIO ? 'bad' : 'good';
}

export function MetricBar({ icon, label, percent, tone = 'neutral', className = 'tiktok-score-metric' }: {
  icon: ReactNode;
  label: string;
  /** 0..100, deja rotunjit de apelant daca vrea altfel. */
  percent: number;
  tone?: MetricTone;
  /** Clasa randului — panourile difera vizual, dar structura si regula de culoare sunt aceleasi. */
  className?: string;
}) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className={className} data-tone={tone}>
      {icon}
      <span>{label}</span>
      {/* aria-hidden pe bara: procentul de langa ea spune acelasi lucru in text,
          iar o bara anuntata separat ar dubla fiecare rand la cititorul de ecran. */}
      <i aria-hidden="true"><b style={{ width: `${value}%` }} /></i>
      <b className="tiktok-score-metric-pct">{value}%</b>
    </div>
  );
}
