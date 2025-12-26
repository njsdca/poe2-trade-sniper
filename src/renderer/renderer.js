// DOM Elements
const poesessidInput = document.getElementById('poesessid');
const cfClearanceInput = document.getElementById('cf_clearance');
const leagueSelect = document.getElementById('league');
const alertSoundSelect = document.getElementById('alertSound');
const soundEnabledCheckbox = document.getElementById('soundEnabled');
const startMinimizedCheckbox = document.getElementById('startMinimized');
const autoStartCheckbox = document.getElementById('autoStart');
const saveConfigBtn = document.getElementById('saveConfigBtn');
const testSoundBtn = document.getElementById('testSoundBtn');
const getCookiesBtn = document.getElementById('getCookiesBtn');
const cookieStatus = document.getElementById('cookieStatus');

const searchUrlInput = document.getElementById('searchUrl');
const addSearchBtn = document.getElementById('addSearchBtn');
const searchList = document.getElementById('searchList');

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusIndicator = document.getElementById('status-indicator');

const logContainer = document.getElementById('logContainer');
const clearLogBtn = document.getElementById('clearLogBtn');

const versionBadge = document.getElementById('versionBadge');
const updateStatus = document.getElementById('updateStatus');

// Stats elements
const statListings = document.getElementById('statListings');
const statTeleports = document.getElementById('statTeleports');
const statAvgTime = document.getElementById('statAvgTime');
const statUptime = document.getElementById('statUptime');

// State
let config = {};
let isRunning = false;
let isExtractingCookies = false;

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

// Initialize
async function init() {
  config = await window.api.getConfig();
  loadConfigToUI();
  renderSearchList();

  const status = await window.api.getStatus();
  updateRunningState(status.running);

  // Load version
  const version = await window.api.getAppVersion();
  versionBadge.textContent = `v${version}`;

  setupEventListeners();
  setupIPCListeners();
  setupCollapsibleSections();

  // Auto-start if configured
  if (config.autoStart && config.poesessid && config.queries?.length > 0) {
    setTimeout(() => startSniper(), 1000);
  }
}

function loadConfigToUI() {
  poesessidInput.value = config.poesessid || '';
  cfClearanceInput.value = config.cf_clearance || '';
  leagueSelect.value = config.league || 'Fate%20of%20the%20Vaal';
  alertSoundSelect.value = config.soundFile || 'alert.wav';
  soundEnabledCheckbox.checked = config.soundEnabled !== false;
  startMinimizedCheckbox.checked = config.startMinimized === true;
  autoStartCheckbox.checked = config.autoStart === true;
}

function getConfigFromUI() {
  return {
    ...config,
    poesessid: poesessidInput.value.trim(),
    cf_clearance: cfClearanceInput.value.trim(),
    league: leagueSelect.value,
    soundFile: alertSoundSelect.value,
    soundEnabled: soundEnabledCheckbox.checked,
    startMinimized: startMinimizedCheckbox.checked,
    autoStart: autoStartCheckbox.checked,
  };
}

