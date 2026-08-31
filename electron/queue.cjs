const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { outputPaths } = require('./download-utils.cjs');

const DOWNLOAD_DIR_NAME = 'SmartEdu Textbook Library';
const TERMINAL_STATUSES = ['complete', 'error', 'canceled'];

function makeId() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }
function serializeTask(task) {
  return {
    id: task.id,
    resource: task.resource,
    status: task.status,
    error: task.error,
    targetPath: task.targetPath,
    progress: task.progress,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    downloadOptions: task.downloadOptions,
  };
}

class DownloadQueue {
  constructor({ downloadsPath, dataPath, platformSession, partition, send, downloadResourceFn, getDownloadSettings, onBatchComplete }) {
    this.downloadsPath = downloadsPath;
    this.dataPath = dataPath;
    this.platformSession = platformSession;
    this.partition = partition;
    this.send = send;
    this.downloadResourceFn = downloadResourceFn || null;
    this.getDownloadSettings = getDownloadSettings || (() => ({ outputDirectory: path.join(this.downloadsPath, DOWNLOAD_DIR_NAME), filenameTemplate: undefined }));
    this.onBatchComplete = onBatchComplete || (() => {});
    this.batch = { id: null, status: 'idle', tasks: [] };
    this.history = [];
    this.abortController = null;
    this.abortReason = null;
    this.loopActive = false;
    this.wakeup = false;
  }

  taskPartPath(resource, downloadOptions) { return outputPaths(resource, this.downloadsPath, { directory: downloadOptions?.outputDirectory, filenameTemplate: downloadOptions?.filenameTemplate }).part; }

  async librarySnapshot() {
    try { return JSON.parse(await fs.readFile(path.join(this.dataPath, 'library.json'), 'utf8')); }
    catch { return {}; }
  }

  async saveLibrary(contentId, result, resource) {
    const library = await this.librarySnapshot();
    library[contentId] = {
      path: result.path,
      fileName: path.basename(result.path),
      size: result.size,
      completedAt: now(),
      title: resource?.title || '',
      stage: resource?.stage || '',
      subject: resource?.subject || '',
      grade: resource?.grade || '',
      volume: resource?.volume || '',
      edition: resource?.edition || '',
      resourceYear: resource?.resourceYear || '',
    };
    await fs.mkdir(this.dataPath, { recursive: true });
    await fs.writeFile(path.join(this.dataPath, 'library.json'), JSON.stringify(library, null, 2));
  }

  async listLibrary() {
    const library = await this.librarySnapshot();
    const items = Object.entries(library).map(([contentId, entry]) => {
      const record = entry || {};
      return {
        contentId,
        title: record.title || record.fileName || contentId,
        stage: record.stage || '',
        subject: record.subject || '',
        grade: record.grade || '',
        volume: record.volume || '',
        edition: record.edition || '',
        resourceYear: record.resourceYear || '',
        fileName: record.fileName || '',
        path: record.path || '',
        size: record.size || 0,
        completedAt: record.completedAt || '',
        exists: false,
      };
    });
    await this.enrichLibrary(items);
    items.sort((left, right) => String(right.completedAt || '').localeCompare(String(left.completedAt || '')));
    return items;
  }

  async enrichLibrary(items) {
    let catalog = [];
    try {
      const cached = JSON.parse(await fs.readFile(path.join(this.dataPath, 'catalog-cache.json'), 'utf8'));
      catalog = Array.isArray(cached.resources) ? cached.resources : [];
    } catch {}
    const byId = new Map(catalog.map((resource) => [resource.contentId, resource]));
    for (const item of items) {
      const resource = byId.get(item.contentId);
      if (resource) {
        item.title = item.title || resource.title || item.fileName;
        item.stage = item.stage || resource.stage || '';
        item.subject = item.subject || resource.subject || '';
        item.grade = item.grade || resource.grade || '';
        item.volume = item.volume || resource.volume || '';
        item.edition = item.edition || resource.edition || '';
        item.resourceYear = item.resourceYear || resource.resourceYear || '';
      }
      try { item.exists = (await fs.stat(item.path)).isFile(); } catch { item.exists = false; }
    }
  }

  async saveState() {
    await fs.mkdir(this.dataPath, { recursive: true });
    const snapshot = {
      batch: { id: this.batch.id, status: this.batch.status, createdAt: this.batch.createdAt, updatedAt: this.batch.updatedAt, tasks: this.batch.tasks.map(serializeTask) },
      history: this.history.map((batch) => ({ id: batch.id, status: batch.status, createdAt: batch.createdAt, updatedAt: batch.updatedAt, tasks: batch.tasks.map(serializeTask) })),
    };
    await fs.writeFile(path.join(this.dataPath, 'queue.json'), JSON.stringify(snapshot, null, 2));
  }

  snapshot() {
    return {
      batchId: this.batch.id,
      status: this.batch.status,
      createdAt: this.batch.createdAt,
      tasks: this.batch.tasks.map((task) => this.publicTask(task)),
      history: this.history.map((batch) => ({
        id: batch.id,
        status: batch.status,
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt,
        tasks: batch.tasks.map((task) => this.publicTask(task)),
      })),
    };
  }

