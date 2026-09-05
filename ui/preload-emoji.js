const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('emoji', {
  onShow: cb => ipcRenderer.on('emoji-show', (_e, msg) => cb(msg)),
  pick: (ch, name) => ipcRenderer.send('emoji-pick', { ch, name }),
  close: () => ipcRenderer.send('emoji-close'),
});
