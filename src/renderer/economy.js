// ========================================
// Divinge - Economy Module (Optimized)
// ========================================

const API_BASE = 'https://poe2scout.com/api';
const LEAGUE = 'Fate of the Vaal';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const SEARCH_DEBOUNCE = 150; // ms

// Category to API endpoint mapping
const CATEGORY_ENDPOINTS = {
  // Currency types
  currency: 'currency/currency',
  fragments: 'currency/fragments',
  runes: 'currency/runes',
  talismans: 'currency/talismans',
  essences: 'currency/essences',
  soulcores: 'currency/ultimatum',
  expedition: 'currency/expedition',
  omens: 'currency/ritual',
  reliquary: 'currency/vaultkeys',
  breach: 'currency/breach',
  abyss: 'currency/abyss',
  gems: 'currency/uncutgems',
  delirium: 'currency/delirium',
  incursion: 'currency/incursion',
  // Unique types
  'uniques-weapons': 'unique/weapon',
  'uniques-armour': 'unique/armour',
  'uniques-accessories': 'unique/accessory',
  'uniques-flasks': 'unique/flask',
  'uniques-jewels': 'unique/jewel',
};

// State
const state = {
  items: [],
  cache: new Map(), // category -> { data, timestamp }
  favorites: new Set(),
  currentCategory: 'favorites',
  searchQuery: '',
  loading: false,
  priceCurrency: 'exalted',
  divinePrice: 0,
  // Dashboard state
  dashboardLoaded: false,
  dashboardChartRange: '7d',
  currentView: 'dashboard', // 'dashboard' or 'items'
  // Movers filter state
  gainersFilter: 'all',
  losersFilter: 'all',
};

// Category groupings for filters
const CATEGORY_GROUPS = {
  currency: ['currency', 'fragments'],
  league: ['essences', 'runes', 'talismans', 'soulcores', 'omens', 'expedition', 'breach', 'delirium', 'incursion', 'abyss', 'reliquary', 'gems'],
  uniques: ['uniques-weapons', 'uniques-armour', 'uniques-accessories', 'uniques-flasks', 'uniques-jewels'],
};

// DOM Elements (cached)
let elements = null;
let searchTimeout = null;

// ========================================
// Initialization
// ========================================

export function initEconomy(config) {
  if (config.economyFavorites) {
    state.favorites = new Set(config.economyFavorites);
  }

  elements = {
    search: document.getElementById('economySearch'),
    clearSearch: document.getElementById('clearSearchBtn'),
    refresh: document.getElementById('refreshEconomyBtn'),
    loading: document.getElementById('economyLoading'),
    error: document.getElementById('economyError'),
    errorMsg: document.getElementById('economyErrorMsg'),
    retry: document.getElementById('retryEconomyBtn'),
    items: document.getElementById('economyItemsGrid'),
    itemsView: document.getElementById('economyItems'),
    emptyFavorites: document.getElementById('emptyFavorites'),
    categoryNav: document.querySelector('.nav-subitems'),
    favoritesCount: document.getElementById('favoritesCount'),
    divinePrice: document.getElementById('divinePrice'),
    exaltedPrice: document.getElementById('exaltedPrice'),
    priceToggleDiv: document.getElementById('priceToggleDiv'),
    priceToggleEx: document.getElementById('priceToggleEx'),
    // Price modal elements
    priceModal: document.getElementById('priceModal'),
    priceModalIcon: document.getElementById('priceModalIcon'),
    priceModalName: document.getElementById('priceModalName'),
    priceModalPrice: document.getElementById('priceModalPrice'),
    priceModalClose: document.getElementById('priceModalClose'),
    priceChart: document.getElementById('priceChart'),
    chartMinTime: document.getElementById('chartMinTime'),
    chartMaxTime: document.getElementById('chartMaxTime'),
    chartTooltip: document.getElementById('chartTooltip'),
    tooltipPrice: document.getElementById('tooltipPrice'),
    tooltipVolume: document.getElementById('tooltipVolume'),
    tooltipTime: document.getElementById('tooltipTime'),
    chartTimeRange: document.querySelector('.chart-time-range'),
    // Dashboard elements
    dashboard: document.getElementById('economyDashboard'),
    dashDivinePrice: document.getElementById('dashDivinePrice'),
    dashDivineChange: document.getElementById('dashDivineChange'),
    dashExaltedPrice: document.getElementById('dashExaltedPrice'),
    dashExaltedChange: document.getElementById('dashExaltedChange'),
    dashMirrorPrice: document.getElementById('dashMirrorPrice'),
    dashMirrorChange: document.getElementById('dashMirrorChange'),
    dashChaosPrice: document.getElementById('dashChaosPrice'),
    dashChaosChange: document.getElementById('dashChaosChange'),
    dashboardChart: document.getElementById('dashboardChart'),
    topGainers: document.getElementById('topGainers'),
    topLosers: document.getElementById('topLosers'),
    gainersFilter: document.getElementById('gainersFilter'),
    losersFilter: document.getElementById('losersFilter'),
    backToDashboard: document.getElementById('backToDashboard'),
    refreshDashboard: document.getElementById('refreshDashboardBtn'),
    categoryTitle: document.getElementById('categoryTitle'),
    dashChartRangeBtns: document.querySelectorAll('.dashboard-chart-section .range-btn'),
  };

  // Current chart state
  state.currentChartItem = null;
  state.currentTimeRange = 'all';

  setupEventListeners();
  updateFavoritesCount();
}

// ========================================
// Event Listeners
// ========================================

