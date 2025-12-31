import { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, dialog, globalShortcut } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import electronUpdater from 'electron-updater';
import player from 'play-sound';

const { autoUpdater } = electronUpdater;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow = null;
let tray = null;
let sniper = null;
let sniperRunning = false;
let cookieExtractor = null;
let browserPid = null; // Track browser PID for clean shutdown

// Use userData directory for config (writable location)
// This resolves to: Windows: %APPDATA%\Divinedge, macOS: ~/Library/Application Support/Divinedge
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
  soundFile: 'alert.wav',
  startMinimized: false,
  autoStart: false,
  reconnectDelayMs: 5000,
  fetchDelayMs: 100,
  teleportCooldownMs: 5000, // 5 second cooldown between teleports
};

async function loadConfig() {
  const configPath = getConfigPath();
  try {
    if (existsSync(configPath)) {
      const data = JSON.parse(await readFile(configPath, 'utf-8'));
      return { ...defaultConfig, ...data };
    }
  } catch (e) {
    console.error('Failed to load config:', e);
  }
  return { ...defaultConfig };
}

async function saveConfig(config) {
  const configPath = getConfigPath();
  try {
    await writeFile(configPath, JSON.stringify(config, null, 2));
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

async function playAlertSound() {
  const config = await loadConfig();
  if (!config.soundEnabled || config.soundFile === 'none') return;

  const soundPath = join(__dirname, config.soundFile);
  if (!existsSync(soundPath)) {
    // Try default alert.wav
    const defaultPath = join(__dirname, 'alert.wav');
    if (existsSync(defaultPath)) {
      soundPlayer.play(defaultPath, (err) => {
        if (err) console.error('Failed to play sound:', err);
      });
    } else {
      // Terminal bell as fallback
      process.stdout.write('\x07');
    }
    return;
  }

  soundPlayer.play(soundPath, (err) => {
    if (err) console.error('Failed to play sound:', err);
  });
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
  tray.setToolTip(sniperRunning ? 'Divinedge - Running' : 'Divinedge - Stopped');
}

async function startSniper() {
  if (sniperRunning) return;

  const config = await loadConfig();

  // Dynamic import for ES module
  const { TradeSniper } = await import('./src/sniper.js');

  sniper = new TradeSniper(config, {
    soundFilePath: join(__dirname, config.soundFile || 'alert.wav'),
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

  sniper.on('teleport', (data) => {
    sendToRenderer('teleport', data);
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
    // Clear browser PID when sniper stops
    if (!data.running) {
      browserPid = null;
    }
  });

  sniper.on('query-state-change', (data) => {
    sendToRenderer('query-state-change', data);
  });

  await sniper.start();

  // Capture browser PID for clean shutdown
  if (sniper.browser) {
    const proc = sniper.browser.process();
    if (proc) {
      browserPid = proc.pid;
      console.log(`Browser PID: ${browserPid}`);
    }
  }
}

async function stopSniper() {
  if (sniper) {
    await sniper.stop();
    sniper = null;
  }
  sniperRunning = false;
  browserPid = null;
  sendToRenderer('status-change', { running: false });
  updateTrayMenu();
}

async function createWindow() {
  const config = await loadConfig();

  // Remove the default menu bar (File, Edit, View, etc.)
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1150,
    height: 700,
    minWidth: 950,
    minHeight: 600,
    frame: false, // Custom title bar
    titleBarStyle: 'hidden', // For macOS
    icon: join(__dirname, 'assets', 'icon.ico'),
    backgroundColor: '#0d0d0d',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile(join(__dirname, 'src', 'renderer', 'index.html'));

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
// Window control handlers
ipcMain.handle('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
  return mainWindow?.isMaximized() ?? false;
});

ipcMain.handle('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow?.isMaximized() ?? false;
});

ipcMain.handle('get-config', async () => {
  return await loadConfig();
});

ipcMain.handle('check-setup-complete', async () => {
  const config = await loadConfig();
  return {
    complete: Boolean(config.poesessid) && config.queries?.length > 0,
    hasAuth: Boolean(config.poesessid),
    hasSearches: config.queries?.length > 0
  };
});

ipcMain.handle('save-config', async (event, config) => {
  return await saveConfig(config);
});

ipcMain.handle('start-sniper', async () => {
  await startSniper();
  return sniperRunning;
});

ipcMain.handle('stop-sniper', async () => {
  await stopSniper();
  return !sniperRunning;
});

ipcMain.handle('get-status', () => {
  return { running: sniperRunning };
});

// Per-query control handlers
ipcMain.handle('start-query', async (event, queryId) => {
  // Initialize sniper if not running (use TradeSniper for browser-based approach)
  if (!sniper) {
    const config = await loadConfig();
    const { TradeSniper } = await import('./src/sniper.js');
    sniper = new TradeSniper(config, {
      soundFilePath: join(__dirname, config.soundFile || 'alert.wav'),
      browserProfilePath: getBrowserProfilePath(),
    });

    // Forward events to renderer
    sniper.on('log', (data) => sendToRenderer('log', data));
    sniper.on('listing', (data) => {
      sendToRenderer('listing', data);
      showNotification('New Listing!', `${data.itemName} @ ${data.price}`);
    });
    sniper.on('teleport', (data) => sendToRenderer('teleport', data));
    sniper.on('connected', (data) => sendToRenderer('connected', data));
    sniper.on('disconnected', (data) => sendToRenderer('disconnected', data));
    sniper.on('reconnecting', (data) => sendToRenderer('reconnecting', data));
    sniper.on('error', (data) => sendToRenderer('error', data));
    sniper.on('cookie-expired', () => {
      sendToRenderer('cookie-expired', {});
      showNotification('Cookie Expired!', 'Please update your cf_clearance cookie');
    });
    sniper.on('status-change', (data) => {
      sniperRunning = data.running;
      sendToRenderer('status-change', data);
      updateTrayMenu();
    });
    sniper.on('query-state-change', (data) => {
      sendToRenderer('query-state-change', data);
    });
  }

  await sniper.startQuery(queryId);
  return { success: true };
});

ipcMain.handle('stop-query', async (event, queryId) => {
  if (sniper) {
    await sniper.stopQuery(queryId);
  }
  return { success: true };
});

ipcMain.handle('pause-query', async (event, queryId) => {
  if (sniper) {
    sniper.pauseQuery(queryId);
  }
  return { success: true };
});

ipcMain.handle('resume-query', async (event, queryId) => {
  if (sniper) {
    sniper.resumeQuery(queryId);
  }
  return { success: true };
});

ipcMain.handle('get-query-states', async () => {
  if (sniper) {
    return sniper.getAllQueryStates();
  }
  return {};
});

ipcMain.handle('pause-all', async () => {
  if (sniper) {
    sniper.setPaused(true);
  }
  return { success: true };
});

ipcMain.handle('resume-all', async () => {
  if (sniper) {
    sniper.setPaused(false);
  }
  return { success: true };
});

ipcMain.handle('test-sound', () => {
  playAlertSound();
  return { success: true };
});

ipcMain.handle('export-searches', async (event, data) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Searches',
      defaultPath: 'divinge-searches.json',
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });

    if (result.canceled || !result.filePath) {
      return { cancelled: true };
    }

    writeFileSync(result.filePath, JSON.stringify(data, null, 2));
    return { success: true, path: result.filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('import-searches', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Searches',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
      properties: ['openFile']
    });

    if (result.canceled || !result.filePaths.length) {
      return { cancelled: true };
    }

    const content = readFileSync(result.filePaths[0], 'utf-8');
    const data = JSON.parse(content);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Economy API proxy to avoid CORS
ipcMain.handle('fetch-economy', async (event, url) => {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Divinedge/1.0 (contact@divinedge.app)',
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

// Fetch extended item price history
ipcMain.handle('fetch-item-history', async (event, itemId, logCount = 100) => {
  try {
    const league = encodeURIComponent('Fate of the Vaal');
    const url = `https://poe2scout.com/api/items/history/${itemId}?logCount=${logCount}&league=${league}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Divinedge/1.0 (contact@divinedge.app)',
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
    const config = await loadConfig();
    config.poesessid = cookies.poesessid;
    if (cookies.cf_clearance) {
      config.cf_clearance = cookies.cf_clearance;
    }
    await saveConfig(config);

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

  // Force kill browser process spawned by this app using tracked PID
  // This is safer than killing all Chrome/Edge processes
  if (process.platform === 'win32' && browserPid) {
    try {
      // Kill only the browser process tree we spawned
      await execAsync(`taskkill /F /PID ${browserPid} /T`).catch(() => {});
      console.log(`Force killed browser process tree (PID: ${browserPid})`);
      browserPid = null;
    } catch (e) {
      // Ignore - process might not exist
    }
  } else if (process.platform === 'darwin' && browserPid) {
    try {
      // On macOS, kill the process group
      process.kill(-browserPid, 'SIGKILL');
      console.log(`Force killed browser process tree (PID: ${browserPid})`);
      browserPid = null;
    } catch (e) {
      // Ignore - process might not exist
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
