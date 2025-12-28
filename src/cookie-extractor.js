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
      }

      this.browser = await puppeteer.launch(launchOptions);

      const page = await this.browser.newPage();

      this.emit('status', 'Opening Path of Exile website...');

      // Navigate to trade site (requires login)
      await page.goto('https://www.pathofexile.com/trade2/search/poe2/Standard', {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });

      // Check if user is ACTUALLY logged in (not just has old cookies)
      const checkLoggedIn = async () => {
        return await page.evaluate(() => {
          // PoE website uses various selectors for logged-in state
          // Look for account/profile links that only appear when logged in
          const accountSelectors = [
            'a[href*="/my-account"]',
            'a[href*="/account"]',
            '.profile-link',
            '.user-profile',
            '.account-name',
            '.logged-in',
            '[class*="account"]',
            '[class*="profile"]'
          ];

          // Look for login/signin elements that appear when NOT logged in
          const loginSelectors = [
            'a[href*="/login"]',
            'a[href*="/signin"]',
            '.login-btn',
            '.sign-in',
            'a.login',
            '[class*="login"]',
            '[class*="sign-in"]'
          ];

          let hasAccountElement = false;
          let hasLoginElement = false;

          for (const selector of accountSelectors) {
            const el = document.querySelector(selector);
            if (el && el.offsetParent !== null) { // visible element
              hasAccountElement = true;
              break;
            }
          }

          for (const selector of loginSelectors) {
            const el = document.querySelector(selector);
            if (el && el.offsetParent !== null) { // visible element
              hasLoginElement = true;
              break;
            }
          }

          // Log what we found for debugging
          console.log('[LoginCheck] Account element found:', hasAccountElement, 'Login element found:', hasLoginElement);

          // User is logged in if we see account element and no login element
          // OR if we simply don't see a login element (some pages hide it completely when logged in)
          return hasAccountElement && !hasLoginElement;
        });
      };

      // Check for Cloudflare challenge
      const isCloudflareChallenge = async () => {
        return await page.evaluate(() => {
          const title = document.title.toLowerCase();
          const body = document.body?.innerText?.toLowerCase() || '';
          return title.includes('cloudflare') ||
                 title.includes('just a moment') ||
                 body.includes('checking your browser') ||
                 body.includes('verify you are human');
        });
      };

      // Check if on login page
      const isOnLoginPage = async () => {
        const url = page.url();
        return url.includes('/login') || url.includes('/signin') || url.includes('oauth');
      };

      // Wait for any Cloudflare challenge to complete
      let cfAttempts = 0;
      let isCfChallenge = true;
      while (isCfChallenge && cfAttempts < 60) {
        try {
          isCfChallenge = await isCloudflareChallenge();
          if (isCfChallenge) {
            if (cfAttempts === 0) {
              this.emit('status', 'Completing Cloudflare check...');
            }
            await new Promise(r => setTimeout(r, 1000));
            cfAttempts++;
          }
        } catch (e) {
          // Page navigating, wait and retry
          await new Promise(r => setTimeout(r, 1000));
          cfAttempts++;
        }
      }

      // First check if already logged in
      let isLoggedIn = false;
      let onLoginPage = true;
      try {
        isLoggedIn = await checkLoggedIn();
        onLoginPage = await isOnLoginPage();
      } catch (e) {
        // Page navigating, will retry
      }

      if (isLoggedIn && !onLoginPage) {
        this.emit('status', 'Already logged in! Extracting cookies...');
      } else {
        this.emit('status', 'Please log in to Path of Exile...');

        // Wait for user to complete login (up to 3 minutes)
        let attempts = 0;
        const maxAttempts = 180;

        while (attempts < maxAttempts && (!isLoggedIn || onLoginPage)) {
          await new Promise(r => setTimeout(r, 1000));
          attempts++;

          try {
            // Check login status every second
            isLoggedIn = await checkLoggedIn();
            onLoginPage = await isOnLoginPage();

            // Also wait through Cloudflare challenges
            if (await isCloudflareChallenge()) {
              this.emit('status', 'Completing Cloudflare check...');
              continue;
            }

          } catch (evalError) {
            // Page navigated (OAuth redirect, etc.) - context destroyed, just wait and retry
            this.emit('status', 'Following login redirects...');
            continue;
          }
        }

        if (!isLoggedIn) {
          throw new Error('Login timed out. Please try again and complete the login process.');
        }

        this.emit('status', 'Login detected! Extracting cookies...');
      }

      // Now get the cookies
      const allCookies = await page.cookies();

      const poesessid = allCookies.find(c => c.name === 'POESESSID');
      const cfClearance = allCookies.find(c => c.name === 'cf_clearance');

      let cookies = null;
      if (poesessid) {
        cookies = {
          poesessid: poesessid.value,
          cf_clearance: cfClearance ? cfClearance.value : '',
        };
      }

      this.emit('status', 'Cookies extracted! Closing browser...');

      // Close browser gracefully - give time to save profile
      try {
        await this.browser.close();
        // Wait for profile to be saved
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) {
        const browserProcess = this.browser.process();
        if (browserProcess && !browserProcess.killed) {
          browserProcess.kill('SIGTERM');
        }
      }
      this.browser = null;

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
