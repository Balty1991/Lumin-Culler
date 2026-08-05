import { useStore } from '../state/store';
import { FilterDotIcon } from './icons';
import { t } from '../i18n';

/**
 * Starea "niciun rezultat pentru filtrul curent" — folosita atat in grila
 * (App.tsx) cat si in Workspace (Workspace.tsx), cele doua locuri unde un
 * filtru poate goli lista de poze afisate. Distincta de starea "nicio poza
 * importata inca" (App.tsx, .empty, cu onboarding-ul in 3 pasi) — aici EXISTA
 * poze, doar ca niciuna nu trece de combinatia curenta de filtre.
 */
export function EmptyFilterState() {
  const filter = useStore(s => s.filter);
  const personFilter = useStore(s => s.personFilter);
  const colorLabelFilter = useStore(s => s.colorLabelFilter);
  const sceneTagFilter = useStore(s => s.sceneTagFilter);
  const cameraFilter = useStore(s => s.cameraFilter);
  const projectFilter = useStore(s => s.projectFilter);
  const collectionFilter = useStore(s => s.collectionFilter);
  const searchText = useStore(s => s.searchText);
  const dateFrom = useStore(s => s.dateFrom);
  const dateTo = useStore(s => s.dateTo);
  const minRating = useStore(s => s.minRating);
  const setFilter = useStore(s => s.setFilter);
  const clearAllFilters = useStore(s => s.clearAllFilters);
  const locale = useStore(s => s.locale);

  // Bug real gasit la verificare: lipseau colorLabelFilter/sceneTagFilter/
  // cameraFilter/projectFilter/collectionFilter din aceasta verificare — un
  // filtru de scena activ, de exemplu, tot golea grila, dar butonul de reset
  // nici macar nu aparea (hasActiveFilter ramanea fals).
  const hasActiveFilter = filter !== 'all' || !!personFilter || !!colorLabelFilter || !!sceneTagFilter ||
    !!cameraFilter || !!projectFilter || !!collectionFilter || !!searchText ||
    dateFrom !== null || dateTo !== null || minRating > 0;

  const resetAll = () => {
    setFilter('all');
    clearAllFilters();
  };

  return (
    <div className="empty-filter">
      <FilterDotIcon className="empty-filter-icon" aria-hidden="true" />
      <p>{t(locale, 'emptyFilter.message')}</p>
      {hasActiveFilter && (
        <button className="ghost small" onClick={resetAll}>{t(locale, 'emptyFilter.reset')}</button>
      )}
    </div>
  );
}
