import { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, dialog, globalShortcut } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import electronUpdater from 'electron-updater';
import player from 'play-sound';
import { autoPurchase } from './src/auto-purchase.js';

const { autoUpdater } = electronUpdater;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow = null;
let tray = null;
let sniper = null;
let sniperRunning = false;
let cookieExtractor = null;

// Use userData directory for config (writable location)
// This resolves to: Windows: %APPDATA%\Divinge, macOS: ~/Library/Application Support/Divinge
const getConfigPath = () => join(app.getPath('userData'), 'config.json');
const getBrowserProfilePath = () => join(app.getPath('userData'), 'browser-profile');
const soundPlayer = player({});

// Default config
const defaultConfig = {
  poesessid: '',
  cf_clearance: '',
  league: 'Fate%20of%20the%20Vaal',
  queries: [],
  soundEnabled: true,
  startMinimized: false,
  autoStart: false,
  autoPurchase: false, // Auto-purchase items after teleport
  reconnectDelayMs: 5000,
  fetchDelayMs: 100,
  teleportCooldownMs: 5000, // 5 second cooldown between teleports
};

function loadConfig() {
  const configPath = getConfigPath();
  try {
    if (existsSync(configPath)) {
      const data = JSON.parse(readFileSync(configPath, 'utf-8'));
      return { ...defaultConfig, ...data };
    }
  } catch (e) {
    console.error('Failed to load config:', e);
  }
  return { ...defaultConfig };
}

function saveConfig(config) {
  const configPath = getConfigPath();
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    return true;
  } catch (e) {
    console.error('Failed to save config:', e);
    return false;
  }
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

function playAlertSound() {
  const config = loadConfig();
  if (!config.soundEnabled) return;

  // Sound is primarily handled by renderer's Web Audio API
  // This is a fallback for system notifications
  const soundPath = join(__dirname, 'alert.wav');
  if (existsSync(soundPath)) {
    soundPlayer.play(soundPath, (err) => {
      if (err) console.error('Failed to play sound:', err);
    });
  }
}

