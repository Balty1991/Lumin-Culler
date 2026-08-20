import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { db } from '../core/db';
import { findExactDuplicates, summariseDuplicates, type DuplicateCandidate } from '../core/exactDuplicates';

/**
 * Cate copii identice sunt de scos — pentru insigna din meniu.
 *
 * Spre deosebire de celelalte contoare din sertar, asta NU se poate calcula din
 * `photos`: amprenta (dHash) sta doar in baza de date. Deci se citeste o
 * singura data, cand se deschide meniul, si nu la fiecare randare — meniul n-are
 * voie sa coste cat un panou (acelasi principiu ca la countRescuable).
 */
export function useExactDupeCount(menuOpen: boolean): number {
  const photos = useStore(s => s.photos);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!menuOpen) return;
    let alive = true;
    void db.photos.toArray().then(records => {
      if (!alive) return;
      const live = new Set(photos.map(p => p.id));
      const items: DuplicateCandidate[] = records
        .filter(r => live.has(r.id) && r.status !== 'rejected')
        .map(r => ({
          id: r.id, dHash: r.dHash, sizeBytes: r.sizeBytes, fileName: r.fileName,
          capturedAt: r.capturedAt, importedAt: r.importedAt, status: r.status
        }));
      setCount(summariseDuplicates(findExactDuplicates(items)).duplicates);
    });
    return () => { alive = false; };
    // `photos.length` e destul: o schimbare de status nu adauga copii noi, iar
    // dependenta pe intreg array-ul ar reciti baza la fiecare decizie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, photos.length]);

  return count;
}
