// ========================================
// Divinge - Renderer
// ========================================

import { initEconomy, fetchEconomyData, onEconomyTabActivated, getFavorites } from './economy.js';
import { playSound } from './sounds.js';
import { initHistory, loadDiscordSettings } from './history.js';

// DOM Elements - Window Controls
const minimizeBtn = document.getElementById('minimizeBtn');
const maximizeBtn = document.getElementById('maximizeBtn');
const closeBtn = document.getElementById('closeBtn');

// DOM Elements - Login Overlay
const loginOverlay = document.getElementById('loginOverlay');
const loginStatus = document.getElementById('loginStatus');
const loginStatusText = document.getElementById('loginStatusText');

// DOM Elements - Status Bar
const statusIndicator = document.getElementById('status-indicator');
const statusInfo = document.getElementById('statusInfo');

// DOM Elements - Sidebar
const versionBadge = document.getElementById('versionBadge');
const navItems = document.querySelectorAll('.nav-item');

// DOM Elements - Home Tab
const homeStartBtn = document.getElementById('homeStartBtn');
const homePauseAllBtn = document.getElementById('homePauseAllBtn');
const homeStopBtn = document.getElementById('homeStopBtn');
const statListings = document.getElementById('statListings');
const statTeleports = document.getElementById('statTeleports');
const statUptime = document.getElementById('statUptime');
const statSearches = document.getElementById('statSearches');
const logContainer = document.getElementById('logContainer');
const clearLogBtn = document.getElementById('clearLogBtn');

// DOM Elements - Searches Tab
const searchUrlInput = document.getElementById('searchUrl');
const addSearchBtn = document.getElementById('addSearchBtn');
const searchList = document.getElementById('searchList');
const importSearchesBtn = document.getElementById('importSearchesBtn');
const exportSearchesBtn = document.getElementById('exportSearchesBtn');

// DOM Elements - Add Search Modal
const addSearchModal = document.getElementById('addSearchModal');
const searchNameInput = document.getElementById('searchNameInput');
const searchSoundSelect = document.getElementById('searchSoundSelect');
const previewSoundBtn = document.getElementById('previewSoundBtn');
const closeSearchModal = document.getElementById('closeSearchModal');
const cancelSearchModal = document.getElementById('cancelSearchModal');
const confirmSearchModal = document.getElementById('confirmSearchModal');
const pendingQueryId = document.getElementById('pendingQueryId');

// DOM Elements - Settings Tab
const leagueSelect = document.getElementById('league');
const notificationsCheckbox = document.getElementById('notificationsEnabled');
const startMinimizedCheckbox = document.getElementById('startMinimized');
const autoStartCheckbox = document.getElementById('autoStart');

// DOM Elements - Updates
const updateStatus = document.getElementById('updateStatus');
const checkUpdateBtn = document.getElementById('checkUpdateBtn');
const restartUpdateBtn = document.getElementById('restartUpdateBtn');

// Tab panels
const tabPanels = document.querySelectorAll('.tab-panel');

// State
let config = {};
let isRunning = false;
let isPausedAll = false;
let availableVersion = null;
let currentTab = 'home';

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

// Query state tracking (per-query status)
let queryStates = new Map(); // queryId -> { status: 'stopped' | 'running' | 'paused', connected: boolean }

// URL parsing regex
const TRADE_URL_REGEX = /trade2\/search\/poe2\/[^/]+\/([a-zA-Z0-9]+)/;

// ========================================
// Initialization
// ========================================

async function init() {
  config = await window.api.getConfig();

  loadConfigToUI();
  renderSearchList();
  updateSearchCount();

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

  // Initialize trade history module
  initHistory();
  loadDiscordSettings(config);

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
  navItems.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      const navGroup = btn.closest('.nav-group');

      // Toggle expand for nav groups (like Economy)
      if (navGroup) {
        navGroup.classList.toggle('expanded');
      }

      switchTab(tabId);
    });
  });

  // Quick action navigation buttons
  document.querySelectorAll('[data-navigate]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.navigate;
      switchTab(tabId);
    });
  });

  // Subgroup toggles (Currency, League, Uniques)
  document.querySelectorAll('.nav-subgroup-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const subgroup = btn.closest('.nav-subgroup');
      if (subgroup) {
        subgroup.classList.toggle('expanded');
      }
    });
  });
}