function setupEventListeners() {
  // Category navigation (event delegation)
  elements.categoryNav?.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-subitem');
    if (btn) {
      const category = btn.dataset.category;
      showItemsView(category);
    }
  });

  // Debounced search
  elements.search?.addEventListener('input', (e) => {
    const value = e.target.value;
    elements.clearSearch.style.display = value ? 'flex' : 'none';

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.searchQuery = value;
      renderItems();
    }, SEARCH_DEBOUNCE);
  });

  elements.clearSearch?.addEventListener('click', () => {
    elements.search.value = '';
    state.searchQuery = '';
    elements.clearSearch.style.display = 'none';
    renderItems();
  });

  elements.refresh?.addEventListener('click', () => fetchCategoryData(state.currentCategory, true));
  elements.retry?.addEventListener('click', () => fetchCategoryData(state.currentCategory, true));

  // Price toggle
  elements.priceToggleDiv?.addEventListener('click', () => setPriceCurrency('divine'));
  elements.priceToggleEx?.addEventListener('click', () => setPriceCurrency('exalted'));

  // Price history modal
  elements.priceModalClose?.addEventListener('click', hidePriceHistory);
  elements.priceModal?.addEventListener('click', (e) => {
    if (e.target === elements.priceModal) hidePriceHistory();
  });

  // Time range buttons (item modal)
  elements.chartTimeRange?.addEventListener('click', (e) => {
    const btn = e.target.closest('.time-range-btn');
    if (btn && !btn.disabled) {
      const range = btn.dataset.range;
      setTimeRange(range);
    }
  });

  // Dashboard event listeners
  elements.backToDashboard?.addEventListener('click', showDashboardView);
  elements.refreshDashboard?.addEventListener('click', () => loadDashboard(true));

  // Dashboard chart range buttons
  elements.dashChartRangeBtns?.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return; // Ignore clicks on disabled buttons
      const range = btn.dataset.range;
      setDashboardChartRange(range);
    });
  });

  // Movers filter dropdowns
  elements.gainersFilter?.addEventListener('change', (e) => {
    state.gainersFilter = e.target.value;
    renderTopMovers();
  });

  elements.losersFilter?.addEventListener('change', (e) => {
    state.losersFilter = e.target.value;
    renderTopMovers();
  });
}

// ========================================
// Price Currency Toggle
// ========================================

function setPriceCurrency(currency) {
  state.priceCurrency = currency;
  elements.priceToggleDiv?.classList.toggle('active', currency === 'divine');
  elements.priceToggleEx?.classList.toggle('active', currency === 'exalted');
  renderItems();
}

// ========================================
// Category Management
// ========================================

function setCategory(category) {
  state.currentCategory = category;

  // Update active button
  elements.categoryNav?.querySelectorAll('.nav-subitem').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === category);
  });

  // Fetch if not cached or favorites
  if (category === 'favorites') {
    renderItems();
  } else {
    const cached = state.cache.get(category);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      renderItems();
    } else {
      fetchCategoryData(category);
    }
  }
}

// ========================================
// Data Fetching
// ========================================

export async function fetchEconomyData(force = false) {
  // Initial fetch - get currency for divine price
  await fetchCategoryData('currency', force);
}

async function fetchCategoryData(category, force = false) {
  // Check cache
  if (!force) {
    const cached = state.cache.get(category);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return;
    }
  }

  const endpoint = CATEGORY_ENDPOINTS[category];
  if (!endpoint) {
    console.warn(`Unknown category: ${category}`);
    return;
  }

  showLoading();

  try {
    const url = `${API_BASE}/items/${endpoint}?league=${encodeURIComponent(LEAGUE)}`;
    const result = await window.api.fetchEconomy(url);

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch data');
    }

    const items = processItems(result.data, category);

    // Cache the data
    state.cache.set(category, {
      data: items,
      timestamp: Date.now(),
    });

    // Update main items if currency (for quick stats)
    if (category === 'currency') {
      state.items = items;
      updateQuickStats();
    }

    hideLoading();
    renderItems();
  } catch (err) {
    console.error(`Fetch error (${category}):`, err);
    showError(err.message || `Failed to fetch ${category} data`);
  }
}

// ========================================
// Data Processing
// ========================================

function processItems(data, category) {
  const rawItems = data.items || data || [];
  return rawItems.map(item => ({
    id: item.apiId || item.id || item.text,
    itemId: item.itemId || item.id, // Numeric ID for history API
    name: item.text || item.name || 'Unknown',
    type: item.categoryApiId || category,
    category,
    icon: item.iconUrl || item.icon || null,
    price: item.currentPrice || 0,
    change: calculatePriceChange(item.priceLogs),
    priceLogs: item.priceLogs || [], // Store full price history
  }));
}

function calculatePriceChange(priceLogs) {
  if (!priceLogs || priceLogs.length < 2) return 0;

  const validLogs = priceLogs.filter(log => log?.price !== undefined);
  if (validLogs.length < 2) return 0;

  const newest = validLogs[0].price;
  const oldest = validLogs[validLogs.length - 1].price;
  return oldest > 0 ? ((newest - oldest) / oldest) * 100 : 0;
}

// ========================================
// Quick Stats
// ========================================

function updateQuickStats() {
  const divine = state.items.find(i => i.name.toLowerCase() === 'divine orb');

  if (divine) {
    state.divinePrice = divine.price;
    if (elements.divinePrice) {
      elements.divinePrice.textContent = `${divine.price.toFixed(0)} ex`;
    }
  }
}

// ========================================
// Dashboard View Management
// ========================================

