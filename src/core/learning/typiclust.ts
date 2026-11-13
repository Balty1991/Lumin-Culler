/**
 * core/learning/typiclust.ts
 * Ce poze să-i arăți omului la antrenament, ca puține alegeri să acopere toată galeria
 * (TypiClust: grupezi amprentele în k grupuri și iei din fiecare poza cea mai tipică,
 * adică cea mai apropiată de vecinii ei). Mai bine decât la întâmplare la început:
 * o alegere pe o poză tipică învață despre tot grupul ei.
 */
function dist2(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return s;
}

/** k-means++ cu pornire deterministă (seed), câteva iterații: e destul pentru alegere. */
export function kmeans(xs: readonly ArrayLike<number>[], k: number, iters = 8, seed = 1): number[] {
  const n = xs.length;
  if (!n) return [];
  k = Math.min(k, n);
  let s = seed >>> 0 || 1;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const d = xs[0].length;
  const centers: number[][] = [Array.from(xs[Math.floor(rnd() * n)])];
  const best = xs.map(x => dist2(x, centers[0]));
  while (centers.length < k) {
    const total = best.reduce((a, v) => a + v, 0);
    let r = rnd() * total, pick = 0;
    for (; pick < n - 1; pick++) { r -= best[pick]; if (r <= 0) break; }
    centers.push(Array.from(xs[pick]));
    xs.forEach((x, i) => { best[i] = Math.min(best[i], dist2(x, centers[centers.length - 1])); });
  }
  const label = new Array<number>(n).fill(0);
  for (let it = 0; it < iters; it++) {
    xs.forEach((x, i) => {
      let bi = 0, bd = Infinity;
      centers.forEach((c, j) => { const dd = dist2(x, c); if (dd < bd) { bd = dd; bi = j; } });
      label[i] = bi;
    });
    const sum = centers.map(() => new Array<number>(d).fill(0));
    const cnt = new Array<number>(centers.length).fill(0);
    xs.forEach((x, i) => { cnt[label[i]]++; for (let j = 0; j < d; j++) sum[label[i]][j] += x[j]; });
    sum.forEach((v, j) => { if (cnt[j]) centers[j] = v.map(t => t / cnt[j]); });
  }
  return label;
}

/**
 * Indicii pozelor alese: câte una din fiecare grup, cea mai tipică (distanța medie cea mai
 * mică față de ceilalți din grup). Grupurile mari întâi: acoperă cele mai multe poze.
 */
export function typicalPicks(xs: readonly ArrayLike<number>[], k: number, seed = 1): number[] {
  const label = kmeans(xs, k, 8, seed);
  const groups = new Map<number, number[]>();
  label.forEach((g, i) => { const list = groups.get(g); if (list) list.push(i); else groups.set(g, [i]); });
  const out: number[] = [];
  for (const members of [...groups.values()].sort((a, b) => b.length - a.length)) {
    // Pe grupuri mari, doar un eșantion pentru tipicitate (cost pătratic).
    const probe = members.length > 60 ? members.filter((_, i) => i % Math.ceil(members.length / 60) === 0) : members;
    let bi = members[0], bd = Infinity;
    for (const i of members) {
      let s = 0;
      for (const j of probe) if (j !== i) s += Math.sqrt(dist2(xs[i], xs[j]));
      if (s < bd) { bd = s; bi = i; }
    }
    out.push(bi);
  }
  return out;
}
