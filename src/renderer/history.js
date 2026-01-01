// ========================================
// Divinge - Merchant History Module
// UI for displaying merchant history and Discord settings
// ========================================

// Rarity class mapping for item cards
const FRAME_TYPE_CLASSES = {
  0: 'normal',
  1: 'magic',
  2: 'rare',
  3: 'unique',
  4: 'gem',
  5: 'currency',
};

// State
let sales = [];
let lastFetchTime = null;

// ========================================
// Initialization
// ========================================

export function initHistory() {
  setupHistoryListeners();
  setupDiscordListeners();
  loadInitialHistory();
}

async function loadInitialHistory() {
  const result = await window.api.getTradeHistory();
  sales = result.sales || [];
  lastFetchTime = result.lastFetchTime;
  renderHistoryList();
  updateLastSyncTime();
}

// ========================================
// History Tab UI
// ========================================

function renderHistoryList() {
  const container = document.getElementById('historyList');
  const emptyState = document.getElementById('historyEmptyState');

  if (!container) return;

  if (sales.length === 0) {
    container.innerHTML = '';
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  container.innerHTML = sales.map((sale, index) => createSaleCard(sale, index)).join('');

  // Add click handlers for expanding/collapsing
  container.querySelectorAll('.sale-item').forEach(item => {
    const row = item.querySelector('.sale-row');
    row.addEventListener('click', () => {
      item.classList.toggle('expanded');
    });
  });
}

function createSaleCard(sale, index) {
  const item = sale.item;
  const price = sale.price;
  const frameType = item.frameType || 0;
  const frameClass = FRAME_TYPE_CLASSES[frameType] || 'normal';

  // Build item name (combine name + typeLine like "Seed of Cataclysm Lazuli Ring")
  const fullName = item.name
    ? `${item.name} ${item.typeLine}`
    : item.typeLine;

  // Format price with currency class
  const currencyClass = getCurrencyClass(price.currency);
  const currencyName = formatCurrency(price.currency);

  // Format time (uppercase like PoE)
  const timeStr = formatRelativeTime(new Date(sale.time)).toUpperCase();

  // Build item preview
  const itemPreview = buildItemPreview(item);

  return `
    <div class="sale-item" data-index="${index}">
      <div class="sale-row ${frameClass}">
        <div class="sale-expand-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <div class="sale-icon-wrap">
          ${item.icon ? `<img class="sale-icon" src="${escapeHtml(item.icon)}" alt="">` : ''}
        </div>
        <div class="sale-text">
          <span class="sale-label">Sold:</span>
          <span class="sale-item-name ${frameClass}">${escapeHtml(fullName)}</span>
          <span class="sale-label">For:</span>
          <span class="sale-price-amount">${price.amount}x</span>
          <span class="sale-currency ${currencyClass}">${currencyName}</span>
        </div>
        <div class="sale-time">${timeStr}</div>
      </div>
      <div class="sale-preview">
        ${itemPreview}
      </div>
    </div>
  `;
}

function buildItemPreview(item) {
  const frameType = item.frameType || 0;
  const frameClass = FRAME_TYPE_CLASSES[frameType] || 'normal';

  let sections = [];

  // Header - Item name
  if (item.name) {
    sections.push(`
      <div class="poe-item-header ${frameClass}">
        <span class="poe-item-name">${escapeHtml(item.name)}</span>
        <span class="poe-item-base">${escapeHtml(item.typeLine)}</span>
      </div>
    `);
  } else {
    sections.push(`
      <div class="poe-item-header ${frameClass}">
        <span class="poe-item-name">${escapeHtml(item.typeLine)}</span>
      </div>
    `);
  }

  // Base type info
  let infoLines = [];
  if (item.baseType) {
    infoLines.push(item.baseType);
  }
  if (item.properties) {
    for (const prop of item.properties) {
      if (prop.values && prop.values.length > 0) {
        const val = prop.values.map(v => v[0]).join(', ');
        infoLines.push(`${prop.name}: <span class="poe-value">${escapeHtml(val)}</span>`);
      } else {
        infoLines.push(prop.name);
      }
    }
  }
  if (infoLines.length > 0) {
    sections.push(`<div class="poe-item-props">${infoLines.join('<br>')}</div>`);
  }

  // Item Level
  if (item.ilvl) {
    sections.push(`<div class="poe-item-ilvl">Item Level: <span class="poe-value">${item.ilvl}</span></div>`);
  }

  // Requirements
  if (item.requirements && item.requirements.length > 0) {
    const reqs = item.requirements.map(r => {
      const val = r.values?.[0]?.[0] || '';
      return `${r.name} <span class="poe-value">${escapeHtml(val)}</span>`;
    }).join(', ');
    sections.push(`<div class="poe-item-reqs">Requires ${reqs}</div>`);
  }

  // Implicit mods
  if (item.implicitMods && item.implicitMods.length > 0) {
    const implicits = item.implicitMods.map(m => `<div class="poe-mod implicit">${cleanModText(m)}</div>`).join('');
    sections.push(`<div class="poe-item-implicits">${implicits}</div>`);
  }

  // Explicit mods
  if (item.explicitMods && item.explicitMods.length > 0) {
    const explicits = item.explicitMods.map(m => `<div class="poe-mod explicit">${cleanModText(m)}</div>`).join('');
    sections.push(`<div class="poe-item-explicits">${explicits}</div>`);
  }

  // Rune mods
  if (item.runeMods && item.runeMods.length > 0) {
    const runes = item.runeMods.map(m => `<div class="poe-mod rune">${cleanModText(m)}</div>`).join('');
    sections.push(`<div class="poe-item-runes">${runes}</div>`);
  }

  // Corrupted
  if (item.corrupted) {
    sections.push(`<div class="poe-item-corrupted">Corrupted</div>`);
  }

  // Item icon
  if (item.icon) {
    sections.push(`<div class="poe-item-icon"><img src="${escapeHtml(item.icon)}" alt=""></div>`);
  }

  return `<div class="poe-item-card ${frameClass}">${sections.join('')}</div>`;
}

function cleanModText(mod) {
  // Clean up mod text - remove [bracketed|formatted] text, keep first part
  return escapeHtml(mod.replace(/\[([^\]|]+)\|?[^\]]*\]/g, '$1'));
}

