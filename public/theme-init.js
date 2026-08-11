// Seteaza tema inainte de orice randare, ca sa nu clipeasca tema gresita o
// fractiune de secunda la incarcare (FOUC) — citeste direct localStorage,
// fara sa astepte bootstrap-ul React/Zustand. Extras din index.html (script
// inline) ca sa poata ramane 'script-src' fara 'unsafe-inline' in CSP.
// 'auto' (tema dupa ora) rezolvata cu ACELASI interval fix ca resolveTheme
// din state/theme.ts (7:00-19:59 luminos) — duplicat aici in mod deliberat,
// acest script trebuie sa ruleze independent, inainte de orice modul JS.
(function () {
  try {
    var stored = localStorage.getItem('lumin-theme');
    var isLight = stored === 'light';
    if (stored === 'auto') {
      var hour = new Date().getHours();
      isLight = hour >= 7 && hour < 20;
    }
    if (isLight) document.documentElement.dataset.theme = 'light';
  } catch (e) {}
})();
