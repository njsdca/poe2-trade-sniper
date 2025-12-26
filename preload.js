const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),

  // Sniper control
  startSniper: () => ipcRenderer.invoke('start-sniper'),
  stopSniper: () => ipcRenderer.invoke('stop-sniper'),
  getStatus: () => ipcRenderer.invoke('get-status'),

  // Cookie extraction
  extractCookies: () => ipcRenderer.invoke('extract-cookies'),
  cancelCookieExtract: () => ipcRenderer.invoke('cancel-cookie-extract'),

  // Updates
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Event listeners
  onLog: (callback) => {
    ipcRenderer.on('log', (event, data) => callback(data));
  },
  onListing: (callback) => {
    ipcRenderer.on('listing', (event, data) => callback(data));
  },
  onTeleport: (callback) => {
    ipcRenderer.on('teleport', (event, data) => callback(data));
  },
  onConnected: (callback) => {
    ipcRenderer.on('connected', (event, data) => callback(data));
  },
  onError: (callback) => {
    ipcRenderer.on('error', (event, data) => callback(data));
  },
  onCookieExpired: (callback) => {
    ipcRenderer.on('cookie-expired', (event, data) => callback(data));
  },
  onStatusChange: (callback) => {
    ipcRenderer.on('status-change', (event, data) => callback(data));
  },
  onCookieExtractStatus: (callback) => {
    ipcRenderer.on('cookie-extract-status', (event, data) => callback(data));
  },
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (event, data) => callback(data));
  },
});
