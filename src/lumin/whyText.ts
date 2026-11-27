import { reasonsFor, type ReasonInput } from './reasons';

/**
 * lumin/whyText.ts
 * „De ce?” spus ca de un om care te cunoaște: o propoziție scurtă și cel mult
 * 3 etichete, de exemplu
 *   „Am păstrat-o: zâmbește, are ochii deschiși și seamănă cu pozele pe care le păstrezi tu.”
 *   „Am pus-o la Nu păstrez: e aproape la fel cu una mai clară din aceeași serie.”
 * Funcție pură (fără magazin, fără bază de date): primește doar semnalele pozei
 * și ce știe Lumi despre om. Întâi motivele personale (gustul tău, oamenii la
 * care ții), apoi ce se vede în poză. Nu spune nimic ce datele nu susțin.
 */
export interface WhySignals extends ReasonInput {
  status: string;
  /** Hotărârea e a AI-ului (true) sau a omului (false / absent, ca în magazin). */
  aiDecided?: boolean;
  aiScore: number;
  personNames: readonly string[];
  /** Subiectul e clar chiar dacă fundalul nu e (profunzime mică, nu mișcare). */
  subjectInFocus?: boolean;
  /** Cât de probabil o păstrează omul, după modelul lui de gust validat (0..1). */
  tasteP?: number;
}

export interface WhyKnowledge {
  /** Oamenii la care ține omul și cât de des le păstrează pozele (0..1). */
  loved: readonly { name: string; rate: number }[];
  /** Subiectul pozei e printre cele pe care omul le păstrează des. */
  keptSubject?: boolean;
  /** În aceeași serie e un cadru mai reușit; `sharper` doar când e chiar mai clar. */
  betterTwin?: { sharper: boolean } | null;
  /** E cel mai reușit cadru dintr-o serie de cel puțin două. */
  bestOfSeries?: boolean;
}

export interface WhyChip { label: string; tone: 'good' | 'bad' | 'info' }
export interface WhyResult { sentence: string; chips: WhyChip[]; keep: boolean }

type Tr = (key: string, vars?: Record<string, string | number>) => string;
interface Part { text: string; chip: WhyChip }

/** Pragurile la care gustul omului e destul de limpede ca să fie spus cu voce tare. */
export const TASTE_LIKE = 0.7;
export const TASTE_UNLIKE = 0.3;

export function explainWhy(p: WhySignals, k: WhyKnowledge, tr: Tr): WhyResult {
  // Documentele și capturile nu sunt amintiri: asta e tot motivul, spus scurt.
  if (p.aside) {
    return {
      sentence: `${tr('lx.why2.aside')}: ${tr(`lx.why2.aside.${p.aside}`)}.`,
      chips: [{ label: tr(`lx.reason.aside.${p.aside}`), tone: 'info' }],
      keep: false
    };
  }

  const decided = p.status === 'selected' || p.status === 'rejected';
  // Când ecranul arată cadrul mai reușit, verdictul nu poate spune „ai păstra-o”.
  const keep = p.status === 'selected' || (!decided && !k.betterTwin && p.aiScore >= 50);
  const byAi = p.aiDecided === true;
  const lead = tr(decided
    ? (keep ? (byAi ? 'lx.why2.keptByAi' : 'lx.why2.keptByYou') : (byAi ? 'lx.why2.droppedByAi' : 'lx.why2.droppedByYou'))
    : (keep ? 'lx.why.maybeKeep' : 'lx.why.maybeDrop'));

  const parts: Part[] = [];
  const add = (text: string, label: string, tone: WhyChip['tone']) => parts.push({ text, chip: { label, tone } });

  // 1. Cel mai convingător motiv de plecare: e o copie mai slabă a alteia.
  if (!keep && k.betterTwin) {
    add(tr(k.betterTwin.sharper ? 'lx.why2.twin.sharper' : 'lx.why2.twin.better'), tr('lx.why2.chip.twin'), 'bad');
  }

  // 2. Oamenii: cei la care ții, cu cifra ta; altfel doar numele, dacă îl știm.
  const loved = k.loved.find(l => p.personNames.includes(l.name));
  if (loved) add(tr('lx.why.person', { name: loved.name, ofTen: Math.round(loved.rate * 10) }), loved.name, 'good');
  else if (p.personNames.length) {
    const names = p.personNames.slice(0, 2).join(tr('lx.why.and'));
    add(tr('lx.why.isPerson', { name: names }), names, 'info');
  }

  // 3. Gustul tău (doar cu model validat, doar când e limpede și în sensul verdictului).
  if (p.tasteP !== undefined && keep && p.tasteP >= TASTE_LIKE) add(tr('lx.why2.taste.like'), tr('lx.why2.chip.taste'), 'good');
  else if (p.tasteP !== undefined && !keep && p.tasteP <= TASTE_UNLIKE) add(tr('lx.why2.taste.unlike'), tr('lx.why2.chip.notTaste'), 'bad');
  else if (keep && !loved && k.keptSubject) add(tr('lx.why.subject'), tr('lx.why2.chip.subject'), 'good');

  // 4. Seria: păstrată pentru că e cel mai reușit cadru.
  if (keep && k.bestOfSeries) add(tr('lx.why2.bestOfSeries'), tr('lx.reason.best'), 'good');

  // 5. Ce se vede în poză. Fundalul topit cu subiectul clar nu e „mișcată”.
  const focusOnly = p.sharpness < 40 && p.subjectInFocus === true;
  const seen = reasonsFor({ ...p, sharpness: focusOnly ? 60 : p.sharpness })
    .filter(r => r.key !== 'lx.reason.series' && !r.key.startsWith('lx.reason.aside'));
  if (keep && focusOnly) add(tr('lx.why2.focus'), tr('lx.why2.chip.focus'), 'good');
  for (const r of seen.filter(r => r.tone === (keep ? 'good' : 'bad'))) {
    const text = r.key === 'lx.reason.smile' && p.faceCount === 1 ? tr('lx.why2.smileOne') : tr(`${r.key}.why`);
    add(text, tr(r.key), r.tone);
  }

  // Spus cinstit și cusurul unei poze păstrate („deși e mișcată”).
  const flaw = keep ? seen.find(r => r.tone === 'bad') : undefined;
  const top = parts.slice(0, flaw ? 2 : 3);
  if (!top.length) {
    top.push({ text: tr(keep ? 'lx.why.fallbackKeep' : 'lx.why.fallbackDrop'), chip: { label: '', tone: 'info' } });
  }
  const texts = top.map(x => x.text);
  const list = texts.length > 1 ? `${texts.slice(0, -1).join(', ')}${tr('lx.why.and')}${texts[texts.length - 1]}` : texts[0];
  const sentence = flaw ? `${lead}: ${list}, ${tr('lx.why.though')} ${tr(`${flaw.key}.why`)}.` : `${lead}: ${list}.`;
  const chips = top.map(x => x.chip).filter(c => c.label);
  if (flaw && chips.length < 3) chips.push({ label: tr(flaw.key), tone: 'bad' });
  return { sentence, chips: chips.slice(0, 3), keep };
}