function getCurrencyClass(currency) {
  const classes = {
    'divine': 'currency-divine',
    'exalted': 'currency-exalted',
    'chaos': 'currency-chaos',
    'vaal': 'currency-vaal',
    'mirror': 'currency-mirror',
  };
  return classes[currency] || '';
}

function formatCurrency(currency) {
  const names = {
    'divine': 'Divine',
    'exalted': 'Exalted',
    'chaos': 'Chaos',
    'vaal': 'Vaal',
    'regal': 'Regal',
    'alchemy': 'Alchemy',
    'chance': 'Chance',
    'alteration': 'Alteration',
    'jeweller': 'Jeweller',
    'fusing': 'Fusing',
    'chromatic': 'Chromatic',
    'scouring': 'Scouring',
    'blessed': 'Blessed',
    'regret': 'Regret',
  };
  return names[currency] || currency;
}

function formatRelativeTime(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatMods(item) {
  const mods = [];
  const modTypes = [
    'implicitMods',
    'explicitMods',
    'fracturedMods',
    'mutatedMods',
    'desecratedMods',
    'runeMods',
  ];

  for (const modType of modTypes) {
    if (item[modType] && Array.isArray(item[modType])) {
      for (const mod of item[modType]) {
        // Clean up mod text (remove [bracketed] formatting)
        const cleanMod = mod.replace(/\[([^\]|]+)\|?[^\]]*\]/g, '$1');
        mods.push(cleanMod);
      }
    }
  }

  return mods;
}

