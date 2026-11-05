// Înlocuiește service worker-ul vechi al aplicației web (care nu mai e publicată):
// golește tot ce ținea în cache, se dezînregistrează și reîncarcă paginile deschise,
// ca vizitatorii vechi să vadă pagina nouă, nu aplicația salvată.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
