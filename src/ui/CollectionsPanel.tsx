import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, FolderIcon, FilterDotIcon, PlusIcon, TrashIcon, EditIcon } from './icons';
import { t } from '../i18n';

/**
 * Gestiune foldere personalizate (cerinta directa a utilizatorului: "sa am
 * posibilitatea sa creez foldere, sa le denumesc si sa pun anumite poze in
 * ele") — creare/redenumire/stergere si filtrarea grilei dupa un folder.
 * Punerea efectiva a pozelor in foldere se face din CollectionPicker.tsx
 * (bulk-bar la selectie multipla, DetailView pentru o singura poza), nu de
 * aici — acest panou ramane doar gestiunea foldereleor in sine, la fel cum
 * ProjectsPanel nu e locul unde se alege proiectul unei poze individuale.
 */
export function CollectionsPanel() {
  const open = useStore(s => s.collectionsOpen);
  const setOpen = useStore(s => s.setCollectionsOpen);
  const collections = useStore(s => s.collections);
  const collectionFilter = useStore(s => s.collectionFilter);
  const setCollectionFilter = useStore(s => s.setCollectionFilter);
  const createCollection = useStore(s => s.createCollection);
  const renameCollection = useStore(s => s.renameCollection);
  const deleteCollection = useStore(s => s.deleteCollection);
  const askConfirm = useStore(s => s.askConfirm);
  const askPrompt = useStore(s => s.askPrompt);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const applyFilter = (id: string | null) => {
    setCollectionFilter(id);
    setOpen(false);
  };

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    await createCollection(trimmed);
    setNewName('');
  };

  const runRename = async (id: string, current: string) => {
    const next = await askPrompt(tr('collections.renamePrompt'), current);
    if (next?.trim()) void renameCollection(id, next);
  };

  const runDelete = async (id: string, name: string) => {
    if (await askConfirm(tr('collections.confirmDelete', { name }), { danger: true })) {
      void deleteCollection(id);
    }
  };

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('menu.collections')} tabIndex={-1}>
        <header className="detail-head">
          <span><FolderIcon className="inline-icon" /> {tr('menu.collections')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        <form className="project-meta-form" onSubmit={submitCreate}>
          <input
            className="mono" placeholder={tr('collections.newPlaceholder')}
            aria-label={tr('collections.newPlaceholder')}
            value={newName} onChange={e => setNewName(e.target.value)}
          />
          <button className="ghost small" type="submit" disabled={!newName.trim()}>
            <PlusIcon className="inline-icon" /> {tr('collections.create')}
          </button>
        </form>

        {collectionFilter && (
          <button className="ghost small" onClick={() => applyFilter(null)}>
            <FilterDotIcon className="inline-icon" /> {tr('projects.clearFilter')}
          </button>
        )}

        {collections.length === 0 && <p className="hint">{tr('collections.empty')}</p>}

        <ul className="insights">
          {collections.map(c => (
            <li key={c.id} className="insight">
              <div className="insight-head">
                <b>{c.name}</b>
                <span className="mono confidence-tag">{tr('collections.photoCount', { count: c.memberIds.length })}</span>
              </div>
              <div className="insight-actions">
                <button
                  className="ghost small"
                  onClick={() => applyFilter(c.id)}
                  disabled={collectionFilter === c.id}
                >
                  {collectionFilter === c.id ? tr('projects.filterActive') : tr('collections.showOnly')}
                </button>
                <button className="ghost small" onClick={() => void runRename(c.id, c.name)}>
                  <EditIcon className="inline-icon" /> {tr('collections.rename')}
                </button>
                <button className="ghost small" onClick={() => void runDelete(c.id, c.name)}>
                  <TrashIcon className="inline-icon" /> {tr('collections.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
