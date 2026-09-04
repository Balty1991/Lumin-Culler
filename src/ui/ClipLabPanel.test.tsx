import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ClipLabPanel } from './ClipLabPanel';
import { useStore } from '../state/store';
import * as pool from '../core/clip/clipPool';
import type { ClipManifest } from '../core/clip/clipManifest';
import type { PhotoView } from '../state/store';

/**
 * ui/ClipLabPanel.test.tsx
 * Ecranul care hotaraste daca motorul nou merita pornit.
 *
 * Regula pe care o pazesc testele astea e una singura, si e cea mai
 * importanta din tot ecranul: NU se poate porni ceva ce n-a fost masurat. A
 * cere cuiva sa descarce ~39 MB pe incredere e exact lucrul pe care aplicatia
 * il refuza peste tot in alta parte.
 */
const Q8: ClipManifest = {
  id: 'mobileclip_s0.image.q8@fcbd153d1aa1', label: '8 biți (pentru procesor)',
  dim: 512, inputSize: 256, mean: [0, 0, 0], std: [1, 1, 1], file: 'model-1.onnx', bytes: 11_846_843
};
const FP16: ClipManifest = { ...Q8, id: 'mobileclip_s0.image.fp16@aaa', label: '16 biți (pentru placa video)', file: 'model-0.onnx', bytes: 22_000_000 };

function rand(variant: ClipManifest, forced: 'webgpu' | 'wasm', medianMs: number | null) {
  return {
    variant, forced,
    result: medianMs === null ? null : {
      backend: forced, loadMs: 2000, samples: 12,
      medianMs, slowestMs: medianMs * 2, thousandPhotosSeconds: Math.round(medianMs)
    },
    error: medianMs === null ? 'no available backend found' : null
  };
}

function pozeFalse(n: number): PhotoView[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}` }) as PhotoView);
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  useStore.setState({ locale: 'ro', clipLabOpen: true, photos: pozeFalse(20) });
});

describe('un manifest PREZENT dar de neinteles nu se confunda cu unul lipsa', () => {
  it('spune ca l-a gasit si nu-l poate citi, si arata continutul', async () => {
    // Exact cazul care a costat o runda: format vechi ramas in cache-ul
    // telefonului. Aratat ca "lipsa", pare ca nu s-a livrat nimic.
    vi.spyOn(pool, 'clipManifestState').mockResolvedValue({ kind: 'unreadable', raw: '{"id":"vechi"}' });
    render(<ClipLabPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/nu-l pot citi/);
    expect(screen.getByText(/"id":"vechi"/)).toBeInTheDocument();
  });
});

describe('cand build-ul n-are model', () => {
  it('spune ca nu e nimic de masurat, si NU ofera niciun buton', async () => {
    // Stare normala, nu eroare: build-urile fara model sunt chiar aplicatia
    // de pana acum.
    vi.spyOn(pool, 'clipManifestState').mockResolvedValue({ kind: 'absent' });
    render(<ClipLabPanel />);
    expect(await screen.findByText(/nu conține modelul/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Măsoară/ })).not.toBeInTheDocument();
  });
});

describe('cand modelul exista', () => {
  beforeEach(() => {
    vi.spyOn(pool, 'clipManifestState').mockResolvedValue({ kind: 'ok', variants: [FP16, Q8] });
  });

  it('spune CAT se descarca inainte sa se descarce ceva', async () => {
    // Marimea nu e ascunsa intr-o nota de subsol: e prima parte a fisei, si
    // fiecare varianta cu cifra ei.
    render(<ClipLabPanel />);
    expect(await screen.findByText(/16 biți/)).toBeInTheDocument();
    expect(screen.getByText('21.0 MB')).toBeInTheDocument();
    expect(screen.getByText('11.3 MB')).toBeInTheDocument();
  });

  it('NU arata comutatorul de pornire inainte de masuratoare', async () => {
    // Piatra de temelie a ecranului. Fara masuratoare, pornirea ar fi o cerere
    // de incredere pe zeci de MB.
    render(<ClipLabPanel />);
    await screen.findByRole('button', { name: /Măsoară/ });
    expect(screen.queryByText(/Pornește motorul nou/)).not.toBeInTheDocument();
  });

  it('arata un TABEL, nu o cifra — altfel nu se poate sti CE e de vina', async () => {
    // Intrebarea care conteaza dupa 1404 ms pe poza nu e "cat de lent e", ci
    // "modelul e greu, sau doar prost potrivit cu backend-ul?". Un singur numar
    // nu raspunde niciodata la asta.
    vi.spyOn(pool, 'runClipMatrix').mockResolvedValue([
      rand(FP16, 'webgpu', 28), rand(FP16, 'wasm', 190),
      rand(Q8, 'webgpu', 1404), rand(Q8, 'wasm', 210)
    ]);
    render(<ClipLabPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Măsoară/ }));

    expect(await screen.findByText('28 ms')).toBeInTheDocument();
    expect(screen.getByText('1404 ms')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(5); // antet + 4 combinatii
  });

  it('un rand PICAT ramane in tabel, cu motivul lui', async () => {
    // "Varianta asta nu porneste pe placa video" e un rezultat, nu o absenta.
    vi.spyOn(pool, 'runClipMatrix').mockResolvedValue([
      rand(FP16, 'webgpu', null), rand(FP16, 'wasm', 190)
    ]);
    render(<ClipLabPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Măsoară/ }));

    expect(await screen.findByText(/no available backend found/)).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('comutatorul apare doar daca MACAR o combinatie a mers', async () => {
    vi.spyOn(pool, 'runClipMatrix').mockResolvedValue([
      rand(FP16, 'webgpu', null), rand(FP16, 'wasm', null)
    ]);
    render(<ClipLabPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Măsoară/ }));
    await screen.findAllByText(/no available backend/);
    expect(screen.queryByText(/Pornește motorul nou/)).not.toBeInTheDocument();
  });

  it('oprirea STERGE ce a calculat, nu doar ascunde', async () => {
    // De-aia vectorii stau in tabela lor: oprirea e o operatie, nu o
    // parcurgere a intregii biblioteci. Vezi core/db.ts.
    const { db } = await import('../core/db');
    await db.clipEmbeddings.put({ photoId: 'p1', modelId: Q8.id, values: new Float32Array(512), ts: Date.now() });
    vi.spyOn(pool, 'runClipMatrix').mockResolvedValue([rand(FP16, 'webgpu', 28)]);
    const release = vi.spyOn(pool, 'releaseClip').mockImplementation(() => {});
    render(<ClipLabPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Măsoară/ }));

    const comutator = await screen.findByRole('checkbox');
    fireEvent.click(comutator);
    fireEvent.click(comutator);
    await waitFor(async () => expect(await db.clipEmbeddings.count()).toBe(0));
    expect(release).toHaveBeenCalled();
  });

  it('fara nicio poza importata nu se poate masura', async () => {
    useStore.setState({ photos: [] });
    render(<ClipLabPanel />);
    expect(await screen.findByText(/cel puțin o poză/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Măsoară/ })).toBeDisabled();
  });
});
