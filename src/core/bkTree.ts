/**
 * core/bkTree.ts
 * BK-tree (Burkhard-Keller) generic pentru cautare EXACTA intr-un spatiu metric —
 * folosit la gruparea seriilor dupa distanta Hamming intre dHash-uri (plan 2.3.3,
 * "algoritmi de comparare mai rapizi... LSH"). Spre deosebire de LSH clasic
 * (aproximativ — poate rata potriviri reale din cauza hash-urilor probabilistice),
 * un BK-tree gaseste mereu TOATE nodurile aflate la distanta <= raza cautata,
 * fara riscul de a sparge silentios o grupare corecta — important aici, unde
 * rezultatul decide direct ce poze ajung marcate "serie/duplicat".
 *
 * Complexitate: O(n) in cazul degenerat (toate cheile identice sau la aceeasi
 * distanta unele de altele — exact ca varianta liniara pe care o inlocuieste),
 * dar mult sub O(n) per interogare cand cheile sunt suficient de variate
 * (cazul tipic: fotografii distincte, nu un singur burst urias) — exact
 * castigul cerut pentru biblioteci de zeci de mii de poze.
 */

export interface BKNode<T> {
  key: string;
  value: T;
  children: Map<number, BKNode<T>>;
}

export type DistanceFn = (a: string, b: string) => number;

/** Insereaza (key, value) in arbore, cream radacina daca lipseste. Chei identice se inlantuie (copil la distanta 0), nu se pierd. */
export function bkInsert<T>(root: BKNode<T> | null, key: string, value: T, distance: DistanceFn): BKNode<T> {
  if (!root) return { key, value, children: new Map() };
  let node = root;
  for (;;) {
    const d = distance(key, node.key);
    const child = node.children.get(d);
    if (!child) {
      node.children.set(d, { key, value, children: new Map() });
      return root;
    }
    node = child;
  }
}

/** Toate valorile ale caror chei sunt la distanta <= radius fata de `key` — exact, fara aproximare. */
export function bkQuery<T>(root: BKNode<T> | null, key: string, radius: number, distance: DistanceFn): T[] {
  const results: T[] = [];
  if (!root) return results;
  const stack: BKNode<T>[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    const d = distance(key, node.key);
    if (d <= radius) results.push(node.value);
    // inegalitatea triunghiului: un copil legat la distanta `childDist` de nod nu poate fi
    // in raza cautata decat daca |childDist - d| <= radius — restul subarborilor se elimina fara sa fie vizitati
    for (const [childDist, child] of node.children) {
      if (Math.abs(childDist - d) <= radius) stack.push(child);
    }
  }
  return results;
}
