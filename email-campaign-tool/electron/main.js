const path = require('path');
const dotenv = require('dotenv');
const { app, BrowserWindow, dialog, shell, Menu } = require('electron');
const { getFreePort, ensureSettingsFile } = require('./lib');

app.setName('OutreachFlow'); // fixes %APPDATA%\OutreachFlow path in dev + packaged

const TEMPLATE = path.join(__dirname, 'settings-template.env');
const ICON = path.join(__dirname, 'build', 'icon.png');

let mainWindow = null;
let serverApi = null;

const settingsPath = () => path.join(app.getPath('userData'), 'settings.env');

async function boot() {
  const target = settingsPath();
  const { created } = ensureSettingsFile(target, TEMPLATE);

  if (created) {
    await shell.openPath(target);
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'OutreachFlow — first-time setup',
      message: 'Welcome to OutreachFlow',
      detail: `A settings file was created and opened for you:\n\n${target}\n\n` +
              `Fill in DATABASE_URL, APP_SECRET, APP_EMAIL and APP_PASSWORD, ` +
              `save the file, then reopen OutreachFlow.`,
      buttons: ['Quit'],
    });
    app.quit();
    return;
  }

  // Load settings.env into process.env BEFORE requiring the server.
  dotenv.config({ path: target });
  process.env.PORT = String(await getFreePort());
  process.env.NODE_ENV = process.env.NODE_ENV || 'production';

  try {
    serverApi = require('../src/server');
    await serverApi.start();
  } catch (err) {
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'OutreachFlow — could not start',
      message: 'OutreachFlow could not start.',
      detail: `${err.message}\n\nCheck your settings file:\n${target}`,
      buttons: ['OK'],
    });
    await shell.openPath(target);
    app.quit();
    return;
  }

  createWindow();
}

function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    title: 'OutreachFlow', icon: ICON,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.loadURL(`http://localhost:${process.env.PORT}`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(boot);

app.on('window-all-closed', async () => {
  try { if (serverApi) await serverApi.stop(); } catch (_) { /* ignore */ }
  app.quit();
});
