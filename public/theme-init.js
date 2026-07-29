// Seteaza tema inainte de orice randare, ca sa nu clipeasca tema gresita o
// fractiune de secunda la incarcare (FOUC) — citeste direct localStorage,
// fara sa astepte bootstrap-ul React/Zustand. Extras din index.html (script
// inline) ca sa poata ramane 'script-src' fara 'unsafe-inline' in CSP.
(function () {
  try {
    if (localStorage.getItem('lumin-theme') === 'light') {
      document.documentElement.dataset.theme = 'light';
    }
  } catch (e) {}
})();