function updateLastSyncTime() {
  const lastSyncEl = document.getElementById('historyLastSync');
  if (!lastSyncEl) return;

  if (lastFetchTime) {
    const timeStr = formatRelativeTime(new Date(lastFetchTime));
    lastSyncEl.textContent = `Last synced ${timeStr.toLowerCase()}`;
  } else {
    lastSyncEl.textContent = 'Not synced yet';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ========================================
// History Event Listeners
// ========================================

function setupHistoryListeners() {
  // Sync button click handler
  const syncBtn = document.getElementById('historySyncBtn');
  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true;
      syncBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px; animation: spin 1s linear infinite;">
          <path d="M23 4v6h-6M1 20v-6h6"/>
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
        </svg>
        Syncing...
      `;

      try {
        await window.api.refreshTradeHistory();
        // Success - will be updated via onTradeHistoryUpdated
      } catch (error) {
        const statusEl = document.getElementById('historyStatus');
        if (statusEl) {
          statusEl.textContent = error.message || 'Sync failed';
          statusEl.className = 'history-status error';
        }
      } finally {
        syncBtn.disabled = false;
        syncBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
          </svg>
          Sync
        `;
      }
    });
  }

  // IPC listeners for real-time updates
  window.api.onTradeHistoryUpdated((data) => {
    sales = data.sales || [];
    lastFetchTime = new Date().toISOString();
    renderHistoryList();
    updateLastSyncTime();
  });

  window.api.onTradeHistoryNewSale((sale) => {
    // Add to front of list
    sales = [sale, ...sales.filter(s => s.item_id !== sale.item_id)];
    renderHistoryList();
  });

  window.api.onTradeHistoryError((data) => {
    const statusEl = document.getElementById('historyStatus');
    if (statusEl) {
      statusEl.textContent = data.message || 'Sync error';
      statusEl.className = 'history-status error';
    }
  });

  // Rate limit handler
  window.api.onTradeHistoryRateLimited?.((data) => {
    const statusEl = document.getElementById('historyStatus');
    const syncBtn = document.getElementById('historySyncBtn');
    if (statusEl) {
      const minutes = Math.ceil(data.retryAfter / 60);
      statusEl.textContent = `Rate limited - wait ${minutes}m`;
      statusEl.className = 'history-status error';
    }
    if (syncBtn) {
      syncBtn.disabled = true;
      // Re-enable after retry period
      setTimeout(() => {
        syncBtn.disabled = false;
        if (statusEl) {
          statusEl.textContent = '';
          statusEl.className = 'history-status';
        }
      }, data.retryAfter * 1000);
    }
  });
}

// ========================================
// Discord Settings
// ========================================

function setupDiscordListeners() {
  const webhookInput = document.getElementById('discordWebhookUrl');
  const displayNameInput = document.getElementById('discordDisplayName');
  const enabledToggle = document.getElementById('discordEnabled');
  const testBtn = document.getElementById('testDiscordBtn');
  const saveBtn = document.getElementById('saveDiscordBtn');
  const statusEl = document.getElementById('discordStatus');

  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      const url = webhookInput?.value?.trim();
      const displayName = displayNameInput?.value?.trim() || 'Player';
      if (!url) {
        if (statusEl) {
          statusEl.textContent = 'Enter a webhook URL first';
          statusEl.className = 'discord-status error';
        }
        return;
      }

      testBtn.disabled = true;
      testBtn.textContent = 'Testing...';

      try {
        const result = await window.api.testDiscordWebhook({ url, displayName });
        if (result.success) {
          if (statusEl) {
            statusEl.textContent = 'Test sale sent to Discord!';
            statusEl.className = 'discord-status success';
          }
        } else {
          if (statusEl) {
            statusEl.textContent = result.error || 'Test failed';
            statusEl.className = 'discord-status error';
          }
        }
      } catch (error) {
        if (statusEl) {
          statusEl.textContent = error.message || 'Test failed';
          statusEl.className = 'discord-status error';
        }
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = 'Test';
      }
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const url = webhookInput?.value?.trim() || '';
      const displayName = displayNameInput?.value?.trim() || '';
      const enabled = enabledToggle?.checked ?? false;

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        await window.api.saveDiscordWebhook({ url, displayName, enabled });
        if (statusEl) {
          statusEl.textContent = 'Settings saved';
          statusEl.className = 'discord-status success';
          setTimeout(() => {
            statusEl.textContent = '';
          }, 3000);
        }
      } catch (error) {
        if (statusEl) {
          statusEl.textContent = error.message || 'Save failed';
          statusEl.className = 'discord-status error';
        }
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    });
  }
}

export async function loadDiscordSettings(config) {
  const webhookInput = document.getElementById('discordWebhookUrl');
  const displayNameInput = document.getElementById('discordDisplayName');
  const enabledToggle = document.getElementById('discordEnabled');

  if (webhookInput && config.discordWebhookUrl) {
    webhookInput.value = config.discordWebhookUrl;
  }
  if (displayNameInput && config.discordDisplayName) {
    displayNameInput.value = config.discordDisplayName;
  }
  if (enabledToggle) {
    enabledToggle.checked = config.discordEnabled === true;
  }
}
