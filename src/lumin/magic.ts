/**
 * lumin/magic.ts
 * Partea de pe telefon a gumei AI și a cerului nou: unde e cerul (masca), ce
 * bucată din poză pleacă la AI (micșorată, cu proporția ei) și cum se pune
 * înapoi rezultatul, la rezoluția pozei, doar în zona din mască, cu margini
 * moi. Restul pozei rămâne neatins, pixel cu pixel.
 */

/** Dreptunghi în pixeli. */
export interface Rect { x: number; y: number; w: number; h: number }

/**
 * Cerul: pornind de pe rândul de sus, pixelii luminoși și „de cer” (albastru,
 * gri-alb, fără verde de copaci), legați între ei și asemănători cu vecinii.
 * `rgba` e o copie mică a pozei (ex. 256 px). Întoarce 1 = cer, 0 = altceva.
 */
export function skyMask(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  const isSkyish = (i: number) => {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max ? (max - min) / max : 0;
    const blue = b >= r && b >= g - 6;
    const grayWhite = sat < 0.12 && lum > 165;
    const greenish = g > r + 12 && g > b + 8;
    return lum > 110 && !greenish && (blue || grayWhite);
  };
  const close = (a: number, b: number) =>
    Math.abs(rgba[a * 4] - rgba[b * 4]) + Math.abs(rgba[a * 4 + 1] - rgba[b * 4 + 1]) + Math.abs(rgba[a * 4 + 2] - rgba[b * 4 + 2]) < 30;
  const stack: number[] = [];
  for (let x = 0; x < w; x++) if (isSkyish(x)) { mask[x] = 1; stack.push(x); }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w, y = (i - x) / w;
    const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const n of next) {
      if (n < 0 || mask[n] || !isSkyish(n) || !close(i, n)) continue;
      mask[n] = 1;
      stack.push(n);
    }
  }
  return mask;
}

export function maskCoverage(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return mask.length ? n / mask.length : 0;
}

/** Cutia care cuprinde masca (în pixelii măștii), lărgită cu `pad` din latura ei și ținută în poză. */
export function maskBounds(mask: Uint8Array, w: number, h: number, pad = 0.35): Rect | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  // Pătrat-ish, cu context în jur: modelul vede ce e lângă ce trebuie șters.
  const side = Math.max(bw, bh) * (1 + 2 * pad);
  const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;
  const cw = Math.min(w, Math.max(side, 32)), ch = Math.min(h, Math.max(side, 32));
  const x = Math.max(0, Math.min(w - cw, cx - cw / 2));
  const y = Math.max(0, Math.min(h - ch, cy - ch / 2));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(cw), h: Math.round(ch) };
}

export type LocalFill = 'erase' | 'sky-blue' | 'sky-sunset';

/**
 * Cer nou sau gumă, fără server: cerul primește un gradient, zona ștearsă
 * ia culoarea celui mai apropiat pixel nemarcat. Marginea se amestecă puțin
 * cu originalul, ca să nu taie cu foarfeca.
 */
