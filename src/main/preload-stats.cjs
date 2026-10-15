const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stats', {
  initial: () => ipcRenderer.invoke('stats:initial'),
  onTokens: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('stats:tokens', listener);
    return () => ipcRenderer.removeListener('stats:tokens', listener);
  },
});
