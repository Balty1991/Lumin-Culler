/**
 * core/export/clientGallery.ts
 * "Modul Client Review" (plan 3.2.3) — un singur fisier HTML, auto-continut
 * (miniaturile incorporate ca base64), pe care fotograful il trimite clientului
 * (email, WeTransfer, folder cloud propriu) pentru feedback. NU e o galerie web
 * "gazduita si securizata cu link" — asta ar necesita un backend/server pe care
 * aplicatia (100% locala, fara server propriu) nu il are; e un fisier static,
 * deschis local in orice browser, cu alegerile (Imi place/Nu prea) marcate
 * client-side (localStorage, scopate per export) si un fisier JSON descarcabil
 * (Blob + link `download`, functioneaza si deschis direct de pe disc, `file://`,
 * fara niciun server) pe care clientul il trimite inapoi fotografului — acesta
 * il re-importa (vezi core/export/clientFeedback.ts + store.ts importClientFeedback)
 * ca AI-ul sa invete si din alegerile clientului, nu doar ale fotografului.
 */

import { applyWatermark } from './watermark';

export interface ClientGalleryPhoto {
  id: string;
  fileName: string;
  thumbnail: Blob;
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Citirea miniaturii a esuat.'));
    reader.readAsDataURL(blob);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * `watermarkText` optional (setat din meniu, vezi state/watermarkText.ts) — daca
 * e prezent, fiecare miniatura primeste un watermark text repetat/diagonal
 * (core/export/watermark.ts) inainte sa fie incorporata, ca clientul sa nu poata
 * folosi previzualizarile inainte de livrarea finala/plata. Absent = galeria
 * ramane exact ca inainte (miniaturi neatinse).
 *
 * `subtitle` optional (ex. "24 poze selectate · 29 iulie 2026") — deja tradus
 * de apelant (store.ts, vezi t()), ca acest modul sa ramana independent de
 * locale, la fel ca title. Absent = fara linia de subtitlu (comportament
 * identic cu inainte de acest camp).
 */
export async function buildClientGalleryHtml(
  photos: ClientGalleryPhoto[], title: string, watermarkText?: string, subtitle?: string
): Promise<string> {
  // id unic per export — izoleaza favoritele in localStorage intre mai multe
  // galerii deschise in acelasi browser (ex. clientul primeste doua sesiuni diferite)
  const galleryId = 'lc-' + Math.random().toString(36).slice(2, 10);
  const items = await Promise.all(photos.map(async p => ({
    id: p.id,
    fileName: p.fileName,
    dataUri: await blobToDataUri(watermarkText ? await applyWatermark(p.thumbnail, watermarkText) : p.thumbnail)
  })));

  const cards = items.map(it => `
    <div class="card" data-id="${escapeHtml(it.id)}" data-name="${escapeHtml(it.fileName)}">
      <img src="${it.dataUri}" alt="${escapeHtml(it.fileName)}" loading="lazy">
      <span class="name">${escapeHtml(it.fileName)}</span>
      <div class="choice">
        <button type="button" class="like" data-action="like" aria-label="Imi place">&#128077;</button>
        <button type="button" class="dislike" data-action="dislike" aria-label="Nu prea">&#128078;</button>
      </div>
    </div>`).join('\n');

  return `<!doctype html>
<html lang="ro">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 24px; background: #0b0b0c; color: #f2f2f2; }
  h1 { font-size: 1.3rem; margin: 0 0 4px; }
  p.subtitle { color: #cfcfd2; margin: 0 0 14px; font-size: 0.95rem; font-weight: 600; }
  p.hint { color: #9a9a9f; margin: 0 0 20px; font-size: 0.9rem; max-width: 640px; }
  footer.credit { margin-top: 32px; padding-top: 16px; border-top: 1px solid #232326; color: #6c6c72; font-size: 0.75rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; }
  .card { position: relative; display: block; border-radius: 10px; overflow: hidden; background: #17171a; border: 2px solid transparent; }
  .card img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; }
  .card .name { display: block; padding: 6px 8px; font-size: 0.72rem; color: #cfcfd2; word-break: break-all; }
  .card .choice { display: flex; gap: 6px; padding: 0 8px 8px; }
  .card .choice button { flex: 1; background: #232326; color: #f2f2f2; border: none; border-radius: 7px; padding: 7px 0; font-size: 1.05rem; cursor: pointer; opacity: 0.6; }
  .card .choice button.active.like { background: #16a34a; opacity: 1; }
  .card .choice button.active.dislike { background: #dc2626; opacity: 1; }
  .card.picked-like { border-color: #16a34a; }
  .card.picked-dislike { border-color: #dc2626; }
  .toolbar { position: sticky; top: 0; display: flex; gap: 10px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; background: #0b0b0c; padding: 8px 0; }
  button { background: #fb7185; color: #1a0508; border: none; border-radius: 8px; padding: 9px 14px; font-weight: 700; cursor: pointer; font-size: 0.85rem; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''}
  <p class="hint">Pentru fiecare poza, apasa &#128077; ("imi place") sau &#128078; ("nu prea") —
  poti schimba oricand parerea, sau lasa poze nemarcate. Cand ai terminat, apasa
  „Descarca alegerile" si trimite fisierul descarcat (.json) inapoi fotografului
  (email, WhatsApp etc.). Alegerile raman doar in acest browser pana le descarci —
  nimic nu se trimite automat prin retea.</p>
  <div class="toolbar">
    <button id="gen" type="button">Descarca alegerile</button>
    <span id="count" class="hint"></span>
  </div>
  <div class="grid">${cards}
  </div>
  <footer class="credit">Galerie generata cu Lumin Culler Pro — o aplicatie de sortare foto cu AI, 100% locala.</footer>
<script>
(function() {
  var KEY = '${galleryId}-choices';
  var galleryId = '${galleryId}';
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  var choices = {};
  try { choices = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}

  function render(card) {
    var id = card.getAttribute('data-id');
    var choice = choices[id];
    card.classList.toggle('picked-like', choice === 'like');
    card.classList.toggle('picked-dislike', choice === 'dislike');
    var likeBtn = card.querySelector('[data-action="like"]');
    var dislikeBtn = card.querySelector('[data-action="dislike"]');
    likeBtn.classList.toggle('active', choice === 'like');
    dislikeBtn.classList.toggle('active', choice === 'dislike');
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(choices)); } catch (e) {}
    var n = Object.keys(choices).length;
    document.getElementById('count').textContent = n + ' din ' + cards.length + ' marcate';
  }
  cards.forEach(function(card) {
    var id = card.getAttribute('data-id');
    card.querySelectorAll('.choice button').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var action = btn.getAttribute('data-action');
        // apasat din nou pe alegerea curenta -> revine la nemarcat
        choices[id] = choices[id] === action ? undefined : action;
        if (choices[id] === undefined) delete choices[id];
        render(card);
        persist();
      });
    });
    render(card);
  });
  persist();

  document.getElementById('gen').addEventListener('click', function() {
    var photos = cards
      .map(function(card) { return { id: card.getAttribute('data-id'), fileName: card.getAttribute('data-name'), decision: choices[card.getAttribute('data-id')] }; })
      .filter(function(p) { return !!p.decision; });
    var payload = { version: 1, galleryId: galleryId, exportedAt: new Date().toISOString(), photos: photos };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'feedback-client-' + galleryId + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
})();
</script>
</body>
</html>`;
}