function showDashboardView() {
  state.currentView = 'dashboard';
  elements.dashboard.style.display = 'flex';
  elements.itemsView.style.display = 'none';

  // Clear active category buttons
  elements.categoryNav?.querySelectorAll('.nav-subitem').forEach(btn => {
    btn.classList.remove('active');
  });

  // Re-render chart after layout settles to ensure correct dimensions
  if (state.dashboardLoaded) {
    requestAnimationFrame(() => {
      renderDashboardChart();
    });
  }
}

function showItemsView(category) {
  state.currentView = 'items';
  state.currentCategory = category;

  elements.dashboard.style.display = 'none';
  elements.itemsView.style.display = 'flex';

  // Update active button
  elements.categoryNav?.querySelectorAll('.nav-subitem').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === category);
  });

  // Update category title
  const categoryNames = {
    favorites: 'Favorites',
    currency: 'Currency',
    fragments: 'Fragments',
    runes: 'Runes',
    essences: 'Essences',
    talismans: 'Talismans',
    soulcores: 'Soul Cores',
    omens: 'Omens',
    expedition: 'Expedition',
    breach: 'Breach',
    delirium: 'Delirium',
    incursion: 'Incursion',
    abyss: 'Abyss',
    reliquary: 'Reliquary',
    gems: 'Gems',
    'uniques-weapons': 'Unique Weapons',
    'uniques-armour': 'Unique Armour',
    'uniques-accessories': 'Unique Accessories',
    'uniques-flasks': 'Unique Flasks',
    'uniques-jewels': 'Unique Jewels',
  };
  if (elements.categoryTitle) {
    elements.categoryTitle.textContent = categoryNames[category] || category;
  }

  // Load data
  if (category === 'favorites') {
    renderItems();
  } else {
    const cached = state.cache.get(category);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      renderItems();
    } else {
      fetchCategoryData(category);
    }
  }
}

// ========================================
// Dashboard Loading
// ========================================

async function loadDashboard(force = false) {
  // Fetch currency data for key stats (required)
  if (force || !state.cache.has('currency')) {
    await fetchCategoryData('currency', force);
  }

  // Update stats immediately
  updateDashboardStats();

  // Render chart with initial data
  renderDashboardChart();

  // Initial render of top movers with currency data
  renderTopMovers();

  state.dashboardLoaded = true;

  // Fetch extended history for Divine orb chart (in background)
  fetchDivineExtendedHistory();

  // Fetch additional categories in background for better Top Movers
  fetchAdditionalCategories(force);
}

async function fetchDivineExtendedHistory() {
  if (!state.divineItem?.itemId) {
    console.warn('[Economy] No Divine itemId for extended history');
    return;
  }

  try {
    const result = await window.api.fetchItemHistory(state.divineItem.itemId, 500);

    if (result.success && result.data && result.data.length > 0) {
      // Map the history API response to our expected format
      const extendedLogs = result.data.map(entry => ({
        price: entry.price,
        quantity: entry.quantity || entry.listings || 0,
        time: entry.time || entry.timestamp
      }));

      // Update divine item with extended logs
      state.divineItem = { ...state.divineItem, priceLogs: extendedLogs };

      // Re-render chart with extended data
      renderDashboardChart();
    }
  } catch (err) {
    // Extended history is optional - silently fail
  }
}

async function fetchAdditionalCategories(force = false) {
  const additionalCategories = ['fragments', 'essences', 'runes', 'uniques-weapons', 'uniques-armour'];

  for (const category of additionalCategories) {
    if (force || !state.cache.has(category)) {
      try {
        await fetchCategoryData(category, force);
        // Re-render top movers as new data comes in
        renderTopMovers();
      } catch (err) {
        console.warn(`[Economy] Failed to fetch ${category}:`, err);
      }
    }
  }
}

function updateDashboardStats() {
  const currencyData = state.cache.get('currency')?.data || [];

  // Find key currencies
  const divine = currencyData.find(i => i.name.toLowerCase() === 'divine orb');
  const exalted = currencyData.find(i => i.name.toLowerCase() === 'exalted orb');
  const mirror = currencyData.find(i => i.name.toLowerCase() === 'mirror of kalandra');
  const chaos = currencyData.find(i => i.name.toLowerCase() === 'chaos orb');

  // Update Divine stats
  if (divine) {
    elements.dashDivinePrice.textContent = `${divine.price.toFixed(0)} ex`;
    updateChangeDisplay(elements.dashDivineChange, divine.change);
    updateStatIcon('divine', divine.icon);
    // Store divine item for chart
    state.divineItem = divine;
  }

  // Update Exalted stats (should be ~1 ex but show it)
  if (exalted) {
    elements.dashExaltedPrice.textContent = `${exalted.price.toFixed(2)} ex`;
    updateChangeDisplay(elements.dashExaltedChange, exalted.change);
    updateStatIcon('exalt', exalted.icon);
  }

  // Update Mirror stats
  if (mirror) {
    elements.dashMirrorPrice.textContent = mirror.price >= 1000
      ? `${(mirror.price / 1000).toFixed(1)}k ex`
      : `${mirror.price.toFixed(0)} ex`;
    updateChangeDisplay(elements.dashMirrorChange, mirror.change);
    updateStatIcon('mirror', mirror.icon);
  }

  // Update Chaos stats
  if (chaos) {
    elements.dashChaosPrice.textContent = `${chaos.price.toFixed(3)} ex`;
    updateChangeDisplay(elements.dashChaosChange, chaos.change);
    updateStatIcon('chaos', chaos.icon);
  }
}

