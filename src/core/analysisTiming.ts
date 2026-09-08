/**
 * core/analysisTiming.ts
 * Cat timp mananca FIECARE model din lantul de analiza, pe un import intreg.
 *
 * DE CE EXISTA. Toate deciziile de optimizare de pana acum au fost luate citind
 * structura codului, nu masurand: "FaceMesh pare cel mai greu", "detectia
 * ACCURATE pare scumpa". Uneori am nimerit, dar nimeni — nici eu — n-a stiut
 * vreodata daca cele patru modele MediaPipe inseamna 20% din timp sau 60%. Iar
 * de raspunsul ala atarna direct daca merita riscul de a le muta pe GPU: la 20%
 * nu merita, oricat de bine ar merge mutarea.
 *
 * Se acumuleaza in memorie in timpul importului si se preda o singura data, la
 * final, in raportul lotului (vezi core/importOutcome.ts, campul `modelMs`),
 * care e deja pastrat si deja afisat in Statistici.
 *
 * CE MASOARA, SI CE NU. Timp de perete per apel, adunat. Cum se analizeaza 2-4
 * poze deodata, suma tuturor modelelor DEPASESTE durata importului — nu e o
 * eroare, e definitia: masoara munca totala, nu timpul scurs. De asta partea
 * folositoare sunt PROPORTIILE intre modele, nu secundele in sine.
 *
 * Nu contine nimic despre poze: doar nume de model si milisecunde.
 */

const acumulat = new Map<string, number>();

/** La inceputul fiecarui import — altfel cifrele s-ar aduna peste loturile trecute. */
export function resetAnalysisTiming(): void {
  acumulat.clear();
}

export function recordAnalysisTiming(model: string, ms: number): void {
  acumulat.set(model, (acumulat.get(model) ?? 0) + ms);
}

/** `undefined` cand nu s-a masurat nimic — pe web, sau la un import fara nicio poza analizata. */
export function analysisTimingSnapshot(): Record<string, number> | undefined {
  if (acumulat.size === 0) return undefined;
  return Object.fromEntries([...acumulat].map(([k, ms]) => [k, Math.round(ms)]));
}

/**
 * Cronometreaza un apel de model. Masoara si apelurile care ESUEAZA: un model
 * care arunca dupa cinci secunde a consumat cinci secunde, iar daca ele n-ar
 * intra in socoteala tocmai cazul cel mai scump ar fi cel invizibil.
 */
export async function timedModel<T>(model: string, run: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await run();
  } finally {
    recordAnalysisTiming(model, performance.now() - start);
  }
}
