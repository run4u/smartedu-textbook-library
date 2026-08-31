import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DownloadQueue } from '../electron/queue.cjs';
import { outputPaths } from '../electron/download-utils.cjs';

const tempDirs: string[] = [];

function makeTempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeResources(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    contentId: `id-${index}`,
    title: `book ${index}`,
    stage: '初中',
    subject: '数学',
    grade: '七年级',
    volume: '上册',
    edition: '人教版',
    resourceYear: '2026年度',
    sizeBytes: 100,
    localState: 'not-downloaded' as const,
  }));
}

function makeQueue({ downloadsDir, dataDir, downloader }: { downloadsDir: string; dataDir: string; downloader: (resource: any, session: any, downloadsPath: string, partition: string, report: (progress: any) => void, options: { signal: AbortSignal }) => Promise<{ path: string; size: number }> }) {
  return new DownloadQueue({
    downloadsPath: downloadsDir,
    dataPath: dataDir,
    platformSession: null,
    partition: 'test-partition',
    send: () => {},
    downloadResourceFn: downloader,
  });
}

function blockingDownloader(options: { failFor?: Set<string>; holdMs?: number } = {}) {
  const failFor = options.failFor ?? new Set<string>();
  const holdMs = options.holdMs ?? 0;
  let active = 0;
  let maxActive = 0;
  const order: string[] = [];
  const downloader = async (resource: { contentId: string }, _session: unknown, downloadsPath: string, _partition: string, report: (progress: { phase: string; message: string; receivedBytes: number; totalBytes: number }) => void, downloadOptions: { signal: AbortSignal }) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    order.push(resource.contentId);
    try {
      report({ phase: 'downloading', message: 'downloading', receivedBytes: 0, totalBytes: 100 });
      await new Promise<void>((resolve) => {
        if (downloadOptions.signal.aborted) return resolve();
        downloadOptions.signal.addEventListener('abort', () => resolve(), { once: true });
        setTimeout(resolve, holdMs);
      });
      if (downloadOptions.signal.aborted) {
        const error = new Error('aborted') as Error & { name: string };
        error.name = 'AbortError';
        throw error;
      }
      if (failFor.has(resource.contentId)) throw new Error(`failed ${resource.contentId}`);
      const directory = join(downloadsPath, 'SmartEdu Textbook Library');
      mkdirSync(directory, { recursive: true });
      const file = join(directory, `${resource.contentId}.pdf`);
      writeFileSync(file, Buffer.alloc(100));
      report({ phase: 'downloading', message: 'downloading', receivedBytes: 100, totalBytes: 100 });
      return { path: file, size: 100 };
    } finally {
      active -= 1;
    }
  };
  downloader.metrics = () => ({ active, maxActive, order: [...order] });
  return downloader;
}

async function waitFor(condition: () => boolean, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error('timed out waiting for condition');
}

