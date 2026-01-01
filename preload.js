const { contextBridge, ipcRenderer } = require('electron');

// Store listener references for cleanup
const listeners = new Map();

function registerListener(channel, callback) {
  const wrappedCallback = (event, data) => callback(data);
  ipcRenderer.on(channel, wrappedCallback);

  // Store for cleanup
  if (!listeners.has(channel)) {
    listeners.set(channel, []);
  }
  listeners.get(channel).push(wrappedCallback);
}

function removeListener(channel) {
  const channelListeners = listeners.get(channel);
  if (channelListeners) {
    channelListeners.forEach(cb => ipcRenderer.removeListener(channel, cb));
    listeners.delete(channel);
  }
}

function removeAllListeners() {
  for (const [channel, channelListeners] of listeners) {
    channelListeners.forEach(cb => ipcRenderer.removeListener(channel, cb));
  }
  listeners.clear();
}

contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  checkSetupComplete: () => ipcRenderer.invoke('check-setup-complete'),

  // Sniper control (global)
  startSniper: () => ipcRenderer.invoke('start-sniper'),
  stopSniper: () => ipcRenderer.invoke('stop-sniper'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  pauseAll: () => ipcRenderer.invoke('pause-all'),
  resumeAll: () => ipcRenderer.invoke('resume-all'),

  // Per-query control
  startQuery: (queryId) => ipcRenderer.invoke('start-query', queryId),
  stopQuery: (queryId) => ipcRenderer.invoke('stop-query', queryId),
  pauseQuery: (queryId) => ipcRenderer.invoke('pause-query', queryId),
  resumeQuery: (queryId) => ipcRenderer.invoke('resume-query', queryId),
  getQueryStates: () => ipcRenderer.invoke('get-query-states'),

  // Cookie extraction
  extractCookies: () => ipcRenderer.invoke('extract-cookies'),
  cancelCookieExtract: () => ipcRenderer.invoke('cancel-cookie-extract'),

  // Sound
  testSound: () => ipcRenderer.invoke('test-sound'),

  // Auto-purchase test
  testAutoPurchase: () => ipcRenderer.invoke('test-auto-purchase'),
  debugAutoPurchase: () => ipcRenderer.invoke('debug-auto-purchase'),

  // Economy API
  fetchEconomy: (url) => ipcRenderer.invoke('fetch-economy', url),
  fetchItemHistory: (itemId, logCount) => ipcRenderer.invoke('fetch-item-history', itemId, logCount),

  // Import/Export
  exportSearches: (searches) => ipcRenderer.invoke('export-searches', searches),
  importSearches: () => ipcRenderer.invoke('import-searches'),

  // Updates
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Trade History
  getTradeHistory: () => ipcRenderer.invoke('get-trade-history'),
  refreshTradeHistory: () => ipcRenderer.invoke('refresh-trade-history'),
  saveDiscordWebhook: (options) => ipcRenderer.invoke('save-discord-webhook', options),
  testDiscordWebhook: (options) => ipcRenderer.invoke('test-discord-webhook', options),

  // Event listeners (with cleanup support)
  onLog: (callback) => registerListener('log', callback),
  onListing: (callback) => registerListener('listing', callback),
  onTeleport: (callback) => registerListener('teleport', callback),
  onConnected: (callback) => registerListener('connected', callback),
  onDisconnected: (callback) => registerListener('disconnected', callback),
  onReconnecting: (callback) => registerListener('reconnecting', callback),
  onError: (callback) => registerListener('error', callback),
  onCookieExpired: (callback) => registerListener('cookie-expired', callback),
  onStatusChange: (callback) => registerListener('status-change', callback),
  onQueryStateChange: (callback) => registerListener('query-state-change', callback),
  onCookieExtractStatus: (callback) => registerListener('cookie-extract-status', callback),
  onUpdateStatus: (callback) => registerListener('update-status', callback),
  onHotkey: (callback) => registerListener('hotkey', callback),

  // Trade History event listeners
  onTradeHistoryLoaded: (callback) => registerListener('trade-history-loaded', callback),
  onTradeHistoryUpdated: (callback) => registerListener('trade-history-updated', callback),
  onTradeHistoryNewSale: (callback) => registerListener('trade-history-new-sale', callback),
  onTradeHistoryError: (callback) => registerListener('trade-history-error', callback),
  onTradeHistoryRateLimited: (callback) => registerListener('trade-history-rate-limited', callback),

  // Listener cleanup methods
  removeListener: (channel) => removeListener(channel),
  removeAllListeners: () => removeAllListeners(),
});
