// Seteaza tema inainte de orice randare, ca sa nu clipeasca tema gresita o
// fractiune de secunda la incarcare (FOUC) — citeste direct localStorage,
// fara sa astepte bootstrap-ul React/Zustand. Extras din index.html (script
// inline) ca sa poata ramane 'script-src' fara 'unsafe-inline' in CSP.
//
// 'auto' e rezolvat cu EXACT aceeasi logica ca resolveTheme din state/theme.ts:
// intai setarea de sistem (prefers-color-scheme), si doar daca sistemul nu spune
// nimic se cade pe intervalul orar fix 7:00-19:59. Duplicarea e deliberata —
// scriptul asta trebuie sa ruleze independent, inainte de orice modul JS — dar
// TREBUIE sa ramana in sincron: daca cele doua ar da raspunsuri diferite, pagina
// s-ar randa cu o tema si ar sari la alta in momentul in care porneste React,
// adica exact palpairea pe care acest fisier exista ca sa o previna.
(function () {
  try {
    var stored = localStorage.getItem('lumin-theme');
    var isLight = stored === 'light';
    if (stored === 'auto') {
      // Doua interogari separate, nu una negata: e singura cale de a distinge
      // "sistemul cere luminos" de "sistemul nu spune nimic" — ambele dau false
      // la interogarea pentru intunecat.
      var mm = typeof matchMedia === 'function' ? matchMedia : null;
      if (mm && mm('(prefers-color-scheme: dark)').matches) isLight = false;
      else if (mm && mm('(prefers-color-scheme: light)').matches) isLight = true;
      else {
        var hour = new Date().getHours();
        isLight = hour >= 7 && hour < 20;
      }
    }
    if (isLight) document.documentElement.dataset.theme = 'light';
  } catch (e) {}
})();
