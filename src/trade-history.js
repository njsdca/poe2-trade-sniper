// ========================================
// Divinge - Merchant History Module
// Fetches and manages merchant history from PoE2
// ========================================

import { EventEmitter } from 'events';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { renderItemCard } from './item-card-renderer.js';

// Rarity colors for Discord embeds (decimal format)
const RARITY_COLORS = {
  0: 0xC8C8C8,  // Normal - gray
  1: 0x8888FF,  // Magic - blue
  2: 0xFFFF77,  // Rare - yellow
  3: 0xAF6025,  // Unique - orange
  4: 0x1BA29B,  // Gem - teal
  5: 0xAA9E82,  // Currency - tan
};

// Minimum time between API calls (GGG rate limit is strict on history endpoint)
const MIN_FETCH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes to be safe

export class TradeHistory extends EventEmitter {
  constructor(config, options = {}) {
    super();
    this.config = config;
    this.historyFilePath = options.historyFilePath || null;
    this.sales = [];
    this.knownItemIds = new Set();
    this.lastFetchTime = null;
    this.loading = false;
    this.rateLimitedUntil = null; // Timestamp when rate limit expires
  }

  // ========================================
  // API Fetching
  // ========================================

  async fetchHistory() {
    if (this.loading) return null;

    // Check if we're rate limited
    if (this.rateLimitedUntil && Date.now() < this.rateLimitedUntil) {
      const waitSecs = Math.ceil((this.rateLimitedUntil - Date.now()) / 1000);
      console.log(`[TradeHistory] Still rate limited, ${waitSecs}s remaining`);
      this.emit('rate-limited', { retryAfter: waitSecs });
      return null;
    }

    // Check minimum interval between fetches
    if (this.lastFetchTime) {
      const elapsed = Date.now() - new Date(this.lastFetchTime).getTime();
      if (elapsed < MIN_FETCH_INTERVAL_MS) {
        const waitSecs = Math.ceil((MIN_FETCH_INTERVAL_MS - elapsed) / 1000);
        console.log(`[TradeHistory] Too soon to fetch again, wait ${waitSecs}s`);
        this.emit('error', { message: `Please wait ${Math.ceil(waitSecs / 60)} min before syncing again` });
        return null;
      }
    }

    this.loading = true;

    try {
      const cookieString = this.config.cf_clearance
        ? `POESESSID=${this.config.poesessid}; cf_clearance=${this.config.cf_clearance}`
        : `POESESSID=${this.config.poesessid}`;

      // League from config (already URL encoded like "Fate%20of%20the%20Vaal")
      const league = this.config.league || 'Fate%20of%20the%20Vaal';
      const url = `https://www.pathofexile.com/api/trade2/history/${league}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Cookie': cookieString,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.pathofexile.com/trade2/history',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      if (response.status === 403) {
        this.emit('error', { message: 'Authentication failed - cookies may have expired' });
        this.loading = false;
        return null;
      }

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '3600', 10);
        console.log(`[TradeHistory] Rate limited - retry after ${retryAfter}s`);
        this.rateLimitedUntil = Date.now() + (retryAfter * 1000);
        this.loading = false;
        // Save immediately so rate limit persists
        await this.saveToDisk();
        this.emit('rate-limited', { retryAfter });
        return null;
      }

      if (!response.ok) {
        console.log('[TradeHistory] Error:', response.status, response.statusText);
        this.emit('error', { message: `HTTP ${response.status}: ${response.statusText}` });
        this.loading = false;
        return null;
      }

      const data = await response.json();
      this.loading = false;

      if (data.result && Array.isArray(data.result)) {
        // Log first sale structure for debugging (only once)
        if (data.result.length > 0 && !this._loggedStructure) {
          this._loggedStructure = true;
          const sample = data.result[0];
          console.log('[TradeHistory] Sale structure:', {
            hasId: !!sample.id,
            hasItemId: !!sample.item_id,
            hasTime: !!sample.time,
            keys: Object.keys(sample),
          });
        }
        return data.result;
      }

      return [];
    } catch (error) {
      console.error('[TradeHistory] Fetch error:', error);
      this.loading = false;
      this.emit('error', { message: error.message });
      return null;
    }
  }

  // ========================================
  // Persistence
  // ========================================

  async loadFromDisk() {
    if (!this.historyFilePath || !existsSync(this.historyFilePath)) {
      return;
    }

    try {
      const data = JSON.parse(await readFile(this.historyFilePath, 'utf-8'));
      this.sales = data.sales || [];
      this.knownItemIds = new Set(data.knownItemIds || []);
      this.lastFetchTime = data.lastFetchTime || null;
      this.rateLimitedUntil = data.rateLimitedUntil || null;
      console.log(`[TradeHistory] Loaded ${this.sales.length} sales, ${this.knownItemIds.size} known IDs`);
      this.emit('loaded', { count: this.sales.length });
    } catch (error) {
      console.error('[TradeHistory] Failed to load from disk:', error);
    }
  }

  async saveToDisk() {
    if (!this.historyFilePath) {
      return;
    }

    try {
      const data = {
        sales: this.sales,
        knownItemIds: Array.from(this.knownItemIds),
        lastFetchTime: this.lastFetchTime,
        rateLimitedUntil: this.rateLimitedUntil,
      };
      await writeFile(this.historyFilePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[TradeHistory] Failed to save to disk:', error);
    }
  }

  // ========================================
  // Sale Detection
  // ========================================

  // Generate a unique key for a sale (GGG uses 'id' field, fallback to composite)
  getSaleKey(sale) {
    if (sale.id) return sale.id;
    // Fallback: create composite key from time + item details
    const itemKey = sale.item?.name || sale.item?.typeLine || '';
    const priceKey = sale.price ? `${sale.price.amount}-${sale.price.currency}` : '';
    return `${sale.time}-${itemKey}-${priceKey}`;
  }

  detectNewSales(freshSales) {
    const newSales = [];

    for (const sale of freshSales) {
      const saleKey = this.getSaleKey(sale);
      if (!this.knownItemIds.has(saleKey)) {
        newSales.push(sale);
        this.knownItemIds.add(saleKey);
        console.log(`[TradeHistory] New sale detected: ${saleKey}`);
      }
    }

    if (newSales.length === 0 && freshSales.length > 0) {
      console.log(`[TradeHistory] All ${freshSales.length} sales already known`);
    }

    return newSales;
  }

  async refreshAndDetect() {
    const freshSales = await this.fetchHistory();
    if (!freshSales) {
      return { sales: this.sales, newSales: [] };
    }

    // Detect new sales (items we haven't seen before)
    const newSales = this.detectNewSales(freshSales);

    // Update stored sales (API returns most recent)
    this.sales = freshSales;
    this.lastFetchTime = new Date().toISOString();

    // Save to disk
    await this.saveToDisk();

    // Emit events
    this.emit('updated', { sales: this.sales, newSales });

    for (const sale of newSales) {
      this.emit('new-sale', sale);
    }

    return { sales: this.sales, newSales };
  }

  // ========================================
  // Discord Integration
  // ========================================

  formatForDiscord(sale) {
    const item = sale.item;
    const price = sale.price;
    const frameType = item.frameType || 0;
    const color = RARITY_COLORS[frameType] || RARITY_COLORS[0];

    // Build item name
    const itemName = item.name
      ? `**${item.name}**\n${item.typeLine}`
      : `**${item.typeLine}**`;

    // Format price
    const currencyName = this.formatCurrency(price.currency);
    const priceStr = `${price.amount} ${currencyName}`;

    // Format time
    const saleTime = new Date(sale.time);
    const timeStr = this.formatRelativeTime(saleTime);

    // Build mods string (truncated for Discord)
    const mods = this.formatMods(item);
    const modsStr = mods.length > 0 ? mods.slice(0, 5).join('\n') : null;

    const embed = {
      title: 'Item Sold!',
      description: itemName,
      color: color,
      thumbnail: item.icon ? { url: item.icon } : undefined,
      fields: [
        { name: 'Price', value: priceStr, inline: true },
        { name: 'Sold', value: timeStr, inline: true },
      ],
      footer: { text: 'Divinge Trade Bot' },
      timestamp: sale.time,
    };

    // Add mods field if present
    if (modsStr) {
      embed.fields.push({ name: 'Mods', value: modsStr, inline: false });
    }

    return embed;
  }

  formatCurrency(currency) {
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

  formatRelativeTime(date) {
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

  formatMods(item) {
    const mods = [];

    // Collect all mod types
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

  async postToDiscord(webhookUrl, sale, displayName = 'Player') {
    // Single sale - delegate to batch method
    return this.postSalesToDiscord(webhookUrl, [sale], displayName);
  }

  async postSalesToDiscord(webhookUrl, sales, displayName = 'Player') {
    if (!webhookUrl) {
      return { success: false, error: 'No webhook URL configured' };
    }

    if (!sales || sales.length === 0) {
      return { success: true };
    }

    try {
      // Discord allows max 10 embeds/files per message
      const maxPerMessage = 10;
      const salesToPost = sales.slice(0, maxPerMessage);

      // Generate item card images for all sales
      const imageBuffers = await Promise.all(
        salesToPost.map(sale => renderItemCard(sale.item))
      );

      // Calculate total value
      const totalValue = salesToPost.reduce((sum, sale) => {
        // Normalize to divine equivalent (rough estimate)
        const amount = sale.price.amount;
        if (sale.price.currency === 'divine') return sum + amount;
        if (sale.price.currency === 'exalted') return sum + (amount / 10);
        return sum + (amount / 100); // chaos and others
      }, 0);

      // Create title based on count
      const title = salesToPost.length === 1
        ? `${displayName} sold an item!`
        : `${displayName} sold ${salesToPost.length} items!`;

      // Create embeds for each sale
      const embeds = salesToPost.map((sale, index) => ({
        title: index === 0 ? title : undefined,
        description: this.formatItemDescription(sale),
        color: RARITY_COLORS[sale.item.frameType] || RARITY_COLORS[0],
        image: { url: `attachment://item-card-${index}.png` },
        footer: index === salesToPost.length - 1
          ? { text: `Divinge${salesToPost.length > 1 ? ` • ${Math.round(totalValue)} Divine total` : ''}` }
          : undefined,
        timestamp: index === salesToPost.length - 1 ? sale.time : undefined,
      }));

      // Create form data with all images and embeds
      const formData = new FormData();
      imageBuffers.forEach((buffer, index) => {
        formData.append(`files[${index}]`, new Blob([buffer], { type: 'image/png' }), `item-card-${index}.png`);
      });
      formData.append('payload_json', JSON.stringify({ embeds }));

      const response = await fetch(webhookUrl, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Discord API error: ${response.status} - ${text}` };
      }

      // If there were more than 10 sales, post the rest in another message
      if (sales.length > maxPerMessage) {
        await this.postSalesToDiscord(webhookUrl, sales.slice(maxPerMessage), displayName);
      }

      return { success: true, posted: salesToPost.length };
    } catch (error) {
      console.error('[TradeHistory] Discord post error:', error);
      return { success: false, error: error.message };
    }
  }

  formatItemDescription(sale) {
    const item = sale.item;
    const price = sale.price;
    const currencyName = this.formatCurrency(price.currency);

    let desc = '';
    if (item.name) {
      desc = `**${item.name}**\n${item.typeLine}`;
    } else {
      desc = `**${item.typeLine}**`;
    }
    desc += `\n\n💰 **${price.amount} ${currencyName}**`;

    return desc;
  }

  async testWebhook(webhookUrl, displayName = 'Player') {
    if (!webhookUrl) {
      return { success: false, error: 'No webhook URL provided' };
    }

    try {
      // Create mock sales to demonstrate batching (3 items)
      const mockSales = [
        {
          time: new Date().toISOString(),
          item: {
            name: 'Seed of Cataclysm',
            typeLine: 'Lazuli Ring',
            frameType: 3, // Unique
            icon: 'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvUmluZ3MvU2VlZE9mQ2F0YWNseXNtIiwidyI6MSwiaCI6MSwic2NhbGUiOjF9XQ/f3ef7c2e4d/SeedOfCataclysm.png',
            ilvl: 81,
            properties: [
              { name: 'Quality (Caster Modifiers)', values: [['+20%', 1]] },
            ],
            implicitMods: ['+28 to maximum Mana'],
            explicitMods: [
              '42% increased Critical Hit Chance for Spells',
              '42% increased Critical Spell Damage Bonus',
              '9% increased Mana Cost of Skills',
            ],
            corrupted: true,
          },
          price: { amount: 50, currency: 'divine' },
        },
        {
          time: new Date().toISOString(),
          item: {
            name: null,
            typeLine: 'Rusted Sword',
            frameType: 2, // Rare
            ilvl: 75,
            implicitMods: ['+15% increased Attack Speed'],
            explicitMods: [
              '180% increased Physical Damage',
              '+35 to Strength',
              'Adds 10-25 Fire Damage',
            ],
          },
          price: { amount: 15, currency: 'divine' },
        },
        {
          time: new Date().toISOString(),
          item: {
            name: 'Exalted Orb',
            typeLine: 'Exalted Orb',
            frameType: 5, // Currency
            icon: 'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQ3VycmVuY3lBZGRNb2RUb1JhcmUiLCJ3IjoxLCJoIjoxLCJzY2FsZSI6MX1d/d9e53f5cd5/CurrencyAddModToRare.png',
          },
          price: { amount: 10, currency: 'divine' },
        },
      ];

      // Generate images for all mock sales
      const imageBuffers = await Promise.all(
        mockSales.map(sale => renderItemCard(sale.item))
      );

      // Create embeds
      const embeds = mockSales.map((sale, index) => ({
        title: index === 0 ? `${displayName} sold ${mockSales.length} items!` : undefined,
        description: this.formatItemDescription(sale),
        color: RARITY_COLORS[sale.item.frameType] || RARITY_COLORS[0],
        image: { url: `attachment://item-card-${index}.png` },
        footer: index === mockSales.length - 1
          ? { text: 'Divinge • Test Notification • 75 Divine total' }
          : undefined,
        timestamp: index === mockSales.length - 1 ? sale.time : undefined,
      }));

      // Create form data with all images
      const formData = new FormData();
      imageBuffers.forEach((buffer, index) => {
        formData.append(`files[${index}]`, new Blob([buffer], { type: 'image/png' }), `item-card-${index}.png`);
      });
      formData.append('payload_json', JSON.stringify({ embeds }));

      const response = await fetch(webhookUrl, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Discord API error: ${response.status} - ${text}` };
      }

      return { success: true };
    } catch (error) {
      console.error('[TradeHistory] Test webhook error:', error);
      return { success: false, error: error.message };
    }
  }

  // ========================================
  // Getters
  // ========================================

  getSales() {
    return this.sales;
  }

  getLastFetchTime() {
    return this.lastFetchTime;
  }

  isLoading() {
    return this.loading;
  }
}
