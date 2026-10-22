const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const plain = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

contextBridge.exposeInMainWorld('hud', {
  initial: () => ipcRenderer.invoke('hud:initial'),
  refresh: () => ipcRenderer.invoke('hud:refresh'),
  action: (name) => ipcRenderer.invoke('hud:action', String(name)),
  setSettings: (patch) => ipcRenderer.invoke('hud:settings', plain(patch)),
  openStats: () => ipcRenderer.invoke('hud:open-stats'),
  hits: (rects) => ipcRenderer.send('hud:hits', Array.isArray(rects) ? rects : []),
  drag: (phase) => ipcRenderer.send('hud:drag', phase === 'start' ? 'start' : 'end'),
  card: (open) => ipcRenderer.send('hud:card', open === true),
  strips: (value) => ipcRenderer.send('hud:strips', plain(value)),
  onState: (callback) => subscribe('hud:state', callback),
  onTokens: (callback) => subscribe('hud:tokens', callback),
  onLayout: (callback) => subscribe('hud:layout', callback),
  onSettings: (callback) => subscribe('hud:settings', callback),
  onSessions: (callback) => subscribe('hud:sessions', callback),
  onGaming: (callback) => subscribe('hud:gaming', value => callback(value === true)),
  dismiss: (ids) => ipcRenderer.send('hud:dismiss', Array.isArray(ids) ? ids.filter(id => typeof id === 'string').slice(0, 50) : []),
  returnTo: (id) => ipcRenderer.invoke('hud:return', String(id)),
  approve: (id, decision) => ipcRenderer.invoke('hud:approve', String(id), decision === 'allow' ? 'allow' : 'deny'),
});
