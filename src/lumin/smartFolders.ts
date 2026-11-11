/**
 * lumin/smartFolders.ts
 * Dosarele inteligente: „Mașina”, „Casa”, „Mâncare”, „Haine”, „Animale”,
 * „Natură”, „Documente” — făcute singure din ce se vede în poze (etichetele de
 * scenă de la import), fără ca omul să mute ceva.
 */
/** `objects`: dosarul e despre lucruri, deci pozele cu oameni nu intră (o mașină parcată în spatele copilului nu face poza „Mașina”). */
export interface SmartFolder { id: string; emoji: string; tags: readonly string[]; aside?: boolean; objects?: boolean; /** Etichete care scot poza din dosar (bicicleta e „vehicul”, dar nu e mașină). */ not?: readonly string[] }

export const SMART_FOLDERS: readonly SmartFolder[] = [
  { id: 'car', objects: true, emoji: '🚗', tags: ['car', 'vehicle', 'motorcycle', 'truck', 'van'], not: ['bicycle', 'stroller', 'toy', 'scooter'] },
  { id: 'home', objects: true, emoji: '🏠', tags: ['room', 'furniture', 'couch', 'sofa', 'bed', 'kitchen', 'interior design', 'house', 'home', 'curtain', 'shelf'] },
  { id: 'food', objects: true, emoji: '🍝', tags: ['food', 'dish', 'cuisine', 'cake', 'dessert', 'meal', 'pizza', 'bread', 'fruit', 'vegetable', 'cookie', 'drink'] },
  { id: 'clothes', objects: true, emoji: '👗', tags: ['clothing', 'dress', 'shoe', 'jeans', 'handbag', 'jacket', 'sneakers', 'boot', 'shirt', 'hat'] },
  // Doar animale anume: „pet”/„animal” generice veneau și pe jucării de pluș și copii (raportat).
  { id: 'pets', emoji: '🐾', tags: ['cat', 'dog', 'bird', 'horse', 'kitten', 'puppy', 'rabbit', 'hamster', 'parrot', 'cow', 'sheep', 'goat', 'duck', 'chicken', 'fish'] },
  { id: 'nature', emoji: '🌿', tags: ['plant', 'flower', 'tree', 'forest', 'mountain', 'beach', 'sea', 'lake', 'sky', 'garden', 'grass'] },
  { id: 'docs', emoji: '📄', tags: [], aside: true }
];

interface FolderPhoto { sceneTags?: string[]; aside?: string | null | false; faceCount?: number; personNames?: string[] }

export function inFolder(p: FolderPhoto, f: SmartFolder): boolean {
  if (f.aside) return p.aside === 'document';
  if (p.aside) return false;
  if (f.objects && ((p.faceCount ?? 0) > 0 || (p.personNames?.length ?? 0) > 0)) return false;
  const tags = (p.sceneTags ?? []).map(t => t.toLowerCase());
  if (f.not && tags.some(t => f.not!.includes(t))) return false;
  return tags.some(t => f.tags.includes(t));
}

export function folderCounts(photos: readonly FolderPhoto[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of photos) for (const f of SMART_FOLDERS) if (inFolder(p, f)) out.set(f.id, (out.get(f.id) ?? 0) + 1);
  return out;
}
