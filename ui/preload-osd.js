const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('osd', {
  onShow: cb => ipcRenderer.on('osd-show', (_e, msg) => cb(msg)),
  hidden: () => ipcRenderer.send('osd-hidden'),
});
