/**
 * lumin/smartFolders.ts
 * Dosarele inteligente: „Mașina”, „Casa”, „Mâncare”, „Haine”, „Animale”,
 * „Natură”, „Documente” — făcute singure din ce se vede în poze (etichetele de
 * scenă de la import), fără ca omul să mute ceva.
 */
export interface SmartFolder { id: string; emoji: string; tags: readonly string[]; aside?: boolean }

export const SMART_FOLDERS: readonly SmartFolder[] = [
  { id: 'car', emoji: '🚗', tags: ['car', 'vehicle', 'wheel', 'tire', 'motorcycle', 'bicycle', 'truck'] },
  { id: 'home', emoji: '🏠', tags: ['room', 'furniture', 'couch', 'sofa', 'bed', 'kitchen', 'interior design', 'house', 'home', 'curtain', 'shelf'] },
  { id: 'food', emoji: '🍝', tags: ['food', 'dish', 'cuisine', 'cake', 'dessert', 'meal', 'pizza', 'bread', 'fruit', 'vegetable', 'cookie', 'drink'] },
  { id: 'clothes', emoji: '👗', tags: ['clothing', 'dress', 'shoe', 'jeans', 'handbag', 'jacket', 'sneakers', 'boot', 'shirt', 'hat'] },
  { id: 'pets', emoji: '🐾', tags: ['cat', 'dog', 'pet', 'animal', 'bird', 'horse', 'kitten', 'puppy'] },
  { id: 'nature', emoji: '🌿', tags: ['plant', 'flower', 'tree', 'forest', 'mountain', 'beach', 'sea', 'lake', 'sky', 'garden', 'grass'] },
  { id: 'docs', emoji: '📄', tags: [], aside: true }
];

interface FolderPhoto { sceneTags?: string[]; aside?: string | null | false }

export function inFolder(p: FolderPhoto, f: SmartFolder): boolean {
  if (f.aside) return p.aside === 'document';
  if (p.aside) return false;
  const tags = (p.sceneTags ?? []).map(t => t.toLowerCase());
  return tags.some(t => f.tags.includes(t));
}

export function folderCounts(photos: readonly FolderPhoto[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of photos) for (const f of SMART_FOLDERS) if (inFolder(p, f)) out.set(f.id, (out.get(f.id) ?? 0) + 1);
  return out;
}
