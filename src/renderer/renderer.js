// ========================================
// Divinedge - Renderer
// ========================================

import { initEconomy, fetchEconomyData, onEconomyTabActivated, getFavorites } from './economy.js';

// DOM Elements - Login Overlay
const loginOverlay = document.getElementById('loginOverlay');
const loginStatus = document.getElementById('loginStatus');
const loginStatusText = document.getElementById('loginStatusText');

// DOM Elements - Header
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusIndicator = document.getElementById('status-indicator');
const versionBadge = document.getElementById('versionBadge');

// DOM Elements - Settings Tab
const leagueSelect = document.getElementById('league');
const alertSoundSelect = document.getElementById('alertSound');
const soundEnabledCheckbox = document.getElementById('soundEnabled');
const startMinimizedCheckbox = document.getElementById('startMinimized');
const autoStartCheckbox = document.getElementById('autoStart');
const saveConfigBtn = document.getElementById('saveConfigBtn');
const testSoundBtn = document.getElementById('testSoundBtn');

// DOM Elements - Searches Tab
const searchUrlInput = document.getElementById('searchUrl');
const addSearchBtn = document.getElementById('addSearchBtn');
const searchList = document.getElementById('searchList');
const searchCount = document.getElementById('searchCount');

// DOM Elements - Activity Log (now in Searches tab)
const logContainer = document.getElementById('logContainer');
const clearLogBtn = document.getElementById('clearLogBtn');

// DOM Elements - Footer
const updateStatus = document.getElementById('updateStatus');
const checkUpdateBtn = document.getElementById('checkUpdateBtn');
const downloadUpdateBtn = document.getElementById('downloadUpdateBtn');
const installUpdateBtn = document.getElementById('installUpdateBtn');
const updateBadge = document.getElementById('updateBadge');

// Stats elements
const statListings = document.getElementById('statListings');
const statTeleports = document.getElementById('statTeleports');
const statUptime = document.getElementById('statUptime');

// Tab elements
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

// State
let config = {};
let isRunning = false;
let availableVersion = null;
let currentTab = 'searches';


// Stats tracking
let stats = {
  listings: 0,
  teleports: 0,
  totalTime: 0,
  startTime: null,
};
let uptimeInterval = null;

// Connected queries tracking
let connectedQueries = new Set();

// URL parsing regex
const TRADE_URL_REGEX = /trade2\/search\/poe2\/[^/]+\/([a-zA-Z0-9]+)/;

// ========================================
// Initialization
// ========================================

async function init() {
  config = await window.api.getConfig();

  loadConfigToUI();
  renderSearchList();

  const status = await window.api.getStatus();
  updateRunningState(status.running);

  // Load version
  const version = await window.api.getAppVersion();
  versionBadge.textContent = `v${version}`;

  setupTabNavigation();
  setupEventListeners();
  setupIPCListeners();

  // Initialize economy module with saved favorites
  initEconomy(config);

  // Start login process immediately
  startLogin();

  // Listen for favorites changes from economy module
  window.addEventListener('economy-favorites-changed', async (e) => {
    config.economyFavorites = e.detail.favorites;
    await window.api.saveConfig(config);
  });

  // Auto-start if configured
  if (config.autoStart && config.poesessid && config.queries?.length > 0) {
    setTimeout(() => startSniper(), 1000);
  }
}

// ========================================
// Tab Navigation
// ========================================

function setupTabNavigation() {
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      switchTab(tabId);
    });
  });
}

