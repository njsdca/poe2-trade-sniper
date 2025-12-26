import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import puppeteer from 'puppeteer-core';
import player from 'play-sound';
import { findBrowserExecutable } from './browser-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class TradeSniper extends EventEmitter {
  constructor(config, options = {}) {
    super();
    this.config = config;
    this.browser = null;
    this.pages = [];
    this.running = false;
    this.seenTokens = new Set();

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
    if (!this.config.soundEnabled) return;

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

  async triggerWhisper(hideoutToken) {
    const response = await fetch('https://www.pathofexile.com/api/trade2/whisper', {
      method: 'POST',
      headers: {
        'Cookie': this.getCookieString(),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Origin': 'https://www.pathofexile.com',
        'Referer': 'https://www.pathofexile.com/',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ token: hideoutToken }),
    });

    if (!response.ok) {
      const text = await response.text();

      if (response.status === 403) {
        this.log('ERROR', '!!! COOKIE EXPIRED - UPDATE cf_clearance !!!');
        this.emit('cookie-expired');
        this.playSound();
        setTimeout(() => this.playSound(), 500);
        setTimeout(() => this.playSound(), 1000);
      }

      throw new Error(`Whisper failed: ${response.status} - ${text}`);
    }

    return response.json();
  }

  async start() {
    if (this.running) {
      this.log('WARN', 'Sniper is already running');
      return;
    }

    const { poesessid, cf_clearance, league, queries } = this.config;

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
    this.log('INFO', 'PoE2 Trade Sniper Starting (Puppeteer Mode)');
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

      this.browser = await puppeteer.launch({
        headless: true,
        executablePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

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

      for (const query of queries) {
        const queryId = typeof query === 'string' ? query : query.id;
        const queryName = typeof query === 'string' ? query : (query.name || query.id);

        const page = await this.browser.newPage();
        this.pages.push(page);

        await page.setCookie(...cookies);
        await page.setRequestInterception(true);

        page.on('request', (request) => {
          request.continue();
        });

        page.on('response', async (response) => {
          const url = response.url();

          if (url.includes('/api/trade2/fetch')) {
            try {
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

                    try {
                      await this.triggerWhisper(hideoutToken);
                      const elapsed = Date.now() - startTime;
                      this.log('SUCCESS', `TELEPORT TRIGGERED in ${elapsed}ms!`, queryId);
                      this.emit('teleport', { queryId, elapsed, itemName, price });
                      this.playSound();
                    } catch (err) {
                      this.log('ERROR', `Whisper failed: ${err.message}`, queryId);
                      this.emit('error', { queryId, error: err.message });
                    }
                  }
                }
              }
            } catch (e) {
              // Response might not be JSON, ignore
            }
          }
        });

        const searchUrl = `https://www.pathofexile.com/trade2/search/poe2/${league}/${queryId}/live`;
        this.log('INFO', `Opening live search: ${searchUrl}`, queryId);

        try {
          await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
          this.log('SUCCESS', 'Live search page loaded', queryId);
          this.emit('connected', { queryId, queryName });
        } catch (err) {
          this.log('ERROR', `Failed to load page: ${err.message}`, queryId);
          this.emit('error', { queryId, error: err.message });
        }
      }

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

    if (this.browser) {
      try {
        await this.browser.close();
      } catch (e) {
        // Ignore close errors
      }
      this.browser = null;
    }

    this.pages = [];
    this.seenTokens.clear();

    this.emit('status-change', { running: false });
    this.log('INFO', 'Sniper stopped.');
  }

  isRunning() {
    return this.running;
  }
}