function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: sniperRunning ? 'Stop Sniper' : 'Start Sniper',
      click: async () => {
        if (sniperRunning) {
          await stopSniper();
        } else {
          await startSniper();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip(sniperRunning ? 'Divinge - Running' : 'Divinge - Stopped');
}

async function startSniper() {
  if (sniperRunning) return;

  const config = loadConfig();

  // Dynamic import for ES module
  const { TradeSniper } = await import('./src/sniper.js');

  sniper = new TradeSniper(config, {
    soundFilePath: join(__dirname, 'alert.wav'),
    browserProfilePath: getBrowserProfilePath(),
  });

  // Forward events to renderer
  sniper.on('log', (data) => {
    sendToRenderer('log', data);
  });

  sniper.on('listing', (data) => {
    sendToRenderer('listing', data);
    showNotification('New Listing!', `${data.itemName} @ ${data.price}`);
  });

  sniper.on('teleport', async (data) => {
    sendToRenderer('teleport', data);

    // Auto-purchase if enabled
    const currentConfig = loadConfig();
    if (currentConfig.autoPurchase) {
      try {
        const result = await autoPurchase();
        if (result.success) {
          sendToRenderer('log', { level: 'SUCCESS', message: `Auto-purchased item at (${result.position.x}, ${result.position.y})` });
        } else {
          sendToRenderer('log', { level: 'WARN', message: `Auto-purchase failed: ${result.reason}` });
        }
      } catch (err) {
        sendToRenderer('log', { level: 'ERROR', message: `Auto-purchase error: ${err.message}` });
      }
    }
  });

  sniper.on('connected', (data) => {
    sendToRenderer('connected', data);
  });

  sniper.on('disconnected', (data) => {
    sendToRenderer('disconnected', data);
  });

  sniper.on('reconnecting', (data) => {
    sendToRenderer('reconnecting', data);
  });

  sniper.on('error', (data) => {
    sendToRenderer('error', data);
  });

  sniper.on('cookie-expired', () => {
    sendToRenderer('cookie-expired', {});
    showNotification('Cookie Expired!', 'Please update your cf_clearance cookie');
  });

  sniper.on('status-change', (data) => {
    sniperRunning = data.running;
    sendToRenderer('status-change', data);
    updateTrayMenu();
  });

  await sniper.start();
}

async function stopSniper() {
  if (sniper) {
    await sniper.stop();
    sniper = null;
  }
  sniperRunning = false;
  sendToRenderer('status-change', { running: false });
  updateTrayMenu();
}

function createWindow() {
  const config = loadConfig();

  // Remove the default menu bar (File, Edit, View, etc.)
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 900,
    height: 820,
    minWidth: 900,
    minHeight: 820,
    maxWidth: 900,
    maxHeight: 820,
    resizable: false,
    icon: join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });

  mainWindow.loadFile(join(__dirname, 'src', 'renderer', 'index.html'));

  // Open DevTools in development mode
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.once('ready-to-show', () => {
    // Show window unless startMinimized is enabled
    if (!config.startMinimized) {
      mainWindow.show();
    }
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // Create a simple tray icon (16x16 colored square)
  const iconPath = join(__dirname, 'assets', 'icon.ico');

  // Use a simple nativeImage if ico doesn't exist
  let trayIcon;
  if (existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  } else {
    // Create a simple 16x16 icon
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  updateTrayMenu();

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

function registerHotkeys() {
  // Ctrl+Shift+S to toggle sniper
  globalShortcut.register('CommandOrControl+Shift+S', async () => {
    if (sniperRunning) {
      await stopSniper();
    } else {
      await startSniper();
    }
    sendToRenderer('hotkey', { action: 'toggle' });
  });

  // Ctrl+Shift+H to show/hide window
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// IPC Handlers
ipcMain.handle('get-config', () => {
  return loadConfig();
});

ipcMain.handle('check-setup-complete', () => {
  const config = loadConfig();
  return {
    complete: Boolean(config.poesessid) && config.queries?.length > 0,
    hasAuth: Boolean(config.poesessid),
    hasSearches: config.queries?.length > 0
  };
});

ipcMain.handle('save-config', (event, config) => {
  return saveConfig(config);
});

// Export searches to a JSON file
ipcMain.handle('export-searches', async (event, searches) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Searches',
      defaultPath: 'divinge-searches.json',
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    const exportData = {
      version: app.getVersion(),
      exportedAt: new Date().toISOString(),
      searches: searches
    };

    writeFileSync(result.filePath, JSON.stringify(exportData, null, 2));
    return { success: true, filePath: result.filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Import searches from a JSON file
ipcMain.handle('import-searches', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Searches',
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const fileContent = readFileSync(result.filePaths[0], 'utf-8');
    const importData = JSON.parse(fileContent);

    // Validate the import data
    if (!importData.searches || !Array.isArray(importData.searches)) {
      return { success: false, error: 'Invalid file format: missing searches array' };
    }

    // Validate each search has required fields
    for (const search of importData.searches) {
      if (!search.id) {
        return { success: false, error: 'Invalid file format: search missing id' };
      }
    }

    return { success: true, searches: importData.searches, version: importData.version };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('start-sniper', async () => {
  await startSniper();
  return sniperRunning;
});

ipcMain.handle('stop-sniper', async () => {
  await stopSniper();
  return !sniperRunning;
});

ipcMain.handle('toggle-pause', async (event, paused) => {
  if (sniper) {
    sniper.setPaused(paused);
    return { success: true, paused };
  }
  return { success: false, error: 'Sniper not running' };
});

ipcMain.handle('get-status', () => {
  return { running: sniperRunning };
});

ipcMain.handle('test-sound', () => {
  playAlertSound();
  return { success: true };
});

ipcMain.handle('test-auto-purchase', async () => {
  try {
    const { autoPurchase } = await import('./src/auto-purchase.js');
    const result = await autoPurchase();
    return result;
  } catch (err) {
    console.error('Test auto-purchase error:', err);
    return { success: false, reason: err.message };
  }
});

// Economy API proxy to avoid CORS
const ALLOWED_API_DOMAINS = ['poe2scout.com'];

ipcMain.handle('fetch-economy', async (event, url) => {
  try {
    // Validate URL to prevent SSRF attacks
    const parsedUrl = new URL(url);
    if (!ALLOWED_API_DOMAINS.some(domain => parsedUrl.hostname.endsWith(domain))) {
      throw new Error('Invalid API domain');
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Divinge/1.0 (contact@divinge.app)',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fetch-item-history', async (event, itemId, logCount = 200) => {
  try {
    const config = loadConfig();
    const league = config.league || 'Fate%20of%20the%20Vaal';
    const url = `https://poe2scout.com/api/items/${itemId}/history?league=${league}&logCount=${logCount}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Divinge/1.0 (contact@divinge.app)',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return { success: true, data: data.price_history || [], hasMore: data.has_more };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('extract-cookies', async () => {
  if (cookieExtractor) {
    return { error: 'Cookie extraction already in progress' };
  }

  try {
    const { CookieExtractor } = await import('./src/cookie-extractor.js');
    // Use the same browser profile as the sniper so cookies persist
    cookieExtractor = new CookieExtractor({
      browserProfilePath: getBrowserProfilePath(),
    });

    cookieExtractor.on('status', (status) => {
      sendToRenderer('cookie-extract-status', { status });
    });

    const cookies = await cookieExtractor.extract();
    cookieExtractor = null;

    // Auto-save cookies to config (as backup, but profile has them now)
    const config = loadConfig();
    config.poesessid = cookies.poesessid;
    if (cookies.cf_clearance) {
      config.cf_clearance = cookies.cf_clearance;
    }
    saveConfig(config);

    return { success: true, cookies };
  } catch (error) {
    cookieExtractor = null;
    return { error: error.message };
  }
});

ipcMain.handle('cancel-cookie-extract', async () => {
  if (cookieExtractor) {
    await cookieExtractor.cancel();
    cookieExtractor = null;
  }
  return { success: true };
});

// Auto-updater setup
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('checking-for-update', () => {
  sendToRenderer('update-status', { status: 'checking' });
});

autoUpdater.on('update-available', (info) => {
  sendToRenderer('update-status', { status: 'available', version: info.version });
});

autoUpdater.on('update-not-available', () => {
  sendToRenderer('update-status', { status: 'up-to-date' });
});

autoUpdater.on('download-progress', (progress) => {
  sendToRenderer('update-status', {
    status: 'downloading',
    percent: Math.round(progress.percent)
  });
});

autoUpdater.on('update-downloaded', (info) => {
  sendToRenderer('update-status', { status: 'ready', version: info.version });
});

autoUpdater.on('error', (err) => {
  sendToRenderer('update-status', { status: 'error', error: err.message });
});

ipcMain.handle('check-for-updates', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, version: result?.updateInfo?.version };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('download-update', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('install-update', async () => {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  console.log('Starting update installation...');

  // Mark as quitting first
  app.isQuitting = true;

  // Stop sniper and close browser with timeout
  if (sniper) {
    try {
      // Give sniper 5 seconds to stop gracefully
      const stopPromise = sniper.stop();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 5000)
      );
      await Promise.race([stopPromise, timeoutPromise]);
      console.log('Sniper stopped');
    } catch (e) {
      console.error('Error stopping sniper:', e.message);
    }
    sniper = null;
  }

  // Cancel any cookie extraction
  if (cookieExtractor) {
    try {
      await cookieExtractor.cancel();
      console.log('Cookie extractor cancelled');
    } catch (e) {
      console.error('Error cancelling cookie extractor:', e);
    }
    cookieExtractor = null;
  }

  // Force kill any remaining Chrome/Edge processes spawned by this app
  // This is Windows-specific but handles the case where browser.close() fails
  if (process.platform === 'win32') {
    try {
      // Kill Chrome processes that might be hanging
      await execAsync('taskkill /F /IM chrome.exe /T').catch(() => {});
      await execAsync('taskkill /F /IM msedge.exe /T').catch(() => {});
      console.log('Force killed browser processes');
    } catch (e) {
      // Ignore - processes might not exist
    }
  }

  // Unregister global shortcuts
  globalShortcut.unregisterAll();

  // Destroy tray
  if (tray) {
    tray.destroy();
    tray = null;
    console.log('Tray destroyed');
  }

  // Close all windows
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    try {
      win.destroy();
    } catch (e) {
      console.error('Error destroying window:', e);
    }
  }
  console.log('Windows destroyed');

  // Give time for everything to close
  await new Promise(resolve => setTimeout(resolve, 1000));

  console.log('Calling quitAndInstall...');

  // Force quit and install - use isSilent=false, isForceRunAfter=true
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// App lifecycle
app.whenReady().then(async () => {
  createWindow();
  createTray();
  registerHotkeys();

  // Check for updates after a short delay
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 3000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Don't quit on window close - keep in tray
});

app.on('will-quit', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
});

app.on('before-quit', async () => {
  app.isQuitting = true;
  if (sniper) {
    await sniper.stop();
  }
});