function switchTab(tabId) {
  currentTab = tabId;

  // Update tab buttons
  tabButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  // Update tab panels
  tabPanels.forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tabId}`);
  });

  // Fetch economy data when economy tab is activated
  if (tabId === 'economy') {
    onEconomyTabActivated();
  }
}

// ========================================
// Login Flow
// ========================================

async function startLogin() {
  // Show login overlay
  loginOverlay.classList.remove('hidden');
  loginStatusText.textContent = 'Opening browser...';
  loginStatus.className = 'login-status';

  // Start cookie extraction automatically
  const result = await window.api.extractCookies();

  if (result.success) {
    // Reload config with new cookies
    config = await window.api.getConfig();
    loadConfigToUI();

    loginStatusText.textContent = 'Connected! Loading app...';
    loginStatus.className = 'login-status success';

    // Hide overlay after brief success message
    setTimeout(() => {
      hideLoginOverlay();
    }, 1000);
  } else {
    loginStatusText.textContent = result.error || 'Connection failed. Please restart the app.';
    loginStatus.className = 'login-status error';
  }
}

function hideLoginOverlay() {
  loginOverlay.classList.add('hidden');
}

// ========================================
// Config Management
// ========================================

function loadConfigToUI() {
  leagueSelect.value = config.league || 'Fate%20of%20the%20Vaal';
  alertSoundSelect.value = config.soundFile || 'alert.wav';
  soundEnabledCheckbox.checked = config.soundEnabled !== false;
  startMinimizedCheckbox.checked = config.startMinimized === true;
  autoStartCheckbox.checked = config.autoStart === true;
}

function getConfigFromUI() {
  return {
    ...config,
    // poesessid and cf_clearance are now managed by cookie extractor only
    league: leagueSelect.value,
    soundFile: alertSoundSelect.value,
    soundEnabled: soundEnabledCheckbox.checked,
    startMinimized: startMinimizedCheckbox.checked,
    autoStart: autoStartCheckbox.checked,
  };
}

async function saveConfig() {
  config = getConfigFromUI();
  const success = await window.api.saveConfig(config);

  if (success) {
    addLogEntry('success', 'Settings saved successfully.');
  } else {
    addLogEntry('error', 'Failed to save settings.');
  }
}

// ========================================
// Search Management
// ========================================

function renderSearchList() {
  const queries = config.queries || [];

  // Update search count
  searchCount.textContent = `${queries.length} ${queries.length === 1 ? 'search' : 'searches'}`;

  if (queries.length === 0) {
    searchList.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <p>No searches added yet</p>
        <span>Paste a trade URL above to start monitoring</span>
      </div>
    `;
    return;
  }

  searchList.innerHTML = queries.map((query, index) => {
    const id = typeof query === 'string' ? query : query.id;
    const name = typeof query === 'string' ? '' : (query.name || '');
    const isConnected = connectedQueries.has(id);

    return `
      <div class="search-item" data-index="${index}">
        <div class="query-info">
          <span class="connection-status ${isConnected ? 'connected' : ''}" title="${isConnected ? 'Connected' : 'Disconnected'}"></span>
          <span class="query-id">${id}</span>
          ${name ? `<span class="query-name">(${name})</span>` : ''}
        </div>
        <button class="remove-btn" data-index="${index}" ${isRunning ? 'disabled' : ''} title="Remove search">&times;</button>
      </div>
    `;
  }).join('');

  // Add remove handlers
  searchList.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (isRunning) return;
      const index = parseInt(e.target.dataset.index);
      removeSearch(index);
    });
  });
}

function parseTradeUrl(url) {
  const match = url.match(TRADE_URL_REGEX);
  if (match) {
    return match[1];
  }
  return null;
}

async function addSearch() {
  const url = searchUrlInput.value.trim();
  if (!url) return;

  // Try to parse as URL first
  let queryId = parseTradeUrl(url);

  // If not a URL, treat as direct query ID
  if (!queryId && /^[a-zA-Z0-9]+$/.test(url)) {
    queryId = url;
  }

  if (!queryId) {
    addLogEntry('error', 'Invalid URL or query ID. Paste a trade URL or enter a query ID.');
    return;
  }

  // Check for duplicates
  const queries = config.queries || [];
  const exists = queries.some(q => (typeof q === 'string' ? q : q.id) === queryId);
  if (exists) {
    addLogEntry('warn', `Query ${queryId} already exists.`);
    return;
  }

  // Add to config
  config.queries = [...queries, queryId];
  await window.api.saveConfig(config);

  renderSearchList();
  searchUrlInput.value = '';
  addLogEntry('info', `Added search: ${queryId}`);
}

async function removeSearch(index) {
  const queries = config.queries || [];
  const removed = queries[index];
  const removedId = typeof removed === 'string' ? removed : removed.id;

  config.queries = queries.filter((_, i) => i !== index);
  await window.api.saveConfig(config);

  renderSearchList();
  addLogEntry('info', `Removed search: ${removedId}`);
}

// ========================================
// Sniper Control
// ========================================

async function startSniper() {
  if (isRunning) return;

  // Save current config first
  config = getConfigFromUI();
  await window.api.saveConfig(config);

  if (!config.poesessid) {
    addLogEntry('error', 'POESESSID is required. Go to Settings to configure authentication.');
    switchTab('settings');
    return;
  }

  if (!config.queries || config.queries.length === 0) {
    addLogEntry('error', 'Add at least one search before starting.');
    return;
  }

  // Reset stats
  stats = { listings: 0, teleports: 0, totalTime: 0, startTime: Date.now() };
  connectedQueries.clear();
  updateStats();
  startUptimeTimer();

  addLogEntry('info', 'Starting sniper...');
  await window.api.startSniper();
}

