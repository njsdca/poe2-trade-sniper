import puppeteer from 'puppeteer-core';
import { EventEmitter } from 'events';
import { findBrowserExecutable } from './browser-utils.js';

export class CookieExtractor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.browser = null;
    this.browserProfilePath = options.browserProfilePath || null;
  }

  async extract() {
    this.emit('status', 'Launching browser...');

    const executablePath = findBrowserExecutable();
    if (!executablePath) {
      throw new Error('No browser found. Please install Chrome or Microsoft Edge.');
    }

    console.log('[CookieExtractor] Browser executable:', executablePath);
    console.log('[CookieExtractor] Browser profile path:', this.browserProfilePath);

    try {
      // Launch visible browser with persistent profile (same as sniper uses)
      const launchOptions = {
        headless: false,
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--window-size=1200,800',
          '--disable-blink-features=AutomationControlled',
        ],
        defaultViewport: null,
      };

      // Use persistent profile if provided
      if (this.browserProfilePath) {
        launchOptions.userDataDir = this.browserProfilePath;
        console.log('[CookieExtractor] Using persistent profile:', this.browserProfilePath);
      } else {
        console.log('[CookieExtractor] WARNING: No browser profile path provided!');
      }

      this.browser = await puppeteer.launch(launchOptions);

      const page = await this.browser.newPage();

      this.emit('status', 'Opening Path of Exile website...');

      // Navigate to trade site (requires login)
      await page.goto('https://www.pathofexile.com/trade2/search/poe2/Standard', {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });

      this.emit('status', 'Please log in if prompted. Waiting for cookies...');

      // Wait for user to log in and cookies to be set
      // Poll for POESESSID cookie
      let cookies = null;
      let attempts = 0;
      const maxAttempts = 120; // 2 minutes

      while (attempts < maxAttempts) {
        const allCookies = await page.cookies();

        // Debug: log all cookies on first attempt
        if (attempts === 0) {
          console.log('[CookieExtractor] Found cookies:', allCookies.map(c => c.name).join(', '));
        }

        const poesessid = allCookies.find(c => c.name === 'POESESSID');
        const cfClearance = allCookies.find(c => c.name === 'cf_clearance');

        if (poesessid) {
          cookies = {
            poesessid: poesessid.value,
            cf_clearance: cfClearance ? cfClearance.value : '',
          };
          console.log('[CookieExtractor] POESESSID found:', poesessid.value.substring(0, 8) + '...');
          console.log('[CookieExtractor] cf_clearance found:', cfClearance ? 'YES' : 'NO');

          // Check if we're actually logged in by looking for account info
          const isLoggedIn = await page.evaluate(() => {
            // Look for login indicators
            const accountLink = document.querySelector('a[href*="/account"]');
            const loginLink = document.querySelector('a[href*="/login"]');
            return accountLink !== null || loginLink === null;
          });

          if (isLoggedIn || attempts > 10) {
            this.emit('status', 'Cookies found! Closing browser...');
            break;
          }
        }

        await new Promise(r => setTimeout(r, 1000));
        attempts++;
      }

      // Close browser gracefully - give time to save profile
      console.log('[CookieExtractor] Closing browser...');
      try {
        await this.browser.close();
        // Wait for profile to be saved
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) {
        console.log('[CookieExtractor] Graceful close failed, force killing...');
        const browserProcess = this.browser.process();
        if (browserProcess && !browserProcess.killed) {
          browserProcess.kill('SIGTERM');
        }
      }
      this.browser = null;
      console.log('[CookieExtractor] Browser closed');

      if (cookies && cookies.poesessid) {
        this.emit('success', cookies);
        return cookies;
      } else {
        throw new Error('Could not find POESESSID cookie. Make sure you logged in.');
      }

    } catch (error) {
      if (this.browser) {
        try {
          await this.browser.close();
        } catch (e) {
          const browserProcess = this.browser.process();
          if (browserProcess && !browserProcess.killed) {
            browserProcess.kill('SIGTERM');
          }
        }
        this.browser = null;
      }
      this.emit('error', error.message);
      throw error;
    }
  }

  async cancel() {
    if (this.browser) {
      try {
        await this.browser.close();
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        const browserProcess = this.browser.process();
        if (browserProcess && !browserProcess.killed) {
          browserProcess.kill('SIGTERM');
        }
      }
      this.browser = null;
    }
  }
}
