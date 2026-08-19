/**
 * state/resumeProject.ts
 *
 * "Ai lasat ceva neterminat."
 *
 * Triajul unei sesiuni mari nu se face dintr-o data: incepi seara, te
 * intrerupe cineva, te intorci peste doua zile. La revenire, aplicatia arata
 * exact ce arata oricui — biblioteca intreaga — si trebuie sa-ti amintesti
 * singur unde ramasesesi si ce proiect era. Costul asta e cel care face ca
 * sesiunile sa ramana neterminate: nu efortul, ci reintrarea.
 *
 * Modulul gaseste proiectul cu cel mai mult de recuperat si spune in cate
 * cadre a ramas. Nu propune nimic cand nu e nimic de propus: un proiect
 * terminat sau abia inceput nu e o "reluare".
 *
 * Pur, fara store si fara i18n — intoarce cifre, iar interfata face fraza.
 */

export interface ProjectPhoto {
  /** Numele proiectului. Gol/absent = poze fara proiect. */
  project?: string;
  status: 'selected' | 'review' | 'rejected' | 'pending';
}

export interface ResumeCandidate {
  project: string;
  /** Cadre pe care nu le-a atins nimeni inca. */
  remaining: number;
  /** Cadre deja decise (pastrate sau respinse). */
  decided: number;
  total: number;
  /** Procentul decis, 0..100 — cat de aproape e de final. */
  percent: number;
}

/** Sub atat de putine cadre ramase, nu merita numit "de reluat" — se termina din drum. */
export const MIN_REMAINING = 3;
/**
 * Sub atat de mult progres, proiectul e "abia inceput", nu "intrerupt". A-l
 * numi reluare ar transforma orice import netriat intr-o restanta, si mesajul
 * si-ar pierde intelesul exact cand ar trebui sa conteze.
 */
export const MIN_PERCENT = 10;

/** `review` inseamna "am vazut-o, dar nu m-am hotarat" — decizie inceputa, nu luata. */
function isDecided(status: ProjectPhoto['status']): boolean {
  return status === 'selected' || status === 'rejected';
}

/**
 * Proiectele intrerupte, cel mai avansat primul: cand ai de ales, e mai usor
 * sa termini ce era aproape gata decat sa reincepi altceva.
 */
export function findResumableProjects(photos: ProjectPhoto[]): ResumeCandidate[] {
  const byProject = new Map<string, { decided: number; total: number }>();
  for (const p of photos) {
    const name = p.project?.trim();
    if (!name) continue;
    const acc = byProject.get(name) ?? { decided: 0, total: 0 };
    acc.total++;
    if (isDecided(p.status)) acc.decided++;
    byProject.set(name, acc);
  }

  const out: ResumeCandidate[] = [];
  for (const [project, a] of byProject) {
    const remaining = a.total - a.decided;
    if (remaining < MIN_REMAINING) continue;
    const percent = a.total > 0 ? Math.round((a.decided / a.total) * 100) : 0;
    if (percent < MIN_PERCENT) continue;
    out.push({ project, remaining, decided: a.decided, total: a.total, percent });
  }
  return out.sort((a, b) => b.percent - a.percent || a.remaining - b.remaining || a.project.localeCompare(b.project));
}

/** Proiectul de propus la revenire, sau `null` daca nu e nimic de reluat. */
export function pickResumeTarget(photos: ProjectPhoto[]): ResumeCandidate | null {
  return findResumableProjects(photos)[0] ?? null;
}