describe('DownloadQueue', () => {
  it('downloads tasks sequentially, records the library, and never overlaps', async () => {
    const downloadsDir = makeTempDir('queue-dl-');
    const dataDir = makeTempDir('queue-data-');
    const downloader = blockingDownloader();
    const queue = makeQueue({ downloadsDir, dataDir, downloader });
    await queue.start(makeResources(3));
    await waitFor(() => queue.snapshot().status === 'complete');
    expect(downloader.metrics().order).toEqual(['id-0', 'id-1', 'id-2']);
    expect(downloader.metrics().maxActive).toBe(1);
    expect(queue.snapshot().tasks.every((task) => task.status === 'complete')).toBe(true);
    const library = JSON.parse(readFileSync(join(dataDir, 'library.json'), 'utf8'));
    expect(Object.keys(library)).toEqual(['id-0', 'id-1', 'id-2']);
  });

  it('marks failures and retryAll retries only the failed items', async () => {
    const downloadsDir = makeTempDir('queue-dl-');
    const dataDir = makeTempDir('queue-data-');
    const failFor = new Set(['id-1']);
    const downloader = blockingDownloader({ failFor });
    const queue = makeQueue({ downloadsDir, dataDir, downloader });
    await queue.start(makeResources(3));
    await waitFor(() => queue.snapshot().status === 'complete');
    expect(queue.snapshot().tasks.find((task) => task.contentId === 'id-1')?.status).toBe('error');
    failFor.delete('id-1');
    await queue.retryAll();
    await waitFor(() => queue.snapshot().status === 'complete' && queue.snapshot().tasks.every((task) => task.status === 'complete'));
    expect(queue.snapshot().tasks.filter((task) => task.status === 'complete')).toHaveLength(3);
  });

  it('retryAll also resumes paused remainder of the same batch', async () => {
    const downloadsDir = makeTempDir('queue-dl-');
    const dataDir = makeTempDir('queue-data-');
    const downloader = blockingDownloader();
    const queue = makeQueue({ downloadsDir, dataDir, downloader });
    const resources = makeResources(3);
    queue.batch = {
      id: 'batch-retry',
      status: 'complete',
      tasks: [
        { id: 'done', resource: resources[0], status: 'complete', progress: { phase: 'complete', message: 'done' } },
        { id: 'failed', resource: resources[1], status: 'error', error: 'offline', progress: { phase: 'error', message: 'offline' } },
        { id: 'paused', resource: resources[2], status: 'paused', progress: { phase: 'paused', message: 'paused' } },
      ],
    };
    await queue.retryAll();
    await waitFor(() => queue.snapshot().status === 'complete');
    expect(queue.snapshot().tasks.every((task) => task.status === 'complete')).toBe(true);
    expect(downloader.metrics().order).toEqual(['id-1', 'id-2']);
  });

  it('pauses the current task and resumes without overlapping', async () => {
    const downloadsDir = makeTempDir('queue-dl-');
    const dataDir = makeTempDir('queue-data-');
    const downloader = blockingDownloader({ holdMs: 500 });
    const queue = makeQueue({ downloadsDir, dataDir, downloader });
    await queue.start(makeResources(2));
    await waitFor(() => queue.snapshot().tasks.some((task) => task.status === 'running'));
    await queue.pause();
    expect(queue.snapshot().status).toBe('paused');
    await queue.resume();
    await waitFor(() => queue.snapshot().status === 'complete');
    expect(queue.snapshot().tasks.every((task) => task.status === 'complete')).toBe(true);
    expect(downloader.metrics().maxActive).toBe(1);
  });

  it('cancel marks unfinished tasks canceled', async () => {
    const downloadsDir = makeTempDir('queue-dl-');
    const dataDir = makeTempDir('queue-data-');
    const downloader = blockingDownloader({ holdMs: 500 });
    const queue = makeQueue({ downloadsDir, dataDir, downloader });
    await queue.start(makeResources(3));
    await waitFor(() => queue.snapshot().tasks.some((task) => task.status === 'running'));
    await queue.cancel();
    expect(queue.snapshot().status).toBe('canceled');
    expect(queue.snapshot().tasks.every((task) => task.status === 'canceled')).toBe(true);
  });

  it('restores an interrupted running batch as paused on load', async () => {
    const downloadsDir = makeTempDir('queue-dl-');
    const dataDir = makeTempDir('queue-data-');
    const resource = makeResources(1)[0];
    const saved = {
      batch: { id: 'b1', status: 'running', createdAt: '2026-01-01T00:00:00.000Z', tasks: [{ id: 't1', resource, status: 'running', progress: { phase: 'downloading', message: 'downloading', receivedBytes: 10, totalBytes: 100 }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }] },
      history: [],
    };
    writeFileSync(join(dataDir, 'queue.json'), JSON.stringify(saved));
    const queue = makeQueue({ downloadsDir, dataDir, downloader: blockingDownloader() });
    await queue.load();
    expect(queue.snapshot().status).toBe('paused');
    expect(queue.snapshot().tasks[0].status).toBe('paused');
  });

  it('removes stale .part files but keeps parts for known tasks', async () => {
    const downloadsDir = makeTempDir('queue-dl-');
    const dataDir = makeTempDir('queue-data-');
    const resource = makeResources(1)[0];
    const { part } = outputPaths(resource, downloadsDir);
    mkdirSync(join(downloadsDir, 'SmartEdu Textbook Library'), { recursive: true });
    writeFileSync(part, 'partial');
    writeFileSync(join(downloadsDir, 'SmartEdu Textbook Library', 'stale.part'), 'partial');
    const queue = makeQueue({ downloadsDir, dataDir, downloader: blockingDownloader() });
    queue.batch = { id: 'b1', status: 'complete', tasks: [{ id: 't1', resource, status: 'complete' }] };
    await queue.cleanupStaleParts();
    expect(existsSync(part)).toBe(true);
    expect(existsSync(join(downloadsDir, 'SmartEdu Textbook Library', 'stale.part'))).toBe(false);
  });

  it('archives the finished batch into history when a new batch starts', async () => {
    const downloadsDir = makeTempDir('queue-dl-');
    const dataDir = makeTempDir('queue-data-');
    const downloader = blockingDownloader();
    const queue = makeQueue({ downloadsDir, dataDir, downloader });
    await queue.start(makeResources(2));
    await waitFor(() => queue.snapshot().status === 'complete');
    await queue.start(makeResources(1));
    await waitFor(() => queue.snapshot().status === 'complete');
    const state = queue.snapshot();
    expect(state.history).toHaveLength(1);
    expect(state.history[0].tasks).toHaveLength(2);
    expect(state.tasks).toHaveLength(1);
  });
});
