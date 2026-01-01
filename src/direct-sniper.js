// ========================================
// Direct WebSocket Sniper
// No browser - connects directly to trade WebSocket
// Much faster than Puppeteer-based approach
// ========================================

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import player from 'play-sound';
import { LRUCache } from './lru-cache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 3000;
const PING_INTERVAL_MS = 30000;
const MAX_SEEN_TOKENS = 10000;

export class DirectSniper extends EventEmitter {
  constructor(config, options = {}) {
    super();
    this.config = config;
    this.sockets = new Map(); // queryId -> { ws, connected, reconnectAttempts, pingInterval }
    this.queryStates = new Map(); // queryId -> { status: 'stopped' | 'running' | 'paused', connected: boolean }
    this.running = false;
    this.seenTokens = new LRUCache(MAX_SEEN_TOKENS);

    // Sound setup
    this.soundPlayer = player({});
    this.soundFilePath = options.soundFilePath || join(__dirname, '..', 'alert.wav');

    // Teleport cooldown
    this.lastTeleportTime = 0;
    this.teleportCooldownMs = config.teleportCooldownMs || 5000;
  }

  // Per-query control methods
  startQuery(queryId) {
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

    // Mark sniper as running if not already
    if (!this.running) {
      this.running = true;
      this.emit('status-change', { running: true });
    }

    this.log('INFO', `Starting query: ${queryId}`, queryId);
    this.connectQuery(queryId, queryName);
  }

