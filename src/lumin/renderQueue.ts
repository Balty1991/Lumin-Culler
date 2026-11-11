/**
 * lumin/renderQueue.ts
 * Rândul la „poza clară”. Android le face una câte una (SharpImagePlugin are un
 * singur fir), iar cererile mergeau direct acolo, în ordinea sosirii: derulai prin
 * galerie, zeci de dale intrau la rând, iar poza pe care o deschideai (și editorul)
 * așteptau în spatele lor — văzut într-o înregistrare: 3 s de ecran gol la deschidere,
 * 7 s de rotiță în editor.
 *
 * Aici rândul se ține în aplicație: una singură la telefon odată, poza mare (ecran,
 * editor) trece înaintea dalelor, iar dintre dale prima e cea cerută ULTIMA (acolo
 * e omul acum). Dalele vechi peste o limită se abandonează; se cer din nou când
 * reapar pe ecran.
 */
export interface RenderJob<T> { run: () => Promise<T>; urgent: boolean; resolve: (v: T | null) => void }

export class RenderQueue<T> {
  private urgent: RenderJob<T>[] = [];
  private tiles: RenderJob<T>[] = [];
  private active = 0;
  constructor(private readonly concurrency = 1, private readonly maxTiles = 24) {}

  /** `null` când cererea a fost abandonată (dală veche) sau a eșuat. */
  add(run: () => Promise<T>, urgent: boolean): Promise<T | null> {
    return new Promise(resolve => {
      const job = { run, urgent, resolve };
      if (urgent) this.urgent.push(job);
      else {
        this.tiles.push(job);
        while (this.tiles.length > this.maxTiles) this.tiles.shift()!.resolve(null);
      }
      this.pump();
    });
  }

  get waiting(): number { return this.urgent.length + this.tiles.length; }

  private pump(): void {
    while (this.active < this.concurrency) {
      // Poza mare întâi, în ordinea cererii; dintre dale, cea mai nouă.
      const job = this.urgent.shift() ?? this.tiles.pop();
      if (!job) return;
      this.active++;
      job.run().then(v => job.resolve(v), () => job.resolve(null)).finally(() => { this.active--; this.pump(); });
    }
  }
}
