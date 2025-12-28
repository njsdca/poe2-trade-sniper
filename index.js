import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import puppeteer from 'puppeteer-core';
import player from 'play-sound';
import { findBrowserExecutable } from './src/browser-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Configuration
// ============================================================================

const configPath = join(__dirname, 'config.json');
if (!existsSync(configPath)) {
  console.error('[ERROR] config.json not found. Please create it from the template.');
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, 'utf-8'));

if (!config.poesessid || config.poesessid === 'YOUR_POESESSID_HERE') {
  console.error('[ERROR] Please set your POESESSID in config.json');
  process.exit(1);
}

if (!config.queries || config.queries.length === 0) {
  console.error('[ERROR] Please add at least one query ID to config.json');
  process.exit(1);
}

const {
  poesessid,
  cf_clearance,
  league,
  queries,
  soundEnabled = true,
} = config;

// ============================================================================
// Logging
// ============================================================================

function log(level, message, queryId = null) {
  const timestamp = new Date().toISOString();
  const prefix = queryId ? `[${queryId}]` : '';
  console.log(`${timestamp} [${level}]${prefix} ${message}`);
}

// ============================================================================
// Sound Notification
// ============================================================================

const soundPlayer = player({});
const soundFilePath = join(__dirname, 'alert.wav');

function playSound() {
  if (!soundEnabled) return;

  if (!existsSync(soundFilePath)) {
    process.stdout.write('\x07'); // Terminal bell
    return;
  }

  soundPlayer.play(soundFilePath, (err) => {
    if (err) log('ERROR', `Failed to play sound: ${err.message}`);
  });
}

// ============================================================================
// Whisper API
// ============================================================================

const cookieString = cf_clearance
  ? `POESESSID=${poesessid}; cf_clearance=${cf_clearance}`
  : `POESESSID=${poesessid}`;

async function triggerWhisper(hideoutToken) {
  const response = await fetch('https://www.pathofexile.com/api/trade2/whisper', {
    method: 'POST',
    headers: {
      'Cookie': cookieString,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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

    // Detect cookie expiration
    if (response.status === 403) {
      log('ERROR', '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
      log('ERROR', '!!! COOKIE EXPIRED - UPDATE cf_clearance IN config.json !!!');
      log('ERROR', '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
      // Play alert sound multiple times
      playSound();
      setTimeout(() => playSound(), 500);
      setTimeout(() => playSound(), 1000);
    }

    throw new Error(`Whisper failed: ${response.status} - ${text}`);
  }

  return response.json();
}

// ============================================================================
// Main - Puppeteer Browser Automation
// ============================================================================

let browser = null;

async function main() {
  log('INFO', '='.repeat(60));
  log('INFO', 'Divinge Starting (Puppeteer Mode)');
  log('INFO', `League: ${decodeURIComponent(league)}`);
  log('INFO', `Monitoring ${queries.length} search(es): ${queries.join(', ')}`);
  log('INFO', '='.repeat(60));

  // Find browser
  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    log('ERROR', 'No browser found! Please install Chrome or Microsoft Edge.');
    process.exit(1);
  }
  log('INFO', `Using browser: ${executablePath}`);

  // Launch browser
  browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  // Set cookies
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

  // Create a page for each query
  for (const queryId of queries) {
    const page = await browser.newPage();

    // Set cookies before navigation
    await page.setCookie(...cookies);

    // Set up request interception to capture hideout tokens
    await page.setRequestInterception(true);

    const seenTokens = new Set();

    page.on('request', (request) => {
      request.continue();
    });

    page.on('response', async (response) => {
      const url = response.url();

      // Capture fetch responses that contain hideout_token
      if (url.includes('/api/trade2/fetch')) {
        try {
          const data = await response.json();

          if (data.result && Array.isArray(data.result)) {
            for (const item of data.result) {
              const hideoutToken = item?.listing?.hideout_token;

              if (hideoutToken && !seenTokens.has(hideoutToken)) {
                seenTokens.add(hideoutToken);

                const startTime = Date.now();
                const price = item.listing?.price
                  ? `${item.listing.price.amount} ${item.listing.price.currency}`
                  : 'No price';
                const itemName = item.item?.name || item.item?.typeLine || 'Unknown';
                const account = item.listing?.account?.name || 'Unknown';

                log('INFO', `>>> NEW LISTING: ${itemName} @ ${price} from ${account} <<<`, queryId);

                try {
                  await triggerWhisper(hideoutToken);
                  const elapsed = Date.now() - startTime;
                  log('SUCCESS', `TELEPORT TRIGGERED in ${elapsed}ms!`, queryId);
                  playSound();
                } catch (err) {
                  log('ERROR', `Whisper failed: ${err.message}`, queryId);
                }
              }
            }
          }
        } catch (e) {
          // Response might not be JSON, ignore
        }
      }
    });

    // Navigate to the live search page
    const searchUrl = `https://www.pathofexile.com/trade2/search/poe2/${league}/${queryId}/live`;
    log('INFO', `Opening live search: ${searchUrl}`, queryId);

    try {
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      log('SUCCESS', 'Live search page loaded', queryId);
    } catch (err) {
      log('ERROR', `Failed to load page: ${err.message}`, queryId);
    }
  }

  log('INFO', 'Sniper running. Press Ctrl+C to stop.');
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function shutdown() {
  log('INFO', 'Shutting down...');

  if (browser) {
    await browser.close();
  }

  log('INFO', 'Goodbye!');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start
main().catch((err) => {
  log('ERROR', `Fatal error: ${err.message}`);
  process.exit(1);
});
