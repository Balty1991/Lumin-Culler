import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Bomb(): never {
  throw new Error('boom — eroare de test');
}

describe('ErrorBoundary', () => {
  it('renders children normally when nothing throws', () => {
    render(<ErrorBoundary><p>continut normal</p></ErrorBoundary>);
    expect(screen.getByText('continut normal')).toBeInTheDocument();
  });

  it('catches a render error from a child and shows the fallback screen instead of a blank page', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    expect(screen.getByText(/eroare neasteptata/i)).toBeInTheDocument();
    expect(screen.getByText(/nu s-au pierdut/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reincarca/i })).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it('shows the technical error message in the collapsible details', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    expect(screen.getByText(/boom — eroare de test/)).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it('reload button calls window.location.reload', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', { value: { reload: reloadSpy }, writable: true });
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    fireEvent.click(screen.getByRole('button', { name: /reincarca/i }));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });
});
