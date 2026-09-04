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
const MANIFEST: ClipManifest = {
  id: 'mobileclip_s0.image.q8@fcbd153d1aa1', dim: 512, inputSize: 256,
  mean: [0, 0, 0], std: [1, 1, 1], file: 'model.onnx', bytes: 11_846_843
};

function pozeFalse(n: number): PhotoView[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}` }) as PhotoView);
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  useStore.setState({ locale: 'ro', clipLabOpen: true, photos: pozeFalse(20) });
});

describe('cand build-ul n-are model', () => {
  it('spune ca nu e nimic de masurat, si NU ofera niciun buton', async () => {
    // Stare normala, nu eroare: build-urile fara model sunt chiar aplicatia
    // de pana acum.
    vi.spyOn(pool, 'clipAvailability').mockResolvedValue(null);
    render(<ClipLabPanel />);
    expect(await screen.findByText(/nu conține modelul/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Măsoară/ })).not.toBeInTheDocument();
  });
});

describe('cand modelul exista', () => {
  beforeEach(() => {
    vi.spyOn(pool, 'clipAvailability').mockResolvedValue(MANIFEST);
  });

  it('spune CAT se descarca inainte sa se descarce ceva', async () => {
    // Marimea nu e ascunsa intr-o nota de subsol: e a doua linie din fisa.
    render(<ClipLabPanel />);
    expect(await screen.findByText(/11\.3 MB modelul/)).toBeInTheDocument();
    expect(screen.getByText(MANIFEST.id)).toBeInTheDocument();
  });

  it('NU arata comutatorul de pornire inainte de masuratoare', async () => {
    // Piatra de temelie a ecranului. Fara masuratoare, pornirea ar fi o cerere
    // de incredere pe 39 MB.
    render(<ClipLabPanel />);
    await screen.findByRole('button', { name: /Măsoară/ });
    expect(screen.queryByText(/Pornește motorul nou/)).not.toBeInTheDocument();
  });

  it('dupa masuratoare arata cifra care conteaza si abia apoi comutatorul', async () => {
    vi.spyOn(pool, 'runClipBenchmark').mockResolvedValue({
      backend: 'webgpu', loadMs: 2400, samples: 12,
      medianMs: 25, slowestMs: 380, thousandPhotosSeconds: 25
    });
    render(<ClipLabPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Măsoară/ }));

    expect(await screen.findByText(/25 s pentru o mie de poze/)).toBeInTheDocument();
    expect(screen.getByText(/Pornește motorul nou/)).toBeInTheDocument();
  });

  it('arata si cea mai lenta poza, nu doar mediana favorabila', async () => {
    // Prima poza plateste compilarea shaderelor. Ascunsa, cifra ar parea mai
    // buna decat e chiar la pornire — adica exact acolo unde se simte.
    vi.spyOn(pool, 'runClipBenchmark').mockResolvedValue({
      backend: 'webgpu', loadMs: 2400, samples: 12,
      medianMs: 25, slowestMs: 380, thousandPhotosSeconds: 25
    });
    render(<ClipLabPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Măsoară/ }));
    await screen.findByText(/pentru o mie de poze/);
    expect(screen.getByText('380 ms')).toBeInTheDocument();
    expect(screen.getByText('webgpu')).toBeInTheDocument();
  });

  it('spune raspicat cand a rulat pe procesor, nu pe placa video', async () => {
    // Un rezultat de pe wasm citit ca si cum ar fi de pe WebGPU ar face functia
    // sa para mult mai lenta decat e pe telefoanele bune.
    vi.spyOn(pool, 'runClipBenchmark').mockResolvedValue({
      backend: 'wasm', loadMs: 5000, samples: 12,
      medianMs: 210, slowestMs: 900, thousandPhotosSeconds: 210
    });
    render(<ClipLabPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Măsoară/ }));
    expect(await screen.findByText(/a rulat pe procesor/i)).toBeInTheDocument();
  });

  it('cand modelul nu porneste, o spune si nu schimba nimic', async () => {
    vi.spyOn(pool, 'runClipBenchmark').mockResolvedValue(null);
    render(<ClipLabPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Măsoară/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/nu a pornit/);
    expect(screen.queryByText(/Pornește motorul nou/)).not.toBeInTheDocument();
  });

  it('oprirea STERGE ce a calculat, nu doar ascunde', async () => {
    // De-aia vectorii stau in tabela lor: oprirea e o operatie, nu o
    // parcurgere a intregii biblioteci. Vezi core/db.ts.
    const { db } = await import('../core/db');
    await db.clipEmbeddings.put({ photoId: 'p1', modelId: MANIFEST.id, values: new Float32Array(512), ts: Date.now() });
    vi.spyOn(pool, 'runClipBenchmark').mockResolvedValue({
      backend: 'webgpu', loadMs: 1000, samples: 12, medianMs: 20, slowestMs: 100, thousandPhotosSeconds: 20
    });
    const release = vi.spyOn(pool, 'releaseClip').mockImplementation(() => {});
    render(<ClipLabPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Măsoară/ }));

    const comutator = await screen.findByRole('checkbox');
    fireEvent.click(comutator);           // pornit
    fireEvent.click(comutator);           // oprit
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
