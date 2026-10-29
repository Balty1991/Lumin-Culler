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

    // theme-color, nu doar data-theme: pe Android (WebView/PWA) meta-ul asta
    // coloreaza bara de status si bara de navigare a SISTEMULUI. Pana acum era
    // atins doar de applyTheme (state/theme.ts), care ruleaza cand utilizatorul
    // SCHIMBA tema — deci la fiecare pornire in tema luminoasa aplicatia era
    // deschisa, dar barele sistemului ramaneau negre, pana cand comutai tema
    // manual inainte si inapoi. Valorile trebuie sa ramana identice cu cele din
    // applyTheme; vezi nota de sincronizare de mai sus.
    // Paleta (state/palette.ts): implicit „cherry”, culorile iconiței. „phone”
    // pune ultimele culori Material You citite, ca să nu clipească.
    var palette = localStorage.getItem('lumin-palette') || 'cherry';
    var root = document.documentElement;
    root.setAttribute('data-palette', palette === 'aurora' ? 'aurora' : 'cherry');
    if (palette === 'phone') {
      try {
        var c = JSON.parse(localStorage.getItem('lumin-phone-colors') || 'null');
        if (c) {
          var hex = function (h) { var n = parseInt(h.slice(1), 16); return ((n >> 16) & 255) + ' ' + ((n >> 8) & 255) + ' ' + (n & 255); };
          var a = isLight ? c.accent1['600'] : c.accent1['200'];
          var b = isLight ? c.accent3['600'] : c.accent3['200'];
          var mid = isLight ? c.accent2['500'] : c.accent2['200'];
          root.style.setProperty('--accent', a);
          root.style.setProperty('--accent-2', b);
          root.style.setProperty('--accent-rgb', hex(a));
          root.style.setProperty('--accent-2-rgb', hex(b));
          root.style.setProperty('--brand-grad', 'linear-gradient(120deg, ' + a + ' 0%, ' + mid + ' 50%, ' + b + ' 100%)');
        }
      } catch (e2) {}
    }
    var cherry = palette !== 'aurora';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isLight ? (cherry ? '#fbf6f8' : '#f5f5f7') : (cherry ? '#0b0816' : '#0a0b0d'));
  } catch (e) {}
})();
