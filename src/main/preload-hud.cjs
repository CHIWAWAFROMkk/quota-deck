const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('hud', {
  initial: () => ipcRenderer.invoke('hud:initial'),
  refresh: () => ipcRenderer.invoke('hud:refresh'),
  openPanel: () => ipcRenderer.invoke('hud:open-panel'),
  hits: (rects) => ipcRenderer.send('hud:hits', Array.isArray(rects) ? rects : []),
  drag: (phase) => ipcRenderer.send('hud:drag', phase === 'start' ? 'start' : 'end'),
  card: (open) => ipcRenderer.send('hud:card', open === true),
  onState: (callback) => subscribe('hud:state', callback),
  onTokens: (callback) => subscribe('hud:tokens', callback),
  onLayout: (callback) => subscribe('hud:layout', callback),
});
