import { join } from 'node:path';
import { app, BrowserWindow, protocol } from 'electron';
import { appScheme, appUrl, imageScheme, serveAppAsset } from './app-assets';
import { registerVaultIpc } from './ipc-handlers';

protocol.registerSchemesAsPrivileged([
  { scheme: appScheme, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: imageScheme, privileges: { standard: true, secure: true } },
]);

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const window = new BrowserWindow({
    title: 'Entropy Nexus Vault',
    width: 1600,
    height: 900,
    minWidth: 1280,
    minHeight: 760,
    backgroundColor: '#0D0B0A',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  window.once('closed', () => { mainWindow = null; });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void window.loadURL(appUrl).catch((error: unknown) => {
    console.error('無法載入記憶寶庫介面', error);
    app.quit();
  });
}

void app.whenReady().then(() => {
  const rendererDir = join(__dirname, '../renderer');
  protocol.handle(appScheme, (request) => serveAppAsset(request, rendererDir));
  protocol.handle(imageScheme, () => new Response(null, { status: 404 }));
  registerVaultIpc(() => mainWindow);

  createWindow();
  app.on('activate', () => {
    if (!mainWindow) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
