import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertIcon } from './icons';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Plasa de siguranta la nivel de aplicatie: o eroare de randare React
 * (bug intr-o componenta, stare corupta neasteptata etc.) NU mai albeste
 * tot ecranul fara nicio explicatie — arata un ecran de recuperare, clar
 * ca datele (pozele, deciziile, persoanele) raman intacte in IndexedDB,
 * independent de starea React care a crapat.
 *
 * Doar componente CLASA pot fi error boundary (nu exista echivalent hook
 * in React 18) — getDerivedStateFromError + componentDidCatch sunt
 * singurele doua API-uri necesare aici, restul e UI.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary a prins o eroare:', error, info.componentStack);
  }

  private reload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="error-boundary">
        <div className="error-boundary-card">
          <AlertIcon />
          <h2>A aparut o eroare neasteptata</h2>
          <p>
            Pozele, deciziile si persoanele inrolate sunt salvate separat (IndexedDB) si
            <b> nu s-au pierdut</b> — problema e doar in interfata curenta.
          </p>
          <button className="select" onClick={this.reload}>Reincarca aplicatia</button>
          <details className="error-boundary-details">
            <summary>Detalii tehnice</summary>
            <pre className="mono">{error.message}{error.stack ? '\n\n' + error.stack : ''}</pre>
          </details>
        </div>
      </div>
    );
  }
}
