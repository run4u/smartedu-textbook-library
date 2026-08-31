import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckCircle2, Download, FileText, FolderOpen, LoaderCircle, LogIn, LogOut, PanelLeftClose, PanelLeftOpen, Pause, Play, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { resources, type TextbookResource } from './data/fixtures';
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

type TaskStatus = 'queued' | 'running' | 'paused' | 'complete' | 'error' | 'canceled';
type QueueStatus = 'idle' | 'running' | 'paused' | 'complete' | 'canceled';
type QueueTask = {
  id: string;
  contentId: string;
  title: string;
  resourceYear: string;
  sizeBytes: number;
  status: TaskStatus;
  error?: string;
  phase?: string;
  message?: string;
  receivedBytes?: number;
  totalBytes?: number;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
};
type HistoryBatch = { id: string; status: QueueStatus; createdAt?: string; updatedAt?: string; tasks: QueueTask[] };
type QueueState = { batchId: string | null; status: QueueStatus; createdAt?: string; tasks: QueueTask[]; history: HistoryBatch[] };
type DownloadProgress = { taskId: string; contentId: string; phase: string; message: string; receivedBytes?: number; totalBytes?: number };
type LibraryItem = {
  contentId: string;
  title: string;
  stage: string;
  subject: string;
  grade: string;
  volume: string;
  edition: string;
  resourceYear: string;
  fileName: string;
  path: string;
  size: number;
  completedAt: string;
  exists: boolean;
};

type TextbookBridge = {
  loadCatalog?: () => Promise<{ resources: TextbookResource[]; source: string }>;
  getSessionStatus?: () => Promise<{ hasSavedSession: boolean }>;
  login?: () => Promise<{ hasSavedSession: boolean; autoClosed?: boolean }>;
  clearSession?: () => Promise<{ hasSavedSession: boolean }>;
  downloadState?: () => Promise<QueueState>;
  startDownload?: (resources: TextbookResource[]) => Promise<QueueState>;
  pauseDownload?: () => Promise<QueueState>;
  resumeDownload?: () => Promise<QueueState>;
  cancelDownload?: () => Promise<QueueState>;
  retryTask?: (taskId: string) => Promise<QueueState>;
  retryAllTasks?: () => Promise<QueueState>;
  clearFinishedTasks?: () => Promise<QueueState>;
  clearDownloadHistory?: () => Promise<QueueState>;
  listLibrary?: () => Promise<LibraryItem[]>;
  openLibraryFile?: (filePath: string) => Promise<string>;
  showLibraryInFolder?: (filePath: string) => Promise<{ ok: boolean }>;
  onDownloadProgress?: (listener: (progress: DownloadProgress) => void) => () => void;
  onDownloadQueue?: (listener: (state: QueueState) => void) => () => void;
};

function bridge(): TextbookBridge | undefined {
  return (window as Window & { textbookLibrary?: TextbookBridge }).textbookLibrary;
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
  const [view, setView] = useState<'catalog' | 'tasks' | 'library'>('catalog');
  const [catalog, setCatalog] = useState(resources);
  const [catalogStatus, setCatalogStatus] = useState('正在加载官方目录');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [skipDownloaded, setSkipDownloaded] = useState(true);
  const [filters, setFilters] = useState({ stage: '', subject: '', grade: '', volume: '', edition: '' });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [hasSavedSession, setHasSavedSession] = useState(false);
  const [loginMessage, setLoginMessage] = useState('');
  const [batchNotice, setBatchNotice] = useState('');
  const [queue, setQueue] = useState<QueueState>({ batchId: null, status: 'idle', tasks: [], history: [] });
  const [taskSpeeds, setTaskSpeeds] = useState<Record<string, number>>({});
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [librarySubject, setLibrarySubject] = useState('');
  const [libraryMessage, setLibraryMessage] = useState('');
  const queueWasActive = useRef(false);
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
      if (desktopBridge?.getSessionStatus) setHasSavedSession((await desktopBridge.getSessionStatus()).hasSavedSession);
    } catch { setCatalogStatus('官方目录暂不可用，正在展示本地样例'); }
  };
  const loadLibrary = async () => {
    const desktopBridge = bridge();
    if (!desktopBridge?.listLibrary) { setLibraryItems([]); return; }
    try { setLibraryItems(await desktopBridge.listLibrary()); setLibraryMessage(''); }
    catch (error) { setLibraryMessage(error instanceof Error ? error.message : String(error)); }
  };
  useEffect(() => { void loadCatalogData(); }, []);
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

  const openLogin = async () => {
    const desktopBridge = bridge();
    if (desktopBridge?.login) {
      const result = await desktopBridge.login();
      setHasSavedSession(result.hasSavedSession);
      setLoginMessage(result.hasSavedSession ? (result.autoClosed ? '登录完成，已自动返回' : '登录窗口已关闭，登录档案已保存') : '登录窗口已关闭，未检测到登录档案');
    }
  };
  const logout = async () => {
    if (!window.confirm('确认清除本应用保存的平台登录档案？')) return;
    const desktopBridge = bridge();
    if (desktopBridge?.clearSession) {
      await desktopBridge.clearSession();
      setHasSavedSession(false);
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
      </nav>
      <div className="sidebar-footer"><span className={`session-dot ${hasSavedSession ? '' : 'off'}`} />{hasSavedSession ? '登录档案已保存' : '未登录'}</div>
    </aside>
    <main>
      <header className="topbar"><div><p className="eyebrow">{view === 'catalog' ? '教材目录' : view === 'tasks' ? '下载任务' : '本地资料'}</p><h1>{view === 'catalog' ? '查找并识别教材版本' : view === 'tasks' ? '队列与下载历史' : '已下载教材'}</h1></div><div className="login-area">{loginMessage && <span className="login-message">{loginMessage}</span>}{hasSavedSession && <button className="icon-button" title="退出登录" onClick={logout}><LogOut size={17} /></button>}<button className="button secondary" onClick={openLogin}><LogIn size={17} />{hasSavedSession ? '登录档案已保存' : '登录平台'}</button></div></header>

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
    </main>
  </div>;
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
