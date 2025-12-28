// ========================================
// Divinge - Renderer
// ========================================

import { initEconomy, fetchEconomyData, onEconomyTabActivated, getFavorites } from './economy.js';
import { playSound, testSound as testSoundEffect } from './sounds.js';

// DOM Elements - Login Overlay
const loginOverlay = document.getElementById('loginOverlay');
const loginStatus = document.getElementById('loginStatus');
const loginStatusText = document.getElementById('loginStatusText');

// DOM Elements - Header
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const stopBtn = document.getElementById('stopBtn');
const statusIndicator = document.getElementById('status-indicator');
const versionBadge = document.getElementById('versionBadge');

// DOM Elements - Settings Tab
const leagueSelect = document.getElementById('league');
const soundEnabledCheckbox = document.getElementById('soundEnabled');
const startMinimizedCheckbox = document.getElementById('startMinimized');
const autoStartCheckbox = document.getElementById('autoStart');
const saveConfigBtn = document.getElementById('saveConfigBtn');
const testSoundBtn = document.getElementById('testSoundBtn');

// DOM Elements - Searches Tab
const urlInputRow = document.getElementById('urlInputRow');
const nameInputRow = document.getElementById('nameInputRow');
const searchUrlInput = document.getElementById('searchUrl');
const searchNameInput = document.getElementById('searchName');
const addSearchBtn = document.getElementById('addSearchBtn');
const confirmSearchBtn = document.getElementById('confirmSearchBtn');
const cancelSearchBtn = document.getElementById('cancelSearchBtn');
const searchList = document.getElementById('searchList');
const searchCount = document.getElementById('searchCount');
const importSearchesBtn = document.getElementById('importSearchesBtn');
const exportSearchesBtn = document.getElementById('exportSearchesBtn');

// Pending search state (for two-step add flow)
let pendingQueryId = null;

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

// Analytics elements
const analyticsSessionDuration = document.getElementById('analyticsSessionDuration');
const analyticsTotalHits = document.getElementById('analyticsTotalHits');
const analyticsHitsPerHour = document.getElementById('analyticsHitsPerHour');
const analyticsTeleports = document.getElementById('analyticsTeleports');
const analyticsSuccessRate = document.getElementById('analyticsSuccessRate');
const hitsBySearchList = document.getElementById('hitsBySearchList');
const activityTimeline = document.getElementById('activityTimeline');

// Tab elements
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

// State
let config = {};
let isRunning = false;
let isPaused = false;
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

// Analytics tracking
let analytics = {
  hitsBySearch: {},      // { queryId: count }
  hitTimeline: [],       // [{ timestamp, queryId, queryName, itemName, price }]
  sessionStart: null,
};

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

  // Update analytics when analytics tab is activated
  if (tabId === 'analytics') {
    updateAnalytics();
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
  soundEnabledCheckbox.checked = config.soundEnabled !== false;
  startMinimizedCheckbox.checked = config.startMinimized === true;
  autoStartCheckbox.checked = config.autoStart === true;
}

function getConfigFromUI() {
  return {
    ...config,
    // poesessid and cf_clearance are now managed by cookie extractor only
    league: leagueSelect.value,
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
    const hitCount = analytics.hitsBySearch[id] || 0;

    return `
      <div class="search-item" data-index="${index}" data-query-id="${id}">
        <div class="query-info">
          <span class="connection-status ${isConnected ? 'connected' : ''}" title="${isConnected ? 'Connected' : 'Disconnected'}"></span>
          ${name
            ? `<span class="query-name">${name}</span><span class="query-id secondary">${id}</span>`
            : `<span class="query-id">${id}</span>`
          }
        </div>
        <div class="search-actions">
          ${hitCount > 0 ? `<span class="hit-count" title="${hitCount} hits this session">${hitCount}</span>` : ''}
          <button class="copy-btn" data-query-id="${id}" title="Copy trade URL">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          <button class="remove-btn" data-index="${index}" ${isRunning ? 'disabled' : ''} title="Remove search">&times;</button>
        </div>
      </div>
    `;
  }).join('');

  // Add copy handlers
  searchList.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const queryId = btn.dataset.queryId;
      const league = config.league || 'Standard';
      const url = `https://www.pathofexile.com/trade2/search/poe2/${league}/${queryId}`;

      try {
        await navigator.clipboard.writeText(url);
        btn.classList.add('copied');
        btn.title = 'Copied!';
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.title = 'Copy trade URL';
        }, 1500);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    });
  });

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

function addSearch() {
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

  // Store pending query and show name input
  pendingQueryId = queryId;
  urlInputRow.classList.add('hidden');
  nameInputRow.classList.remove('hidden');
  searchNameInput.value = queryId; // Default to query ID
  searchNameInput.select();
  searchNameInput.focus();
}

