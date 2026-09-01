import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckCircle2, Download, FileText, FolderOpen, LoaderCircle, LogIn, LogOut, PanelLeftClose, PanelLeftOpen, Pause, Play, RefreshCw, Search, Settings, Trash2, X } from 'lucide-react';
import { resources, type TextbookResource } from './data/fixtures';
import { desktopBridge as bridge } from './desktop/bridge';
import type { AppSettings, AppView, DownloadProgress, LibraryItem, QueueState, QueueTask, TaskStatus } from './desktop/types';
import { computeFilterOptions, filterFields, filterResources, groupResources, getSelectableResources, toggleAllSelection, toggleSkipDownloaded } from './lib/catalog';
import './styles.css';

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function formatSpeed(bytesPerSecond?: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '—';
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
  return `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/s`;
}
function formatDuration(milliseconds?: number | null): string {
  if (milliseconds == null || !Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function previewFilename(template: string): string {
  const sample = { title: '英语七年级上册', stage: '初中', subject: '英语', grade: '七年级', volume: '上册', edition: '北师大版', year: '2026年度', shortId: 'f4a32947' };
  const sourceTemplate = template || '{学段}_{学科}_{年级}_{册次}_{版本}_{年度}_{短ID}';
  let rendered = sourceTemplate
    .replaceAll('{教材名称}', sample.title).replaceAll('{学段}', sample.stage).replaceAll('{学科}', sample.subject).replaceAll('{年级}', sample.grade).replaceAll('{册次}', sample.volume).replaceAll('{版本}', sample.edition).replaceAll('{年度}', sample.year).replaceAll('{资源ID}', 'f4a32947-1234-5678-90ab-cdef01234567').replaceAll('{短ID}', sample.shortId)
    .replace(/\{[^{}]+\}/g, '').replace(/[\\/:*?"<>|]/g, '_').replace(/[. ]+$/g, '').trim() || '教材_f4a32947';
  rendered = rendered.replace(/\.pdf$/i, '');
  if (!sourceTemplate.includes('{短ID}') && !sourceTemplate.includes('{资源ID}')) rendered = `${rendered}_${sample.shortId}`;
  return rendered;
}

const statusLabels: Record<TaskStatus, string> = {
  queued: '排队中',
  running: '下载中',
  paused: '已暂停',
  complete: '已完成',
  error: '失败',
  canceled: '已取消',
};

function taskLabel(task: QueueTask): string {
  if (task.status === 'queued') return '等待下载';
  if (task.status === 'paused') return '已暂停';
  if (task.status === 'canceled') return '已取消';
  if (task.status === 'running' && task.phase === 'downloading' && task.totalBytes) {
    return `${task.message ?? '正在下载'} ${Math.min(100, Math.round(((task.receivedBytes ?? 0) / task.totalBytes) * 100))}%`;
  }
  return task.message ?? task.status;
}

function taskPercent(task: QueueTask): number | null {
  if (task.status === 'complete') return 100;
  if (task.totalBytes) return Math.min(100, Math.round(((task.receivedBytes ?? 0) / task.totalBytes) * 100));
  if (task.status === 'running') return task.phase === 'verifying' ? 96 : task.phase === 'resolving' ? 4 : 50;
  if (task.status === 'queued') return 0;
  return null;
}

function batchPercent(tasks: QueueTask[]): number | null {
  if (tasks.length === 0) return null;
  let totalUnits = 0;
  for (const task of tasks) {
    if (task.status === 'complete') totalUnits += 1;
    else {
      const percent = taskPercent(task);
      totalUnits += percent != null ? percent / 100 : 0;
    }
  }
  return Math.min(100, Math.round(totalUnits / tasks.length * 100));
}

function App() {
  const [view, setView] = useState<AppView>('catalog');
  const [catalog, setCatalog] = useState(resources);
  const [catalogStatus, setCatalogStatus] = useState('正在加载官方目录');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [skipDownloaded, setSkipDownloaded] = useState(true);
  const [filters, setFilters] = useState({ stage: '', subject: '', grade: '', volume: '', edition: '' });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [hasSavedSession, setHasSavedSession] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [loginMessage, setLoginMessage] = useState('');
  const [batchNotice, setBatchNotice] = useState('');
  const [queue, setQueue] = useState<QueueState>({ batchId: null, status: 'idle', tasks: [], history: [] });
  const [taskSpeeds, setTaskSpeeds] = useState<Record<string, number>>({});
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [librarySubject, setLibrarySubject] = useState('');
  const [libraryMessage, setLibraryMessage] = useState('');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsMessage, setSettingsMessage] = useState('');
  const queueWasActive = useRef(false);
  const settingsUpdateId = useRef(0);
  const lastProgressBytes = useRef<Record<string, { bytes: number; time: number }>>({});

  const loadCatalogData = async () => {
    try {
      const desktopBridge = bridge();
      const result = desktopBridge?.loadCatalog ? await desktopBridge.loadCatalog() : await (await fetch('/api/catalog')).json();
      if (!Array.isArray(result.resources)) throw new Error(result.error || '目录格式异常');
      setCatalog(result.resources);
      if (skipDownloaded) {
        const downloadedIds = new Set<string>();
        for (const resource of result.resources as TextbookResource[]) {
          if (resource.localState === 'downloaded') downloadedIds.add(resource.contentId);
        }
        setSelected((current) => {
          const next = new Set(current);
          for (const contentId of downloadedIds) next.delete(contentId);
          return next;
        });
      }
      setCatalogStatus(result.source === 'cache' ? '正在使用本地缓存目录' : '官方目录已刷新');
    } catch { setCatalogStatus('官方目录暂不可用，正在展示本地样例'); }
  };
  const loadSessionStatus = async () => {
    const desktopBridge = bridge();
    if (!desktopBridge?.getSessionStatus) { setSessionChecked(true); return; }
    try { setHasSavedSession((await desktopBridge.getSessionStatus()).hasSavedSession); }
    catch { setHasSavedSession(false); }
    finally { setSessionChecked(true); }
  };
  const loadLibrary = async () => {
    const desktopBridge = bridge();
    if (!desktopBridge?.listLibrary) { setLibraryItems([]); return; }
    try { setLibraryItems(await desktopBridge.listLibrary()); setLibraryMessage(''); }
    catch (error) { setLibraryMessage(error instanceof Error ? error.message : String(error)); }
  };
  const loadSettings = async () => {
    const desktopBridge = bridge();
    if (!desktopBridge?.getSettings) return;
    try { const next = await desktopBridge.getSettings(); setSettings(next); setView(next.defaultView); setSkipDownloaded(next.startupFilterMode === 'last' ? next.lastSkipDownloaded : next.defaultSkipDownloaded); setFilters(next.startupFilterMode === 'last' ? next.lastFilters : next.defaultFilters); } catch (error) { setSettingsMessage(error instanceof Error ? error.message : String(error)); }
  };
  useEffect(() => { void loadSettings(); void loadCatalogData(); void loadSessionStatus(); }, []);
  useEffect(() => { void loadLibrary(); }, [view]);
  useEffect(() => {
    const desktopBridge = bridge();
    if (desktopBridge?.downloadState) void desktopBridge.downloadState().then(setQueue).catch(() => {});
    const unsubscribeQueue = desktopBridge?.onDownloadQueue?.((state) => setQueue(state));
    const unsubscribeProgress = desktopBridge?.onDownloadProgress?.((progress) => {
      const nowMs = Date.now();
      const previous = lastProgressBytes.current[progress.taskId];
      if (previous && progress.receivedBytes != null && nowMs > previous.time) {
        const deltaBytes = progress.receivedBytes - previous.bytes;
        const deltaSeconds = (nowMs - previous.time) / 1000;
        if (deltaSeconds > 0 && deltaBytes >= 0) setTaskSpeeds((current) => ({ ...current, [progress.taskId]: deltaBytes / deltaSeconds }));
      }
      lastProgressBytes.current[progress.taskId] = { bytes: progress.receivedBytes ?? previous?.bytes ?? 0, time: nowMs };
      setQueue((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === progress.taskId ? { ...task, phase: progress.phase, message: progress.message, receivedBytes: progress.receivedBytes, totalBytes: progress.totalBytes } : task) }));
    });
    return () => { unsubscribeQueue?.(); unsubscribeProgress?.(); };
  }, []);
  useEffect(() => {
    if (queue.status === 'running' || queue.status === 'paused') queueWasActive.current = true;
    if (queueWasActive.current && (queue.status === 'complete' || queue.status === 'canceled')) {
      queueWasActive.current = false;
      void loadCatalogData();
      void loadLibrary();
    }
  }, [queue.status]);
  useEffect(() => {
    if (!settings) return;
    const timer = window.setTimeout(() => { void updateAppSettings({ lastFilters: filters, lastSkipDownloaded: skipDownloaded }); }, 250);
    return () => window.clearTimeout(timer);
  }, [filters, skipDownloaded]);

  const openLogin = async () => {
    const desktopBridge = bridge();
    if (desktopBridge?.login) {
      const result = await desktopBridge.login();
      setHasSavedSession(result.hasSavedSession);
      setSessionChecked(true);
      setLoginMessage(result.hasSavedSession ? (result.autoClosed ? '登录完成，已自动返回' : '登录窗口已关闭，登录档案已保存') : '登录窗口已关闭，未检测到登录档案');
    }
  };
  const logout = async () => {
    if (!window.confirm('确认清除本应用保存的平台登录档案？')) return;
    const desktopBridge = bridge();
    if (desktopBridge?.clearSession) {
      await desktopBridge.clearSession();
      setHasSavedSession(false);
      setSessionChecked(true);
      setLoginMessage('登录档案已清除');
    }
  };

  const batchActive = queue.status === 'running' || queue.status === 'paused';
  const totalCount = queue.tasks.length;
  const completedCount = queue.tasks.filter((task) => task.status === 'complete').length;
  const failedCount = queue.tasks.filter((task) => task.status === 'error').length;
  const canceledCount = queue.tasks.filter((task) => task.status === 'canceled').length;
  const activeTaskCount = queue.tasks.filter((task) => ['queued', 'running', 'paused'].includes(task.status)).length;
  const runningTask = queue.tasks.find((task) => task.status === 'running');
  const progressPercent = batchPercent(queue.tasks);
  const taskByContentId = useMemo(() => {
    const map: Record<string, QueueTask> = {};
    for (const task of queue.tasks) map[task.contentId] = task;
    return map;
  }, [queue.tasks]);

  const startBatch = async (resourcesToDownload: TextbookResource[]) => {
    const desktopBridge = bridge();
    if (!desktopBridge?.startDownload || resourcesToDownload.length === 0) return;
    if (!hasSavedSession) { setBatchNotice('尚未登录，请先登录平台'); return; }
    try { setBatchNotice(''); setQueue(await desktopBridge.startDownload(resourcesToDownload)); }
    catch (error) { setBatchNotice(error instanceof Error ? error.message : String(error)); }
  };
  const pauseBatch = async () => { const desktopBridge = bridge(); if (desktopBridge?.pauseDownload) setQueue(await desktopBridge.pauseDownload()); };
  const resumeBatch = async () => { const desktopBridge = bridge(); if (desktopBridge?.resumeDownload) setQueue(await desktopBridge.resumeDownload()); };
  const cancelBatch = async () => { const desktopBridge = bridge(); if (desktopBridge?.cancelDownload) setQueue(await desktopBridge.cancelDownload()); };
  const retryTask = async (taskId: string) => {
    const desktopBridge = bridge();
    if (desktopBridge?.retryTask) {
      try { setBatchNotice(''); setQueue(await desktopBridge.retryTask(taskId)); }
      catch (error) { setBatchNotice(error instanceof Error ? error.message : String(error)); }
    }
  };
  const clearFinished = async () => { const desktopBridge = bridge(); if (desktopBridge?.clearFinishedTasks) setQueue(await desktopBridge.clearFinishedTasks()); };
  const retryAll = async () => {
    const desktopBridge = bridge();
    if (desktopBridge?.retryAllTasks) {
      try { setBatchNotice(''); setQueue(await desktopBridge.retryAllTasks()); }
      catch (error) { setBatchNotice(error instanceof Error ? error.message : String(error)); }
    }
  };
  const clearHistory = async () => { const desktopBridge = bridge(); if (desktopBridge?.clearDownloadHistory) setQueue(await desktopBridge.clearDownloadHistory()); };
  const updateAppSettings = async (patch: Partial<AppSettings>) => {
    const desktopBridge = bridge();
    if (!desktopBridge?.updateSettings) return;
    const updateId = ++settingsUpdateId.current;
    setSettings((current) => current ? { ...current, ...patch } : current);
    try { const saved = await desktopBridge.updateSettings(patch); if (updateId === settingsUpdateId.current) { setSettings(saved); setSettingsMessage('设置已保存'); } } catch (error) { if (updateId === settingsUpdateId.current) { setSettingsMessage(error instanceof Error ? error.message : String(error)); void loadSettings(); } }
  };
  const chooseDirectory = async () => { const desktopBridge = bridge(); if (!desktopBridge?.chooseDownloadDirectory) return; try { setSettings(await desktopBridge.chooseDownloadDirectory()); setSettingsMessage('下载目录已更新'); } catch (error) { setSettingsMessage(error instanceof Error ? error.message : String(error)); } };
  const resetDirectory = async () => { const desktopBridge = bridge(); if (!desktopBridge?.resetDownloadDirectory) return; try { setSettings(await desktopBridge.resetDownloadDirectory()); setSettingsMessage('已恢复默认下载目录'); } catch (error) { setSettingsMessage(error instanceof Error ? error.message : String(error)); } };
  const openDirectory = async () => { const desktopBridge = bridge(); if (desktopBridge?.openDownloadDirectory) await desktopBridge.openDownloadDirectory(); };
  const clearAllRecords = async () => { if (!window.confirm('确认清除全部下载任务记录和历史？不会删除已下载教材。')) return; const desktopBridge = bridge(); if (desktopBridge?.clearAllTaskRecords) { try { setQueue(await desktopBridge.clearAllTaskRecords()); setSettingsMessage('下载任务记录已清除'); } catch (error) { setSettingsMessage(error instanceof Error ? error.message : String(error)); } } };
  const updateFilterSetting = (kind: 'defaultFilters' | 'lastFilters', field: keyof AppSettings['defaultFilters'], value: string) => { if (!settings) return; const next = { ...settings[kind], [field]: value }; setSettings({ ...settings, [kind]: next }); void updateAppSettings({ [kind]: next }); };

  const filterOptions = useMemo(() => computeFilterOptions(catalog, filters), [catalog, filters]);
  const matching = useMemo(() => filterResources(catalog, filters, query), [catalog, filters, query]);
  const groups = useMemo(() => groupResources(matching), [matching]);
  const selectableResources = getSelectableResources(matching, skipDownloaded);
  const allVisibleSelected = selectableResources.length > 0 && selectableResources.every((resource) => selected.has(resource.contentId));
  const selectedDownloaded = catalog.filter((resource) => selected.has(resource.contentId) && resource.localState === 'downloaded').length;
  const selectedResources = useMemo(() => catalog.filter((resource) => selected.has(resource.contentId)), [catalog, selected]);
  const downloadCount = selectedResources.length;

  const toggleResource = (id: string) => setSelected((current) => {
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleAll = () => setSelected((current) => {
    return toggleAllSelection(current, selectableResources, allVisibleSelected);
  });
  const changeSkipDownloaded = (enabled: boolean) => {
    const preserveSelectAll = allVisibleSelected;
    setSkipDownloaded(enabled);
    setSelected((current) => toggleSkipDownloaded(current, catalog, matching, enabled, preserveSelectAll));
  };
  const resetSearchAndFilters = () => {
    setQuery('');
    setFilters({ stage: '', subject: '', grade: '', volume: '', edition: '' });
  };
  const librarySubjects = useMemo(() => [...new Set(libraryItems.map((item) => item.subject).filter(Boolean))].sort(), [libraryItems]);
  const visibleLibraryItems = useMemo(() => libraryItems.filter((item) => {
    if (librarySubject && item.subject !== librarySubject) return false;
    const haystack = [item.title, item.stage, item.subject, item.grade, item.volume, item.edition, item.fileName].join(' ');
    return libraryQuery.trim().split(/\s+/).filter(Boolean).every((term) => haystack.toLowerCase().includes(term.toLowerCase()));
  }), [libraryItems, libraryQuery, librarySubject]);
  const openLibraryFile = async (item: LibraryItem) => {
    const desktopBridge = bridge();
    if (!desktopBridge?.openLibraryFile || !item.exists) return;
    const errorMessage = await desktopBridge.openLibraryFile(item.path);
    if (errorMessage) setLibraryMessage(errorMessage);
  };
  const showLibraryInFolder = async (item: LibraryItem) => {
    const desktopBridge = bridge();
    if (desktopBridge?.showLibraryInFolder) await desktopBridge.showLibraryInFolder(item.path);
  };

  return <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">教</div><div className="brand-copy"><strong>教材资料库</strong><span>本地优先</span></div><button className="sidebar-toggle" title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} onClick={() => setSidebarCollapsed((current) => !current)}>{sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button></div>
      <nav>
        <button className={`nav-link ${view === 'catalog' ? 'active' : ''}`} onClick={() => setView('catalog')}><Search size={18} /><span>教材目录</span></button>
        <button className={`nav-link ${view === 'library' ? 'active' : ''}`} onClick={() => setView('library')}><FolderOpen size={18} /><span>本地资料</span></button>
        <button className={`nav-link ${view === 'tasks' ? 'active' : ''}`} onClick={() => setView('tasks')}><Download size={18} /><span>下载任务</span>{activeTaskCount > 0 && <span className="count">{activeTaskCount}</span>}</button>
        <button className={`nav-link ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}><Settings size={18} /><span>设置</span></button>
      </nav>
      <div className="sidebar-footer"><span className={`session-dot ${hasSavedSession ? '' : 'off'}`} />{sessionChecked ? (hasSavedSession ? '登录档案已保存' : '未登录') : '正在检查登录状态'}</div>
    </aside>
    <main>
      <header className="topbar"><div><p className="eyebrow">{view === 'catalog' ? '教材目录' : view === 'tasks' ? '下载任务' : view === 'library' ? '本地资料' : '应用设置'}</p><h1>{view === 'catalog' ? '查找并识别教材版本' : view === 'tasks' ? '队列与下载历史' : view === 'library' ? '已下载教材' : '设置'}</h1></div><div className="login-area">{loginMessage && <span className="login-message">{loginMessage}</span>}{hasSavedSession && <button className="icon-button" title="退出登录" onClick={logout}><LogOut size={17} /></button>}{view !== 'settings' && <button className="button secondary" disabled={!sessionChecked} onClick={openLogin}><LogIn size={17} />{sessionChecked ? (hasSavedSession ? '登录档案已保存' : '登录平台') : '检查登录状态'}</button>}</div></header>

      {view === 'catalog' && <>
        <section className="filter-panel" aria-label="教材筛选">
          <div className="search-field"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="可同时搜索：英语 七年级 北师大版" />{query && <button className="clear-search" title="清空关键词" onClick={() => setQuery('')}><X size={16} /></button>}</div>
          {filterFields.map((field) => <select className={filters[field] ? 'filter-select selected' : 'filter-select'} key={field} value={filters[field]} onChange={(event) => setFilters((current) => ({ ...current, [field]: event.target.value }))} aria-label={field}><option value="">{({ stage: '学段', subject: '学科', grade: '年级', volume: '册次', edition: '版本' } as Record<string, string>)[field]}</option>{filterOptions[field].map((value) => <option key={value} value={value}>{value}</option>)}</select>)}
          <button className="icon-button" title="重置检索和筛选" onClick={resetSearchAndFilters}><RefreshCw size={18} /></button>
        </section>
        <section className="catalog-header"><div><p className="result-count">{groups.length} 册教材，{matching.length} 项资源</p><p className="hint">{catalogStatus}</p></div></section>
        <section className="batch-toolbar">
          {batchActive ? <div className="batch-progress">
            <div className="progress-track"><div className="progress-fill" style={{ width: `${progressPercent ?? 0}%` }} /></div>
            <div className="batch-progress-meta"><strong>{queue.status === 'paused' ? '已暂停' : runningTask ? runningTask.title : '正在准备队列'}</strong><span>已完成 {completedCount} / {totalCount} · 失败 {failedCount} · {progressPercent ?? 0}%</span></div>
            <div className="batch-progress-actions">{queue.status === 'running' ? <button className="button secondary" onClick={() => void pauseBatch()}><Pause size={17} />暂停</button> : <button className="button secondary" onClick={() => void resumeBatch()}><Play size={17} />继续</button>}<button className="button secondary" onClick={() => void cancelBatch()}><X size={17} />取消</button></div>
          </div> : <div className="selection-actions"><label className="check-label"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} />全选当前结果</label><label className="check-label"><input type="checkbox" checked={skipDownloaded} onChange={(event) => changeSkipDownloaded(event.target.checked)} />跳过已下载{selectedDownloaded > 0 ? `（${selectedDownloaded} 项）` : ''}</label></div>}
          {!batchActive && <div className="start-actions">{totalCount > 0 && <span className="last-batch-hint">上次：成功 {completedCount} · 失败 {failedCount} · 取消 {canceledCount}</span>}<button className="button primary" disabled={downloadCount === 0} onClick={() => void startBatch(selectedResources)}><Download size={17} />开始下载 {downloadCount} 项</button></div>}
        </section>
        {batchNotice && <div className="batch-notice">{batchNotice}</div>}
        <section className="catalog-tree" id="catalog"><table><colgroup><col className="category-col" /><col className="title-col" /><col className="year-col" /><col className="size-col" /><col className="updated-col" /><col className="id-col" /><col className="state-col" /><col className="action-col" /></colgroup><thead><tr><th>分类</th><th>教材名称</th><th>资源年度</th><th>文件大小</th><th>更新时间</th><th>资源身份</th><th>本地状态</th><th></th></tr></thead><tbody>{groups.map(([key, group]) => <TextbookGroup key={key} groupKey={key} resources={group} selected={selected} skipDownloaded={skipDownloaded} onToggleResource={toggleResource} taskByContentId={taskByContentId} batchActive={batchActive} onDownload={(resource) => void startBatch([resource])} />)}</tbody></table></section>
        <section className="notice"><CheckCircle2 size={19} /><div><strong>版本不会自动合并</strong><span>资源年度、时间、文件大小和内容 ID 会并列保存；“已下载”仅作提示，不会阻止再次下载。</span></div></section>
      </>}

      {view === 'tasks' && <section className="tasks-page">
        <div className="tasks-head"><div><p className="eyebrow">下载任务</p><h2>当前批次</h2></div><div className="task-actions">{queue.status === 'running' && <button className="button secondary" onClick={() => void pauseBatch()}><Pause size={17} />暂停</button>}{queue.status === 'paused' && <button className="button secondary" onClick={() => void resumeBatch()}><Play size={17} />继续</button>}{(queue.status === 'running' || queue.status === 'paused') && <button className="button secondary" onClick={() => void cancelBatch()}><X size={17} />取消</button>}{(queue.status === 'complete' || queue.status === 'canceled') && totalCount > 0 && <><button className="button secondary" disabled={failedCount + canceledCount === 0} onClick={() => void retryAll()}><RefreshCw size={17} />重试失败项</button><button className="button secondary" onClick={() => void clearFinished()}><Trash2 size={17} />清除记录</button></>}</div></div>
        {batchNotice && <div className="batch-notice">{batchNotice}</div>}
        <div className="task-summary"><span>总计 {totalCount}</span><span>进行中 {activeTaskCount}</span><span>成功 {completedCount}</span><span>失败 {failedCount}</span><span>取消 {canceledCount}</span></div>
        {totalCount === 0 ? <p className="empty-hint">暂无下载任务。请在“教材目录”中勾选资源后点击“开始下载”。</p> : <div className="task-list">{queue.tasks.map((task) => <TaskRow key={task.id} task={task} retryDisabled={batchActive} onRetry={(taskId) => void retryTask(taskId)} speed={taskSpeeds[task.id]} />)}</div>}
        {queue.history.length > 0 && <section className="history-section"><div className="history-head"><h2>历史批次</h2><button className="button secondary small" onClick={() => void clearHistory()}><Trash2 size={15} />清空历史</button></div>{queue.history.map((batch) => <details className="history-batch" key={batch.id}><summary className="history-summary"><span className="history-time">{batch.createdAt ? new Date(batch.createdAt).toLocaleString() : '未知时间'}</span><span className="history-counts">{batch.tasks.length} 项 · 成功 {batch.tasks.filter((task) => task.status === 'complete').length} · 失败 {batch.tasks.filter((task) => task.status === 'error').length} · 取消 {batch.tasks.filter((task) => task.status === 'canceled').length}</span><span className={`history-status ${batch.status}`}>{batch.status === 'complete' ? '已完成' : '已取消'}</span></summary><div className="history-tasks">{batch.tasks.map((task) => <TaskRow key={task.id} task={task} retryDisabled={true} onRetry={() => {}} />)}</div></details>)}</section>}
      </section>}

      {view === 'library' && <section className="library-page">
        <div className="library-toolbar"><div className="search-field"><Search size={18} /><input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="搜索文件名、学科或分类" />{libraryQuery && <button className="clear-search" title="清空关键词" onClick={() => setLibraryQuery('')}><X size={16} /></button>}</div><select className="filter-select" value={librarySubject} onChange={(event) => setLibrarySubject(event.target.value)} aria-label="学科筛选"><option value="">全部学科</option>{librarySubjects.map((subject) => <option key={subject} value={subject}>{subject}</option>)}</select><button className="button secondary" onClick={() => void loadLibrary()}><RefreshCw size={17} />刷新</button></div>
        {libraryMessage && <div className="batch-notice">{libraryMessage}</div>}
        <p className="hint">{visibleLibraryItems.length} 个已下载文件</p>
        {visibleLibraryItems.length === 0 ? <p className="empty-hint">暂无已下载文件。请先在“教材目录”中下载资源。</p> : <div className="library-list">{visibleLibraryItems.map((item) => <LibraryRow key={item.contentId} item={item} onOpenFile={(target) => void openLibraryFile(target)} onShowFolder={(target) => void showLibraryInFolder(target)} />)}</div>}
      </section>}

      {view === 'settings' && <SettingsPage settings={settings} catalog={catalog} message={settingsMessage} hasSavedSession={hasSavedSession} onUpdate={updateAppSettings} onChooseDirectory={chooseDirectory} onResetDirectory={resetDirectory} onOpenDirectory={openDirectory} onClearRecords={clearAllRecords} onClearSession={logout} onUpdateFilter={updateFilterSetting} />}
    </main>
  </div>;
}

function SettingsPage({ settings, catalog, message, hasSavedSession, onUpdate, onChooseDirectory, onResetDirectory, onOpenDirectory, onClearRecords, onClearSession, onUpdateFilter }: { settings: AppSettings | null; catalog: TextbookResource[]; message: string; hasSavedSession: boolean; onUpdate: (patch: Partial<AppSettings>) => void; onChooseDirectory: () => void; onResetDirectory: () => void; onOpenDirectory: () => void; onClearRecords: () => void; onClearSession: () => void; onUpdateFilter: (kind: 'defaultFilters' | 'lastFilters', field: keyof AppSettings['defaultFilters'], value: string) => void }) {
  if (!settings) return <p className="empty-hint">正在加载设置…</p>;
  const fields: Array<[keyof AppSettings['defaultFilters'], string]> = [['stage', '学段'], ['subject', '学科'], ['grade', '年级'], ['volume', '册次'], ['edition', '版本']];
  const options = computeFilterOptions(catalog, settings.defaultFilters);
  const filenamePresets = [
    { id: 'detailed', name: '分类详细', description: '信息最完整，适合长期归档', template: '{学段}_{学科}_{年级}_{册次}_{版本}_{年度}_{短ID}' },
    { id: 'title', name: '教材标题', description: '优先使用官方教材名称', template: '{教材名称}_{年度}_{短ID}' },
    { id: 'compact', name: '简洁格式', description: '文件名较短，仍能区分资源', template: '{学科}_{年级}_{册次}_{年度}_{短ID}' },
  ];
  const selectedPreset = filenamePresets.find((preset) => preset.template === settings.filenameTemplate)?.id || 'custom';
  const templateTokens = ['{教材名称}', '{学段}', '{学科}', '{年级}', '{册次}', '{版本}', '{年度}', '{短ID}'];
  const insertToken = (token: string) => onUpdate({ filenameTemplate: `${settings.filenameTemplate}${settings.filenameTemplate && !settings.filenameTemplate.endsWith('_') ? '_' : ''}${token}` });
  return <section className="settings-page">
    {message && <div className="batch-notice">{message}</div>}
    <div className="settings-card"><div className="settings-card-head"><div><h2>下载设置</h2><p>新下载任务会使用这里保存的目录和文件名格式。</p></div></div>
      <div className="settings-row"><div><strong>下载目录</strong><span className="settings-help">当前：{settings.effectiveDownloadDirectory}</span></div><div className="settings-actions"><button className="button secondary small" onClick={onChooseDirectory}>选择目录</button><button className="button secondary small" onClick={onResetDirectory}>恢复默认</button><button className="button secondary small" onClick={onOpenDirectory}>打开目录</button></div></div>
      <div className="settings-row settings-column"><div><strong>文件名格式</strong><span className="settings-help">选择一种常用格式即可；只有特殊需求才需要使用高级自定义。</span></div><div className="filename-presets">{filenamePresets.map((preset) => <button type="button" key={preset.id} className={`filename-preset ${selectedPreset === preset.id ? 'active' : ''}`} onClick={() => onUpdate({ filenameTemplate: preset.template })}><strong>{preset.name}</strong><span>{preset.description}</span><code>{previewFilename(preset.template)}.pdf</code></button>)}</div><span className="settings-preview">当前预览：{previewFilename(settings.filenameTemplate)}.pdf</span><details className="advanced-settings" open={selectedPreset === 'custom'}><summary>高级自定义</summary><p className="settings-help">点击字段即可加入模板，也可以直接编辑。未包含资源 ID 时，程序会自动追加短 ID防止重名。</p><div className="template-tokens">{templateTokens.map((token) => <button type="button" key={token} onClick={() => insertToken(token)}>{token}</button>)}</div><input className="settings-input" value={settings.filenameTemplate} onChange={(event) => onUpdate({ filenameTemplate: event.target.value })} /></details></div>
      <label className="settings-check"><input type="checkbox" checked={settings.downloadNotifications} onChange={(event) => onUpdate({ downloadNotifications: event.target.checked })} />下载任务结束时发送系统通知</label>
    </div>
    <div className="settings-card"><div className="settings-card-head"><div><h2>启动偏好</h2><p>选择每次启动时使用固定默认值，或恢复上次使用的筛选条件。</p></div></div>
      <div className="settings-choice"><label><input type="radio" checked={settings.startupFilterMode === 'defaults'} onChange={() => onUpdate({ startupFilterMode: 'defaults' })} />使用默认筛选</label><label><input type="radio" checked={settings.startupFilterMode === 'last'} onChange={() => onUpdate({ startupFilterMode: 'last' })} />恢复上次筛选</label></div>
      <div className="settings-filter-grid">{fields.map(([field, label]) => <label key={field}>{label}<select className="settings-input" value={settings.defaultFilters[field]} onChange={(event) => onUpdateFilter('defaultFilters', field, event.target.value)}><option value="">不限制</option>{options[field].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>)}</div>
      <label className="settings-check"><input type="checkbox" checked={settings.defaultSkipDownloaded} onChange={(event) => onUpdate({ defaultSkipDownloaded: event.target.checked })} />默认跳过已下载资源</label>
      <label className="settings-select-label">默认进入页面<select className="settings-input" value={settings.defaultView} onChange={(event) => onUpdate({ defaultView: event.target.value as AppView })}><option value="catalog">教材目录</option><option value="tasks">下载任务</option><option value="library">本地资料</option><option value="settings">设置</option></select></label>
    </div>
    <div className="settings-card"><div className="settings-card-head"><div><h2>应用与数据</h2><p>版本 {bridge()?.appVersion || '0.1.3-alpha.1'} · 登录档案和任务记录保存在本机。</p></div></div><div className="settings-actions"><button className="button secondary" onClick={onClearRecords}>清除全部下载任务记录</button><button className="button secondary" disabled={!hasSavedSession} onClick={onClearSession}>清除平台登录档案</button></div><p className="settings-help">清除记录或登录档案都不会删除已下载的教材文件。</p></div>
  </section>;
}

function TextbookGroup({ groupKey, resources: group, selected, skipDownloaded, onToggleResource, taskByContentId, batchActive, onDownload }: { groupKey: string; resources: TextbookResource[]; selected: Set<string>; skipDownloaded: boolean; onToggleResource: (id: string) => void; taskByContentId: Record<string, QueueTask>; batchActive: boolean; onDownload: (resource: TextbookResource) => void }) {
  const first = group[0];
  const eligible = skipDownloaded ? group.filter((resource) => resource.localState !== 'downloaded') : group;
  const groupChecked = eligible.length > 0 && eligible.every((resource) => selected.has(resource.contentId));
  const groupIndeterminate = eligible.some((resource) => selected.has(resource.contentId)) && !groupChecked;
  const toggleGroup = () => eligible.forEach((resource) => {
    if (groupChecked === selected.has(resource.contentId)) onToggleResource(resource.contentId);
  });
  if (group.length === 1) return <ResourceRow resource={first} checked={selected.has(first.contentId)} onToggle={onToggleResource} variant="single" task={taskByContentId[first.contentId]} batchActive={batchActive} onDownload={onDownload} />;
  return <>
    <tr className="textbook-row"><td><div className="textbook-cell"><ParentCheckbox checked={groupChecked} indeterminate={groupIndeterminate} disabled={eligible.length === 0} onChange={toggleGroup} /><Classification resource={first} /></div></td><td><span className="parent-title">同分类资源</span></td><td><span className="group-badge">{group.length} 项资源</span></td><td colSpan={5}></td></tr>
    {group.map((resource, index) => <ResourceRow key={resource.contentId} resource={resource} checked={selected.has(resource.contentId)} onToggle={onToggleResource} variant="child" lastInGroup={index === group.length - 1} task={taskByContentId[resource.contentId]} batchActive={batchActive} onDownload={onDownload} />)}
  </>;
}

function ParentCheckbox({ checked, indeterminate, disabled, onChange }: { checked: boolean; indeterminate: boolean; disabled: boolean; onChange: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (inputRef.current) inputRef.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={inputRef} type="checkbox" checked={checked} disabled={disabled} onChange={onChange} aria-label="选择该教材的全部版本" />;
}

function Classification({ resource }: { resource: TextbookResource }) {
  const value = [resource.stage, resource.subject, resource.grade, resource.volume, resource.edition].filter(Boolean).join(' · ') || '未标注分类';
  return <span className="classification" title={value}>{value}</span>;
}

function ResourceRow({ resource, checked, onToggle, variant, lastInGroup = false, task, batchActive, onDownload }: { resource: TextbookResource; checked: boolean; onToggle: (id: string) => void; variant: 'single' | 'child'; lastInGroup?: boolean; task?: QueueTask; batchActive: boolean; onDownload: (resource: TextbookResource) => void }) {
  const isSingle = variant === 'single';
  const isActive = task && ['queued', 'running', 'paused'].includes(task.status);
  return <tr className={`resource-row ${isSingle ? 'single-resource-row' : ''}`}><td><label className="resource-label">{!isSingle && <span className={`tree-branch ${lastInGroup ? 'last' : ''}`} />}<input type="checkbox" checked={checked} onChange={() => onToggle(resource.contentId)} />{isSingle ? <Classification resource={resource} /> : <span>资源</span>}</label></td><td>{isSingle ? <strong className="single-title" title={resource.title}>{resource.title}</strong> : <span className="resource-title" title={resource.title}>{resource.title}</span>}</td><td><span className="year-badge">{resource.resourceYear}</span></td><td>{formatSize(resource.sizeBytes)}</td><td>{resource.updateTime.slice(0, 10)}</td><td><code>{resource.contentId.slice(0, 8)}</code></td><td>{task ? <span className={`download-state ${task.status === 'error' ? 'error' : task.status === 'complete' ? 'complete' : ''}`} title={taskLabel(task)}>{isActive && <LoaderCircle size={14} className="spin" />}{task.status === 'complete' && <CheckCircle2 size={15} />}{taskLabel(task)}</span> : resource.localState === 'downloaded' ? <span className="local-state"><CheckCircle2 size={15} />已下载</span> : <span className="pending-state">未下载</span>}</td><td><button className="row-action" title={isActive || batchActive ? '下载队列运行中' : `下载 ${resource.resourceYear}`} disabled={isActive || batchActive} onClick={() => onDownload(resource)}>{isActive ? <LoaderCircle size={16} className="spin" /> : <Download size={17} />}</button></td></tr>;
}

function TaskRow({ task, retryDisabled, onRetry, speed }: { task: QueueTask; retryDisabled: boolean; onRetry: (taskId: string) => void; speed?: number }) {
  const percent = taskPercent(task);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (task.status !== 'running') return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [task.status]);
  const elapsedMs = task.startedAt ? Math.max(0, Date.now() - Date.parse(task.startedAt)) : null;
  const remainingMs = task.status === 'running' && task.totalBytes && task.receivedBytes != null && speed && speed > 0 ? Math.max(0, (task.totalBytes - task.receivedBytes) / speed * 1000) : null;
  const showProgress = (task.status === 'running' || task.status === 'paused') && percent != null;
  return <div className={`task-row ${task.status}`}><div className="task-main"><span className="task-title" title={task.title}>{task.title}</span><span className="task-sub">{task.resourceYear} · {formatSize(task.sizeBytes)} · {statusLabels[task.status]}</span>{task.status === 'running' && <span className="task-detail">速度 {formatSpeed(speed)} · 已用 {formatDuration(elapsedMs)}{remainingMs != null ? ` · 剩余 ${formatDuration(remainingMs)}` : ''}</span>}{task.error && <span className="task-error" title={task.error}>{task.error}</span>}</div><div className="task-side">{showProgress && <div className="progress-track small"><div className="progress-fill" style={{ width: `${percent}%` }} /></div>}<span className="task-message">{['running', 'queued', 'paused'].includes(task.status) ? taskLabel(task) : ''}</span>{task.status === 'error' && <button className="button secondary small" disabled={retryDisabled} onClick={() => onRetry(task.id)}><RefreshCw size={15} />重试</button>}</div></div>;
}

function LibraryRow({ item, onOpenFile, onShowFolder }: { item: LibraryItem; onOpenFile: (item: LibraryItem) => void; onShowFolder: (item: LibraryItem) => void }) {
  const classification = [item.stage, item.subject, item.grade, item.volume, item.edition, item.resourceYear].filter(Boolean).join(' · ');
  return <div className="library-row"><div className="library-main"><span className="library-title" title={item.title}>{item.title}</span><span className="library-sub">{classification || item.fileName} · {formatSize(item.size)} · {item.completedAt.slice(0, 10)}</span>{!item.exists && <span className="library-missing" title={item.path}>文件已不在原位置：{item.fileName}</span>}</div><div className="library-side"><button className="button secondary small" disabled={!item.exists} onClick={() => onOpenFile(item)}><FileText size={15} />打开</button><button className="button secondary small" onClick={() => onShowFolder(item)}><FolderOpen size={15} />所在文件夹</button></div></div>;
}

createRoot(document.getElementById('root')!).render(<App />);
