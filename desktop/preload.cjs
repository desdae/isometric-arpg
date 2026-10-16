// Hands the game a small, fixed bridge to the desktop app (see
// src/engine/store.ts): save storage, the save folder's path and quitting.
// Nothing else from Node or Electron reaches the page.

const { contextBridge, ipcRenderer } = require('electron');

/** Storage calls throw on failure, like localStorage, so the game's own error handling applies. */
function call(channel, ...args) {
  const r = ipcRenderer.sendSync(channel, ...args);
  if (r && r.error) throw new Error(r.error);
  return r ? r.ok : undefined;
}

contextBridge.exposeInMainWorld('desktop', {
  store: {
    keys: () => call('store:keys'),
    get: (key) => call('store:get', String(key)),
    set: (key, value) => call('store:set', String(key), String(value)),
    remove: (key) => call('store:remove', String(key)),
  },
  saveDir: ipcRenderer.sendSync('app:saveDir'),
  quit: () => ipcRenderer.send('app:quit'),
});
