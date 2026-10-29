import type { PhotoView } from '../state/store';
import { photoTime } from './days';

/**
 * lumin/autoFolders.ts
 * Dosarele care se fac singure în „Puse deoparte”, din textul citit în poză:
 * „Bonuri 2026”, „Acte”, „Capturi de chat”. Nu se salvează nicăieri — se
 * recalculează, deci fiecare bon nou intră singur în dosarul anului lui.
 */
export interface AutoFolder { id: string; key: 'receipts' | 'ids' | 'chats' | 'otherShots'; year?: number; ids: string[] }

const RECEIPT = /\b(bon fiscal|total|tva|subtotal|rest|numerar|card|lei|ron|cif|cui|casier|receipt|amount)\b/i;
const IDS = /\b(cnp|carte de identitate|buletin|permis|pa[sș]aport|passport|certificat|contract|diplom[aă]|seria\s+[a-z]{2})\b/i;
const CHAT = /\b(whatsapp|messenger|telegram|instagram|online|typing|scrie|v[aă]zut|seen|delivered|livrat|ieri|yesterday|mesaj|message)\b|\d{1,2}:\d{2}\s*(am|pm)?\s*$/im;

export function autoFolders(aside: readonly PhotoView[]): AutoFolder[] {
  const receipts = new Map<number, string[]>();
  const ids: string[] = [], chats: string[] = [], shots: string[] = [];
  for (const p of aside) {
    const text = p.ocrText ?? '';
    if (p.aside === 'document' && IDS.test(text)) ids.push(p.id);
    else if (p.aside === 'document' && RECEIPT.test(text)) {
      const y = new Date(photoTime(p)).getFullYear();
      receipts.set(y, [...(receipts.get(y) ?? []), p.id]);
    } else if (p.aside === 'screenshot' && CHAT.test(text)) chats.push(p.id);
    else if (p.aside === 'screenshot') shots.push(p.id);
  }
  const out: AutoFolder[] = [...receipts.entries()].sort((a, b) => b[0] - a[0])
    .map(([year, list]) => ({ id: `auto:receipts:${year}`, key: 'receipts' as const, year, ids: list }));
  if (ids.length) out.push({ id: 'auto:ids', key: 'ids', ids });
  if (chats.length) out.push({ id: 'auto:chats', key: 'chats', ids: chats });
  if (shots.length && chats.length) out.push({ id: 'auto:otherShots', key: 'otherShots', ids: shots });
  return out.filter(f => f.ids.length >= 2);
}