export function fillMasked(rgba: Uint8ClampedArray, mask: Uint8Array, w: number, h: number, mode: LocalFill): void {
  const src = rgba.slice();
  const nearest = (x: number, y: number): number => {
    for (let rad = 1; rad <= 24; rad++) {
      for (let dy = -rad; dy <= rad; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        const xs = dy === -rad || dy === rad ? null : [x - rad, x + rad];
        const row = xs ?? Array.from({ length: rad * 2 + 1 }, (_, k) => x - rad + k);
        for (const xx of row) {
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (!mask[q]) return q;
        }
      }
    }
    return -1;
  };
  // Cerul local păstrează norii: luminozitatea din poză modulează culoarea nouă,
  // iar norii aproape albi rămân albi (înainte: o pată plată, portocalie).
  let skyLum = 0, skyN = 0;
  if (mode !== 'erase') {
    for (let p = 0; p < mask.length; p++) if (mask[p]) { skyLum += 0.299 * src[p * 4] + 0.587 * src[p * 4 + 1] + 0.114 * src[p * 4 + 2]; skyN++; }
    skyLum = skyN ? skyLum / skyN : 200;
  }
  let top = h, bottom = 0;
  if (mode !== 'erase') for (let p = 0; p < mask.length; p++) if (mask[p]) { const y = (p / w) | 0; if (y < top) top = y; if (y > bottom) bottom = y; }
  for (let y = 0; y < h; y++) {
    const t = bottom > top ? Math.max(0, Math.min(1, (y - top) / (bottom - top))) : 0;
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!mask[p]) continue;
      const i = p * 4;
      if (mode === 'erase') {
        const q = nearest(x, y);
        if (q < 0) continue;
        rgba[i] = src[q * 4]; rgba[i + 1] = src[q * 4 + 1]; rgba[i + 2] = src[q * 4 + 2];
        continue;
      }
      let tr: number, tg: number, tb: number;
      if (mode === 'sky-blue') {
        tr = 70 + t * 95; tg = 130 + t * 75; tb = 215 + t * 25;
      } else {
        tr = 120 + t * 130; tg = 110 + t * 70; tb = 170 - t * 60;
      }
      const lum = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
      const d = (lum - skyLum) * 0.9;
      const cloud = Math.max(0, Math.min(1, (lum - skyLum - 6) / 40)) * 0.75;
      const mix = (c: number, o: number) => Math.round(Math.max(0, Math.min(255, (c + d) * (1 - cloud) + o * cloud)));
      rgba[i] = mix(tr, src[i]); rgba[i + 1] = mix(tg, src[i + 1]); rgba[i + 2] = mix(tb, src[i + 2]);
    }
  }
}

