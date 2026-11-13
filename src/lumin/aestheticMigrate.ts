/**
 * lumin/aestheticMigrate.ts
 * O singură dată după ce capul estetic LAION a ieșit din aplicație: scorul estetic al pozelor
 * deja citite se refăcă din amprenta CLIP salvată (fără o nouă citire a galeriei), ca pozele
 * vechi și cele noi să fie judecate pe aceeași scară.
 */
import { db } from '../core/db';
import { aestheticOf } from '../core/clip/clipEngine';
import { useStore } from '../state/store';

export const AESTHETIC_MIG_KEY = 'cp.mig.aesthetic1113';

export async function migrateAesthetic(): Promise<number> {
  const rows = await db.analyses.filter(a => Array.isArray(a.clipEmbedding) && a.clipEmbedding.length === 512).toArray();
  const changed = new Map<string, number>();
  for (const a of rows) {
    const next = aestheticOf(a.clipEmbedding as number[]);
    if (a.aesthetic === next) continue;
    changed.set(a.photoId, next);
  }
  if (!changed.size) return 0;
  await db.transaction('rw', db.analyses, async () => {
    for (const [id, aesthetic] of changed) await db.analyses.update(id, { aesthetic });
  });
  useStore.setState(s => ({ photos: s.photos.map(p => (changed.has(p.id) ? { ...p, aesthetic: changed.get(p.id) } : p)) }));
  return changed.size;
}
