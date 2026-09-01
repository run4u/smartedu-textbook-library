const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('textbookLibrary', {
  appVersion: '0.1.3-alpha.1',
  loadCatalog: () => ipcRenderer.invoke('catalog:load'),
  getSessionStatus: () => ipcRenderer.invoke('session:status'),
  login: () => ipcRenderer.invoke('session:login'),
  clearSession: () => ipcRenderer.invoke('session:clear'),
  downloadState: () => ipcRenderer.invoke('download:state'),
  startDownload: (resources) => ipcRenderer.invoke('download:start', resources),
  pauseDownload: () => ipcRenderer.invoke('download:pause'),
  resumeDownload: () => ipcRenderer.invoke('download:resume'),
  cancelDownload: () => ipcRenderer.invoke('download:cancel'),
  retryTask: (taskId) => ipcRenderer.invoke('download:retry', taskId),
  retryAllTasks: () => ipcRenderer.invoke('download:retryAll'),
  clearFinishedTasks: () => ipcRenderer.invoke('download:clearFinished'),
  clearDownloadHistory: () => ipcRenderer.invoke('download:clearHistory'),
  clearAllTaskRecords: () => ipcRenderer.invoke('download:clearAll'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  chooseDownloadDirectory: () => ipcRenderer.invoke('settings:chooseDownloadDirectory'),
  resetDownloadDirectory: () => ipcRenderer.invoke('settings:resetDownloadDirectory'),
  openDownloadDirectory: () => ipcRenderer.invoke('settings:openDownloadDirectory'),
  listLibrary: () => ipcRenderer.invoke('library:list'),
  openLibraryFile: (filePath) => ipcRenderer.invoke('library:openFile', filePath),
  showLibraryInFolder: (filePath) => ipcRenderer.invoke('library:showInFolder', filePath),
  onDownloadProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on('download:progress', handler);
    return () => ipcRenderer.removeListener('download:progress', handler);
  },
  onDownloadQueue: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('download:queue', handler);
    return () => ipcRenderer.removeListener('download:queue', handler);
  },
});
