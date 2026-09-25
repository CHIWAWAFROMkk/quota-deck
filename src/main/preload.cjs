const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quotaDeck', {
  refreshAll: () => ipcRenderer.invoke('quota:refresh-all'),
  refreshProvider: (providerId) => ipcRenderer.invoke('quota:refresh-provider', providerId),
  openSettings: () => ipcRenderer.invoke('quota:open-settings'),
  hide: () => ipcRenderer.invoke('quota:hide'),
  openClaudeHelp: () => ipcRenderer.invoke('quota:claude-help'),
  connectClaude: () => ipcRenderer.invoke('quota:claude-connect'),
  disconnectClaude: () => ipcRenderer.invoke('quota:claude-disconnect'),
  openWorkBuddy: () => ipcRenderer.invoke('quota:open-workbuddy'),
  runCollaboration: (request) => ipcRenderer.invoke('collab:run', request),
  collaborationState: () => ipcRenderer.invoke('collab:state'),
  onCollaborationState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('collab:state', listener);
    return () => ipcRenderer.removeListener('collab:state', listener);
  },
  onSnapshot: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('quota:snapshot', listener);
    return () => ipcRenderer.removeListener('quota:snapshot', listener);
  },
});
