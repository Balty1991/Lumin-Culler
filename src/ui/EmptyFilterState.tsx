import { useStore } from '../state/store';
import { FilterDotIcon } from './icons';

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
  const searchText = useStore(s => s.searchText);
  const dateFrom = useStore(s => s.dateFrom);
  const dateTo = useStore(s => s.dateTo);
  const minRating = useStore(s => s.minRating);
  const setFilter = useStore(s => s.setFilter);
  const setPersonFilter = useStore(s => s.setPersonFilter);
  const clearAdvancedFilters = useStore(s => s.clearAdvancedFilters);

  const hasActiveFilter = filter !== 'all' || !!personFilter || !!searchText || dateFrom !== null || dateTo !== null || minRating > 0;

  const resetAll = () => {
    setFilter('all');
    setPersonFilter(null);
    clearAdvancedFilters();
  };

  return (
    <div className="empty-filter">
      <FilterDotIcon className="empty-filter-icon" aria-hidden="true" />
      <p>Nicio poza nu corespunde filtrului curent.</p>
      {hasActiveFilter && (
        <button className="ghost small" onClick={resetAll}>Reseteaza filtrele</button>
      )}
    </div>
  );
}
