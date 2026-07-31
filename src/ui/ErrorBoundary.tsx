import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertIcon } from './icons';
import { t, readStoredLocale } from '../i18n';

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

    // Componenta CLASA, deci fara acces la store/hook-uri — citim locale-ul direct din
    // localStorage (aceeasi sursa ca restul aplicatiei la boot). Bug real gasit de auditul
    // QA: acest text era hardcodat in romana necondiționat, exact ecranul pe care il vede
    // un utilizator EN in cel mai prost moment posibil (o eroare React neasteptata).
    const locale = readStoredLocale();
    return (
      <div className="error-boundary">
        <div className="error-boundary-card">
          <AlertIcon />
          <h2>{t(locale, 'errorBoundary.title')}</h2>
          <p>
            {t(locale, 'errorBoundary.messagePrefix')}
            <b> {t(locale, 'errorBoundary.messageBold')}</b>
            {t(locale, 'errorBoundary.messageSuffix')}
          </p>
          <button className="select" onClick={this.reload}>{t(locale, 'errorBoundary.reload')}</button>
          <details className="error-boundary-details">
            <summary>{t(locale, 'errorBoundary.details')}</summary>
            <pre className="mono">{error.message}{error.stack ? '\n\n' + error.stack : ''}</pre>
          </details>
        </div>
      </div>
    );
  }
}
