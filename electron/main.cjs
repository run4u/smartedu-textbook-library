const { app, BrowserWindow, ipcMain, Menu, session, shell } = require('electron');
const path = require('node:path');
const { loadCatalog } = require('./catalog.cjs');
const { DownloadQueue } = require('./queue.cjs');
const { isCredentialCookie } = require('./session-utils.cjs');

const isDevelopment = !app.isPackaged;
const SMARTEDU_PARTITION = 'persist:smartedu-session';

if (isDevelopment) app.setPath('userData', path.join(__dirname, '..', '.electron-data'));

function isPlatformUrl(url) {
  try { const host = new URL(url).hostname; return host.endsWith('smartedu.cn') || host.endsWith('ykt.cbern.com.cn'); } catch { return false; }
}

async function sessionStatus() {
  const cookies = await session.fromPartition(SMARTEDU_PARTITION).cookies.get({});
  return { hasSavedSession: cookies.some((cookie) => (cookie.domain.includes('smartedu.cn') || cookie.domain.includes('ykt.cbern.com.cn')) && isCredentialCookie(cookie)) };
}

async function clearSession() {
  const platformSession = session.fromPartition(SMARTEDU_PARTITION);
  await platformSession.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
  await platformSession.clearCache();
  return sessionStatus();
}

function openLoginWindow(parentWindow) {
  return new Promise((resolve) => {
    const loginWindow = new BrowserWindow({ parent: parentWindow, modal: true, width: 1080, height: 760, minWidth: 820, minHeight: 600, title: '登录国家智慧教育平台 - 完成后将自动返回', webPreferences: { partition: SMARTEDU_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    loginWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    loginWindow.webContents.on('will-navigate', (event, url) => { if (!isPlatformUrl(url)) event.preventDefault(); });
    loginWindow.loadURL('https://basic.smartedu.cn/');
    let autoClosed = false;
    loginWindow.webContents.once('did-finish-load', async () => {
      const baseline = new Map((await session.fromPartition(SMARTEDU_PARTITION).cookies.get({})).map((cookie) => [`${cookie.domain}:${cookie.path}:${cookie.name}`, cookie.value]));
      const timer = setInterval(async () => {
        if (loginWindow.isDestroyed()) return clearInterval(timer);
        const cookies = await session.fromPartition(SMARTEDU_PARTITION).cookies.get({});
        const hasNewCredential = cookies.some((cookie) => {
          if (!isCredentialCookie(cookie)) return false;
          const key = `${cookie.domain}:${cookie.path}:${cookie.name}`;
          return !baseline.has(key) || baseline.get(key) !== cookie.value;
        });
        if (hasNewCredential) { autoClosed = true; loginWindow.close(); }
      }, 1000);
      loginWindow.once('closed', () => clearInterval(timer));
    });
    loginWindow.on('closed', async () => resolve({ ...(await sessionStatus()), autoClosed }));
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#f4f7f7',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDevelopment) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:5178');
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

function broadcast(channel, payload) {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const queue = new DownloadQueue({
    downloadsPath: app.getPath('downloads'),
    dataPath: app.getPath('userData'),
    platformSession: session.fromPartition(SMARTEDU_PARTITION),
    partition: SMARTEDU_PARTITION,
    send: broadcast,
  });
  ipcMain.handle('catalog:load', async () => {
    const result = await loadCatalog();
    const library = await queue.librarySnapshot();
    for (const resource of result.resources) {
      if (library[resource.contentId]) resource.localState = 'downloaded';
    }
    return result;
  });
  ipcMain.handle('session:status', () => sessionStatus());
  ipcMain.handle('session:login', (event) => openLoginWindow(BrowserWindow.fromWebContents(event.sender)));
  ipcMain.handle('session:clear', () => clearSession());
  ipcMain.handle('download:state', () => queue.snapshot());
  ipcMain.handle('download:start', (_event, resources) => queue.start(resources));
  ipcMain.handle('download:pause', () => queue.pause());
  ipcMain.handle('download:resume', () => queue.resume());
  ipcMain.handle('download:cancel', () => queue.cancel());
  ipcMain.handle('download:retry', (_event, taskId) => queue.retry(taskId));
  ipcMain.handle('download:retryAll', () => queue.retryAll());
  ipcMain.handle('download:clearFinished', () => queue.clearFinished());
  ipcMain.handle('download:clearHistory', () => queue.clearHistory());
  ipcMain.handle('library:list', () => queue.listLibrary());
  ipcMain.handle('library:openFile', (_event, filePath) => shell.openPath(String(filePath)));
  ipcMain.handle('library:showInFolder', (_event, filePath) => { shell.showItemInFolder(String(filePath)); return { ok: true }; });
  const startup = process.argv.includes('--clear-session') || process.env.ELECTRON_CLEAR_SESSION === '1' ? clearSession() : Promise.resolve();
  startup.then(async () => {
    await queue.load();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
