import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { contextEngine } from '../core/learning/ContextEngine';
import { favoritePeople } from '../core/personTaste';
import { reasonsFor, type ReasonInput } from './reasons';

/**
 * lumin/why.ts
 * De ce ar păstra-o omul, spus ca o propoziție către el, nu ca etichete:
 * „Ai păstra-o: e Angi (păstrezi 9 din 10 poze cu Angi), zâmbește și e clară.”
 * Din ce a învățat Lumi (oamenii la care ții, subiectele pe care le păstrezi)
 * plus ce se vede în poză.
 */
export interface WhyPhoto extends ReasonInput {
  status: string;
  aiScore: number;
  personNames: string[];
  sceneTags?: string[];
  groupId?: string;
}

export interface WhyContext {
  loved: { name: string; rate: number }[];
  subjects: string[];
  /** Cel mai bun scor din fiecare serie: „mai e una aproape la fel, mai bună”. */
  groupBest?: ReadonlyMap<string, number>;
}

type Tr = (key: string, vars?: Record<string, string | number>) => string;

let cachedSubjects: string[] | null = null;
const GENERIC = new Set(['person', 'people', 'face', 'smile', 'fun', 'selfie', 'skin', 'hair', 'eyelash', 'clothing', 'sleeve', 'jacket', 'happy', 'child', 'baby']);

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
  const photos = useStore(st => st.photos);
  const groupBest = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of photos) if (p.groupId && !p.aside) m.set(p.groupId, Math.max(m.get(p.groupId) ?? 0, p.aiScore));
    return m;
  }, [photos]);
  return { loved: favoritePeople(), subjects, groupBest };
}

export function personalWhy(p: WhyPhoto, ctx: WhyContext, tr: Tr): string {
  const keep = p.status === 'selected' || (p.status !== 'rejected' && p.aiScore >= 50);
  const sure = p.status === 'selected' || p.status === 'rejected';
  const lead = tr(keep ? (sure ? 'lx.why.keep' : 'lx.why.maybeKeep') : (sure ? 'lx.why.drop' : 'lx.why.maybeDrop'));
  const parts: string[] = [];

  // De ce pleacă: întâi cel mai convingător motiv — e o copie mai slabă a alteia.
  const twin = !keep && p.groupId ? ctx.groupBest?.get(p.groupId) : undefined;
  if (twin !== undefined && twin > p.aiScore + 3) parts.push(tr('lx.why.betterTwin'));

  const loved = ctx.loved.find(l => p.personNames.includes(l.name));
  if (loved) parts.push(tr('lx.why.person', { name: loved.name, ofTen: Math.round(loved.rate * 10) }));
  else if (p.personNames.length) parts.push(tr('lx.why.isPerson', { name: p.personNames.slice(0, 2).join(tr('lx.why.and')) }));

  // „Genul de poză pe care o păstrezi” doar când chiar ar păstra-o, și doar pe
  // subiecte care spun ceva (nu „persoană”, „zâmbet”, prezente pe orice poză).
  const subject = keep && !loved && (p.sceneTags ?? []).find(t => !GENERIC.has(t.toLowerCase()) && ctx.subjects.includes(t.toLowerCase()));
  if (subject) parts.push(tr('lx.why.subject'));

  const reasons = reasonsFor(p).filter(r => r.tone === (keep ? 'good' : 'bad') && r.key !== 'lx.reason.series');
  for (const r of reasons.slice(0, keep ? 2 : 2)) parts.push(tr(`${r.key}.why`));

  if (!parts.length) parts.push(tr(keep ? 'lx.why.fallbackKeep' : 'lx.why.fallbackDrop'));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')}${tr('lx.why.and')}${parts[parts.length - 1]}` : parts[0];
  return `${lead}: ${list}.`;
}
