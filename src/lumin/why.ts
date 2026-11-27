import { usePacedPhotos } from './useLxPhotos';
import { useEffect, useMemo, useState } from 'react';
import { contextEngine } from '../core/learning/ContextEngine';
import { favoritePeople } from '../core/personTaste';
import { explainWhy, type WhyResult, type WhySignals } from './whyText';

/**
 * lumin/why.ts
 * De ce ar păstra-o omul, spus ca o propoziție către el, nu ca etichete:
 * „Am păstrat-o: e Angi — păstrezi 9 din 10 poze cu Angi, zâmbește și e clară.”
 * Aici se adună ce știe Lumi (oamenii la care ții, subiectele pe care le păstrezi,
 * seriile); textul îl scrie funcția pură din whyText.ts.
 */
export interface WhyPhoto extends WhySignals {
  personNames: string[];
  sceneTags?: string[];
  groupId?: string;
}

export interface WhyContext {
  loved: { name: string; rate: number }[];
  subjects: string[];
  /** Cel mai bun scor din fiecare serie: „mai e una aproape la fel, mai bună”. */
  groupBest?: ReadonlyMap<string, number>;
  /** Claritatea celui mai bun cadru din fiecare serie: „…una mai clară”. */
  groupBestSharp?: ReadonlyMap<string, number>;
  /** Câte cadre are fiecare serie (doar seriile de cel puțin două contează). */
  groupSize?: ReadonlyMap<string, number>;
}

type Tr = (key: string, vars?: Record<string, string | number>) => string;

let cachedSubjects: string[] | null = null;
const GENERIC = new Set(['person', 'people', 'face', 'smile', 'fun', 'selfie', 'skin', 'hair', 'eyelash', 'clothing', 'sleeve', 'jacket', 'happy', 'child', 'baby']);
/** Cu cât trebuie să fie mai clar celălalt cadru ca să spunem „mai clară”, nu doar „mai reușită”. */
const SHARPER_BY = 10;

/** Ce știe Lumi despre gustul omului (subiectele se citesc o dată, apoi din memorie). */
export function useWhyContext(): WhyContext {
  const [subjects, setSubjects] = useState<string[]>(cachedSubjects ?? []);
  useEffect(() => {
    if (cachedSubjects) return;
    void contextEngine.keptSubjects(8).then(list => {
      cachedSubjects = list.map(x => x.tag.toLowerCase());
      setSubjects(cachedSubjects);
    }).catch(() => {});
  }, []);
  const photos = usePacedPhotos();
  const series = useMemo(() => {
    const best = new Map<string, number>();
    const sharp = new Map<string, number>();
    const size = new Map<string, number>();
    for (const p of photos) {
      if (!p.groupId || p.aside) continue;
      size.set(p.groupId, (size.get(p.groupId) ?? 0) + 1);
      if (p.aiScore > (best.get(p.groupId) ?? -1)) { best.set(p.groupId, p.aiScore); sharp.set(p.groupId, p.sharpness); }
    }
    return { best, sharp, size };
  }, [photos]);
  return { loved: favoritePeople(), subjects, groupBest: series.best, groupBestSharp: series.sharp, groupSize: series.size };
}

/**
 * Propoziția și etichetele pentru o poză. `twin` = cadrul mai reușit arătat pe ecran
 * (sau doar `true` când știm că e acolo, fără detalii).
 */
export function personalWhyFull(p: WhyPhoto, ctx: WhyContext, tr: Tr, twin?: boolean | { sharpness: number } | null): WhyResult {
  const inSeries = !!p.groupId && (ctx.groupSize?.get(p.groupId) ?? 0) > 1;
  const best = inSeries && p.groupId ? ctx.groupBest?.get(p.groupId) : undefined;
  const bestSharp = inSeries && p.groupId ? ctx.groupBestSharp?.get(p.groupId) : undefined;
  let betterTwin: { sharper: boolean } | null = null;
  if (twin && typeof twin === 'object') betterTwin = { sharper: twin.sharpness >= p.sharpness + SHARPER_BY };
  else if (twin) betterTwin = { sharper: false };
  // Din serie, doar unde verdictul e deja „n-ai păstra-o” (nu contrazice eticheta AI-ului).
  else if (best !== undefined && best > p.aiScore + 3 && (p.status === 'rejected' || (p.status !== 'selected' && p.aiScore < 50))) {
    betterTwin = { sharper: bestSharp !== undefined && bestSharp >= p.sharpness + SHARPER_BY };
  }
  // „Genul de poză pe care o păstrezi” doar pe subiecte care spun ceva
  // (nu „persoană”, „zâmbet”, prezente pe orice poză).
  const keptSubject = (p.sceneTags ?? []).some(t => !GENERIC.has(t.toLowerCase()) && ctx.subjects.includes(t.toLowerCase()));
  return explainWhy(p, {
    loved: ctx.loved,
    keptSubject,
    betterTwin,
    bestOfSeries: best !== undefined && p.aiScore >= best && !betterTwin
  }, tr);
}

export function personalWhy(p: WhyPhoto, ctx: WhyContext, tr: Tr, twin?: boolean | { sharpness: number } | null): string {
  return personalWhyFull(p, ctx, tr, twin).sentence;
}