/** Mărimea trimisă la AI: latura lungă 512, ambele multiplu de 64, proporția păstrată cât se poate. */
export function aiSize(w: number, h: number): { width: number; height: number } {
  const k = 512 / Math.max(w, h);
  const r64 = (v: number) => Math.max(256, Math.min(768, Math.round(v / 64) * 64));
  return { width: r64(w * k), height: r64(h * k) };
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Cer nou pe telefon, fără server. Masca grosieră (găsită pe o copie mică sau pictată)
 * se rafinează la rezoluția pozei după culoare: frunzele, firele și marginea clădirilor
 * rămân, iar pixelii de margine (amestec de cer alb și frunză) se schimbă doar cât e
 * cer în ei, deci nu mai rămâne conturul alb (raportat cu capturi). Norii și umbrele
 * din cer se păstrează, iar restul pozei primește puțin din lumina cerului nou.
 */
export function replaceSky(
  rgba: Uint8ClampedArray, w: number, h: number,
  coarse: Uint8Array, cw: number, ch: number,
  mode: 'sky-blue' | 'sky-sunset',
  protect?: { data: Uint8Array; w: number; h: number },
  segAlpha?: Float32Array
): void {
   
  // Masca găsită se oprește uneori înainte de margine (fâșii albe lângă stâlpi, deasupra
  // acoperișurilor). O lărgim pe celulele vecine cu aceeași culoare și lumină ca cerul,
  // strict (gluga albă de lângă cer e mai întunecată și nu intră).
  coarse = coarse.slice();
  // Oamenii (din model) nu sunt niciodată cer, cu o margine de siguranță.
  const guard = new Uint8Array(cw * ch);
  const person = new Uint8Array(cw * ch);
  if (protect) {
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const px = Math.min(protect.w - 1, ((x + 0.5) * protect.w / cw) | 0), py = Math.min(protect.h - 1, ((y + 0.5) * protect.h / ch) | 0);
      if (!protect.data[py * protect.w + px]) continue;
      person[y * cw + x] = 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < cw && yy < ch) guard[yy * cw + xx] = 1;
      }
    }
    for (let c = 0; c < cw * ch; c++) if (guard[c]) coarse[c] = 0;
  }
  {
    let r0 = 0, g0 = 0, b0 = 0, n0 = 0;
    for (let c = 0; c < cw * ch; c++) if (coarse[c]) {
      const x = Math.min(w - 1, Math.round(((c % cw) + 0.5) * w / cw)), y = Math.min(h - 1, Math.round((((c / cw) | 0) + 0.5) * h / ch));
      const i = (y * w + x) * 4; r0 += rgba[i]; g0 += rgba[i + 1]; b0 += rgba[i + 2]; n0++;
    }
    if (n0) {
      r0 /= n0; g0 /= n0; b0 /= n0;
      const l0 = 0.299 * r0 + 0.587 * g0 + 0.114 * b0;
      const like = (c: number) => {
        const x = Math.min(w - 1, Math.round(((c % cw) + 0.5) * w / cw)), y = Math.min(h - 1, Math.round((((c / cw) | 0) + 0.5) * h / ch));
        const i = (y * w + x) * 4, r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        const k = l / Math.max(1, l0);
        // Spre orizont cerul e mai alb decât media: cu cât e mai luminos, cu atât toleranța crește.
        return l >= l0 - 6 && Math.hypot(r - r0 * k, g - g0 * k, b - b0 * k) < 8 + Math.max(0, l - l0) * 0.7;
      };
      let front: number[] = [];
      for (let c = 0; c < cw * ch; c++) if (coarse[c]) front.push(c);
      // Cerul de după un stâlp sau un fir pornește tot de sus.
      for (let c = 0; c < cw; c++) if (!coarse[c] && !guard[c] && like(c)) { coarse[c] = 1; front.push(c); }
      for (let step = 0; step < 60 && front.length; step++) {
        const next: number[] = [];
        for (const c of front) {
          const x = c % cw, y = (c / cw) | 0;
          for (const n of [x > 0 ? c - 1 : -1, x < cw - 1 ? c + 1 : -1, y > 0 ? c - cw : -1, y < ch - 1 ? c + cw : -1]) {
            if (n < 0 || coarse[n] || guard[n] || !like(n)) continue;
            coarse[n] = 1; next.push(n);
          }
        }
        front = next;
      }
    }
  }
  // Interior sigur: celula și toți vecinii ei sunt cer.
  const inner = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    let all = 1;
    for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (!(xx >= 0 && yy >= 0 && xx < cw && yy < ch && coarse[yy * cw + xx])) { all = 0; break; }
    }
    inner[y * cw + x] = all;
  }
  // Distanța (în celule) până la masca de cer; banda de căutare se stinge lin, nu în trepte.
  const dist = new Float32Array(cw * ch).fill(99);
  {
    let front: number[] = [];
    for (let c = 0; c < cw * ch; c++) if (coarse[c]) { dist[c] = 0; front.push(c); }
    for (let d = 1; d <= 6 && front.length; d++) {
      const next: number[] = [];
      for (const c of front) {
        const x = c % cw, y = (c / cw) | 0;
        for (const n of [x > 0 ? c - 1 : -1, x < cw - 1 ? c + 1 : -1, y > 0 ? c - cw : -1, y < ch - 1 ? c + cw : -1]) {
          if (n < 0 || dist[n] <= d) continue;
          dist[n] = d; next.push(n);
        }
      }
      front = next;
    }
  }
  const bandAt = (x: number, y: number) => {
    // Interpolare biliniară între celule, ca marginea benzii să fie netedă.
    const fx = Math.max(0, Math.min(cw - 1.001, x * cw / w - 0.5)), fy = Math.max(0, Math.min(ch - 1.001, y * ch / h - 0.5));
    const x0 = fx | 0, y0 = fy | 0, u = fx - x0, v = fy - y0;
    const d = dist[y0 * cw + x0] * (1 - u) * (1 - v) + dist[y0 * cw + x0 + 1] * u * (1 - v)
      + dist[(y0 + 1) * cw + x0] * (1 - u) * v + dist[(y0 + 1) * cw + x0 + 1] * u * v;
    return 1 - smooth(2.5, 5, d);
  };
  const cell = (x: number, y: number) => Math.min(ch - 1, (y * ch / h) | 0) * cw + Math.min(cw - 1, (x * cw / w) | 0);
  // Culoarea cerului vechi, din interiorul sigur.
  let sr = 0, sg = 0, sb = 0, sn = 0, top = h, bottom = 0;
  for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
    const c = cell(x, y);
    if (!inner[c]) continue;
    const i = (y * w + x) * 4;
    sr += rgba[i]; sg += rgba[i + 1]; sb += rgba[i + 2]; sn++;
  }
  if (!sn) return;
  sr /= sn; sg /= sn; sb /= sn;
  const sl = 0.299 * sr + 0.587 * sg + 0.114 * sb;
  for (let y = 0; y < h; y++) {
    const rowCell = Math.min(ch - 1, (y * ch / h) | 0) * cw;
    for (let x = 0; x < cw; x++) if (coarse[rowCell + x]) { if (y < top) top = y; if (y > bottom) bottom = y; break; }
  }
  // Cât e cer în fiecare pixel. Culoarea: frunzele, zidurile, firele (altă nuanță) nu sunt cer.
  // Marginea (amestec de cer și frunză): partea de cer se estimează din lumină, față de
  // cel mai întunecat vecin — astfel conturul alb dispare și pe frunze și pe fire.
  const lumAt = (p: number) => 0.299 * rgba[p * 4] + 0.587 * rgba[p * 4 + 1] + 0.114 * rgba[p * 4 + 2];
  const alpha = new Float32Array(w * h);
  const R = Math.max(3, Math.round(Math.max(w, h) / 140));
  // Cerul nu coboară sub ultimul rând găsit (plus o margine): sub el nu căutăm.
  const maxRow = Math.min(h - 1, bottom + Math.round(h * 0.04));
  const rows = maxRow + 1, N = rows * w;
  // Cel mai întunecat vecin al fiecărui pixel (filtru de minim separabil, cu poziția lui).
  const lum = new Float32Array(N);
  for (let p = 0; p < N; p++) lum[p] = lumAt(p);
  const tmpI = new Int32Array(N), minI = new Int32Array(N);
  for (let y = 0; y < rows; y++) for (let x = 0; x < w; x++) {
    let best = y * w + x;
    for (let d = -R; d <= R; d++) { const xx = x + d; if (xx < 0 || xx >= w) continue; const q = y * w + xx; if (lum[q] < lum[best]) best = q; }
    tmpI[y * w + x] = best;
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < w; x++) {
    let best = tmpI[y * w + x];
    for (let d = -R; d <= R; d++) { const yy = y + d; if (yy < 0 || yy >= rows) continue; const q = tmpI[yy * w + x]; if (lum[q] < lum[best]) best = q; }
    minI[y * w + x] = best;
  }
  for (let p = 0; p < N; p++) {
    const i = p * 4;
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const l = lum[p];
    const k = l / Math.max(1, sl);
    const chroma = Math.hypot(r - sr * k, g - sg * k, b - sb * k);
    const aChroma = 1 - smooth(16 + Math.max(0, l - sl) * 0.7, 60, chroma);
    let a = aChroma;
    if (l < sl + 30) {
      // Amestecul: pixel = a·cer + (1−a)·obiectul de lângă (cel mai întunecat vecin).
      // Merge și pe trecerile late și moi (copaci neclari în fundal) și pe fire.
      const fp = minI[p];
      const fr = rgba[fp * 4], fg = rgba[fp * 4 + 1], fb = rgba[fp * 4 + 2];
      const dr = sr - fr, dg = sg - fg, db = sb - fb;
      const dd = dr * dr + dg * dg + db * db;
      if (dd > 30 * 30) {
        const ac = Math.max(0, Math.min(1, ((r - fr) * dr + (g - fg) * dg + (b - fb) * db) / dd));
        const res = Math.hypot(r - (fr + ac * dr), g - (fg + ac * dg), b - (fb + ac * db));
        a = res < 26 ? (l > sl - 4 ? Math.max(ac, aChroma) : ac) : Math.min(ac, aChroma);
      } else if (l < sl - 8) {
        a = Math.min(aChroma, 1 - smooth(8, 30, sl - l));
      }
    }
    const px = p % w, py = (p / w) | 0;
    // Cu modelul: conturul vine din segmentarea rafinată; culoarea mai scoate firele și crengile.
    alpha[p] = segAlpha ? Math.min(a, segAlpha[p]) : person[cell(px, py)] ? 0 : a * bandAt(px, py);
  }
  // Doar ce e legat de cer contează: o căciulă albă de sub glugă seamănă cu cerul,
  // dar e despărțită de el de marginea glugii.
  {
    const seen = new Uint8Array(w * h);
    const stack: number[] = [];
    for (let p = 0; p < w * h; p++) {
      if (alpha[p] > 0.3 && inner[cell(p % w, (p / w) | 0)]) { seen[p] = 1; stack.push(p); }
    }
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q < 0 || q >= w * h || seen[q] || alpha[q] <= 0.2) continue;
        seen[q] = 1; stack.push(q);
      }
    }
    for (let p = 0; p < w * h; p++) if (!seen[p]) alpha[p] = 0;
  }
  // Puțină înmuiere (1 px), ca marginea să nu fie zimțată.
  const soft = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      s += alpha[yy * w + xx]; n++;
    }
    soft[y * w + x] = Math.min(alpha[y * w + x], s / n) * 0.5 + alpha[y * w + x] * 0.5;
  }
  const sunset = mode === 'sky-sunset';
  // Culorile, de sus până la orizont.
  const stops: [number, number, number][] = sunset
    ? [[72, 98, 162], [150, 132, 176], [240, 166, 126], [255, 206, 152]]
    : [[42, 104, 196], [76, 140, 218], [138, 184, 232], [196, 218, 238]];
  const grad = (t: number): [number, number, number] => {
    const f = Math.max(0, Math.min(0.999, t)) * (stops.length - 1);
    const k = f | 0, u = f - k;
    const a = stops[k], b = stops[k + 1];
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  };
  const span = Math.max(1, bottom - top);
  // Lumina scenei se potrivește cu cerul: apus = cald, senin = puțin mai viu.
  const gr = sunset ? 1.07 : 1.0, gg = sunset ? 1.0 : 1.01, gb = sunset ? 0.9 : 1.03;
  for (let y = 0; y < h; y++) {
    const T = grad((y - top) / span);
    for (let x = 0; x < w; x++) {
      const p = y * w + x, i = p * 4;
      const a = soft[p];
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      // Restul pozei: ton ușor, potrivit cu cerul.
      let fr = r * gr, fg = g * gg, fb = b * gb;
      if (a > 0.001) {
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        // Textura cerului vechi (nori, umbre) rămâne peste culoarea nouă, puțin întărită;
        // pixelul de margine (cer + frunză) primește schimbarea doar cât e cer în el.
        const tex = (l - sl) * 0.35;
        fr += a * (T[0] - sr * gr + tex);
        fg += a * (T[1] - sg * gg + tex);
        fb += a * (T[2] - sb * gb + tex);
        // Norii mult mai luminoși decât cerul rămân aproape albi.
        const cloud = smooth(sl + 6, sl + 45, l) * 0.65 * a;
        fr += (Math.max(r, 228) - fr) * cloud;
        fg += (Math.max(g, 228) - fg) * cloud;
        fb += (Math.max(b, 232) - fb) * cloud;
      }
      rgba[i] = Math.max(0, Math.min(255, fr));
      rgba[i + 1] = Math.max(0, Math.min(255, fg));
      rgba[i + 2] = Math.max(0, Math.min(255, fb));
    }
  }
}

