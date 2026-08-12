import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ContextMenu } from './ContextMenu';
import { useStore } from '../state/store';

/**
 * Cerinta directa a utilizatorului, dupa ce a gasit "Adauga in folder" cu ajutor:
 * "e cam greu de gasit, daca nu spuneai nu stiam; era mai simplu sa tii apasat pe
 * o poza si sa se declanseze aceasta functie". Apasarea lunga deschidea deja acest
 * meniu — ii lipsea doar actiunea. Testele de aici tin actiunea legata de gestul
 * natural si acopera capcana reala a integrarii (popover randat prin portal).
 */
describe('ContextMenu — "Adauga in folder" pe apasare lunga', () => {
  const noop = () => {};
  const baseProps = {
    x: 40, y: 40, count: 1, rating: 0, colorLabel: 'none' as const,
    onSetStatus: noop, onSetRating: noop, onSetColorLabel: noop, onClose: noop
  };

  beforeEach(() => {
    useStore.setState({ locale: 'ro', collections: [] });
  });

  it('ofera actiunea de folder direct in meniul deschis prin apasare lunga', () => {
    render(<ContextMenu {...baseProps} photoIds={['p1']} />);
    expect(screen.getByRole('button', { name: /adaugă în folder/i })).toBeInTheDocument();
  });

  it('actioneaza pe toata selectia cand meniul a fost deschis peste o selectie in masa', async () => {
    const addPhotosToCollection = vi.fn(async () => {});
    useStore.setState({
      collections: [{ id: 'col-1', name: 'Ami', createdAt: 1, memberIds: [] }],
      addPhotosToCollection
    });

    render(<ContextMenu {...baseProps} count={3} photoIds={['p1', 'p2', 'p3']} />);
    fireEvent.click(screen.getByRole('button', { name: /adaugă în folder/i }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Ami/ }));

    expect(addPhotosToCollection).toHaveBeenCalledWith('col-1', ['p1', 'p2', 'p3']);
  });

  /**
   * Capcana reala a integrarii: popover-ul lui CollectionPicker e randat printr-un
   * PORTAL in <body>, deci in DOM nu e descendentul meniului contextual. Fara
   * verificarea isInsideAnyMenu, primul pointerdown pe un folder ar fi numarat ca
   * "in afara" si ar fi inchis meniul (si popover-ul odata cu el) inainte ca
   * alegerea sa apuce sa se aplice — exact bug-ul deja documentat pentru
   * MoreFiltersMenu in ui/dropdownPosition.ts.
   */
  it('nu se inchide cand utilizatorul atinge un folder din popover-ul randat prin portal', async () => {
    const onClose = vi.fn();
    useStore.setState({ collections: [{ id: 'col-1', name: 'Ami', createdAt: 1, memberIds: [] }] });

    render(<ContextMenu {...baseProps} photoIds={['p1']} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /adaugă în folder/i }));
    // listener-ul de "click in afara" se ataseaza abia in tick-ul urmator (vezi setTimeout din ContextMenu)
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    fireEvent.pointerDown(screen.getByRole('menuitemcheckbox', { name: /Ami/ }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('se inchide in continuare la un tap in afara oricarui meniu', async () => {
    const onClose = vi.fn();
    render(<ContextMenu {...baseProps} photoIds={['p1']} onClose={onClose} />);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    fireEvent.pointerDown(document.body);

    expect(onClose).toHaveBeenCalled();
  });
});

/**
 * Bug real raportat pe device: "cand selectez o poza de jos, nu mai este vizibil
 * tab-ul". Pozitia se calcula scazand din viewport o CONSTANTA presupusa a fi
 * inaltimea meniului — presupunere invechita la fiecare rand nou adaugat. Acum
 * meniul se masoara singur; testele de aici tin acel contract, indiferent cat
 * de inalt ajunge meniul in viitor.
 */
describe('ContextMenu — incadrarea in ecran', () => {
  const noop = () => {};
  const baseProps = {
    x: 40, y: 40, count: 1, rating: 0, colorLabel: 'none' as const, photoIds: ['p1'],
    onSetStatus: noop, onSetRating: noop, onSetColorLabel: noop, onClose: noop
  };

  /** jsdom nu face layout (getBoundingClientRect intoarce mereu 0) — dam noi dimensiunea. */
  function withMenuSize(width: number, height: number) {
    return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({})
    } as DOMRect);
  }

  beforeEach(() => {
    useStore.setState({ locale: 'ro', collections: [] });
    window.innerWidth = 400;
    window.innerHeight = 800;
    document.documentElement.style.setProperty('--safe-top', '0px');
    document.documentElement.style.setProperty('--safe-bottom', '0px');
  });

  it('urca meniul cand apasarea lunga e langa marginea de jos, ca sa ramana intreg pe ecran', () => {
    withMenuSize(224, 380);
    const { container } = render(<ContextMenu {...baseProps} y={700} />);

    const menu = container.querySelector('.context-menu') as HTMLElement;
    // 800 - 380 - 8 = 412: meniul nu mai iese in afara ecranului
    expect(parseFloat(menu.style.top)).toBe(412);
  });

  it('tine cont si de bara de navigare Android (marginea sigura de jos)', () => {
    document.documentElement.style.setProperty('--safe-bottom', '48px');
    withMenuSize(224, 380);
    const { container } = render(<ContextMenu {...baseProps} y={700} />);

    const menu = container.querySelector('.context-menu') as HTMLElement;
    expect(parseFloat(menu.style.top)).toBe(412 - 48);
  });

  it('nu misca meniul cand apasarea e undeva unde incape oricum', () => {
    withMenuSize(224, 380);
    const { container } = render(<ContextMenu {...baseProps} x={30} y={100} />);

    const menu = container.querySelector('.context-menu') as HTMLElement;
    expect(parseFloat(menu.style.top)).toBe(100);
    expect(parseFloat(menu.style.left)).toBe(30);
  });

  it('nu iese pe marginea din stanga/sus nici pe un ecran mai mic decat meniul', () => {
    window.innerHeight = 300;
    withMenuSize(224, 380);
    const { container } = render(<ContextMenu {...baseProps} y={250} />);

    const menu = container.querySelector('.context-menu') as HTMLElement;
    expect(parseFloat(menu.style.top)).toBeGreaterThanOrEqual(8);
    expect(parseFloat(menu.style.left)).toBeGreaterThanOrEqual(8);
  });

  it('incadreaza si pe orizontala, cand apasarea e langa marginea dreapta', () => {
    withMenuSize(224, 380);
    const { container } = render(<ContextMenu {...baseProps} x={390} />);

    const menu = container.querySelector('.context-menu') as HTMLElement;
    expect(parseFloat(menu.style.left)).toBe(400 - 224 - 8);
  });
});