function renderSearchList() {
  const queries = config.queries || [];

  if (queries.length === 0) {
    searchList.innerHTML = '<div class="empty-list">No searches added. Paste a trade URL above to add one.</div>';
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
        <button class="remove-btn" data-index="${index}" ${isRunning ? 'disabled' : ''}>&times;</button>
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

async function saveConfig() {
  config = getConfigFromUI();
  const success = await window.api.saveConfig(config);

  if (success) {
    addLogEntry('success', 'Settings saved successfully.');
  } else {
    addLogEntry('error', 'Failed to save settings.');
  }
}

async function testSound() {
  await window.api.testSound();
}

async function extractCookies() {
  if (isExtractingCookies) return;

  isExtractingCookies = true;
  getCookiesBtn.disabled = true;
  getCookiesBtn.textContent = 'Extracting...';
  cookieStatus.textContent = 'Launching browser...';
  cookieStatus.className = 'cookie-status extracting';

  addLogEntry('info', 'Opening browser to extract cookies. Please log in if prompted.');

  const result = await window.api.extractCookies();

  isExtractingCookies = false;
  getCookiesBtn.disabled = false;
  getCookiesBtn.textContent = 'Get Cookies from Browser';

  if (result.success) {
    // Reload config and update UI
    config = await window.api.getConfig();
    loadConfigToUI();

    cookieStatus.textContent = 'Cookies extracted!';
    cookieStatus.className = 'cookie-status success';
    addLogEntry('success', 'Cookies extracted and saved successfully!');

    setTimeout(() => {
      cookieStatus.textContent = '';
      cookieStatus.className = 'cookie-status';
    }, 3000);
  } else {
    cookieStatus.textContent = result.error || 'Failed';
    cookieStatus.className = 'cookie-status error';
    addLogEntry('error', `Cookie extraction failed: ${result.error}`);
  }
}

async function startSniper() {
  if (isRunning) return;

  // Save current config first
  config = getConfigFromUI();
  await window.api.saveConfig(config);

  if (!config.poesessid) {
    addLogEntry('error', 'POESESSID is required. Get it from your browser cookies.');
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

  statusIndicator.textContent = running ? 'Running' : 'Stopped';
  statusIndicator.className = `status ${running ? 'running' : 'stopped'}`;

  // Disable config editing while running
  poesessidInput.disabled = running;
  cfClearanceInput.disabled = running;
  leagueSelect.disabled = running;
  alertSoundSelect.disabled = running;
  saveConfigBtn.disabled = running;
  addSearchBtn.disabled = running;
  searchUrlInput.disabled = running;
  getCookiesBtn.disabled = running;
  startMinimizedCheckbox.disabled = running;
  autoStartCheckbox.disabled = running;

  if (!running) {
    stopUptimeTimer();
    connectedQueries.clear();
  }
  renderSearchList();
}

function updateStats() {
  statListings.textContent = stats.listings;
  statTeleports.textContent = stats.teleports;

  if (stats.teleports > 0) {
    const avg = Math.round(stats.totalTime / stats.teleports);
    statAvgTime.textContent = `${avg}ms`;
  } else {
    statAvgTime.textContent = '-';
  }
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

function addLogEntry(level, message) {
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;

  const time = new Date().toLocaleTimeString();
  entry.textContent = `[${time}] ${message}`;

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

function setupCollapsibleSections() {
  document.querySelectorAll('.section-header').forEach(header => {
    header.addEventListener('click', () => {
      const section = header.dataset.section;
      const content = document.getElementById(`${section}Content`);
      const icon = header.querySelector('.collapse-icon');

      if (content.style.display === 'none') {
        content.style.display = 'block';
        icon.textContent = '▼';
      } else {
        content.style.display = 'none';
        icon.textContent = '▶';
      }
    });
  });
}

function setupEventListeners() {
  saveConfigBtn.addEventListener('click', saveConfig);
  testSoundBtn.addEventListener('click', testSound);
  getCookiesBtn.addEventListener('click', extractCookies);
  addSearchBtn.addEventListener('click', addSearch);
  startBtn.addEventListener('click', startSniper);
  stopBtn.addEventListener('click', stopSniper);
  clearLogBtn.addEventListener('click', clearLog);

  // Enter key to add search
  searchUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addSearch();
    }
  });
}

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
    addLogEntry('error', 'COOKIE EXPIRED! Update your cf_clearance cookie.');
  });

  window.api.onStatusChange((data) => {
    updateRunningState(data.running);
  });

  window.api.onCookieExtractStatus((data) => {
    if (data.status) {
      cookieStatus.textContent = data.status;
    }
  });

  window.api.onUpdateStatus((data) => {
    switch (data.status) {
      case 'checking':
        updateStatus.textContent = 'Checking for updates...';
        updateStatus.className = 'update-status checking';
        break;
      case 'available':
        updateStatus.textContent = `Update ${data.version} available!`;
        updateStatus.className = 'update-status available';
        break;
      case 'downloading':
        updateStatus.textContent = `Downloading: ${data.percent}%`;
        updateStatus.className = 'update-status checking';
        break;
      case 'ready':
        updateStatus.textContent = `Update ready - restart to install`;
        updateStatus.className = 'update-status available';
        break;
      case 'up-to-date':
        updateStatus.textContent = '';
        updateStatus.className = 'update-status';
        break;
      case 'error':
        updateStatus.textContent = '';
        updateStatus.className = 'update-status';
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

// Start the app
init();
