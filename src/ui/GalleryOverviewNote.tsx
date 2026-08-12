import { useState } from 'react';
import { useStore } from '../state/store';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { t } from '../i18n';

/**
 * "Cate poze ai in galerie" (plan modernizare, cerinta directa a
 * utilizatorului) — buton explicit, NU o cerere automata de permisiune la
 * pornire (ar fi surprinzator/intruziv). Doar Android nativ — pe web nu
 * exista un MediaStore de interogat. Vezi store.ts:loadGalleryOverview,
 * core/nativeMediaLibrary.ts:readGalleryOverview (NEVALIDAT pe device real).
 */
export function GalleryOverviewNote() {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const galleryOverview = useStore(s => s.galleryOverview);
  const loadGalleryOverview = useStore(s => s.loadGalleryOverview);
  const photosCount = useStore(s => s.photos.length);
  const [loading, setLoading] = useState(false);

  if (!isNativeMediaLibraryAvailable()) return null;

  const load = async () => {
    setLoading(true);
    try { await loadGalleryOverview(); } finally { setLoading(false); }
  };

  if (!galleryOverview) {
    return (
      <button className="gallery-overview-cta" onClick={() => void load()} disabled={loading}>
        {loading ? tr('gallery.overview.loading') : tr('gallery.overview.cta')}
      </button>
    );
  }

  if (!galleryOverview.granted) {
    return <p className="hint gallery-overview-denied">{tr('gallery.overview.denied')}</p>;
  }

  return (
    <p className="hint gallery-overview-result">
      {tr('gallery.overview.result', { total: galleryOverview.totalCount, imported: photosCount })}
    </p>
  );
}
