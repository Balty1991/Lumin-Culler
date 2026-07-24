/**
 * core/export/clientGallery.ts
 * "Modul Client Review" (plan 3.2.3) — un singur fisier HTML, auto-continut
 * (miniaturile incorporate ca base64), pe care fotograful il trimite clientului
 * (email, WeTransfer, folder cloud propriu) pentru feedback. NU e o galerie web
 * "gazduita si securizata cu link" — asta ar necesita un backend/server pe care
 * aplicatia (100% locala, fara server propriu) nu il are; e un fisier static,
 * deschis local in orice browser, cu favorite marcate client-side (localStorage,
 * scopate per export) si o lista de nume de fisiere pe care clientul o poate
 * copia si trimite inapoi fotografului — fara niciun schimb de date prin retea.
 */

export interface ClientGalleryPhoto {
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

export async function buildClientGalleryHtml(photos: ClientGalleryPhoto[], title: string): Promise<string> {
  // id unic per export — izoleaza favoritele in localStorage intre mai multe
  // galerii deschise in acelasi browser (ex. clientul primeste doua sesiuni diferite)
  const galleryId = 'lc-' + Math.random().toString(36).slice(2, 10);
  const items = await Promise.all(photos.map(async p => ({
    fileName: p.fileName,
    dataUri: await blobToDataUri(p.thumbnail)
  })));

  const cards = items.map((it, i) => `
    <label class="card" data-name="${escapeHtml(it.fileName)}">
      <input type="checkbox" data-idx="${i}">
      <img src="${it.dataUri}" alt="${escapeHtml(it.fileName)}" loading="lazy">
      <span class="name">${escapeHtml(it.fileName)}</span>
      <span class="heart">&hearts;</span>
    </label>`).join('\n');

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
  p.hint { color: #9a9a9f; margin: 0 0 20px; font-size: 0.9rem; max-width: 640px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; }
  .card { position: relative; display: block; cursor: pointer; border-radius: 10px; overflow: hidden; background: #17171a; border: 2px solid transparent; }
  .card input { position: absolute; opacity: 0; pointer-events: none; }
  .card img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; }
  .card .name { display: block; padding: 6px 8px; font-size: 0.72rem; color: #cfcfd2; word-break: break-all; }
  .card .heart { position: absolute; top: 8px; right: 8px; font-size: 1.3rem; color: rgba(255,255,255,0.55); text-shadow: 0 1px 3px rgba(0,0,0,0.6); }
  .card input:checked ~ .heart { color: #fb7185; }
  .card:has(input:checked) { border-color: #fb7185; }
  .toolbar { position: sticky; top: 0; display: flex; gap: 10px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; background: #0b0b0c; padding: 8px 0; }
  button { background: #fb7185; color: #1a0508; border: none; border-radius: 8px; padding: 9px 14px; font-weight: 700; cursor: pointer; font-size: 0.85rem; }
  textarea { width: 100%; box-sizing: border-box; margin-top: 12px; min-height: 90px; background: #17171a; color: #f2f2f2; border: 1px solid #333; border-radius: 8px; padding: 8px; font-family: monospace; font-size: 0.8rem; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="hint">Apasa pe o poza ca sa o marchezi ca favorita (♥). Cand ai terminat, apasa
  „Genereaza lista" si copiaza textul care apare — trimite-l inapoi fotografului (email,
  mesaj etc.). Alegerile tale raman doar in acest browser, nu sunt trimise nicaieri automat.</p>
  <div class="toolbar">
    <button id="gen" type="button">Genereaza lista preferatelor</button>
    <span id="count" class="hint"></span>
  </div>
  <div class="grid">${cards}
  </div>
  <textarea id="out" readonly style="display:none"></textarea>
<script>
(function() {
  var KEY = '${galleryId}-favs';
  var boxes = Array.prototype.slice.call(document.querySelectorAll('.card input'));
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
  boxes.forEach(function(b) { if (saved[b.dataset.idx]) b.checked = true; });
  function persist() {
    var state = {};
    boxes.forEach(function(b) { if (b.checked) state[b.dataset.idx] = true; });
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    document.getElementById('count').textContent = boxes.filter(function (b) { return b.checked; }).length + ' favorite';
  }
  boxes.forEach(function(b) { b.addEventListener('change', persist); });
  persist();
  document.getElementById('gen').addEventListener('click', function() {
    var names = boxes.filter(function(b) { return b.checked; })
      .map(function(b) { return b.closest('.card').getAttribute('data-name'); });
    var out = document.getElementById('out');
    out.style.display = 'block';
    out.value = names.length ? names.join('\\n') : '(nicio poza marcata inca)';
    out.focus();
    out.select();
  });
})();
</script>
</body>
</html>`;
}