  stopQuery(queryId) {
    const socketState = this.sockets.get(queryId);
    if (socketState) {
      if (socketState.pingInterval) {
        clearInterval(socketState.pingInterval);
      }
      if (socketState.ws) {
        try { socketState.ws.terminate(); } catch (e) {}
      }
      this.sockets.delete(queryId);
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
      this.running = false;
      this.emit('status-change', { running: false });
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

  log(level, message, queryId = null) {
    const timestamp = new Date().toISOString();
    const prefix = queryId ? `[${queryId}]` : '';
    const logMessage = `${timestamp} [${level}]${prefix} ${message}`;
    this.emit('log', { level, message, queryId, timestamp, formatted: logMessage });
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
    const cookieString = this.getCookieString();
    const { league } = this.config;
    const response = await fetch('https://www.pathofexile.com/api/trade2/whisper', {
      method: 'POST',
      headers: {
        'Accept': '*/*',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': cookieString,
        'Origin': 'https://www.pathofexile.com',
        'Referer': `https://www.pathofexile.com/trade2/search/poe2/${league}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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

  async fetchItems(itemIds, queryId, queryName) {
    const { league } = this.config;
    const fetchUrl = `https://www.pathofexile.com/api/trade2/fetch/${itemIds.join(',')}?query=${queryId}&realm=poe2`;
    const cookieString = this.getCookieString();

    const response = await fetch(fetchUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': cookieString,
        'Origin': 'https://www.pathofexile.com',
        'Referer': `https://www.pathofexile.com/trade2/search/poe2/${league}/${queryId}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status}`);
    }

    const result = await response.json();

    if (result.result && Array.isArray(result.result)) {
      for (const item of result.result) {
        await this.processItem(item, queryId, queryName);
      }
    }
  }

  async processItem(item, queryId, queryName) {
    const hideoutToken = item?.listing?.hideout_token;
    if (!hideoutToken || this.seenTokens.has(hideoutToken)) return;

    // LRU cache automatically evicts oldest entries when limit reached
    this.seenTokens.add(hideoutToken);

    const startTime = Date.now();
    const price = item.listing?.price
      ? `${item.listing.price.amount} ${item.listing.price.currency}`
      : 'No price';
    const itemName = item.item?.name || item.item?.typeLine || 'Unknown';
    const account = item.listing?.account?.name || 'Unknown';

    // Emit listing event
    this.emit('listing', { queryId, queryName, itemName, price, account, hideoutToken });

    // Check per-query pause state
    const queryState = this.queryStates.get(queryId);
    if (queryState?.status === 'paused') {
      this.log('INFO', `[PAUSED] ${itemName} @ ${price} from ${account}`, queryId);
      return;
    }

    // Check cooldown
    const now = Date.now();
    const timeSinceLastTeleport = now - this.lastTeleportTime;
    if (timeSinceLastTeleport < this.teleportCooldownMs) {
      const remaining = Math.ceil((this.teleportCooldownMs - timeSinceLastTeleport) / 1000);
      this.log('WARN', `SKIPPED teleport (cooldown ${remaining}s) - ${itemName}`, queryId);
      return;
    }

    // Mark teleport time immediately
    this.lastTeleportTime = now;

    this.log('INFO', `>>> SNIPED: ${itemName} @ ${price} from ${account} <<<`, queryId);

    // Fire teleport
    try {
      await this.triggerWhisper(hideoutToken);
      const elapsed = Date.now() - startTime;
      this.log('SUCCESS', `TELEPORT in ${elapsed}ms`, queryId);
      this.emit('teleport', { queryId, elapsed, itemName, price });
    } catch (err) {
      this.log('ERROR', `Whisper failed: ${err.message}`, queryId);
      this.emit('error', { queryId, error: err.message });
      this.lastTeleportTime = 0; // Reset cooldown on failure
    }
  }

  connectQuery(queryId, queryName) {
    const { league } = this.config;
    const wsUrl = `wss://www.pathofexile.com/api/trade2/live/poe2/${encodeURIComponent(league)}/${queryId}`;
    const cookieString = this.getCookieString();

    this.log('INFO', `Connecting to WebSocket: ${queryId}`, queryId);

    const ws = new WebSocket(wsUrl, {
      headers: {
        'Cookie': cookieString,
        'Origin': 'https://www.pathofexile.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });

    const socketState = {
      ws,
      queryName,
      connected: false,
      reconnectAttempts: 0,
      pingInterval: null,
    };

    ws.on('open', () => {
      this.log('SUCCESS', `WebSocket connected`, queryId);
      socketState.connected = true;
      socketState.reconnectAttempts = 0;

      // Update query state
      const queryState = this.queryStates.get(queryId);
      if (queryState) {
        queryState.connected = true;
        this.emit('query-state-change', { queryId, status: queryState.status, connected: true });
      }

      this.emit('connected', { queryId, queryName });

      // Start ping to keep connection alive
      socketState.pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, PING_INTERVAL_MS);
    });

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.new && Array.isArray(message.new) && message.new.length > 0) {
          const itemIds = message.new;
          this.log('INFO', `${itemIds.length} new item(s) - fetching...`, queryId);

          // Fetch and process items immediately
          this.fetchItems(itemIds, queryId, queryName).catch(err => {
            this.log('ERROR', `Fetch failed: ${err.message}`, queryId);
          });
        }
      } catch (e) {
        // Not JSON, ignore
      }
    });

    ws.on('close', (code, reason) => {
      this.log('WARN', `WebSocket closed: ${code} ${reason}`, queryId);
      socketState.connected = false;
      if (socketState.pingInterval) {
        clearInterval(socketState.pingInterval);
        socketState.pingInterval = null;
      }

      // Update query state
      const queryState = this.queryStates.get(queryId);
      if (queryState) {
        queryState.connected = false;
        this.emit('query-state-change', { queryId, status: queryState.status, connected: false });
      }

      this.emit('disconnected', { queryId });

      // Only reconnect if this specific query should still be running
      if (queryState && (queryState.status === 'running' || queryState.status === 'paused')) {
        this.reconnectQuery(queryId, queryName, socketState);
      }
    });

    ws.on('error', (err) => {
      this.log('ERROR', `WebSocket error: ${err.message}`, queryId);
    });

    this.sockets.set(queryId, socketState);
  }

  async reconnectQuery(queryId, queryName, socketState) {
    // Check if this specific query should still be running
    const queryState = this.queryStates.get(queryId);
    if (!queryState || queryState.status === 'stopped') return;

    socketState.reconnectAttempts++;
    if (socketState.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      this.log('ERROR', `Max reconnect attempts reached`, queryId);
      this.emit('error', { queryId, error: 'Max reconnect attempts reached' });
      // Mark query as stopped on max reconnect failure
      this.queryStates.set(queryId, { status: 'stopped', connected: false });
      this.emit('query-state-change', { queryId, status: 'stopped', connected: false });
      return;
    }

    this.log('INFO', `Reconnecting in ${RECONNECT_DELAY_MS / 1000}s (attempt ${socketState.reconnectAttempts})...`, queryId);
    this.emit('reconnecting', { queryId, attempt: socketState.reconnectAttempts });

    await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY_MS));

    // Re-check if query should still be running after delay
    const currentState = this.queryStates.get(queryId);
    if (!currentState || currentState.status === 'stopped') return;

    // Close old socket if exists
    if (socketState.ws) {
      try {
        socketState.ws.terminate();
      } catch (e) {}
    }

    // Remove old entry and create new connection
    this.sockets.delete(queryId);
    this.connectQuery(queryId, queryName);
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
    this.log('INFO', 'Divinge Starting (Direct WebSocket Mode)');
    this.log('INFO', `League: ${decodeURIComponent(league)}`);
    this.log('INFO', `Monitoring ${queries.length} search(es)`);
    this.log('INFO', '='.repeat(60));

    // Connect all queries
    for (const query of queries) {
      const queryId = typeof query === 'string' ? query : query.id;
      const queryName = typeof query === 'string' ? query : (query.name || query.id);

      // Initialize query state
      this.queryStates.set(queryId, { status: 'running', connected: false });
      this.emit('query-state-change', { queryId, status: 'running', connected: false });

      this.connectQuery(queryId, queryName);
    }

    this.log('INFO', 'Sniper running. Waiting for listings...');
  }

  async stop() {
    if (!this.running) return;

    this.log('INFO', 'Stopping sniper...');
    this.running = false;

    // Close all WebSockets
    for (const [queryId, socketState] of this.sockets.entries()) {
      if (socketState.pingInterval) {
        clearInterval(socketState.pingInterval);
      }
      if (socketState.ws) {
        try {
          socketState.ws.terminate();
        } catch (e) {}
      }
    }
    this.sockets.clear();
    this.queryStates.clear();
    this.seenTokens.clear();

    this.emit('status-change', { running: false });
    this.log('INFO', 'Sniper stopped.');
  }

  isRunning() {
    return this.running;
  }
}
