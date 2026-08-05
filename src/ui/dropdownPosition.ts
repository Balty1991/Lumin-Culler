/**
 * ui/dropdownPosition.ts
 * Pozitionare pentru meniuri randate printr-un portal in <body> (SceneTagFilter,
 * ColorLabelFilter) — ancorate `position:fixed` sub butonul declansator. Fara
 * asta, un buton aflat jos pe ecran (ex. in modalul "Mai multe filtre", care
 * poate ocupa mare parte din viewport pe mobil) producea un meniu al carui
 * `top` + inaltime depaseau marginea de jos a ecranului — bug real raportat de
 * utilizator ("nu e complet vizibila sa vad tot ce apare"). Fiind `fixed`, acea
 * portiune nu era accesibila NICI prin scroll-ul paginii (fixed nu se misca),
 * NICI prin overflow-ul intern (el ajuta doar continutul deja incapator in
 * cutia vizibila) — pur si simplu iesea din ecran. Aici calculam spatiul
 * disponibil sub SI deasupra butonului si alegem directia cu mai mult loc,
 * plus un `maxHeight` care garanteaza ca meniul intreg incape in viewport
 * (scroll intern preia restul, daca lista tot nu incape).
 */
export interface MenuPosition {
  left?: number;
  /** Ancorare la marginea DREAPTA a butonului in loc de stanga — vezi computeMenuPosition mai jos. */
  right?: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/**
 * Bug real gasit in timpul verificarii: SceneTagFilter/ColorLabelFilter sunt
 * randate CA COPII ai MoreFiltersMenu in React, dar fiecare isi randeaza
 * propriul meniu printr-un portal SEPARAT direct in <body> — deci in DOM,
 * meniul din interior NU e descendentul lui `menuRef` al lui MoreFiltersMenu,
 * desi vizual arata imbricat. Listener-ul de "click in afara" al panoului
 * parinte (bazat pe `.contains()`, verificare DOM, nu React) vedea orice click
 * pe optiunile din interior ca fiind "in afara" si inchidea panoul chiar in
 * clipa apasarii (pe pointerdown, inainte de faza de click) — subselectia
 * (eticheta/scena aleasa) nu apuca niciodata sa se aplice, silentios, fara
 * nicio eroare vizibila. Fix: orice click aflat in interiorul UNUI meniu activ
 * (`role="menu"`, indiferent de portal) numara drept "inauntru" pentru toate
 * meniurile deschise, nu doar pentru al lui.
 */
export function isInsideAnyMenu(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="menu"]') !== null;
}

/**
 * Bug real gasit la verificare vizuala (CollectionPicker.tsx, butonul de
 * folder din DetailView — ultima iconita dintr-o bara lipita de marginea
 * dreapta a ecranului): pozitia orizontala era mereu `left: rect.left`, fara
 * nicio verificare ca meniul (min-width 150-170px) chiar incape pana la
 * marginea dreapta a viewport-ului — un buton aproape de acea margine
 * producea un meniu vizibil taiat, fara nicio cale de a-l derula orizontal
 * (position:fixed, la fel ca problema deja rezolvata pe verticala mai sus).
 * Fix simetric cu logica de sus/jos: cand e mai mult spatiu la STANGA
 * butonului decat la dreapta, ancoram meniul de marginea lui DREAPTA
 * (`right`, CSS), nu de cea stanga — asa nu trebuie sa cunoastem in avans
 * latimea reala randata a meniului, doar directia cu mai mult loc.
 */
export function computeMenuPosition(rect: DOMRect, margin = 10, minHeight = 120): MenuPosition {
  const spaceBelow = window.innerHeight - rect.bottom - margin;
  const spaceAbove = rect.top - margin;
  const openUpward = spaceBelow < minHeight && spaceAbove > spaceBelow;
  const vertical = openUpward
    ? { bottom: window.innerHeight - rect.top + 6, maxHeight: Math.max(minHeight, spaceAbove) }
    : { top: rect.bottom + 6, maxHeight: Math.max(minHeight, spaceBelow) };

  const spaceRight = window.innerWidth - rect.left - margin;
  const spaceLeft = rect.right - margin;
  const horizontal = spaceRight < spaceLeft
    ? { right: window.innerWidth - rect.right }
    : { left: rect.left };

  return { ...horizontal, ...vertical };
}
