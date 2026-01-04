import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import puppeteer from 'puppeteer-core';
import player from 'play-sound';
import { findBrowserExecutable } from './browser-utils.js';
import { LRUCache } from './lru-cache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 5000;
const HEALTH_CHECK_INTERVAL_MS = 30000;
const MAX_SEEN_TOKENS = 10000;

export class TradeSniper extends EventEmitter {
  constructor(config, options = {}) {
    super();
    this.config = config;
    this.browser = null;
    this.pages = new Map(); // queryId -> { page, connected, reconnectAttempts }
    this.queryStates = new Map(); // queryId -> { status: 'stopped' | 'running' | 'paused', connected: boolean }
    this.running = false;
    this.seenTokens = new LRUCache(MAX_SEEN_TOKENS);
    this.processingIds = new Set(); // Track in-flight item fetches to prevent duplicates
    this.healthCheckInterval = null;

    // Sound setup
    this.soundPlayer = player({});
    this.soundFilePath = options.soundFilePath || join(__dirname, '..', 'alert.wav');

    // Browser profile for persistent cookies
    this.browserProfilePath = options.browserProfilePath || null;

    // Teleport cooldown - prevent double teleports
    this.lastTeleportTime = 0;
    this.teleportCooldownMs = config.teleportCooldownMs || 5000; // 5 second default
  }

  // Per-query control methods
  async startQuery(queryId) {
    const query = this.config.queries?.find(q =>
      (typeof q === 'string' ? q : q.id) === queryId
    );
    if (!query) {
      this.log('ERROR', `Query not found: ${queryId}`);
      return;
    }

    // Check if already running
    const existingState = this.queryStates.get(queryId);
    if (existingState?.status === 'running' || existingState?.status === 'paused') {
      this.log('WARN', `Query already active: ${queryId}`);
      return;
    }

    const queryName = typeof query === 'string' ? query : (query.name || query.id);

    // Initialize state
    this.queryStates.set(queryId, { status: 'running', connected: false });
    this.emit('query-state-change', { queryId, status: 'running', connected: false });

    // Ensure browser is running
    if (!this.browser) {
      await this.initBrowser();
    }

    if (!this.browser) {
      this.log('ERROR', 'Failed to start browser');
      this.queryStates.set(queryId, { status: 'stopped', connected: false });
      this.emit('query-state-change', { queryId, status: 'stopped', connected: false });
      return;
    }

    // Mark sniper as running if not already
    if (!this.running) {
      this.running = true;
      this.emit('status-change', { running: true });
      this.startHealthCheck();
    }

    this.log('INFO', `Starting query: ${queryId}`, queryId);

    // Create page and connect
    const page = await this.setupPage(queryId, queryName);
    if (!page) return;

    this.pages.set(queryId, {
      page,
      queryName,
      connected: false,
      reconnectAttempts: 0,
    });

    await this.connectQuery(queryId, queryName, page);
  }

  async stopQuery(queryId) {
    const pageState = this.pages.get(queryId);
    if (pageState) {
      if (pageState.page && !pageState.page.isClosed()) {
        try { await pageState.page.close(); } catch (e) {}
      }
      this.pages.delete(queryId);
    }

    this.queryStates.set(queryId, { status: 'stopped', connected: false });
    this.emit('query-state-change', { queryId, status: 'stopped', connected: false });
    this.emit('disconnected', { queryId });
    this.log('INFO', `Query stopped: ${queryId}`, queryId);

    // Check if any queries are still running
    const hasActiveQueries = Array.from(this.queryStates.values()).some(
      s => s.status === 'running' || s.status === 'paused'
    );
    if (!hasActiveQueries && this.running) {
      await this.stop();
    }
  }

  pauseQuery(queryId) {
    const state = this.queryStates.get(queryId);
    if (state && state.status === 'running') {
      state.status = 'paused';
      this.queryStates.set(queryId, state);
      this.emit('query-state-change', { queryId, status: 'paused', connected: state.connected });
      this.log('INFO', 'PAUSED - teleports disabled', queryId);
    }
  }