async function confirmSearch() {
  if (!pendingQueryId) return;

  const name = searchNameInput.value.trim();

  // Add to config - use name if different from ID, otherwise just store the ID
  const newQuery = (name && name !== pendingQueryId) ? { id: pendingQueryId, name } : { id: pendingQueryId };
  config.queries = [...(config.queries || []), newQuery];
  await window.api.saveConfig(config);

  renderSearchList();
  addLogEntry('info', `Added search: ${name || pendingQueryId}`);

  // Reset UI
  cancelSearch();
}

function cancelSearch() {
  pendingQueryId = null;
  searchUrlInput.value = '';
  searchNameInput.value = '';
  nameInputRow.classList.add('hidden');
  urlInputRow.classList.remove('hidden');
  searchUrlInput.focus();
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
    addLogEntry('warn', 'No searches to export');
    return;
  }

  const result = await window.api.exportSearches(queries);

  if (result.canceled) {
    return;
  }

  if (result.success) {
    addLogEntry('success', `Exported ${queries.length} search(es) to file`);
  } else {
    addLogEntry('error', `Export failed: ${result.error}`);
  }
}

async function importSearches() {
  const result = await window.api.importSearches();

  if (result.canceled) {
    return;
  }

  if (!result.success) {
    addLogEntry('error', `Import failed: ${result.error}`);
    return;
  }

  const importedSearches = result.searches;
  const existingQueries = config.queries || [];

  // Merge imports - skip duplicates by ID
  const existingIds = new Set(existingQueries.map(q => typeof q === 'string' ? q : q.id));
  let addedCount = 0;
  let skippedCount = 0;

  for (const search of importedSearches) {
    const searchId = typeof search === 'string' ? search : search.id;
    if (!existingIds.has(searchId)) {
      existingQueries.push(search);
      existingIds.add(searchId);
      addedCount++;
    } else {
      skippedCount++;
    }
  }

  config.queries = existingQueries;
  await window.api.saveConfig(config);
  renderSearchList();

  if (skippedCount > 0) {
    addLogEntry('success', `Imported ${addedCount} search(es), skipped ${skippedCount} duplicate(s)`);
  } else {
    addLogEntry('success', `Imported ${addedCount} search(es)`);
  }
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

  // Reset stats and analytics
  stats = { listings: 0, teleports: 0, totalTime: 0, startTime: Date.now() };
  analytics = { hitsBySearch: {}, hitTimeline: [], sessionStart: Date.now() };
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

async function togglePause() {
  if (!isRunning) return;

  const newPausedState = !isPaused;
  const result = await window.api.togglePause(newPausedState);

  if (result.success) {
    updateRunningState(true, newPausedState);
    addLogEntry('info', newPausedState ? 'Sniper paused - monitoring continues, teleports disabled' : 'Sniper resumed - teleports enabled');
  }
}

function updateRunningState(running, paused = false) {
  isRunning = running;
  isPaused = paused;

  startBtn.disabled = running;
  pauseBtn.disabled = !running;
  stopBtn.disabled = !running;

  // Update pause button text and style
  if (running) {
    pauseBtn.innerHTML = paused
      ? '<svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Resume'
      : '<svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg> Pause';
    pauseBtn.classList.toggle('paused', paused);
  }

  // Update status indicator
  const statusText = statusIndicator.querySelector('.status-text');
  if (!running) {
    statusText.textContent = 'Stopped';
    statusIndicator.className = 'status-badge stopped';
  } else if (paused) {
    statusText.textContent = 'Paused';
    statusIndicator.className = 'status-badge paused';
  } else {
    statusText.textContent = 'Running';
    statusIndicator.className = 'status-badge running';
  }

  // Disable config editing while running
  leagueSelect.disabled = running;
  saveConfigBtn.disabled = running;
  addSearchBtn.disabled = running;
  searchUrlInput.disabled = running;
  searchNameInput.disabled = running;
  confirmSearchBtn.disabled = running;
  cancelSearchBtn.disabled = running;
  startMinimizedCheckbox.disabled = running;
  autoStartCheckbox.disabled = running;

  // Cancel any pending search when starting
  if (running && pendingQueryId) {
    cancelSearch();
  }

  if (!running) {
    isPaused = false;
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
// Analytics
// ========================================

function updateAnalytics() {
  // Session duration
  if (stats.startTime) {
    const elapsed = Math.floor((Date.now() - stats.startTime) / 1000);
    const hours = Math.floor(elapsed / 3600);
    const minutes = Math.floor((elapsed % 3600) / 60);
    const seconds = elapsed % 60;
    analyticsSessionDuration.textContent = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  } else {
    analyticsSessionDuration.textContent = '0:00:00';
  }

  // Total hits
  const totalHits = Object.values(analytics.hitsBySearch).reduce((sum, count) => sum + count, 0);
  analyticsTotalHits.textContent = totalHits;

  // Hits per hour
  if (stats.startTime) {
    const hoursElapsed = (Date.now() - stats.startTime) / (1000 * 60 * 60);
    const hitsPerHour = hoursElapsed > 0 ? (totalHits / hoursElapsed).toFixed(1) : '0';
    analyticsHitsPerHour.textContent = hitsPerHour;
  } else {
    analyticsHitsPerHour.textContent = '0';
  }

  // Teleports
  analyticsTeleports.textContent = stats.teleports;

  // Success rate (teleports / hits)
  const successRate = totalHits > 0 ? Math.round((stats.teleports / totalHits) * 100) : 0;
  analyticsSuccessRate.textContent = `${successRate}%`;

  // Hits by search list
  renderHitsBySearch();

  // Activity timeline
  renderActivityTimeline();
}

function renderHitsBySearch() {
  const queries = config.queries || [];
  const hitsEntries = Object.entries(analytics.hitsBySearch)
    .sort((a, b) => b[1] - a[1]); // Sort by hit count descending

  if (hitsEntries.length === 0) {
    hitsBySearchList.innerHTML = '<div class="empty-state-small">No hits recorded yet</div>';
    return;
  }

  // Calculate total for percentages
  const totalHits = hitsEntries.reduce((sum, [, count]) => sum + count, 0);
  const maxHits = hitsEntries[0]?.[1] || 1;

  hitsBySearchList.innerHTML = hitsEntries.map(([queryId, count]) => {
    // Find query name
    const query = queries.find(q => (typeof q === 'string' ? q : q.id) === queryId);
    const name = query && typeof query !== 'string' && query.name ? query.name : queryId;
    const percentage = ((count / totalHits) * 100).toFixed(1);
    const barWidth = (count / maxHits) * 100;

    return `
      <div class="hits-by-search-item">
        <div class="hits-search-info">
          <span class="hits-search-name">${name}</span>
          <span class="hits-search-count">${count} hits (${percentage}%)</span>
        </div>
        <div class="hits-bar-container">
          <div class="hits-bar" style="width: ${barWidth}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderActivityTimeline() {
  // Get hits from last 15 minutes
  const fifteenMinAgo = Date.now() - (15 * 60 * 1000);
  const recentHits = analytics.hitTimeline
    .filter(h => h.timestamp > fifteenMinAgo)
    .slice(-20) // Show last 20 items max
    .reverse(); // Most recent first

  if (recentHits.length === 0) {
    activityTimeline.innerHTML = '<div class="empty-state-small">No recent activity</div>';
    return;
  }

  activityTimeline.innerHTML = recentHits.map(hit => {
    const time = new Date(hit.timestamp).toLocaleTimeString();
    return `
      <div class="timeline-item">
        <span class="timeline-time">${time}</span>
        <span class="timeline-search">${hit.queryName}</span>
        <span class="timeline-item-name">${hit.itemName}</span>
        <span class="timeline-price">${hit.price}</span>
      </div>
    `;
  }).join('');
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

function testSound() {
  testSoundEffect();
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
  importSearchesBtn.addEventListener('click', importSearches);
  exportSearchesBtn.addEventListener('click', exportSearches);

  // Control buttons
  startBtn.addEventListener('click', startSniper);
  pauseBtn.addEventListener('click', togglePause);
  stopBtn.addEventListener('click', stopSniper);

  // Log button
  clearLogBtn.addEventListener('click', clearLog);

  // Update buttons
  checkUpdateBtn.addEventListener('click', checkForUpdates);
  downloadUpdateBtn.addEventListener('click', downloadUpdate);
  installUpdateBtn.addEventListener('click', installUpdate);

  // Enter key handling for search inputs
  searchUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addSearch();
    }
  });
  searchNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      confirmSearch();
    }
  });
  searchNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      cancelSearch();
    }
  });

  // Confirm/Cancel search buttons
  confirmSearchBtn.addEventListener('click', confirmSearch);
  cancelSearchBtn.addEventListener('click', cancelSearch);
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

    // Track analytics
    const queryId = data.queryId;
    if (queryId) {
      // Increment hit count for this search
      analytics.hitsBySearch[queryId] = (analytics.hitsBySearch[queryId] || 0) + 1;

      // Add to timeline
      analytics.hitTimeline.push({
        timestamp: Date.now(),
        queryId: queryId,
        queryName: data.queryName || queryId,
        itemName: data.itemName,
        price: data.price,
        account: data.account
      });

      // Keep timeline to last 24 hours max (prevent memory bloat)
      const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
      analytics.hitTimeline = analytics.hitTimeline.filter(h => h.timestamp > dayAgo);

      // Update search list to show new hit count
      renderSearchList();
    }

    // Play alert sound for new listings
    if (config.soundEnabled) {
      playSound();
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