function updateStatIcon(className, iconUrl) {
  if (!iconUrl) return;
  const iconContainer = document.querySelector(`.dash-stat-icon.${className} img`);
  if (iconContainer) {
    iconContainer.src = iconUrl;
  }
}

function updateChangeDisplay(element, change) {
  if (!element) return;

  if (Math.abs(change) < 0.5) {
    element.textContent = '0%';
    element.className = 'dash-stat-change';
  } else {
    const sign = change > 0 ? '+' : '';
    element.textContent = `${sign}${change.toFixed(1)}%`;
    element.className = `dash-stat-change ${change > 0 ? 'up' : 'down'}`;
  }
}

// ========================================
// Dashboard Chart
// ========================================

function setDashboardChartRange(range) {
  state.dashboardChartRange = range;

  // Update active button
  elements.dashChartRangeBtns?.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.range === range);
  });

  renderDashboardChart();
}

function updateDashboardChartButtons(priceLogs) {
  if (!elements.dashChartRangeBtns || !priceLogs) return;

  // Calculate data span in hours
  const validLogs = priceLogs.filter(log => log && log.time);
  if (validLogs.length < 2) return;

  const sortedLogs = [...validLogs].sort((a, b) => new Date(a.time) - new Date(b.time));
  const oldestTime = new Date(sortedLogs[0].time);
  const newestTime = new Date(sortedLogs[sortedLogs.length - 1].time);
  const spanHours = (newestTime - oldestTime) / (1000 * 60 * 60);

  elements.dashChartRangeBtns.forEach(btn => {
    const range = btn.dataset.range;
    let requiredHours = 0;

    if (range === '24h') requiredHours = 12; // Enable if at least 12h of data
    else if (range === '7d') requiredHours = 48; // Enable if at least 2 days
    else if (range === '30d') requiredHours = 168; // Enable if at least 1 week

    const hasEnoughData = spanHours >= requiredHours;
    btn.disabled = !hasEnoughData;
    btn.title = hasEnoughData ? '' : `Not enough data (${Math.round(spanHours)}h available)`;
  });
}