async function stopSniper() {
  if (!isRunning) return;

  addLogEntry('info', 'Stopping sniper...');
  await window.api.stopSniper();
  stopUptimeTimer();
  connectedQueries.clear();
  renderSearchList();
}

function updateRunningState(running) {
  isRunning = running;

  startBtn.disabled = running;
  stopBtn.disabled = !running;

  // Update status indicator
  const statusText = statusIndicator.querySelector('.status-text');
  statusText.textContent = running ? 'Running' : 'Stopped';
  statusIndicator.className = `status-badge ${running ? 'running' : 'stopped'}`;

  // Disable config editing while running
  leagueSelect.disabled = running;
  alertSoundSelect.disabled = running;
  saveConfigBtn.disabled = running;
  addSearchBtn.disabled = running;
  searchUrlInput.disabled = running;
  startMinimizedCheckbox.disabled = running;
  autoStartCheckbox.disabled = running;

  if (!running) {
    stopUptimeTimer();
    connectedQueries.clear();
  }
  renderSearchList();
}

// ========================================
// Stats & Uptime
// ========================================

function updateStats() {
  statListings.textContent = stats.listings;
  statTeleports.textContent = stats.teleports;
}

function startUptimeTimer() {
  stats.startTime = Date.now();
  updateUptime();
  uptimeInterval = setInterval(updateUptime, 1000);
}

function stopUptimeTimer() {
  if (uptimeInterval) {
    clearInterval(uptimeInterval);
    uptimeInterval = null;
  }
}

function updateUptime() {
  if (!stats.startTime) {
    statUptime.textContent = '00:00';
    return;
  }

  const elapsed = Math.floor((Date.now() - stats.startTime) / 1000);
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;

  if (hours > 0) {
    statUptime.textContent = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  } else {
    statUptime.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
}

// ========================================
// Activity Log
// ========================================

function addLogEntry(level, message) {
  const time = new Date().toLocaleTimeString();
  const formattedMessage = `[${time}] ${message}`;

  // Add to log container
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  entry.textContent = formattedMessage;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;

  // Limit log entries
  while (logContainer.children.length > 500) {
    logContainer.removeChild(logContainer.firstChild);
  }
}

function clearLog() {
  logContainer.innerHTML = '';
  addLogEntry('info', 'Log cleared.');
}

// ========================================
// Utilities
// ========================================

async function testSound() {
  await window.api.testSound();
}

// ========================================
// Updates
// ========================================

async function checkForUpdates() {
  checkUpdateBtn.disabled = true;
  checkUpdateBtn.textContent = 'Checking...';
  updateStatus.textContent = 'Checking for updates...';
  updateStatus.className = 'update-status checking';

  const result = await window.api.checkForUpdates();

  checkUpdateBtn.disabled = false;
  checkUpdateBtn.textContent = 'Check for Updates';

  if (result.error) {
    updateStatus.textContent = `Error: ${result.error}`;
    updateStatus.className = 'update-status error';
    addLogEntry('error', `Update check failed: ${result.error}`);
  }
}

async function downloadUpdate() {
  downloadUpdateBtn.disabled = true;
  downloadUpdateBtn.textContent = 'Starting...';
  addLogEntry('info', `Downloading update v${availableVersion}...`);

  const result = await window.api.downloadUpdate();

  if (result.error) {
    downloadUpdateBtn.disabled = false;
    downloadUpdateBtn.textContent = 'Download';
    updateStatus.textContent = `Download failed: ${result.error}`;
    updateStatus.className = 'update-status error';
    addLogEntry('error', `Download failed: ${result.error}`);
  }
}

function installUpdate() {
  addLogEntry('info', 'Installing update and restarting...');
  window.api.installUpdate();
}

// ========================================
// Event Listeners
// ========================================

function setupEventListeners() {
  // Config buttons
  saveConfigBtn.addEventListener('click', saveConfig);
  testSoundBtn.addEventListener('click', testSound);

  // Search buttons
  addSearchBtn.addEventListener('click', addSearch);

  // Control buttons
  startBtn.addEventListener('click', startSniper);
  stopBtn.addEventListener('click', stopSniper);

  // Log button
  clearLogBtn.addEventListener('click', clearLog);

  // Update buttons
  checkUpdateBtn.addEventListener('click', checkForUpdates);
  downloadUpdateBtn.addEventListener('click', downloadUpdate);
  installUpdateBtn.addEventListener('click', installUpdate);

  // Enter key to add search
  searchUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addSearch();
    }
  });
}