  publicTask(task) {
    return {
      id: task.id,
      contentId: task.resource.contentId,
      title: task.resource.title,
      resourceYear: task.resource.resourceYear,
      sizeBytes: task.resource.sizeBytes,
      status: task.status,
      error: task.error,
      phase: task.progress?.phase,
      message: task.progress?.message,
      receivedBytes: task.progress?.receivedBytes,
      totalBytes: task.progress?.totalBytes,
      updatedAt: task.updatedAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    };
  }

  emitState() { this.send('download:queue', this.snapshot()); }

  emitProgress(task) {
    this.send('download:progress', { taskId: task.id, contentId: task.resource.contentId, ...task.progress });
  }

  reportTaskProgress(task, progress) {
    task.progress = progress;
    task.updatedAt = now();
    this.emitProgress(task);
  }

  async removePart(task) {
    try { await fs.rm(this.taskPartPath(task.resource, task.downloadOptions), { force: true }); } catch {}
  }

  async load() {
    try {
      const saved = JSON.parse(await fs.readFile(path.join(this.dataPath, 'queue.json'), 'utf8'));
      if (saved && saved.batch) {
        this.batch = { id: saved.batch.id || null, status: saved.batch.status || 'idle', createdAt: saved.batch.createdAt, updatedAt: saved.batch.updatedAt, tasks: saved.batch.tasks || [] };
        this.history = Array.isArray(saved.history) ? saved.history : [];
      } else if (saved && Array.isArray(saved.tasks)) {
        this.batch = saved;
        this.history = [];
      }
      if (this.batch.status === 'running') {
        this.batch.status = 'paused';
        for (const task of this.batch.tasks) {
          if (task.status === 'running') { task.status = 'paused'; task.progress = { phase: 'paused', message: '上次运行被中断，可继续下载' }; }
        }
      }
      for (const task of this.batch.tasks) {
        if (!task.downloadOptions) task.downloadOptions = { outputDirectory: path.join(this.downloadsPath, DOWNLOAD_DIR_NAME), filenameTemplate: undefined };
      }
    } catch { this.batch = { id: null, status: 'idle', tasks: [] }; this.history = []; }
    await this.cleanupStaleParts();
  }

  async cleanupStaleParts() {
    const directories = new Set([path.join(this.downloadsPath, DOWNLOAD_DIR_NAME)]);
    const knownParts = new Set(this.batch.tasks.map((task) => this.taskPartPath(task.resource, task.downloadOptions)));
    for (const directory of directories) {
      let files = [];
      try { files = await fs.readdir(directory); } catch { continue; }
      for (const file of files) {
        if (!file.endsWith('.part')) continue;
        const full = path.join(directory, file);
        if (!knownParts.has(full)) { try { await fs.rm(full, { force: true }); } catch {} }
      }
    }
  }

  async start(resources) {
    if (this.batch.status === 'running' || this.batch.status === 'paused') throw new Error('已有正在进行的下载任务，请先暂停、取消或等待其完成');
    this.archiveCurrent();
    const downloadOptions = this.getDownloadSettings();
    this.batch = {
      id: makeId(),
      status: 'running',
      createdAt: now(),
      tasks: resources.map((resource) => ({ id: makeId(), resource, downloadOptions, status: 'queued', progress: { phase: 'queued', message: '等待下载' }, createdAt: now(), updatedAt: now() })),
    };
    await this.saveState();
    this.emitState();
    void this.runNext();
    return this.snapshot();
  }

  archiveCurrent() {
    if (this.batch.tasks.length === 0) return;
    this.history.unshift({ ...this.batch, updatedAt: this.batch.updatedAt || now() });
    this.history = this.history.slice(0, 5);
  }

  async runNext() {
    if (this.loopActive) { this.wakeup = true; return; }
    this.loopActive = true;
    this.wakeup = false;
    try {
      while (this.batch.status === 'running') {
        const task = this.batch.tasks.find((item) => item.status === 'queued' || item.status === 'paused');
        if (!task) {
          this.batch.status = 'complete';
          this.batch.updatedAt = now();
          await this.saveState();
          this.emitState();
          try { this.onBatchComplete(this.snapshot()); } catch {}
          break;
        }
        await this.runTask(task);
      }
    } finally {
      this.loopActive = false;
      const shouldRestart = this.wakeup && this.batch.status === 'running';
      this.wakeup = false;
      if (shouldRestart) void this.runNext();
    }
  }

