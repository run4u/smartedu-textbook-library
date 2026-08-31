const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { BrowserWindow } = require('electron');
const { filename, outputPaths, validatePdf } = require('./download-utils.cjs');

function detailUrl(resource) { const url = new URL('https://basic.smartedu.cn/tchMaterial/detail'); url.searchParams.set('contentId', resource.contentId); url.searchParams.set('contentType', 'assets_document'); url.searchParams.set('catalogType', 'tchMaterial'); url.searchParams.set('subCatalog', 'tchMaterial'); return url.toString(); }
function findPdf(text, id) { const urls = text.match(/https?:\/\/[^\s"'<>\\]+/g) || []; const scoped = urls.filter((url) => url.includes(id)); const all = scoped.length ? scoped : urls; for (const raw of all) { try { const url = new URL(raw.replace(/&amp;/g, '&')); if (/viewer\.html$/i.test(url.pathname) && url.searchParams.get('file')) return url.searchParams.get('file'); if (/\.pdf(?:$|\?)/i.test(url.pathname)) return url.toString(); } catch {} } return ''; }
function abortError() { const error = new Error('下载已中断'); error.name = 'AbortError'; return error; }

async function resolvePdf(resource, platformSession, partition, report, signal) {
  report({ phase: 'resolving', message: '正在验证登录并解析教材详情' });
  if (signal?.aborted) throw abortError();
  const page = new BrowserWindow({ show: false, webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  let auth = '';
  platformSession.webRequest.onBeforeSendHeaders((details, callback) => { const header = details.requestHeaders['X-Nd-Auth'] || details.requestHeaders['x-nd-auth']; if (header) auth = header; callback({ requestHeaders: details.requestHeaders }); });
  try {
    await page.loadURL(detailUrl(resource));
    await new Promise((resolve) => setTimeout(resolve, 3500));
    if (signal?.aborted) throw abortError();
    const text = await page.webContents.mainFrame.executeJavaScript('document.documentElement ? document.documentElement.outerHTML : ""');
    const pdfUrl = findPdf(text, resource.contentId);
    if (!pdfUrl) throw new Error('未能从教材详情解析到 PDF 地址，请确认登录状态和资源权限');
    return { pdfUrl, auth };
  }
  catch (error) { throw new Error(`教材详情解析失败：${error instanceof Error ? error.message : String(error)}`); }
  finally { platformSession.webRequest.onBeforeSendHeaders(null); if (!page.isDestroyed()) page.destroy(); }
}

async function downloadResource(resource, platformSession, downloadsPath, partition, report = () => {}, options = {}) {
  const { signal, outputDirectory, filenameTemplate } = options;
  const { pdfUrl, auth } = await resolvePdf(resource, platformSession, partition, report, signal);
  const { directory, target, part } = outputPaths(resource, downloadsPath, { directory: outputDirectory, filenameTemplate });
  await fs.mkdir(directory, { recursive: true });
  const partSize = await fs.stat(part).then((stats) => stats.size).catch(() => 0);
  const resume = partSize > 0;
  if (signal?.aborted) throw abortError();
  const headers = auth ? { 'X-Nd-Auth': auth } : {};
  if (resume) headers['Range'] = `bytes=${partSize}-`;
  const response = await platformSession.fetch(pdfUrl, { headers, signal });
  if (!response.ok) throw new Error(`下载请求失败：${response.status}`);
  const resumed = resume && response.status === 206;
  if (resume && !resumed) await fs.rm(part, { force: true });
  const remainingSize = Number(response.headers.get('content-length')) || 0;
  const expectedSize = remainingSize || resource.sizeBytes || 0;
  const baseBytes = resumed ? partSize : 0;
  const totalBytes = resumed ? baseBytes + expectedSize : expectedSize;
  report({ phase: 'downloading', message: resumed ? '继续下载' : '正在下载', receivedBytes: baseBytes, totalBytes });
  const output = await fs.open(part, resumed ? 'a' : 'w');
  let receivedBytes = baseBytes;
  let lastReported = baseBytes;
  try {
    for await (const chunk of Readable.fromWeb(response.body)) {
      if (signal?.aborted) throw abortError();
      await output.write(chunk);
      receivedBytes += chunk.length;
      if (receivedBytes - lastReported >= 256 * 1024 || receivedBytes - baseBytes === expectedSize) {
        lastReported = receivedBytes;
        report({ phase: 'downloading', message: resumed ? '继续下载' : '正在下载', receivedBytes, totalBytes });
      }
    }
  } finally { await output.close(); }
  report({ phase: 'verifying', message: '正在校验文件' });
  const file = await fs.open(part, 'r'); const header = Buffer.alloc(5); await file.read(header, 0, 5, 0); await file.close();
  const size = (await fs.stat(part)).size;
  const validationError = validatePdf(header.toString('ascii'), size, resource.sizeBytes);
  if (validationError) { await fs.unlink(part); throw validationError; }
  await fs.rm(target, { force: true }); await fs.rename(part, target); report({ phase: 'complete', message: '下载完成', receivedBytes: size, totalBytes: size }); return { path: target, size };
}

module.exports = { downloadResource, resolvePdf, filename, outputPaths, validatePdf };
