import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import puppeteer from 'puppeteer-core';
import player from 'play-sound';
import { findBrowserExecutable } from './browser-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 5000;
const HEALTH_CHECK_INTERVAL_MS = 30000;

export class TradeSniper extends EventEmitter {
  constructor(config, options = {}) {
    super();
    this.config = config;
    this.browser = null;
    this.pages = new Map(); // queryId -> { page, connected, reconnectAttempts }
    this.running = false;
    this.seenTokens = new Set();
    this.healthCheckInterval = null;

    // Sound setup
    this.soundPlayer = player({});
    this.soundFilePath = options.soundFilePath || join(__dirname, '..', 'alert.wav');
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

  async triggerWhisper(hideoutToken, page) {
    try {
      // Make the whisper request from within the page context to use the same session cookies
      const result = await page.evaluate(async (token) => {
        try {
          const response = await fetch('https://www.pathofexile.com/api/trade2/whisper', {
            method: 'POST',
            headers: {
              'Accept': '*/*',
              'Content-Type': 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: JSON.stringify({ token }),
            credentials: 'include', // Include cookies
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
        throw new Error(`Whisper failed: ${result.status || ''} - ${result.message}`);
      }

      return result.data;
    } catch (err) {
      throw err;
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

    client.on('Network.webSocketFrameReceived', (params) => {
      try {
        const payload = params.response?.payloadData;
        if (payload && payload.includes('new')) {
          this.log('INFO', `WebSocket received new items notification`, queryId);
        }
      } catch (e) {
        // Ignore parse errors
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
      if (this.running && this.pages.has(queryId)) {
        this.log('WARN', 'Page closed unexpectedly', queryId);
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
      // Log trade API requests
      if (url.includes('/api/trade2/')) {
        this.log('DEBUG', `Request: ${url}`, queryId);
      }
      request.continue();
    });

    page.on('response', async (response) => {
      const url = response.url();

      // Log trade API responses
      if (url.includes('/api/trade2/')) {
        this.log('DEBUG', `Response: ${url} - ${response.status()}`, queryId);
      }

      if (url.includes('/api/trade2/fetch')) {
        try {
          const data = await response.json();
          this.log('DEBUG', `Fetch response: ${data.result?.length || 0} items`, queryId);

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

      // Additional wait to ensure WebSocket is established
      await new Promise(resolve => setTimeout(resolve, 2000));

      this.log('SUCCESS', 'Live search connected', queryId);
      this.emit('connected', { queryId, queryName });

      // Update page state
      const pageState = this.pages.get(queryId);
      if (pageState) {
        pageState.connected = true;
        pageState.reconnectAttempts = 0;
      }

      return true;
    } catch (err) {
      this.log('ERROR', `Failed to load page: ${err.message}`, queryId);
      this.emit('error', { queryId, error: err.message });
      return false;
    }
  }

  async reconnectQuery(queryId, queryName) {
    if (!this.running) return;

    const pageState = this.pages.get(queryId);
    if (!pageState) return;

    pageState.connected = false;
    pageState.reconnectAttempts++;

    if (pageState.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      this.log('ERROR', `Max reconnect attempts reached for ${queryId}. Giving up.`, queryId);
      this.emit('error', { queryId, error: 'Max reconnect attempts reached' });
      return;
    }

    this.log('INFO', `Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`, queryId);
    this.emit('reconnecting', { queryId, attempt: pageState.reconnectAttempts });

    await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY_MS));

    if (!this.running) return;

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
    this.log('INFO', 'PoE2 Trade Sniper Starting');
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

      // Use visible browser for debugging - can switch to headless: 'new' for production
      this.browser = await puppeteer.launch({
        headless: false, // VISIBLE MODE - shows browser window for debugging
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--disable-blink-features=AutomationControlled', // Hide automation
        ],
      });

      // Handle browser disconnection
      this.browser.on('disconnected', async () => {
        if (this.running) {
          this.log('ERROR', 'Browser disconnected unexpectedly');
          await this.stop();
        }
      });

      // First, open a page and ensure we're logged in
      const firstPage = await this.browser.newPage();
      await firstPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

      // Set cookies from config if available
      const cookies = this.getCookies();
      if (cookies.length > 0) {
        await firstPage.setCookie(...cookies);
      }

      // Navigate to trade site to check if logged in
      this.log('INFO', 'Checking login status...');
      await firstPage.goto('https://www.pathofexile.com/trade2/search/poe2/Standard', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Check if we need to log in (look for login button or account name)
      const needsLogin = await firstPage.evaluate(() => {
        const loginBtn = document.querySelector('a[href*="login"], .login-btn, [class*="login"]');
        const accountName = document.querySelector('.profile-link, .account-name, [class*="account"]');
        return loginBtn && !accountName;
      });

      if (needsLogin) {
        this.log('WARN', '>>> Please log in to the PoE website in the browser window <<<');
        this.emit('log', { level: 'WARN', message: 'Waiting for login... Please log in to the browser window.' });

        // Wait for login (check every 2 seconds for up to 2 minutes)
        let loggedIn = false;
        for (let i = 0; i < 60; i++) {
          await new Promise(resolve => setTimeout(resolve, 2000));

          const isLoggedIn = await firstPage.evaluate(() => {
            const accountName = document.querySelector('.profile-link, .account-name, [class*="account"]');
            const loginBtn = document.querySelector('a[href*="login"], .login-btn');
            return accountName || !loginBtn;
          }).catch(() => false);

          if (isLoggedIn) {
            loggedIn = true;
            this.log('SUCCESS', 'Login detected! Starting searches...');
            break;
          }
        }

        if (!loggedIn) {
          this.log('ERROR', 'Login timeout. Please restart and try again.');
          await this.stop();
          return;
        }
      } else {
        this.log('SUCCESS', 'Already logged in!');
      }

      // Close the check page
      await firstPage.close();

      // Now start all queries - they'll share the browser session
      const startPromises = queries.map(async (query) => {
        const queryId = typeof query === 'string' ? query : query.id;
        const queryName = typeof query === 'string' ? query : (query.name || query.id);

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

    // Close browser
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (e) {
        // Ignore close errors
      }
      this.browser = null;
    }

    this.seenTokens.clear();

    this.emit('status-change', { running: false });
    this.log('INFO', 'Sniper stopped.');
  }

  isRunning() {
    return this.running;
  }
}