/**
 * Cerul din modelul de segmentare (grilă grosieră, ~128²), adus la conturul real al pozei
 * cu un filtru ghidat (He et al.): marginea glugii, a părului și a frunzelor urmează
 * pixelii, nu pătratele grilei (raportat: „scară” albă deasupra capului).
 * Întoarce, pentru fiecare pixel, cât e cer (0..1).
 */
export function refineSkyAlpha(
  rgba: Uint8ClampedArray, w: number, h: number,
  sky: Float32Array, person: Float32Array, g: number
): Float32Array {
  const s = Math.min(1, 640 / Math.max(w, h));
  const W = Math.max(8, Math.round(w * s)), H = Math.max(8, Math.round(h * s));
  const N = W * H;
  const I = new Float32Array(N), P = new Float32Array(N);
  const bil = (arr: Float32Array, u: number, v: number) => {
    const fx = Math.max(0, Math.min(g - 1.001, u * g - 0.5)), fy = Math.max(0, Math.min(g - 1.001, v * g - 0.5));
    const x0 = fx | 0, y0 = fy | 0, a = fx - x0, b = fy - y0;
    return arr[y0 * g + x0] * (1 - a) * (1 - b) + arr[y0 * g + x0 + 1] * a * (1 - b)
      + arr[(y0 + 1) * g + x0] * (1 - a) * b + arr[(y0 + 1) * g + x0 + 1] * a * b;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = Math.min(w - 1, ((x + 0.5) / s) | 0), sy = Math.min(h - 1, ((y + 0.5) / s) | 0);
    const i = (sy * w + sx) * 4;
    I[y * W + x] = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255;
    const u = (x + 0.5) / W, v = (y + 0.5) / H;
    P[y * W + x] = Math.max(0, Math.min(1, bil(sky, u, v) * (1 - Math.min(1, bil(person, u, v) * 1.6))));
  }
  const r = Math.max(3, Math.round(Math.max(W, H) / 90));
  const box = (src: Float32Array): Float32Array => {
    // Medie pe fereastră (2r+1)², cu imagine integrală.
    const S = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) { row += src[y * W + x]; S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row; }
    }
    const out = new Float32Array(N);
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
        out[y * W + x] = (S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
      }
    }
    return out;
  };
  const II = new Float32Array(N), IP = new Float32Array(N);
  for (let p = 0; p < N; p++) { II[p] = I[p] * I[p]; IP[p] = I[p] * P[p]; }
  const mI = box(I), mP = box(P), mII = box(II), mIP = box(IP);
  const A = new Float32Array(N), B = new Float32Array(N);
  const eps = 0.0015;
  for (let p = 0; p < N; p++) {
    const varI = mII[p] - mI[p] * mI[p], cov = mIP[p] - mI[p] * mP[p];
    A[p] = cov / (varI + eps); B[p] = mP[p] - A[p] * mI[p];
  }
  const mA = box(A), mB = box(B);
  // Înapoi la mărimea pozei, cu ghidul la rezoluție plină (A, B netede, I exact).
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, Math.min(H - 1.001, (y + 0.5) * s - 0.5)), y0 = fy | 0, b = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, Math.min(W - 1.001, (x + 0.5) * s - 0.5)), x0 = fx | 0, a = fx - x0;
      const q = y0 * W + x0;
      const av = mA[q] * (1 - a) * (1 - b) + mA[q + 1] * a * (1 - b) + mA[q + W] * (1 - a) * b + mA[q + W + 1] * a * b;
      const bv = mB[q] * (1 - a) * (1 - b) + mB[q + 1] * a * (1 - b) + mB[q + W] * (1 - a) * b + mB[q + W + 1] * a * b;
      const i = (y * w + x) * 4;
      const lum = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255;
      out[y * w + x] = smooth(0.25, 0.75, av * lum + bv);
    }
  }
  return out;
}
