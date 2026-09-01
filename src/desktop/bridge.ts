import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { TextbookResource } from '../data/fixtures';
import type { AppSettings, DownloadProgress, LibraryItem, QueueState, TextbookBridge } from './types';

declare global {
  interface Window {
    textbookLibrary?: TextbookBridge;
    __TAURI_INTERNALS__?: unknown;
  }
}

function eventSubscription<T>(event: string, listener: (payload: T) => void): () => void {
  const pending = listen<T>(event, ({ payload }) => listener(payload));
  return () => { void pending.then((unlisten) => unlisten()); };
}

const tauriBridge: TextbookBridge = {
  appVersion: '0.1.3-alpha.1 Lite prototype',
  loadCatalog: () => invoke('load_catalog'),
  getSessionStatus: () => invoke('session_status'),
  login: () => invoke('open_login'),
  clearSession: () => invoke('clear_session'),
  downloadState: () => invoke('download_state'),
  startDownload: (resources: TextbookResource[]) => invoke('start_download', { resources }),
  pauseDownload: () => invoke('pause_download'),
  resumeDownload: () => invoke('resume_download'),
  cancelDownload: () => invoke('cancel_download'),
  retryTask: (taskId: string) => invoke('retry_task', { taskId }),
  retryAllTasks: () => invoke('retry_all_tasks'),
  clearFinishedTasks: () => invoke('clear_finished_tasks'),
  clearDownloadHistory: () => invoke('clear_download_history'),
  clearAllTaskRecords: () => invoke('clear_all_task_records'),
  getSettings: () => invoke<AppSettings>('get_settings'),
  updateSettings: (settings: Partial<AppSettings>) => invoke<AppSettings>('update_settings', { settings }),
  chooseDownloadDirectory: () => invoke<AppSettings>('choose_download_directory'),
  resetDownloadDirectory: () => invoke<AppSettings>('reset_download_directory'),
  openDownloadDirectory: () => invoke<string>('open_download_directory'),
  listLibrary: () => invoke<LibraryItem[]>('list_library'),
  openLibraryFile: (filePath: string) => invoke<string>('open_library_file', { filePath }),
  showLibraryInFolder: (filePath: string) => invoke<{ ok: boolean }>('show_library_in_folder', { filePath }),
  onDownloadProgress: (listener: (progress: DownloadProgress) => void) => eventSubscription('download:progress', listener),
  onDownloadQueue: (listener: (state: QueueState) => void) => eventSubscription('download:queue', listener),
};

export function desktopBridge(): TextbookBridge | undefined {
  if (window.__TAURI_INTERNALS__) return tauriBridge;
  return window.textbookLibrary;
}