function renderDashboardChart() {
  // Re-query element in case it wasn't available during init
  const container = elements.dashboardChart || document.getElementById('dashboardChart');
  if (!container) {
    console.warn('[Economy] Dashboard chart container not found');
    return;
  }
  elements.dashboardChart = container; // Cache for future use

  const divine = state.divineItem;
  if (!divine) {
    container.innerHTML = '<div class="chart-empty">Divine orb data not loaded</div>';
    return;
  }

  if (!divine.priceLogs || divine.priceLogs.length === 0) {
    container.innerHTML = '<div class="chart-empty">No price history available</div>';
    return;
  }

  // Update time range button states based on available data
  updateDashboardChartButtons(divine.priceLogs);

  try {
    // Filter logs based on range and ensure valid price data
    let priceLogs = divine.priceLogs.filter(log => log && typeof log.price === 'number' && !isNaN(log.price));
    const range = state.dashboardChartRange;

    if (range !== 'all') {
      const hours = range === '24h' ? 24 : range === '7d' ? 168 : 720;
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - hours);
      priceLogs = priceLogs.filter(log => new Date(log.time) >= cutoffTime);
    }

    if (priceLogs.length < 2) {
      container.innerHTML = '<div class="chart-empty">Not enough data for selected range</div>';
      return;
    }

    // Sort oldest first
    const sortedLogs = [...priceLogs].sort((a, b) => new Date(a.time) - new Date(b.time));

    // Chart dimensions - ensure we have a valid width
    const containerWidth = container.clientWidth || container.offsetWidth || 600;
    const width = Math.max(containerWidth, 300);
    const height = 140;
    const padding = { top: 15, right: 45, bottom: 25, left: 10 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Get price range with safety checks
    const prices = sortedLogs.map(l => l.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = (maxPrice - minPrice) || (minPrice * 0.1) || 1;
    const paddedMin = minPrice - priceRange * 0.1;
    const paddedMax = maxPrice + priceRange * 0.1;
    const paddedRange = paddedMax - paddedMin || 1;

    // Calculate points
    const divisor = sortedLogs.length > 1 ? sortedLogs.length - 1 : 1;
    const points = sortedLogs.map((log, i) => {
      const x = padding.left + (i / divisor) * chartWidth;
      const y = padding.top + chartHeight - ((log.price - paddedMin) / paddedRange) * chartHeight;
      return { x: isNaN(x) ? 0 : x, y: isNaN(y) ? 0 : y, price: log.price, time: log.time };
    });

    // Build smooth path
    let linePath = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for (let i = 1; i < points.length; i++) {
      linePath += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
    }

    // Area path
    const bottomY = padding.top + chartHeight;
    let areaPath = linePath;
    areaPath += ` L ${points[points.length - 1].x.toFixed(2)} ${bottomY}`;
    areaPath += ` L ${points[0].x.toFixed(2)} ${bottomY} Z`;

    // Time labels
    const firstDate = new Date(sortedLogs[0].time);
    const lastDate = new Date(sortedLogs[sortedLogs.length - 1].time);

    // Determine trend
    const firstPrice = sortedLogs[0].price;
    const lastPrice = sortedLogs[sortedLogs.length - 1].price;
    const isUp = lastPrice >= firstPrice;
    const trendColor = isUp ? '#4ade80' : '#f87171';

    container.innerHTML = `
    <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="dashGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color: ${trendColor}; stop-opacity: 0.3"/>
          <stop offset="100%" style="stop-color: ${trendColor}; stop-opacity: 0.02"/>
        </linearGradient>
      </defs>

      <!-- Grid lines -->
      <line class="dash-grid-line" x1="${padding.left}" y1="${padding.top}" x2="${width - padding.right}" y2="${padding.top}" stroke="#2a2a2a"/>
      <line class="dash-grid-line" x1="${padding.left}" y1="${padding.top + chartHeight/2}" x2="${width - padding.right}" y2="${padding.top + chartHeight/2}" stroke="#2a2a2a"/>
      <line class="dash-grid-line" x1="${padding.left}" y1="${padding.top + chartHeight}" x2="${width - padding.right}" y2="${padding.top + chartHeight}" stroke="#2a2a2a"/>

      <!-- Price labels -->
      <text x="${width - padding.right + 5}" y="${padding.top + 4}" fill="#8b8b8b" font-size="11">${formatPrice(paddedMax)}</text>
      <text x="${width - padding.right + 5}" y="${padding.top + chartHeight/2 + 4}" fill="#8b8b8b" font-size="11">${formatPrice((paddedMax + paddedMin) / 2)}</text>
      <text x="${width - padding.right + 5}" y="${padding.top + chartHeight + 4}" fill="#8b8b8b" font-size="11">${formatPrice(paddedMin)}</text>

      <!-- Area fill -->
      <path d="${areaPath}" fill="url(#dashGradient)"/>

      <!-- Line -->
      <path d="${linePath}" fill="none" stroke="${trendColor}" stroke-width="2"/>

      <!-- Time labels -->
      <text x="${padding.left}" y="${height - 5}" fill="#8b8b8b" font-size="11">${formatDateLabel(firstDate)}</text>
      <text x="${width - padding.right}" y="${height - 5}" fill="#8b8b8b" font-size="11" text-anchor="end">${formatDateLabel(lastDate)}</text>
    </svg>
  `;
  } catch (err) {
    console.error('[Economy] Chart render error:', err);
    container.innerHTML = '<div class="chart-empty">Error rendering chart</div>';
  }
}

function formatDateLabel(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffHours < 1) return 'Now';
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ========================================
// Top Movers
// ========================================

function renderTopMovers() {
  // Re-query elements in case they weren't available during init
  const gainersContainer = elements.topGainers || document.getElementById('topGainers');
  const losersContainer = elements.topLosers || document.getElementById('topLosers');

  if (gainersContainer) elements.topGainers = gainersContainer;
  if (losersContainer) elements.topLosers = losersContainer;

  // Collect items from all cached categories
  const allItems = [];
  for (const [category, cached] of state.cache) {
    if (cached.data) {
      allItems.push(...cached.data);
    }
  }

  // Filter items with any measurable price change (lower threshold)
  const movers = allItems.filter(item => Math.abs(item.change) > 0.5);

  // Calculate weighted score for each mover
  // This weights by absolute exalted value change, not just percentage
  // Formula: price * |change| / (100 + |change|) gives us approximate absolute gain/loss in exalted
  const withWeightedScore = movers.map(item => ({
    ...item,
    weightedScore: item.price * Math.abs(item.change) / (100 + Math.abs(item.change))
  }));

  // Apply category filter for gainers - sort by weighted score
  const filteredGainers = filterByCategory(withWeightedScore, state.gainersFilter);
  const gainers = filteredGainers
    .filter(i => i.change > 0)
    .sort((a, b) => b.weightedScore - a.weightedScore)
    .slice(0, 4);

  // Apply category filter for losers - sort by weighted score
  const filteredLosers = filterByCategory(withWeightedScore, state.losersFilter);
  const losers = filteredLosers
    .filter(i => i.change < 0)
    .sort((a, b) => b.weightedScore - a.weightedScore)
    .slice(0, 4);

  // Render gainers
  if (gainersContainer) {
    gainersContainer.innerHTML = gainers.length > 0
      ? gainers.map(item => createMoverItem(item)).join('')
      : '<div class="mover-empty">No significant price changes</div>';
  } else {
    console.warn('[Economy] Top gainers container not found');
  }

  // Render losers
  if (losersContainer) {
    losersContainer.innerHTML = losers.length > 0
      ? losers.map(item => createMoverItem(item)).join('')
      : '<div class="mover-empty">No significant price changes</div>';
  } else {
    console.warn('[Economy] Top losers container not found');
  }
}

function filterByCategory(items, filter) {
  if (filter === 'all') return items;

  const allowedCategories = CATEGORY_GROUPS[filter] || [];
  return items.filter(item => allowedCategories.includes(item.category));
}

function createMoverItem(item) {
  const changeClass = item.change > 0 ? 'up' : 'down';
  const changeSign = item.change > 0 ? '+' : '';

  return `
    <div class="mover-item">
      <div class="mover-icon">
        ${item.icon ? `<img src="${item.icon}" alt="" loading="lazy">` : ''}
      </div>
      <div class="mover-info">
        <span class="mover-name">${escapeHtml(item.name)}</span>
        <span class="mover-price">${formatPrice(item.price)} ex</span>
      </div>
      <span class="mover-change ${changeClass}">${changeSign}${item.change.toFixed(1)}%</span>
    </div>
  `;
}

// ========================================
// Favorites
// ========================================

export function toggleFavorite(itemId) {
  state.favorites.has(itemId)
    ? state.favorites.delete(itemId)
    : state.favorites.add(itemId);

  updateFavoritesCount();
  renderItems();
  return Array.from(state.favorites);
}

function updateFavoritesCount() {
  if (elements.favoritesCount) {
    elements.favoritesCount.textContent = state.favorites.size;
  }
}

export function getFavorites() {
  return Array.from(state.favorites);
}

// ========================================
// Rendering (Optimized with DocumentFragment)
// ========================================

function renderItems() {
  const container = elements.items;
  if (!container) return;

  const category = state.currentCategory;
  const search = state.searchQuery.toLowerCase();

  // Get items
  let items = category === 'favorites'
    ? getFavoriteItems()
    : (state.cache.get(category)?.data || []);

  // Filter by search
  if (search) {
    items = items.filter(item =>
      item.name.toLowerCase().includes(search) ||
      item.type.toLowerCase().includes(search)
    );
  }

  // Handle empty states
  if (category === 'favorites' && items.length === 0 && !search) {
    container.innerHTML = '';
    elements.emptyFavorites.style.display = 'flex';
    return;
  }
  elements.emptyFavorites.style.display = 'none';

  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-favorites">
        <p>No items found</p>
        <span>${search ? 'Try a different search term' : 'Select a category to load items'}</span>
      </div>
    `;
    return;
  }

  // Update items map for price history lookup
  updateItemsMap(items);

  // Render using DocumentFragment for performance
  const fragment = document.createDocumentFragment();

  items.forEach(item => {
    const card = createItemCard(item);
    fragment.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(fragment);

  // Event delegation for favorites and price history
  container.onclick = (e) => {
    const btn = e.target.closest('.favorite-btn');
    if (btn) {
      e.stopPropagation();
      const newFavorites = toggleFavorite(btn.dataset.itemId);
      window.dispatchEvent(new CustomEvent('economy-favorites-changed', {
        detail: { favorites: newFavorites }
      }));
      return;
    }

    // Click on item card shows price history
    const card = e.target.closest('.item-card');
    if (card) {
      const itemId = card.dataset.itemId;
      const item = itemsMap.get(itemId);
      if (item && item.priceLogs?.length > 0) {
        showPriceHistory(item);
      }
    }
  };
}

function getFavoriteItems() {
  const items = [];
  const seen = new Set();

  // Collect from all cached categories
  for (const [, cached] of state.cache) {
    for (const item of cached.data) {
      if (state.favorites.has(item.id) && !seen.has(item.id)) {
        items.push(item);
        seen.add(item.id);
      }
    }
  }

  return items;
}

function createItemCard(item) {
  const card = document.createElement('div');
  card.className = 'item-card';
  card.dataset.itemId = item.id;

  const isFavorite = state.favorites.has(item.id);

  // Price conversion
  let displayPrice = item.price;
  let suffix = 'ex';

  if (state.priceCurrency === 'divine' && state.divinePrice > 0) {
    displayPrice = item.price / state.divinePrice;
    suffix = 'div';
  }

  const priceStr = displayPrice > 0
    ? `${displayPrice.toFixed(displayPrice < 1 ? 3 : displayPrice < 10 ? 2 : 0)}${suffix}`
    : '--';

  const changeClass = item.change > 0.5 ? 'up' : item.change < -0.5 ? 'down' : '';
  const changeStr = Math.abs(item.change) > 0.5
    ? `${item.change > 0 ? '+' : ''}${item.change.toFixed(1)}%`
    : '';

  card.innerHTML = `
    <div class="item-icon">
      ${item.icon ? `<img src="${item.icon}" alt="" loading="lazy">` : ''}
    </div>
    <div class="item-details">
      <div class="item-header">
        <span class="item-name">${escapeHtml(item.name)}</span>
        <button class="favorite-btn ${isFavorite ? 'active' : ''}" data-item-id="${item.id}">
          <svg viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
        </button>
      </div>
      <div class="item-pricing">
        <span class="item-price">${priceStr}</span>
        ${changeStr ? `<span class="item-change ${changeClass}">${changeStr}</span>` : ''}
      </div>
    </div>
  `;

  return card;
}

// ========================================
// UI States
// ========================================

function showLoading() {
  state.loading = true;
  // Only show loading state when in items view
  if (state.currentView !== 'items') return;
  if (elements.loading) elements.loading.style.display = 'flex';
  if (elements.error) elements.error.style.display = 'none';
  if (elements.items) elements.items.style.display = 'none';
  if (elements.emptyFavorites) elements.emptyFavorites.style.display = 'none';
}

function hideLoading() {
  state.loading = false;
  // Only update when in items view
  if (state.currentView !== 'items') return;
  if (elements.loading) elements.loading.style.display = 'none';
  if (elements.items) elements.items.style.display = 'grid';
}

function showError(message) {
  state.loading = false;
  // Only show error state when in items view
  if (state.currentView !== 'items') return;
  if (elements.loading) elements.loading.style.display = 'none';
  if (elements.error) elements.error.style.display = 'flex';
  if (elements.errorMsg) elements.errorMsg.textContent = message;
  if (elements.items) elements.items.style.display = 'none';
}

// ========================================
// Utilities
// ========================================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========================================
// Price History Chart
// ========================================

async function showPriceHistory(item) {
  if (!item.priceLogs || item.priceLogs.length === 0) {
    return; // No price history available
  }

  // Store current item for time range filtering
  state.currentChartItem = item;
  state.currentTimeRange = 'all';

  // Update modal header
  elements.priceModalIcon.src = item.icon || '';
  elements.priceModalName.textContent = item.name;

  // Format current price
  let displayPrice = item.price;
  let suffix = 'ex';
  if (state.priceCurrency === 'divine' && state.divinePrice > 0) {
    displayPrice = item.price / state.divinePrice;
    suffix = 'div';
  }
  const priceStr = displayPrice > 0
    ? `${formatPrice(displayPrice)} ${suffix}`
    : '--';
  elements.priceModalPrice.textContent = priceStr;

  // Show modal immediately with loading state
  elements.priceModal.classList.remove('hidden');

  // Show loading in chart area
  elements.priceChart.innerHTML = `
    <text x="300" y="140" text-anchor="middle" fill="#8b8b8b" font-size="14">Loading extended history...</text>
  `;
  elements.chartMinTime.textContent = '';
  elements.chartMaxTime.textContent = '';

  // Try to fetch extended history using the history API
  let priceLogs = item.priceLogs;

  if (item.itemId) {
    try {
      const result = await window.api.fetchItemHistory(item.itemId, 500);
      if (result.success && result.data && result.data.length > 0) {
        // Map the history API response to our expected format
        priceLogs = result.data.map(entry => ({
          price: entry.price,
          quantity: entry.quantity || entry.listings || 0,
          time: entry.time || entry.timestamp
        }));
        // Update stored item with extended logs for time range filtering
        state.currentChartItem = { ...item, priceLogs };
      }
    } catch (err) {
      console.warn('Failed to fetch extended history, using default:', err);
    }
  }

  // Update time range buttons based on available data
  updateTimeRangeButtons(priceLogs);

  // Render the chart with extended data
  renderPriceChart(priceLogs);
}

function updateTimeRangeButtons(priceLogs) {
  const buttons = elements.chartTimeRange?.querySelectorAll('.time-range-btn');
  if (!buttons) return;

  // Calculate data span in days
  const sortedLogs = [...priceLogs].sort((a, b) => new Date(a.time) - new Date(b.time));
  const oldestTime = new Date(sortedLogs[0]?.time || Date.now());
  const newestTime = new Date(sortedLogs[sortedLogs.length - 1]?.time || Date.now());
  const spanDays = (newestTime - oldestTime) / (1000 * 60 * 60 * 24);

  buttons.forEach(btn => {
    const range = btn.dataset.range;
    btn.classList.remove('active');

    if (range === 'all') {
      btn.classList.add('active');
      btn.disabled = false;
    } else {
      const rangeDays = parseInt(range);
      // Disable if we don't have enough data for this range
      btn.disabled = spanDays < rangeDays * 0.5; // Allow if we have at least half the range
    }
  });
}

function setTimeRange(range) {
  if (!state.currentChartItem) return;

  state.currentTimeRange = range;

  // Update active button
  const buttons = elements.chartTimeRange?.querySelectorAll('.time-range-btn');
  buttons?.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.range === range);
  });

  // Filter data based on range
  const filteredLogs = filterLogsByRange(state.currentChartItem.priceLogs, range);

  // Re-render chart
  renderPriceChart(filteredLogs);
}

function filterLogsByRange(priceLogs, range) {
  if (range === 'all') return priceLogs;

  const days = parseInt(range);
  const cutoffTime = new Date();
  cutoffTime.setDate(cutoffTime.getDate() - days);

  return priceLogs.filter(log => new Date(log.time) >= cutoffTime);
}

function hidePriceHistory() {
  elements.priceModal.classList.add('hidden');
}

function formatPrice(price) {
  if (price >= 1000000) return (price / 1000000).toFixed(2) + 'M';
  if (price >= 1000) return (price / 1000).toFixed(1) + 'k';
  if (price >= 100) return price.toFixed(0);
  if (price >= 10) return price.toFixed(1);
  return price.toFixed(2);
}

function renderPriceChart(priceLogs) {
  const svg = elements.priceChart;
  const width = 600;
  const height = 280;
  const padding = { top: 20, right: 55, bottom: 10, left: 10 };
  const priceChartHeight = 180;
  const volumeChartHeight = 60;
  const separatorY = padding.top + priceChartHeight;

  // Sort by time (oldest first for proper line drawing)
  const sortedLogs = [...priceLogs].sort((a, b) => new Date(a.time) - new Date(b.time));

  if (sortedLogs.length === 0) return;

  // Get price range
  const prices = sortedLogs.map(l => l.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;

  // Add padding to price range
  const paddedMin = minPrice - priceRange * 0.1;
  const paddedMax = maxPrice + priceRange * 0.1;
  const paddedRange = paddedMax - paddedMin;

  // Get volume range
  const volumes = sortedLogs.map(l => l.quantity || 0);
  const maxVolume = Math.max(...volumes) || 1;

  // Calculate chart dimensions
  const chartWidth = width - padding.left - padding.right;
  const barWidth = chartWidth / sortedLogs.length * 0.7;
  const barGap = chartWidth / sortedLogs.length * 0.15;

  // Calculate points for price chart
  const points = sortedLogs.map((log, i) => {
    const x = padding.left + (i / (sortedLogs.length - 1 || 1)) * chartWidth;
    const y = padding.top + priceChartHeight - ((log.price - paddedMin) / paddedRange) * priceChartHeight;
    return { x, y, price: log.price, time: log.time, volume: log.quantity || 0, index: i };
  });

  // Build step-line path (horizontal then vertical, like trading charts)
  let stepPath = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    // Horizontal line to next x position, then vertical to new y
    stepPath += ` H ${points[i].x} V ${points[i].y}`;
  }

  // Build area path for step chart
  let stepAreaPath = stepPath;
  stepAreaPath += ` V ${separatorY} H ${points[0].x} Z`;

  // Grid lines for price (3 lines)
  const priceGridLines = [0.25, 0.5, 0.75].map(pct => {
    const y = padding.top + priceChartHeight * (1 - pct);
    const price = paddedMin + paddedRange * pct;
    return { y, price };
  });

  // Volume bars
  const volumeBars = sortedLogs.map((log, i) => {
    const barX = padding.left + (i / sortedLogs.length) * chartWidth + barGap;
    const barHeight = ((log.quantity || 0) / maxVolume) * (volumeChartHeight - 10);
    const barY = separatorY + volumeChartHeight - barHeight;
    return { x: barX, y: barY, width: barWidth, height: barHeight, volume: log.quantity || 0, time: log.time, price: log.price, index: i };
  });

  svg.innerHTML = `
    <defs>
      <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" style="stop-color: #c9aa71; stop-opacity: 0.3"/>
        <stop offset="100%" style="stop-color: #c9aa71; stop-opacity: 0.05"/>
      </linearGradient>
      <linearGradient id="volumeGradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" style="stop-color: #5a8f5a; stop-opacity: 0.6"/>
        <stop offset="100%" style="stop-color: #5a8f5a; stop-opacity: 0.2"/>
      </linearGradient>
    </defs>

    <!-- Price section grid lines -->
    ${priceGridLines.map(g => `
      <line class="chart-grid-line" x1="${padding.left}" y1="${g.y}" x2="${width - padding.right}" y2="${g.y}"/>
      <text class="chart-price-label" x="${width - padding.right + 5}" y="${g.y + 3}">${formatPrice(g.price)}</text>
    `).join('')}

    <!-- Separator line between price and volume -->
    <line class="chart-separator" x1="${padding.left}" y1="${separatorY}" x2="${width - padding.right}" y2="${separatorY}"/>

    <!-- Price area fill -->
    <path class="chart-area" d="${stepAreaPath}"/>

    <!-- Step line for price -->
    <path class="chart-step-line" d="${stepPath}"/>

    <!-- Volume bars -->
    ${volumeBars.map(b => `
      <rect class="chart-volume-bar" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="2"
        data-index="${b.index}" fill="url(#volumeGradient)"/>
    `).join('')}

    <!-- Data points (on top for interaction) -->
    ${points.map(p => `
      <circle class="chart-dot" cx="${p.x}" cy="${p.y}" r="4" data-index="${p.index}"/>
    `).join('')}

    <!-- Hit areas for better hover detection -->
    ${points.map(p => `
      <circle class="chart-hit-area" cx="${p.x}" cy="${p.y}" r="15" data-index="${p.index}"/>
    `).join('')}

    <!-- Min/Max price labels -->
    <text class="chart-price-label" x="${width - padding.right + 5}" y="${padding.top + 3}">${formatPrice(paddedMax)}</text>
    <text class="chart-price-label" x="${width - padding.right + 5}" y="${separatorY - 5}">${formatPrice(paddedMin)}</text>

    <!-- Volume label -->
    <text class="chart-volume-label" x="${width - padding.right + 5}" y="${separatorY + 15}">Vol</text>
  `;

  // Store chart data for tooltip
  svg._chartData = { points, volumeBars, sortedLogs };

  // Add hover event listeners
  setupChartTooltip(svg);

  // Update time labels
  const oldestTime = new Date(sortedLogs[0].time);
  const newestTime = new Date(sortedLogs[sortedLogs.length - 1].time);

  elements.chartMinTime.textContent = formatTimeLabel(oldestTime);
  elements.chartMaxTime.textContent = formatTimeLabel(newestTime);
}

function setupChartTooltip(svg) {
  const tooltip = elements.chartTooltip;
  const chartData = svg._chartData;

  if (!chartData) return;

  svg.addEventListener('mousemove', (e) => {
    const target = e.target;
    const index = target.dataset?.index;

    if (index !== undefined) {
      const i = parseInt(index);
      const log = chartData.sortedLogs[i];

      if (log) {
        // Update tooltip content
        let displayPrice = log.price;
        let suffix = 'ex';
        if (state.priceCurrency === 'divine' && state.divinePrice > 0) {
          displayPrice = log.price / state.divinePrice;
          suffix = 'div';
        }

        elements.tooltipPrice.textContent = `${formatPrice(displayPrice)} ${suffix}`;
        elements.tooltipVolume.textContent = `${(log.quantity || 0).toLocaleString()} listings`;
        elements.tooltipTime.textContent = formatTooltipTime(new Date(log.time));

        // Position tooltip
        const rect = svg.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        tooltip.style.left = `${Math.min(x + 10, rect.width - 140)}px`;
        tooltip.style.top = `${Math.max(y - 70, 10)}px`;
        tooltip.classList.remove('hidden');
      }
    }
  });

  svg.addEventListener('mouseleave', () => {
    tooltip.classList.add('hidden');
  });
}

function formatTooltipTime(date) {
  const options = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return date.toLocaleDateString('en-US', options);
}

function formatTimeLabel(date) {
  const now = new Date();
  const diffHours = Math.round((now - date) / (1000 * 60 * 60));

  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays} days ago`;
}

// Store items map for click lookup
let itemsMap = new Map();

function updateItemsMap(items) {
  itemsMap.clear();
  items.forEach(item => itemsMap.set(item.id, item));
}

// ========================================
// Public API
// ========================================

export function onEconomyTabActivated() {
  // Always show dashboard when Economy tab is activated
  if (state.currentView !== 'dashboard') {
    showDashboardView();
  }

  // Load dashboard data if not loaded
  if (!state.dashboardLoaded) {
    loadDashboard();
  }
}