// ========================================
// IPC Listeners
// ========================================

function setupIPCListeners() {
  window.api.onLog((data) => {
    const level = data.level.toLowerCase();
    addLogEntry(level, data.message);
  });

  window.api.onListing((data) => {
    stats.listings++;
    updateStats();
    addLogEntry('listing', `NEW: ${data.itemName} @ ${data.price} from ${data.account}`);
  });

  window.api.onTeleport((data) => {
    stats.teleports++;
    stats.totalTime += data.elapsed;
    updateStats();
    addLogEntry('success', `TELEPORT to ${data.itemName} in ${data.elapsed}ms`);
  });

  window.api.onConnected((data) => {
    connectedQueries.add(data.queryId);
    renderSearchList();
    addLogEntry('success', `Connected: ${data.queryId}`);
  });

  window.api.onDisconnected((data) => {
    connectedQueries.delete(data.queryId);
    renderSearchList();
    addLogEntry('warn', `Disconnected: ${data.queryId}`);
  });

  window.api.onReconnecting((data) => {
    addLogEntry('info', `Reconnecting: ${data.queryId} (attempt ${data.attempt})`);
  });

  window.api.onError((data) => {
    addLogEntry('error', data.error || 'Unknown error');
  });

  window.api.onCookieExpired(() => {
    addLogEntry('error', 'COOKIE EXPIRED! Update your cf_clearance cookie in Settings.');
  });

  window.api.onStatusChange((data) => {
    updateRunningState(data.running);
  });

  window.api.onCookieExtractStatus((data) => {
    if (data.status && loginStatusText) {
      loginStatusText.textContent = data.status;
    }
  });

  window.api.onUpdateStatus((data) => {
    // Reset button visibility and states
    checkUpdateBtn.style.display = 'none';
    downloadUpdateBtn.style.display = 'none';
    installUpdateBtn.style.display = 'none';
    updateBadge.style.display = 'none';
    checkUpdateBtn.classList.remove('has-update');

    switch (data.status) {
      case 'checking':
        updateStatus.textContent = 'Checking...';
        updateStatus.className = 'update-status checking';
        break;
      case 'available':
        availableVersion = data.version;
        updateStatus.textContent = `v${data.version} available`;
        updateStatus.className = 'update-status available';
        downloadUpdateBtn.style.display = 'inline-flex';
        downloadUpdateBtn.disabled = false;
        downloadUpdateBtn.textContent = 'Download';
        // Show notification badge and highlight
        updateBadge.style.display = 'inline-block';
        checkUpdateBtn.classList.add('has-update');
        addLogEntry('info', `Update available: v${data.version}`);
        break;
      case 'downloading':
        updateStatus.textContent = `Downloading: ${data.percent}%`;
        updateStatus.className = 'update-status checking';
        downloadUpdateBtn.style.display = 'inline-flex';
        downloadUpdateBtn.disabled = true;
        downloadUpdateBtn.textContent = `${data.percent}%`;
        break;
      case 'ready':
        updateStatus.textContent = 'Ready to install';
        updateStatus.className = 'update-status available';
        installUpdateBtn.style.display = 'inline-flex';
        // Show notification badge
        updateBadge.style.display = 'inline-block';
        addLogEntry('success', 'Update downloaded! Click "Restart & Install" to update.');
        break;
      case 'up-to-date':
        updateStatus.textContent = 'Up to date';
        updateStatus.className = 'update-status';
        checkUpdateBtn.style.display = 'inline-flex';
        addLogEntry('info', 'You are running the latest version.');
        // Clear the message after 3 seconds
        setTimeout(() => {
          if (updateStatus.textContent === 'Up to date') {
            updateStatus.textContent = '';
          }
        }, 3000);
        break;
      case 'error':
        updateStatus.textContent = '';
        updateStatus.className = 'update-status';
        checkUpdateBtn.style.display = 'inline-flex';
        break;
    }
  });

  // Handle hotkey events from main process
  window.api.onHotkey((data) => {
    if (data.action === 'toggle') {
      if (isRunning) {
        stopSniper();
      } else {
        startSniper();
      }
    }
  });
}

// ========================================
// Start the app
// ========================================

init();
