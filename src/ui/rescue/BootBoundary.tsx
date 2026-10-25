import { Component, type ReactNode } from 'react';
import { rescueT } from '../../rescue/copy';

interface State { error: Error | null }

/** Boot-path boundary. It does not import the photographer dictionaries. */
export class BootBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const locale = document.documentElement.lang === 'en' ? 'en' : 'ro';
    return (
      <div className="rescue">
        <main className="rescue-main">
          <h1>{rescueT(locale, 'bootError')}</h1>
          <button type="button" className="rescue-btn" onClick={() => window.location.reload()}>
            {rescueT(locale, 'bootReload')}
          </button>
        </main>
      </div>
    );
  }
}