  resumeQuery(queryId) {
    const state = this.queryStates.get(queryId);
    if (state && state.status === 'paused') {
      state.status = 'running';
      this.queryStates.set(queryId, state);
      this.emit('query-state-change', { queryId, status: 'running', connected: state.connected });
      this.log('INFO', 'RESUMED - teleports enabled', queryId);
    }
  }

  getQueryState(queryId) {
    return this.queryStates.get(queryId) || { status: 'stopped', connected: false };
  }

  getAllQueryStates() {
    const states = {};
    for (const [id, state] of this.queryStates) {
      states[id] = { ...state };
    }
    return states;
  }

  // Global pause (for "Pause All" functionality)
  setPaused(paused) {
    for (const [queryId, state] of this.queryStates) {
      if (paused && state.status === 'running') {
        this.pauseQuery(queryId);
      } else if (!paused && state.status === 'paused') {
        this.resumeQuery(queryId);
      }
    }
  }

  async initBrowser() {
    try {
      const executablePath = findBrowserExecutable();
      if (!executablePath) {
        this.log('ERROR', 'No browser found! Please install Chrome or Edge.');
        this.emit('error', { error: 'No browser found. Please install Chrome or Microsoft Edge.' });
        return false;
      }

      this.log('INFO', `Using browser: ${executablePath}`);

      const launchOptions = {
        headless: false,
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--disable-blink-features=AutomationControlled',
          // Disable throttling for background tabs
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          // Additional performance flags
          '--disable-hang-monitor',
          '--disable-ipc-flooding-protection',
          '--disable-popup-blocking',
          '--disable-prompt-on-repost',
          '--disable-sync',
          '--disable-translate',
          '--disable-extensions',
          '--disable-default-apps',
          '--disable-client-side-phishing-detection',
          '--disable-component-update',
          '--no-default-browser-check',
          '--disable-features=TranslateUI,OptimizationHints,UseEcoQoSForBackgroundProcess',
        ],
      };

      if (this.browserProfilePath) {
        launchOptions.userDataDir = this.browserProfilePath;
        this.log('INFO', `Using persistent browser profile: ${this.browserProfilePath}`);
      }

      this.browser = await puppeteer.launch(launchOptions);

      this.browser.on('disconnected', async () => {
        if (this.running) {
          this.log('ERROR', 'Browser disconnected unexpectedly');
          await this.stop();
        }
      });

      await this.warmupConnections();
      return true;
    } catch (err) {
      this.log('ERROR', `Failed to start browser: ${err.message}`);
      this.emit('error', { error: err.message });
      return false;
    }
  }

  log(level, message, queryId = null) {
    const timestamp = new Date().toISOString();
    const prefix = queryId ? `[${queryId}]` : '';
    const logMessage = `${timestamp} [${level}]${prefix} ${message}`;

    // Emit for GUI
    this.emit('log', { level, message, queryId, timestamp, formatted: logMessage });

    // Also console log
    console.log(logMessage);
  }

  playSound() {
    if (!this.config.soundEnabled || this.config.soundFile === 'none') return;

    if (!existsSync(this.soundFilePath)) {
      process.stdout.write('\x07');
      return;
    }

    this.soundPlayer.play(this.soundFilePath, (err) => {
      if (err) this.log('ERROR', `Failed to play sound: ${err.message}`);
    });
  }

  getCookieString() {
    const { poesessid, cf_clearance } = this.config;
    return cf_clearance
      ? `POESESSID=${poesessid}; cf_clearance=${cf_clearance}`
      : `POESESSID=${poesessid}`;
  }

  // Direct HTTP headers for Node.js requests (bypasses page.evaluate overhead)
  getDirectHttpHeaders() {
    const { league } = this.config;
    return {
      'Cookie': this.getCookieString(),
      'Origin': 'https://www.pathofexile.com',
      'Referer': `https://www.pathofexile.com/trade2/search/poe2/${league}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    };
  }

  // FAST: Direct whisper via Node.js HTTP (no page.evaluate overhead)
  async triggerWhisperDirect(hideoutToken) {
    const response = await fetch('https://www.pathofexile.com/api/trade2/whisper', {
      method: 'POST',
      headers: {
        ...this.getDirectHttpHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: hideoutToken }),
    });

    if (!response.ok) {
      if (response.status === 403) {
        this.log('ERROR', '!!! COOKIE EXPIRED !!!');
        this.emit('cookie-expired');
        this.playSound();
        setTimeout(() => this.playSound(), 500);
      }
      throw new Error(`Whisper failed: ${response.status}`);
    }

    return response.json();
  }

  // FAST: Direct fetch via Node.js HTTP (no page.evaluate overhead)
  async fetchItemsNodeDirect(itemIds, queryId, queryName) {
    const startTime = Date.now();
    const fetchUrl = `https://www.pathofexile.com/api/trade2/fetch/${itemIds.join(',')}?query=${queryId}&realm=poe2`;

    const response = await fetch(fetchUrl, {
      headers: this.getDirectHttpHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status}`);
    }

    const data = await response.json();
    const fetchTime = Date.now() - startTime;

    if (!data.result?.length) return;

    for (const item of data.result) {
      const hideoutToken = item?.listing?.hideout_token;
      if (!hideoutToken || this.seenTokens.has(hideoutToken)) continue;

      this.seenTokens.add(hideoutToken);

      const price = item.listing?.price
        ? `${item.listing.price.amount} ${item.listing.price.currency}`
        : 'No price';
      const itemName = item.item?.name || item.item?.typeLine || 'Unknown';
      const account = item.listing?.account?.name || 'Unknown';

      this.emit('listing', { queryId, queryName, itemName, price, account, hideoutToken });

      // Check pause state
      const queryState = this.queryStates.get(queryId);
      if (queryState?.status === 'paused') {
        this.log('INFO', `[PAUSED] ${itemName} @ ${price}`, queryId);
        continue;
      }

      // Check cooldown
      const now = Date.now();
      if (now - this.lastTeleportTime < this.teleportCooldownMs) {
        const remaining = Math.ceil((this.teleportCooldownMs - (now - this.lastTeleportTime)) / 1000);
        this.log('WARN', `SKIPPED (cooldown ${remaining}s) - ${itemName}`, queryId);
        continue;
      }

      this.lastTeleportTime = now;
      this.log('INFO', `>>> SNIPED: ${itemName} @ ${price} from ${account} <<<`, queryId);

      // FIRE DIRECT WHISPER - No page.evaluate!
      this.triggerWhisperDirect(hideoutToken)
        .then(() => {
          const totalTime = Date.now() - startTime;
          this.log('SUCCESS', `TELEPORT in ${totalTime}ms (fetch: ${fetchTime}ms)`, queryId);
          this.emit('teleport', { queryId, elapsed: totalTime, itemName, price });
          this.playSound();
        })
        .catch((err) => {
          this.log('ERROR', `Whisper failed: ${err.message}`, queryId);
          this.emit('error', { queryId, error: err.message });
          this.lastTeleportTime = 0;
        });
    }
  }

  async triggerWhisper(hideoutToken, page) {
    // Use page.evaluate to make request from browser context (has all auth cookies)
    const result = await page.evaluate(async (token) => {
      try {
        const response = await fetch('https://www.pathofexile.com/api/trade2/whisper', {
          method: 'POST',
          headers: {
            'Accept': '*/*',
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          credentials: 'include',
          body: JSON.stringify({ token }),
        });

        if (!response.ok) {
          const text = await response.text();
          return { error: true, status: response.status, message: text };
        }

        const data = await response.json();
        return { success: true, data };
      } catch (err) {
        return { error: true, message: err.message };
      }
    }, hideoutToken);

    if (result.error) {
      if (result.status === 403) {
        this.log('ERROR', '!!! COOKIE EXPIRED - UPDATE cf_clearance !!!');
        this.emit('cookie-expired');
        this.playSound();
        setTimeout(() => this.playSound(), 500);
        setTimeout(() => this.playSound(), 1000);
      }
      throw new Error(`Whisper failed: ${result.status || ''} ${result.message || ''}`);
    }

    return result.data;
  }

  async warmupConnections() {
    // Pre-warm HTTP connections to reduce latency on first real request
    try {
      const cookieString = this.getCookieString();

      // Make a lightweight request to establish keep-alive connection
      const warmupStart = Date.now();
      await fetch('https://www.pathofexile.com/api/trade2/data/leagues', {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Cookie': cookieString,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      const warmupTime = Date.now() - warmupStart;
      this.log('INFO', `Connection warmed up in ${warmupTime}ms`);
    } catch (err) {
      this.log('WARN', `Connection warmup failed: ${err.message}`);
    }
  }

  async fetchItemsDirectly(itemIds, queryId, queryName, page) {
    const { league } = this.config;
    const fetchUrl = `https://www.pathofexile.com/api/trade2/fetch/${itemIds.join(',')}?query=${queryId}&realm=poe2`;

    // Make fetch request from page context to use cookies
    const result = await page.evaluate(async (url) => {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          credentials: 'include',
        });

        if (!response.ok) {
          return { error: true, status: response.status };
        }

        return await response.json();
      } catch (err) {
        return { error: true, message: err.message };
      }
    }, fetchUrl);

    if (result.error) {
      throw new Error(`Fetch failed: ${result.status || result.message}`);
    }

    // Process items
    if (result.result && Array.isArray(result.result)) {
      for (const item of result.result) {
        const hideoutToken = item?.listing?.hideout_token;

        if (hideoutToken && !this.seenTokens.has(hideoutToken)) {
          this.seenTokens.add(hideoutToken);

          const startTime = Date.now();
          const price = item.listing?.price
            ? `${item.listing.price.amount} ${item.listing.price.currency}`
            : 'No price';
          const itemName = item.item?.name || item.item?.typeLine || 'Unknown';
          const account = item.listing?.account?.name || 'Unknown';

          this.log('INFO', `>>> DIRECT: ${itemName} @ ${price} from ${account} <<<`, queryId);

          this.emit('listing', {
            queryId,
            queryName,
            itemName,
            price,
            account,
            hideoutToken,
          });

          // Check per-query pause state
          const queryState = this.queryStates.get(queryId);
          if (queryState?.status === 'paused') {
            this.log('INFO', `[PAUSED] ${itemName} @ ${price} from ${account}`, queryId);
            continue;
          }

          // Check teleport cooldown
          const now = Date.now();
          const timeSinceLastTeleport = now - this.lastTeleportTime;
          if (timeSinceLastTeleport < this.teleportCooldownMs) {
            const remaining = Math.ceil((this.teleportCooldownMs - timeSinceLastTeleport) / 1000);
            this.log('WARN', `SKIPPED teleport (cooldown ${remaining}s remaining) - ${itemName}`, queryId);
            continue;
          }

          // Mark teleport time immediately to prevent race conditions
          this.lastTeleportTime = now;

          // Fire whisper immediately
          this.triggerWhisper(hideoutToken, page)
            .then(() => {
              const elapsed = Date.now() - startTime;
              this.log('SUCCESS', `TELEPORT in ${elapsed}ms (direct)`, queryId);
              this.emit('teleport', { queryId, elapsed, itemName, price });
              this.playSound();
            })
            .catch((err) => {
              this.log('ERROR', `Whisper failed: ${err.message}`, queryId);
              this.emit('error', { queryId, error: err.message });
              // Reset cooldown on failure so next listing can try
              this.lastTeleportTime = 0;
            });
        }
      }
    }
  }

  getCookies() {
    const { poesessid, cf_clearance } = this.config;
    const cookies = [
      {
        name: 'POESESSID',
        value: poesessid,
        domain: '.pathofexile.com',
        path: '/',
        httpOnly: true,
        secure: true,
      },
    ];

    if (cf_clearance) {
      cookies.push({
        name: 'cf_clearance',
        value: cf_clearance,
        domain: '.pathofexile.com',
        path: '/',
        httpOnly: true,
        secure: true,
      });
    }

    return cookies;
  }

  async setupPage(queryId, queryName) {
    if (!this.browser || !this.running) return null;

    const page = await this.browser.newPage();
    const cookies = this.getCookies();

    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    await page.setCookie(...cookies);
    await page.setRequestInterception(true);

    // Get CDP session for WebSocket monitoring
    const client = await page.createCDPSession();
    await client.send('Network.enable');

    // Monitor WebSocket connections
    client.on('Network.webSocketCreated', (params) => {
      this.log('INFO', `WebSocket created: ${params.url}`, queryId);
    });

    client.on('Network.webSocketClosed', (params) => {
      this.log('WARN', 'WebSocket closed', queryId);
    });

    client.on('Network.webSocketFrameReceived', async (params) => {
      try {
        const payload = params.response?.payloadData;
        if (!payload) return;

        // Try to parse as JSON to get item IDs directly from WebSocket
        const data = JSON.parse(payload);

        // Handle new item notifications - GGG sends { result: "JWT_TOKEN", count: N }
        if (data.result && typeof data.result === 'string') {
          const itemToken = data.result;

          // Skip if already processing this token
          if (this.processingIds.has(itemToken)) return;

          // Mark as processing immediately
          this.processingIds.add(itemToken);

          // OPTIMIZED: Use direct Node.js HTTP (no page.evaluate overhead!)
          this.fetchItemsNodeDirect([itemToken], queryId, queryName)
            .catch(err => {
              this.log('WARN', `Direct fetch failed: ${err.message}`, queryId);
            })
            .finally(() => {
              // Keep in processingIds longer to prevent response interceptor from double-processing
              setTimeout(() => {
                this.processingIds.delete(itemToken);
              }, 5000);
            });
        }
      } catch (e) {
        // Non-JSON payloads (heartbeats, etc.) are expected - silently ignore
      }
    });

    // Handle page crashes
    page.on('error', async (err) => {
      this.log('ERROR', `Page crashed: ${err.message}`, queryId);
      this.emit('disconnected', { queryId });
      await this.reconnectQuery(queryId, queryName);
    });

    // Handle page close
    page.on('close', async () => {
      const queryState = this.queryStates.get(queryId);
      if (queryState && (queryState.status === 'running' || queryState.status === 'paused') && this.pages.has(queryId)) {
        this.log('WARN', 'Page closed unexpectedly', queryId);
        queryState.connected = false;
        this.emit('query-state-change', { queryId, status: queryState.status, connected: false });
        this.emit('disconnected', { queryId });
        await this.reconnectQuery(queryId, queryName);
      }
    });

    // Log console messages from the page for debugging
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('trade') || text.includes('socket') || text.includes('error')) {
        this.log('DEBUG', `Console: ${text}`, queryId);
      }
    });

    page.on('request', (request) => {
      const url = request.url();
      const resourceType = request.resourceType();

      // Block unnecessary resources to speed up page load
      if (['image', 'font', 'media'].includes(resourceType)) {
        request.abort();
        return;
      }

      request.continue();
    });

    page.on('response', async (response) => {
      const url = response.url();

      if (url.includes('/api/trade2/fetch')) {
        try {
          // Extract token from URL to check if WebSocket handler already got this
          const tokenMatch = url.match(/\/fetch\/([^?]+)/);
          const urlToken = tokenMatch ? tokenMatch[1] : null;

          // Skip if WebSocket handler is already processing this token
          if (urlToken && this.processingIds.has(urlToken)) {
            return;
          }

          const data = await response.json();

          if (data.result && Array.isArray(data.result)) {
            for (const item of data.result) {
              const hideoutToken = item?.listing?.hideout_token;

              if (hideoutToken && !this.seenTokens.has(hideoutToken)) {
                this.seenTokens.add(hideoutToken);

                const startTime = Date.now();
                const price = item.listing?.price
                  ? `${item.listing.price.amount} ${item.listing.price.currency}`
                  : 'No price';
                const itemName = item.item?.name || item.item?.typeLine || 'Unknown';
                const account = item.listing?.account?.name || 'Unknown';

                this.log('INFO', `>>> NEW LISTING: ${itemName} @ ${price} from ${account} <<<`, queryId);

                this.emit('listing', {
                  queryId,
                  queryName,
                  itemName,
                  price,
                  account,
                  hideoutToken,
                });

                // Check per-query pause state
                const queryState = this.queryStates.get(queryId);
                if (queryState?.status === 'paused') {
                  this.log('INFO', `[PAUSED] ${itemName} @ ${price} from ${account}`, queryId);
                  continue;
                }

                // Check teleport cooldown
                const now = Date.now();
                const timeSinceLastTeleport = now - this.lastTeleportTime;
                if (timeSinceLastTeleport < this.teleportCooldownMs) {
                  const remaining = Math.ceil((this.teleportCooldownMs - timeSinceLastTeleport) / 1000);
                  this.log('WARN', `SKIPPED teleport (cooldown ${remaining}s remaining) - ${itemName}`, queryId);
                  continue;
                }

                // Mark teleport time immediately to prevent race conditions
                this.lastTeleportTime = now;

                // Fire and forget whisper to minimize latency - use page context for auth
                this.triggerWhisper(hideoutToken, page)
                  .then(() => {
                    const elapsed = Date.now() - startTime;
                    this.log('SUCCESS', `TELEPORT TRIGGERED in ${elapsed}ms!`, queryId);
                    this.emit('teleport', { queryId, elapsed, itemName, price });
                    this.playSound();
                  })
                  .catch((err) => {
                    this.log('ERROR', `Whisper failed: ${err.message}`, queryId);
                    this.emit('error', { queryId, error: err.message });
                    // Reset cooldown on failure so next listing can try
                    this.lastTeleportTime = 0;
                  });
              }
            }
          }
        } catch (e) {
          // Response might not be JSON, ignore
        }
      }
    });

    return page;
  }

  async connectQuery(queryId, queryName, page) {
    const { league } = this.config;
    const searchUrl = `https://www.pathofexile.com/trade2/search/poe2/${league}/${queryId}/live`;

    this.log('INFO', `Opening live search: ${searchUrl}`, queryId);

    try {
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      this.log('INFO', 'Page loaded, waiting for live connection...', queryId);

      // Wait for the live search to initialize - look for WebSocket or specific elements
      await page.waitForFunction(() => {
        // Check if the live search is active (look for specific UI indicators)
        const liveIndicator = document.querySelector('.live-search-box, .live, [class*="live"]');
        const resultsContainer = document.querySelector('.results, .resultset, [class*="result"]');
        return liveIndicator || resultsContainer;
      }, { timeout: 15000 }).catch(() => {
        this.log('WARN', 'Live indicator not found, proceeding anyway...', queryId);
      });

      // Short delay to ensure WebSocket is established
      await new Promise(resolve => setTimeout(resolve, 500));

      this.log('SUCCESS', 'Live search connected', queryId);

      // Update page state
      const pageState = this.pages.get(queryId);
      if (pageState) {
        pageState.connected = true;
        pageState.reconnectAttempts = 0;
      }

      // Update query state
      const queryState = this.queryStates.get(queryId);
      if (queryState) {
        queryState.connected = true;
        this.emit('query-state-change', { queryId, status: queryState.status, connected: true });
      }

      this.emit('connected', { queryId, queryName });

      return true;
    } catch (err) {
      this.log('ERROR', `Failed to load page: ${err.message}`, queryId);
      this.emit('error', { queryId, error: err.message });
      return false;
    }
  }

  async reconnectQuery(queryId, queryName) {
    // Check if this specific query should still be running
    const queryState = this.queryStates.get(queryId);
    if (!queryState || queryState.status === 'stopped') return;

    const pageState = this.pages.get(queryId);
    if (!pageState) return;

    pageState.connected = false;
    pageState.reconnectAttempts++;

    // Update query state connected status
    queryState.connected = false;
    this.emit('query-state-change', { queryId, status: queryState.status, connected: false });

    if (pageState.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      this.log('ERROR', `Max reconnect attempts reached for ${queryId}. Giving up.`, queryId);
      this.emit('error', { queryId, error: 'Max reconnect attempts reached' });
      // Mark query as stopped on max reconnect failure
      this.queryStates.set(queryId, { status: 'stopped', connected: false });
      this.emit('query-state-change', { queryId, status: 'stopped', connected: false });
      return;
    }

    this.log('INFO', `Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`, queryId);
    this.emit('reconnecting', { queryId, attempt: pageState.reconnectAttempts });

    await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY_MS));

    // Re-check if query should still be running after delay
    const currentState = this.queryStates.get(queryId);
    if (!currentState || currentState.status === 'stopped') return;

    try {
      // Close old page if it exists
      if (pageState.page && !pageState.page.isClosed()) {
        await pageState.page.close().catch(() => {});
      }

      // Create new page
      const newPage = await this.setupPage(queryId, queryName);
      if (!newPage) return;

      pageState.page = newPage;

      // Reconnect
      await this.connectQuery(queryId, queryName, newPage);
    } catch (err) {
      this.log('ERROR', `Reconnect failed: ${err.message}`, queryId);
      await this.reconnectQuery(queryId, queryName);
    }
  }

  startHealthCheck() {
    this.healthCheckInterval = setInterval(async () => {
      if (!this.running || !this.browser) return;

      for (const [queryId, pageState] of this.pages.entries()) {
        if (!pageState.connected || !pageState.page) continue;

        try {
          // Simple health check - try to evaluate something on the page
          await pageState.page.evaluate(() => document.readyState);
        } catch (err) {
          this.log('WARN', `Health check failed: ${err.message}`, queryId);
          this.emit('disconnected', { queryId });
          await this.reconnectQuery(queryId, pageState.queryName);
        }
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  async start() {
    if (this.running) {
      this.log('WARN', 'Sniper is already running');
      return;
    }

    const { poesessid, league, queries } = this.config;

    if (!poesessid) {
      this.log('ERROR', 'POESESSID is required');
      return;
    }

    if (!queries || queries.length === 0) {
      this.log('ERROR', 'At least one query is required');
      return;
    }

    this.running = true;
    this.emit('status-change', { running: true });

    this.log('INFO', '='.repeat(60));
    this.log('INFO', 'Divinge Starting (Optimized Direct HTTP)');
    this.log('INFO', `League: ${decodeURIComponent(league)}`);
    this.log('INFO', `Monitoring ${queries.length} search(es): ${queries.map(q => q.id || q).join(', ')}`);
    this.log('INFO', '='.repeat(60));

    try {
      const executablePath = findBrowserExecutable();
      if (!executablePath) {
        this.log('ERROR', 'No browser found! Please install Chrome or Edge.');
        this.emit('error', { error: 'No browser found. Please install Chrome or Microsoft Edge.' });
        this.running = false;
        this.emit('status-change', { running: false });
        return;
      }

      this.log('INFO', `Using browser: ${executablePath}`);

      // Use persistent browser profile so cookies/login persist between sessions
      const launchOptions = {
        headless: false, // VISIBLE MODE - shows browser window for debugging
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--disable-blink-features=AutomationControlled',
          // Disable throttling for background tabs
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          // Additional performance flags
          '--disable-hang-monitor',
          '--disable-ipc-flooding-protection',
          '--disable-popup-blocking',
          '--disable-prompt-on-repost',
          '--disable-sync',
          '--disable-translate',
          '--disable-extensions',
          '--disable-default-apps',
          '--disable-client-side-phishing-detection',
          '--disable-component-update',
          '--no-default-browser-check',
          '--disable-features=TranslateUI,OptimizationHints,UseEcoQoSForBackgroundProcess',
        ],
      };

      // Use persistent profile if path provided
      if (this.browserProfilePath) {
        launchOptions.userDataDir = this.browserProfilePath;
        this.log('INFO', `Using persistent browser profile: ${this.browserProfilePath}`);
      }

      this.browser = await puppeteer.launch(launchOptions);

      // Handle browser disconnection
      this.browser.on('disconnected', async () => {
        if (this.running) {
          this.log('ERROR', 'Browser disconnected unexpectedly');
          await this.stop();
        }
      });

      // With persistent browser profile, cookies should be saved from previous sessions
      // Just start the searches - if login is needed, user will see it in the browser window

      // Warm up HTTP connections for faster first response
      await this.warmupConnections();

      this.log('INFO', 'Starting searches (log in via browser window if prompted)...');

      // Start all queries - they share the browser session
      const startPromises = queries.map(async (query) => {
        const queryId = typeof query === 'string' ? query : query.id;
        const queryName = typeof query === 'string' ? query : (query.name || query.id);

        // Initialize query state
        this.queryStates.set(queryId, { status: 'running', connected: false });
        this.emit('query-state-change', { queryId, status: 'running', connected: false });

        const page = await this.setupPage(queryId, queryName);
        if (!page) return;

        this.pages.set(queryId, {
          page,
          queryName,
          connected: false,
          reconnectAttempts: 0,
        });

        await this.connectQuery(queryId, queryName, page);
      });

      await Promise.all(startPromises);

      // Start health check
      this.startHealthCheck();

      this.log('INFO', 'Sniper running. Waiting for listings...');

    } catch (err) {
      this.log('ERROR', `Failed to start: ${err.message}`);
      this.emit('error', { error: err.message });
      await this.stop();
    }
  }

  async stop() {
    if (!this.running && !this.browser) {
      return;
    }

    this.log('INFO', 'Stopping sniper...');
    this.running = false;

    // Stop health check
    this.stopHealthCheck();

    // Close all pages
    for (const [queryId, pageState] of this.pages.entries()) {
      if (pageState.page && !pageState.page.isClosed()) {
        try {
          await pageState.page.close();
        } catch (e) {
          // Ignore close errors
        }
      }
    }
    this.pages.clear();
    this.queryStates.clear();

    // Close browser - try gracefully first, then force kill
    if (this.browser) {
      try {
        // Get the browser process before closing
        const browserProcess = this.browser.process();

        // Try graceful close first
        await this.browser.close().catch(() => {});

        // If process still exists, force kill it
        if (browserProcess && !browserProcess.killed) {
          this.log('INFO', 'Force killing browser process...');
          browserProcess.kill('SIGKILL');
        }
      } catch (e) {
        this.log('WARN', `Error closing browser: ${e.message}`);
      }
      this.browser = null;
    }

    this.seenTokens.clear();
    this.processingIds.clear();

    this.emit('status-change', { running: false });
    this.log('INFO', 'Sniper stopped.');
  }

  isRunning() {
    return this.running;
  }
}