function switchTab(tabId) {
  currentTab = tabId;

  // Update nav items
  navItems.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  // Update tab panels
  tabPanels.forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tabId}`);
  });

  // Collapse economy nav-group when switching to other tabs
  const economyNavGroup = document.querySelector('.nav-group');
  if (economyNavGroup && tabId !== 'economy') {
    economyNavGroup.classList.remove('expanded');
  }

  // Fetch economy data when economy tab is activated
  if (tabId === 'economy') {
    onEconomyTabActivated();
  }
}

// ========================================
// Login Flow
// ========================================

async function startLogin() {
  loginOverlay.classList.remove('hidden');
  loginStatusText.textContent = 'Opening browser...';
  loginStatus.className = 'login-status';

  const result = await window.api.extractCookies();

  if (result.success) {
    config = await window.api.getConfig();
    loadConfigToUI();

    loginStatusText.textContent = 'Connected! Loading app...';
    loginStatus.className = 'login-status success';

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
  notificationsCheckbox.checked = config.notificationsEnabled !== false;
  startMinimizedCheckbox.checked = config.startMinimized === true;
  autoStartCheckbox.checked = config.autoStart === true;
}

function getConfigFromUI() {
  return {
    ...config,
    league: leagueSelect.value,
    soundFile: 'notification.mp3',
    notificationsEnabled: notificationsCheckbox.checked,
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

function updateSearchCount() {
  const queries = config.queries || [];
  const searchText = `${queries.length} ${queries.length === 1 ? 'search' : 'searches'}`;
  statSearches.textContent = queries.length;
  if (statusInfo) statusInfo.textContent = searchText;
}

function getStatusTitle(state) {
  if (state.status === 'running' && state.connected) return 'Connected & Running';
  if (state.status === 'running') return 'Connecting...';
  if (state.status === 'paused') return 'Paused';
  return 'Stopped';
}

function renderQueryControls(queryId, state) {
  const { status } = state;
  const isStopped = status === 'stopped';
  const isRunning = status === 'running';
  const isPaused = status === 'paused';

  return `
    <button class="action-btn start" data-action="${isPaused ? 'resume' : 'start'}" data-query-id="${queryId}" title="${isPaused ? 'Resume' : 'Start'}" ${isRunning ? 'disabled' : ''}>
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
    </button>
    <button class="action-btn pause" data-action="pause" data-query-id="${queryId}" title="Pause" ${!isRunning ? 'disabled' : ''}>
      <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
    </button>
    <button class="action-btn stop" data-action="stop" data-query-id="${queryId}" title="Stop" ${isStopped ? 'disabled' : ''}>
      <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"/></svg>
    </button>
  `;
}

function setupQueryControlListeners() {
  // Control buttons (start, pause, stop, resume)
  searchList.querySelectorAll('.action-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const action = e.currentTarget.dataset.action;
      const queryId = e.currentTarget.dataset.queryId;

      switch (action) {
        case 'start':
          addLogEntry('info', `Starting search: ${queryId}`);
          await window.api.startQuery(queryId);
          break;
        case 'stop':
          addLogEntry('info', `Stopping search: ${queryId}`);
          await window.api.stopQuery(queryId);
          break;
        case 'pause':
          addLogEntry('info', `Pausing search: ${queryId}`);
          await window.api.pauseQuery(queryId);
          break;
        case 'resume':
          addLogEntry('info', `Resuming search: ${queryId}`);
          await window.api.resumeQuery(queryId);
          break;
      }
    });
  });

  // Share buttons
  searchList.querySelectorAll('.action-btn.share').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const url = e.currentTarget.dataset.url;
      try {
        await navigator.clipboard.writeText(url);
        addLogEntry('success', 'Trade URL copied to clipboard');
      } catch (err) {
        addLogEntry('error', 'Failed to copy URL');
      }
    });
  });
}

function renderSearchList() {
  const queries = config.queries || [];
  updateSearchCount();

  if (queries.length === 0) {
    searchList.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
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
    const sound = typeof query === 'string' ? 'default' : (query.sound || 'default');
    const state = queryStates.get(id) || { status: 'stopped', connected: false };
    const canRemove = state.status === 'stopped';
    const tradeUrl = `https://www.pathofexile.com/trade2/search/poe2/${config.league || 'Standard'}/${id}`;
    const soundLabel = sound === 'none' ? 'Silent' : (sound === 'default' ? '' : sound.charAt(0).toUpperCase() + sound.slice(1));

    return `
      <div class="search-item" data-index="${index}" data-query-id="${id}">
        <button class="remove-btn" data-index="${index}" data-query-id="${id}" ${!canRemove ? 'disabled' : ''} title="Remove search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <div class="query-bar">
          <span class="connection-status ${state.status} ${state.connected ? 'connected' : ''}" title="${getStatusTitle(state)}"></span>
          <span class="query-id">${id}</span>
          ${name ? `<span class="query-name">${name}</span>` : ''}
          ${soundLabel ? `<span class="query-sound" title="Sound: ${soundLabel}">${soundLabel}</span>` : ''}
        </div>
        <div class="query-actions">
          ${renderQueryControls(id, state)}
          <button class="action-btn share" data-query-id="${id}" data-url="${tradeUrl}" title="Copy trade URL">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Add event listeners for control buttons
  setupQueryControlListeners();

  // Add event listeners for remove buttons
  searchList.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const button = e.currentTarget;
      const queryId = button.dataset.queryId;
      const state = queryStates.get(queryId) || { status: 'stopped' };
      if (state.status !== 'stopped') return;
      const index = parseInt(button.dataset.index);
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

function addSearch() {
  const url = searchUrlInput.value.trim();
  if (!url) return;

  let queryId = parseTradeUrl(url);

  if (!queryId && /^[a-zA-Z0-9]+$/.test(url)) {
    queryId = url;
  }

  if (!queryId) {
    addLogEntry('error', 'Invalid URL or query ID. Paste a trade URL or enter a query ID.');
    return;
  }

  const queries = config.queries || [];
  const exists = queries.some(q => (typeof q === 'string' ? q : q.id) === queryId);
  if (exists) {
    addLogEntry('warn', `Query ${queryId} already exists.`);
    return;
  }

  // Open modal to configure the search
  openAddSearchModal(queryId);
}

function openAddSearchModal(queryId) {
  pendingQueryId.value = queryId;
  searchNameInput.value = '';
  searchSoundSelect.value = 'default';
  addSearchModal.classList.remove('hidden');
  searchNameInput.focus();
}

function closeAddSearchModal() {
  addSearchModal.classList.add('hidden');
  pendingQueryId.value = '';
  searchNameInput.value = '';
  searchSoundSelect.value = 'default';
}

async function confirmAddSearch() {
  const queryId = pendingQueryId.value;
  if (!queryId) return;

  const name = searchNameInput.value.trim() || null;
  const sound = searchSoundSelect.value;

  const queryObj = { id: queryId };
  if (name) queryObj.name = name;
  if (sound && sound !== 'default') queryObj.sound = sound;

  config.queries = [...(config.queries || []), queryObj];
  await window.api.saveConfig(config);

  closeAddSearchModal();
  renderSearchList();
  searchUrlInput.value = '';
  addLogEntry('info', `Added search: ${name || queryId}`);
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

async function exportSearches() {
  const queries = config.queries || [];
  if (queries.length === 0) {
    addLogEntry('warn', 'No searches to export.');
    return;
  }

  const exportData = {
    version: 1,
    league: config.league,
    queries: queries.map(q => typeof q === 'string' ? { id: q } : q)
  };

  const result = await window.api.exportSearches(exportData);
  if (result.success) {
    addLogEntry('success', `Exported ${queries.length} searches to ${result.path}`);
  } else if (result.cancelled) {
    // User cancelled, no message needed
  } else {
    addLogEntry('error', `Export failed: ${result.error}`);
  }
}

async function importSearches() {
  const result = await window.api.importSearches();

  if (result.cancelled) {
    return;
  }

  if (!result.success) {
    addLogEntry('error', `Import failed: ${result.error}`);
    return;
  }

  const data = result.data;
  if (!data || !data.queries || !Array.isArray(data.queries)) {
    addLogEntry('error', 'Invalid import file format.');
    return;
  }

  const existingIds = new Set((config.queries || []).map(q => typeof q === 'string' ? q : q.id));
  let added = 0;
  let skipped = 0;

  for (const query of data.queries) {
    const id = typeof query === 'string' ? query : query.id;
    if (!id) continue;

    if (existingIds.has(id)) {
      skipped++;
      continue;
    }

    config.queries = [...(config.queries || []), query];
    existingIds.add(id);
    added++;
  }

  await window.api.saveConfig(config);
  renderSearchList();

  if (added > 0 && skipped > 0) {
    addLogEntry('success', `Imported ${added} searches (${skipped} duplicates skipped).`);
  } else if (added > 0) {
    addLogEntry('success', `Imported ${added} searches.`);
  } else {
    addLogEntry('warn', `No new searches imported (${skipped} duplicates).`);
  }
}

// ========================================
// Sniper Control
// ========================================

async function startSniper() {
  if (isRunning) return;

  config = getConfigFromUI();
  await window.api.saveConfig(config);

  if (!config.poesessid) {
    addLogEntry('error', 'POESESSID is required. Go to Settings to configure authentication.');
    switchTab('settings');
    return;
  }

  if (!config.queries || config.queries.length === 0) {
    addLogEntry('error', 'Add at least one search before starting.');
    switchTab('searches');
    return;
  }

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

async function togglePauseAll() {
  if (!isRunning) return;

  isPausedAll = !isPausedAll;

  if (isPausedAll) {
    addLogEntry('info', 'Pausing all searches...');
    await window.api.pauseAll();
    homePauseAllBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    homePauseAllBtn.title = 'Resume All';
  } else {
    addLogEntry('info', 'Resuming all searches...');
    await window.api.resumeAll();
    homePauseAllBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
    homePauseAllBtn.title = 'Pause All';
  }
}

function updateMaximizeButton(isMaximized) {
  // Update the maximize button icon based on window state
  const icon = maximizeBtn.querySelector('svg');
  if (isMaximized) {
    // Restore icon (two overlapping rectangles)
    icon.innerHTML = '<rect x="6" y="6" width="12" height="12" rx="1"/><rect x="4" y="4" width="12" height="12" rx="1" fill="none"/>';
  } else {
    // Maximize icon (single rectangle)
    icon.innerHTML = '<rect x="4" y="4" width="16" height="16" rx="1"/>';
  }
}

function updateRunningState(running) {
  isRunning = running;

  homeStartBtn.disabled = running;
  homePauseAllBtn.disabled = !running;
  homeStopBtn.disabled = !running;

  const statusText = statusIndicator.querySelector('.status-text');
  statusText.textContent = running ? 'Running' : 'Stopped';
  statusIndicator.className = `status-indicator ${running ? 'running' : 'stopped'}`;

  // Disable some config editing while running, but allow adding searches
  leagueSelect.disabled = running;
  startMinimizedCheckbox.disabled = running;
  autoStartCheckbox.disabled = running;
  // Note: addSearchBtn and searchUrlInput are NOT disabled - users can add searches while running

  if (!running) {
    stopUptimeTimer();
    connectedQueries.clear();
    queryStates.clear();
    // Reset pause state
    isPausedAll = false;
    homePauseAllBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
    homePauseAllBtn.title = 'Pause All';
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
  const now = new Date();
  const time = now.toLocaleTimeString() + '.' + String(now.getMilliseconds()).padStart(3, '0');
  const formattedMessage = `[${time}] ${message}`;

  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  entry.textContent = formattedMessage;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;

  while (logContainer.children.length > 500) {
    logContainer.removeChild(logContainer.firstChild);
  }
}

function clearLog() {
  logContainer.innerHTML = '';
  addLogEntry('info', 'Log cleared.');
}

// ========================================
// Updates
// ========================================

async function checkForUpdates() {
  checkUpdateBtn.disabled = true;
  checkUpdateBtn.querySelector('span').textContent = 'Checking...';
  updateStatus.textContent = '';

  const result = await window.api.checkForUpdates();

  checkUpdateBtn.disabled = false;
  checkUpdateBtn.querySelector('span').textContent = 'Check for Updates';

  if (result.error) {
    updateStatus.textContent = '';
    addLogEntry('error', `Update check failed: ${result.error}`);
  }
}

function restartToUpdate() {
  restartUpdateBtn.disabled = true;
  restartUpdateBtn.querySelector('span').textContent = 'Restarting...';
  addLogEntry('info', 'Restarting to apply update...');
  window.api.installUpdate();
}

// ========================================
// Event Listeners
// ========================================

function setupEventListeners() {
  // Window controls
  minimizeBtn.addEventListener('click', () => window.api.minimizeWindow());
  maximizeBtn.addEventListener('click', async () => {
    const isMaximized = await window.api.maximizeWindow();
    updateMaximizeButton(isMaximized);
  });
  closeBtn.addEventListener('click', () => window.api.closeWindow());

  // Notifications toggle in status bar
  notificationsCheckbox.addEventListener('change', () => {
    config.notificationsEnabled = notificationsCheckbox.checked;
    window.api.saveConfig(config);
  });

  // Home tab buttons
  homeStartBtn.addEventListener('click', startSniper);
  homePauseAllBtn.addEventListener('click', togglePauseAll);
  homeStopBtn.addEventListener('click', stopSniper);

  // Search buttons
  addSearchBtn.addEventListener('click', addSearch);

  // Log button
  clearLogBtn.addEventListener('click', clearLog);

  // Import/Export buttons
  if (importSearchesBtn) {
    importSearchesBtn.addEventListener('click', importSearches);
  }
  if (exportSearchesBtn) {
    exportSearchesBtn.addEventListener('click', exportSearches);
  }

  // Update buttons
  checkUpdateBtn.addEventListener('click', checkForUpdates);
  restartUpdateBtn.addEventListener('click', restartToUpdate);

  // Settings buttons
  const reloginBtn = document.getElementById('reloginBtn');
  if (reloginBtn) {
    reloginBtn.addEventListener('click', startLogin);
  }

  // Enter key to add search
  searchUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addSearch();
    }
  });

  // Add Search Modal
  closeSearchModal.addEventListener('click', closeAddSearchModal);
  cancelSearchModal.addEventListener('click', closeAddSearchModal);
  confirmSearchModal.addEventListener('click', confirmAddSearch);
  previewSoundBtn.addEventListener('click', () => {
    const sound = searchSoundSelect.value;
    if (sound && sound !== 'none') {
      playSound(sound === 'default' ? 'notification.mp3' : `${sound}.mp3`);
    }
  });

  // Enter key in modal to confirm
  searchNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      confirmAddSearch();
    }
  });

  // Escape key to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !addSearchModal.classList.contains('hidden')) {
      closeAddSearchModal();
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

    if (config.notificationsEnabled) {
      // Find the query's custom sound
      const query = (config.queries || []).find(q =>
        (typeof q === 'string' ? q : q.id) === data.queryId
      );
      const querySound = typeof query === 'object' ? query.sound : null;

      // Use query-specific sound, or default
      if (querySound === 'none') {
        // Silent - no sound for this query
      } else if (querySound && querySound !== 'default') {
        playSound(`${querySound}.mp3`);
      } else {
        playSound('notification.mp3');
      }
    }
  });

  window.api.onTeleport((data) => {
    stats.teleports++;
    stats.totalTime += data.elapsed;
    updateStats();
    addLogEntry('success', `TELEPORT to ${data.itemName} in ${data.elapsed}ms`);
  });

  window.api.onConnected((data) => {
    connectedQueries.add(data.queryId);
    // Update query state
    const state = queryStates.get(data.queryId) || { status: 'running', connected: false };
    state.connected = true;
    queryStates.set(data.queryId, state);
    renderSearchList();
    addLogEntry('success', `Connected: ${data.queryId}`);
  });

  window.api.onDisconnected((data) => {
    connectedQueries.delete(data.queryId);
    // Update query state
    const state = queryStates.get(data.queryId);
    if (state) {
      state.connected = false;
      queryStates.set(data.queryId, state);
    }
    renderSearchList();
    addLogEntry('warn', `Disconnected: ${data.queryId}`);
  });

  window.api.onReconnecting((data) => {
    addLogEntry('info', `Reconnecting: ${data.queryId} (attempt ${data.attempt})`);
  });

  window.api.onQueryStateChange((data) => {
    queryStates.set(data.queryId, {
      status: data.status,
      connected: data.connected ?? queryStates.get(data.queryId)?.connected ?? false
    });
    renderSearchList();
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
    // Reset UI state
    checkUpdateBtn.style.display = 'none';
    restartUpdateBtn.style.display = 'none';

    switch (data.status) {
      case 'checking':
        checkUpdateBtn.style.display = 'flex';
        checkUpdateBtn.disabled = true;
        checkUpdateBtn.querySelector('span').textContent = 'Checking...';
        updateStatus.textContent = '';
        break;
      case 'available':
        availableVersion = data.version;
        updateStatus.textContent = `Downloading v${data.version}...`;
        addLogEntry('info', `Update v${data.version} found, downloading...`);
        // Trigger download since autoDownload is false
        window.api.downloadUpdate().catch(err => {
          addLogEntry('error', `Download failed: ${err.message || err}`);
        });
        break;
      case 'downloading':
        updateStatus.textContent = `Downloading... ${data.percent}%`;
        break;
      case 'ready':
        updateStatus.textContent = `v${data.version} ready`;
        restartUpdateBtn.style.display = 'flex';
        addLogEntry('success', `Update v${data.version} ready! Click "Restart to Update" when ready.`);
        break;
      case 'up-to-date':
        updateStatus.textContent = 'Up to date';
        checkUpdateBtn.style.display = 'flex';
        checkUpdateBtn.disabled = false;
        checkUpdateBtn.querySelector('span').textContent = 'Check for Updates';
        setTimeout(() => {
          if (updateStatus.textContent === 'Up to date') {
            updateStatus.textContent = '';
          }
        }, 3000);
        break;
      case 'error':
        updateStatus.textContent = '';
        checkUpdateBtn.style.display = 'flex';
        checkUpdateBtn.disabled = false;
        checkUpdateBtn.querySelector('span').textContent = 'Check for Updates';
        break;
    }
  });

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
