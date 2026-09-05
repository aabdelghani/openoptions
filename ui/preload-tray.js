const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tray', {
  state: () => ipcRenderer.invoke('tray-state'),
  onState: cb => ipcRenderer.on('tray-state', (_e, st) => cb(st)),
  action: (name, params) => ipcRenderer.invoke('tray-action', name, params || {}),
});
