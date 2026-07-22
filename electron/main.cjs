// Electron main process. CommonJS (.cjs) because the root package.json is
// "type": "module" — Electron's main/preload load fastest and most reliably
// as CJS regardless of that setting.
const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');

const DEV_SERVER_URL = 'http://localhost:5173';

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: 'Lumin Culler Pro',
    backgroundColor: '#17181b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  // TF.js WebGL backend needs no extra permissions, but the app also touches
  // IndexedDB/blob URLs — deny anything unrelated (camera/mic/geolocation)
  // by default rather than silently allowing every permission request.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write');
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
