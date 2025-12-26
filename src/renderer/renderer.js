// DOM Elements
const poesessidInput = document.getElementById('poesessid');
const cfClearanceInput = document.getElementById('cf_clearance');
const leagueSelect = document.getElementById('league');
const soundEnabledCheckbox = document.getElementById('soundEnabled');
const saveConfigBtn = document.getElementById('saveConfigBtn');
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

// State
let config = {};
let isRunning = false;
let isExtractingCookies = false;

// URL parsing regex
const TRADE_URL_REGEX = /trade2\/search\/poe2\/[^/]+\/([a-zA-Z0-9]+)/;

// Initialize
async function init() {
  config = await window.api.getConfig();
  loadConfigToUI();
  renderSearchList();

  const status = await window.api.getStatus();
  updateRunningState(status.running);

  setupEventListeners();
  setupIPCListeners();
}

function loadConfigToUI() {
  poesessidInput.value = config.poesessid || '';
  cfClearanceInput.value = config.cf_clearance || '';
  leagueSelect.value = config.league || 'Fate%20of%20the%20Vaal';
  soundEnabledCheckbox.checked = config.soundEnabled !== false;
}

function getConfigFromUI() {
  return {
    ...config,
    poesessid: poesessidInput.value.trim(),
    cf_clearance: cfClearanceInput.value.trim(),
    league: leagueSelect.value,
    soundEnabled: soundEnabledCheckbox.checked,
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

    return `
      <div class="search-item" data-index="${index}">
        <div class="query-info">
          <span class="query-id">${id}</span>
          ${name ? `<span class="query-name">(${name})</span>` : ''}
        </div>
        <button class="remove-btn" data-index="${index}">&times;</button>
      </div>
    `;
  }).join('');

  // Add remove handlers
  searchList.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
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

  addLogEntry('info', 'Starting sniper...');
  await window.api.startSniper();
}

async function stopSniper() {
  if (!isRunning) return;

  addLogEntry('info', 'Stopping sniper...');
  await window.api.stopSniper();
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
  saveConfigBtn.disabled = running;
  addSearchBtn.disabled = running;
  searchUrlInput.disabled = running;
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

function setupEventListeners() {
  saveConfigBtn.addEventListener('click', saveConfig);
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
    addLogEntry('listing', `NEW: ${data.itemName} @ ${data.price} from ${data.account}`);
  });

  window.api.onTeleport((data) => {
    addLogEntry('success', `TELEPORT to ${data.itemName} in ${data.elapsed}ms`);
  });

  window.api.onConnected((data) => {
    addLogEntry('success', `Connected: ${data.queryId}`);
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
}

// Start the app
init();
