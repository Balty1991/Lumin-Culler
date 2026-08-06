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
    expect(screen.getByRole('button', { name: /adauga in folder/i })).toBeInTheDocument();
  });

  it('actioneaza pe toata selectia cand meniul a fost deschis peste o selectie in masa', async () => {
    const addPhotosToCollection = vi.fn(async () => {});
    useStore.setState({
      collections: [{ id: 'col-1', name: 'Ami', createdAt: 1, memberIds: [] }],
      addPhotosToCollection
    });

    render(<ContextMenu {...baseProps} count={3} photoIds={['p1', 'p2', 'p3']} />);
    fireEvent.click(screen.getByRole('button', { name: /adauga in folder/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /adauga in folder/i }));
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
