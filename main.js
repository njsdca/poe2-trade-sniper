import { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, dialog, globalShortcut } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
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

// Use userData directory for config (writable location)
// This resolves to: Windows: %APPDATA%\PoE2 Trade Sniper, macOS: ~/Library/Application Support/PoE2 Trade Sniper
const getConfigPath = () => join(app.getPath('userData'), 'config.json');
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
  tray.setToolTip(sniperRunning ? 'PoE2 Sniper - Running' : 'PoE2 Sniper - Stopped');
}

async function startSniper() {
  if (sniperRunning) return;

  const config = loadConfig();

  // Dynamic import for ES module
  const { TradeSniper } = await import('./src/sniper.js');

  sniper = new TradeSniper(config, {
    soundFilePath: join(__dirname, config.soundFile || 'alert.wav'),
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

  mainWindow = new BrowserWindow({
    width: 750,
    height: 850,
    minWidth: 550,
    minHeight: 650,
    icon: join(__dirname, 'assets', 'icon.ico'),
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
ipcMain.handle('get-config', () => {
  return loadConfig();
});

ipcMain.handle('save-config', (event, config) => {
  return saveConfig(config);
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

ipcMain.handle('test-sound', () => {
  playAlertSound();
  return { success: true };
});

ipcMain.handle('extract-cookies', async () => {
  if (cookieExtractor) {
    return { error: 'Cookie extraction already in progress' };
  }

  try {
    const { CookieExtractor } = await import('./src/cookie-extractor.js');
    cookieExtractor = new CookieExtractor();

    cookieExtractor.on('status', (status) => {
      sendToRenderer('cookie-extract-status', { status });
    });

    const cookies = await cookieExtractor.extract();
    cookieExtractor = null;

    // Auto-save cookies to config
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
  // Stop sniper and close browser first
  if (sniper) {
    await sniper.stop();
    sniper = null;
  }

  // Mark as quitting so windows close properly
  app.isQuitting = true;

  // Small delay to ensure cleanup completes
  await new Promise(resolve => setTimeout(resolve, 500));

  // Quit and install - isSilent=false shows installer, forceRunAfter=true restarts app
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// App lifecycle
app.whenReady().then(() => {
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
