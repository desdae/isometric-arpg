// The desktop build: Electron opens the release build of the game in its own
// window and keeps its saves as files, one per storage key, in
//   Windows  %APPDATA%\The Silent Bells\saves
//   Linux    ~/.config/The Silent Bells/saves (Steam Deck included)
//   macOS    ~/Library/Application Support/The Silent Bells/saves
// Steam Cloud's Auto-Cloud is pointed at that folder (see desktop/README.md).

const { app, BrowserWindow, Menu, ipcMain, net, protocol, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const GAME = path.join(__dirname, '..', 'dist-release');
const SAVES = path.join(app.getPath('userData'), 'saves');

// The game is served from app://game/ rather than file://, so module scripts,
// workers and fetch behave as they do on the web.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// ---- Saves -----------------------------------------------------------------

/** Storage keys become file names: anything outside a safe set is escaped. */
const fileOf = (key) => path.join(SAVES, `${key.replace(/[^A-Za-z0-9._-]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)}.json`);
const keyOf = (file) => decodeURIComponent(file.slice(0, -'.json'.length));

ipcMain.on('store:keys', (e) => {
  try {
    e.returnValue = { ok: fs.readdirSync(SAVES).filter((f) => f.endsWith('.json')).map(keyOf) };
  } catch {
    e.returnValue = { ok: [] };
  }
});

ipcMain.on('store:get', (e, key) => {
  try {
    e.returnValue = { ok: fs.readFileSync(fileOf(key), 'utf8') };
  } catch (err) {
    // A save cut short by a crash or power loss: fall back to the previous copy.
    if (err.code !== 'ENOENT') console.error('read failed', key, err);
    try {
      e.returnValue = { ok: fs.readFileSync(`${fileOf(key)}.bak`, 'utf8') };
    } catch {
      e.returnValue = { ok: null };
    }
  }
});

ipcMain.on('store:set', (e, key, value) => {
  try {
    fs.mkdirSync(SAVES, { recursive: true });
    const file = fileOf(key);
    // Write beside the old file and swap it in, so a crash mid-write never
    // leaves a half-written save; the previous version stays as .bak.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, value, 'utf8');
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    fs.renameSync(tmp, file);
    e.returnValue = { ok: true };
  } catch (err) {
    e.returnValue = { error: String(err && err.message) };
  }
});

ipcMain.on('store:remove', (e, key) => {
  for (const f of [fileOf(key), `${fileOf(key)}.bak`]) fs.rmSync(f, { force: true });
  e.returnValue = { ok: true };
});

ipcMain.on('app:saveDir', (e) => (e.returnValue = SAVES));
ipcMain.on('app:quit', () => app.quit());

// ---- Window ----------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0a0405',
    title: 'The Silent Bells',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  // Links to the outside world open in the player's browser, never in the game window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://game/')) e.preventDefault();
  });
  // F11 toggles fullscreen, as players expect from a desktop game.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
  });
  void win.loadURL('app://game/index.html');
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname);
    const file = path.normalize(path.join(GAME, rel));
    if (!file.startsWith(GAME)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
});

app.on('window-all-closed', () => app.quit());
