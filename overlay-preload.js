const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('__overlay', {
  onRows: cb => ipcRenderer.on('overlay-rows', (_e, d) => cb(d)),
});
