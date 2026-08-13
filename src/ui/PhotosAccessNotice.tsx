import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { getPhotosAccess, openAppSettings, type PhotosAccess } from '../core/nativeMediaLibrary';
import { AlertIcon } from './icons';
import { t } from '../i18n';

/**
 * ui/PhotosAccessNotice.tsx
 * Avertisment aratat cand galeria e accesibila DOAR PARTIAL (Android 14+,
 * "Permite cu acces limitat").
 *
 * De ce e nevoie de el: cu acces partial vedem doar pozele bifate manual in
 * momentul acordarii, deci "Adu pe perioade" si Supervizorul galeriei — care
 * numara cate poze ai pe fiecare luna — nu au ce citi. Pana acum, codul
 * verifica doar READ_MEDIA_IMAGES, care in cazul asta e refuzat: aplicatia
 * cerea la nesfarsit o permisiune pe care sistemul n-o mai afiseaza, si pentru
 * utilizator pur si simplu nu se intampla nimic. Ecranul de bun venit incearca
 * sa previna situatia (pasul cu cele trei optiuni), dar cine a apasat deja
 * gresit are nevoie de un drum inapoi, nu de un ecran care nu mai apare.
 *
 * Se reverifica la fiecare revenire in prim-plan: schimbarea permisiunii se
 * face IN AFARA aplicatiei (Setari), deci singurul moment in care putem afla ca
 * s-a rezolvat e intoarcerea utilizatorului. Fara asta, avertismentul ar ramane
 * afisat dupa ce problema a fost deja reparata.
 */
export function PhotosAccessNotice() {
  const locale = useStore(s => s.locale);
  const [access, setAccess] = useState<PhotosAccess>('unavailable');

  useEffect(() => {
    let cancelled = false;
    const check = () => { void getPhotosAccess().then(a => { if (!cancelled) setAccess(a); }); };
    check();
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  // 'denied' NU intra aici: acolo dialogul de sistem inca apare, iar butoanele
  // normale de import il declanseaza — nu e nimic de reparat din Setari.
  if (access !== 'limited') return null;

  return (
    <div className="photos-access-notice" role="status">
      <AlertIcon />
      <div className="photos-access-notice-text">
        <b>{t(locale, 'photosAccess.limited.title')}</b>
        <p>{t(locale, 'photosAccess.limited.body')}</p>
      </div>
      <button className="btn-accent" onClick={() => void openAppSettings()}>
        {t(locale, 'photosAccess.limited.cta')}
      </button>
    </div>
  );
}
