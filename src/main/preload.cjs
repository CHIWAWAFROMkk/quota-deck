const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quotaDeck', {
  refreshAll: () => ipcRenderer.invoke('quota:refresh-all'),
  refreshProvider: (providerId) => ipcRenderer.invoke('quota:refresh-provider', providerId),
  openSettings: () => ipcRenderer.invoke('quota:open-settings'),
  openWorkBuddy: () => ipcRenderer.invoke('quota:open-workbuddy'),
  runCollaboration: (request) => ipcRenderer.invoke('collab:run', request),
  onSnapshot: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('quota:snapshot', listener);
    return () => ipcRenderer.removeListener('quota:snapshot', listener);
  },
});
