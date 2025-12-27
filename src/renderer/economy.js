// ========================================
// Divinedge - Economy Module (Optimized)
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
    items: document.getElementById('economyItems'),
    emptyFavorites: document.getElementById('emptyFavorites'),
    categoryNav: document.querySelector('.category-nav'),
    favoritesCount: document.getElementById('favoritesCount'),
    divinePrice: document.getElementById('divinePrice'),
    exaltedPrice: document.getElementById('exaltedPrice'),
    priceToggleDiv: document.getElementById('priceToggleDiv'),
    priceToggleEx: document.getElementById('priceToggleEx'),
  };

  setupEventListeners();
  updateFavoritesCount();
}

// ========================================
// Event Listeners
// ========================================

function setupEventListeners() {
  // Category navigation (event delegation)
  elements.categoryNav?.addEventListener('click', (e) => {
    const btn = e.target.closest('.category-btn');
    if (btn) {
      setCategory(btn.dataset.category);
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
  elements.categoryNav?.querySelectorAll('.category-btn').forEach(btn => {
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
    name: item.text || item.name || 'Unknown',
    type: item.categoryApiId || category,
    category,
    icon: item.iconUrl || item.icon || null,
    price: item.currentPrice || 0,
    change: calculatePriceChange(item.priceLogs),
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

  // Render using DocumentFragment for performance
  const fragment = document.createDocumentFragment();

  items.forEach(item => {
    const card = createItemCard(item);
    fragment.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(fragment);

  // Event delegation for favorites (already handled by container)
  container.onclick = (e) => {
    const btn = e.target.closest('.favorite-btn');
    if (btn) {
      e.stopPropagation();
      const newFavorites = toggleFavorite(btn.dataset.itemId);
      window.dispatchEvent(new CustomEvent('economy-favorites-changed', {
        detail: { favorites: newFavorites }
      }));
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
  if (elements.loading) elements.loading.style.display = 'flex';
  if (elements.error) elements.error.style.display = 'none';
  if (elements.items) elements.items.style.display = 'none';
  if (elements.emptyFavorites) elements.emptyFavorites.style.display = 'none';
}

function hideLoading() {
  state.loading = false;
  if (elements.loading) elements.loading.style.display = 'none';
  if (elements.items) elements.items.style.display = 'grid';
}

function showError(message) {
  state.loading = false;
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
// Public API
// ========================================

export function onEconomyTabActivated() {
  if (!state.cache.has('currency')) {
    fetchEconomyData();
  }
}
