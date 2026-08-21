/**
 * core/scoreCounterfactual.ts
 * "Fara asta, poza ar fi trecut."
 *
 * Explicatiile de pana acum spuneau ce a cantarit in scor. Nu spuneau lucrul
 * pe care omul chiar vrea sa-l stie cand nu e de acord cu verdictul: CE anume
 * l-a tinut pe loc, si cat de aproape a fost.
 *
 * Se poate raspunde EXACT, nu aproximativ, si asta e partea frumoasa: scorul e
 * o sigmoida peste o suma de contributii (vezi ContextEngine.predict), deci
 * scoaterea uneia dintre ele e o scadere simpla in log-odds. Nu e o estimare
 * si nu e o parere — e chiar aritmetica din care a iesit scorul, citita
 * invers.
 *
 * Fara i18n si fara DB: intoarce numele feature-ului si verdictul la care s-ar
 * fi ajuns, iar textul se compune in apelant.
 */

export interface ScoreFactor {
  feature: string;
  /** Aportul aditiv al feature-ului in log-odds — exact cum l-a scris predictia. */
  contribution: number;
}

export interface Counterfactual {
  feature: string;
  /** Ce ar fi fost poza fara acel factor. */
  verdict: 'selected' | 'rejected';
  /** Scorul la care s-ar fi ajuns, 0..100 — ca sa se poata arata cat de aproape a fost. */
  score: number;
}

export interface CounterfactualThresholds {
  select: number;
  reject: number;
}

/** Log-odds dintr-un scor 0..100. Marginile se taie: la 0 si 100 logaritmul ar exploda. */
function toLogOdds(score: number): number {
  const p = Math.min(0.999, Math.max(0.001, score / 100));
  return Math.log(p / (1 - p));
}

function toScore(z: number): number {
  return Math.round((1 / (1 + Math.exp(-z))) * 100);
}

/**
 * Singurul factor care, daca n-ar fi existat, ar fi schimbat verdictul.
 *
 * Se cauta doar in directia care conteaza:
 *  - o poza aflata SUB pragul de selectie e tinuta pe loc de un factor NEGATIV;
 *  - una aflata SUB pragul de respingere ar fi fost salvata de disparitia unui
 *    factor negativ la fel;
 *  - iar una deja selectata n-are ce contrafactual sa i se caute — a trecut.
 *
 * Dintre factorii care ar fi schimbat verdictul se alege cel cu aportul cel mai
 * MIC in valoare absoluta: acela e "cat pe ce", si e informatia utila. Cel mai
 * mare ar raspunde la o alta intrebare — "ce a cantarit cel mai mult" — la care
 * raspund deja factorii afisati oricum.
 */
export function findCounterfactual(
  score: number,
  factors: ScoreFactor[] | undefined,
  thresholds: CounterfactualThresholds
): Counterfactual | null {
  if (!factors || !factors.length) return null;
  if (score >= thresholds.select) return null;

  const z = toLogOdds(score);
  let best: Counterfactual | null = null;
  let bestWeight = Infinity;

  for (const f of factors) {
    // Doar factorii care APASA IN JOS pot fi de vina ca poza n-a trecut.
    if (!Number.isFinite(f.contribution) || f.contribution >= 0) continue;
    const without = toScore(z - f.contribution);
    const verdict: Counterfactual['verdict'] | null =
      without >= thresholds.select ? 'selected'
      : score <= thresholds.reject && without > thresholds.reject ? 'rejected'
      : null;
    if (!verdict) continue;
    const weight = Math.abs(f.contribution);
    if (weight < bestWeight) {
      bestWeight = weight;
      best = { feature: f.feature, verdict, score: without };
    }
  }
  return best;
}