  async runTask(task) {
    this.abortController = new AbortController();
    this.abortReason = null;
    const signal = this.abortController.signal;
    const downloadResource = this.downloadResourceFn || require('./download.cjs').downloadResource;
    task.status = 'running';
    task.error = undefined;
    task.startedAt = now();
    task.completedAt = undefined;
    task.updatedAt = now();
    this.emitState();
    try {
      const result = await downloadResource(task.resource, this.platformSession, this.downloadsPath, this.partition, (progress) => this.reportTaskProgress(task, progress), { signal, outputDirectory: task.downloadOptions?.outputDirectory, filenameTemplate: task.downloadOptions?.filenameTemplate });
      task.status = 'complete';
      task.targetPath = result.path;
      task.progress = { phase: 'complete', message: '下载完成', receivedBytes: result.size, totalBytes: result.size };
      await this.saveLibrary(task.resource.contentId, result, task.resource);
    } catch (error) {
      if (signal.aborted) {
        if (this.abortReason === 'cancel') {
          task.status = 'canceled';
          task.progress = { phase: 'canceled', message: '已取消' };
          await this.removePart(task);
        } else {
          task.status = 'paused';
          task.progress = { phase: 'paused', message: '已暂停，可继续下载' };
        }
      } else {
        task.status = 'error';
        task.error = error instanceof Error ? error.message : String(error);
        task.progress = { phase: 'error', message: task.error };
      }
    }
    task.updatedAt = now();
    if (['complete', 'error', 'canceled'].includes(task.status)) task.completedAt = now();
    await this.saveState();
    this.emitState();
  }

  async waitForLoopIdle() {
    while (this.loopActive) await new Promise((resolve) => setImmediate(resolve));
  }

  async pause() {
    if (this.batch.status !== 'running') return this.snapshot();
    this.batch.status = 'paused';
    this.abortReason = 'pause';
    this.abortController?.abort();
    for (const task of this.batch.tasks) {
      if (task.status === 'queued') { task.status = 'paused'; task.progress = { phase: 'paused', message: '已暂停' }; }
    }
    this.emitState();
    await this.waitForLoopIdle();
    await this.saveState();
    this.emitState();
    return this.snapshot();
  }

  async resume() {
    if (this.batch.status !== 'paused') return this.snapshot();
    this.batch.status = 'running';
    await this.saveState();
    this.emitState();
    void this.runNext();
    return this.snapshot();
  }

  async cancel() {
    if (!['running', 'paused'].includes(this.batch.status)) return this.snapshot();
    this.batch.status = 'canceled';
    this.abortReason = 'cancel';
    this.abortController?.abort();
    for (const task of this.batch.tasks) {
      if (task.status === 'queued' || task.status === 'paused' || task.status === 'running') {
        task.status = 'canceled';
        task.progress = { phase: 'canceled', message: '已取消' };
      }
    }
    this.emitState();
    await this.waitForLoopIdle();
    await Promise.all(this.batch.tasks.filter((task) => task.status === 'canceled').map((task) => this.removePart(task)));
    await this.saveState();
    this.emitState();
    return this.snapshot();
  }

  async retry(taskId) {
    if (this.batch.status === 'running' || this.batch.status === 'paused') throw new Error('当前批次正在运行，无法重试');
    const task = this.batch.tasks.find((item) => item.id === taskId);
    if (!task || !['error', 'canceled'].includes(task.status)) return this.snapshot();
    task.status = 'queued';
    task.error = undefined;
    task.progress = { phase: 'queued', message: '等待重试' };
    for (const pending of this.batch.tasks) {
      if (pending.status === 'paused') {
        pending.status = 'queued';
        pending.progress = { phase: 'queued', message: '等待继续下载' };
      }
    }
    this.batch.status = 'running';
    await this.saveState();
    this.emitState();
    void this.runNext();
    return this.snapshot();
  }

  async retryAll() {
    if (this.batch.status === 'running' || this.batch.status === 'paused') throw new Error('当前批次正在运行，无法重试');
    const targets = this.batch.tasks.filter((task) => task.status === 'error' || task.status === 'canceled');
    if (targets.length === 0) return this.snapshot();
    for (const task of targets) {
      task.status = 'queued';
      task.error = undefined;
      task.progress = { phase: 'queued', message: '等待重试' };
    }
    for (const task of this.batch.tasks) {
      if (task.status === 'paused') {
        task.status = 'queued';
        task.progress = { phase: 'queued', message: '等待继续下载' };
      }
    }
    this.batch.status = 'running';
    await this.saveState();
    this.emitState();
    void this.runNext();
    return this.snapshot();
  }

  async clearHistory() {
    this.history = [];
    await this.saveState();
    this.emitState();
    return this.snapshot();
  }

  async clearFinished() {
    if (this.batch.status === 'running' || this.batch.status === 'paused') return this.snapshot();
    this.batch.tasks = this.batch.tasks.filter((task) => !TERMINAL_STATUSES.includes(task.status));
    if (this.batch.tasks.length === 0) this.batch = { id: null, status: 'idle', tasks: [] };
    await this.saveState();
    this.emitState();
    return this.snapshot();
  }

  async clearAllRecords() {
    if (this.batch.status === 'running' || this.batch.status === 'paused') throw new Error('下载任务进行中，无法清除任务记录');
    await Promise.all(this.batch.tasks.map((task) => this.removePart(task)));
    this.batch = { id: null, status: 'idle', tasks: [] };
    this.history = [];
    await this.saveState();
    this.emitState();
    return this.snapshot();
  }
}

module.exports = { DownloadQueue };
