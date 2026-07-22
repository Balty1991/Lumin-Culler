// Runs in an isolated context with access to Node APIs, bridges only what
// the renderer needs. Currently nothing beyond a platform flag — the app's
// ML/state layer is pure web (Workers, IndexedDB, Canvas) and needs no
// native bridge, unlike a RAW-file importer would.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('luminCuller', {
  platform: 'electron'
});
